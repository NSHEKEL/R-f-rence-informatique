const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(path, dependencies = {}, globals = {}) {
  const output = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: output, require: (name) => dependencies[name] || require(name), setTimeout, clearTimeout, ...globals,
  });
  return output;
}
const display = load('lib/posDisplay.ts');
const units = load('lib/units.ts');

test('POS defaults and safe partial merge preserve independent settings', () => {
  assert.equal(display.mergePos().mode, 'nom');
  assert.equal(display.mergePos().images, false);
  assert.equal(display.mergePos({ width: 210 }).height, 110);
  assert.equal(display.mergePos({ width: -2, columns: Infinity, background: 'url(x)' }).width, 100);
  assert.equal(display.mergePos({ background: 'url(x)' }).background, '#ffffff');
  assert.equal(display.DEFAULT_POS.width, 160);
  assert.equal(display.stockLimit({}), Infinity);
  assert.equal(display.stockLimit({ quantity: null }), Infinity);
  assert.equal(display.stockLimit({ quantity: 0 }), 0);
});

test('tiles render at most 60 of thousands; default has no price, stock or image request', () => {
  const Grid = load('components/PosProductGrid.tsx', { '../api/client': { formatXOF: (n) => `${n} FCFA` }, '../lib/units': units, '../lib/posDisplay': display }).default;
  const products = Array.from({ length: 5000 }, (_, id) => ({ id, name: `Article ${id}`, image: 'https://example.invalid/do-not-load.png', quantity: 120, sale_price: 200 }));
  const render = (config, stockRight = false) => renderToStaticMarkup(React.createElement(Grid, { products, config, stockRight, selected: new Set(), onAdd() {}, price: (p) => p.sale_price }));
  const initial = render(display.DEFAULT_POS);
  assert.equal((initial.match(/aria-pressed=/g) || []).length, 60);
  assert.doesNotMatch(initial, /<img|Stock|FCFA/);
  const configured = { ...display.DEFAULT_POS, mode: 'image+nom+prix+stock', images: true, stock: true };
  assert.doesNotMatch(render(configured), /Stock/);
  assert.match(render(configured), /<img/);
  assert.match(render(configured, true), /Stock/);
  assert.doesNotMatch(render({ ...configured, images: false }), /<img/);
});

test('print retries are single-flight even with rapid clicks; closing detaches reporting only', async () => {
  const { createPrintRunner } = load('lib/printJob.ts');
  const runner = createPrintRunner(30_000, 0);
  let release, jobs = 0, mounted = true, updates = 0;
  const events = [];
  const report = (value) => { events.push(value.state); if (mounted) updates++; };
  const job = runner.run(() => { jobs++; return new Promise((resolve) => { release = resolve; }); }, report);
  await Promise.resolve();
  await runner.run(async () => { jobs++; }, report);
  assert.equal(jobs, 1);
  assert.equal(runner.isBusy(), true);
  mounted = false;
  const previous = updates;
  release(); await job;
  assert.equal(updates, previous);
  assert.equal(runner.isBusy(), false);
  await runner.run(async () => { jobs++; }, report);
  assert.equal(jobs, 2);
  assert.ok(events.includes('success'));
});

test('timeout reports uncertainty, retains lock until actual completion and handles disconnection', async () => {
  let expire;
  const { createPrintRunner } = load('lib/printJob.ts', {}, { setTimeout: (fn) => { expire = fn; return 1; }, clearTimeout() {} });
  const runner = createPrintRunner(30_000, 0);
  const events = [];
  let release;
  const job = runner.run(() => new Promise((resolve) => { release = resolve; }), (status) => events.push(status));
  await Promise.resolve(); expire();
  assert.match(events.at(-1).message, /Résultat inconnu/);
  assert.equal(runner.isBusy(), true);
  release(); await job;
  await runner.run(async () => { throw new Error('printer disconnected'); }, (status) => events.push(status));
  assert.equal(events.at(-1).state, 'error');
  assert.match(events.at(-1).message, /disconnected/);
});

test('rapid clicks do not enqueue another job even when the first resolves immediately', async () => {
  let clock = 1000, jobs = 0;
  const { createPrintRunner } = load('lib/printJob.ts', {}, { performance: { now: () => clock } });
  const runner = createPrintRunner();
  const print = async () => { jobs++; };
  await runner.run(print, () => {});
  clock += 100;
  await runner.run(print, () => {});
  assert.equal(jobs, 1);
  clock += 750;
  await runner.run(print, () => {});
  assert.equal(jobs, 2);
});

test('Quitter, new sale and ESC close only; modal never imports a sale API', () => {
  const modal = readFileSync(`${__dirname}/src/components/SalePrintModal.tsx`, 'utf8');
  assert.doesNotMatch(modal, /api\.(post|delete)|checkout\(|\/sales/);
  assert.match(modal, /onClick=\{onClose\}>Quitter/);
  assert.match(modal, /onClick=\{onClose\}>Nouvelle vente/);
  assert.match(modal, /disabled=\{busy\} onClick=\{\(\) => start\(\)\}/);
  const shared = readFileSync(`${__dirname}/src/components/Modal.tsx`, 'utf8');
  assert.match(shared, /event.key === "Escape".*onClose\(\)/);
  const print = readFileSync(`${__dirname}/src/lib/print.ts`, 'utf8');
  assert.match(print, /event.key === "Escape".*finish\(\)/);
});

test('real modal handlers close twice and ESC closes once without any sale request', () => {
  let closes = 0, saleCalls = 0, escape;
  const effects = [];
  const hooks = { ...React, useState: (initial) => [initial, () => {}], useRef: (value) => ({ current: value }), useEffect: (effect) => { effects.push(effect); }, useSyncExternalStore: (_subscribe, read) => read() };
  const api = { post() { saleCalls++; }, delete() { saleCalls++; } };
  const modal = load('components/SalePrintModal.tsx', {
    react: hooks, '../lib/print': { printReceipt: async () => false }, '../lib/printJob': load('lib/printJob.ts'),
    './Modal': { default() {} }, './Receipt': { default() {} }, '../api/client': api,
  }).default;
  const tree = modal({ sale: { id: 1, reference: 'S-1' }, config: { width: 'A4', auto_print: false }, kick: [], onClose() { closes++; }, onPrinted() {} });
  const dialog = tree.props.children[0];
  const buttons = dialog.props.footer.props.children;
  buttons[0].props.onClick(); buttons[3].props.onClick();
  assert.equal(closes, 2);
  const SharedModal = load('components/Modal.tsx', { react: hooks, 'lucide-react': { X() {} } }, { document: { querySelector: () => null }, window: { addEventListener(_name, callback) { escape = callback; }, removeEventListener() {} } }).default;
  SharedModal({ open: true, onClose() { closes++; }, title: 'Test', children: null });
  effects.at(-1)();
  escape({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(closes, 3);
  assert.equal(saleCalls, 0);
});

test('closing the actual print modal leaves its owned DOM copy until the job settles', async () => {
  let finishPrint, began, removed = false, drawer = 0, closes = 0, root;
  const started = new Promise((resolve) => { began = resolve; });
  const pending = new Promise((resolve) => { finishPrint = resolve; });
  const effects = [];
  const hooks = { ...React, useState: (initial) => [initial, () => {}], useRef: (value) => ({ current: value }), useEffect: (effect) => { effects.push(effect); }, useSyncExternalStore: (_subscribe, read) => read() };
  const job = load('lib/printJob.ts');
  const modal = load('components/SalePrintModal.tsx', {
    react: hooks, '../lib/print': { printReceipt: () => { began(); return pending; } }, '../lib/printJob': job,
    './Modal': { default() {} }, './Receipt': { default() {} },
  }, { document: {
    getElementById: () => ({ cloneNode: () => ({ style: { removeProperty() {} }, querySelectorAll: () => [], remove() { removed = true; } }) }),
    body: { appendChild(node) { root = node; } },
  } }).default;
  const tree = modal({ sale: { id: 1, reference: 'S-1' }, config: { width: 'A4', auto_print: true }, kick: [27], onClose() { closes++; }, onPrinted() { drawer++; } });
  const cleanup = effects[0]();
  await started;
  tree.props.children[0].props.onClose(); cleanup();
  assert.equal(closes, 1);
  assert.equal(root.id, 'receipt-print-root');
  assert.equal(removed, false);
  assert.equal(job.receiptPrintRunner.isBusy(), true);
  const done = new Promise((resolve) => { const unsubscribe = job.receiptPrintRunner.subscribe(() => { if (!job.receiptPrintRunner.isBusy()) { unsubscribe(); resolve(); } }); });
  finishPrint(false); await done;
  assert.equal(removed, true);
  assert.equal(drawer, 1);
});
