const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(path, imports, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name) => {
    assert.ok(name in imports, `unexpected import ${name}`);
    return { __esModule: true, ...imports[name] };
  }, ...globals });
  return exports;
}

function offline(post) {
  const storage = new Map();
  const code = load("lib/offline.ts", { "../api/client": { default: { post } } }, {
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
    "../lib/offline": { pendingSales: () => [], rejectedSales: () => [], flushPendingSales: async () => { replayed += 1; return { synced: 0, rejected: [] }; } },
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
