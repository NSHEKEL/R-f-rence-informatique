const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

test("accounting documents expose all requested reports and gate editing, exports and historical declaration", () => {
  const source = readFileSync("src/pages/AccountingDocuments.tsx", "utf8");
  for (const kind of ["account", "sales", "purchases", "cash", "expenses", "settlements", "ledger", "balance", "customers", "suppliers", "debts", "stock", "margins"]) assert.ok(source.includes(kind + ":"));
  for (const key of ["plan_comptable_modifier", "comptabilite_journaux_imprimer", 'user?.role === "admin"', "export: true", "data.unposted", "data.footer", "Solde ouverture"]) assert.ok(source.includes(key));
  assert.ok(source.includes('historical.rate === "" ? null : Number(historical.rate)'));
  assert.ok(source.includes("purchase_id: Number(link.purchase)"));
  assert.ok(source.includes("request === requestNumber.current"));
});

test("payment controls default empty, are optional and preserve old purchasing edits", () => {
  const purchase = readFileSync("src/pages/Approvisionnements.tsx", "utf8");
  const expense = readFileSync("src/pages/Comptabilite.tsx", "utf8");
  const debts = readFileSync("src/pages/Dettes.tsx", "utf8");
  const controls = readFileSync("src/components/AccountingPayment.tsx", "utf8");
  assert.ok(purchase.includes("...(!editing ? { payment_method:"));
  assert.ok(purchase.includes("!editing && <AccountingPayment"));
  assert.ok(expense.includes('useState("")'));
  assert.ok(expense.includes("payment_method: paymentMethod || null"));
  assert.ok(debts.includes('method: "", bank: ""'));
  assert.ok(controls.includes("Non renseigné"));
  assert.ok(controls.includes('api.get("/bank/accounts")'));
});

test("PDF report repeats an explicit declaration footer on multiple pages and wraps a long heading", () => {
  const code = ts.transpileModule(readFileSync("src/lib/reportPdf.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Uint8Array, require: (name) => name === "./reportFiles" ? {} : require(name) });
  const pdf = Buffer.from(exports.buildReportPdf("Grand livre ".repeat(40), ["Compte", "Débit", "Crédit"], Array.from({ length: 200 }, (_, i) => ["571", i, 0]), "Admin Marie / 2026-11-09 / TVA historique 0 %"));
  const text = pdf.toString("latin1");
  assert.equal(text.slice(0, 5), "%PDF-");
  assert.ok((text.match(/Admin Marie/g) || []).length > 1);
  assert.ok(text.includes("%%EOF"));
});
