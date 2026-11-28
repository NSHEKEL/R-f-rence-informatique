const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(readFileSync(`${__dirname}/src/components/LogDiagnostics.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const flush = () => new Promise(setImmediate);

function setup(api, native) {
  const state = [], listeners = new Map();
  let index = 0, mounted = false, effect, cleanup;
  const exports = {};
  vm.runInNewContext(code, { exports, window: { pywebview: native ? { api: native } : undefined, addEventListener: (name,fn) => listeners.set(name,fn), removeEventListener: name => listeners.delete(name) }, require: name => {
    if (name === 'react/jsx-runtime') return { jsx: (type,props) => ({ type,props }), jsxs: (type,props) => ({ type,props }) };
    if (name === 'react') return { useState: value => { const slot = index++; if (!(slot in state)) state[slot] = value; return [state[slot], value => { state[slot] = value; }]; }, useEffect: fn => { if (!mounted) effect = fn; } };
    if (name === '../api/client') return { __esModule:true,default: api };
    throw Error(name);
  } });
  function render() { index = 0; const tree = exports.default(); if (!mounted) { mounted = true; cleanup = effect(); } return tree; }
  return { render, unmount: () => { cleanup(); assert.equal(listeners.size,0); } };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree,...nodes(tree.props?.children)];
}

test('local server log path and folder button use the authenticated local API', async () => {
  const calls = [];
  const view = setup({ get: async () => ({ data: { folder:'C:/logs',file:'C:/logs/easygest.log',local:true,can_open:true } }), post: async path => calls.push(path) });
  view.render(); await flush();
  const tree = view.render();
  assert.ok(JSON.stringify(tree).includes('C:/logs/easygest.log'));
  const button = nodes(tree).find(node => node.type === 'button');
  assert.equal(button.props.disabled,false);
  button.props.onClick(); await flush();
  assert.deepEqual(calls,['/settings/logs/open']);
  view.unmount();
});

test('remote server button stays disabled while the native workstation folder opens locally', async () => {
  const calls = [];
  const native = { log_info: async () => ({ folder:'C:/poste',file:'C:/poste/easygest.log',can_open:true }), open_logs_folder: async folder => calls.push(folder) };
  const view = setup({ get: async () => ({ data:{ folder:'C:/serveur',file:'C:/serveur/easygest.log',local:false,can_open:false } }) },native);
  view.render(); await flush();
  const buttons = nodes(view.render()).filter(node => node.type === 'button');
  assert.equal(buttons[0].props.disabled,true);
  assert.equal(buttons[1].props.disabled,false);
  buttons[1].props.onClick(); await flush();
  assert.deepEqual(calls,['C:/poste']);
  view.unmount();
});

test('empty and failed log discovery give an actionable error, not an endless loading state', async () => {
  for (const get of [async () => ({ data:null }),async () => { throw Error('unavailable'); }]) {
    const view = setup({ get });
    view.render(); await flush();
    const tree = view.render();
    assert.ok(nodes(tree).some(node => node.props?.role === 'alert'));
    assert.ok(!JSON.stringify(tree).includes('Recherche du dossier'));
    view.unmount();
  }
});

test('folder open errors keep the visible copyable path', async () => {
  const view = setup({ get:async () => ({ data:{ folder:'C:/logs',file:'C:/logs/easygest.log',local:true,can_open:true } }),post:async () => { throw Error('unavailable'); } });
  view.render(); await flush();
  nodes(view.render()).find(node => node.type === 'button').props.onClick(); await flush();
  const tree = view.render();
  assert.ok(JSON.stringify(tree).includes('C:/logs/easygest.log'));
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert'));
  view.unmount();
});
