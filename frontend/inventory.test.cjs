const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

test("late session restoration cannot replace the session explicitly selected by the operator", async () => {
  const state = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0, first = true, restore;
  const oldReport = { id: 1, reference: "OLD", name: "Ancien", status: "validated", rows: [], stats: {}, scope: {} };
  const newReport = { ...oldReport, id: 2, reference: "NEW", name: "Nouveau", status: "draft" };
  const restored = new Promise((resolve) => { restore = resolve; });
  const dependencies = {
    react: {
      useState(initial) { const index = stateIndex++; if (!(index in state)) state[index] = initial; return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
      useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
      useEffect(effect) { if (first) effects.push(effect); }, useCallback: (fn) => fn,
    },
    "../api/client": { formatDateTime: () => "" },
    "../context/AuthContext": { useAuth: () => ({ can: () => true }) },
    "../lib/exportCsv": {}, "../lib/print": {},
    "../lib/inventoryReport": { INVENTORY_STATS: {} },
    "./InventoryGrid": { default: "InventoryGrid" },
    "../lib/depots": { useDepots: () => ({ depots: [] }) },
    "../lib/useOnline": { useOnline: () => true }, "./OfflineBanner": { default: "OfflineBanner" },
    "../lib/offlineInventory": {
      lastSession: async () => 1,
      readSession: (id) => id === 1 ? restored : Promise.resolve({ data: newReport, fromCache: false }),
      readOffline: async (url) => ({ data: url.includes("options") ? { products: [], categories: [] } : [newReport] }),
      rememberSession: async () => {},
    },
  };
  const exports = {};
  const source = readFileSync(path.join(__dirname, "src/components/InventorySessions.tsx"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, URLSearchParams, require: (name) => dependencies[name] || require(name) });
  const render = () => { stateIndex = refIndex = 0; const tree = exports.default(); first = false; return tree; };
  const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
  render(); effects.forEach((effect) => effect());
  await new Promise(setImmediate);
  const button = nodes(render()).find((node) => node.type === "button" && JSON.stringify(node.props.children).includes("Nouveau"));
  assert.ok(button, JSON.stringify(state));
  await button.props.onClick();
  assert.equal(nodes(render()).find((node) => node.props.report).props.report.id, 2);
  restore({ data: oldReport, fromCache: false });
  await new Promise(setImmediate);
  assert.equal(nodes(render()).find((node) => node.props.report).props.report.id, 2);
});

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

test("mass inventory calculates independent packaging counts and preserves empty versus zero", () => {
  const { inventoryTotal, inventoryTable } = modules()("inventoryReport");
  const product = { ...row, base_unit: "pièce", packaging_unit: "Carton", units_per_packaging: 12, packagings: [{ id: 6, name: "Colis", factor: 6 }] };
  assert.equal(inventoryTotal({ primary: 10, 6: 3, base: 5 }, product), 143);
  assert.equal(inventoryTotal({ primary: null, base: null }, product), null);
  assert.equal(inventoryTotal({ base: 0 }, product), 0);
  const table = inventoryTable({ theoretical_visible: true, rows: [{ ...product, counts: { primary: 10, 6: 3, base: 5 } }] });
  assert.match(table.rows[0].at(-1), /10 Carton ×12.*3 Colis ×6.*5 Unité/);
});

test("cached inventory scan focuses variant and packaging units without incrementing", () => {
  const { inventoryScan } = modules()("inventoryReport");
  const product = { ...row, barcode: "MAIN", qr_code: "QR", barcodes: ["VAR", "PACK"], packagings: [{ id: 6, name: "Colis", factor: 6, barcode: "PACK" }] };
  for (const code of ["MAIN", "QR", "ART-1", " var "]) assert.equal(inventoryScan([product], code).key, "base");
  assert.equal(inventoryScan([product], "pack").key, "6");
  assert.equal(inventoryScan([product], "unknown"), null);
  assert.equal(product.physical_qty, 235);
});

test("inventory report has numeric Excel cells, complete columns and escaped print output", () => {
  const { inventoryTable, reportHtml } = modules()("inventoryReport");
  const { headers, rows } = inventoryTable({ theoretical_visible: true, rows: [row, { ...row, physical_qty: null, variance: null, status: "non compté" }] });
  assert.equal(headers.length, 14);
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
  assert.equal(table.headers.length, 8);
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
  const grid = readFileSync(path.join(__dirname, "src/components/InventoryGrid.tsx"), "utf8");
  const offline = readFileSync(path.join(__dirname, "src/lib/offlineInventory.ts"), "utf8");
  assert.match(grid, /setTimeout\([\s\S]*?, 500\)/);
  assert.match(offline, /\/counts\/\$\{entry.product_id\}/);
  assert.match(screen, /grid.current\?\.scan\(code\)/);
  assert.match(screen, /inventaire_valider/);
  assert.match(grid, /inventoryUnits\(row\)/);
  assert.match(screen, /editable=\{!!open && \(current.status !== "draft" \|\| !offline\) && !busy\}/);
  assert.match(screen, /consultation uniquement/);
  assert.match(screen, /alive && !selected.current/);
  assert.match(screen, /onClick=\{async \(\) => \{ selected.current = true;/);
  assert.match(grid, /event.key === "Enter"\) \{ index\+\+; next = 0; \}/);
  assert.match(grid, /result.status \|\| report.status/);
  const quick = readFileSync(path.join(__dirname, "src/pages/Inventaire.tsx"), "utf8");
  assert.match(quick, /<InventorySessions \/>/);
  assert.match(quick, /\/inventory\/apply/);
});
