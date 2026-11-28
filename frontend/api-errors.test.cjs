const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/${file}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require, window: { location: { reload: () => { reloads++; } } } });
  return exports;
}
let reloads = 0;
const { apiErrorMessage } = load("lib/apiErrors.ts");
const { productBarcodes, productTextError } = load("lib/productForm.ts");
const requiredCode = { type: "string_too_short", loc: ["body", "barcodes", 0, "code"], msg: "String should have at least 1 character", ctx: { min_length: 1 }, input: "" };

test("API details preserve messages and translate structured validation paths into French", () => {
  assert.equal(apiErrorMessage("Référence déjà utilisée"), "Référence déjà utilisée");
  assert.equal(apiErrorMessage([requiredCode]), "Code-barres 1 : au moins 1 caractère requis");
  assert.equal(apiErrorMessage({ detail: [requiredCode] }), "Code-barres 1 : au moins 1 caractère requis");
  assert.equal(apiErrorMessage({ message: "Refusé" }), "Refusé");
  assert.equal(apiErrorMessage({ name: ["Nom incorrect"] }), "Nom : Nom incorrect");
  assert.equal(apiErrorMessage({ loc: ["body", "packagings", 1, "name"], type: "string_too_long", ctx: { max_length: 80 } }), "Conditionnements 2 · Nom : 80 caractères maximum");
  assert.match(apiErrorMessage([{ loc: ["query", "quantity"], type: "int_parsing" }, { loc: ["body", "name"], type: "missing" }]), /Quantité : nombre entier requis ; Nom : champ requis/);
  assert.equal(apiErrorMessage({ loc: ["body", "custom"], msg: "Règle métier invalide" }), "custom : Règle métier invalide");
  const html = renderToStaticMarkup(React.createElement("div", null, apiErrorMessage([requiredCode])));
  assert.match(html, /Code-barres 1/);
});

test("empty, unknown and cyclic API details always produce safe text", () => {
  const cycle = {}; cycle.detail = cycle;
  for (const value of [null, undefined, "", "  ", [], {}, 42, false, { input: { secret: 42 } }, cycle]) {
    assert.equal(apiErrorMessage(value, "Erreur de sauvegarde"), "Erreur de sauvegarde");
  }
  const message = apiErrorMessage([{ loc: ["body", "quantity"], type: "greater_than_equal", ctx: { ge: 0 } }]);
  assert.equal(message, "Quantité : valeur supérieure ou égale à 0 requise");
});

const empty = { base_unit: "", packaging_unit: "", rayon: "", emplacement: "", packagings: [], barcodes: [] };
test("product barcode preparation ignores new empty rows without mutating existing codes", () => {
  const existing = { id: 4, code: "ABC", label: "Variante", active: false };
  const rows = [existing, { code: "  ", label: "Brouillon", active: true }, { code: " XYZ ", label: "Autre", active: true }];
  assert.deepEqual(JSON.parse(JSON.stringify(productBarcodes(rows))), [existing, { code: "XYZ", label: "Autre", active: true }]);
  assert.equal(rows[2].code, " XYZ ");
  assert.equal(productBarcodes([]).length, 0);
  assert.equal(productBarcodes([{ code: "", label: "", active: true }]).length, 0);
  assert.equal(productBarcodes([{ ...existing, code: "" }]).length, 1);
});

test("product text validation accepts exact server limits and rejects every overlong field", () => {
  assert.equal(productTextError(empty), "");
  for (const [field, max] of [["base_unit", 40], ["packaging_unit", 40], ["rayon", 200], ["emplacement", 200]]) {
    assert.equal(productTextError({ ...empty, [field]: "x".repeat(max) }), "");
    assert.match(productTextError({ ...empty, [field]: "x".repeat(max + 1) }), new RegExp(`${max} caractères maximum`));
  }
  assert.equal(productTextError({ ...empty, packagings: [{ name: "😀".repeat(80) }] }), "");
  assert.match(productTextError({ ...empty, packagings: [{ name: "x".repeat(81) }] }), /Conditionnement 1 · Nom : 80/);
  for (const field of ["code", "label"]) {
    assert.equal(productTextError({ ...empty, barcodes: [{ code: "A", label: "", [field]: "x".repeat(200) }] }), "");
    assert.match(productTextError({ ...empty, barcodes: [{ code: "A", label: "", [field]: "x".repeat(201) }] }), /Code-barres 1.*200 caractères/);
  }
});

test("Products save strips barcode drafts, handles a 422 as text and keeps invalid forms open", async () => {
  const source = readFileSync(`${__dirname}/src/pages/Products.tsx`, "utf8");
  const start = source.indexOf("  async function save()");
  const end = source.indexOf("\n  /** Opens the price history", start);
  const code = ts.transpileModule(source.slice(start, end) + "\nexports.run = save;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  for (const mode of ["success", "422", "long", "fractional"]) {
    let payload, error = "", closed = false, saving;
    const form = { ...empty, name: "Article", sku: "SKU", quantity: mode === "fractional" ? 0.5 : 0, units_per_packaging: 1,
      semi_wholesale_price: "", supplier_purchase_price: "", semi_wholesale_min_qty: "", wholesale_min_qty: "",
      packaging_sale_price: "", wholesale_packaging_price: "", barcodes: [{ code: "", label: "", active: true }],
      ...(mode === "long" ? { base_unit: "x".repeat(41) } : {}) };
    const exports = {};
    vm.runInNewContext(code, { exports, form, editing: mode === "fractional" ? { id: 1 } : null, readOnly: false, pendingUuid: null, permitted: () => true, productBarcodes, productTextError, apiErrorMessage,
      axios: { isAxiosError: () => true }, setError: (value) => { error = value; }, setSaving: (value) => { saving = value; },
      setModalOpen: (value) => { closed = !value; }, load: async () => {},
      api: { put: async (_, body) => { payload = body; return { data: { id: 1, ...body } }; }, post: async (_, body) => { payload = body; if (mode === "422") throw { response: { data: { detail: [requiredCode] } } }; return { data: { id: 1 } }; } },
    });
    await exports.run();
    if (mode === "long") { assert.equal(payload, undefined); assert.match(error, /40 caractères maximum/); }
    else { assert.equal(payload.barcodes.length, 0); assert.equal(saving, false); }
    assert.equal(closed, mode === "success" || mode === "fractional");
    if (mode === "fractional") assert.equal(payload.quantity, 0.5);
    if (mode === "422") { assert.equal(error, "Code-barres 1 : au moins 1 caractère requis"); assert.doesNotThrow(() => renderToStaticMarkup(React.createElement("div", null, error))); }
  }
});

test("top-level ErrorBoundary renders children or a French reload screen without exposing the error", () => {
  const Boundary = load("components/ErrorBoundary.tsx").default;
  const children = React.createElement("p", null, "Catalogue");
  const boundary = new Boundary({ children });
  assert.equal(boundary.render(), children);
  boundary.state = Boundary.getDerivedStateFromError(new Error("private details"));
  const tree = boundary.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /L&#x27;application a rencontré une erreur/);
  assert.match(html, /Recharger/);
  assert.doesNotMatch(html, /private details/);
  function findButton(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "button") return node;
    for (const child of React.Children.toArray(node.props?.children)) { const button = findButton(child); if (button) return button; }
  }
  findButton(tree).props.onClick();
  assert.equal(reloads, 1);
  const main = readFileSync(`${__dirname}/src/main.tsx`, "utf8");
  assert.match(main, /<ErrorBoundary>[\s\S]*<App\s*\/>[\s\S]*<\/ErrorBoundary>/);
  assert.ok(main.indexOf("<FrontendMounted>") < main.indexOf("<ErrorBoundary>"));
});

test("frontend never passes a null-coalesced raw API detail into UI state", () => {
  function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
  for (const file of files(`${__dirname}/src`).filter(p => /\.tsx?$/.test(p))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\.response\??\.data\??\.detail\s*\?\?/, file);
  }
});
