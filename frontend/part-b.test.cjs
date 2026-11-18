const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(path, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, name); return imports[name]; }, setTimeout, clearTimeout, ...globals });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const storage = new Map();
const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const columns = load("lib/stockColumns.ts", {}, { localStorage });
const products = [{ id: 1, quantity: 125, base_unit: "pcs", packaging_unit: "Carton", units_per_packaging: 12,
  packagings: [{ name: "Colis", factor: 24, active: true }, { name: "Ancien", factor: 8, active: false }] },
  { id: 2, quantity: 20, packagings: [{ name: "Chapelet", factor: 5, active: true }] }];

test("stock columns discover active names, exact packs, remainders and absent/negative stock", () => {
  assert.deepEqual(plain(columns.stockColumns(products, true)).map((c) => c.key), ["article", "reference", "quantity", "pack:carton", "pack:colis", "pack:chapelet", "purchase", "value", "expiry"]);
  assert.equal(columns.packagingStock(products[0], "carton"), "10 + 5 pcs");
  assert.equal(columns.packagingStock({ ...products[0], quantity: 120 }, "carton"), "10");
  assert.equal(columns.packagingStock(products[1], "carton"), "");
  assert.equal(columns.packagingStock({ ...products[0], quantity: null }, "carton"), "");
  assert.equal(columns.packagingStock({ ...products[0], quantity: -125 }, "carton"), "-10 − 5 pcs");
  assert.equal(columns.packagingStock({ ...products[0], quantity: 0 }, "carton"), "0");
  assert.deepEqual(plain(columns.stockColumns([], false)).map((c) => c.key), ["article", "reference", "quantity", "expiry"]);
  assert.deepEqual(plain(columns.stockColumns(products, true, true)).map((c) => c.key), ["article", "reference", "purchase", "expiry"]);
});

test("column preferences isolate users and tables and ignore corrupted values", () => {
  storage.clear();
  const key = columns.stockColumnKey(1, "products");
  localStorage.setItem(key, JSON.stringify({ quantity: false, purchase: "yes", evil: 3 }));
  assert.deepEqual(plain(columns.readStockColumns(key)), { quantity: false });
  assert.deepEqual(plain(columns.readStockColumns(columns.stockColumnKey(2, "products"))), {});
  assert.deepEqual(plain(columns.readStockColumns(columns.stockColumnKey(1, "inventory"))), {});
  for (const raw of ["null", "[]", "broken"]) { localStorage.setItem(key, raw); assert.deepEqual(plain(columns.readStockColumns(key)), {}); }
});

test("automatic receipt defaults ON, preserves OFF, and requires a configured printer", () => {
  storage.clear();
  const poste = load("lib/poste.ts", {}, { localStorage, window: { dispatchEvent() {} }, Event: class {} });
  assert.equal(poste.readPosteSettings().receipt_auto_return, true);
  poste.writePosteSettings({ ...poste.readPosteSettings(), receipt_auto_return: false });
  assert.equal(poste.readPosteSettings().receipt_auto_return, false);
  const { automaticReceipt } = load("lib/autoReceipt.ts");
  assert.equal(automaticReceipt(true, "EPSON"), true);
  for (const printer of [undefined, "", "   "]) assert.equal(automaticReceipt(true, printer), false);
  assert.equal(automaticReceipt(false, "EPSON"), false);
});

test("printer debounce deduplicates retries, not separate saved sales", async () => {
  const runner = load("lib/printJob.ts").createPrintRunner();
  let calls = 0;
  await runner.run(async () => calls++, () => {}, "sale-1");
  await runner.run(async () => calls++, () => {}, "sale-2");
  await runner.run(async () => calls++, () => {}, "sale-2");
  assert.equal(calls, 2);
});

function mountAutomatic(runner, printReceipt) {
  const slots = [], deps = [];
  let cursor = 0, effects = [], done = 0, drawer = 0, removed = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useSyncExternalStore: (_subscribe, read) => read(),
    useRef: (value) => { const index = cursor++; return slots[index] ??= { current: value }; },
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useEffect: (effect, values) => { const index = cursor++; if (!deps[index] || values.some((value, i) => value !== deps[index][i])) effects.push(effect); deps[index] = values; },
  };
  const Component = load("components/AutomaticReceipt.tsx", {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "../lib/print": { printReceipt }, "../lib/printJob": { receiptPrintRunner: runner }, "./Receipt": { default() {} },
  }, { document: { getElementById: () => ({ cloneNode: () => ({ style: { removeProperty() {} }, querySelectorAll: () => [], remove() { removed++; } }) }), body: { appendChild() {} } } }).default;
  return { render(reference = "S-1", id = 1) {
    cursor = 0; effects = [];
    const tree = Component({ sale: { reference, id }, config: { width: "80mm", printer_name: "EPSON" }, kick: [27],
      onPrinted() { drawer++; }, onDone() { done++; } });
    for (const effect of effects) effect();
    return tree;
  }, get done() { return done; }, get drawer() { return drawer; }, get removed() { return removed; } };
}
const settle = () => new Promise(setImmediate);

test("pending reception matches inactive articles and refuses missing, empty, corrupt or unavailable catalogues without acknowledging", async () => {
  const page = readFileSync(`${__dirname}/src/pages/Inventaire.tsx`, "utf8");
  const source = page.slice(page.indexOf("  async function receivePending("), page.indexOf("  /** Registers the transfer:"));
  for (const scenario of ["complete", "missing", "empty", "corrupt", "network"]) {
    const errors = [], messages = [], posts = [], saving = [];
    let loads = 0, reads = 0;
    const exports = {};
    const api = {
      async get(path, options) {
        reads++; assert.equal(path, "/products"); assert.equal(options.params.state, "all");
        if (scenario === "network") throw new Error("Déconnecté");
        return { data: [{ id: 1, name: "Actif", active: true }, ...(scenario === "missing" ? [] : [{ id: 2, name: "Désactivé", active: false }])] };
      },
      async post(path, payload) { posts.push({ path, payload: plain(payload) }); },
    };
    vm.runInNewContext(ts.transpileModule(source + "\nexports.receivePending = receivePending;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, api, products: [{ id: 1, name: "Actif", active: true }], setError: (value) => errors.push(value), setMessage: (value) => messages.push(value),
        setSaving: (value) => saving.push(value), load: async () => { loads++; }, axios: { isAxiosError: () => false } });
    await exports.receivePending({ id: 42, reference: "TFR-42", from_shop: "Autre magasin", note: "Envoi", items: scenario === "corrupt" ? "bad JSON" : JSON.stringify(scenario === "empty" ? [] : [{ product_name: " actif ", quantity: 3 }, { product_name: "Désactivé", quantity: 5 }]) });
    if (scenario === "complete") {
      assert.equal(reads, 1); assert.equal(posts.length, 1); assert.equal(posts[0].path, "/transfers/recevoir");
      assert.deepEqual(posts[0].payload.items, [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 5 }]);
      assert.equal(loads, 1); assert.match(messages.at(-1), /enregistrée/);
    } else {
      assert.equal(posts.length, 0); assert.equal(loads, 0); assert.match(errors.at(-1), /en attente/);
    }
    if (saving.length) assert.equal(saving.at(-1), false);
  }
});

test("pending reception prefers active Riz id 2 over inactive namesake id 1 listed first", async () => {
  const page = readFileSync(`${__dirname}/src/pages/Inventaire.tsx`, "utf8");
  const source = page.slice(page.indexOf("  async function receivePending("), page.indexOf("  /** Registers the transfer:"));
  const posts = [], errors = [];
  const exports = {};
  const api = {
    async get(path, options) {
      assert.equal(path, "/products");
      assert.equal(options.params.state, "all");
      return { data: [{ id: 1, name: "Riz", sku: "RIZ-ANCIEN", active: false }, { id: 2, name: "Riz", sku: "RIZ-ACTIF", active: true }] };
    },
    async post(path, payload) { posts.push({ path, payload: plain(payload) }); },
  };
  vm.runInNewContext(ts.transpileModule(source + "\nexports.receivePending = receivePending;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, api, setError: (value) => errors.push(value), setMessage() {}, setSaving() {}, load: async () => {}, axios: { isAxiosError: () => false } });
  await exports.receivePending({ id: 42, reference: "TFR-42", from_shop: "Autre magasin", note: "Envoi", items: JSON.stringify([{ product_name: "Riz", quantity: 5 }]) });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, "/transfers/recevoir");
  assert.deepEqual(posts[0].payload.items, [{ product_id: 2, quantity: 5 }]);
  assert.deepEqual(errors, [""]);
});

test("automatic printing has no modal, keeps error and retries without recreating a sale or drawer kick", async () => {
  const runner = load("lib/printJob.ts").createPrintRunner(30000, 0);
  let calls = 0;
  const kicks = [];
  const mounted = mountAutomatic(runner, async (_format, _config, kick, options) => { calls++; kicks.push(kick); assert.equal(options.controlled, true); if (calls === 1) throw new Error("Hors ligne"); return true; });
  mounted.render(); await settle();
  let tree = mounted.render();
  assert.equal(tree.props.children[0].props.role, "alert");
  assert.equal(mounted.done, 0);
  assert.equal(mounted.removed, 1);
  mounted.render(); await settle(); assert.equal(calls, 1);
  const retry = tree.props.children[0].props.children[1];
  assert.equal(retry.props.children, "Réimprimer");
  retry.props.onClick(); mounted.render(); await settle();
  assert.equal(mounted.done, 1);
  assert.equal(mounted.drawer, 1);
  assert.deepEqual(plain(kicks), [[27], []]);
});

test("two consecutive sales wait for the printer without blocking the next cart", async () => {
  const runner = load("lib/printJob.ts").createPrintRunner(30000, 0);
  let release, calls = 0;
  const first = mountAutomatic(runner, () => { calls++; return new Promise((resolve) => { release = resolve; }); });
  const second = mountAutomatic(runner, async () => { calls++; return false; });
  first.render("HORS-LIGNE-12:00:00", -1); await settle(); second.render("HORS-LIGNE-12:00:00", -2);
  assert.equal(calls, 1);
  release(true); await settle(); second.render("HORS-LIGNE-12:00:00", -2); await settle();
  assert.equal(calls, 2); assert.equal(first.done, 1); assert.equal(second.done, 1);
});

test("light contrast overrides are screen-only and explicitly exclude dark mode", () => {
  const css = readFileSync(`${__dirname}/src/index.css`, "utf8").replace(/\r\n/g, "\n");
  const block = css.slice(css.indexOf("@media screen"), css.indexOf("html,\n"));
  assert.match(block, /html:not\(\.dark\) \.text-slate-400/);
  assert.match(block, /input::placeholder/);
  assert.match(block, /font-size: 0.75rem/);
  assert.doesNotMatch(block, /html\.dark/);
});
