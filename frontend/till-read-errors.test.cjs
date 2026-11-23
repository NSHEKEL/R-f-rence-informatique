const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const options = { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } };

function scenario(contextSource, gateSource) {
  const state = []; let cursor = 0, value, failure = null, failPath = '/cash-sessions/current', session = { id: 17 }, user = { id: 7, role: 'vendeur' };
  const react = {
    createContext: () => ({ Provider: 'provider' }), useContext() {}, useEffect() {},
    useState(initial) { const slot = cursor++; if (!(slot in state)) state[slot] = initial; return [state[slot], next => { state[slot] = next; }]; },
    useRef(initial) { const slot = cursor++; return state[slot] ??= { current: initial }; },
    useCallback: fn => fn, useMemo: fn => fn(),
  };
  const api = { get: async path => { if (failure && path === failPath) throw failure; return { data: session }; } };
  const errors = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/apiErrors.ts`, 'utf8'), options).outputText, { exports: errors });
  const output = {};
  vm.runInNewContext(ts.transpileModule(contextSource, options).outputText, { exports: output, require: path => path === 'react' ? react : path === 'react/jsx-runtime' ? { jsx: (_type, props) => { value = props.value; } } : path === '../api/client' ? { __esModule: true, default: api } : path === '../lib/apiErrors' ? errors : { useAuth: () => ({ user, can: () => true }) } });
  const gate = {};
  vm.runInNewContext(ts.transpileModule(gateSource, options).outputText, { exports: gate, require: path => path === '../context/AuthContext' ? { useAuth: () => ({ can: () => true }) } : path === '../context/TillContext' ? { useTill: () => value } : path === '../api/client' ? { __esModule: true, default: api } : path === '../lib/apiErrors' ? errors : require(path) });
  return {
    render() { cursor = 0; output.TillProvider({ children: null }); return value; },
    fail(error, path = '/cash-sessions/current') { failure = error; failPath = path; },
    setSession(next) { session = next; }, setUser(next) { user = next; },
    html() { return renderToStaticMarkup(React.createElement(gate.default)); },
  };
}
const context = readFileSync(`${__dirname}/src/context/TillContext.tsx`, 'utf8');
const gate = readFileSync(`${__dirname}/src/components/TillGate.tsx`, 'utf8');

test('a failed current or today read is not an absent till; retry preserves its identity and details', async () => {
  for (const [path, failure, message] of [
    ['/cash-sessions/current', { response: { status: 500, data: 'Internal Server Error' } }, 'Internal Server Error (HTTP 500)'],
    ['/cash-sessions/today', { response: { status: 409, data: { detail: 'Clôture historique illisible' } } }, 'Clôture historique illisible (HTTP 409)'],
    ['/cash-sessions/current', { message: 'timeout of 15000ms exceeded' }, 'timeout of 15000ms exceeded'],
    ['/cash-sessions/current', { response: { status: 401, data: { detail: 'Identifiants invalides' } } }, 'Identifiants invalides (HTTP 401)'],
  ]) {
    const app = scenario(context, gate);
    app.fail(failure, path);
    await app.render().refresh();
    assert.equal(app.render().session, null);
    assert.equal(app.render().readError, message);
    assert.match(app.html(), /Réessayer la lecture/);
    assert.doesNotMatch(app.html(), /Ouverture de la caisse|Ouvrir ma caisse/);
    app.fail(null);
    await app.render().refresh();
    assert.equal(app.render().session.id, 17);
    assert.equal(app.render().readError, '');
    assert.doesNotMatch(app.html(), /Ouverture de la caisse/);
  }
  const empty = scenario(context, gate);
  empty.setSession(null);
  await empty.render().refresh();
  empty.render();
  assert.match(empty.html(), /Ouverture de la caisse/);
});

test('account changes cannot expose the previous user’s till when their read fails', async () => {
  const app = scenario(context, gate);
  await app.render().refresh();
  assert.equal(app.render().session.id, 17);
  app.setUser({ id: 8, role: 'vendeur' });
  app.fail({ response: { status: 403, data: { detail: 'Compte désactivé' } } });
  assert.equal(app.render().session, null);
  await app.render().refresh();
  assert.equal(app.render().session, null);
  assert.equal(app.render().selling, false);
  assert.match(app.html(), /Compte désactivé/);
});
