const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('till opening refreshes the existing session and displays JSON, text HTTP and network errors', async () => {
  const source = ts.createSourceFile('TillGate.tsx', readFileSync(`${__dirname}/src/components/TillGate.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let opening;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openTill') opening = node; ts.forEachChild(node, visit); }
  visit(source);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/apiErrors.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  for (const [failure, expected] of [
    [null, ''],
    [{ response: { status: 400, data: { detail: 'Votre caisse est déjà ouverte' } } }, 'Votre caisse est déjà ouverte (HTTP 400)'],
    [{ response: { status: 500, data: 'Internal Server Error' } }, 'Internal Server Error (HTTP 500)'],
    [{ message: 'Network Error' }, 'Network Error'],
  ]) {
    let refreshed = 0, error = '';
    const open = vm.runInNewContext(ts.transpileModule(`(${opening.getText(source)})`, {}).outputText, {
      api: { post: async () => { if (failure) throw failure; } }, openingBalance: '170000', refresh: async () => { refreshed++; },
      setSaving() {}, setError: value => { error = value; }, axios: { isAxiosError: () => true }, apiErrorMessage: exports.apiErrorMessage,
    });
    await open();
    assert.equal(refreshed, 1);
    assert.equal(error, expected);
  }
});

test('startup recovery cannot restore an account after its token was replaced or logged out', async () => {
  let token = 'old', finish, users = 0, slot = 0;
  const effects = [];
  const recovery = new Promise(resolve => { finish = resolve; });
  const react = { createContext: () => ({ Provider: 'provider' }), useContext() {}, useEffect: fn => effects.push(fn), useState: initial => { const index = slot++; return [initial, () => { if (index === 0) users++; }]; } };
  const api = { get: async () => ({ data: { id: 1 } }) };
  const native = { desktopOffline: { available: () => false, local: () => true, recoverLocal: () => recovery } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/context/AuthContext.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, localStorage: { getItem: () => token }, window: {}, require: path => path === 'react' ? react : path === 'react/jsx-runtime' ? { jsx() {} } : path === '../api/client' ? { __esModule: true, default: api } : path === '../lib/desktopOffline' ? native : { readAuthCache() {}, authDenied: () => false },
  });
  exports.AuthProvider({ children: null });
  effects[0]();
  await new Promise(setImmediate);
  token = null;
  finish();
  await new Promise(setImmediate);
  assert.equal(users, 0);
});
