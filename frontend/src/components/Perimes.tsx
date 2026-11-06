import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { FileSpreadsheet, Printer, Trash2 } from "lucide-react";
import api, { formatXOF } from "../api/client";
import type { Category, Supplier } from "../types";
import Modal from "./Modal";
import { exportCsv, stampedName } from "../lib/exportCsv";
import { useAuth } from "../context/AuthContext";

interface ExpiredRow {
  lot_id: number;
  product_id: number;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  supplier: string;
  lot_number: string;
  expiry_date: string;
  expired_since: number;
  quantity: number;
  unit_cost: number;
  loss_value: number;
}

export default function Perimes({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const [rows, setRows] = useState<ExpiredRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [writeOff, setWriteOff] = useState<ExpiredRow | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [thresholds, setThresholds] = useState({ critical: 7, alert: 30, watch: 60 });

  const load = useCallback(async () => {
    const res = await api.get<ExpiredRow[]>("/products/stock/perimes", {
      params: {
        category_id: categoryId || 0,
        supplier_id: supplierId || 0,
        search,
        date_from: dateFrom,
        date_to: dateTo,
      },
    });
    setRows(res.data);
  }, [categoryId, supplierId, search, dateFrom, dateTo]);

  useEffect(() => {
    load().catch(() => setError("Chargement impossible"));
    api.get<Category[]>("/categories").then((r) => setCategories(r.data)).catch(() => undefined);
    api.get<Supplier[]>("/suppliers").then((r) => setSuppliers(r.data)).catch(() => undefined);
    api
      .get<{ expiry_critical_days: number; expiry_alert_days: number; expiry_watch_days: number }>(
        "/settings/company"
      )
      .then((r) =>
        setThresholds({
          critical: r.data.expiry_critical_days,
          alert: r.data.expiry_alert_days,
          watch: r.data.expiry_watch_days,
        })
      )
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function saveThresholds() {
    try {
      await api.put("/settings/company", {
        expiry_critical_days: thresholds.critical,
        expiry_alert_days: thresholds.alert,
        expiry_watch_days: thresholds.watch,
      });
    } catch {
      setError("Seuils non enregistrés");
    }
  }

  async function confirmWriteOff() {
    if (!writeOff || !reason.trim()) {
      setError("Le motif est obligatoire");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/products/lots/${writeOff.lot_id}/sortie`, { reason });
      setWriteOff(null);
      setReason("");
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Sortie impossible");
      }
    } finally {
      setSaving(false);
    }
  }

  function exportExcel() {
    exportCsv(
      stampedName("perimes"),
      ["Article", "Référence", "Code-barres", "Catégorie", "Lot", "Péremption", "Quantité", "Coût unitaire", "Perte"],
      rows.map((r) => [
        r.name, r.sku, r.barcode, r.category, r.lot_number, r.expiry_date,
        r.quantity, r.unit_cost, r.loss_value,
      ])
    );
  }

  const total = rows.reduce((sum, r) => sum + r.loss_value, 0);

  return (
    <Modal open title="Articles périmés" onClose={onClose} wide>
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <input
            className="input sm:w-56"
            placeholder="Article, référence, lot..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input sm:w-44" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Toutes catégories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="input sm:w-44" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Tous fournisseurs</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button className="btn-ghost" onClick={exportExcel}>
            <FileSpreadsheet size={16} /> Excel
          </button>
          <button className="btn-ghost" onClick={() => window.print()}>
            <Printer size={16} /> Imprimer
          </button>
        </div>

        <div className="flex items-end gap-3 rounded-xl bg-slate-50 p-3 text-sm">
          <span className="font-semibold text-slate-600">Seuils d'alerte :</span>
          {(["critical", "alert", "watch"] as const).map((key) => (
            <label key={key} className="flex items-center gap-1 text-xs text-slate-500">
              {key === "critical" ? "Critique" : key === "alert" ? "Alerte" : "Surveillance"}
              <input
                type="number"
                className="input w-16"
                min={1}
                value={thresholds[key]}
                onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })}
              />
              j
            </label>
          ))}
          <button className="btn-ghost px-2 py-1 text-xs" onClick={saveThresholds}>
            Enregistrer
          </button>
        </div>

        <p className="text-sm font-semibold text-red-600">
          Perte totale : {formatXOF(total)} ({rows.length} lot(s))
        </p>

        <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Article</th>
                <th className="px-3 py-2">Lot</th>
                <th className="px-3 py-2">Péremption</th>
                <th className="px-3 py-2 text-right">Qté</th>
                <th className="px-3 py-2 text-right">Coût</th>
                <th className="px-3 py-2 text-right">Perte</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lot_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className="block font-medium">{r.name}</span>
                    <span className="text-xs text-slate-400">
                      {r.sku} · {r.category || "—"} · {r.supplier || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.lot_number || "—"}</td>
                  <td className="px-3 py-2">
                    <span className="block">{r.expiry_date}</span>
                    <span className="text-xs text-red-500">+{r.expired_since} j</span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.quantity}</td>
                  <td className="px-3 py-2 text-right">{formatXOF(r.unit_cost)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-red-600">
                    {formatXOF(r.loss_value)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {can("stocks") && (
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => { setWriteOff(r); setReason(""); setError(""); }}
                      >
                        <Trash2 size={14} /> Sortie
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    Aucun lot périmé en stock.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {writeOff && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold">
              Sortie de {writeOff.quantity} × {writeOff.name}
            </p>
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Motif obligatoire (ex : produits périmés jetés)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button className="btn-primary" onClick={confirmWriteOff} disabled={saving}>
                Valider la sortie
              </button>
              <button className="btn-ghost" onClick={() => setWriteOff(null)}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
