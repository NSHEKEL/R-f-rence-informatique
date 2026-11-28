const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const source = readFileSync(`${__dirname}/src/components/GlobalCash.tsx`, "utf8");
const file = ts.createSourceFile("GlobalCash.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(file);
  assert.ok(result);
  return result;
}
function evaluate(expression, context) {
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {}).outputText, context);
}

test("visible global cash refreshes every 15s and on sync/focus/visibility, with complete cleanup", () => {
  const effect = find((node) => ts.isCallExpression(node) && node.expression.getText(file) === "useEffect");
  assert.equal(effect.arguments[1].getText(file), "[load, version]");
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = "visible";
  let calls = 0, tick, cleared;
  window.setInterval = (fn, delay) => { assert.equal(delay, 15000); tick = fn; return 17; };
  window.clearInterval = (id) => { cleared = id; };
  const requestId = { current: 0 };
  const cleanup = evaluate(effect.arguments[0].getText(file), { window, document, load: () => { calls++; }, requestId })();
  assert.equal(calls, 1);
  tick(); window.dispatchEvent(new Event("ri:synced")); window.dispatchEvent(new Event("focus"));
  assert.equal(calls, 4);
  document.visibilityState = "hidden";
  tick(); window.dispatchEvent(new Event("ri:synced")); document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 4);
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 5);
  cleanup();
  assert.equal(cleared, 17);
  assert.equal(requestId.current, 1);
  window.dispatchEvent(new Event("ri:synced")); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 5);
});

test("slow old refreshes cannot overwrite the newest global cash response", async () => {
  const declaration = find((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === "load");
  const pending = [];
  let report, closures, error;
  const load = evaluate(declaration.initializer.arguments[0].getText(file), {
    requestId: { current: 0 }, from: "2026-01-01", to: "2026-01-01", Promise,
    api: { get: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    setReport: (value) => { report = value; }, setClosures: (value) => { closures = value; }, setError: (value) => { error = value; },
    axios: { isAxiosError: () => false },
  });
  const old = load(), current = load();
  pending[2].resolve({ data: "new sale and seller closure" }); pending[3].resolve({ data: [] }); await current;
  pending[0].resolve({ data: "old" }); pending[1].resolve({ data: ["old history"] }); await old;
  assert.equal(report, "new sale and seller closure"); assert.deepEqual(closures, []); assert.equal(error, "");
  const failed = load(); pending[4].reject(new Error("offline")); pending[5].resolve({ data: [] }); await failed;
  assert.equal(report, null); assert.equal(error, "Centralisation indisponible");
});

test("seller closure summary and flows render, then global close returns to the live empty view", async () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const groups = { cash: 100, mobile_money: 0, bank: 0, credit: 0, other: 0 };
  const empty = { payments: {}, payment_groups: {}, cashiers: [], sessions: [], opening_balance: 0, expected_cash: 0, open_sessions: 0 };
  const report = { ...empty, total_sales: 100, inflow_groups: groups, outflow_groups: {}, sessions: [{ session_id: 2, cashier: "Vendeuse", workstation: "Poste 2", closed_at: "2026-01-01T12:00:00Z", payment_groups: groups, total_sales: 100, expected_cash: 600, counted_cash: 600, difference: 0 }] };
  const state = ["2026-01-01", "2026-01-01", report, [], null, "", false, false, "600", ""];
  let index = 0;
  const dependencies = {
    react: { ...React, useState: () => { const i = index++; return [state[i], (value) => { state[i] = value; }]; }, useRef: () => ({ current: 0 }), useCallback: (fn) => fn, useEffect: () => {} },
    axios: { default: { isAxiosError: () => false } },
    "../api/client": { default: { get: async (path) => ({ data: path.endsWith("/closures") ? [{ ...report, id: 9 }] : empty }), post: async () => ({ data: { ...report, id: 9 } }) }, formatXOF: (value) => String(value ?? 0) },
    "../lib/apiErrors": {}, "../context/SyncContext": { useSyncVersion: () => 0 }, "./Modal": { default: () => null },
    "../context/AuthContext": { useAuth: () => ({ recoveryWarning: '' }) }, "../context/NetworkContext": { useNetwork: () => ({ pendingCount: 0 }) },
  };
  const output = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false } }).outputText, { exports: output, require: (name) => dependencies[name] || require(name) });
  const render = () => { index = 0; return output.default(); };
  const tree = render(), html = renderToStaticMarkup(tree);
  assert.match(html, /Clôtures individuelles reçues/); assert.match(html, /Vendeuse/); assert.match(html, /Poste 2/); assert.match(html, /Recettes et sorties de caisse par mode/);
  const modal = tree.props.children.find((child) => child?.props?.title === "Confirmer la clôture globale");
  await modal.props.footer.props.onClick();
  assert.equal(state[4], null);
  const refreshed = renderToStaticMarkup(render());
  assert.doesNotMatch(refreshed, /récapitulatif figé|Clôtures individuelles reçues|Vendeuse/);
  assert.match(refreshed, /0 session\(s\) encore ouverte\(s\)/);
});

test('global close refuses local recovery warnings or a pending journal before any request', async () => {
  const close = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'close');
  for (const recoveryWarning of ['Journal en conflit', '']) {
    let error;
    const run = evaluate(close.getText(file), {
      recoveryBlocksClose: true, recoveryWarning, setError: value => { error = value; },
      api: { post() { assert.fail('pending journal must block global close'); } },
    });
    await run();
    assert.match(error, /Journal en conflit|Récupérez les opérations hors ligne/);
  }
  assert.match(source, /disabled=\{recoveryBlocksClose \|\| !data.sessions.length/);
  assert.match(source, /disabled=\{recoveryBlocksClose \|\| saving/);
});
