const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
function load(path, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, name); return imports[name]; }, ...globals });
  return exports;
}
const navigation = load("lib/productNavigation.ts");
test("French product name sorting ignores case/accents and details follow the whole sorted list", () => {
  const { sortProducts } = load("lib/productSort.ts");
  const rows = [{ id: 1, name: "Zoo" }, { id: 2, name: "Éclair" }, { id: 3, name: "eclair" }, { id: 4, name: "banane" }, { id: 5, name: "Àbricot" }];
  const ascending = sortProducts(rows, "name_asc");
  assert.deepEqual(Array.from(ascending, (p) => p.id), [5, 4, 2, 3, 1]);
  assert.deepEqual(Array.from(sortProducts(rows, "name_desc"), (p) => p.id), [1, 2, 3, 4, 5]);
  assert.equal(navigation.productStep(ascending, 4, 1), 2);
  assert.equal(navigation.productStep(ascending, 5, -1), null);
  assert.equal(navigation.productStep(ascending, 1, 1), null);
  assert.deepEqual(rows.map((p) => p.id), [1, 2, 3, 4, 5]);
});
test("product creation sorting uses timestamps, preserves default order and handles empty lists", () => {
  const { sortProducts } = load("lib/productSort.ts");
  const rows = [{ id: 10, name: "A", created_at: "2026-01-01T00:00:00Z" }, { id: 2, name: "B", created_at: "2028-01-01T00:00:00Z" }, { id: 8, name: "C", created_at: "2024-01-01T00:00:00Z" }];
  assert.deepEqual(Array.from(sortProducts(rows, "created_asc"), (p) => p.id), [8, 10, 2]);
  assert.deepEqual(Array.from(sortProducts(rows, "created_desc"), (p) => p.id), [2, 10, 8]);
  assert.deepEqual(Array.from(sortProducts(rows, "default"), (p) => p.id), [10, 2, 8]);
  assert.equal(sortProducts([], "name_asc").length, 0);
  assert.deepEqual(Array.from(sortProducts([rows[0]], "created_desc"), (p) => p.id), [10]);
  assert.deepEqual(Array.from(sortProducts([{ id: 2, name: "A", created_at: "bad" }, { id: 1, name: "B" }], "created_asc"), (p) => p.id), [1, 2]);
});
test("product sort preference persists locally and safely defaults on invalid or blocked storage", () => {
  const storage = new Map();
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const sort = load("lib/productSort.ts", {}, { localStorage });
  assert.equal(sort.readProductSort(), "default");
  for (const value of ["created_asc", "created_desc", "name_asc", "name_desc", "default"]) {
    sort.saveProductSort(value);
    assert.equal(load("lib/productSort.ts", {}, { localStorage }).readProductSort(), value);
  }
  for (const value of ["", "bad", "null"]) { storage.set("ri_products_sort", value); assert.equal(sort.readProductSort(), "default"); }
  const blocked = load("lib/productSort.ts", {}, { localStorage: { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } } });
  assert.equal(blocked.readProductSort(), "default");
  assert.doesNotThrow(() => blocked.saveProductSort("name_asc"));
});
test("product navigation respects filtered ordering, empty/missing items and both boundaries", () => {
  const rows = [{ id: 9 }, { id: 2 }, { id: 7 }];
  assert.equal(navigation.productStep(rows, 9, -1), null);
  assert.equal(navigation.productStep(rows, 9, 1), 2);
  assert.equal(navigation.productStep(rows, 2, -1), 9);
  assert.equal(navigation.productStep(rows, 2, 1), 7);
  assert.equal(navigation.productStep(rows, 7, 1), null);
  assert.equal(navigation.productStep([], 7, 1), null);
  assert.equal(navigation.productStep(rows, 99, -1), null);
  assert.equal(navigation.productStep([{ id: 2 }], 2, 1), null);
});
test("panel size persistence clamps saved dimensions, survives storage errors and resets", () => {
  const saved = new Map();
  const localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  const panel = load("lib/panelSize.ts", {}, { localStorage });
  assert.equal(panel.readPanel("cart", 420, 280, 760), 420);
  panel.savePanel("cart", 900); assert.equal(panel.readPanel("cart", 420, 280, 760), 760);
  panel.savePanel("cart", 10); assert.equal(panel.readPanel("cart", 420, 280, 760), 280);
  panel.savePanel("cart", 500); assert.equal(panel.readPanel("cart", 420, 280, 760), 500);
  assert.equal(panel.readPanel("checkout", 250, 200, 600), 250);
  for (const invalid of ["NaN", "Infinity", "-5", "", "junk"]) { localStorage.setItem("cart", invalid); assert.equal(panel.readPanel("cart", 420, 280, 760), 420); }
  panel.savePanel("cart", null); assert.equal(saved.has("cart"), false);
  assert.equal(panel.clampPanel(800, 200, 350), 350);
  assert.equal(panel.clampPanel(100, 200, 350), 200);
  assert.equal(panel.clampPanel(NaN, 200, 350), 200);
  const unavailable = load("lib/panelSize.ts", {}, { localStorage: { getItem() { throw Error("blocked"); } } });
  assert.equal(unavailable.readPanel("cart", 420, 280, 760), 420);
  assert.doesNotThrow(() => unavailable.savePanel("cart", 500));
});
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
test("resize handles capture mouse/touch, enforce bounds, cancel cleanly and reset", () => {
  const panel = load("lib/panelSize.ts");
  const Handle = load("components/ResizeHandle.tsx", { react: { useRef: () => ({ current: null }) }, "react/jsx-runtime": jsx, "../lib/panelSize": panel }).default;
  for (const axis of ["x", "y"]) {
    const values = []; let resets = 0; let captured = false;
    const handle = Handle({ axis, label: "Taille", value: 300, min: 200, max: 500, onChange: (n) => values.push(n), onReset: () => resets++ }).props;
    const target = { focus() {}, setPointerCapture() { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture() { captured = false; } };
    const event = { isPrimary: true, button: 0, pointerId: 1, clientX: 500, clientY: 500, currentTarget: target, preventDefault() {} };
    handle.onPointerDown(event); assert.equal(captured, true);
    handle.onPointerMove({ clientX: 100, clientY: 100 }); assert.equal(values.at(-1), 500);
    handle.onPointerMove({ clientX: 1000, clientY: 1000 }); assert.equal(values.at(-1), 200);
    handle.onPointerUp(event); assert.equal(captured, false);
    const length = values.length; handle.onPointerMove(event); assert.equal(values.length, length);
    handle.onPointerDown(event); handle.onPointerCancel(); handle.onPointerMove(event); assert.equal(values.length, length);
    handle.onKeyDown({ key: axis === "x" ? "ArrowLeft" : "ArrowUp", preventDefault() {} }); assert.equal(values.at(-1), 320);
    handle.onDoubleClick(); handle.onKeyDown({ key: "Home", preventDefault() {} }); assert.equal(resets, 2);
    assert.match(handle.className, /hidden.*touch-none.*md:block/);
  }
});
function content(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(content).join(" ");
  if (typeof node !== "object") return String(node);
  return content(node.props?.children) + " " + content(node.props?.footer);
}
function mountDetails(permissions, result = []) {
  const states = []; let cursor = 0; const effects = []; const listeners = new Map(); const moves = [];
  const react = { useState: (initial) => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], (value) => { states[index] = value; }]; }, useEffect: (effect) => effects.push(effect) };
  const rows = [{ id: 3, name: "Riz", sku: "RIZ", quantity: 12, purchase_price: 111, stock_value: 1332, packagings: [], barcodes: [], active: true }, { id: 8, name: "Savon", sku: "SAVON", quantity: 0 }];
  const requested = [];
  const Details = load("components/ProductDetails.tsx", { react, "react/jsx-runtime": jsx, "../api/client": { __esModule: true, default: { get: (url) => { requested.push(url); return result instanceof Error ? Promise.reject(result) : Promise.resolve({ data: result }); } }, formatDate: String, formatXOF: String }, "../context/AuthContext": { useAuth: () => ({ can: (p) => permissions.includes(p) }) }, "../lib/productNavigation": navigation, "./DepotStock": { default: "DepotStock" }, "./Modal": { default: "Modal" } }, { window: { addEventListener: (key, callback) => listeners.set(key, callback), removeEventListener: (key) => listeners.delete(key) }, HTMLElement: class {} }).default;
  const render = (productId = 3) => { cursor = 0; return Details({ products: rows, productId, onNavigate: (id) => moves.push(id), onClose() {}, onEdit() {} }); };
  return { render, effects, listeners, moves, requested };
}
test("product sheet uses fullscreen modal, gates costs/editing and supports keyboard navigation", () => {
  const mounted = mountDetails([]); const tree = mounted.render();
  assert.equal(tree.props.fullscreen, true);
  assert.doesNotMatch(content(tree), /Prix d'achat|Valeur stock|Modifier/);
  assert.equal(tree.props.footer.props.children[0].props.disabled, true);
  assert.equal(tree.props.footer.props.children[2].props.disabled, false);
  const cleanups = mounted.effects.map((effect) => effect());
  const key = mounted.listeners.get("keydown");
  key({ key: "ArrowRight", preventDefault() {} }); assert.deepEqual(mounted.moves, [8]);
  key({ key: "ArrowLeft", preventDefault() { throw Error("boundary"); } });
  key({ key: "ArrowRight", ctrlKey: true }); assert.deepEqual(mounted.moves, [8]);
  assert.equal(mounted.render(8).props.footer.props.children[2].props.disabled, true);
  for (const cleanup of cleanups) cleanup?.();
  assert.equal(mounted.listeners.size, 0);
  assert.deepEqual(mounted.requested, []);
  const allowed = mountDetails(["rapports_financiers", "produits_gerer"]);
  assert.match(content(allowed.render()), /Prix d'achat.*111/);
  assert.match(content(allowed.render()), /Modifier/);
});
test("product lots show empty, success and error states without leaving stale fetches", async () => {
  for (const [result, expected] of [[[], /Aucun lot enregistré/], [[{ id: 1, lot_number: "LOT-1", quantity: 2, expiry_date: "2027-01-01", days_left: 3 }], /LOT-1/], [Error("offline"), /Lots indisponibles/]]) {
    const mounted = mountDetails(["produits"], result); mounted.render();
    const cleanups = mounted.effects.map((effect) => effect());
    await new Promise(setImmediate);
    assert.match(content(mounted.render()), expected);
    assert.deepEqual(mounted.requested, ["/products/3/lots"]);
    for (const cleanup of cleanups) cleanup?.();
  }
});
