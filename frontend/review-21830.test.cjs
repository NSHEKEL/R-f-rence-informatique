const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('variant scans do not attribute the next catalogue tile to the earlier variant', async () => {
  const source = readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, 'utf8');
  const file = ts.createSourceFile('NouvelleVente.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'submitSearch') code.push(node.getText(file));
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'addToCart') code.push(`const addToCart = ${node.initializer.arguments[0].getText(file)};`);
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useScanner') code.push(`const scan = ${node.arguments[0].getText(file)};`);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(code.length, 3);
  for (const method of ['submitSearch()', 'scan(["VAR"])']) {
    const product = { id: 1, name: 'Article', quantity: 20, barcodes: [{ code: 'VAR', label: 'Variante', active: true }] };
    const scanned = { ...product, scanned_code: 'VAR', scanned_label: 'Variante', packaging_id: null };
    const state = { products: [product], filtered: [product], query: 'VAR', cart: [], priceMode: 'detail',
      api: { get: async () => ({ data: scanned }) }, readPosteSettings: () => ({ scanner_auto_add: true }),
      scanValue: (v) => v, scanCodes: () => ['var'], withPackaging: (p) => p, stockLimit: (p) => p.quantity,
      allowNegativeStock: false, lastAdded: { current: null }, setSelectedLine() {}, setError() {}, setFlash() {},
      window: { setTimeout() {} }, setQuery() {} };
    state.setProducts = (change) => { state.products = change(state.products); };
    state.setCart = (change) => { state.cart = change(state.cart); };
    const context = vm.createContext(state);
    vm.runInContext(ts.transpileModule(code.join('\n'), {}).outputText, context);
    await vm.runInContext(method, context);
    vm.runInContext('addToCart(products[0])', context);
    assert.equal(state.cart.length, 2, method);
    assert.equal(state.cart[0].scanned_code, 'VAR');
    assert.equal(state.cart[0].scanned_label, 'Variante');
    assert.equal(state.cart[1].scanned_code, undefined);
    assert.equal(state.cart[1].scanned_label, undefined);
    assert.equal(state.products[0].packaging_id, undefined);
    assert.equal(scanned.scanned_code, 'VAR');
  }
});
