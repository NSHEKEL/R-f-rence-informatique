const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const html = readFileSync(`${__dirname}/index.html`, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function boot(extra = {}) {
  const listeners = {};
  const window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  if (extra.caches) window.caches = extra.caches;
  Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('offline storage must not be touched'); } });
  const location = { href: 'http://127.0.0.1:8000/?eg_boot=test', reload: () => { location.reloads++; }, reloads: 0 };
  vm.runInNewContext(script, { window, location, URL, Promise, navigator: {}, ...extra });
  return { window, location, listeners };
}

test('early module and runtime errors queue until bridge ready, with explicit mounted signal only', async () => {
  const { window, listeners } = boot();
  window.onerror('SyntaxError', '/assets/current.js?private=value', 1);
  listeners.error({ target: { tagName: 'SCRIPT', src: '/assets/old.js?private=value' } });
  listeners.unhandledrejection({ reason: new Error('startup failed') });
  const errors = [];
  const ready = [];
  window.pywebview = { api: { frontend_error: (...args) => errors.push(args), frontend_ready: (...args) => ready.push(args) } };
  listeners.pywebviewready();
  assert.equal(errors.length, 3);
  assert.ok(errors.every(([message, token]) => token === 'test' && !message.includes('private=value')));
  assert.equal(ready.length, 0);
  window.__easygestStartup.mounted();
  window.__easygestStartup.mounted();
  assert.deepEqual(ready, [['test']]);
});

test('plain browsers and bridges without new methods stay usable', () => {
  const { window, listeners } = boot();
  window.__easygestStartup.mounted();
  window.pywebview = { api: {} };
  assert.doesNotThrow(() => listeners.pywebviewready());
  assert.doesNotThrow(() => listeners.error({ target: null }));
  assert.doesNotThrow(() => listeners.unhandledrejection({ reason: null }));
});

test('old workers and CacheStorage are removed, controlled page reloads once, offline storage untouched', async () => {
  let unregistered = 0;
  const deleted = [];
  const { location } = boot({ navigator: { serviceWorker: { controller: {}, getRegistrations: async () => [{ unregister: async () => { unregistered++; } }] } },
    caches: { keys: async () => ['old-shell'], delete: async (key) => deleted.push(key) } });
  await new Promise(setImmediate);
  assert.equal(unregistered, 1);
  assert.deepEqual(deleted, ['old-shell']);
  assert.equal(location.reloads, 1);
});

test('no worker is an empty success; worker cleanup failure is reported without blocking mount', async () => {
  const empty = boot({ navigator: { serviceWorker: { getRegistrations: async () => [] } } });
  const failed = boot({ navigator: { serviceWorker: { getRegistrations: async () => { throw new Error('denied'); } } } });
  await new Promise(setImmediate);
  assert.equal(empty.location.reloads, 0);
  const errors = [];
  let ready = 0;
  failed.window.pywebview = { api: { frontend_error: (message) => errors.push(message), frontend_ready: () => { ready++; } } };
  failed.listeners.pywebviewready();
  failed.window.__easygestStartup.mounted();
  assert.match(errors[0], /Nettoyage service worker: denied/);
  assert.equal(ready, 1);
});

test('React acknowledges only after its mounted effect, not render scheduling', () => {
  const React = require('react');
  const effects = [];
  let tree;
  let mounted = 0;
  const exports = {};
  const window = { __easygestStartup: { mounted: () => { mounted++; } } };
  const hooks = { ...React, useEffect: (fn) => effects.push(fn) };
  const component = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/components/FrontendMounted.tsx`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: component, window, require: () => hooks });
  const source = readFileSync(`${__dirname}/src/main.tsx`, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false } }).outputText;
  vm.runInNewContext(code, { exports, document: { getElementById: () => ({}) }, window, require: (name) => {
    if (name === 'react') return hooks;
    if (name === './components/FrontendMounted') return component;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-dom/client') return { createRoot: () => ({ render: (node) => { tree = node; } }) };
    return new Proxy({}, { get: () => () => null });
  } });
  assert.equal(mounted, 0);
  const signal = tree.props.children;
  signal.type({ children: null });
  assert.equal(mounted, 0);
  effects[0]();
  assert.equal(mounted, 1);
  assert.ok(html.indexOf('<script>') < html.indexOf('src="/src/main.tsx"'));
});
