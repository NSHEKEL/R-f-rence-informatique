const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('unrecovered local operations block closing an open till before any HTTP request or frozen ticket', async () => {
  const source = ts.createSourceFile('Caisse.tsx', readFileSync(`${__dirname}/src/pages/Caisse.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let closing;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'closeTill') closing = node; ts.forEachChild(node, visit); }
  visit(source);
  for (const warning of ['Opérations locales conservées : conflit de caisse', 'Journal local indisponible', '']) {
    const blocked = Boolean(warning);
    for (const failure of [false, true]) {
      let calls = 0, tickets = 0, error = '', saving = false;
      const close = vm.runInNewContext(ts.transpileModule(`(${closing.getText(source)})`, {}).outputText, {
        recoveryWarning: warning, closeSessionId: 17, printJob: null, countedBalance: '175250', keptBalance: '170000', closeNote: '',
        api: { post: async () => { calls++; if (failure) throw { response: { data: { detail: 'Accès refusé' } } }; return { data: { id: 17, closed_at: '2026-11-23' } }; } },
        setError: value => { error = value; }, setSaving: value => { saving = value; },
        setCloseOpen() {}, setCloseNote() {}, setToday() {}, setClosedChoice() {},
        sessionStorage: { setItem() {} }, refreshTill: async () => {}, leaveFullscreen: async () => {},
        showTicket: () => { tickets++; }, axios: { isAxiosError: error => Boolean(error.response) },
        apiErrorMessage: detail => detail,
      });
      await close();
      assert.equal(calls, blocked ? 0 : 1);
      assert.equal(tickets, blocked || failure ? 0 : 1);
      assert.equal(error, blocked ? warning : failure ? 'Accès refusé' : '');
      assert.equal(saving, false);
    }
  }
  assert.match(source.text, /className="btn-ghost"\s+disabled=\{Boolean\(recoveryWarning\)\}/);
  assert.match(source.text, /onClick=\{closeTill\}\s+disabled=\{saving \|\| Boolean\(recoveryWarning\)\}/);
});

test('confirmation keeps its session id even if the live till changes before submission', async () => {
  const source = ts.createSourceFile('Caisse.tsx', readFileSync(`${__dirname}/src/pages/Caisse.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'closeTill') fn = node; ts.forEachChild(node, visit); }
  visit(source);
  let posted, error;
  const close = vm.runInNewContext(ts.transpileModule(`(${fn.getText(source)})`, {}).outputText, {
    recoveryWarning: '', closeSessionId: 17, today: { id: 18 }, printJob: null,
    countedBalance: '500', keptBalance: '0', closeNote: '', setSaving() {}, setError: value => { error = value; },
    api: { post: async (_url, payload) => { posted = payload; throw { response: { data: { detail: 'La caisse a changé' } } }; } },
    axios: { isAxiosError: () => true }, apiErrorMessage: value => value,
  });
  await close();
  assert.equal(posted.cash_session_id, 17);
  assert.equal(error, 'La caisse a changé');
  assert.match(source.text, /setCloseSessionId\(today.id\)/);
});
