/**
 * Purchase orders (BC) and delivery notes (BL) printed on A4/A5.
 *
 * Both documents share the same letterhead, the same table and the same
 * signature block so a customer receives a consistent set of papers; what the
 * shop shows or hides comes from the saved "Documents commerciaux" settings.
 */

import { formatDate, formatXOF } from "../api/client";
import type {
  CompanySettings,
  Delivery,
  DocumentConfig,
  Order,
} from "../types";
import { barcodeDataUrl } from "./barcode";
import { printDocument } from "./print";

const STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a;
         margin: 0; padding: 14mm; font-size: 12px; }
  .head { display: flex; justify-content: space-between; gap: 16px;
          border-bottom: 3px solid #0f172a; padding-bottom: 10px; }
  .head img.logo { height: 22mm; max-width: 45mm; object-fit: contain; }
  .company { font-size: 11px; line-height: 1.5; }
  .company strong { font-size: 16px; display: block; margin-bottom: 2px; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 20px; letter-spacing: .06em;
              text-transform: uppercase; }
  .title .number { font-size: 16px; font-weight: 700; color: #b91c1c; }
  .title .dates { font-size: 11px; color: #475569; line-height: 1.6; }
  .parties { display: flex; gap: 14px; margin: 14px 0; }
  .party { flex: 1; border: 1px solid #cbd5e1; border-radius: 4px;
           padding: 8px 10px; line-height: 1.5; }
  .party h2 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase;
              letter-spacing: .05em; color: #475569; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; }
  th { background: #f1f5f9; text-transform: uppercase; font-size: 10px;
       letter-spacing: .03em; }
  td.num, th.num { text-align: right; }
  .totals { width: 62mm; margin-left: auto; margin-top: 10px; }
  .totals td { border: none; padding: 3px 0; }
  .totals td.num { font-weight: 600; }
  .totals tr.grand td { border-top: 2px solid #0f172a; font-size: 13px;
                        font-weight: 800; padding-top: 5px; }
  .terms { margin-top: 12px; font-size: 11px; line-height: 1.6; }
  .terms span { color: #475569; }
  .signatures { display: flex; gap: 14px; margin-top: 16px; }
  .sign { flex: 1; border: 1px solid #cbd5e1; border-radius: 4px;
          padding: 8px 10px; min-height: 24mm; font-size: 11px;
          color: #475569; }
  .mention { margin-top: 12px; font-size: 10px; color: #475569;
             font-style: italic; }
  .barcode { display: block; margin: 12px auto 0; height: 16mm; }
`;

function pageStyle(config: DocumentConfig): string {
  const size = config.format === "A5" ? "A5 portrait" : "A4 portrait";
  return `${STYLE}\n  @page { size: ${size}; margin: 0; }`;
}

function letterhead(
  company: CompanySettings | null,
  config: DocumentConfig
): string {
  const lines = [
    config.show_address ? company?.address : "",
    config.show_phone && company?.phone ? `Tél. : ${company.phone}` : "",
    config.show_whatsapp && company?.phone
      ? `WhatsApp : ${company.phone}`
      : "",
    config.show_email ? company?.email : "",
    config.show_website ? company?.website : "",
    company?.tax_id ? `N° fiscal : ${company.tax_id}` : "",
  ].filter(Boolean);
  const logo =
    config.show_logo && company?.logo
      ? `<img class="logo" src="${company.logo}" alt="" />`
      : "";
  return (
    `${logo}<div class="company"><strong>${company?.name ?? ""}</strong>` +
    lines.join("<br/>") +
    `</div>`
  );
}

function party(title: string, lines: (string | undefined)[]): string {
  return (
    `<div class="party"><h2>${title}</h2>` +
    lines.filter(Boolean).join("<br/>") +
    `</div>`
  );
}

function barcode(reference: string): string {
  const image = barcodeDataUrl(reference);
  return image ? `<img class="barcode" src="${image}" alt="" />` : "";
}

function signatures(config: DocumentConfig, left: string, right: string) {
  const blocks = [
    config.show_company_signature ? `<div class="sign">${left}</div>` : "",
    config.show_customer_signature ? `<div class="sign">${right}</div>` : "",
  ].filter(Boolean);
  return blocks.length ? `<div class="signatures">${blocks.join("")}</div>` : "";
}

/** HTML of a purchase order, ready to print or to preview. */
export function orderDocumentHtml(
  order: Order,
  company: CompanySettings | null,
  config: DocumentConfig
): string {
  const vatRate = config.show_vat ? company?.vat_rate ?? 0 : 0;
  const rows = order.items
    .map(
      (item, index) =>
        `<tr><td class="num">${index + 1}</td>` +
        `<td>${item.reference || "—"}</td>` +
        `<td>${item.product_name}</td>` +
        `<td class="num">${item.quantity}</td>` +
        `<td>${item.unit || "u"}</td>` +
        `<td class="num">${formatXOF(item.unit_price)}</td>` +
        (config.show_discount
          ? `<td class="num">${formatXOF(item.discount)}</td>`
          : "") +
        `<td class="num">${formatXOF(item.subtotal)}</td></tr>`
    )
    .join("");
  const subtotal = order.items.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0
  );
  const lineDiscounts = order.items.reduce(
    (sum, item) => sum + (item.discount || 0),
    0
  );
  const discount = lineDiscounts + (order.discount || 0);
  const totalHt = order.total;
  const vat = (totalHt * vatRate) / 100;
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    `<div class="head">${letterhead(company, config)}` +
    `<div class="title"><h1>Bon de commande</h1>` +
    `<p class="number">N° ${order.reference}</p>` +
    `<p class="dates">Date : ${formatDate(order.date)}` +
    (order.expected_date
      ? `<br/>Livraison prévue : ${formatDate(order.expected_date)}`
      : "") +
    `<br/>Statut : ${order.status}</p></div></div>` +
    `<div class="parties">` +
    party("Client", [
      order.customer_name,
      order.delivery_address || undefined,
    ]) +
    party("Commande", [
      `Articles : ${count}`,
      `Établi par : ${order.created_by?.name ?? "—"}`,
    ]) +
    `</div>` +
    `<table><thead><tr><th class="num">N°</th><th>Référence</th>` +
    `<th>Désignation</th><th class="num">Qté</th><th>Unité</th>` +
    `<th class="num">P.U. HT</th>` +
    (config.show_discount ? `<th class="num">Remise</th>` : "") +
    `<th class="num">Total HT</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<table class="totals"><tbody>` +
    `<tr><td>Sous-total HT</td><td class="num">${formatXOF(subtotal)}</td></tr>` +
    (config.show_discount && discount > 0
      ? `<tr><td>Remise</td><td class="num">- ${formatXOF(discount)}</td></tr>`
      : "") +
    `<tr><td>Total HT</td><td class="num">${formatXOF(totalHt)}</td></tr>` +
    (vatRate > 0
      ? `<tr><td>TVA ${vatRate} %</td><td class="num">${formatXOF(vat)}</td></tr>`
      : "") +
    `<tr class="grand"><td>Total TTC</td>` +
    `<td class="num">${formatXOF(totalHt + vat)}</td></tr>` +
    `<tr><td>Acompte versé</td><td class="num">${formatXOF(
      order.deposit || 0
    )}</td></tr>` +
    `<tr><td>Reste à payer</td><td class="num">${formatXOF(
      Math.max(totalHt + vat - (order.deposit || 0), 0)
    )}</td></tr>` +
    `</tbody></table>` +
    `<div class="terms">` +
    `<p><span>Conditions de paiement :</span> ${
      order.payment_terms || "—"
    }</p>` +
    `<p><span>Conditions / délai de livraison :</span> ${
      order.delivery_terms || "—"
    }</p>` +
    `<p><span>Observations :</span> ${order.note || "—"}</p></div>` +
    signatures(
      config,
      "Signature / cachet entreprise",
      "Signature du client"
    ) +
    `<p class="mention">Bon de commande — document contractuel.</p>` +
    barcode(order.reference)
  );
}

/** HTML of a delivery note; prices only when the shop asked for them. */
export function deliveryDocumentHtml(
  delivery: Delivery,
  company: CompanySettings | null,
  config: DocumentConfig,
  showPrices: boolean
): string {
  const vatRate = config.show_vat ? company?.vat_rate ?? 0 : 0;
  const rows = delivery.items
    .map(
      (item, index) =>
        `<tr><td class="num">${index + 1}</td>` +
        `<td>${item.reference || "—"}</td>` +
        `<td>${item.product_name}</td>` +
        `<td class="num">${item.ordered_quantity}</td>` +
        `<td class="num">${item.previously_delivered}</td>` +
        `<td class="num">${item.quantity}</td>` +
        `<td>${item.unit || "u"}</td>` +
        (showPrices
          ? `<td class="num">${formatXOF(item.unit_price)}</td>` +
            `<td class="num">${formatXOF(item.subtotal)}</td>`
          : "") +
        `<td>${item.observation || ""}</td></tr>`
    )
    .join("");
  const totalHt = delivery.items.reduce((sum, item) => sum + item.subtotal, 0);
  const vat = (totalHt * vatRate) / 100;
  const count = delivery.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    `<div class="head">${letterhead(company, config)}` +
    `<div class="title"><h1>Bon de livraison</h1>` +
    `<p class="number">N° ${delivery.reference}</p>` +
    `<p class="dates">Date de livraison : ${formatDate(delivery.date)}` +
    (delivery.order_reference
      ? `<br/>Référence BC : ${delivery.order_reference}`
      : "") +
    `<br/>Statut : ${delivery.status}</p></div></div>` +
    `<div class="parties">` +
    party("Client", [delivery.customer_name]) +
    party("Adresse de livraison", [
      delivery.address || delivery.customer_name,
      delivery.carrier ? `Livreur : ${delivery.carrier}` : undefined,
      `Articles livrés : ${count}`,
    ]) +
    `</div>` +
    `<table><thead><tr><th class="num">N°</th><th>Référence</th>` +
    `<th>Désignation</th><th class="num">Commandé</th>` +
    `<th class="num">Déjà livré</th><th class="num">Livré</th><th>Unité</th>` +
    (showPrices
      ? `<th class="num">P.U.</th><th class="num">Total</th>`
      : "") +
    `<th>Observation</th></tr></thead><tbody>${rows}</tbody></table>` +
    (showPrices
      ? `<table class="totals"><tbody>` +
        `<tr><td>Total HT</td><td class="num">${formatXOF(totalHt)}</td></tr>` +
        (vatRate > 0
          ? `<tr><td>TVA ${vatRate} %</td>` +
            `<td class="num">${formatXOF(vat)}</td></tr>`
          : "") +
        `<tr class="grand"><td>Total TTC</td>` +
        `<td class="num">${formatXOF(totalHt + vat)}</td></tr>` +
        `</tbody></table>`
      : "") +
    `<div class="terms"><p><span>Observations :</span> ${
      delivery.note || "—"
    }</p>` +
    `<p><span>Livré par :</span> ${
      delivery.carrier || delivery.created_by?.name || "—"
    }</p>` +
    `<p><span>Reçu par :</span> ${delivery.recipient || "—"}</p>` +
    `<p><span>Date de réception :</span> ______________________</p></div>` +
    signatures(config, "Signature du livreur", "Signature du client") +
    `<p class="mention">Marchandise reçue conforme, sous réserve des ` +
    `observations ci-dessus.</p>` +
    barcode(delivery.reference)
  );
}

/** Sends a commercial document to the printer (or to a PDF printer). */
export function printCommercialDocument(
  title: string,
  html: string,
  config: DocumentConfig
): void {
  printDocument(title, pageStyle(config), html);
}
