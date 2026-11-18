const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup() {
  let listener, options, removed;
  const document = {
    activeElement: null,
    addEventListener(type, handler, config) {
      assert.equal(type, "wheel");
      listener = handler;
      options = config;
    },
    removeEventListener(type, handler, capture) { removed = [type, handler, capture]; },
  };
  class HTMLInputElement {
    constructor(type) { this.type = type; this.value = "10"; this.blurs = 0; }
    blur() { this.blurs++; document.activeElement = null; }
  }
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/numberWheel.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, document, HTMLInputElement });
  const cleanup = exports.installNumberWheelGuard();
  return { document, HTMLInputElement, listener, options, cleanup, removed: () => removed };
}

test("focused numeric inputs blur before wheel default action without cancelling page scroll", () => {
  const { document, HTMLInputElement, listener, options } = setup();
  assert.equal(options.passive, true);
  assert.equal(options.capture, true);
  for (const deltaY of [-100, 100]) {
    const input = new HTMLInputElement("number");
    document.activeElement = input;
    const event = { target: input, deltaY, preventDefault() { assert.fail("Scrolling must not be cancelled"); } };
    listener(event);
    if (document.activeElement === input) input.value = String(Number(input.value) + 1);
    assert.equal(input.value, "10");
    assert.equal(input.blurs, 1);
    assert.equal(document.activeElement, null);
  }
});

test("wheel elsewhere leaves focused fields alone, and the listener can be removed", () => {
  const { document, HTMLInputElement, listener, cleanup, removed } = setup();
  const focused = new HTMLInputElement("number");
  document.activeElement = focused;
  for (const target of [null, {}, new HTMLInputElement("number")]) listener({ target });
  assert.equal(focused.blurs, 0);
  assert.equal(document.activeElement, focused);
  const text = new HTMLInputElement("text");
  document.activeElement = text;
  listener({ target: text });
  assert.equal(text.blurs, 0);
  cleanup();
  assert.deepEqual(removed(), ["wheel", listener, true]);
  const main = readFileSync(`${__dirname}/src/main.tsx`, "utf8");
  assert.equal(main.split("installNumberWheelGuard();").length - 1, 1);
});
