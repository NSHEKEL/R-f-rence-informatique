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
  const apiErrors = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/apiErrors.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: apiErrors });
  const dependencies = {
    '../lib/apiErrors': apiErrors,
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

test("Android and desktop expense cards retain real labels and all available metadata", () => {
  const vm = require('node:vm'), React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const output = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/components/CashExpenses.tsx`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: output, require: (name) => name === '../api/client' ? { formatXOF: (value) => `${value} FCFA` } : require(name) });
  const render = (items) => renderToStaticMarkup(React.createElement(output.default, { items }));
  const html = render([{ id: 1, label: 'Transport entrepôt', category: 'Logistique', amount: 10000,
    date: '2026-11-18T14:35:00Z', user: 'Aminata', note: 'Fret livré', payment_method: 'Espèces' }]);
  for (const value of ['Transport entrepôt', 'Logistique', '10000 FCFA', 'Aminata', 'Fret livré', '2026', '35', 'Espèces']) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /non renseigné/);
  assert.match(render([]), /Aucune dépense sur la session/);
  assert.match(render([{ label: 'Dépense historique', amount: 7 }]), /non déduit du solde espèces/);
  const cashier = readFileSync(`${__dirname}/src/pages/Caisse.tsx`, 'utf8');
  assert.match(cashier, /today.net_sales/); assert.match(cashier, /CashExpenses items=\{today.expenses/);
  const android = readFileSync(`${__dirname}/../mobile/app/src/main/java/ci/easygest/mobile/MainActivity.java`, 'utf8');
  assert.match(android, /webView.loadUrl\(server\)/);
});
