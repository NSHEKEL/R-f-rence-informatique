const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

test('the shipped cash page submits its confirmed session id', () => {
  const html = readFileSync(`${__dirname}/dist/index.html`, 'utf8');
  const script = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  const bundle = readFileSync(`${__dirname}/dist${script}`, 'utf8');
  assert.match(bundle, /\.post\("\/cash-sessions\/close",\{cash_session_id:/);
});
