const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('seller remains loading until their central till is known; closed till still blocks and polling errors preserve current session', async () => {
  let user = null, allowed = false, cursor = 0, value, resolve, failed = false, opened = { id: 42 };
  const state = [];
  const react = {
    createContext: () => ({ Provider: 'provider' }), useContext() {},
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return state[index] ??= { current: initial }; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect() {},
  };
  const api = { get: async () => { await new Promise(done => { resolve.push(done); }); if (failed) throw Error('offline'); return { data: opened }; } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/context/TillContext.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: path => path === 'react' ? react : path === 'react/jsx-runtime' ? { jsx: (_type, props) => { value = props.value; } } : path === '../api/client' ? { __esModule: true, default: api } : path === '../lib/apiErrors' ? { apiErrorMessage: (data, fallback) => data?.detail || fallback } : { useAuth: () => ({ user, can: () => allowed }) } });
  const render = () => { cursor = 0; exports.TillProvider({ children: null }); return value; };
  const complete = async () => { resolve.splice(0).forEach(done => done()); await new Promise(setImmediate); render(); };
  render(); await value.refresh(); render(); assert.equal(value.loading, false);
  user = { id: 2, role: 'vendeur' }; render(); assert.equal(value.loading, true);
  await value.refresh(); render(); allowed = true; render(); assert.equal(value.loading, true);
  resolve = []; const request = value.refresh(); render(); assert.equal(value.loading, true); assert.equal(value.selling, false);
  await complete(); await request; assert.equal(value.loading, false); assert.equal(value.selling, true); assert.equal(value.session.id, 42);
  failed = true; resolve = []; const offline = value.refresh(); await complete(); await offline; assert.equal(value.session.id, 42);
  failed = false; opened = null; resolve = []; const close = value.refresh(); await complete(); await close; assert.equal(value.loading, false); assert.equal(value.selling, false);
});
