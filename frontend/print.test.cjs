const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(
  readFileSync(`${__dirname}/src/lib/print.ts`, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;

function setup(api = {}) {
  const calls = { dialogs: 0, alerts: [], removed: 0, frames: 0 };
  const element = () => ({
    style: {},
    setAttribute() {},
    removeAttribute() {},
    classList: { add() {} },
    cloneNode: element,
    appendChild() {},
    append() {},
    remove() { calls.removed += 1; },
  });
  const root = { ...element(), scrollHeight: 100 };
  const document = {
    getElementById: (id) => id === "receipt-print-root" ? root : null,
    head: element(),
    body: {
      appendChild(frame) {
        if (frame.onload) frame.onload();
      },
    },
    createElement(tag) {
      const node = element();
      if (tag === "iframe") {
        calls.frames += 1;
        node.contentWindow = { focus() {}, print() { calls.dialogs += 1; } };
      }
      return node;
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      if (name === "./ticketText") return { ticketLines: () => [] };
      return {};
    },
    document,
    window: {
      pywebview: { api },
      addEventListener() {},
      setTimeout() {},
      print() { calls.dialogs += 1; },
      alert(message) { calls.alerts.push(message); },
    },
  });
  return { ...exports, calls };
}

const receipt = { printer_name: "Ticket Fichier Test", copies: 2, margin_mm: 3 };

test("A4 receipt uses the receipt queue, never print_page, and cleans copies", async () => {
  let args;
  const ctx = setup({
    print_to: async (...values) => { args = values; return true; },
    print_page: () => assert.fail("default queue must not be used"),
  });
  assert.equal(await ctx.printReceipt("A4", receipt), false);
  assert.deepEqual(args, [210, 297, 0, receipt.printer_name]);
  assert.equal(ctx.calls.removed, 1);
  assert.equal(ctx.calls.dialogs, 0);
  assert.deepEqual(ctx.calls.alerts, []);
});

for (const result of [false, new Error("PrintAsync failed"), "unavailable"]) {
  test(`named A4 failure (${result}) never falls back to a dialog/default`, async () => {
    const ctx = setup(result === "unavailable" ? {} : {
      print_to: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
      print_page: () => assert.fail("default queue must not be used"),
    });
    assert.equal(await ctx.printReceipt("A4", receipt), false);
    assert.equal(ctx.calls.dialogs, 0);
    assert.equal(ctx.calls.alerts.length, 1);
    assert.match(ctx.calls.alerts[0], /Ticket non envoyé sur Ticket Fichier Test/);
    assert.equal(ctx.calls.removed, 1);
  });
}

test("unnamed A4 receipt still supports the default queue and browser fallback", async () => {
  let count = 0;
  const ctx = setup({ print_page: async () => { count += 1; return false; } });
  await ctx.printReceipt("A4", { ...receipt, printer_name: "" });
  assert.equal(count, 1);
  assert.equal(ctx.calls.dialogs, 1);
  assert.deepEqual(ctx.calls.alerts, []);
});

test("browser without a selected queue still opens the dialog", async () => {
  const ctx = setup();
  await ctx.printReceipt("A4", { ...receipt, printer_name: "" });
  assert.equal(ctx.calls.dialogs, 1);
});

test("thermal RAW receipt preserves target and drawer return value", async () => {
  let payload;
  const ctx = setup({ print_ticket: async (value) => { payload = JSON.parse(value); return ""; } });
  assert.equal(await ctx.printReceipt("80mm", receipt, [27, 112]), true);
  assert.equal(payload.printer, receipt.printer_name);
  assert.deepEqual(payload.kick, [27, 112]);
  assert.equal(ctx.calls.dialogs, 0);
});

for (const reject of [false, true]) {
  test(`named thermal RAW failure (reject=${reject}) does not fall back`, async () => {
    const ctx = setup({ print_ticket: async () => {
      if (reject) throw new Error("spooler unavailable");
      return "spooler unavailable";
    } });
    assert.equal(await ctx.printReceipt("58mm", receipt), false);
    assert.equal(ctx.calls.dialogs, 0);
    assert.equal(ctx.calls.alerts.length, 1);
  });
}

test("thermal without RAW uses the same named HTML target", async () => {
  let args;
  const ctx = setup({ print_to: async (...values) => { args = values; return true; } });
  await ctx.printReceipt("58mm", receipt);
  assert.equal(args[0], 58);
  assert.equal(args[3], receipt.printer_name);
  assert.equal(ctx.calls.dialogs, 0);
});

test("explicit document dialog mode remains available in the browser", async () => {
  const ctx = setup();
  await ctx.printDocument("Test", "", "Reçu", { direct: false, printerName: receipt.printer_name });
  assert.equal(ctx.calls.dialogs, 1);
});

test("explicit desktop preview does not automatically print", async () => {
  const ctx = setup({ print_to: () => assert.fail("preview must wait for user") });
  await ctx.printDocument("Test", "", "Reçu", { direct: false, printerName: receipt.printer_name });
  assert.equal(ctx.calls.frames, 1);
  assert.equal(ctx.calls.dialogs, 0);
});
