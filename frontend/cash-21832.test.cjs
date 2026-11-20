const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false } }).outputText, { exports, require: name => dependencies[name] || require(name), ...globals });
  return exports;
}
function element(tree, parent = null) {
  if (tree == null || typeof tree === 'boolean') return null;
  if (typeof tree !== 'object') return String(tree);
  if (typeof tree.type === 'function') return element(tree.type(tree.props), parent);
  const props = tree.props || {}, node = { parent, props, children: [], style: { cssText: '' }, scrollHeight: 900 };
  node.classList = { contains: name => (props.className || '').split(' ').includes(name) };
  node.getAttribute = name => props[name] ?? null;
  Object.defineProperty(node, 'textContent', { get: () => node.children.map(child => typeof child === 'string' ? child : child.textContent).join('') });
  const simple = (value, selector) => value && selector.split('.').every((part, i) => !part || (i === 0 ? value.tag === part : value.classList.contains(part)));
  const matches = (value, selector) => {
    const parts = selector.trim().split(/\s+/);
    if (!simple(value, parts.pop())) return false;
    let ancestor = value.parent;
    while (parts.length) { const part = parts.pop(); while (ancestor && !simple(ancestor, part)) ancestor = ancestor.parent; if (!ancestor) return false; ancestor = ancestor.parent; }
    return true;
  };
  node.tag = typeof tree.type === 'string' ? tree.type : 'fragment';
  node.querySelectorAll = selector => {
    const result = [];
    const visit = value => { for (const child of value.children) if (typeof child !== 'string') { if (selector.split(',').some(part => matches(child, part))) result.push(child); visit(child); } };
    visit(node); return result;
  };
  node.querySelector = selector => node.querySelectorAll(selector)[0] || null;
  for (const child of [props.children].flat(Infinity)) { const value = element(child, node); if (value !== null) node.children.push(value); }
  return node;
}
const money = { formatXOF: String, formatMoney: String };
const ZReport = load('components/ZReport.tsx', { '../api/client': money }).default;
const CashTicket = load('components/CashTicket.tsx', { '../api/client': money }).default;
const ticket = load('lib/ticketText.ts');
const types = load('types.ts');
const style = load('lib/printStyle.ts', { '../types': types });

test('Z, opening and closing tickets carry real content through native thermal and browser paths', async () => {
  const report = { session_id: 37, company: 'EasyGest Test', cashier: 'Vendeuse Alice', business_day: '2026-11-20', opening_balance: 500, total_sales: 1500, sales_count: 3, cancelled_total: 0, cancelled_count: 0, gift_total: 0, payments: { 'Espèces': 1000, 'Wave': 500 }, expenses: [{ label: 'Transport', amount: 50 }], deposits: [{ id: 1, bank: 'Banque', amount: 100, status: 'validé' }], expenses_total: 50, deposits_total: 100, expected_cash: 1350, counted_cash: 1350, difference: 0, note: 'Comptage validé', opened_at: null, closed_at: null, generated_at: null };
  const session = { id: 37, opened_by: { name: 'Vendeuse Alice' }, closed_by: { name: 'Vendeuse Alice' }, business_day: report.business_day, opened_at: '2026-11-20T08:00:00Z', closed_at: '2026-11-20T18:00:00Z', opening_balance: 500, cash_sales: 1000, other_sales: 500, total_sales: 1500, sales_count: 3, expected_cash: 1350, closing_balance: 1350, difference: 0 };
  for (const width of ['58mm', '80mm']) for (const kind of ['z', 'open', 'close']) {
    const tree = kind === 'z' ? React.createElement(ZReport, { inline: true, report, company: null, format: width }) : React.createElement(CashTicket, { inline: true, session, company: { name: report.company }, format: width, kind });
    const title = kind === 'z' ? 'ÉTAT Z DE CAISSE' : kind === 'open' ? 'Ouverture de caisse' : 'Fermeture de caisse';
    const html = renderToStaticMarkup(tree), root = element(tree);
    assert.ok(html.includes(title)); assert.ok(html.includes('Vendeuse Alice'));
    let payload, browserText;
    const window = { addEventListener() {}, print() { browserText = root.textContent; }, pywebview: { api: { print_ticket: async value => { payload = JSON.parse(value); return ''; } } } };
    const document = { getElementById: id => id === 'receipt-print-root' ? root : null, createElement: () => ({}), head: { appendChild() {} } };
    const print = load('lib/print.ts', { './ticketText': ticket, './printStyle': style, '../types': types, './barcode': {}, './offline': {} }, { document, window });
    const config = { ...types.DEFAULT_PRINTING.receipt, width, copies: 1, printer_name: 'Thermique' };
    await print.printAutomaticDocument(width, config);
    const text = payload.lines.map(line => line.text || '').join('\n');
    assert.ok(text.includes(title)); assert.ok(text.includes('Vendeuse Alice')); assert.ok(text.includes('500'));
    if (kind !== 'open') assert.ok(text.includes('1350'));
    if (kind === 'z') for (const expected of ['Session #37', 'Wave', 'Transport', 'Banque', 'Comptage validé', 'Montant compté']) assert.ok(text.includes(expected), expected);
    window.pywebview = undefined;
    await print.printAutomaticDocument(width, config);
    assert.ok(browserText.includes(title)); assert.ok(browserText.includes('Vendeuse Alice'));
  }
});

test('empty Z still prints its identity and zero totals', () => {
  const tree = React.createElement(ZReport, { inline: true, format: '80mm', company: null, report: { session_id: 9, company: 'Magasin', payments: {}, expenses: [], deposits: [], opening_balance: 0, total_sales: 0, expected_cash: 0, counted_cash: 0, difference: 0 } });
  const text = ticket.ticketLines(element(tree), '80mm').map(line => line.text || '').join('\n');
  assert.match(text, /ÉTAT Z DE CAISSE/); assert.match(text, /Session #9/); assert.match(text, /Aucun encaissement/); assert.match(text, /Montant théorique/);
});

test('closing never logs out automatically, with or without auto-print; failed closure offers no success choice', async () => {
  const source = readFileSync(`${__dirname}/src/pages/Caisse.tsx`, 'utf8');
  const file = ts.createSourceFile('Caisse.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'closeTill') fn = node; ts.forEachChild(node, visit); }
  visit(file);
  assert.ok(source.includes('Rester connecté')); assert.ok(source.includes('onClick={logout}'));
  for (const prints of [true, false, 'error']) {
    let choice = false, refreshed = 0, error = '', saving;
    const close = vm.runInNewContext(ts.transpileModule(`(${fn.getText(file)})`, {}).outputText, { printJob: null, countedBalance: '500', closeNote: '', api: { post: async () => { if (prints === 'error') throw new Error('refused'); return { data: { id: 1, closed_at: 'now' } }; } }, setSaving: value => { saving = value; }, setError: value => { error = value; }, setCloseOpen() {}, setCloseNote() {}, setToday() {}, sessionStorage: { setItem() {} }, refreshTill: async () => { refreshed++; }, leaveFullscreen: async () => {}, setClosedChoice: value => { choice = value; }, showTicket: () => prints, logout: () => assert.fail('unexpected logout'), axios: { isAxiosError: () => true }, apiErrorMessage: (_value, fallback) => fallback });
    await close();
    assert.equal(choice, prints !== 'error'); assert.equal(refreshed, prints === 'error' ? 0 : 1); assert.equal(saving, false);
    if (prints === 'error') assert.equal(error, "Impossible de fermer la caisse");
  }
});
