import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FileText, Plus, Printer, Trash2, X } from "lucide-react";
import api, { formatDate, formatDateTime, formatXOF } from "../api/client";
import type { Customer, Proforma, Product } from "../types";
import Modal from "../components/Modal";
import { documentHeader, printSheet } from "../lib/print";
import { vatBreakdown } from "../lib/vat";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

interface DraftLine {
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
}

export default function Proformas() {
  const version = useSyncVersion();
  const { company } = useCompany();
  const [proformas, setProformas] = useState<Proforma[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState("");

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, pr, c] = await Promise.all([
        api.get<Proforma[]>("/proformas"),
        api.get<Product[]>("/products"),
        api.get<Customer[]>("/customers"),
      ]);
      setProformas(p.data);
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
    () => lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0),
    [lines]
  );

  function addLine() {
    setLines((prev) => [
      ...prev,
      { product_id: null, product_name: "", quantity: 1, unit_price: 0 },
    ]);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l))
    );
  }

  function pickProduct(index: number, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    updateLine(index, {
      product_id: product?.id ?? null,
      product_name: product?.name ?? "",
      unit_price: product?.sale_price ?? 0,
    });
  }

  async function save() {
    if (lines.length === 0) {
      setError("Ajoutez au moins une ligne");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post("/proformas", {
        customer_id: customerId ? Number(customerId) : null,
        customer_name: customerName,
        valid_until: validUntil ? new Date(validUntil).toISOString() : null,
        note,
        items: lines,
      });
      setOpen(false);
      setLines([]);
      setNote("");
      setCustomerName("");
      setCustomerId("");
      setValidUntil("");
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'enregistrement");
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(proforma: Proforma) {
    if (!window.confirm(`Supprimer la proforma ${proforma.reference} ?`)) return;
    await api.delete(`/proformas/${proforma.id}`);
    await load();
  }

  function print(proforma: Proforma) {
    const client =
      proforma.customer?.name || proforma.customer_name || "Client de passage";
    const rows = proforma.items
      .map(
        (it) =>
          `<tr><td>${it.product_name}</td>` +
          `<td class="num">${it.quantity}</td>` +
          `<td class="num">${formatXOF(it.unit_price)}</td>` +
          `<td class="num">${formatXOF(it.subtotal)}</td></tr>`
      )
      .join("");
    const vat = vatBreakdown(proforma.total, company);
    const vatRows = vat
      ? `<tr><th colspan="3">Total HT</th>` +
        `<th class="num">${formatXOF(vat.excluded)}</th></tr>` +
        `<tr><th colspan="3">TVA (${vat.rate} %)</th>` +
        `<th class="num">${formatXOF(vat.vat)}</th></tr>`
      : "";
    printSheet(
      `Proforma ${proforma.reference}`,
      documentHeader(company) +
        `<h2>Facture proforma ${proforma.reference}</h2>` +
        `<p class="meta">Date : ${formatDateTime(proforma.date)}` +
        (proforma.valid_until
          ? ` · Valable jusqu'au ${formatDate(proforma.valid_until)}`
          : "") +
        `<br/>Client : ${client}</p>` +
        `<table><thead><tr><th>Désignation</th><th class="num">Qté</th>` +
        `<th class="num">P.U.</th><th class="num">Total</th></tr></thead>` +
        `<tbody>${rows}${vatRows}` +
        `<tr><th colspan="3">${vat ? "Total TTC" : "Total"}</th>` +
        `<th class="num">${formatXOF(proforma.total)}</th></tr></tbody></table>` +
        (proforma.note ? `<p class="meta">${proforma.note}</p>` : "") +
        `<p class="meta">Document non contractuel : cette proforma ne vaut ` +
        `pas facture et n'engage aucun mouvement de stock.</p>`
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Devis remis au client avant l'achat — aucun stock n'est décrémenté.
        </p>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Nouvelle proforma
        </button>
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
              <th className="px-5 py-3 text-right">Total</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {proformas.map((p) => (
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
                <td className="px-5 py-3.5 text-right font-semibold text-slate-900">
                  {formatXOF(p.total)}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1">
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      onClick={() => print(p)}
                      aria-label="Imprimer la proforma"
                    >
                      <Printer size={16} />
                    </button>
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => remove(p)}
                      aria-label="Supprimer la proforma"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {proformas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                  Aucune facture proforma.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nouvelle facture proforma"
        wide
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          </div>

          <div className="space-y-2">
            {lines.map((l, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <label className="label">Article</label>
                  <select
                    className="input"
                    value={l.product_id ?? ""}
                    onChange={(e) => pickProduct(index, e.target.value)}
                  >
                    <option value="">— Libre —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[160px] flex-1">
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
                <button
                  className="mb-1 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() =>
                    setLines((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button className="btn-ghost" onClick={addLine}>
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
