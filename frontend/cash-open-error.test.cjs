const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('opening always displays the original failure even if either session refresh also fails', async () => {
  const source = ts.createSourceFile('Caisse.tsx', readFileSync(`${__dirname}/src/pages/Caisse.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let opening;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openTill') opening = node; ts.forEachChild(node, visit); }
  visit(source);
  const errors = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/apiErrors.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: errors });
  const original = { response: { status: 503, data: { detail: 'Serveur indisponible pendant l’ouverture' } } };
  for (const [failure, loadFails, refreshFails] of [
    [null, false, false],
    [original, false, false],
    [original, true, false],
    [original, false, true],
    [original, true, true],
    [Error('Network Error'), true, true],
  ]) {
    let message = '', saving, loads = 0, refreshes = 0;
    const open = vm.runInNewContext(ts.transpileModule(`(${opening.getText(source)})`, {}).outputText, {
      Error, printJob: null, recoveryWarning: '', openingBalance: '170000', note: '', isAdmin: true,
      api: { post: async () => { if (failure) throw failure; return { data: { id: 17 } }; } },
      load: async () => { loads++; if (loadFails) throw Error('load failed'); },
      refreshTill: async () => { refreshes++; if (refreshFails) throw Error('refresh failed'); },
      setSaving: value => { saving = value; }, setError: value => { message = value; }, setNote() {}, setOpeningBalance() {}, sessionStorage: { removeItem() {} }, showTicket() {},
      axios: { isAxiosError: error => Boolean(error.response) }, apiErrorMessage: errors.apiErrorMessage,
    });
    await open();
    assert.equal(loads, 1);
    assert.equal(refreshes, 1);
    assert.equal(saving, false);
    assert.equal(message, failure === original ? 'Serveur indisponible pendant l’ouverture (HTTP 503)' : failure?.message || '');
  }
});
