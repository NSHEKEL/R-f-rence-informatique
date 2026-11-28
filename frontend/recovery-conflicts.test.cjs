const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const options = { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } };

function auth(failure, token = null, denied = false) {
  const state = [], effects = [], storage = new Map(token ? [['ri_token', token]] : []);
  let cursor = 0, value, notifications = 0;
  const native = { available: () => false, local: () => true, recoverLocal: async () => { if (failure !== null) throw failure; } };
  const react = {
    createContext: () => ({ Provider: 'provider' }), useContext() {}, useEffect: fn => effects.push(fn),
    useState(initial) { const slot = cursor++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value; }]; },
  };
  const api = { post: async () => ({ data: { access_token: 'valid' } }), get: async path => {
    if (denied) throw Error('authentication denied');
    return { data: path === '/auth/me' ? { id: 7, role: 'admin' } : { allowed: [] } };
  } };
  const output = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/context/AuthContext.tsx`, 'utf8'), options).outputText, {
    exports: output, window: { dispatchEvent: () => { notifications++; } }, CustomEvent: class {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    require: path => path === 'react' ? react : path === 'react/jsx-runtime' ? { jsx: (_type, props) => { value = props.value; } } : path === '../api/client' ? { __esModule: true, default: api } : path === '../lib/desktopOffline' ? { desktopOffline: native } : { readAuthCache() {}, clearAuthCache() {}, writeAuthCache() {}, authDenied: () => true },
  });
  const render = () => { cursor = 0; output.AuthProvider({ children: null }); return value; };
  return { render, effects, native, storage, notifications: () => notifications };
}

test('valid online login survives journal conflicts, disk errors and unknown recovery failures; retry clears the warning', async () => {
  for (const failure of [null, Error('Ancien grant invalidé après changement de mot de passe'), { message: 'Disque indisponible' }, undefined]) {
    const scenario = auth(failure);
    await scenario.render().login('hawa', 'new-password');
    let account = scenario.render();
    assert.equal(account.user.id, 7);
    assert.equal(account.isAdmin, true);
    assert.equal(account.can('reseau_consulter'), true);
    assert.equal(scenario.storage.get('ri_token'), 'valid');
    assert.equal(Boolean(account.recoveryWarning), failure !== null);
    if (failure?.message) assert.equal(account.recoveryWarning, failure.message);
    scenario.native.recoverLocal = async () => {};
    await account.retryLocalRecovery();
    assert.equal(scenario.render().recoveryWarning, '');
    assert.equal(scenario.notifications(), 1);
  }
  const rejected = auth(Error('recovery failure'), null, true);
  await assert.rejects(rejected.render().login('hawa', 'wrong-password'), /authentication denied/);
  assert.equal(rejected.render().user, null);
});

test('token startup also authenticates despite a recovery conflict', async () => {
  const scenario = auth(Error('Conflit conservé'), 'valid');
  scenario.render();
  scenario.effects[0]();
  await new Promise(setImmediate);
  const account = scenario.render();
  assert.equal(account.user.id, 7);
  assert.equal(account.recoveryWarning, 'Conflit conservé');
  assert.equal(account.loading, false);
});

test('an old separate-session exception cannot weaken close protection; successful retry clears the warning', async () => {
  const failure = Object.assign(Error('Une autre caisse bloque la reprise'), { closeSessionId: 17 });
  const scenario = auth(failure);
  await scenario.render().login('hawa', 'password');
  assert.equal(scenario.render().recoveryCloseSessionId, undefined);
  scenario.native.recoverLocal = async () => { throw Error('Journal indisponible'); };
  await scenario.render().retryLocalRecovery();
  assert.equal(scenario.render().recoveryCloseSessionId, undefined);
  scenario.native.recoverLocal = async () => {};
  await scenario.render().retryLocalRecovery();
  assert.equal(scenario.render().recoveryCloseSessionId, undefined);
  assert.equal(scenario.render().recoveryWarning, '');
});

test('recovery warning leaves Configuration reachable instead of trapping the admin in the opening modal', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  let warning = 'Conflit de grant — original conservé';
  const output = {};
  const dependencies = {
    react: React,
    '../context/AuthContext': { useAuth: () => ({ can: () => true, isAdmin: true, recoveryWarning: warning, retryLocalRecovery: async () => {} }) },
    '../context/TillContext': { useTill: () => ({ session: null, dayClosed: false, loading: false }) },
    'react-router-dom': { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
    '../api/client': {}, '../lib/apiErrors': {},
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/components/TillGate.tsx`, 'utf8'), options).outputText, { exports: output, require: path => dependencies[path] || require(path) });
  const render = () => renderToStaticMarkup(React.createElement(output.default));
  const html = render();
  assert.match(html, /Connexion établie/);
  assert.match(html, /Conflit de grant/);
  assert.match(html, /href="\/parametres"/);
  assert.match(html, /Réessayer la reprise/);
  assert.doesNotMatch(html, /Ouverture de la caisse|Ouvrir ma caisse/);
  warning = '';
  assert.match(render(), /Ouverture de la caisse/);
});

test('a recovery warning does not let the cash page open a second till', async () => {
  const source = ts.createSourceFile('Caisse.tsx', readFileSync(`${__dirname}/src/pages/Caisse.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let opening, error;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openTill') opening = node; ts.forEachChild(node, visit); }
  visit(source);
  const open = vm.runInNewContext(ts.transpileModule(`(${opening.getText(source)})`, options).outputText, {
    printJob: null, recoveryWarning: 'Reprise à vérifier', tillReadError: '', setError: value => { error = value; },
    api: { post: () => assert.fail('must not reopen the till') },
  });
  await open();
  assert.equal(error, 'Reprise à vérifier');
});
