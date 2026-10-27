/**
 * Payment receipt handed to a customer who settles a receivable, or kept as
 * proof of what was paid to a supplier.
 *
 * The sheet reuses the letterhead of the other documents so the shop hands
 * out one consistent set of papers; the thermal version prints the same
 * figures on the receipt printer already configured for sales.
 */

import { formatDateTime, formatXOF } from "../api/client";
import type { CompanySettings } from "../types";
import { documentBarcode, documentHeader, printDocument } from "./print";

export interface ReceiptPayment {
  receipt_reference: string;
  amount: number;
  method: string;
  date: string;
  note: string;
  reference: string;
  cancelled: boolean;
  created_by?: { name: string } | null;
}

export interface ReceiptDebt {
  kind: string;
  party: string;
  reference: string;
  amount: number;
  paid: number;
  remaining: number;
}

const STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a;
         margin: 0; padding: 16mm; font-size: 13px; }
  .doc-head { display: flex; align-items: center; gap: 12px;
              border-bottom: 3px solid #0f172a; padding-bottom: 10px; }
  .doc-head img { height: 20mm; max-width: 42mm; object-fit: contain; }
  .doc-head h1 { margin: 0; font-size: 18px; }
  .doc-head .meta { margin: 2px 0 0; font-size: 11px; color: #475569; }
  h2.title { text-align: center; margin: 14px 0 2px; font-size: 18px;
             letter-spacing: .08em; text-transform: uppercase; }
  p.number { text-align: center; margin: 0 0 14px; font-weight: 700;
             color: #b91c1c; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { width: 45%; background: #f1f5f9; }
  td.num { text-align: right; font-weight: 600; }
  .amount { margin: 14px 0; padding: 10px 12px; border: 2px solid #0f172a;
            border-radius: 4px; font-size: 17px; font-weight: 800;
            text-align: center; }
  .signatures { display: flex; gap: 14px; margin-top: 18px; }
  .sign { flex: 1; border: 1px solid #cbd5e1; border-radius: 4px;
          padding: 8px 10px; min-height: 22mm; font-size: 11px;
          color: #475569; }
  .cancelled { margin-top: 10px; text-align: center; color: #b91c1c;
               font-weight: 700; letter-spacing: .1em; }
  .doc-barcode { display: block; margin: 14px auto 0; height: 15mm; }
  @page { size: A4 portrait; margin: 0; }
`;

const THERMAL_STYLE = `
  body { font-family: "Courier New", monospace; color: #000; margin: 0;
         padding: 2mm; font-size: 12px; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
`;

function row(label: string, value: string): string {
  return `<tr><th>${label}</th><td>${value}</td></tr>`;
}

function escape(value: string): string {
  return value.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
  );
}

/** A4 receipt: who paid, how much, on what document and what is left. */
export function paymentReceiptHtml(
  payment: ReceiptPayment,
  debt: ReceiptDebt,
  company: CompanySettings | null
): string {
  const receivable = debt.kind !== "dette";
  const title = receivable ? "Reçu de paiement" : "Preuve de règlement";
  const who = receivable ? "Reçu de" : "Payé à";
  return (
    documentHeader(company) +
    `<h2 class="title">${title}</h2>` +
    `<p class="number">N° ${escape(payment.receipt_reference || "—")}</p>` +
    "<table>" +
    row("Date", formatDateTime(payment.date)) +
    row(who, escape(debt.party || "—")) +
    row("Document concerné", escape(debt.reference || "—")) +
    row("Mode de paiement", escape(payment.method || "—")) +
    (payment.reference
      ? row("Référence du paiement", escape(payment.reference))
      : "") +
    row("Montant du document", formatXOF(debt.amount)) +
    row("Total déjà réglé", formatXOF(debt.paid)) +
    row("Reste à payer", formatXOF(debt.remaining)) +
    (payment.created_by?.name
      ? row("Encaissé par", escape(payment.created_by.name))
      : "") +
    "</table>" +
    `<p class="amount">Montant réglé : ${formatXOF(payment.amount)}</p>` +
    (payment.note ? `<p>Observations : ${escape(payment.note)}</p>` : "") +
    '<div class="signatures">' +
    `<div class="sign">Signature ${receivable ? "du client" : "du fournisseur"}</div>` +
    '<div class="sign">Cachet et signature de l\'entreprise</div>' +
    "</div>" +
    (payment.cancelled ? '<p class="cancelled">RÈGLEMENT ANNULÉ</p>' : "") +
    documentBarcode(payment.receipt_reference || "")
  );
}

/** Same receipt on the thermal roll already used for sales tickets. */
export function paymentTicketHtml(
  payment: ReceiptPayment,
  debt: ReceiptDebt,
  company: CompanySettings | null
): string {
  const line = (label: string, value: string) =>
    `<div class="row"><span>${label}</span><span>${value}</span></div>`;
  return (
    `<div class="center bold">${escape(company?.name ?? "")}</div>` +
    (company?.phone ? `<div class="center">${escape(company.phone)}</div>` : "") +
    "<hr />" +
    '<div class="center bold">REÇU DE PAIEMENT</div>' +
    `<div class="center">N° ${escape(payment.receipt_reference || "—")}</div>` +
    "<hr />" +
    line("Date", formatDateTime(payment.date)) +
    line("Tiers", escape(debt.party || "—")) +
    line("Document", escape(debt.reference || "—")) +
    line("Mode", escape(payment.method || "—")) +
    "<hr />" +
    line("Montant réglé", formatXOF(payment.amount)) +
    line("Reste à payer", formatXOF(debt.remaining)) +
    "<hr />" +
    (payment.cancelled ? '<div class="center bold">ANNULÉ</div>' : "") +
    '<div class="center">Merci de votre règlement</div>'
  );
}

export function printPaymentReceipt(
  payment: ReceiptPayment,
  debt: ReceiptDebt,
  company: CompanySettings | null,
  thermal = false,
  /** Roll width already configured for the sales receipts. */
  width: string = "80mm"
): void {
  const title = `Reçu ${payment.receipt_reference}`;
  if (thermal) {
    printDocument(
      title,
      `${THERMAL_STYLE}\n  @page { size: ${width} auto; margin: 0; }`,
      paymentTicketHtml(payment, debt, company)
    );
    return;
  }
  printDocument(title, STYLE, paymentReceiptHtml(payment, debt, company));
}
