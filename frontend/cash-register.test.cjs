const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const ts = require("typescript");

function stringsAndIdentifiers(page) {
  const file = ts.createSourceFile(page, readFileSync(`${__dirname}/src/pages/${page}.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isIdentifier(node) || ts.isJsxText(node)) values.push(node.text.trim());
    ts.forEachChild(node, visit);
  }
  visit(file);
  return values;
}

test("sale pages expose neither closing controls nor the closing API", () => {
  for (const page of ["Sales", "NouvelleVente"]) {
    const values = stringsAndIdentifiers(page);
    for (const forbidden of ["Fermer ma caisse", "Fermeture de caisse", "/cash-sessions/close", "closeTill", "CashTicket"]) {
      assert.equal(values.includes(forbidden), false, `${page}: ${forbidden}`);
    }
  }
});

test("Ma caisse owns closing, movements and their dedicated permissions", () => {
  const values = stringsAndIdentifiers("Caisse");
  for (const expected of ["/cash-sessions/close", "/cash-sessions/movements", "caisse_operations", "recette_enregistrer", "soldes_consulter", "movementAmount", "movementReason"]) {
    assert.equal(values.includes(expected), true, expected);
  }
});

test("Ma caisse renders a previous-day open session with closing available", async () => {
  const vm = require('node:vm');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const state = [];
  let index = 0;
  let effect;
  let allowClose = true;
  const session = { id: 17, business_day: '2026-11-07', opened_at: '2026-11-07T08:00:00Z', closed_at: null, sales: [] };
  const requests = [];
  const api = { get: async (path) => {
    requests.push(path);
    return { data: path === '/cash-sessions/today' ? session : [] };
  } };
  const hooks = { ...React,
    useState: (initial) => {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], (value) => { state[slot] = value; }];
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => { effect = fn; },
  };
  const dependencies = {
    react: hooks,
    'react-router-dom': { Link: ({ to, children }) => React.createElement('a', { href: to }, children) },
    '../api/client': { default: api, formatXOF: (value) => String(value ?? 0) },
    '../context/AuthContext': { useAuth: () => ({ user: { name: 'Admin' }, isAdmin: true, can: (key) => key === 'caisse_fermer' ? allowClose : true }) },
    '../context/TillContext': { useTill: () => ({ refresh: async () => {} }) },
    '../context/CompanyContext': { useCompany: () => ({ company: {}, printing: { receipt: { width: '80mm' } } }) },
    '../context/SyncContext': { useSyncVersion: () => 0 },
    '../lib/fullscreen': {}, '../lib/print': {},
  };
  const output = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/pages/Caisse.tsx`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false },
  }).outputText, { exports: output, require: (name) => dependencies[name] || (name.startsWith('../components/') ? { default: () => null } : require(name)) });
  const render = () => { index = 0; return renderToStaticMarkup(React.createElement(output.default)); };
  assert.match(render(), /Ouvrir ma caisse/);
  effect();
  await new Promise(setImmediate);
  const html = render();
  assert.match(html, /Caisse ouverte depuis le 2026-11-07/);
  assert.match(html, /Fermer ma caisse/);
  assert.doesNotMatch(html, /Ouvrir ma caisse|Caisse non ouverte/);
  assert.ok(requests.includes('/cash-sessions/17/movements'));
  allowClose = false;
  assert.doesNotMatch(render(), /Fermer ma caisse/);
});
