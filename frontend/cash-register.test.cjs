const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const ts = require("typescript");

function stringsAndIdentifiers(page) {
  const file = ts.createSourceFile(page, readFileSync(`${__dirname}/src/pages/${page}.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isIdentifier(node) || ts.isJsxText(node)) values.push(node.text.trim());
    ts.forEachChild(node, visit);
  }
  visit(file);
  return values;
}

test("sale pages expose neither closing controls nor the closing API", () => {
  for (const page of ["Sales", "NouvelleVente"]) {
    const values = stringsAndIdentifiers(page);
    for (const forbidden of ["Fermer ma caisse", "Fermeture de caisse", "/cash-sessions/close", "closeTill", "CashTicket"]) {
      assert.equal(values.includes(forbidden), false, `${page}: ${forbidden}`);
    }
  }
});

test("Ma caisse owns closing, movements and their dedicated permissions", () => {
  const values = stringsAndIdentifiers("Caisse");
  for (const expected of ["/cash-sessions/close", "/cash-sessions/movements", "caisse_operations", "recette_enregistrer", "soldes_consulter", "movementAmount", "movementReason"]) {
    assert.equal(values.includes(expected), true, expected);
  }
});
