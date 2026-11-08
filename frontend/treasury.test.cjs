const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(
  readFileSync(`${__dirname}/src/lib/treasury.ts`, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText, { exports: exportsObject });
const { allowedLandingPath, canOpenTreasury } = exportsObject;
const can = (...keys) => (key) => keys.includes(key);

test("seller can reach the till and POS, not treasury or dashboard", () => {
  const seller = can("caisse", "caisse_fermer", "vente_nouvelle", "assistance");
  for (const path of ["/banque", "/comptabilite", "/dettes", "/tableau-de-bord", "/rapports"]) {
    assert.equal(canOpenTreasury(path, seller), false, path);
    assert.equal(canOpenTreasury(`${path}/`, seller), false, path);
    assert.equal(canOpenTreasury(path.toUpperCase(), seller), false, path);
  }
  assert.equal(canOpenTreasury("/caisse", seller), true);
  assert.equal(canOpenTreasury("/ventes/nouvelle", seller), true);
});

test("bank needs treasury plus either specific deposit right, not balances", () => {
  assert.equal(canOpenTreasury("/banque", can("tresorerie_consulter")), false);
  assert.equal(canOpenTreasury("/banque", can("versements_gerer")), false);
  for (const key of ["versements_gerer", "versements_valider"]) {
    assert.equal(canOpenTreasury("/banque", can("tresorerie_consulter", key)), true);
  }
});

test("each report page needs its page right and financial gates", () => {
  for (const [path, page, treasury] of [
    ["/tableau-de-bord", "tableau_bord", false], ["/rapports", "rapports", false],
    ["/dettes", "dettes", true],
  ]) {
    const keys = [page, "rapports_financiers", "soldes_consulter", ...(treasury ? ["tresorerie_consulter"] : [])];
    assert.equal(canOpenTreasury(path, can(...keys)), true, path);
    for (const missing of keys) {
      assert.equal(canOpenTreasury(path, can(...keys.filter((key) => key !== missing))), false, `${path}: ${missing}`);
    }
  }
});

test("accounting page and expenses stay available without financial report rights", () => {
  assert.equal(canOpenTreasury("/comptabilite", can("tresorerie_consulter", "comptabilite")), true);
  assert.equal(canOpenTreasury("/comptabilite", can("comptabilite")), false);
});

test("redirect skips inaccessible financial pages and never redirects to itself", () => {
  const pages = [["tableau_bord", "/tableau-de-bord"], ["caisse", "/caisse"]];
  assert.equal(allowedLandingPath(pages, can("tableau_bord", "caisse")), "/caisse");
  assert.equal(allowedLandingPath(pages, can("tableau_bord")), "/");
  assert.equal(allowedLandingPath([], can()), "/");
  assert.equal(allowedLandingPath(pages, can("tableau_bord", "rapports_financiers", "soldes_consulter")), "/tableau-de-bord");
});
