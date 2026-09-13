import { useEffect, useState } from "react";
import axios from "axios";
import {
  Check,
  FileText,
  Printer,
  Receipt as ReceiptIcon,
  Tags,
} from "lucide-react";
import api from "../api/client";
import Modal from "../components/Modal";
import Receipt from "../components/Receipt";
import { printLabels, printReceipt } from "../lib/print";
import { priceLabelHtml } from "../lib/labels";
import { useCompany } from "../context/CompanyContext";
import { useLicense } from "../context/LicenseContext";
import type {
  CompanySettings,
  DocumentConfig,
  LabelPrinterConfig,
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
  const [printers, setPrinters] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [drawerTesting, setDrawerTesting] = useState(false);
  const [drawerMessage, setDrawerMessage] = useState("");

  useEffect(() => {
    setForm(printing);
  }, [printing]);

  useEffect(() => {
    api
      .get<{ printers: string[] }>("/settings/printers")
      .then((res) => setPrinters(res.data.printers))
      .catch(() => setPrinters([]));
  }, []);

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
      setForm(res.data);
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
      const { data } = await api.post<{ port: string }>(
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
      {/* Receipt printer */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <ReceiptIcon size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Imprimante de reçus
          </h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Imprimante installée</label>
            <input
              className="input"
              list="easygest-printers"
              value={form.receipt.printer_name}
              onChange={(e) => patchReceipt({ printer_name: e.target.value })}
              placeholder="Ex. EPSON TM-T20"
            />
            <datalist id="easygest-printers">
              {printers.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-slate-400">
              {printers.length > 0
                ? "Choisissez l'imprimante dans la liste proposée."
                : "Saisissez le nom exact de l'imprimante Windows."}
            </p>
          </div>
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
                <label className="label">Port ou imprimante du tiroir</label>
                <input
                  className="input"
                  value={company.drawer_port}
                  onChange={(e) => update({ drawer_port: e.target.value })}
                  placeholder="Ex. COM1, LPT1 ou \\CAISSE\TICKET"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Toutes les imprimantes n'ouvrent pas un tiroir : utilisez le
                  test ci-dessous pour vérifier avant de l'activer en caisse.
                </p>
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
                >
                  {drawerTesting ? "Ouverture..." : "Tester l'ouverture"}
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
          <button className="btn-ghost" onClick={testTicket}>
            <Printer size={16} /> Imprimer un ticket test
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
            <label className="label">Imprimante installée</label>
            <input
              className="input"
              list="easygest-printers"
              value={form.label.printer_name}
              onChange={(e) => patchLabel({ printer_name: e.target.value })}
              placeholder="Ex. Brother QL-800"
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
