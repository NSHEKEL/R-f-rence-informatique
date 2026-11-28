const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');

function expression(path, name, context, variable = false) {
  const source = readFileSync(`${__dirname}/src/pages/${path}.tsx`, 'utf8');
  const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if ((variable ? ts.isVariableDeclaration(node) : ts.isFunctionDeclaration(node)) && node.name?.getText(file) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, name);
  const code = variable ? found.initializer.arguments[0].getText(file) : found.getText(file);
  return vm.runInNewContext(ts.transpileModule(`(${code})`, {}).outputText, context);
}

test('origin link filters purchases by id, including empty result, without selecting hidden purchases', () => {
  const purchases = [{ id: 1 }, { id: 2 }];
  for (const originId of [null, '1', '9']) {
    const rows = expression('Approvisionnements', 'visiblePurchases', { purchases, originId }, true)();
    assert.deepEqual(Array.from(rows, row => row.id), originId === null ? [1, 2] : originId === '1' ? [1] : []);
  }
  const source = readFileSync(`${__dirname}/src/pages/Approvisionnements.tsx`, 'utf8');
  assert.ok(source.includes('useSelection(visiblePurchases)'));
});

test('purchase metadata saves omit unchanged lines, but creation and actual line edits send them', async () => {
  for (const mode of ['create', 'metadata', 'changed']) {
    const original = { product_id: 1, packaging_id: null, quantity: 1, unit_cost: 100 };
    const state = {};
    const save = expression('Approvisionnements', 'save', {
      lines: [{ ...original, quantity: mode === 'changed' ? 2 : 1 }],
      editing: mode === 'create' ? null : { id: 3, items: [original] },
      paymentMethod: '', bankAccount: '', supplierId: '', supplierName: 'FVFD', expected: '',
      paidAmount: 0, invoice: 'FACT-1', note: 'Note corrigée',
      setSaving: () => {}, setError: error => { state.error = error; }, setOpen: () => {},
      resetForm: () => {}, load: async () => {},
      api: { post: async (_url, body) => { state.body = body; }, put: async (_url, body) => { state.body = body; } }
    });
    await save();
    assert.equal(state.error, '');
    assert.equal(Object.hasOwn(state.body, 'items'), mode !== 'metadata');
    assert.equal(state.body.invoice_number, 'FACT-1');
    assert.equal(state.body.note, 'Note corrigée');
  }
});

test('purchase deletion confirms supplier-independent removal and preserves server refusal messages', async () => {
  for (const mode of ['cancel', 'success', 'refused']) {
    const state = { calls: 0 };
    const remove = expression('Approvisionnements', 'remove', {
      window: { confirm: message => { assert.ok(message.includes('fournisseur a été supprimé')); assert.ok(message.includes('même annulés')); return mode !== 'cancel'; } },
      api: { delete: async url => { state.calls++; assert.equal(url, '/purchases/3'); if (mode === 'refused') throw { response: { data: { detail: 'Règlements conservés' } } }; } },
      load: async () => { state.loaded = true; }, axios: { isAxiosError: () => true },
      apiErrorMessage: detail => detail, setError: message => { state.error = message; }
    });
    await remove({ id: 3, reference: 'APP-2026-0001' });
    assert.equal(state.calls, mode === 'cancel' ? 0 : 1);
    assert.equal(!!state.loaded, mode === 'success');
    if (mode === 'refused') assert.equal(state.error, 'Règlements conservés');
  }
});

test('manual purchase choices are explicit even for empty candidates; request errors retain debt state', async () => {
  for (const result of [[], [{ id: 2, reference: 'APP-2026-0001' }], null]) {
    const state = { purchaseId: 'old', debt: null };
    const fn = expression('Dettes', 'choosePurchase', {
      api: { get: async url => { assert.equal(url, '/debts/4/purchase-candidates'); if (result === null) throw Error('offline'); return { data: result }; } },
      setCandidates: value => { state.candidates = value; }, setPurchaseId: value => { state.purchaseId = value; },
      setMatchingDebt: value => { state.debt = value; }, fail: () => { state.error = true; }
    });
    await fn({ id: 4 });
    if (result === null) { assert.ok(state.error); assert.equal(state.debt, null); }
    else { assert.equal(state.purchaseId, ''); assert.equal(state.debt.id, 4); assert.equal(state.candidates, result); }
  }
});

test('reconciliation requires a selected candidate and confirmation, audits through API, preserves modal on failure', async () => {
  for (const mode of ['none', 'cancel', 'success', 'error']) {
    const state = { calls: 0, debt: { id: 4 }, linking: false };
    const fn = expression('Dettes', 'reconcilePurchase', {
      candidates: [{ id: 2, reference: 'APP-2026-0001' }], purchaseId: mode === 'none' ? '' : '2',
      matchingDebt: { id: 4, reference: 'Dette', party: 'FVFD', amount: 1000000 }, linking: false,
      window: { confirm: () => mode !== 'cancel' }, formatMoney: String,
      api: { put: async (url, body) => { state.calls++; assert.equal(url, '/debts/4/purchase'); assert.equal(body.purchase_id, 2); assert.equal(body.confirm, true); if (mode === 'error') throw Error('503'); } },
      setLinking: value => { state.linking = value; }, setMatchingDebt: value => { state.debt = value; },
      setMessage: () => {}, setNotice: () => {}, load: async () => { state.loaded = true; },
      fail: () => { state.error = true; }
    });
    await fn();
    assert.equal(state.calls, ['none', 'cancel'].includes(mode) ? 0 : 1);
    assert.equal(state.linking, false);
    assert.equal(state.debt === null, mode === 'success');
    assert.equal(!!state.loaded, mode === 'success');
    assert.equal(!!state.error, mode === 'error');
  }
});
