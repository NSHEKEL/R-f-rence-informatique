const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const units = {};
vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/units.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: units });
const product = { id: 1, name: "Article", quantity: 200, sale_price: 100, purchase_price: 40,
  wholesale_price: 80, semi_wholesale_price: 90, semi_wholesale_min_qty: 24, wholesale_min_qty: 48,
  packaging_unit: "Carton", units_per_packaging: 12, packaging_sale_price: 1100,
  packagings: [{ id: 7, name: "Colis", factor: 24, barcode: "PACK24", active: true, price_detail: 2100, price_semi_gros: 1800, price_gros: 1500 }] };

test("additional packaging prices, mixed 51 base units and auto thresholds mirror the server", () => {
  const p = units.withPackaging(product, 7);
  assert.equal(units.withPackaging(product), product);
  assert.equal(p.units_per_packaging, 24);
  assert.equal(product.units_per_packaging, 12);
  for (const [tier, expected] of [["detail", 4500], ["semi_gros", 3870], ["gros", 3240], ["auto", 3240]]) {
    assert.ok(Math.abs(units.catalogUnitPrice(p, 51, tier, { packaging_quantity: 2, piece_quantity: 3 }) * 51 - expected) < 1e-8);
  }
  for (const [quantity, tier] of [[0, "detail"], [23, "detail"], [24, "semi_gros"], [47, "semi_gros"], [48, "gros"]]) {
    assert.equal(units.resolveTier(p, "auto", quantity), tier);
  }
  assert.equal(units.catalogPrices(p, "auto", 24).carton, 1800);
});

test("missing prices and thresholds, explicit zero and old products remain compatible", () => {
  const p = units.withPackaging({ ...product, semi_wholesale_price: null, packagings: [{ ...product.packagings[0], price_detail: null, price_semi_gros: null, price_gros: null }] }, 7);
  assert.equal(units.catalogPrices(p, "detail").carton, 2400);
  assert.equal(units.catalogPrices(p, "semi_gros").carton, 2400);
  assert.equal(units.catalogPrices(p, "gros").carton, 1920);
  assert.equal(units.catalogPrices({ ...p, semi_wholesale_price: 0 }, "semi_gros").carton, 0);
  assert.equal(units.catalogPrices({ ...p, wholesale_price: 0 }, "gros").carton, 2400);
  assert.equal(units.catalogPrices({ sale_price: 100, packaging_sale_price: 1100, units_per_packaging: 12 }, "gros").carton, 1100);
  assert.equal(units.resolveTier({}, "auto", 9999), "detail");
  assert.equal(units.withPackaging(product, 999), product);
});

test("POS scanning adds one packaging and keeps packaging and tier identities separate", () => {
  const scan = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/scan.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: scan });
  const source = readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, "utf8");
  const file = ts.createSourceFile("NouvelleVente.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ["linePrice", "cartParts", "submitSearch", "setPackaging"].includes(node.name?.text)) functions.push(node.getText(file));
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "addToCart") functions.push(`const addToCart = ${node.initializer.arguments[0].getText(file)};`);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(functions.length, 5);
  const poste = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/poste.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: poste });
  const state = { ...units, ...scan, cart: [], priceMode: "auto", product, products: [product], filtered: [], query: "PACK24", stockLimit: (p) => p.quantity, window: { setTimeout() {} }, setFlash() {}, error: "" };
  state.scanValue = (raw) => poste.scanValue(raw, poste.DEFAULT_POSTE);
  state.setCart = (change) => { state.cart = change(state.cart); };
  state.setError = (error) => { state.error = error; };
  state.lastAdded = { current: null };
  state.setSelectedLine = (index) => { state.selectedLine = index; };
  state.setQuery = (query) => { state.query = query; };
  const context = vm.createContext(state);
  vm.runInContext(ts.transpileModule(functions.join("\n"), {}).outputText, context);
  const run = (code) => vm.runInContext(code, context);
  run("submitSearch()");
  assert.equal(state.cart[0].packaging_id, 7);
  assert.equal(state.cart[0].quantity, 24);
  assert.equal(run('linePrice(cart[0], "auto") * 24'), 1800);
  state.query = "pack24";
  run("submitSearch()");
  assert.equal(state.cart.length, 1);
  assert.equal(state.cart[0].quantity, 48);
  assert.equal(run('linePrice(cart[0], "auto") * 48'), 3000);
  run("addToCart(product)");
  state.priceMode = "gros";
  run("addToCart(product, 7)");
  assert.equal(state.cart.length, 3);
  assert.deepEqual(Array.from(state.cart, (line) => line.quantity), [48, 1, 24]);
  run("setPackaging(2)");
  assert.equal(state.cart[2].product.units_per_packaging, 12);
  assert.equal(state.cart[2].packaging_id, undefined);
  assert.equal(state.cart[2].quantity, 12);
});

test("packaging editor renders empty, editable and deactivated rows without deletion", () => {
  const output = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/components/ProductPackagings.tsx`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports: output, require });
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const render = (value) => renderToStaticMarkup(React.createElement(output.default, { value, onChange() {} }));
  assert.match(render([]), /Ajouter un conditionnement/);
  assert.match(render(product.packagings), /PACK24/);
  assert.match(render(product.packagings), /Prix semi-gros/);
  assert.match(render([{ ...product.packagings[0], active: false }]), /Réactiver/);
});

test("product form rejects invalid packaging and threshold values before sending", async () => {
  const source = readFileSync(`${__dirname}/src/pages/Products.tsx`, "utf8");
  const file = ts.createSourceFile("Products.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let save;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "save") save = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(save);
  for (const changes of [
    { packagings: [{ ...product.packagings[0], name: " " }] },
    { packagings: [{ ...product.packagings[0], factor: 0 }] },
    { packagings: [{ ...product.packagings[0], price_gros: -1 }] },
    { wholesale_min_qty: 1.5 },
    { semi_wholesale_price: -1 },
  ]) {
    const state = { form: { base_unit: "pièce", quantity: 0, packaging_unit: "", packagings: [], semi_wholesale_min_qty: "", wholesale_min_qty: "", semi_wholesale_price: "", supplier_purchase_price: "", ...changes }, error: "" };
    state.setError = (error) => { state.error = error; };
    const context = vm.createContext(state);
    vm.runInContext(ts.transpileModule(save, {}).outputText, context);
    await vm.runInContext("save()", context);
    assert.match(state.error, /Vérifiez les conditionnements/);
  }
});
