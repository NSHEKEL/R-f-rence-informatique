const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function modules(window = {}) {
  const cache = {};
  function load(name) {
    const file = path.resolve(__dirname, "src/lib", name.endsWith(".ts") ? name : `${name}.ts`);
    if (cache[file]) return cache[file];
    const exports = {};
    cache[file] = exports;
    const source = readFileSync(file, "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: (name) => name.startsWith("./") ? load(name) : require(name), window, Uint8Array, ArrayBuffer, Blob, DOMException, URL, btoa, console });
    return exports;
  }
  return load;
}

const row = { product_id: 1, sku: "ART-1", name: "Article <script>", rayon: "Frais", emplacement: "A-1", physical_qty: 235, theoretical_qty: 240, variance: -5, unit_cost: 40, theoretical_value: 9600, physical_value: 9400, variance_value: -200, status: "manquant", note: "Contrôle" };

test("inventory report has numeric Excel cells, complete columns and escaped print output", () => {
  const { inventoryTable, reportHtml } = modules()("inventoryReport");
  const { headers, rows } = inventoryTable({ theoretical_visible: true, rows: [row, { ...row, physical_qty: null, variance: null, status: "non compté" }] });
  assert.equal(headers.length, 13);
  assert.equal(rows[0][6], -5);
  assert.equal(rows[0][10], -200);
  assert.equal(rows[1][5], "");
  const html = reportHtml("<Inventaire>", headers, rows);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;Inventaire&gt;"));
});

test("blind exports cannot include theoretical quantities or financial values", () => {
  const { inventoryTable } = modules()("inventoryReport");
  const table = inventoryTable({ theoretical_visible: false, rows: [{ ...row, status: "compté" }] });
  assert.equal(table.headers.length, 7);
  assert.equal(table.rows[0].includes(240), false);
  assert.equal(table.rows[0].includes(-200), false);
  assert.equal(table.rows[0].includes(40), false);
  assert.equal(table.rows[0][4], 235);
});

test("real PDF generator produces non-empty multi-page PDF and supports empty reports", () => {
  const { buildReportPdf } = modules()("reportPdf");
  for (const rows of [[], Array.from({ length: 150 }, (_, i) => ["Article " + i, i, -i])]) {
    const result = buildReportPdf("Inventaire INV-TEST", ["Référence", "Physique", "Écart"], rows);
    const buffer = Buffer.from(result);
    assert.ok(buffer.length > 2000);
    assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
    assert.ok(buffer.toString("latin1").includes("%%EOF"));
    if (rows.length) assert.ok((buffer.toString("latin1").match(/\/Type \/Page\b/g) || []).length > 1);
  }
});

test("PDF native save transmits binary base64 without BOM; Excel retains the text bridge", async () => {
  let pdf;
  let excel;
  const load = modules({ pywebview: { api: {
    save_binary_file: async (name, body) => { pdf = { name, buffer: Buffer.from(body, "base64") }; return "C:/Rapports/test.pdf"; },
    save_file: async (name, body) => { excel = { name, body }; return "C:/Rapports/test.xls"; },
  } } });
  const filename = await load("reportPdf").exportReportPdf("inventaire", "Inventaire", ["Article"], [["Test"]]);
  assert.equal(filename, "C:/Rapports/test.pdf");
  assert.equal(pdf.name, "inventaire.pdf");
  assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
  await load("exportCsv").exportCsv("inventaire", ["Article", "Écart"], [["Test", -5]]);
  assert.equal(excel.name, "inventaire.xls");
  assert.ok(excel.body.includes('ss:Type="Number">-5'));
});

test("native export cancel and errors propagate instead of silently downloading blobs", async () => {
  const cancelled = modules({ pywebview: { api: { save_binary_file: async () => "" } } })("reportPdf");
  assert.equal(await cancelled.exportReportPdf("test", "Test", [], []), "");
  const broken = modules({ pywebview: { api: { save_binary_file: async () => { throw new Error("disk full"); } } } })("reportPdf");
  await assert.rejects(broken.exportReportPdf("test", "Test", [], []), /disk full/);
  const oldNative = modules({ pywebview: { api: { save_file() {} } } })("reportPdf");
  await assert.rejects(oldNative.exportReportPdf("test", "Test", [], []), /Mettez ce poste à jour/);
});

test("inventory UI autosaves, resumes, supports packaged scans and preserves quick inventory", () => {
  const screen = readFileSync(path.join(__dirname, "src/components/InventorySessions.tsx"), "utf8");
  assert.match(screen, /setTimeout\(flush, 500\)/);
  assert.match(screen, /\/counts\/\$\{productId\}/);
  assert.match(screen, /\/scan/);
  assert.match(screen, /inventaire_valider/);
  assert.match(screen, /PackagingQuantity/);
  const quick = readFileSync(path.join(__dirname, "src/pages/Inventaire.tsx"), "utf8");
  assert.match(quick, /<InventorySessions \/>/);
  assert.match(quick, /\/inventory\/apply/);
});
