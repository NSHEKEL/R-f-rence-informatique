const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const storage = new Map(); let quota = false;
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { if (quota) throw Error('quota'); storage.set(key, value); } };
  const api = { post: async () => ({ data: {} }) }, cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = {}; cache[name] = exports;
    vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, require: (path) => path === '../api/client' ? { __esModule: true, default: api } : load(path.slice(2)), localStorage, window: { dispatchEvent() {} }, Event,
    }); return exports;
  }
  return { lib: load('offline'), api, localStorage, quota: () => { quota = true; } };
}
const payload = { client_uuid: 'uuid-one', name: 'Riz', sku: 'RIZ', quantity: 7, barcode: '123', qr_code: '', image: 'full image', packagings: [{ name: 'Carton', factor: 6, active: true, barcode: 'PACK' }], barcodes: [{ code: 'VAR', active: true }] };

test('product create and edit refresh only the saved id, with full reload only on refresh failure', async () => {
  const source = readFileSync(`${__dirname}/src/pages/Products.tsx`, 'utf8');
  const file = ts.createSourceFile('Products.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let save;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'save') save = node.getText(file); ts.forEachChild(node, visit); }
  visit(file); assert.ok(save);
  for (const mode of ['create', 'edit', 'refresh-error', 'save-error', 'invalid']) {
    const calls = [], refreshed = []; let reloads = 0, error = '';
    const context = {
      permitted: () => true, readOnly: false, pendingUuid: null, editing: mode === 'create' ? null : { id: 12 },
      form: { ...payload, quantity: mode === 'invalid' ? -1 : 0, packaging_unit: '', base_unit: 'pièce', packagings: [],
        category_id: '', supplier_id: '', min_stock: '', purchase_price: 500, sale_price: 600, wholesale_price: 550,
        semi_wholesale_min_qty: '', wholesale_min_qty: '', semi_wholesale_price: '', supplier_purchase_price: '', expiry_date: '' },
      productBarcodes: (value) => value, productTextError: () => '', setSaving() {}, setModalOpen() {}, setNotice() {},
      setError: (value) => { error = value; }, apiErrorMessage: (value) => String(value), axios: { isAxiosError: () => false },
      api: Object.fromEntries(['post', 'put'].map((method) => [method, async (url, data) => {
        calls.push(url); assert.equal(data.purchase_price, 500);
        if (mode === 'save-error') throw Error('save failed');
        return { data: { id: 12 } };
      }])),
      refreshProducts: async (ids) => { refreshed.push(...ids); if (mode === 'refresh-error') throw Error('refresh failed'); },
      load: async () => { reloads++; },
    };
    vm.createContext(context); vm.runInContext(ts.transpileModule(save, {}).outputText, context);
    await vm.runInContext('save()', context);
    if (mode === 'invalid') { assert.equal(calls.length, 0); assert.match(error, /Stock/); }
    else if (mode === 'save-error') { assert.equal(refreshed.length, 0); assert.match(error, /save failed/); }
    else { assert.deepEqual(refreshed, [12]); assert.equal(error, ''); }
    assert.equal(reloads, mode === 'refresh-error' ? 1 : 0);
    if (mode === 'create') assert.deepEqual(calls, ['/products']);
    if (mode === 'edit') assert.deepEqual(calls, ['/products/12']);
  }
});

test('existing edits overlay the cached catalogue, coalesce and discard without mutating originals', async () => {
  const { lib, api } = setup(); let calls = 0; api.post = async () => { calls++; return { data: {} }; };
  const original = { ...payload, id: 12, sale_price: 100 };
  lib.queueProductEdit(original, { ...payload, sale_price: 100 });
  assert.equal(lib.pendingProducts().length, 0);
  assert.equal((await lib.flushPendingProducts()).synced, 0); assert.equal(calls, 0);
  lib.queueProductEdit(original, { ...payload, sale_price: 120 });
  const shown = lib.pendingCatalogue('/products', [original])[0];
  assert.equal(shown.sale_price, 120); assert.equal(original.sale_price, 100);
  lib.queueProductEdit(shown, { ...payload, sale_price: 130 });
  const entry = lib.pendingProducts()[0];
  assert.equal(lib.pendingProducts().length, 1); assert.equal(entry.originals.sale_price, 100); assert.equal(entry.changes.sale_price, 130);
  assert.equal(Object.keys(entry.changes).join(','), 'sale_price');
  lib.discardPendingProduct(entry.payload.client_uuid);
  assert.equal(lib.pendingCatalogue('/products/pos', [original])[0].sale_price, 100);
});

test('offline edits with form-only expiry_date sync and legacy queued form fields are stripped', async () => {
  const { lib, api, localStorage } = setup(); const requests = [];
  api.post = async (_url, body) => {
    assert.equal('expiry_date' in body.changes, false); assert.equal('expiry_date' in body.originals, false);
    assert.equal('id' in body.changes, false); assert.equal('client_uuid' in body.changes, false);
    requests.push(body); return { data: {} };
  };
  const original = { ...payload, id: 12 };
  lib.queueProductEdit(original, { ...payload, id: 12, name: 'Riz corrigé', expiry_date: '' });
  assert.equal('expiry_date' in lib.pendingProducts()[0].changes, false);
  await lib.flushPendingProducts(); assert.equal(requests.length, 1); assert.equal(lib.pendingProducts().length, 0);
  lib.queueProductEdit(original, { ...payload, name: 'Riz corrigé encore', expiry_date: '' });
  const legacy = lib.pendingProducts()[0]; legacy.changes.expiry_date = ''; legacy.originals.expiry_date = null;
  localStorage.setItem('ri_pending_products:local:local', JSON.stringify([legacy]));
  await lib.flushPendingProducts(); assert.equal(requests.length, 2); assert.equal(lib.pendingProducts().length, 0);
  localStorage.setItem('ri_pending_products:local:local', JSON.stringify([{ ...legacy, changes: { expiry_date: '' }, originals: { expiry_date: null } }]));
  await lib.flushPendingProducts(); assert.equal(requests.length, 2); assert.equal(lib.pendingProducts().length, 0);
});

test('edit conflicts remain readable, retry keeps its id, explicit force gets a fresh id', async () => {
  const { lib, api } = setup(); const requests = [];
  api.post = async (url, body) => { requests.push({ url, body }); if (!body.force) throw { response: { status: 409, data: { detail: 'Conflit : prix modifié sur le serveur' } } }; return { data: {} }; };
  lib.queueProductEdit({ ...payload, id: 12, sale_price: 100 }, { ...payload, sale_price: 120 });
  const uuid = lib.pendingProducts()[0].payload.client_uuid;
  await lib.flushPendingProducts(); assert.match(lib.pendingProducts()[0].reason, /Conflit/);
  await lib.flushPendingProducts(); assert.equal(requests.length, 1);
  lib.retryPendingProduct(uuid); await lib.flushPendingProducts();
  assert.equal(requests[1].body.operation_id, uuid); assert.equal(requests[1].body.force, false);
  lib.retryPendingProduct(uuid, true); await lib.flushPendingProducts();
  assert.equal(requests[2].url, '/products/12/offline-update'); assert.notEqual(requests[2].body.operation_id, uuid);
  assert.equal(requests[2].body.force, true); assert.equal(lib.pendingProducts().length, 0);
});

test('unknown update result replays the exact operation and cannot be silently edited', async () => {
  const { lib, api } = setup(); const requests = []; let fail = true;
  api.post = async (_url, body) => { requests.push(JSON.stringify(body)); if (fail) throw Error('connection lost'); return { data: {} }; };
  const original = { ...payload, id: 12, sale_price: 100 };
  lib.queueProductEdit(original, { ...payload, sale_price: 120 });
  await lib.flushPendingProducts(); assert.equal(lib.pendingProducts()[0].attempted, true);
  assert.throws(() => lib.queueProductEdit(original, { ...payload, sale_price: 130 }), /Envoi déjà tenté/);
  fail = false; await lib.flushPendingProducts();
  assert.equal(requests[0], requests[1]); assert.equal(lib.pendingProducts().length, 0);
});

test('offline full product payload is persistent, scoped and searchable by name/SKU/all codes', () => {
  const { lib, localStorage } = setup(); lib.queueProduct(payload);
  assert.equal(lib.pendingProducts().length, 1); assert.deepEqual(JSON.parse(JSON.stringify(lib.pendingProducts()[0].payload)), payload);
  for (const query of ['riz', 'RIZ', '123', 'VAR', 'PACK']) assert.equal(lib.pendingProductMatches(lib.pendingProducts()[0], query), true);
  assert.equal(lib.pendingProductMatches(lib.pendingProducts()[0], 'absent'), false);
  localStorage.setItem('ri_server_url', 'another-server'); assert.equal(lib.pendingProducts().length, 0);
  localStorage.setItem('ri_server_url', ''); lib.queueProduct(payload); localStorage.setItem('ri_auth_cache', '{"user":{"id":2}}'); assert.equal(lib.pendingProducts().length, 0);
  assert.match(lib.newProductUuid(), /^[a-f0-9-]{36}$/);
});

test('sync is single-flight and never drops a product queued during upload', async () => {
  const { lib, api } = setup(); let complete, started;
  const ready = new Promise((resolve) => { started = resolve; }); let calls = 0;
  api.post = async () => { calls++; started(); await new Promise((resolve) => { complete = resolve; }); return { data: {} }; };
  lib.queueProduct(payload); const first = lib.flushPendingProducts(); await ready;
  const second = lib.flushPendingProducts(); assert.equal(first, second);
  lib.queueProduct({ ...payload, client_uuid: 'uuid-two' }); complete();
  assert.equal((await first).synced, 1); assert.equal(calls, 1); assert.equal(lib.pendingProducts()[0].payload.client_uuid, 'uuid-two');
});

test('network failures retain the entry; readable 422 conflicts stay editable/retryable/deletable', async () => {
  const { lib, api } = setup(); lib.queueProduct(payload);
  api.post = async () => { throw Error('offline'); }; await lib.flushPendingProducts(); assert.equal(lib.pendingProducts().length, 1);
  assert.throws(() => lib.queueProduct({ ...payload, sku: 'UNCERTAIN' }), /Envoi déjà tenté/);
  api.post = async () => { throw { response: { status: 422, data: { detail: [{ loc: ['body', 'sku'], msg: 'Référence déjà utilisée' }] } } }; };
  await lib.flushPendingProducts(); assert.match(lib.pendingProducts()[0].reason, /Référence déjà utilisée/);
  api.post = async () => assert.fail('conflicts require explicit retry'); await lib.flushPendingProducts();
  lib.queueProduct({ ...payload, sku: 'CORRECTED' }); assert.equal(lib.pendingProducts()[0].reason, '');
  api.post = async (_url, value) => { assert.equal(value.client_uuid, payload.client_uuid); return { data: {} }; };
  await lib.flushPendingProducts(); assert.equal(lib.pendingProducts().length, 0);
  lib.queueProduct(payload); lib.discardPendingProduct(payload.client_uuid); assert.equal(lib.pendingProducts().length, 0);
});

test('empty queue does not call the API; quota failure never reports a successful save', async () => {
  const { lib, api, quota } = setup(); api.post = async () => assert.fail('empty');
  assert.equal((await lib.flushPendingProducts()).synced, 0); quota();
  assert.throws(() => lib.queueProduct(payload), /Stockage local plein/); assert.equal(lib.pendingProducts().length, 0);
});
