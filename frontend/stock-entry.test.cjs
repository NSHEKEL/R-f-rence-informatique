const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false },
  }).outputText, { exports, require: (name) => dependencies[name] || require(name) });
  return exports;
}
const errors = load('lib/apiErrors.ts');
const display = load('lib/posDisplay.ts');

test('negative stock policy defaults off and lifts every POS stock limit only when enabled', () => {
  assert.equal(display.stockLimit({ quantity: 0 }), 0);
  assert.equal(display.stockLimit({ quantity: -2 }), -2);
  assert.equal(display.stockLimit({ quantity: 0 }, true), Infinity);
  assert.equal(display.stockLimit({ quantity: -2 }, true), Infinity);
  const source = readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, 'utf8');
  assert.match(source, /company\?\.allow_negative_stock_sale === true/);
  for (const call of source.matchAll(/stockLimit\(([^)]*)\)/g)) assert.match(call[1], /allowNegativeStock/);
  assert.match(source, /Stock insuffisant : stock deviendra/);
  const settings = readFileSync(`${__dirname}/src/pages/Settings.tsx`, 'utf8');
  assert.match(settings, /Autoriser la vente sans stock \(stock négatif\)/);
  assert.match(settings, /checked=\{company.allow_negative_stock_sale \?\? false\} disabled=\{!can\("generaux_modifier"\)\}/);
});

test('product form protects edits and groups priority fields; tickets keep numeric quantities without changing A4', () => {
  const source = readFileSync(`${__dirname}/src/pages/Products.tsx`, 'utf8');
  assert.match(source, /open=\{modalOpen\}[\s\S]*?closeOnBackdrop=\{false\}[\s\S]*?closeOnEscape=\{false\}/);
  assert.match(source, /!editing && \(!form.sku \|\| form.sku === autoSku.current\)/);
  const priority = source.split('Identification, stock et conditionnements')[1].split('Autres informations et tarifs')[0];
  for (const field of ['form.name', 'form.sku', 'form.purchase_price', 'form.quantity', 'form.barcode', 'form.qr_code', 'form.barcodes', 'form.expiry_date', 'ProductPackagings', 'Disponible :']) assert.ok(priority.includes(field), field);
  const receipt = readFileSync(`${__dirname}/src/components/Receipt.tsx`, 'utf8');
  assert.match(receipt, /numericQuantities=\{!a4\}/);
  assert.match(receipt, /numericQuantities \? it.quantity : it.quantity_label \|\| it.quantity/);
});

test('stock entry dialog posts multiple units, previews totals, validates and formats errors', async () => {
  const product = { id: 7, name: 'Riz', quantity: -2, base_unit: 'pièce', packaging_unit: 'Carton', units_per_packaging: 12,
    packagings: [{ id: 4, active: true, name: 'Colis', factor: 6 }, { id: 9, active: false, name: 'Ancien', factor: 12 }] };
  let values, index, tree, request, fail, saved, closed;
  const component = load('components/ProductStockEntry.tsx', {
    react: { ...React, useState: (initial) => { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], (v) => { values[slot] = typeof v === 'function' ? v(values[slot]) : v; }]; } },
    '../api/client': { default: { post: async (url, payload) => { request = { url, payload }; if (fail) throw { response: { data: { detail: [{ loc: ['body', 'quantity'], type: 'greater_than', ctx: { gt: 0 } }] } } }; return { data: { ...product, quantity: 39 } }; } } },
    axios: { default: { isAxiosError: () => true } },
    '../lib/apiErrors': errors,
    '../lib/depots': { useDepots: () => ({ depots: [{ id: 1, active: true, is_default: true, name: 'Principal' }, { id: 2, active: true, name: 'Réserve' }], error: '' }) },
    './Modal': { default: ({ title, children, footer }) => React.createElement('section', {}, title, children, footer) },
  }).default;
  const render = () => { index = 0; tree = component({ product, onClose: () => { closed = true; }, onSaved: async (p) => { saved = p; } }); return renderToStaticMarkup(tree); };
  values = [{ primary: 3, base: 5 }, '2', 'Correction', 'Livraison', '', false];
  let html = render();
  assert.match(html, /5 pièce \+ 3 Carton = 41 pièce/);
  assert.match(html, /Réserve/); assert.doesNotMatch(html, /Ancien/);
  assert.equal(tree.props.closeOnBackdrop, false); assert.equal(tree.props.closeOnEscape, false);
  await tree.props.footer.props.children[1].props.onClick();
  assert.equal(request.url, '/products/7/stock-entry');
  assert.equal(JSON.stringify(request.payload.lines), JSON.stringify([{ packaging_id: null, quantity: 5 }, { packaging_id: null, quantity: 3, unit: 'packaging' }]));
  assert.equal(request.payload.depot_id, 2); assert.equal(saved.quantity, 39); assert.equal(closed, true);
  values = [{ 4: 2 }, '', 'Arrivage', '', '', false]; render();
  await tree.props.footer.props.children[1].props.onClick();
  assert.equal(JSON.stringify(request.payload.lines), JSON.stringify([{ packaging_id: 4, quantity: 2 }]));
  for (const quantities of [{}, { base: '' }, { base: 0, primary: 0 }, { base: -1 }, { base: 1.5 }, { primary: 2147483647 }, { base: 2147483647, 4: 1 }]) {
    values = [quantities, '', 'Arrivage', '', '', false]; request = null; render();
    await tree.props.footer.props.children[1].props.onClick();
    assert.equal(request, null); assert.match(render(), /Quantités entières positives ou nulles requises/);
  }
  values = [{ base: 1 }, '', 'Arrivage', '', '', false]; fail = true; closed = false; render();
  await tree.props.footer.props.children[1].props.onClick();
  assert.match(render(), /Quantité : valeur supérieure à 0 requise/); assert.equal(closed, false);
});
