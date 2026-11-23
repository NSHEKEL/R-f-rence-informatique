const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = readFileSync(`${__dirname}/src/components/GlobalCash.tsx`, 'utf8');

function mount(warnings, { acknowledge = true, fail = false, archived = false } = {}) {
  const groups = { cash: 0, mobile_money: 0, bank: 0, credit: 0, other: 0 };
  const report = { data_warnings: warnings, date_from: '2026-11-23', date_to: '2026-11-23', payments: {}, payment_groups: groups, cashiers: [],
    sessions: [{ session_id: 1, cashier: 'HAWA', workstation: 'Serveur', business_day: '2026-11-23', opened_at: '2026-11-23T08:00:00Z', closed_at: '2026-11-23T10:00:00Z', payment_groups: groups, total_sales: 0, expected_cash: 500, counted_cash: 500 }],
    total_sales: 0, opening_balance: 500, expected_cash: 500, counted_cash: 500, open_sessions: 0 };
  const archive = { ...report, id: 9 };
  const state = ['2026-11-23', '2026-11-23', report, [archive], archived ? archive : null, '', false, false, '500', ''];
  const confirmations = [];
  let posts = 0, index = 0;
  const api = { get: async path => ({ data: path.endsWith('/closures') ? [archive] : report }), post: async () => {
    posts++;
    if (fail) throw { response: { data: { detail: 'Archive indisponible' } } };
    return { data: archive };
  } };
  const dependencies = {
    react: { ...React, useState: () => { const slot = index++; return [state[slot], value => { state[slot] = value; }]; }, useRef: () => ({ current: 0 }), useCallback: fn => fn, useEffect: () => {} },
    axios: { default: { isAxiosError: () => true } }, '../api/client': { default: api, formatXOF: value => String(value ?? 0) },
    '../lib/apiErrors': { apiErrorMessage: (detail, fallback) => detail || fallback }, '../context/SyncContext': { useSyncVersion: () => 0 },
    '../context/AuthContext': { useAuth: () => ({ recoveryWarning: '' }) }, '../context/NetworkContext': { useNetwork: () => ({ pendingCount: 0 }) }, './Modal': { default: () => null },
  };
  const output = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false } }).outputText,
    { exports: output, require: name => dependencies[name] || require(name), window: { confirm: message => { confirmations.push(message); return acknowledge; } } });
  const tree = output.default();
  const modal = tree.props.children.find(child => child?.props?.title === 'Confirmer la clôture globale');
  return { html: renderToStaticMarkup(tree), close: modal.props.footer.props.onClick, confirmations, state, posts: () => posts };
}

test('current and archived global reports display orphan warnings; clean and legacy reports have no alert', () => {
  for (const archived of [false, true]) {
    const view = mount(['Caisse #1 (HAWA) : Règlement #17, sens inconnu, original conservé'], { archived });
    assert.match(view.html, /role="alert"/);
    assert.match(view.html, /Règlement #17/);
    assert.match(view.html, /vérifier avant l&#x27;archivage/);
  }
  for (const warnings of [undefined, []]) assert.doesNotMatch(mount(warnings).html, /Anomalies conservées/);
});

test('warnings require acknowledgement, but do not prevent the acknowledged close or clean closes', async () => {
  const cancelled = mount(['Règlement #17, non inclus'], { acknowledge: false });
  await cancelled.close();
  assert.equal(cancelled.posts(), 0);
  assert.match(cancelled.confirmations[0], /Règlement #17, non inclus/);
  const accepted = mount(['Règlement #17, non inclus']);
  await accepted.close();
  assert.equal(accepted.posts(), 1);
  for (const warnings of [undefined, []]) {
    const clean = mount(warnings);
    await clean.close();
    assert.equal(clean.posts(), 1);
    assert.equal(clean.confirmations.length, 0);
  }
});

test('an archive error after acknowledgement remains visible and releases the saving state', async () => {
  const view = mount(['Règlement #17, non inclus'], { fail: true });
  await view.close();
  assert.equal(view.posts(), 1);
  assert.equal(view.state[5], 'Archive indisponible');
  assert.equal(view.state[7], false);
});
