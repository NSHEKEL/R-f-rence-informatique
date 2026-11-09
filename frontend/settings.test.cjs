const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/lib/${file}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, ...globals });
  return exports;
}
const access = load("settingsAccess");
const can = (...keys) => (key) => keys.includes(key);

test("settings route and tabs require consult; modify alone grants no navigation", () => {
  assert.equal(access.canOpenSettings(can()), false);
  assert.equal(access.canOpenSettings(can("poste_modifier")), false);
  const local = can("poste_consulter", "poste_modifier", "peripheriques_consulter", "peripheriques_modifier");
  assert.equal(access.canOpenSettings(local), true);
  for (const tab of ["poste", "peripheriques", "compte"]) assert.equal(access.canOpenSettingsTab(tab, false, local), true);
  for (const tab of ["entreprise", "emails", "maj", "fne", "impression", "sauvegarde", "reseau", "securite"]) assert.equal(access.canOpenSettingsTab(tab, false, local), false, tab);
  assert.equal(access.canOpenSettingsTab("reseau", true, () => true), true);
  assert.equal(access.canOpenSettingsTab("securite", true, () => true), true);
});

test("company edits cannot smuggle tax, printer, cash, backup or network fields", () => {
  const company = { name: "Shop", smtp_password: "new-password", vat_rate: 18, receipt_header: "Ticket", drawer_port: "COM2", auto_print_cash: true, backup_dir: "copy", expiry_alert_days: 30, network_restrict_workstations: false };
  const data = access.companyUpdatePayload(company, can("generaux_modifier"), false);
  assert.equal(JSON.stringify(data), JSON.stringify({ name: "Shop", smtp_password: "new-password" }));
  assert.equal(JSON.stringify(access.companyUpdatePayload(company, can(), false)), "{}");
  assert.equal(Object.keys(access.companyUpdatePayload(company, () => true, true)).length, Object.keys(company).length);
});

function poste() {
  const data = new Map();
  const files = new Map();
  const events = [];
  const module = load("poste", {
    localStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) },
    Event: class Event { constructor(type) { this.type = type; } },
    window: { dispatchEvent: (event) => events.push(event.type), pywebview: { api: {
      read_pref_file: async (name) => files.get(name) || "",
      write_pref_file: async (name, value) => { files.set(name, value); return name; },
    } } },
  });
  return { module, data, files, events };
}

test("scanner prefix, Enter/Tab, min length, auto-add and display persist on this workstation", async () => {
  const { module: p, data, files, events } = poste();
  assert.equal(p.readPosteSettings().scanner_suffix, "Enter");
  assert.equal(p.scanValue(" ABC "), "ABC");
  p.writePosteSettings({ ...p.DEFAULT_POSTE, scanner_suffix: "Tab", scanner_prefix: "]C1", scanner_min_length: 4, scanner_auto_add: false, display_scale: 120 });
  assert.equal(p.readPosteSettings().scanner_suffix, "Tab");
  assert.equal(p.readPosteSettings().scanner_auto_add, false);
  assert.equal(p.scanValue("]C11234"), "1234");
  assert.equal(p.scanValue("]C1123"), "");
  assert.equal(p.scanValue(""), "");
  assert.equal(data.get("ri_ui_scale"), "1.2");
  assert.equal(events.includes("easygest-poste-changed"), true);
  assert.equal(files.has("easygest-poste.json"), true);
  data.clear();
  await p.restorePosteSettings();
  assert.equal(p.readPosteSettings().scanner_prefix, "]C1");
  assert.equal(p.readPosteSettings().display_scale, 120);
});

test("drawer overrides fall back to company and local choices win native restoration", async () => {
  const { module: p, data, files } = poste();
  const company = { drawer_port: "COM1", drawer_code: "27,112,0,25,250" };
  assert.equal(p.applyPosteDrawer(company).drawer_port, "COM1");
  p.writePosteSettings({ ...p.DEFAULT_POSTE, drawer_port: "COM2", drawer_code: "27,112,0,1,1" });
  assert.equal(p.applyPosteDrawer(company).drawer_port, "COM2");
  assert.equal(company.drawer_port, "COM1");
  files.set("easygest-poste.json", JSON.stringify({ drawer_port: "COM9" }));
  await p.restorePosteSettings();
  assert.equal(p.applyPosteDrawer(company).drawer_port, "COM2");
  p.writePosteSettings({ ...p.DEFAULT_POSTE });
  assert.equal(p.applyPosteDrawer(company).drawer_port, "COM1");
  data.set("easygest_poste", "not json");
  assert.equal(p.readPosteSettings().scanner_suffix, "Enter");
  files.set("easygest-poste.json", "broken");
  await p.restorePosteSettings();
  assert.equal(p.readPosteSettings().scanner_suffix, "Enter");
  data.set("easygest_poste", JSON.stringify({ scanner_suffix: "Other", scanner_min_length: -1, drawer_code: "999", display_scale: 900 }));
  assert.equal(p.readPosteSettings().scanner_min_length, 1);
  assert.equal(p.applyPosteDrawer(company).drawer_code, company.drawer_code);
});

test("POS scan suffix and auto-add use local settings; drawer also checks sales operation permission", () => {
  const source = readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, "utf8");
  assert.match(source, /e\.key === readPosteSettings\(\)\.scanner_suffix/);
  assert.match(source, /if \(readPosteSettings\(\)\.scanner_auto_add\) submitSearch\(\)/);
  assert.match(source, /can\("caisse_operations"\) \|\| can\("peripheriques_modifier"\)/);
  const app = readFileSync(`${__dirname}/src/App.tsx`, "utf8");
  assert.match(app, /category === "utilisateurs" && !hasFeature\("droits_acces"\)/);
  const settings = readFileSync(`${__dirname}/src/pages/Settings.tsx`, "utf8");
  assert.match(settings, /<fieldset disabled=\{!tabEditable\}/);
  assert.match(settings, /can\("parametres_sauvegarde_restaurer"\)/);
});

test("the real POS suffix handler normalizes Tab scans without adding when auto-add is off", () => {
  const { module: p } = poste();
  const source = readFileSync(`${__dirname}/src/pages/NouvelleVente.tsx`, "utf8");
  const file = ts.createSourceFile("POS.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let arrow;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === "onKeyDown" && node.getText(file).includes("scanner_suffix")) arrow = node.initializer.expression.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(arrow);
  p.writePosteSettings({ ...p.DEFAULT_POSTE, scanner_suffix: "Tab", scanner_prefix: "]C1", scanner_min_length: 4, scanner_auto_add: false });
  let added = 0;
  let query = "]C11234";
  let prevented = false;
  const context = { readPosteSettings: p.readPosteSettings, scanValue: p.scanValue, query, setQuery: (value) => { query = value; }, submitSearch: () => { added++; } };
  const handler = vm.runInNewContext(ts.transpileModule(`const handler = ${arrow}; handler;`, {}).outputText, context);
  handler({ key: "Enter", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
  handler({ key: "Tab", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(query, "1234");
  assert.equal(added, 0);
  p.writePosteSettings({ ...p.readPosteSettings(), scanner_auto_add: true });
  handler({ key: "Tab", preventDefault() {} });
  assert.equal(added, 1);
});

test("workstation controls render read-only or editable for the correct category", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const source = readFileSync(`${__dirname}/src/components/WorkstationSettings.tsx`, "utf8");
  function render(keys) {
    const exports = {};
    const { module: p } = poste();
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: (name) => {
      if (name.endsWith("/api/client")) return { localApi: {} };
      if (name.endsWith("/context/AuthContext")) return { useAuth: () => ({ can: can(...keys) }) };
      if (name.endsWith("/context/CompanyContext")) return { readPostePrinters: () => ({}), writePostePrinters() {}, useCompany: () => ({ reload() {}, printing: { receipt: {} } }) };
      if (name.endsWith("/lib/poste")) return p;
      return require(name);
    } });
    return renderToStaticMarkup(React.createElement(exports.default));
  }
  const readOnly = render(["poste_consulter", "peripheriques_consulter"]);
  assert.equal((readOnly.match(/<fieldset disabled=""/g) || []).length, 3);
  const editable = render(["poste_consulter", "poste_modifier", "peripheriques_consulter", "peripheriques_modifier"]);
  assert.equal((editable.match(/<fieldset disabled=""/g) || []).length, 0);
  const hardware = render(["peripheriques_consulter", "peripheriques_modifier"]);
  assert.equal(hardware.includes("Imprimante locale"), false);
  assert.equal((hardware.match(/<fieldset disabled=""/g) || []).length, 0);
});
