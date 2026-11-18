const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

test('offline authorization cache is session scoped, survives network failure and clears explicitly', () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/authCache.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, localStorage: storage });
  assert.equal(exports.readAuthCache('token'), null);
  exports.writeAuthCache('token', { id: 1, role: 'vendeur' }, ['vente_nouvelle', 'caisse']);
  assert.equal(exports.readAuthCache('other'), null);
  assert.equal(exports.authDenied(new Error('network')), false);
  assert.equal(exports.readAuthCache('token').rights.length, 2);
  assert.equal(exports.authDenied({ response: { status: 503 } }), false);
  for (const status of [401, 403]) assert.equal(exports.authDenied({ response: { status } }), true);
  exports.clearAuthCache();
  assert.equal(exports.readAuthCache('token'), null);
  const source = readFileSync(`${__dirname}/src/context/AuthContext.tsx`, 'utf8');
  assert.match(source, /setRights\(readAuthCache\(token\)\?\.rights/);
  assert.match(source, /if \(authDenied\(error\)\) \{ setRights\(\[\]\); clearAuthCache\(\); \}/);
});

test('printing save persists company first, then canonical print settings', () => {
  const source = readFileSync(`${__dirname}/src/components/PrintingSettings.tsx`, 'utf8');
  const save = source.slice(source.indexOf('async function save()'), source.indexOf('async function save()') + 1450);
  assert.ok(save.indexOf('await saveCompany()') < save.indexOf('api.put<PrintingConfig>'));
  assert.equal((save.match(/await saveCompany\(\)/g) || []).length, 1);
});
