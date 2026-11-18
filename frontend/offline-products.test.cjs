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
