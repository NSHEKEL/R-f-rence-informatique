const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/src/${path}`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { exports, require: (name) => dependencies[name] || require(name), ...globals });
  return exports;
}
const types = load('types.ts');
const storage = new Map();
const style = load('lib/printStyle.ts', { '../types': types }, { localStorage: { getItem: (key) => storage.get(key), setItem: (key,value) => storage.set(key,value) } });
test('defaults and paper presets fill missing keys without replacing saved values', () => {
  const config = style.mergePrinting({ receipt: { font_size: 9, show_customer: false }, label: { columns: 2 } });
  assert.equal(config.receipt.font_size, 9);
  assert.equal(config.receipt.show_customer, false);
  assert.equal(config.label.columns, 2);
  assert.equal(config.documents.font_family, 'Arial');
  assert.equal(style.mergePrinting(null).label.code_type, 'barcode');
  assert.equal(style.receiptPreset('58mm').paper_width_mm, 58);
  assert.equal(style.receiptPreset('80mm').paper_width_mm, 80);
});
test('only reported color queues allow color; ESC/POS always disables color and font', () => {
  const devices = [{ name:'Color', supports_color:true, is_default:true }, { name:'Mono', supports_color:false }];
  const config = { ...types.DEFAULT_PRINTING.receipt, width:'custom', printer_name:'Color' };
  assert.equal(style.ticketCapabilities(config, devices).color, true);
  assert.equal(style.ticketCapabilities({ ...config, printer_name:'Mono' }, devices).color, false);
  assert.equal(style.ticketCapabilities({ ...config, printer_name:'Unknown' }, devices).color, false);
  assert.equal(style.ticketCapabilities(config, []).color, false);
  assert.equal(style.ticketCapabilities({ ...config, width:'80mm' }, devices).color, false);
  assert.equal(style.ticketCapabilities({ ...config, width:'58mm' }, devices).font, false);
  style.rememberPrinterCapabilities(devices);
  assert.equal(style.printerColorAllowed('Color'), true);
  assert.equal(style.printerColorAllowed(''), true);
  assert.equal(style.printerColorAllowed('Mono'), false);
  assert.equal(style.printerColorAllowed('missing'), false);
});
test('labels render real QR modules, optional fields and empty codes safely', () => {
  const rectangles = [];
  const barcode = load('lib/barcode.ts', {}, { document: { createElement: () => ({ getContext: () => ({ fillRect: (...args) => rectangles.push(args) }), toDataURL: () => 'data:image/png;base64,QR' }) } });
  const labels = load('lib/labels.ts', { '../api/client': { formatXOF: String }, './barcode': barcode, './printStyle': style });
  const config = { ...types.DEFAULT_PRINTING.label, code_type:'qr', show_code:false };
  const article = { name:'Nom <test>', sale_price:1000, wholesale_price:0, code:'SKU-1', barcode:'' };
  const html = labels.priceLabelHtml(article, null, config);
  assert.match(html, /qr-square/);
  assert.match(html, /data:image\/png;base64,QR/);
  assert.ok(rectangles.length > 50, 'real QR encoder drew its modules');
  assert.match(html, /Nom &lt;test&gt;/);
  assert.doesNotMatch(html, /class="code"/);
  assert.doesNotMatch(labels.priceLabelHtml({ ...article, code:'' }, null, config), /class="qr/);
  assert.doesNotMatch(labels.priceLabelHtml(article, null, { ...config, show_barcode:false }), /class="qr/);
  const broken = load('lib/barcode.ts', {}, { document:{ createElement:()=>({ getContext:()=>null }) } });
  assert.equal(broken.qrDataUrl('SKU-1'), '');
});
test('RAW footer wraps instead of truncating and applies physical bold/size settings', () => {
  const ticket = load('lib/ticketText.ts');
  const text = 'Message de remerciement complet qui dépasse largement les trente deux caractères du ticket étroit';
  const footer = { textContent:text, classList:{ contains:()=>false } };
  const root = { querySelector:()=>null, querySelectorAll:()=>[footer] };
  const lines = ticket.ticketLines(root, '58mm', { ...types.DEFAULT_PRINTING.receipt, bold:true, font_size:16 });
  assert.equal(lines.map((line) => line.text).join(''), text);
  assert.ok(lines.every((line) => line.bold && line.big && line.text.length <= 16));
});
function printer() {
  const roots = [];
  const document = { title:'', getElementById: () => null, createElement: () => ({ style:{}, remove() {} }), body:{ appendChild: (root) => roots.push(root) }, head:{ appendChild() {} } };
  const print = load('lib/print.ts', { '../types':types, './printStyle':style, './barcode':{}, './offline':{ cacheRead:()=>null }, './ticketText':{} }, { document, window: { addEventListener() {}, pywebview:{ api:{ print_to: () => Promise.resolve(true) } } } });
  return { print, roots };
}
test('actual label sheet uses the configured columns and font size', () => {
  const { print, roots } = printer();
  print.printLabels('Test', '<div class="label">Label</div>', { ...types.DEFAULT_PRINTING.label, columns:2, width_mm:40, font_family:'Georgia', font_size:15 });
  assert.match(roots[0].innerHTML, /grid-template-columns:repeat\(2,40mm\)/);
  assert.match(roots[0].innerHTML, /font-family:"Georgia";font-size: 15px/);
  assert.match(roots[0].innerHTML, /height: 40mm;overflow:hidden/);
});
const config = { ...types.DEFAULT_PRINTING.documents, font_family:'Georgia', font_size:15, text_color:'#123456', accent_color:'#654321', header_text:'En-tête <test>', footer_text:'Pied commun', info_position:'right', show_qty:false };
function check(html) {
  assert.match(html, /commercial-document/);
  assert.match(html, /font-family:"Georgia";font-size:15px/);
  assert.match(html, /#123456/);
  assert.match(html, /#654321/);
  assert.match(html, /row-reverse/);
  assert.match(html, /En-tête &lt;test&gt;/);
  assert.match(html, /Pied commun/);
  assert.match(html, /data-field="qty".*display:none/);
}
test('orders and deliveries use the same style in their actual HTML templates', () => {
  const documents = load('lib/documents.ts', { '../api/client':{ formatDate:String, formatXOF:String }, './barcode':{ barcodeDataUrl:()=>'' }, './units':{}, './print':{}, './printStyle':style });
  const item = { product_name:'Article', quantity:2, unit_price:1000, discount:0, subtotal:2000, ordered_quantity:3, previously_delivered:1 };
  check(documents.orderDocumentHtml({ items:[item], total:2000, reference:'BC1', date:'2026-01-01' }, null, config));
  check(documents.deliveryDocumentHtml({ items:[item], reference:'BL1', date:'2026-01-01' }, null, config, true));
});
test('devis and proforma dispatch shared config through existing printSheet', () => {
  assert.match(readFileSync(`${__dirname}/src/pages/Proformas.tsx`, 'utf8'), /documentConfig: printing.documents/);
  for (const title of ['Devis', 'Facture proforma']) {
    const { print, roots } = printer();
    print.printSheet(title, `<h1>${title}</h1>`, { documentConfig:config });
    check(roots[0].innerHTML);
  }
});
test('invoice and A4 receipt apply common style through actual Receipt rendering', () => {
  const printing = style.mergePrinting({ documents:config });
  const Receipt = load('components/Receipt.tsx', { 'react-dom':{ createPortal:()=>null }, '../api/client':{ formatDateTime:String, formatMoney:String }, '../lib/vat':{ vatBreakdown:()=>null }, '../lib/barcode':{ barcodeDataUrl:()=>'', qrDataUrl:()=>'' }, '../context/CompanyContext':{ useCompany:()=>({ printing }) }, '../lib/units':{ salePriceParts:()=>[] }, '../lib/printStyle':style }, { document:{} }).default;
  for (const reference of ['FACTURE-1', 'RECU-A4']) {
    const html = renderToStaticMarkup(React.createElement(Receipt, { format:'A4', sale:{ reference, items:[], total:0, paid_amount:0 }, company:null }));
    assert.match(html, /font-family:Georgia/);
    assert.match(html, /#123456/);
    assert.match(html, /Pied commun/);
    assert.match(html, /En-tête &lt;test&gt;/);
  }
  printing.receipt.printer_name = 'Mono';
  const monochrome = renderToStaticMarkup(React.createElement(Receipt, { format:'A4', sale:{ reference:'MONO', items:[], total:0 }, company:null }));
  assert.doesNotMatch(monochrome, /#123456|#654321/);
  assert.match(monochrome, /#000000/);
});
