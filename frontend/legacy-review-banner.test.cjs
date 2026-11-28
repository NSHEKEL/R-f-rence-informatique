const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('legacy rejects remain visibly reviewable without becoming a pending sync sale', () => {
  const code = ts.transpileModule(readFileSync(`${__dirname}/src/components/NetworkBanner.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const rows of [undefined, [], [{ id: 'old-id', reference: 'OLD-TICKET-KEPT', reason: 'Vérifiez les pièces' }]]) {
    const exports = {};
    vm.runInNewContext(code, { exports, require: name => {
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, ...props }), jsxs: (type, props) => ({ type, ...props }) };
      if (name === 'lucide-react') return {};
      if (name.includes('NetworkContext')) return { useNetwork: () => ({ online: true, pendingCount: 0, syncErrors: [], rejected: [], journal: { pending: [], to_review: rows } }) };
      throw Error(name);
    } });
    const rendered = JSON.stringify(exports.default());
    assert.equal(rendered.includes('OLD-TICKET-KEPT'), Boolean(rows?.length));
    assert.equal(rendered.includes('hors file de synchronisation'), Boolean(rows?.length));
    assert.ok(!rendered.includes('vente(s) en attente'));
  }
});
