const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(path, imports = {}, globals = {}, source) {
  const exports = {};
  const code = ts.transpileModule(source ?? readFileSync(`${__dirname}/src/${path}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => {
    assert.ok(name in imports, `unexpected import ${name}`);
    return { __esModule: true, ...imports[name] };
  }, ...globals });
  return exports;
}

const prices = load("lib/purchasePrices.ts");
const products = [
  { id: 1, name: "Riz", packaging_unit: "Carton", prices: { purchase_price: 40, sale_price: 100, wholesale_price: 80, packaging_sale_price: 1100 },
    packagings: [{ id: 7, name: "Colis", prices: { price_detail: 2100, price_semi_gros: null, price_gros: 1800, purchase_price: 1000 } }] },
  { id: 2, name: "Savon", packaging_unit: "", prices: { purchase_price: 10, sale_price: 20, wholesale_price: 15 }, packagings: [] },
];
const plain = (value) => JSON.parse(JSON.stringify(value));

test("receipt price drafts keep prices by default and collect multiple articles/packagings without changing originals", () => {
  assert.deepEqual(plain(prices.proposedPrices(products, {})), []);
  assert.deepEqual(plain(prices.proposedPrices([], { "1:base:sale_price": "125" })), []);
  const changes = plain(prices.proposedPrices(products, {
    "1:base:sale_price": "125", "1:base:purchase_price": "40", "1:7:price_detail": "2300",
    "1:7:price_semi_gros": "0", "1:7:price_gros": "", "2:base:sale_price": "25",
  }));
  assert.equal(changes.length, 5);
  assert.deepEqual(changes[0], { product_id: 1, packaging_id: null, field: "sale_price", old_value: 100, new_value: 125 });
  assert.equal(changes.find((c) => c.field === "price_semi_gros").new_value, 0);
  assert.equal(changes.find((c) => c.field === "price_gros").new_value, null);
  assert.equal(changes.at(-1).product_id, 2);
  assert.equal(products[0].prices.sale_price, 100);
  for (const value of ["-1", "NaN", "Infinity", "bad", ""]) {
    assert.throws(() => prices.proposedPrices(products, { "1:base:sale_price": value }));
  }
});

function mountReview(get, editable = true) {
  const slots = [], dependencies = [];
  let cursor = 0, effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) effects.push(effect);
      dependencies[index] = deps;
    },
  };
  const jsx = (type, props) => ({ type, props });
  const Component = load("components/PurchasePriceReview.tsx", {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "../api/client": { default: { get }, formatXOF: (value) => `${value} F` },
    "../lib/purchasePrices": prices,
  }).default;
  const ready = [], changes = [];
  const props = { purchaseId: 12, editable, onReady: (value) => ready.push(value), onChange: (value) => changes.push(plain(value)) };
  return { ready, changes, render() {
    cursor = 0; effects = [];
    const root = Component(props);
    effects.forEach((effect) => effect());
    return root;
  } };
}

function nodes(root) {
  if (Array.isArray(root)) return root.flatMap(nodes);
  return root && typeof root === "object" ? [root, ...nodes(root.props?.children)] : [];
}

function textContent(root) {
  if (Array.isArray(root)) return root.map(textContent).join("");
  return root && typeof root === "object" ? textContent(root.props?.children) : root == null || typeof root === "boolean" ? "" : String(root);
}

test("inline receipt review shows old/new, edits several articles, resets Garder and blocks invalid confirmation", async () => {
  const review = mountReview(async () => ({ data: products }));
  review.render();
  assert.equal(review.ready.at(-1), false);
  await new Promise(setImmediate);
  let root = review.render();
  assert.equal(review.ready.at(-1), true);
  assert.match(textContent(root), /Ancien : 100 F → Garder/);
  const input = (name) => nodes(root).find((node) => node.type === "input" && node.props["aria-label"] === name);
  input("Riz Article Détail pièce nouveau").props.onChange({ target: { value: "125" } });
  root = review.render();
  input("Savon Article Détail pièce nouveau").props.onChange({ target: { value: "25" } });
  root = review.render();
  assert.equal(review.changes.at(-1).length, 2);
  assert.match(textContent(root), /Ancien : 100 F → Modifier/);
  input("Riz Article Détail pièce nouveau").props.onChange({ target: { value: "" } });
  root = review.render();
  assert.equal(review.ready.at(-1), false);
  nodes(root).find((node) => node.type === "button" && textContent(node).includes("Garder tous")).props.onClick();
  root = review.render();
  assert.equal(review.ready.at(-1), true);
  assert.equal(review.changes.at(-1).length, 1);
  assert.equal(review.changes.at(-1)[0].product_id, 2);
});

test("receipt review is read-only without tariff permission; empty data and fetch failures do not invent changes", async () => {
  const readonly = mountReview(async () => ({ data: products }), false);
  readonly.render(); await new Promise(setImmediate);
  const root = readonly.render();
  assert.match(textContent(root), /Lecture seule/);
  assert.ok(nodes(root).filter((node) => node.type === "input").every((node) => node.props.disabled));
  assert.equal(nodes(root).filter((node) => node.type === "button").length, 0);
  assert.deepEqual(readonly.changes.at(-1), []);
  const empty = mountReview(async () => ({ data: [] }));
  empty.render(); await new Promise(setImmediate);
  assert.equal(nodes(empty.render()).filter((node) => node.type === "input").length, 0);
  assert.equal(empty.ready.at(-1), true);
  const failure = mountReview(async () => { throw new Error("network"); });
  failure.render(); await new Promise(setImmediate);
  assert.match(textContent(failure.render()), /Impossible de charger les prix/);
  assert.equal(failure.ready.at(-1), false);
  assert.deepEqual(failure.changes.at(-1), []);
});

test("expiry UI provides every requested period and does not leak custom dates into preset filters", () => {
  const expiry = load("lib/expiry.ts");
  assert.deepEqual(plain(expiry.EXPIRY_PERIODS.map(([value]) => value)), ["expired", "7d", "1m", "2m", "3m", "4m", "9m", "all", "custom"]);
  for (const [period] of expiry.EXPIRY_PERIODS) {
    const result = expiry.expiryParams(period, "2030-01-01", "2030-02-01");
    assert.equal(result.date_from, period === "custom" ? "2030-01-01" : "");
    assert.equal(result.date_to, period === "custom" ? "2030-02-01" : "");
  }
  assert.deepEqual(plain(expiry.expiryParams("custom", "", "")), { period: "custom", date_from: "", date_to: "" });
  assert.equal(expiry.remainingExpiry(-3, -0.1), "Périmé depuis 3 j");
  assert.equal(expiry.remainingExpiry(0, 0), "0 j · ≈ 0 mois");
  assert.equal(expiry.remainingExpiry(31, 1), "31 j · ≈ 1 mois");
});

function offline(api) {
  const storage = new Map();
  const code = load("lib/offline.ts", { "../api/client": { default: api } }, {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: { dispatchEvent() {} }, Event: class {},
  });
  return { storage, code };
}

test("online and offline POS catalogues hide deactivated products and still accept old payloads", async () => {
  let fail = false;
  const data = [{ id: 1, active: true }, { id: 2, active: false }, { id: 3 }];
  const { code } = offline({ get: async () => { if (fail) throw new Error("offline"); return { data }; } });
  assert.deepEqual(plain(code.activeCatalogue([])), []);
  const fresh = await code.fetchCached("/products/pos?images=false", "catalogue");
  assert.deepEqual(plain(fresh.data.map((p) => p.id)), [1, 3]);
  assert.deepEqual(plain(code.cacheRead("catalogue").map((p) => p.id)), [1, 3]);
  code.cacheWrite("legacy", data);
  fail = true;
  const cached = await code.fetchCached("/products/pos", "legacy");
  assert.equal(cached.fromCache, true);
  assert.deepEqual(plain(cached.data.map((p) => p.id)), [1, 3]);
  await assert.rejects(code.fetchCached("/products/pos", "no-cache"), /offline/);
  fail = false;
  assert.equal((await code.fetchCached("/categories", "categories")).data.length, 3);
});

test("offline replay of an inactive product keeps a visible rejection rather than losing the sale silently", async () => {
  const { code } = offline({ post: async () => { throw { response: { status: 400, data: { detail: "Article désactivé" } } }; } });
  code.queueSale({ payload: { client_id: "inactive" }, snapshot: { reference: "HORS-LIGNE" } });
  const result = await code.flushPendingSales();
  assert.equal(result.synced, 0);
  assert.match(result.rejected[0], /désactivé/);
  assert.equal(code.pendingSales().length, 0);
  assert.equal(code.rejectedSales()[0].reason, "Article désactivé");
});

test("product activation UI checks management permission, confirms deactivation, reactivates and reports errors", async () => {
  const source = readFileSync(`${__dirname}/src/pages/Products.tsx`, "utf8").match(/  async function remove\(p: Product\) \{[\s\S]*?\n  \}/)[0];
  let allowed = false, confirmed = true, failed = false, loads = 0, confirms = 0;
  const calls = [], notices = [];
  const { remove } = load("", {}, {
    can: (key) => { assert.equal(key, "produits_gerer"); return allowed; },
    confirm: () => { confirms++; return confirmed; },
    api: { put: async (...args) => { if (failed) throw new Error("network"); calls.push(plain(args)); } },
    load: async () => { loads++; }, setNotice: (value) => notices.push(value),
  }, source + "\nexports.remove = remove;");
  await remove({ id: 1, name: "Riz", active: true });
  assert.equal(calls.length, 0); assert.equal(confirms, 0);
  allowed = true; confirmed = false;
  await remove({ id: 1, name: "Riz", active: true });
  assert.equal(calls.length, 0);
  confirmed = true;
  await remove({ id: 1, name: "Riz", active: true });
  await remove({ id: 1, name: "Riz", active: false });
  assert.deepEqual(calls, [["/products/1/activation", { active: false }], ["/products/1/activation", { active: true }]]);
  assert.equal(loads, 2);
  failed = true;
  await remove({ id: 1, name: "Riz" });
  assert.match(notices.at(-1), /Modification impossible/);
});
