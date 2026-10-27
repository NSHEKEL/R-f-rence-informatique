/**
 * Payslip sheet: what the worker is handed at the end of the month.
 *
 * The same HTML feeds the preview, the printer and the PDF export, so what
 * is shown on screen is exactly what comes out of the printer. Several
 * payslips are printed as one document with one sheet per worker.
 */

import { formatMoney } from "../api/client";
import type { CompanySettings } from "../types";
import { printDocument } from "./print";

export interface PayslipLine {
  kind: string;
  label: string;
  quantity: number;
  rate: number;
  base: number;
  amount: number;
}

export interface PayslipEmployee {
  matricule: string;
  full_name: string;
  job: string;
  department: string;
  contract: string;
  hired_at: string | null;
  social_number: string;
}

export interface PayslipDocument {
  reference: string;
  year: number;
  month: number;
  gross: number;
  deductions: number;
  net: number;
  net_in_words: string;
  status: string;
  payment_method: string;
  paid_at: string | null;
  employee?: PayslipEmployee | null;
  lines: PayslipLine[];
}

export const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export const PAYSLIP_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a;
         margin: 0; font-size: 12px; }
  .sheet { padding: 14mm; page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .head { display: flex; align-items: center; gap: 12px;
          border-bottom: 3px solid #0f172a; padding-bottom: 10px; }
  .head img { height: 20mm; max-width: 42mm; object-fit: contain; }
  .head h1 { margin: 0; font-size: 18px; }
  .head .meta { margin: 2px 0 0; font-size: 11px; color: #475569; }
  h2.title { text-align: center; margin: 12px 0 2px; font-size: 17px;
             letter-spacing: .08em; text-transform: uppercase; }
  p.period { text-align: center; margin: 0 0 12px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; }
  th { background: #f1f5f9; }
  td.num, th.num { text-align: right; }
  tr.total td { font-weight: 700; background: #f8fafc; }
  .who td { border: none; padding: 2px 0; }
  .who th { border: none; padding: 2px 10px 2px 0; background: none;
            color: #64748b; font-weight: 600; width: 34mm; }
  .columns { display: flex; gap: 6mm; margin-top: 10px; }
  .columns > div { flex: 1; }
  h3 { font-size: 12px; margin: 0 0 4px; text-transform: uppercase;
       letter-spacing: .05em; color: #334155; }
  .net { margin: 12px 0 6px; padding: 10px 12px; border: 2px solid #0f172a;
         border-radius: 4px; display: flex; justify-content: space-between;
         font-size: 16px; font-weight: 800; }
  .words { font-style: italic; color: #475569; margin: 0 0 12px; }
  .signatures { display: flex; gap: 8mm; margin-top: 14px; }
  .sign { flex: 1; border: 1px solid #cbd5e1; border-radius: 4px;
          padding: 8px 10px; min-height: 22mm; font-size: 11px;
          color: #475569; }
  .draft { text-align: center; color: #b91c1c; font-weight: 700;
           letter-spacing: .1em; margin-top: 8px; }
  @page { size: A4 portrait; margin: 0; }
`;

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("fr-FR") : "—";
}

function rows(lines: PayslipLine[], kind: string): string {
  const kept = lines.filter((line) => line.kind === kind);
  if (!kept.length) {
    return `<tr><td colspan="4" style="color:#94a3b8">Aucun élément</td></tr>`;
  }
  return kept
    .map(
      (line) =>
        `<tr><td>${line.label}</td>` +
        `<td class="num">${line.quantity ? line.quantity : ""}</td>` +
        `<td class="num">${line.rate ? line.rate : ""}</td>` +
        `<td class="num">${formatMoney(line.amount)}</td></tr>`
    )
    .join("");
}

/** One payslip, as printed on its own A4 sheet. */
export function payslipSheet(
  slip: PayslipDocument,
  company: CompanySettings | null
): string {
  const worker = slip.employee;
  const contact = [company?.address, company?.phone, company?.email]
    .filter(Boolean)
    .join(" · ");
  const month = MONTHS[slip.month - 1] ?? slip.month;
  return (
    `<div class="sheet">` +
    `<div class="head">` +
    (company?.logo ? `<img src="${company.logo}" alt="" />` : "") +
    `<div><h1>${company?.name ?? ""}</h1>` +
    (contact ? `<p class="meta">${contact}</p>` : "") +
    (company?.tax_id ? `<p class="meta">${company.tax_id}</p>` : "") +
    `</div></div>` +
    `<h2 class="title">Bulletin de paie</h2>` +
    `<p class="period">${month} ${slip.year} — ${slip.reference}</p>` +
    `<table class="who"><tbody>` +
    `<tr><th>Matricule</th><td>${worker?.matricule ?? ""}</td>` +
    `<th>Fonction</th><td>${worker?.job || "—"}</td></tr>` +
    `<tr><th>Nom et prénoms</th><td>${worker?.full_name ?? ""}</td>` +
    `<th>Service</th><td>${worker?.department || "—"}</td></tr>` +
    `<tr><th>Type de contrat</th><td>${worker?.contract || "—"}</td>` +
    `<th>Date d'embauche</th><td>${day(worker?.hired_at ?? null)}</td></tr>` +
    `<tr><th>N° CNPS</th><td>${worker?.social_number || "—"}</td>` +
    `<th>Période</th><td>${month} ${slip.year}</td></tr>` +
    `</tbody></table>` +
    `<div class="columns"><div><h3>Gains</h3><table><thead><tr>` +
    `<th>Élément</th><th class="num">Qté</th><th class="num">Taux</th>` +
    `<th class="num">Montant</th></tr></thead><tbody>` +
    rows(slip.lines, "gain") +
    `<tr class="total"><td colspan="3">Total brut</td>` +
    `<td class="num">${formatMoney(slip.gross)}</td></tr>` +
    `</tbody></table></div>` +
    `<div><h3>Retenues</h3><table><thead><tr>` +
    `<th>Retenue</th><th class="num">Base</th><th class="num">Taux</th>` +
    `<th class="num">Montant</th></tr></thead><tbody>` +
    slip.lines
      .filter((line) => line.kind === "retenue")
      .map(
        (line) =>
          `<tr><td>${line.label}</td>` +
          `<td class="num">${line.base ? formatMoney(line.base) : ""}</td>` +
          `<td class="num">${line.rate ? line.rate : ""}</td>` +
          `<td class="num">${formatMoney(line.amount)}</td></tr>`
      )
      .join("") +
    (slip.lines.some((line) => line.kind === "retenue")
      ? ""
      : `<tr><td colspan="4" style="color:#94a3b8">Aucune retenue</td></tr>`) +
    `<tr class="total"><td colspan="3">Total retenues</td>` +
    `<td class="num">${formatMoney(slip.deductions)}</td></tr>` +
    `</tbody></table></div></div>` +
    `<div class="net"><span>Net à payer</span>` +
    `<span>${formatMoney(slip.net)}</span></div>` +
    `<p class="words">Arrêté le présent bulletin à la somme de : ` +
    `${slip.net_in_words} francs CFA.</p>` +
    `<table class="who"><tbody><tr>` +
    `<th>Date de paiement</th><td>${day(slip.paid_at)}</td>` +
    `<th>Mode de paiement</th><td>${slip.payment_method || "—"}</td>` +
    `</tr></tbody></table>` +
    `<div class="signatures">` +
    `<div class="sign">Signature de l'employeur</div>` +
    `<div class="sign">Signature du travailleur</div></div>` +
    (slip.status === "Brouillon" || slip.status === "Annulée"
      ? `<p class="draft">${slip.status.toUpperCase()}</p>`
      : "") +
    `</div>`
  );
}

/** Sends one or several payslips to the printer (or to a PDF printer). */
export function printPayslips(
  slips: PayslipDocument[],
  company: CompanySettings | null
): void {
  const title =
    slips.length === 1
      ? `Bulletin ${slips[0].reference}`
      : `Bulletins de paie (${slips.length})`;
  printDocument(
    title,
    PAYSLIP_STYLE,
    slips.map((slip) => payslipSheet(slip, company)).join("")
  );
}
