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

test('stock entry dialog posts additive base/packaging/depot data, rejects invalid quantity and formats 422', async () => {
  const product = { id: 7, name: 'Riz', quantity: -2, base_unit: 'pièce', packaging_unit: 'Carton', units_per_packaging: 24,
    packagings: [{ id: 4, active: true, name: 'Colis', factor: 6 }, { id: 9, active: false, name: 'Ancien', factor: 12 }] };
  let values, index, tree, request, fail, saved, closed;
  const component = load('components/ProductStockEntry.tsx', {
    react: { ...React, useState: (initial) => { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], (v) => { values[slot] = v; }]; } },
    '../api/client': { default: { post: async (url, payload) => { request = { url, payload }; if (fail) throw { response: { data: { detail: [{ loc: ['body', 'quantity'], type: 'greater_than', ctx: { gt: 0 } }] } } }; return { data: { ...product, quantity: 10 } }; } } },
    axios: { default: { isAxiosError: () => true } },
    '../lib/apiErrors': errors,
    '../lib/depots': { useDepots: () => ({ depots: [{ id: 1, active: true, is_default: true, name: 'Principal' }, { id: 2, active: true, name: 'Réserve' }], error: '' }) },
    './Modal': { default: ({ title, children, footer }) => React.createElement('section', {}, title, children, footer) },
  }).default;
  const render = () => { index = 0; tree = component({ product, onClose: () => { closed = true; }, onSaved: async (p) => { saved = p; } }); return renderToStaticMarkup(tree); };
  for (const [unit, packaging_id] of [['base', null], ['primary', null], ['4', 4]]) {
    values = [2, unit, '2', 'Correction', 'Livraison', '', false]; request = null; saved = null; closed = false;
    const html = render();
    assert.match(html, /Réserve/); assert.doesNotMatch(html, /Ancien/);
    await tree.props.footer.props.children[1].props.onClick();
    assert.equal(request.url, '/products/7/stock-entry');
    assert.equal(request.payload.quantity, 2); assert.equal(request.payload.packaging_id, packaging_id);
    assert.equal(request.payload.unit, unit === 'base' ? 'base' : 'packaging');
    assert.equal(request.payload.depot_id, 2); assert.equal(saved.quantity, 10); assert.equal(closed, true);
  }
  for (const q of ['', 0, -1, 1.5, 2147483648]) {
    values = [q, 'base', '', 'Arrivage', '', '', false]; request = null; render();
    await tree.props.footer.props.children[1].props.onClick();
    assert.equal(request, null); assert.match(render(), /Quantité entière strictement positive/);
  }
  values = [1, 'base', '', 'Arrivage', '', '', false]; fail = true; closed = false; render();
  await tree.props.footer.props.children[1].props.onClick();
  assert.match(render(), /Quantité : valeur supérieure à 0 requise/); assert.equal(closed, false);
});
