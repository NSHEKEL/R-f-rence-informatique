const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(name) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/${name}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: () => ({ default: {} }) });
  return exports;
}

test("depot stock navigation uses dedicated rights, without granting settings categories", () => {
  const { canOpenSettings, canOpenSettingsTab } = load("settingsAccess");
  for (const right of ["depots_gerer", "depots_transferer"]) {
    const can = (key) => key === right;
    assert.equal(canOpenSettings(can), true);
    assert.equal(canOpenSettingsTab("depots", false, can), true);
    assert.equal(canOpenSettingsTab("articles", false, can), false);
    assert.equal(canOpenSettingsTab("reseau", false, can), false);
  }
  assert.equal(canOpenSettingsTab("depots", false, () => false), false);
});

test("depot scope sends numeric identifiers; invalid/empty values do not select the principal silently", () => {
  const { depotScope } = load("depots");
  assert.equal(JSON.stringify(depotScope("12")), '{"depot_id":12}');
  assert.equal(depotScope("").depot_id, 0);
  assert.equal(Number.isNaN(depotScope("invalide").depot_id), true);
});

test("negative principal stock has an explicit replenishment warning, not a negative sale limit", () => {
  const { replenishmentMessage } = load("depots");
  assert.equal(replenishmentMessage(-10), "À réapprovisionner depuis les réserves");
  assert.equal(replenishmentMessage(0), "");
  assert.equal(replenishmentMessage(15), "");
});
