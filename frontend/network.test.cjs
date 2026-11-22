const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const authStorage = () => { const data = new Map([["ri_token", "token"], ["ri_auth_cache", JSON.stringify({ token: "token", user: { id: 1 }, rights: [] })]]); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
const verifiedApi = { get: async path => ({ data: path === "/auth/me" ? { id: 1, role: "vendeur" } : { allowed: [] } }) };

function load(path, imports, globals = {}) {
  imports = { "./desktopOffline": { desktopOffline: { available: () => false } }, "../lib/desktopOffline": { desktopOffline: { available: () => false } }, "../lib/authCache": loadAuth(), ...imports };
  if (imports["../api/client"] && !imports["../api/client"].default) imports["../api/client"].default = verifiedApi;
  const exports = {};
  const source = ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name) => {
    assert.ok(name in imports, `unexpected import ${name}`);
    return { __esModule: true, ...imports[name] };
  }, crypto: require("node:crypto").webcrypto, localStorage: authStorage(), ...globals });
  return exports;
}

function loadAuth() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/authCache.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, localStorage: authStorage() });
  return exports;
}

function offline(post) {
  const storage = new Map();
  const code = load("lib/offline.ts", { "../api/client": { default: { post } }, "./apiErrors": load("lib/apiErrors.ts", {}) }, {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: { dispatchEvent() {} }, Event: class {},
  });
  return { code, storage };
}

test("offline replay keeps one client id after network failure", async () => {
  const ids = [];
  const { code } = offline(async (_, payload) => { ids.push(payload.client_id); if (ids.length === 1) throw new Error("offline"); });
  code.queueSale({ payload: {}, snapshot: { reference: "pending" } });
  await code.flushPendingSales();
  await code.flushPendingSales();
  assert.ok(ids[0]);
  assert.equal(ids[0], ids[1]);
  assert.equal(code.pendingSales().length, 0);
});

test("old queue entries gain a persisted id; pending approval never rejects them", async () => {
  const { code, storage } = offline(async () => { throw { response: { status: 403, data: { code: "workstation_not_authorized" } } }; });
  storage.set("ri_pending_sales", JSON.stringify([{ payload: {}, snapshot: { reference: "old" } }]));
  await code.flushPendingSales();
  assert.ok(code.pendingSales()[0].payload.client_id);
  assert.equal(code.rejectedSales().length, 0);
});

test("empty offline queue makes no request", async () => {
  let requests = 0;
  const { code } = offline(async () => { requests += 1; });
  await code.flushPendingSales();
  assert.equal(requests, 0);
});

test("health probe uses latest server URL and waits for approval before replay", async () => {
  let base = "http://first:8000";
  let status = "pending";
  let replayed = 0;
  const urls = [];
  const code = load("context/NetworkContext.tsx", {
    "react/jsx-runtime": { jsx: (_, props) => props },
    react: { createContext: () => ({ Provider: {} }), useState: (value) => [value, () => {}], useRef: (current) => ({ current }), useCallback: (fn) => fn, useEffect() {} },
    axios: { default: { get: async (url) => { urls.push(url); return { data: { status: "ok", app: "EasyGest", workstation_status: status } }; } } },
    "../api/client": { getServerUrl: () => base },
    "../lib/offline": { pendingSales: () => [], pendingProducts: () => [], flushPendingProducts: async () => ({ synced: 0, rejected: [] }), rejectedSales: () => [], flushPendingSales: async () => { replayed += 1; return { synced: 0, rejected: [] }; } },
  }, { window: { setTimeout() {}, dispatchEvent() {} }, Event: class {} });
  const provider = code.NetworkProvider({ children: null });
  assert.equal(await provider.value.refresh(), false);
  assert.equal(replayed, 0);
  base = "http://second:8000";
  status = "approved";
  assert.equal(await provider.value.refresh(), true);
  assert.equal(replayed, 1);
  assert.deepEqual(urls, ["http://first:8000/api/health", "http://second:8000/api/health"]);
});

test("product conflict errors and counts follow the queue and clear after correction", async () => {
  const states = [], effects = [], listeners = {}; let cursor = 0;
  let products = [{ payload: { sku: "CONFLICT" }, reason: "Cette référence existe déjà" }];
  const code = load("context/NetworkContext.tsx", {
    "react/jsx-runtime": { jsx: (_, props) => props },
    react: { createContext: () => ({ Provider: {} }), useState: (value) => { const index = cursor++; states[index] = value; return [value, (next) => { states[index] = next; }]; }, useRef: (current) => ({ current }), useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn) },
    axios: { default: { get: async () => ({ data: { status: "ok", app: "EasyGest" } }) } },
    "../api/client": { getServerUrl: () => "http://test" },
    "../lib/offline": { pendingSales: () => [], pendingProducts: () => products, rejectedSales: () => [], flushPendingProducts: async () => ({ synced: 0, rejected: [] }), flushPendingSales: async () => ({ synced: 0, rejected: [] }) },
  }, { window: { setTimeout() {}, setInterval() {}, clearInterval() {}, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {}, dispatchEvent() {} }, Event: class {} });
  const provider = code.NetworkProvider({ children: null }); effects.forEach((fn) => fn());
  await provider.value.refresh();
  assert.match(states[6][0], /CONFLICT.*existe déjà/); assert.equal(states[4], 1);
  products = []; listeners["ri:queue"]();
  assert.equal(states[6].length, 0); assert.equal(states[4], 0);
});
