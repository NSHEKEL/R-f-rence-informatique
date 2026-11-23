const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const axios = require('axios');
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
function evaluate(source, context) {
  vm.runInContext(ts.transpileModule(source, { compilerOptions: options }).outputText, context);
}
function library(name) {
  const exports = {};
  evaluate(readFileSync(`${__dirname}/src/lib/${name}.ts`, 'utf8'), vm.createContext({ exports }));
  return exports;
}
const { scanCodes } = library('scan');
const { ScanCapture, scanQueue } = library('scanCapture');
const { stockLimit } = library('posDisplay');
const { withPackaging, splitQuantity } = library('units');
const product = { id: 1, active: true, name: 'Article', sku: 'SCAN-SKU', barcode: '1234567890123', sale_price: 1000,
  barcodes: [{ code: 'VAR/456', label: 'Variante', active: true }], packagings: [{ id: 7, barcode: 'PACK-789', name: 'Carton', factor: 6, price_detail: 5000, active: true }] };
const page = ts.createSourceFile('NouvelleVente.tsx', readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let scanner, search, addCart, parts;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(page) === 'useScanner') scanner = node.getText(page);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'submitSearch') search = node.getText(page);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'cartParts') parts = node.getText(page);
  if (ts.isVariableDeclaration(node) && node.name.getText(page) === 'addToCart') addCart = node.initializer.arguments[0].getText(page);
  ts.forEachChild(node, visit);
}
visit(page);

function setup({ online = false, locked = false, rows = [product], refused = 0 } = {}) {
  let remoteCalls = 0;
  const commands = [], errors = [];
  let cart = [];
  const state = { online, locked };
  const desktop = { available: () => true, state: () => state, refresh: async () => state,
    command: async (action, params) => {
      commands.push({ action, ...params });
      const code = decodeURIComponent(params.path.split('/').at(-1));
      const found = rows.find(row => scanCodes(row).includes(code.toLowerCase()));
      if (refused || !found) {
        const error = new Error('Lecture refusée');
        error.isAxiosError = true;
        error.response = { status: refused || 404 };
        throw error;
      }
      const alias = found.barcodes?.find(row => row.code.toLowerCase() === code.toLowerCase());
      return { ...found, scanned_code: code, scanned_label: alias?.label };
    } };
  const transport = { ...axios, create: () => axios.create({ adapter: async config => {
    remoteCalls++;
    throw new axios.AxiosError('Server unreachable', 'ERR_NETWORK', config);
  } }) };
  const output = {};
  const storage = new Map([['ri_server_url', 'http://seller-server:8000']]);
  const context = vm.createContext({ exports: output, Error, URL,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { location: { pathname: '/vente' } },
    require: path => path === 'axios' ? { __esModule: true, default: transport } : { desktopOffline: desktop } });
  evaluate(readFileSync(`${__dirname}/src/api/client.ts`, 'utf8').replaceAll('import.meta.env.VITE_API_URL', 'undefined'), context);
  let enqueue;
  Object.assign(context, { api: output.default, axios, products: [product], filtered: [product], scanCodes, stockLimit, allowNegativeStock: false,
    readPosteSettings: () => ({ scanner_auto_add: true }),
    useScanner: (callback, onError) => { enqueue = scanQueue(callback, onError); },
    setQuery: value => { context.query = value; }, setProducts: callback => { context.products = callback(context.products); },
    withPackaging, splitQuantity, priceMode: 'detail', lastAdded: { current: null }, setCart: update => { cart = update(cart); },
    setSelectedLine() {}, setFlash() {}, setError: error => errors.push(error),
    scanValue: value => value, window: { location: { pathname: '/vente' }, setTimeout: callback => callback() } });
  evaluate(parts, context);
  evaluate(`const addToCart = ${addCart};`, context);
  evaluate(scanner, context);
  evaluate(search, context);
  return { get cart() { return cart; }, errors, commands, remoteCalls: () => remoteCalls, api: output.default,
    scan: async code => {
      const capture = new ScanCapture(), settings = { scanner_prefix: '', scanner_suffix: 'Enter', scanner_min_length: 3 };
      let time = 1000;
      const key = key => ({ key, code: '', isComposing: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false });
      for (const char of code) capture.feed(key(char), time += 10, settings);
      const codes = capture.feed(key('Enter'), time + 10, settings);
      assert.ok(codes);
      await enqueue(codes);
    },
    search: async code => { context.query = code; await vm.runInContext('submitSearch()', context); } };
}

test('offline scanner and focused Enter add primary, variant and packaging immediately through the broker', async () => {
  for (const method of ['scan', 'search']) {
    const view = setup();
    for (const code of ['1234567890123', 'VAR/456', 'PACK-789']) await view[method](code);
    assert.equal(view.cart.length, 3);
    assert.equal(view.cart[1].scanned_label, 'Variante');
    assert.equal(view.cart[2].packaging_id, 7);
    assert.equal(view.cart[2].quantity, 6);
    await view[method]('1234567890123');
    assert.equal(view.cart.length, 3);
    assert.equal(view.cart[0].quantity, 2);
    assert.equal(view.remoteCalls(), 0);
    assert.ok(view.commands.every(call => call.action === 'request' && call.path.startsWith('/products/by-code/')));
  }
  console.log('OFFLINE_SCAN_CART_OK primary=True secondary=True packaging=True focused_enter=True remote_requests=0');
});

test('first outage falls back to broker; empty or refused catalogue never adds a stale page item', async () => {
  const outage = setup({ online: true });
  await outage.scan('1234567890123');
  assert.equal(outage.cart.length, 1);
  assert.equal(outage.remoteCalls(), 1);
  for (const config of [{ rows: [] }, { refused: 401 }, { refused: 403 }, { refused: 409 }, { refused: 423 }]) {
    const view = setup(config);
    await view.scan('1234567890123');
    assert.equal(view.cart.length, 0);
    assert.ok(view.errors.length);
    if (config.refused) assert.match(view.errors[0], /Lecture refusée/);
  }
});

test('a locked broker is not used for local scanner lookup', async () => {
  const view = setup({ locked: true });
  await assert.rejects(view.api.get('/products/by-code/1234567890123'));
  assert.equal(view.commands.length, 0);
  assert.equal(view.remoteCalls(), 1);
});
