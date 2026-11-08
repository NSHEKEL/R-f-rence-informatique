const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const output = {};
vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/units.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: output });
const product = { base_unit: "pièce", packaging_unit: "carton", units_per_packaging: 12, packaging_sale_price: 1000 };

test("mixed and packaging prices use exactly one base quantity", () => {
  assert.equal(output.saleUnitPrice(product, 27, 100, "mixed") * 27, 2300);
  assert.equal(output.saleUnitPrice(product, 24, 100, "packaging") * 24, 2000);
  assert.equal(output.splitQuantity(product, 27).packaging_quantity, 2);
  assert.equal(output.splitQuantity(product, 27).piece_quantity, 3);
  assert.equal(output.saleUnitPrice(product, 27, 100, "mixed", { packaging_quantity: 1, piece_quantity: 15 }) * 27, 2500);
  assert.match(output.formatQuantity(product, 120), /120 pièce = 10 carton/);
  assert.equal(output.formatQuantity(product, -27), "-27 pièce = −2 carton − 3 pièce");
  const prices = output.salePriceParts({ ...product, packaging_quantity: 2, piece_quantity: 3, base_unit_price: 100, unit_price: 2300 / 27 });
  assert.equal(prices[0].amount, 1000);
  assert.equal(prices[0].unit, "carton");
  assert.equal(prices[1].amount, 100);
});
test("base-only, empty and unset packaging price preserve unit pricing", () => {
  assert.equal(output.saleUnitPrice({}, 3, 100), 100);
  assert.equal(output.saleUnitPrice(product, 0, 100, "mixed"), 100);
  assert.equal(output.saleUnitPrice({ ...product, packaging_sale_price: null }, 24, 100, "packaging"), 100);
  assert.equal(output.saleUnitPrice(product, 12, 100, "base"), 100);
  assert.equal(output.quantityHtml({ base_unit: "<kg>" }, 2), "2 &lt;kg&gt;");
});
test("POS has an optional selector, mixed entry and server factor guard without grid changes", () => {
  const source = readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, "utf8");
  for (const text of ["Unité vendue", 'value="base"', 'value="packaging"', 'value="mixed"', "expected_units_per_packaging", "PackagingQuantity"]) assert.ok(source.includes(text), text);
  assert.match(source, /quantity: capped, packagingQuantity: undefined, pieceQuantity: undefined/);
});

test("packaging inputs render the chosen quantities with accessible labels", () => {
  const componentExports = {};
  const source = readFileSync(`${__dirname}/src/components/PackagingQuantity.tsx`, "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: componentExports,
    require: (name) => name === "../lib/units" ? output : require(name),
  });
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const html = renderToStaticMarkup(React.createElement(componentExports.default, { product, value: 27, parts: { packaging_quantity: 1, piece_quantity: 15 }, onChange() {} }));
  assert.match(html, /aria-label="Quantité en carton"/);
  assert.match(html, /aria-label="Quantité en pièce"/);
  assert.match(html, /value="15"/);
});

test("retail and wholesale resolve independent piece/carton prices and all fallbacks", () => {
  const item = { ...product, units_per_packaging: 24, sale_price: 100, packaging_sale_price: 2000, wholesale_price: 80, wholesale_packaging_price: 1500 };
  for (const [tier, piece, carton] of [["detail", 100, 2000], ["gros", 80, 1500]]) {
    assert.deepEqual(JSON.parse(JSON.stringify(output.catalogPrices(item, tier))), { piece, carton });
    assert.ok(Math.abs(output.catalogUnitPrice(item, 53, tier, { packaging_quantity: 2, piece_quantity: 5 }) * 53 - (2 * carton + 5 * piece)) < 1e-8);
    assert.equal(output.catalogUnitPrice(item, 5, tier, { packaging_quantity: 0, piece_quantity: 5 }), piece);
    assert.equal(output.catalogUnitPrice(item, 0, tier, { packaging_quantity: 0, piece_quantity: 0 }), piece);
  }
  assert.equal(output.catalogPrices({ ...item, wholesale_packaging_price: null }, "gros").carton, 1920);
  assert.equal(output.catalogPrices({ ...item, wholesale_packaging_price: null, wholesale_price: 0 }, "gros").carton, 2000);
  assert.equal(output.catalogPrices({ ...item, wholesale_packaging_price: null, wholesale_price: 0, packaging_sale_price: null }, "gros").carton, 2400);
  assert.equal(output.catalogPrices({ ...item, wholesale_packaging_price: 0 }, "gros").carton, 0);
  assert.equal(output.catalogPrices({ ...item, wholesale_price: 0 }, "gros").piece, 100);
});
