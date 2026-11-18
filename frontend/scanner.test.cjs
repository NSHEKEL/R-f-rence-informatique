const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
function load(name, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/${name}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (key) => deps[key] || {} });
  return exports;
}
const { ScanCapture, scanCandidates, scanQueue, scanTargetAllowed } = load("scanCapture");
const settings = { scanner_prefix: "", scanner_suffix: "Enter", scanner_min_length: 3 };
function key(character, code = "") { return { key: character, code, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false }; }
function stream(capture, text, options = {}) {
  let now = options.start || 0;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    capture.feed(key(character, options.codes?.[i] || (/\d/.test(character) ? `Digit${character}` : /[a-z]/i.test(character) ? `Key${character.toUpperCase()}` : "")), now += options.gap || 10, options.settings || settings);
  }
  return capture.feed(key((options.settings || settings).scanner_suffix), now + 10, options.settings || settings);
}
test("QWERTY/AZERTY digit and letter streams, shift/CapsLock independent physical codes, fast and slow scanners", () => {
  for (const gap of [5, 120, 175]) {
    assert.ok(stream(new ScanCapture(), "0123456789", { gap }).includes("0123456789"));
    assert.ok(stream(new ScanCapture(), '&é"\'(-è_çà', { gap, codes: [..."1234567890"].map((n) => `Digit${n}`) }).includes("1234567890"));
    assert.ok(stream(new ScanCapture(), "qz,", { gap, codes: ["KeyA", "KeyW", "KeyM"] }).includes("AWM"));
  }
  assert.ok(scanCandidates("azm").includes("qw,"));
  assert.ok(scanCandidates("\x02ABC\x03").includes("ABC"));
});
test("prefix, Tab suffix, min length, double read and genuine repeat outside 300ms", () => {
  const capture = new ScanCapture();
  const config = { ...settings, scanner_prefix: "]C1", scanner_suffix: "Tab" };
  assert.ok(stream(capture, "]C112345", { settings: config }).includes("12345"));
  assert.equal(stream(capture, "]C112345", { settings: config, start: 100 }).length, 0);
  assert.ok(stream(capture, "]C112345", { settings: config, start: 600 }).includes("12345"));
  assert.equal(stream(new ScanCapture(), "12"), null);
});
test("ordinary slow typing and composition/modifier streams are not captured", () => {
  assert.equal(stream(new ScanCapture(), "ABC", { gap: 250 }), null);
  for (const flag of ["isComposing", "ctrlKey", "altKey", "metaKey", "repeat"]) {
    const capture = new ScanCapture();
    capture.feed({ ...key("a", "KeyA"), [flag]: true }, 10, settings);
    assert.equal(capture.feed(key("Enter"), 20, settings), null);
  }
});
test("unfocused scanner capture never steals unrelated fields or dialogs, including a POS input behind a modal", () => {
  assert.equal(scanTargetAllowed(false, false, false, false, false), true);
  assert.equal(scanTargetAllowed(true, true, false, false, false), true);
  assert.equal(scanTargetAllowed(false, true, false, false, false), false);
  assert.equal(scanTargetAllowed(true, true, true, false, false), false);
  assert.equal(scanTargetAllowed(false, false, true, true, false), false);
  assert.equal(scanTargetAllowed(true, true, true, true, true), true);
  assert.equal(scanTargetAllowed(false, false, true, true, true), true);
  assert.equal(scanTargetAllowed(false, true, true, true, true), false);
});
test("queue keeps the first LAN lookup and following scans; a failed lookup cannot drop the next one", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const seen = [];
  const failures = [];
  const enqueue = scanQueue(async ([code]) => { seen.push(code); if (code === "FIRST") await held; if (code === "BAD") throw new Error("unknown"); }, (error) => failures.push(error.message));
  const first = enqueue(["FIRST"]); const second = enqueue(["SECOND"]); const bad = enqueue(["BAD"]); const third = enqueue(["THIRD"]);
  await Promise.resolve(); assert.deepEqual(seen, ["FIRST"]);
  release(); await Promise.all([first, second, bad, third]);
  assert.deepEqual(seen, ["FIRST", "SECOND", "BAD", "THIRD"]);
  assert.deepEqual(failures, ["unknown"]);
});
test("packaging buttons switch stored prices and quantities for carton/colis/detail/chapelet, respecting tier", () => {
  const units = load("units");
  const { packagingChoices, switchPackaging } = load("posPackaging", { "./units": units });
  const product = { id: 1, base_unit: "Détail", sale_price: 1000, packaging_unit: "Carton", units_per_packaging: 20, packaging_sale_price: 15000,
    packagings: [{ id: 2, name: "Colis", factor: 10, active: true, price_detail: 8000, price_gros: 7000 }, { id: 3, name: "Chapelet", factor: 3, active: true, price_detail: 2500 }, { id: 4, name: "Inactif", active: false }] };
  assert.deepEqual(Array.from(packagingChoices(product), (c) => c.label), ["Détail", "Carton", "Colis", "Chapelet"]);
  for (const [key, expected, quantity] of [["primary", 15000, 20], ["2", 8000, 10], ["base", 1000, 1], ["3", 2500, 3]]) {
    const line = switchPackaging(product, key, "detail");
    const parts = units.splitQuantity(line.product, line.quantity, line.unitMode);
    assert.equal(units.catalogUnitPrice(line.product, line.quantity, line.price_tier, parts) * line.quantity, expected);
    assert.equal(line.quantity, quantity); assert.equal(line.price, undefined);
  }
  const gros = switchPackaging(product, "2", "gros");
  assert.equal(units.catalogPrices(gros.product, gros.price_tier).carton, 7000);
  assert.equal(packagingChoices({ base_unit: "Pièce" }).length, 1);
});
