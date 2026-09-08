import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Search, Undo2 } from "lucide-react";
import api, { formatDate, formatXOF } from "../api/client";
import type { Sale, SaleReturn } from "../types";
import { useSyncVersion } from "../context/SyncContext";

export default function Returns() {
  const version = useSyncVersion();
  const [reference, setReference] = useState("");
  const [sale, setSale] = useState<Sale | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [credits, setCredits] = useState<SaleReturn[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const loadCredits = useCallback(async () => {
    const res = await api.get<SaleReturn[]>("/returns");
    setCredits(res.data);
  }, []);

  useEffect(() => {
    loadCredits().catch(() => setCredits([]));
  }, [loadCredits, version]);

  async function findSale() {
    setError("");
    setSuccess("");
    setSale(null);
    const ref = reference.trim();
    if (!ref) return;
    try {
      const res = await api.get<Sale>(
        `/sales/by-reference/${encodeURIComponent(ref)}`
      );
      setSale(res.data);
      setQuantities({});
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Ticket introuvable");
      }
    }
  }

  const total = sale
    ? sale.items.reduce(
        (sum, it) => sum + (quantities[it.id] ?? 0) * it.unit_price,
        0
      )
    : 0;

  async function submit() {
    if (!sale) return;
    const lines = sale.items
      .filter((it) => (quantities[it.id] ?? 0) > 0 && it.product_id !== null)
      .map((it) => ({
        product_id: it.product_id as number,
        quantity: quantities[it.id],
      }));
    if (lines.length === 0) {
      setError("Sélectionnez au moins un article à retourner");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.post<SaleReturn>("/returns", {
        sale_reference: sale.reference,
        reason,
        lines,
      });
      setSuccess(
        `Avoir ${res.data.reference} créé : ${formatXOF(res.data.total)}`
      );
      setSale(null);
      setQuantities({});
      setReason("");
      setReference("");
      await loadCredits();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible d'enregistrer le retour");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Retours & avoirs</h1>
        <p className="text-sm text-slate-500">
          Saisissez le numéro du ticket pour reprendre des articles et générer
          un avoir. Le stock est réintégré automatiquement.
        </p>
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              size={18}
              className="pointer-events-none absolute left-3.5 top-3 text-slate-400"
            />
            <input
              className="input pl-11"
              placeholder="Numéro du ticket (ex. VNT-2026-0042)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && findSale()}
            />
          </div>
          <button className="btn-primary" onClick={findSale}>
            Rechercher le ticket
          </button>
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {success}
          </p>
        )}

        {sale && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-slate-400">Ticket</p>
                <p className="font-semibold text-slate-800">{sale.reference}</p>
              </div>
              <div>
                <p className="text-slate-400">Date</p>
                <p className="font-semibold text-slate-800">
                  {formatDate(sale.date)}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Client</p>
                <p className="font-semibold text-slate-800">
                  {sale.customer?.name ?? "Client de passage"}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Total du ticket</p>
                <p className="font-semibold text-slate-800">
                  {formatXOF(sale.total)}
                </p>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
                  <th className="py-2">Article</th>
                  <th className="py-2 text-center">Acheté</th>
                  <th className="py-2 text-center">Déjà retourné</th>
                  <th className="py-2 text-right">P.U.</th>
                  <th className="py-2 text-center">À retourner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sale.items.map((it) => {
                  const max = it.quantity - it.returned_quantity;
                  return (
                    <tr key={it.id}>
                      <td className="py-2.5 text-slate-800">
                        {it.product_name}
                      </td>
                      <td className="py-2.5 text-center text-slate-600">
                        {it.quantity}
                      </td>
                      <td className="py-2.5 text-center text-slate-600">
                        {it.returned_quantity}
                      </td>
                      <td className="py-2.5 text-right text-slate-600">
                        {formatXOF(it.unit_price)}
                      </td>
                      <td className="py-2.5 text-center">
                        <input
                          type="number"
                          min={0}
                          max={max}
                          disabled={max === 0}
                          className="input w-20 text-center"
                          value={quantities[it.id] ?? 0}
                          onChange={(e) =>
                            setQuantities({
                              ...quantities,
                              [it.id]: Math.min(
                                Math.max(Number(e.target.value) || 0, 0),
                                max
                              ),
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div>
              <label className="label">Motif du retour</label>
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex. article défectueux"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div>
                <p className="text-xs text-slate-400">Montant de l'avoir</p>
                <p className="text-xl font-extrabold text-slate-900">
                  {formatXOF(total)}
                </p>
              </div>
              <button
                className="btn-primary"
                onClick={submit}
                disabled={saving || total === 0}
              >
                <Undo2 size={16} />
                {saving ? "Enregistrement..." : "Générer l'avoir"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Avoir</th>
                <th className="px-5 py-3">Ticket</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Articles</th>
                <th className="px-5 py-3">Motif</th>
                <th className="px-5 py-3">Par</th>
                <th className="px-5 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credits.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5 font-semibold text-slate-800">
                    {c.reference}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {c.sale_reference}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {formatDate(c.date)}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {c.items
                      .map((i) => `${i.product_name} ×${i.quantity}`)
                      .join(", ")}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{c.reason || "—"}</td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {c.created_by?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold text-amber-600">
                    {formatXOF(c.total)}
                  </td>
                </tr>
              ))}
              {credits.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    Aucun avoir enregistré.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
