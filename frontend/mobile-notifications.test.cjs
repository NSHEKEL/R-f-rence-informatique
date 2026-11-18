const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('return notifications use their own document, negative amount and original ticket as secondary text', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/mobileNotifications.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports });
  const notices = exports.mobileNotifications(
    [{ reference: 'VNT-0001', date: '2026-11-17T12:00:00Z', total: 190000 }],
    [{ reference: 'AVR-0005', sale_reference: 'VNT-0001', date: '2026-11-18T12:00:00Z', total: 190000 }],
  );
  assert.equal(notices[0].title, 'Retour AVR-0005');
  assert.equal(notices[0].amount, -190000);
  assert.equal(notices[0].secondary, 'Ticket VNT-0001');
  assert.equal(notices[0].isReturn, true);
  assert.equal(notices[1].amount, 190000);
  assert.equal(exports.mobileNotifications([], []).length, 0);
  assert.equal(exports.mobileNotifications([], [{ reference: 'RET-1', sale_reference: '', date: '', total: -5 }])[0].amount, -5);
});
