const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('legacy import labels rejected archives, retains originals on error or concurrent queue change', async () => {
  const code = ts.transpileModule(readFileSync(`${__dirname}/src/lib/desktopOffline.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const mode of ['success', 'error', 'short-ack', 'concurrent-change', 'empty']) {
    const original = JSON.stringify([{ scope: 'shop:1', snapshot: { reference: 'original' }, payload: { quantity: 0.5 } }]);
    const storage = new Map(mode === 'empty' ? [] : [['ri_pending_sales', original], ['ri_rejected_sales', original]]);
    const exports = {};
    vm.runInNewContext(code, { exports, window: {}, localStorage: { getItem: key => storage.get(key) || null, removeItem: key => storage.delete(key) }, URL, AbortSignal });
    const requests = [];
    exports.desktopOffline.command = async (action, payload) => {
      requests.push({ action, payload });
      if (mode === 'error') throw Error('disk unavailable');
      if (mode === 'concurrent-change') storage.set(payload.entries[0].state === 'rejected' ? 'ri_rejected_sales' : 'ri_pending_sales', JSON.stringify([{ scope: 'shop:1', snapshot: { reference: 'new queue contents' } }]));
      return { stored: mode === 'short-ack' ? 0 : payload.entries.length };
    };
    await exports.desktopOffline.importLegacy();
    assert.equal(requests.length, mode === 'empty' ? 0 : 2);
    if (requests.length) {
      assert.equal(requests[0].payload.entries[0].state, undefined);
      assert.equal(requests[1].payload.entries[0].state, 'rejected');
      assert.equal(requests[1].payload.entries[0].snapshot.reference, 'original');
      assert.equal(requests[1].payload.entries[0].payload.quantity, 0.5);
    }
    if (mode === 'success' || mode === 'empty') assert.equal(storage.size, 0);
    else for (const value of storage.values()) {
      if (mode === 'concurrent-change') assert.equal(JSON.parse(value)[0].snapshot.reference, 'new queue contents');
      else assert.equal(value, original);
    }
  }
});
