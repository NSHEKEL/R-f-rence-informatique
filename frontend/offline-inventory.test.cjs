const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const storage = new Map();
  let quota = false;
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { if (quota) throw Error('quota'); storage.set(key, String(value)); }, removeItem: (key) => storage.delete(key) };
  const login = (id) => { localStorage.setItem('ri_token', `token-${id}`); localStorage.setItem('ri_auth_cache', JSON.stringify({ token: `token-${id}`, user: { id }, rights: [] })); };
  login(1);
  const navigator = { onLine: true };
  const api = { get: async () => { throw Error('offline'); }, put: async () => { throw Error('offline'); } };
  function reload() {
    const cache = {};
    function load(name) {
      if (cache[name]) return cache[name];
      const exports = {}; cache[name] = exports;
      const source = readFileSync(`${__dirname}/src/lib/${name}.ts`, 'utf8');
      vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
        exports, require: (path) => path === '../api/client' ? { __esModule: true, default: api } : path.startsWith('./') ? load(path.slice(2)) : require(path),
        localStorage, navigator, window: { dispatchEvent() {} }, Event, console,
      });
      return exports;
    }
    return load('offlineInventory');
  }
  return { storage, localStorage, login, navigator, api, reload, quota: () => { quota = true; } };
}
const row = { product_id: 1, sku: 'RIZ', name: 'Riz', base_unit: 'pièce', packaging_unit: 'Carton', units_per_packaging: 12, packagings: [{ id: 6, name: 'Colis', factor: 6 }], physical_qty: null, theoretical_qty: 150, unit_cost: 2, counts: { base: null }, note: '' };
const report = { id: 7, status: 'in_progress', theoretical_visible: true, stats: { counted: 0, not_counted: 1 }, rows: [row] };

test('stock pagination bounds visible rows without slicing the counted inventory', () => {
  const source = readFileSync(`${__dirname}/src/pages/Inventaire.tsx`, 'utf8');
  const calculations = source.slice(source.indexOf('  const stockPageSize ='), source.indexOf('  useEffect(() => { setStockPage(1); }'));
  const filtered = Array.from({ length: 123 }, (_, id) => ({ id }));
  const counted = { 1: { rayon: '2', stock: '3' }, 122: { rayon: '4', stock: '5' } };
  const page = (stockPage, items = filtered) => vm.runInNewContext(`${calculations}\n({ pagedStock, visibleStockPage, stockPages })`, { filtered: items, stockPage, Math });
  assert.equal(page(1).pagedStock.length, 50); assert.equal(page(3).pagedStock.length, 23);
  assert.equal(page(3).pagedStock[22].id, 122);
  assert.equal(page(999, []).visibleStockPage, 1); assert.equal(page(999, []).pagedStock.length, 0);
  assert.equal(counted[122].stock, '5'); assert.equal(filtered.length, 123);
  assert.match(source, /pagedStock\.map\(\(p\) =>/);
  assert.match(source, /products\s*\.map\(/);
});

test('targeted catalogue cache patches preserve other products, variants, costs and filtered removals', async () => {
  const env = setup(), lib = env.reload();
  env.api.get = async () => ({ data: [{ id: 1, name: 'A', quantity: 12 }, { id: 2, name: 'B', quantity: 24 }] });
  await lib.readOffline('/products', 'products:all:active');
  await lib.patchCatalogue('products:all:active', [2, 3], [
    { id: 2, name: 'B', quantity: 36, stock_value: 18000, packagings: [{ factor: 12 }], barcodes: [{ code: 'VAR', active: true }] },
    { id: 3, name: 'C', quantity: 1 },
  ]);
  env.navigator.onLine = false;
  let saved = await lib.readOffline('/products', 'products:all:active');
  assert.equal(saved.data.length, 3); assert.equal(saved.data[0].quantity, 12);
  assert.equal(saved.data[1].stock_value, 18000); assert.equal(saved.data[1].packagings[0].factor, 12);
  assert.equal(saved.data[1].barcodes[0].code, 'VAR');
  await lib.patchCatalogue('products:all:active', [2], []);
  saved = await lib.readOffline('/products', 'products:all:active');
  assert.equal(saved.data.map((p) => p.id).join(','), '1,3');
  await assert.rejects(lib.patchCatalogue('missing-cache', [1], []), /absent/);
  env.quota(); await assert.rejects(lib.patchCatalogue('products:all:active', [1], []), /quota/);
});

test('image-free catalogue cache survives reload offline and preserves its date', async () => {
  const env = setup();
  const products = Array.from({ length: 2000 }, (_, id) => ({ id, name: `Article ${id}`, image: 'binary-image'.repeat(200), packagings: [{ factor: 12 }] }));
  env.api.get = async () => ({ data: products });
  const live = await env.reload().readOffline('/products', 'products');
  assert.equal(live.fromCache, false); assert.ok(live.data[0].image);
  env.navigator.onLine = false;
  const restored = await env.reload().readOffline('/products', 'products');
  assert.equal(restored.fromCache, true); assert.equal(restored.savedAt, live.savedAt);
  assert.equal(restored.data.length, 2000); assert.equal(restored.data[0].image, '');
  assert.ok([...env.storage.values()].every((value) => !value.includes('binary-image')));
});

test('queue upserts per product, survives reload, preserves zero and scopes users and servers', async () => {
  const env = setup(), lib = env.reload();
  await lib.rememberSession(report);
  const first = await lib.queueCount(7, 1, { primary: 10, 6: 3, base: 5 }, 'entrepôt');
  const next = await lib.queueCount(7, 1, { base: 0 }, 'zéro');
  assert.ok(Date.parse(next.client_updated_at) > Date.parse(first.client_updated_at));
  assert.equal(next.client_id, first.client_id);
  env.navigator.onLine = false;
  const restored = env.reload();
  assert.equal(Object.keys(await restored.pendingCounts(7)).length, 1);
  const session = await restored.readSession(7);
  assert.equal(session.data.rows[0].physical_qty, 0); assert.equal(session.data.stats.counted, 1);
  assert.equal(session.data.stats.variance_value, -300);
  env.login(2); assert.equal(Object.keys(await restored.pendingCounts(7)).length, 0);
  env.login(1); env.localStorage.setItem('ri_server_url', 'http://other:8000');
  assert.equal(Object.keys(await restored.pendingCounts(7)).length, 0);
  env.localStorage.removeItem('ri_server_url');
  assert.equal(Object.keys(await restored.pendingCounts(7)).length, 1);
});

test('sync retains network and closed-session failures; a newer edit during upload is not dropped', async () => {
  const env = setup(), lib = env.reload();
  await lib.queueCount(7, 1, { base: 3 }, 'first');
  assert.equal((await lib.syncCounts(7)).pending, 1);
  let finish, started;
  const ready = new Promise((resolve) => { started = resolve; });
  env.api.put = async (_url, payload) => { started(); await new Promise((resolve) => { finish = resolve; }); return { data: { ...report, rows: [{ ...row, ...payload, physical_qty: 3 }] } }; };
  const syncing = lib.syncCounts(7); await ready;
  await lib.queueCount(7, 1, { base: 0 }, 'newer'); finish();
  assert.equal((await syncing).pending, 1);
  env.api.put = async (_url, payload) => ({ data: { ...report, rows: [{ ...row, ...payload, physical_qty: 0 }] } });
  assert.equal((await lib.syncCounts(7)).pending, 0);
  await lib.queueCount(7, 1, { base: 2 }, 'closed');
  env.api.put = async () => { throw { response: { status: 409, data: { detail: "Session déjà validée" } } }; };
  const failed = await lib.syncCounts(7);
  assert.equal(failed.pending, 1);
  assert.match(failed.error, /Session déjà validée/);
  assert.equal(Object.keys(await lib.pendingCounts(7)).length, 1);
});

test('merge respects server timestamps and closed reports; storage quota is not silently ignored', async () => {
  const env = setup(), lib = env.reload();
  const entry = await lib.queueCount(7, 1, { base: null }, 'clear');
  assert.equal(lib.mergeCounts(report, { 1: entry }).rows[0].physical_qty, null);
  const server = { ...report, rows: [{ ...row, physical_qty: 22, client_id: 'server', client_updated_at: '9999-01-01T00:00:00Z' }] };
  assert.equal(lib.mergeCounts(server, { 1: entry }).rows[0].physical_qty, 22);
  assert.equal(lib.mergeCounts({ ...server, status: 'validated' }, { 1: entry }).rows[0].physical_qty, 22);
  env.quota();
  await assert.rejects(lib.queueCount(7, 1, { base: 9 }, ''), /quota/);
  assert.equal((await lib.pendingCounts(7))[1].counts.base, null);
});
