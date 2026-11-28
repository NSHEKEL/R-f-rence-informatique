const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const storage = new Map(), events = new Map(), api = { post: async () => ({ data: {} }), get: async path => ({ data: path === '/auth/me' ? { id: 1, role: 'vendeur' } : { allowed: [] } }) };
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const window = { dispatchEvent() {}, addEventListener: (event, callback) => events.set(event, callback), removeEventListener() {}, setInterval() {}, clearInterval() {}, setTimeout() {} };
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = {}; cache[name] = exports;
    vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: path => path === '../api/client' ? { __esModule: true, default: api } : load(path.slice(2)), localStorage, window, Event, atob, crypto: require('node:crypto').webcrypto });
    return exports;
  }
  const identity = (server, user) => { localStorage.setItem('ri_server_url', server); localStorage.setItem('ri_auth_cache', JSON.stringify({ user: { id: user }, token: 'token' })); localStorage.setItem('ri_token', 'token'); };
  return { lib: load('offline'), api, storage, localStorage, window, events, identity, load };
}
const entry = id => ({ payload: { client_id: id, cash_session_id: 42 }, snapshot: { reference: id } });

test('queue isolated by server and cashier; legacy unowned tickets are retained visibly', async () => {
  const { lib, api, identity, localStorage } = setup(); let calls = 0;
  api.post = async () => { calls++; return { data: {} }; };
  identity('http://server-a', 1); lib.queueSale(entry('A'));
  identity('http://server-a', 2); await lib.flushPendingSales(); assert.equal(calls, 0);
  identity('http://server-b', 1); await lib.flushPendingSales(); assert.equal(calls, 0);
  identity('http://server-a', 1); await lib.flushPendingSales(); assert.equal(calls, 1); assert.equal(lib.pendingSales().length, 0);
  localStorage.setItem('ri_pending_sales', JSON.stringify([entry('legacy')]));
  await lib.flushPendingSales(); assert.equal(calls, 1); assert.match(lib.pendingSales()[0].reason, /Ancien ticket/);
});

test('transient and auth failures retained with reason; concurrent flush and enqueue do not lose or double-send', async () => {
  const { lib, api, identity } = setup(); identity('http://server', 1);
  for (const status of [401, 408, 429, 503, undefined]) {
    lib.queueSale(entry(String(status)));
    api.post = async () => { throw { response: status ? { status } : undefined }; };
    await lib.flushPendingSales(); assert.ok(lib.pendingSales().every(row => row.reason)); assert.equal(lib.rejectedSales().length, 0);
  }
  let release, calls = 0;
  api.post = async (_path, payload, options) => { assert.equal(payload.cash_session_id, 42); assert.equal(options.timeout, 15000); calls++; if (calls === 1) await new Promise(resolve => { release = resolve; }); return { data: {} }; };
  const first = lib.flushPendingSales(), second = lib.flushPendingSales();
  lib.queueSale(entry('during-send')); release(); await Promise.all([first, second]);
  assert.equal(calls, 5); assert.equal(lib.pendingSales()[0].payload.client_id, 'during-send');
  await lib.flushPendingSales(); assert.equal(calls, 6); assert.equal(lib.pendingSales().length, 0);
  assert.equal((await lib.flushPendingSales()).synced, 0);
});

test('business refusal retained as readable rejection', async () => {
  const { lib, api, identity } = setup(); identity('http://server', 1); lib.queueSale(entry('stock'));
  api.post = async () => { throw { response: { status: 409, data: { detail: 'Stock insuffisant' } } }; };
  await lib.flushPendingSales(); assert.equal(lib.pendingSales().length, 0); assert.equal(lib.rejectedSales()[0].reason, 'Stock insuffisant');
});

test('network health retries even when already online and never flushes without authenticated cache', async () => {
  const { lib, api, identity, localStorage, window, load } = setup(); identity('http://server', 1);
  let effects = [], supplied, requests = 0, fail = true;
  const react = { createContext: () => ({ Provider: 'provider' }), useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: fn => effects.push(fn), useContext() {} };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/context/NetworkContext.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: path => path === 'react' ? react : path === 'react/jsx-runtime' ? { jsx: (_type, props) => { supplied = props.value; } } : path === 'axios' ? { __esModule: true, default: { get: async () => ({ data: { status: 'ok', app: 'EasyGest' } }) } } : path === '../api/client' ? { __esModule: true, default: api, getServerUrl: () => 'http://server' } : path === '../lib/offline' ? lib : load(path.split('/').at(-1)), localStorage, window, Event });
  exports.NetworkProvider({ children: null });
  await supplied.refresh(); lib.queueSale(entry('retry'));
  api.post = async () => { requests++; if (fail) throw Error('network'); return { data: {} }; };
  await supplied.refresh(); assert.equal(lib.pendingSales().length, 1);
  fail = false; await supplied.refresh(); assert.equal(lib.pendingSales().length, 0); assert.equal(requests, 2);
  localStorage.setItem('ri_token', ''); lib.queueSale(entry('after-logout')); await supplied.refresh(); assert.equal(requests, 2);
});

test('dashboard calendar filter uses the local calendar day rather than UTC conversion', () => {
  const source = readFileSync(`${__dirname}/src/pages/Dashboard.tsx`, 'utf8').match(/function isoDay\(date: Date\): string \{[\s\S]*?\n\}/)[0];
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source + '\nexports.isoDay = isoDay;', {}).outputText, { exports });
  assert.equal(exports.isoDay({ getFullYear: () => 2026, getMonth: () => 0, getDate: () => 1, toISOString: () => '2025-12-31T23:30:00Z' }), '2026-01-01');
});
