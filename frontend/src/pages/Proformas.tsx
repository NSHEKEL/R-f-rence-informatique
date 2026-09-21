import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ArrowRightLeft,
  Copy,
  FileText,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import api, { formatDate, formatDateTime, formatXOF } from "../api/client";
import type { Customer, Proforma, Product } from "../types";
import Modal from "../components/Modal";
import ProductSearch from "../components/ProductSearch";
import { documentHeader, printSheet } from "../lib/print";
import { vatBreakdown } from "../lib/vat";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

interface DraftLine {
  product_id: number | null;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

const STATUSES = ["Brouillon", "Envoyé", "Accepté", "Refusé", "Expiré"];

const statusStyles: Record<string, string> = {
  Brouillon: "bg-slate-100 text-slate-600",
  Envoyé: "bg-blue-50 text-blue-700",
  Accepté: "bg-emerald-50 text-emerald-700",
  Refusé: "bg-red-50 text-red-600",
  Expiré: "bg-amber-50 text-amber-700",
};

export default function Proformas() {
  const version = useSyncVersion();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { company } = useCompany();
  const [documents, setDocuments] = useState<Proforma[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState("");

  const [tab, setTab] = useState("devis");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Proforma | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [status, setStatus] = useState("Brouillon");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const label = tab === "devis" ? "devis" : "proforma";

  const load = useCallback(async () => {
    try {
      const [p, pr, c] = await Promise.all([
        api.get<Proforma[]>("/proformas"),
        api.get<Product[]>("/products"),
        api.get<Customer[]>("/customers"),
      ]);
      setDocuments(p.data);
      setProducts(pr.data);
      setCustomers(c.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur de chargement");
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + Math.max(l.unit_price * l.quantity - l.discount, 0),
        0
      ),
    [lines]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return documents.filter((d) => {
      if ((d.kind || "proforma") !== tab) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        d.reference.toLowerCase().includes(needle) ||
        (d.customer?.name || d.customer_name || "")
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [documents, tab, statusFilter, search]);

  function reset() {
    setEditing(null);
    setLines([]);
    setNote("");
    setCustomerName("");
    setCustomerId("");
    setValidUntil("");
    setStatus("Brouillon");
  }

  function addProduct(product: Product) {
    setLines((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        unit: "u",
        quantity: 1,
        unit_price: product.sale_price,
        discount: 0,
      },
    ]);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l))
    );
  }

  function edit(document: Proforma) {
    setEditing(document);
    setCustomerId(document.customer_id ? String(document.customer_id) : "");
    setCustomerName(document.customer_name);
    setValidUntil(
      document.valid_until ? document.valid_until.slice(0, 10) : ""
    );
    setStatus(document.status || "Brouillon");
    setNote(document.note ?? "");
    setLines(
      document.items.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        unit: it.unit || "u",
        quantity: it.quantity,
        unit_price: it.unit_price,
        discount: it.discount || 0,
      }))
    );
    setOpen(true);
  }

  async function save() {
    if (lines.length === 0) {
      setError("Ajoutez au moins une ligne");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        customer_id: customerId ? Number(customerId) : null,
        customer_name: customerName,
        valid_until: validUntil ? new Date(validUntil).toISOString() : null,
        note,
        status,
        kind: tab,
        items: lines,
      };
      if (editing) {
        await api.put(`/proformas/${editing.id}`, body);
      } else {
        await api.post("/proformas", body);
      }
      setOpen(false);
      reset();
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'enregistrement");
      }
    } finally {
      setSaving(false);
    }
  }

  async function call(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Opération impossible");
      }
    }
  }

  async function transform(document: Proforma, target: string) {
    const question =
      target === "proforma"
        ? `Transformer le devis ${document.reference} en proforma ?`
        : `Transformer ${document.reference} en commande ? Le stock n'est pas ` +
          `décrémenté, aucun paiement n'est enregistré.`;
    if (!window.confirm(question)) return;
    await call(async () => {
      await api.post(`/proformas/${document.id}/transformer`, {
        target,
        deposit: 0,
      });
    });
    if (target === "commande") navigate("/commandes");
  }

  async function remove(document: Proforma) {
    if (!window.confirm(`Supprimer ${document.reference} ?`)) return;
    await call(() => api.delete(`/proformas/${document.id}`));
  }

  function print(document: Proforma) {
    const kind = (document.kind || "proforma") === "devis";
    const title = kind ? "Devis" : "Facture proforma";
    const client =
      document.customer?.name || document.customer_name || "Client de passage";
    const rows = document.items
      .map(
        (it) =>
          `<tr><td>${it.product_name}</td>` +
          `<td class="num">${it.quantity}</td>` +
          `<td class="num">${formatXOF(it.unit_price)}</td>` +
          `<td class="num">${formatXOF(it.subtotal)}</td></tr>`
      )
      .join("");
    const vat = vatBreakdown(document.total, company);
    const vatRows = vat
      ? `<tr><th colspan="3">Total HT</th>` +
        `<th class="num">${formatXOF(vat.excluded)}</th></tr>` +
        `<tr><th colspan="3">TVA (${vat.rate} %)</th>` +
        `<th class="num">${formatXOF(vat.vat)}</th></tr>`
      : "";
    printSheet(
      `${title} ${document.reference}`,
      documentHeader(company) +
        `<h2>${title} ${document.reference}</h2>` +
        `<p class="meta">Date : ${formatDateTime(document.date)}` +
        (document.valid_until
          ? ` · Valable jusqu'au ${formatDate(document.valid_until)}`
          : "") +
        `<br/>Client : ${client}</p>` +
        `<table><thead><tr><th>Désignation</th><th class="num">Qté</th>` +
        `<th class="num">P.U.</th><th class="num">Total</th></tr></thead>` +
        `<tbody>${rows}${vatRows}` +
        `<tr><th colspan="3">${vat ? "Total TTC" : "Total"}</th>` +
        `<th class="num">${formatXOF(document.total)}</th></tr></tbody></table>` +
        `<p class="meta">Document non contractuel : ce ${
          kind ? "devis" : "document"
        } ne vaut pas facture et n'engage aucun mouvement de stock.</p>`
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {[
            { id: "devis", name: "Devis" },
            { id: "proforma", name: "Factures proforma" },
          ].map((t) => (
            <button
              key={t.id}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${
                tab === t.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            reset();
            setOpen(true);
          }}
          title={`Créer un nouveau ${label}`}
        >
          <Plus size={16} /> Nouveau {label}
        </button>
      </div>

      <p className="text-sm text-slate-500">
        Proposition remise au client : aucun stock n'est décrémenté et aucun
        paiement n'est enregistré tant que le document n'est pas transformé en
        commande.
      </p>

      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Rechercher une référence ou un client"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          title="Rechercher"
        />
        <select
          className="input max-w-[180px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          title="Filtrer par statut"
        >
          <option value="">Tous les statuts</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3">Référence</th>
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3 text-right">Total</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3.5 font-semibold text-slate-800">
                  <span className="flex items-center gap-2">
                    <FileText size={15} className="text-brand-600" />
                    {p.reference}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-slate-500">
                  {formatDateTime(p.date)}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {p.customer?.name || p.customer_name || "—"}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      statusStyles[p.status] ?? "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {p.status || "Brouillon"}
                  </span>
                  {p.order_id && (
                    <span className="ml-2 text-xs text-emerald-600">
                      → commande
                    </span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right font-semibold text-slate-900">
                  {formatXOF(p.total)}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1">
                    {!p.order_id && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        onClick={() => edit(p)}
                        title="Modifier"
                        aria-label="Modifier le document"
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      onClick={() => print(p)}
                      title="Imprimer"
                      aria-label="Imprimer le document"
                    >
                      <Printer size={16} />
                    </button>
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() =>
                        call(() => api.post(`/proformas/${p.id}/dupliquer`, {}))
                      }
                      title="Dupliquer"
                      aria-label="Dupliquer le document"
                    >
                      <Copy size={16} />
                    </button>
                    {can("documents_transformer") && !p.order_id && (
                      <>
                        {(p.kind || "proforma") === "devis" && (
                          <button
                            className="rounded-lg p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                            onClick={() => transform(p, "proforma")}
                            title="Transformer en proforma"
                            aria-label="Transformer en proforma"
                          >
                            <FileText size={16} />
                          </button>
                        )}
                        <button
                          className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                          onClick={() => transform(p, "commande")}
                          title="Transformer en commande"
                          aria-label="Transformer en commande"
                        >
                          <ArrowRightLeft size={16} />
                        </button>
                      </>
                    )}
                    {!p.order_id && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove(p)}
                        title="Supprimer"
                        aria-label="Supprimer le document"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                  Aucun {label} pour l'instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={
          editing
            ? `Modifier ${editing.reference}`
            : tab === "devis"
              ? "Nouveau devis"
              : "Nouvelle facture proforma"
        }
        fullscreen
        footer={
          <>
            <button
              className="btn-ghost"
              onClick={() => setOpen(false)}
              title="Fermer sans enregistrer"
            >
              Annuler
            </button>
            <button
              className="btn-primary"
              onClick={save}
              disabled={saving}
              title="Enregistrer le document"
            >
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="label">Client enregistré</label>
              <select
                className="input"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">— Aucun —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Ou nom libre</label>
              <input
                className="input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Société ABC"
              />
            </div>
            <div>
              <label className="label">Valable jusqu'au</label>
              <input
                type="date"
                className="input"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Statut</label>
              <select
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Rechercher un article</label>
            <ProductSearch products={products} onPick={addProduct} />
          </div>

          <div className="space-y-2">
            {lines.map((l, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label className="label">Désignation</label>
                  <input
                    className="input"
                    value={l.product_name}
                    onChange={(e) =>
                      updateLine(index, { product_name: e.target.value })
                    }
                  />
                </div>
                <div className="w-20">
                  <label className="label">Qté</label>
                  <input
                    type="number"
                    className="input"
                    value={l.quantity}
                    onChange={(e) =>
                      updateLine(index, { quantity: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="w-32">
                  <label className="label">P.U.</label>
                  <input
                    type="number"
                    className="input"
                    value={l.unit_price}
                    onChange={(e) =>
                      updateLine(index, { unit_price: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="w-28">
                  <label className="label">Remise</label>
                  <input
                    type="number"
                    className="input"
                    value={l.discount}
                    onChange={(e) =>
                      updateLine(index, { discount: Number(e.target.value) })
                    }
                  />
                </div>
                <button
                  className="mb-1 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() =>
                    setLines((prev) => prev.filter((_, i) => i !== index))
                  }
                  title="Supprimer la ligne"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              className="btn-ghost"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  {
                    product_id: null,
                    product_name: "",
                    unit: "u",
                    quantity: 1,
                    unit_price: 0,
                    discount: 0,
                  },
                ])
              }
              title="Ajouter une ligne libre"
            >
              <Plus size={16} /> Ajouter une ligne
            </button>
          </div>

          <input
            className="input"
            placeholder="Note (conditions, délai de livraison...)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
            <span className="text-sm font-medium uppercase">Total</span>
            <span className="text-2xl font-extrabold">{formatXOF(total)}</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
