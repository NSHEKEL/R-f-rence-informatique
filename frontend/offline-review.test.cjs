const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('orphan review requires a reason and confirmation and reports failure without losing the original', async () => {
  const source = ts.createSourceFile('OfflineSettings.tsx', readFileSync(`${__dirname}/src/components/OfflineSettings.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'review') handler = node; ts.forEachChild(node, visit); }
  visit(source);
  for (const [reason, confirm, failure, expectedCalls] of [[null, true, false, 0], ['abc', true, false, 0], ['Pièces vérifiées', false, false, 0], ['Pièces vérifiées', true, false, 1], ['Pièces vérifiées', true, true, 1]]) {
    const calls = []; let message = '', rows;
    const review = vm.runInNewContext(ts.transpileModule(`(${handler.getText(source)})`, {}).outputText, {
      window: { prompt: () => reason, confirm: () => confirm },
      api: { post: async (...args) => { calls.push(args); if (failure) throw Error('403'); }, get: async () => ({ data: ['retained original'] }) },
      setMessage: value => { message = value; }, setEvents: value => { rows = value; },
    });
    await review({ id: 'orphan-id' });
    assert.equal(calls.length, expectedCalls);
    if (calls.length) {
      assert.equal(calls[0][0], '/offline/events/orphan-id/resolve');
      assert.equal(calls[0][1].review, true);
      assert.equal(calls[0][1].reason, reason);
      assert.match(message, failure ? /refusé.*original reste conservé/ : /aucune opération comptabilisée/);
      assert.equal(rows?.[0], failure ? undefined : 'retained original');
    }
  }
});
