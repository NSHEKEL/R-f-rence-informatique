const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('the printable Z retains warnings and never prints a missing refund amount as zero', () => {
  const code = ts.transpileModule(readFileSync(`${__dirname}/src/components/ZReport.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code,{ exports,require: name => {
    if (name === 'react/jsx-runtime') return { jsx:(type,props) => ({ type,props }),jsxs:(type,props) => ({ type,props }) };
    if (name === 'react-dom') return { createPortal: value => value };
    if (name === '../api/client') return { formatXOF: value => String(value) };
    throw Error(name);
  } });
  for (const warnings of [undefined,[],['Règlement #17 : sens inconnu, non inclus']]) {
    const rendered = JSON.stringify(exports.default({ report:{ data_warnings:warnings,payments:{},expenses:[],deposits:[],refunds:[{ reference:'R-17',total:null }] },format:'80mm',inline:true }));
    assert.equal(rendered.includes('sens inconnu'),Boolean(warnings?.length));
    assert.ok(rendered.includes('Non renseigné'));
  }
});
