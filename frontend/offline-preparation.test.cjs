const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('local server login never prepares a workstation; remote seller preparation is unchanged', async () => {
  for (const scenario of [
    ...['', 'http://127.0.0.1:8000', 'http://localhost:8000', 'http://localhost:9000', 'http://[::1]:8000', 'http://127.0.0.2:8000', 'http://10.1.2.3:8000', 'http://SERVER-PC:8000', 'not a URL'].map(server => ({ server, remote: false })),
    { server: 'http://10.1.2.4:8000', remote: true },
    { server: 'http://10.1.2.4:8000', remote: true, cancel: true },
    { server: 'https://shop.example:8000', remote: true, prepared: true },
    { server: 'http://10.1.2.4:8000', remote: true, seller: true },
    { server: '', remote: false, denied: true },
    { server: '', remote: false, unsupported: true },
  ]) {
    let value, prompts = 0, nativeLogins = 0, onlineLogins = 0, recoveries = 0;
    const storage = new Map();
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    const window = { location: { origin: 'http://127.0.0.1:8000', hostname: '127.0.0.1' }, prompt: () => { prompts++; return scenario.cancel ? null : 'fingerprint'; }, alert() {} };
    const native = {};
    const options = { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } };
    vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/desktopOffline.ts`, 'utf8'), options).outputText, {
      exports: native, window, localStorage, URL, AbortSignal,
      fetch: async path => { if (path.endsWith('/recover')) recoveries++; return { status: 200, ok: true, json: async () => ({ supported: !scenario.unsupported, nonce: 'local', locked: true, local_hosts: ['10.1.2.3', 'server-pc'] }) }; },
    });
    await native.initializeDesktopOffline(() => scenario.server);
    assert.equal(native.desktopOffline.available(), scenario.remote, scenario.server);
    const user = { id: 1, role: scenario.seller ? 'vendeur' : 'admin' };
    native.desktopOffline.login = async () => { nativeLogins++; return { access_token: 'test', user, rights: [], offline_ready: scenario.prepared, fingerprint: 'fingerprint' }; };
    native.desktopOffline.catalogue = async () => ({ data: [] });
    const react = { createContext: () => ({ Provider: 'provider' }), useState: initial => [initial, () => {}], useEffect() {}, useContext() {} };
    const api = { post: async () => { onlineLogins++; if (scenario.denied) throw Error('denied'); return { data: { access_token: 'test' } }; }, get: async path => ({ data: path === '/auth/me' ? user : { allowed: [] } }) };
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/context/AuthContext.tsx`, 'utf8'), options).outputText, {
      exports, window, localStorage, require: path => path === 'react' ? react : path === 'react/jsx-runtime' ? { jsx: (_type, props) => { value = props.value; } } : path === '../api/client' ? { __esModule: true, default: api, getServerUrl: () => scenario.server } : path === '../lib/desktopOffline' ? native : { clearAuthCache() {}, writeAuthCache() {}, readAuthCache() {} },
    });
    exports.AuthProvider({ children: null });
    if (scenario.denied) await assert.rejects(value.login('admin', 'test'), /denied/);
    else await value.login('admin', 'test');
    const prepare = scenario.remote && !scenario.prepared && !scenario.seller;
    assert.equal(prompts, prepare ? 1 : 0, scenario.server);
    assert.equal(nativeLogins, scenario.remote ? (prepare && !scenario.cancel ? 2 : 1) : 0, scenario.server);
    assert.equal(onlineLogins, scenario.remote ? 0 : 1, scenario.server);
    assert.equal(recoveries, !scenario.remote && !scenario.denied && !scenario.unsupported ? 1 : 0, scenario.server);
  }
});

test('local recovery carries only a positive structured safe-to-close session id, never text guesses', async () => {
  for (const [detail, expected] of [
    [{ message: 'Autre caisse ouverte', close_session_id: 17 }, 17],
    [{ message: 'Autre caisse ouverte', close_session_id: -17 }, null],
    [{ message: 'Autre caisse ouverte', close_session_id: '17' }, null],
    ['Une autre caisse est ouverte pour ce vendeur', null],
  ]) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/desktopOffline.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      exports, window: { location: { origin: 'http://127.0.0.1:8000', hostname: '127.0.0.1' } },
      localStorage: { getItem() {}, setItem() {} }, URL, AbortSignal,
      fetch: async path => ({ ok: !path.endsWith('/recover'), status: path.endsWith('/recover') ? 409 : 200,
        json: async () => path.endsWith('/recover') ? { detail } : { supported: true, nonce: 'test', locked: true } }),
    });
    await exports.initializeDesktopOffline();
    await assert.rejects(exports.desktopOffline.recoverLocal('token'), error => {
      assert.equal(error.closeSessionId, expected);
      assert.equal(error.message, typeof detail === 'string' ? detail : detail.message);
      return true;
    });
  }
});
