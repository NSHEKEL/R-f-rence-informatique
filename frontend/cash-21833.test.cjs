const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/components/${file}.tsx`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { exports, require: name => name === '../api/client' ? { formatXOF: String, formatMoney: String } : require(name) });
  return exports.default;
}

test('closing and Z expose conversion, refunds, expenses and remittance without hiding totals', () => {
  const figures = { session_id: 1, mobile_money_to_cash: true, payments: { 'Espèces': 465000, 'Mobile Money': 14000 },
    payment_groups: { cash: 465000, mobile_money: 14000, bank: 0 }, cash_sales: 465000,
    total_sales: 479000, expected_cash: 439000, closing_balance: 439000, counted_cash: 439000,
    kept_balance: 10000, remitted_amount: 429000, opening_balance: 0, expenses_total: 40000,
    refunds_total: 0, cash_refunds: 0, entries_total: 0, exits_total: 0, expenses: [], deposits: [],
    company: 'Test', cashier: 'Alice', opened_by: { name: 'Alice' } };
  for (const component of ['CashTicket', 'ZReport']) {
    const C = load(component);
    const html = renderToStaticMarkup(React.createElement(C, { inline: true, session: figures, report: figures, company: {}, kind: 'close', format: '80mm' }));
    for (const expected of ['465000', '14000', '479000', '439000', '429000', '10000', '40000', 'converti en espèces']) assert.ok(html.includes(expected), `${component}: ${expected}`);
    assert.ok(html.includes('Montant remis au patron')); assert.ok(html.includes('Montant restant en caisse'));
  }
});
