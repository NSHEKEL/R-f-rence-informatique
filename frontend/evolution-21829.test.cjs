const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
function load(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (name) => imports[name] });
  return exports;
}
const units = load("lib/units.ts");
const { dividePackaging } = load("lib/posPackaging.ts", { "./units": units });
const { sortProducts, matchesStock } = load("lib/productSort.ts");
const product = { id: 1, name: "Carton", sku: "C", quantity: 30, min_stock: 5, sale_price: 200, packaging_unit: "Carton", units_per_packaging: 12, packaging_sale_price: 2000 };

test("division calculates integral reference quantities and rounded proportional money, without mutating packaging", () => {
  for (const [divisor, qty, total] of [[2, 6, 1000], [3, 4, 667], [4, 3, 500], [12, 1, 167]]) {
    const result = dividePackaging(product, divisor, "detail");
    assert.equal(result.quantity, qty); assert.equal(result.total, total);
    assert.equal(result.unitPrice * qty, total);
  }
  assert.equal(product.packaging_sale_price, 2000);
  assert.equal(product.units_per_packaging, 12);
  for (const divisor of [0, 1, 2.5, 5, NaN, Infinity]) assert.throws(() => dividePackaging(product, divisor, "detail"), /Division impossible/);
  assert.throws(() => dividePackaging({ ...product, packaging_unit: "" }, 2, "detail"));
  assert.equal(dividePackaging({ ...product, packaging_sale_price: 0 }, 2, "detail").total, 0);
  assert.equal(dividePackaging({ ...product, wholesale_min_qty: 12, wholesale_packaging_price: 1200 }, 2, "auto", 12).total, 600);
});

test("divided cart price is not a catalogue edit, even for manual price overrides", () => {
  const source = readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, "utf8");
  const start = source.indexOf("function linePrice(");
  const end = source.indexOf("function cartParts(", start);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source.slice(start, end) + "\nexports.price = linePrice; exports.saves = priceWillBeSaved;", {}).outputText,
    { exports, dividePackaging });
  const line = { product, quantity: 6, packaging_divisor: 2 };
  assert.equal(exports.price(line, "detail") * 6, 1000);
  assert.equal(exports.saves(line), false);
  assert.equal(exports.saves({ ...line, price: 175 }), false);
  assert.equal(exports.price({ ...line, price: 175 }) * 6, 1050);
  assert.equal(exports.saves({ ...line, packaging_divisor: undefined, price: 175 }), true);
  assert.match(source, /packaging_divisor: l\.packaging_divisor/);
});

test("stock filters distinguish empty, low, sufficient, null and local-day expiry without writes", () => {
  const today = new Date(2026, 0, 1);
  const check = (changes, filter) => matchesStock({ ...product, ...changes }, filter, today);
  assert.ok(check({}, "all")); assert.ok(check({}, "available")); assert.ok(check({}, "sufficient"));
  assert.ok(check({ quantity: 0 }, "empty")); assert.ok(check({ quantity: -2 }, "empty"));
  assert.ok(check({ quantity: 5 }, "low")); assert.ok(!check({ quantity: 0 }, "low"));
  assert.ok(!check({ quantity: null }, "available")); assert.ok(!check({ min_stock: null }, "low"));
  assert.ok(check({ nearest_expiry: "2025-12-31T00:00:00" }, "expired"));
  assert.ok(check({ nearest_expiry: "2026-01-01" }, "soon"));
  assert.ok(check({ nearest_expiry: "2026-01-31" }, "soon"));
  assert.ok(!check({ nearest_expiry: "2026-02-01" }, "soon"));
  assert.ok(!check({ nearest_expiry: null }, "soon"));
  assert.ok(!check({ nearest_expiry: "invalid" }, "expired"));
  assert.equal(product.quantity, 30);
});

test("new sort fields are stable, nullable values last and input order is untouched", () => {
  const rows = [
    { ...product, id: 1, sku: "Z", quantity: 10, stock_purchase_price: 30, sale_price: 50, nearest_expiry: null },
    { ...product, id: 2, sku: "A", quantity: 2, stock_purchase_price: 10, sale_price: 20, nearest_expiry: "2026-01-01" },
    { ...product, id: 3, sku: "B", quantity: 4, stock_purchase_price: 20, sale_price: 30, nearest_expiry: "2026-02-01" },
  ];
  for (const field of ["code", "quantity", "purchase", "sale", "expiry"]) {
    assert.deepEqual(Array.from(sortProducts(rows, `${field}_asc`), (p) => p.id), [2, 3, 1]);
    assert.deepEqual(Array.from(sortProducts(rows, `${field}_desc`), (p) => p.id), field === "expiry" ? [3, 2, 1] : [1, 3, 2]);
  }
  assert.equal(sortProducts([], "quantity_asc").length, 0);
  assert.deepEqual(rows.map((p) => p.id), [1, 2, 3]);
});

test("typed QR search prefers current server codes, rejects stale codes and keeps offline cached recognition", async () => {
  const source = readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, "utf8");
  const start = source.indexOf("  async function submitSearch()");
  const end = source.indexOf("\n  function setLinePrice", start);
  const code = ts.transpileModule(source.slice(start, end) + "\nexports.run = submitSearch;", {}).outputText;
  for (const scenario of ["new", "old", "offline", "forbidden", "empty"]) {
    const exports = {}, added = [];
    let error = "", query = scenario === "empty" ? "" : scenario === "new" ? "NEW-QR" : "OLD-QR";
    const cached = { ...product, barcodes: [{ code: "OLD-QR", active: true }] };
    const state = { exports, products: [cached], filtered: [cached], query, scanValue: (v) => v, scanCodes: (p) => p.barcodes.map((b) => b.code.toLowerCase()),
      api: { get: async () => { if (scenario === "new") return { data: { ...product, barcodes: [{ code: "NEW-QR", active: true }] } }; throw { response: scenario === "offline" ? undefined : { status: scenario === "forbidden" ? 403 : 404 } }; } },
      axios: { isAxiosError: () => true }, setProducts: () => {}, stockLimit: (p) => p.quantity, allowNegativeStock: false,
      setError: (v) => { error = v; }, addToCart: (p) => added.push(p), setFlash() {}, setQuery() {}, window: { setTimeout() {} } };
    vm.runInNewContext(code, state);
    await exports.run();
    assert.equal(added.length, ["new", "offline"].includes(scenario) ? 1 : 0, scenario);
    if (scenario === "old") assert.match(error, /remplacé ou retiré/);
    if (scenario === "forbidden") assert.match(error, /Lecture impossible/);
  }
  assert.doesNotMatch(readFileSync(`${__dirname}/src/pages/Products.tsx`, "utf8"), /disabled=\{!!barcode.id\}/);
});
