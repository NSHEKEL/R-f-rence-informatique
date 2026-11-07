import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Check,
  FileText,
  Printer,
  Receipt as ReceiptIcon,
  RefreshCw,
  Tags,
} from "lucide-react";
import { applyPostePrinters, writePostePrinters } from "../context/CompanyContext";
import api, { localApi } from "../api/client";
import Modal from "../components/Modal";
import Receipt from "../components/Receipt";
import { printDocument, printLabels, printReceipt } from "../lib/print";
import { priceLabelHtml } from "../lib/labels";
import { useCompany } from "../context/CompanyContext";
import { useLicense } from "../context/LicenseContext";
import type {
  CompanySettings,
  DocumentConfig,
  LabelPrinterConfig,
  PrinterDevice,
  PrintingConfig,
  ReceiptPrinterConfig,
  Sale,
} from "../types";

interface Props {
  /** Company form held by the settings page, for the shared drawer fields. */
  company: Omit<CompanySettings, "id"> & { smtp_password?: string };
  update: (patch: Partial<CompanySettings>) => void;
  /** Saves the company form, so the drawer test uses the typed values. */
  saveCompany: () => Promise<void>;
}

/** Serial, parallel or shared path, as opposed to a printer name. */
function isPortPath(target: string): boolean {
  const value = (target || "").trim().toUpperCase();
  if (
    value.startsWith("\\\\") ||
    value.startsWith("/DEV/") ||
    value.endsWith(":")
  ) {
    return true;
  }
  // Only full COM/LPT names are ports: a queue named COMPTOIR is a printer.
  return /^(COM|LPT)\d+:?$/.test(value);
}

/**
 * Printer picker: the queues declared in Windows are listed with their
 * availability, so the counter chooses instead of typing a name. A printer
 * configured on another computer stays selectable, otherwise saving the
 * settings from a back office would silently clear it.
 */
function PrinterSelect({
  value,
  devices,
  loading,
  onChange,
  onRefresh,
  label,
  hint,
}: {
  value: string;
  devices: PrinterDevice[];
  loading: boolean;
  onChange: (name: string) => void;
  onRefresh: () => void;
  label: string;
  hint?: string;
}) {
  const known = devices.some((device) => device.name === value);
  const chosen = devices.find((device) => device.name === value);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <select
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title={label}
        >
          <option value="">Imprimante Windows par défaut</option>
          {devices.map((device) => (
            <option key={device.name} value={device.name}>
              {device.name}
              {device.is_default ? " (par défaut)" : ""}
              {device.available ? "" : ` — ${device.status}`}
            </option>
          ))}
          {value && !known && (
            <option value={value}>{value} — non installée ici</option>
          )}
        </select>
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={onRefresh}
          disabled={loading}
          title="Actualiser la liste des imprimantes installées"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {loading
          ? "Lecture des imprimantes installées..."
          : value
            ? chosen
              ? `${chosen.status}${chosen.port ? ` · ${chosen.port}` : ""}`
              : "Cette imprimante n'est pas installée sur ce poste."
            : hint ?? "Choisissez une imprimante installée sur ce poste."}
      </p>
    </div>
  );
}

/** Technical report shown when detection fails: Windows calls, per-queue
 * results — so support can tell "no printers" from "detection broken". */
function DiagnosePanel({
  data,
  received,
}: {
  data: Record<string, unknown>;
  received: number;
}) {
  const stage = (key: string) => data[key] as
    | { count?: number; names?: string[]; error?: string }
    | undefined;
  const l1 = stage("level1");
  const l2 = stage("level2");
  const queues = (data.queues as
    | { name: string; ok: boolean; status?: string; error?: string }[]
    | undefined) ?? [];
  return (
    <details className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Détails techniques
      </summary>
      <ul className="mt-1 space-y-1">
        <li>A — Spouleur : {(data.error as string) || "OK"}</li>
        <li>
          B — Windows niv. 1 :{" "}
          {l1?.error ?? `${l1?.count ?? 0} file(s)`}
        </li>
        <li>
          C — Windows niv. 2 :{" "}
          {l2?.error ?? `${l2?.count ?? 0} file(s)`}
        </li>
        <li>Par défaut : {(data.default_error as string) || (data.default as string) || "—"}</li>
        <li>D — GetPrinter par file :</li>
        <li>React : {received} file(s) affichée(s)</li>
        {queues.map((q) => (
          <li key={q.name}>
            {q.name} :{" "}
            {q.ok ? q.status ?? "?" : q.error ?? "Non détectable"}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Ticket used by the preview and the test print, never stored. */
function sampleSale(): Sale {
  const line = (id: number, name: string, qty: number, price: number) => ({
    id,
    product_id: id,
    product_name: name,
    quantity: qty,
    unit_price: price,
    subtotal: qty * price,
    returned_quantity: 0,
    discount: 0,
  });
  const items = [
    line(1, "Câble HDMI 2 m", 2, 3000),
    line(2, "Clé USB 32 Go", 1, 7500),
    line(3, "Souris sans fil", 1, 9000),
  ];
  const total = items.reduce((s, i) => s + i.subtotal, 0);
  return {
    id: 0,
    reference: "TEST-000001",
    customer_id: null,
    customer: null,
    date: new Date().toISOString(),
    total,
    status: "Payée",
    payment_method: "Espèces",
    note: "",
    receipt_footer: "",
    price_mode: "detail",
    created_by: {
      id: 0,
      name: "Ticket de test",
      email: "",
      role: "",
      is_active: true,
    },
    items,
    print_count: 0,
    returned_total: 0,
    paid_amount: total + 2500,
    discount: 1000,
  };
}

const FONTS = ["Arial", "Helvetica", "Tahoma", "Verdana", "Courier New"];

/** Ticket elements the shop can switch on or off, in printing order. */
const RECEIPT_SWITCHES: { key: keyof ReceiptPrinterConfig; label: string }[] = [
  { key: "show_logo", label: "Logo" },
  { key: "show_company", label: "Nom de l'entreprise" },
  { key: "show_address", label: "Adresse" },
  { key: "show_phone", label: "Téléphone" },
  { key: "show_email", label: "E-mail" },
  { key: "show_website", label: "Site Internet" },
  { key: "show_tax_id", label: "RCCM / NCC" },
  { key: "show_header", label: "Message d'en-tête" },
  { key: "show_number", label: "Numéro du ticket" },
  { key: "show_datetime", label: "Date et heure" },
  { key: "show_seller", label: "Vendeur" },
  { key: "show_customer", label: "Client" },
  { key: "show_qty", label: "Quantité" },
  { key: "show_unit_price", label: "Prix unitaire" },
  { key: "show_discount", label: "Remise" },
  { key: "show_vat", label: "TVA" },
  { key: "show_total_ht", label: "Total HT" },
  { key: "show_total_ttc", label: "Total TTC" },
  { key: "show_paid", label: "Montant payé" },
  { key: "show_change", label: "Monnaie rendue" },
  { key: "show_payment", label: "Mode de paiement" },
  { key: "show_barcode", label: "Code-barres" },
  { key: "show_qr", label: "QR code" },
  { key: "show_footer", label: "Message de pied" },
];

const LABEL_SWITCHES: { key: keyof LabelPrinterConfig; label: string }[] = [
  { key: "show_logo", label: "Logo" },
  { key: "show_shop", label: "Nom de la boutique" },
  { key: "show_name", label: "Désignation" },
  { key: "show_price", label: "Prix de détail" },
  { key: "show_wholesale", label: "Prix de gros" },
  { key: "show_code", label: "Code article" },
  { key: "show_barcode", label: "Code-barres" },
];

/** Blocks of the commercial documents (order and delivery notes). */
const DOCUMENT_SWITCHES: { key: keyof DocumentConfig; label: string }[] = [
  { key: "show_logo", label: "Afficher le logo" },
  { key: "show_address", label: "Afficher l'adresse" },
  { key: "show_phone", label: "Afficher le téléphone" },
  { key: "show_whatsapp", label: "Afficher le WhatsApp" },
  { key: "show_email", label: "Afficher l'e-mail" },
  { key: "show_website", label: "Afficher le site web" },
  { key: "show_vat", label: "Afficher la TVA" },
  { key: "show_discount", label: "Afficher la remise" },
  { key: "show_prices_on_delivery", label: "Afficher les prix sur le BL" },
  { key: "show_customer_signature", label: "Afficher la signature client" },
  {
    key: "show_company_signature",
    label: "Afficher la signature entreprise",
  },
];

/**
 * Printing tab: the receipt printer and the label printer are configured
 * separately, saved once and reused automatically by every printout.
 */
export default function PrintingSettings({
  company,
  update,
  saveCompany,
}: Props) {
  const { printing, setPrinting, company: branding } = useCompany();
  const { hasFeature } = useLicense();
  const thermal = hasFeature("impression_thermique");
  const [form, setForm] = useState<PrintingConfig>(printing);
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [printersError, setPrintersError] = useState("");
  const [diagnostics, setDiagnostics] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  // A drawer wired straight into a COM/LPT port is typed, not picked.
  const drawerPort = isPortPath(company.drawer_port);
  const [drawerTesting, setDrawerTesting] = useState(false);
  const [drawerMessage, setDrawerMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    setForm(applyPostePrinters(printing));
  }, [printing]);

  const loadPrinters = useCallback(() => {
    setLoadingPrinters(true);
    setPrintersError("");
    // localApi, pas api : les imprimantes appartiennent à CE poste, pas au
    // serveur du magasin. Avec api, un poste branché au serveur afficherait
    // les files du serveur et jamais les siennes (Canon USB003, ...).
    localApi
      .get<{ devices: PrinterDevice[] }>("/settings/printers")
      .then((res) => setDevices(res.data.devices))
      .catch((err) => {
        setDevices([]);
        setPrintersError(
          axios.isAxiosError(err)
            ? `Détection impossible : ${
                err.response?.data?.detail ?? err.message
              }`
            : "Détection impossible sur ce poste."
        );
        // Rapport technique étape par étape : aide à situer la panne.
        localApi
          .get<Record<string, unknown>>("/settings/printers/diagnose")
          .then((res) => setDiagnostics(res.data))
          .catch(() => setDiagnostics(null));
      })
      .finally(() => setLoadingPrinters(false));
  }, []);

  useEffect(loadPrinters, [loadPrinters]);

  function patchReceipt(patch: Partial<ReceiptPrinterConfig>) {
    setForm((f) => ({ ...f, receipt: { ...f.receipt, ...patch } }));
    setSaved(false);
  }

  function patchLabel(patch: Partial<LabelPrinterConfig>) {
    setForm((f) => ({ ...f, label: { ...f.label, ...patch } }));
    setSaved(false);
  }

  function patchDocuments(patch: Partial<DocumentConfig>) {
    setForm((f) => ({ ...f, documents: { ...f.documents, ...patch } }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await api.put<PrintingConfig>("/settings/printing", form);
      setPrinting(res.data);
      setForm(applyPostePrinters(res.data));
      // The three printer names are also remembered for this workstation
      // only, so several tills sharing the database keep their own choices.
      writePostePrinters({
        receipt: form.receipt.printer_name,
        label: form.label.printer_name,
        documents: form.documents.printer_name,
        delivery: form.documents.delivery_printer_name,
        quote: form.documents.quote_printer_name,
        reports: form.documents.reports_printer_name,
        settlement: form.documents.settlement_printer_name,
      });
      await saveCompany();
      setSaved(true);
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Enregistrement impossible"
          : "Enregistrement impossible"
      );
    } finally {
      setSaving(false);
    }
  }

  /** Sends a real A4 test page through the Windows driver of that queue. */
  async function testPrinter(name: string) {
    setActionMessage("");
    const sent = await printDocument(
      "Page de test EasyGest",
      "@page { size: A4 portrait; margin: 0; } body { font-family: sans-serif; padding: 20mm; }",
      `<h2>Page de test EasyGest</h2><p>Imprimante : ${name}</p>` +
        `<p>${new Date().toLocaleString("fr-FR")}</p>` +
        "<p>Si cette page s'imprime, la liaison fonctionne.</p>",
      { printerName: name, direct: true, requireSilent: true }
    );
    setActionMessage(sent ? `Page de test spoulée sur ${name}.` : "Page non envoyée : impression silencieuse HTML indisponible ou refusée.");
  }

  /** Real ESC/POS ticket spooled on the chosen printer (58 or 80 mm). */
  async function testTicketOn(name: string, width: "58mm" | "80mm") {
    setActionMessage("");
    const bridge = (
      window as unknown as {
        pywebview?: { api?: { print_ticket?: (p: string) => Promise<string> } };
      }
    ).pywebview?.api?.print_ticket;
    if (!bridge) {
      try {
        const { data } = await localApi.post<{ sent: boolean; printer: string }>(
          "/settings/printers/test", { printer_name: name, document: width }
        );
        setActionMessage(data.sent ? `Ticket de test ${width} spoulé sur ${data.printer}.` : "Ticket non envoyé.");
      } catch (err) {
        setActionMessage(axios.isAxiosError(err) ? err.response?.data?.detail ?? err.message : "Ticket non envoyé.");
      }
      return;
    }
    try {
      const problem = await bridge(
        JSON.stringify({
          printer: name,
          copies: 1,
          cut: true,
          lines: [
            { text: "**TEST EASYGEST**", align: "center", big: true },
            { text: `Ticket ${width} — ${name}`, align: "center" },
            { text: new Date().toLocaleString("fr-FR"), align: "center" },
            { text: "--------------------------------" },
            { text: "1 x Article de test      1 000" },
            { text: "--------------------------------" },
            { text: "**TOTAL : 1 000 FCFA**", align: "right" },
            { text: "", barcode: "TEST-0001" },
          ],
        })
      );
      setActionMessage(
        problem
          ? `Ticket non imprimé : ${problem}`
          : `Ticket de test ${width} spoulé sur ${name}.`
      );
    } catch {
      setActionMessage(`Ticket non imprimé sur ${name}.`);
    }
  }

  /** Real label sheet through the driver: name, price, code and barcode. */
  async function testLabelOn(name: string) {
    setActionMessage("");
    const sent = await printDocument(
      "Étiquette de test EasyGest",
      "@page { size: 60mm 40mm; margin: 0; } body { font-family: sans-serif; padding: 2mm; font-size: 9px; }",
      "<b>Article de test</b><br>Réf : TEST-0001<br>" +
        `<b>1 000 FCFA</b><br><small>${name}</small>`,
      { printerName: name, direct: true, requireSilent: true, widthMm: 60, heightMm: 40 }
    );
    setActionMessage(sent ? `Étiquette de test spoulée sur ${name}.` : "Étiquette non envoyée : impression silencieuse HTML indisponible ou refusée.");
  }

  async function makeDefault(name: string) {
    setActionMessage("");
    try {
      await localApi.post("/settings/printers/default", {
        name,
      });
      setActionMessage(`${name} est maintenant l'imprimante par défaut.`);
      loadPrinters();
    } catch (err) {
      setActionMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Changement impossible"
          : "Changement impossible"
      );
    }
  }

  async function configure(name: string) {
    setActionMessage("");
    try {
      await localApi.post("/settings/printers/preferences", {
        name,
      });
      setActionMessage(`Préférences du pilote ouvertes pour ${name}.`);
    } catch (err) {
      setActionMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Ouverture impossible"
          : "Ouverture impossible"
      );
    }
  }

  /** Prints the sample ticket with the settings currently on screen. */
  function testTicket() {
    setPreview(true);
    window.setTimeout(() => printReceipt(form.receipt.width, form.receipt), 400);
  }

  function testLabels(count: number) {
    const html = Array.from({ length: count })
      .map(() =>
        priceLabelHtml(
          {
            name: "Clé USB 32 Go",
            sale_price: 7500,
            wholesale_price: 6500,
            code: "ART-0001",
            barcode: "3456789012345",
          },
          branding,
          form.label
        )
      )
      .join("");
    printLabels("Étiquettes de test", html, form.label);
  }

  async function testDrawer() {
    setDrawerTesting(true);
    setDrawerMessage("");
    try {
      await saveCompany();
      const { data } = await localApi.post<{ port: string }>(
        "/settings/company/open-drawer"
      );
      setDrawerMessage(`Ouverture envoyée sur ${data.port}.`);
    } catch (err) {
      setDrawerMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Ouverture impossible"
          : "Ouverture impossible"
      );
    } finally {
      setDrawerTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Printers installed on this computer */}
      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={18} className="text-brand-600" />
            <h3 className="text-base font-bold text-slate-900">
              Imprimantes détectées
            </h3>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={loadPrinters}
            disabled={loadingPrinters}
          >
            <RefreshCw size={16} /> Actualiser
          </button>
        </div>
        <button type="button" className="btn-ghost" onClick={() => {
          localApi.get<Record<string, unknown>>("/settings/printers/diagnose")
            .then((res) => setDiagnostics(res.data))
            .catch(() => setActionMessage("Diagnostic indisponible."));
        }}>Diagnostic</button>
        {diagnostics && <DiagnosePanel data={diagnostics} received={devices.length} />}
        {devices.length === 0 ? (
          <p className="text-sm text-slate-500">
            {loadingPrinters
              ? "Lecture des imprimantes installées..."
              : printersError || "Aucune imprimante détectée sur ce poste."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-4">Imprimante</th>
                  <th className="py-1 pr-4">Type</th>
                  <th className="py-1 pr-4">État</th>
                  <th className="py-1 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.name} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-medium text-slate-800">
                      {device.name}
                      {device.is_default && (
                        <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">
                          Par défaut
                        </span>
                      )}
                      {device.driver && (
                        <span className="block text-xs font-normal text-slate-400">
                          {device.driver}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-slate-600">
                      {device.kind || device.port || "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          device.available
                            ? "text-emerald-600"
                            : "text-red-600"
                        }
                      >
                        {device.status}
                      </span>
                      {device.jobs > 0 && (
                        <span className="ml-1 text-xs text-slate-400">
                          · {device.jobs} en file
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => testPrinter(device.name)}
                          title="Envoyer une page de test A4 à cette imprimante"
                        >
                          Tester
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => testTicketOn(device.name, "58mm")}
                          title="Imprimer un ticket de test 58 mm sur cette imprimante"
                        >
                          T58
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => testTicketOn(device.name, "80mm")}
                          title="Imprimer un ticket de test 80 mm sur cette imprimante"
                        >
                          T80
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => testLabelOn(device.name)}
                          title="Imprimer une étiquette de test sur cette imprimante"
                        >
                          Étiquette
                        </button>
                        {!device.is_default && (
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs"
                            onClick={() => makeDefault(device.name)}
                            title="Définir comme imprimante Windows par défaut"
                          >
                            Défaut
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => configure(device.name)}
                          title="Ouvrir les préférences du pilote"
                        >
                          Configurer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {actionMessage && (
          <p className="mt-3 text-sm text-slate-600">{actionMessage}</p>
        )}
      </div>

      {/* Receipt printer */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <ReceiptIcon size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Imprimante de reçus
          </h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <PrinterSelect
            label="Imprimante de reçus"
            value={form.receipt.printer_name}
            devices={devices}
            loading={loadingPrinters}
            onRefresh={loadPrinters}
            onChange={(name) => patchReceipt({ printer_name: name })}
          />
          <div>
            <label className="label">Format du papier</label>
            <select
              className="input"
              value={form.receipt.width}
              onChange={(e) =>
                patchReceipt({
                  width: e.target.value as ReceiptPrinterConfig["width"],
                })
              }
            >
              {thermal && <option value="80mm">Ticket 80 mm (par défaut)</option>}
              {thermal && <option value="58mm">Ticket 58 mm</option>}
              <option value="A4">Feuille A4</option>
            </select>
          </div>
          <div>
            <label className="label">Nombre de copies</label>
            <input
              className="input"
              type="number"
              min={1}
              max={5}
              value={form.receipt.copies}
              onChange={(e) =>
                patchReceipt({ copies: Number(e.target.value) || 1 })
              }
            />
          </div>
          <div>
            <label className="label">Impression après une vente</label>
            <select
              className="input"
              value={form.receipt.auto_print ? "auto" : "manuel"}
              onChange={(e) =>
                patchReceipt({ auto_print: e.target.value === "auto" })
              }
            >
              <option value="auto">Automatique</option>
              <option value="manuel">Manuelle</option>
            </select>
          </div>
        </div>

        {/* Layout */}
        <p className="mb-3 mt-6 text-sm font-bold text-slate-700">
          Mise en page
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Police</label>
            <select
              className="input"
              value={form.receipt.font_family}
              onChange={(e) => patchReceipt({ font_family: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Taille (px)</label>
            <input
              className="input"
              type="number"
              min={8}
              max={18}
              value={form.receipt.font_size}
              onChange={(e) =>
                patchReceipt({ font_size: Number(e.target.value) || 11 })
              }
            />
          </div>
          <div>
            <label className="label">Interligne</label>
            <input
              className="input"
              type="number"
              min={1}
              max={2}
              step={0.05}
              value={form.receipt.line_height}
              onChange={(e) =>
                patchReceipt({ line_height: Number(e.target.value) || 1.35 })
              }
            />
          </div>
          <div>
            <label className="label">Alignement du texte</label>
            <select
              className="input"
              value={form.receipt.align}
              onChange={(e) =>
                patchReceipt({
                  align: e.target.value as ReceiptPrinterConfig["align"],
                })
              }
            >
              <option value="left">Gauche</option>
              <option value="center">Centré</option>
            </select>
          </div>
          <div>
            <label className="label">Marges (mm)</label>
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              value={form.receipt.margin_mm}
              onChange={(e) =>
                patchReceipt({ margin_mm: Number(e.target.value) || 0 })
              }
            />
            <p className="mt-1 text-xs text-slate-400">
              Largeur utile :{" "}
              {form.receipt.width === "58mm"
                ? 58 - 2 * form.receipt.margin_mm
                : form.receipt.width === "80mm"
                  ? 80 - 2 * form.receipt.margin_mm
                  : 210 - 2 * form.receipt.margin_mm}{" "}
              mm
            </p>
          </div>
          <div>
            <label className="label">Logo (mm)</label>
            <input
              className="input"
              type="number"
              min={8}
              max={40}
              value={form.receipt.logo_size_mm}
              onChange={(e) =>
                patchReceipt({ logo_size_mm: Number(e.target.value) || 18 })
              }
            />
          </div>
          <div>
            <label className="label">Alignement du logo</label>
            <select
              className="input"
              value={form.receipt.logo_align}
              onChange={(e) =>
                patchReceipt({
                  logo_align: e.target
                    .value as ReceiptPrinterConfig["logo_align"],
                })
              }
            >
              <option value="center">Centré</option>
              <option value="left">Gauche</option>
            </select>
          </div>
          <div className="sm:col-span-2 flex items-end">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.receipt.cut_paper}
                onChange={(e) => patchReceipt({ cut_paper: e.target.checked })}
              />
              Couper le papier automatiquement (si l'imprimante le supporte)
            </label>
          </div>
        </div>

        {/* Header and footer messages, shared with the existing receipts */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Message d'en-tête</label>
            <input
              className="input"
              value={company.receipt_header}
              onChange={(e) => update({ receipt_header: e.target.value })}
              placeholder="REÇU DE CAISSE"
            />
          </div>
          <div>
            <label className="label">Message de pied de ticket</label>
            <input
              className="input"
              value={company.receipt_footer}
              onChange={(e) => update({ receipt_footer: e.target.value })}
              placeholder="Merci de votre confiance !"
            />
          </div>
        </div>

        {/* Ticket contents */}
        <p className="mb-3 mt-6 text-sm font-bold text-slate-700">
          Éléments imprimés sur le ticket
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {RECEIPT_SWITCHES.map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={Boolean(form.receipt[item.key])}
                onChange={(e) =>
                  patchReceipt({ [item.key]: e.target.checked })
                }
              />
              {item.label}
            </label>
          ))}
        </div>

        {/* Cash drawer */}
        <div className="mt-6 rounded-xl border border-slate-200 p-4">
          <p className="mb-3 text-sm font-bold text-slate-700">
            Tiroir-caisse
          </p>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={company.drawer_enabled}
              onChange={(e) => update({ drawer_enabled: e.target.checked })}
            />
            Tiroir-caisse électronique branché (câble RJ11/RJ12 sur
            l'imprimante, ou port série)
          </label>
          {company.drawer_enabled && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                {drawerPort ? (
                  <>
                    <label className="label">Port du tiroir</label>
                    <input
                      className="input"
                      value={company.drawer_port}
                      onChange={(e) => update({ drawer_port: e.target.value })}
                      placeholder="Ex. COM1, LPT1 ou \\CAISSE\TICKET"
                      title="Port série ou parallèle du tiroir-caisse"
                    />
                    <button
                      type="button"
                      className="mt-1 text-xs text-brand-600 underline"
                      onClick={() => update({ drawer_port: "" })}
                    >
                      Le tiroir est branché sur une imprimante
                    </button>
                  </>
                ) : (
                  <>
                    <PrinterSelect
                      label="Imprimante qui commande le tiroir"
                      value={company.drawer_port}
                      devices={devices}
                      loading={loadingPrinters}
                      onRefresh={loadPrinters}
                      onChange={(name) => update({ drawer_port: name })}
                      hint="Vide : l'imprimante de reçus ouvre le tiroir."
                    />
                    <button
                      type="button"
                      className="mt-1 text-xs text-brand-600 underline"
                      onClick={() => update({ drawer_port: "COM1" })}
                    >
                      Le tiroir est branché sur un port série ou parallèle
                    </button>
                  </>
                )}
              </div>
              <div>
                <label className="label">Code d'ouverture</label>
                <input
                  className="input"
                  value={company.drawer_code}
                  onChange={(e) => update({ drawer_code: e.target.value })}
                  placeholder="27,112,0,25,250"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.receipt.open_drawer}
                    onChange={(e) => {
                      patchReceipt({ open_drawer: e.target.checked });
                      update({ drawer_open_after_sale: e.target.checked });
                    }}
                  />
                  Ouvrir automatiquement le tiroir-caisse après une vente
                </label>
                <p className="mt-1 text-xs text-slate-400">
                  Ordre respecté : validation de la vente, impression du reçu,
                  puis ouverture du tiroir.
                </p>
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button
                  className="btn-ghost"
                  onClick={testDrawer}
                  disabled={drawerTesting}
                  title="Envoyer le code d'ouverture au tiroir-caisse"
                >
                  {drawerTesting
                    ? "Ouverture..."
                    : "Tester le tiroir-caisse"}
                </button>
                {drawerMessage && (
                  <span className="text-sm text-slate-600">
                    {drawerMessage}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer la configuration"}
          </button>
          <button className="btn-ghost" onClick={() => setPreview(true)}>
            Aperçu
          </button>
          <button
            className="btn-ghost"
            onClick={testTicket}
            title="Imprimer un ticket de test avec ces réglages"
          >
            <Printer size={16} /> Tester l'impression
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-sm font-medium text-emerald-600">
              <Check size={16} /> Enregistré
            </span>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>

      {/* Label printer */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Tags size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Imprimante d'étiquettes
          </h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <PrinterSelect
              label="Imprimante d'étiquettes"
              value={form.label.printer_name}
              devices={devices}
              loading={loadingPrinters}
              onRefresh={loadPrinters}
              onChange={(name) => patchLabel({ printer_name: name })}
            />
          </div>
          <div>
            <label className="label">Largeur (mm)</label>
            <input
              className="input"
              type="number"
              min={20}
              max={120}
              value={form.label.width_mm}
              onChange={(e) =>
                patchLabel({ width_mm: Number(e.target.value) || 60 })
              }
            />
          </div>
          <div>
            <label className="label">Hauteur (mm)</label>
            <input
              className="input"
              type="number"
              min={15}
              max={120}
              value={form.label.height_mm}
              onChange={(e) =>
                patchLabel({ height_mm: Number(e.target.value) || 40 })
              }
            />
          </div>
          <div>
            <label className="label">Taille de police (px)</label>
            <input
              className="input"
              type="number"
              min={8}
              max={20}
              value={form.label.font_size}
              onChange={(e) =>
                patchLabel({ font_size: Number(e.target.value) || 12 })
              }
            />
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {LABEL_SWITCHES.map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={Boolean(form.label[item.key])}
                onChange={(e) => patchLabel({ [item.key]: e.target.checked })}
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer la configuration"}
          </button>
          <button className="btn-ghost" onClick={() => testLabels(1)}>
            <Printer size={16} /> Une étiquette test
          </button>
          <button className="btn-ghost" onClick={() => testLabels(6)}>
            <Printer size={16} /> Six étiquettes test
          </button>
        </div>
      </div>

      {/* Commercial documents (order and delivery notes) */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <FileText size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Documents commerciaux
          </h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Bons de commande et bons de livraison : format du papier,
          numérotation et informations imprimées.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <PrinterSelect
              label="Imprimante des documents commerciaux"
              value={form.documents.printer_name}
              devices={devices}
              loading={loadingPrinters}
              onRefresh={loadPrinters}
              onChange={(name) => patchDocuments({ printer_name: name })}
              hint="Imprimante A4 pour les bons de commande et de livraison."
            />
          </div>
          <div>
            <PrinterSelect
              label="Imprimante des bons de livraison"
              value={form.documents.delivery_printer_name}
              devices={devices}
              loading={loadingPrinters}
              onRefresh={loadPrinters}
              onChange={(name) =>
                patchDocuments({ delivery_printer_name: name })
              }
              hint="Vide : utilise l'imprimante des documents commerciaux."
            />
          </div>
          <div>
            <PrinterSelect
              label="Imprimante des devis"
              value={form.documents.quote_printer_name}
              devices={devices}
              loading={loadingPrinters}
              onRefresh={loadPrinters}
              onChange={(name) =>
                patchDocuments({ quote_printer_name: name })
              }
              hint="Vide : utilise l'imprimante des documents commerciaux."
            />
          </div>
          <div>
            <PrinterSelect
              label="Imprimante des rapports"
              value={form.documents.reports_printer_name}
              devices={devices}
              loading={loadingPrinters}
              onRefresh={loadPrinters}
              onChange={(name) =>
                patchDocuments({ reports_printer_name: name })
              }
              hint="Vide : utilise l'imprimante des documents commerciaux."
            />
          </div>
          <div>
            <PrinterSelect
              label="Imprimante des reçus de règlement"
              value={form.documents.settlement_printer_name}
              devices={devices}
              loading={loadingPrinters}
              onRefresh={loadPrinters}
              onChange={(name) =>
                patchDocuments({ settlement_printer_name: name })
              }
              hint="Vide : utilise l'imprimante des documents commerciaux."
            />
          </div>
          <div>
            <label className="label">Mode d'impression</label>
            <select
              className="input"
              value={form.documents.direct_print ? "direct" : "apercu"}
              onChange={(e) =>
                patchDocuments({
                  direct_print: e.target.value === "direct",
                })
              }
            >
              <option value="direct">
                Directe (sans boîte de dialogue)
              </option>
              <option value="apercu">Avec aperçu avant impression</option>
            </select>
          </div>
          <div>
            <label className="label">Format du papier</label>
            <select
              className="input"
              value={form.documents.format}
              onChange={(e) =>
                patchDocuments({
                  format: e.target.value === "A5" ? "A5" : "A4",
                })
              }
            >
              <option value="A4">A4 portrait</option>
              <option value="A5">A5 portrait</option>
            </select>
          </div>
          <div>
            <label className="label">Préfixe des bons de commande</label>
            <input
              className="input"
              value={form.documents.order_prefix}
              onChange={(e) =>
                patchDocuments({
                  order_prefix: e.target.value.toUpperCase(),
                })
              }
              placeholder="BC"
            />
          </div>
          <div>
            <label className="label">Préfixe des bons de livraison</label>
            <input
              className="input"
              value={form.documents.delivery_prefix}
              onChange={(e) =>
                patchDocuments({
                  delivery_prefix: e.target.value.toUpperCase(),
                })
              }
              placeholder="BL"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Numérotation automatique : {form.documents.order_prefix || "BC"}
          -{new Date().getFullYear()}-000001 et{" "}
          {form.documents.delivery_prefix || "BL"}-{new Date().getFullYear()}
          -000001.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {DOCUMENT_SWITCHES.map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={Boolean(form.documents[item.key])}
                onChange={(e) =>
                  patchDocuments({ [item.key]: e.target.checked })
                }
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer la configuration"}
          </button>
        </div>
      </div>

      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title="Aperçu du reçu"
        footer={
          <div className="no-print flex w-full justify-end gap-3">
            <button className="btn-ghost" onClick={() => setPreview(false)}>
              Fermer
            </button>
            <button
              className="btn-primary"
              onClick={() => printReceipt(form.receipt.width, form.receipt)}
            >
              <Printer size={16} /> Imprimer
            </button>
          </div>
        }
      >
        <Receipt
          sale={sampleSale()}
          company={branding}
          format={form.receipt.width}
          config={form.receipt}
        />
      </Modal>
    </div>
  );
}
