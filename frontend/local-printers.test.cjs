const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function loadFunction(path, name, context) {
  const source = ts.createSourceFile(path, readFileSync(`${__dirname}/${path}`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, name);
  vm.runInContext(ts.transpileModule(node.getText(source).replace(/^export /, ""), {}).outputText, context);
}

test("printer discovery targets this workstation in local, server-origin and IPv6 pages", () => {
  const context = vm.createContext({ window: { location: {} }, DEFAULT_PORT: "8000" });
  loadFunction("src/api/client.ts", "localBaseUrl", context);
  for (const [url, expected] of [
    ["http://127.0.0.1:8001", "http://127.0.0.1:8001/api"],
    ["http://localhost:8000", "http://localhost:8000/api"],
    ["http://[::1]:8000", "http://[::1]:8000/api"],
    ["http://192.168.1.20:8000", "http://127.0.0.1:8000/api"],
    ["http://192.168.1.20:8001", "http://127.0.0.1:8001/api"],
    ["https://shop.example", "http://127.0.0.1:8000/api"],
  ]) {
    context.window.location = new URL(url);
    assert.equal(context.localBaseUrl(), expected);
  }
});

test("unavailable local service is explicit and server error details remain visible", () => {
  const context = vm.createContext({ axios: require("axios"), apiErrorMessage: (detail, fallback) => detail || fallback });
  loadFunction("src/lib/localPrinters.ts", "localPrinterError", context);
  assert.equal(context.localPrinterError({ isAxiosError: true, response: { data: { detail: "Spouleur indisponible" } }, message: "502" }), "Spouleur indisponible");
  const message = context.localPrinterError({ isAxiosError: true, message: "Network Error" });
  for (const text of ["Network Error", "Lancez EasyGest", "réseau local", "aucune liste du serveur"]) assert.ok(message.includes(text));
  assert.equal(context.localPrinterError(new Error("imprévu")), "Error: imprévu");
});

test("printer selection saves locally and overrides the shared printer used by printing", () => {
  const data = new Map();
  const saved = [];
  const context = vm.createContext({
    localStorage: { setItem: (key, value) => data.set(key, value), getItem: (key) => data.get(key) },
    POSTE_PRINTERS_KEY: "local-printers", POSTE_PRINTERS_FILE: "easygest-imprimantes-poste.json",
    window: { dispatchEvent: () => {}, pywebview: { api: { write_pref_file: (...args) => { saved.push(args); return Promise.resolve(); } } } },
    Event: class {},
  });
  for (const name of ["readPostePrinters", "writePostePrinters", "applyPostePrinters"]) loadFunction("src/context/CompanyContext.tsx", name, context);
  context.writePostePrinters({ receipt: "Client USB", label: "Client étiquettes" });
  assert.equal(JSON.parse(data.get("local-printers")).receipt, "Client USB");
  assert.equal(saved[0][0], "easygest-imprimantes-poste.json");
  const merged = context.applyPostePrinters({ receipt: { printer_name: "Server USB" }, label: {}, documents: {} });
  assert.equal(merged.receipt.printer_name, "Client USB");
  assert.equal(merged.label.printer_name, "Client étiquettes");
});
