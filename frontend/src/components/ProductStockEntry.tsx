import { useState } from "react";
import axios from "axios";
import api from "../api/client";
import type { Product } from "../types";
import { useDepots } from "../lib/depots";
import { apiErrorMessage } from "../lib/apiErrors";
import Modal from "./Modal";

export default function ProductStockEntry({ product, onClose, onSaved }: {
  product: Product; onClose: () => void; onSaved: (product: Product) => Promise<void>;
}) {
  const { depots, error: depotError } = useDepots();
  const [quantities, setQuantities] = useState<Record<string, number | "">>({});
  const [depot, setDepot] = useState("");
  const [reason, setReason] = useState("Arrivage");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeDepots = depots.filter((item) => item.active);
  const baseLabel = product.base_unit || "pièce";
  const primaryFactor = product.units_per_packaging || 1;
  const units = [
    { key: "base", name: baseLabel, factor: 1, packaging_id: null as number | null },
    ...(product.packaging_unit && primaryFactor > 0 ? [{ key: "primary", name: product.packaging_unit, factor: primaryFactor, packaging_id: null }] : []),
    ...(product.packagings || []).filter((item) => item.active && item.id && item.factor > 0).map((item) => ({ key: String(item.id), name: item.name, factor: item.factor, packaging_id: item.id! })),
  ];
  const total = units.reduce((sum, item) => sum + Number(quantities[item.key] || 0) * item.factor, 0);
  const breakdown = units.filter((item) => Number(quantities[item.key]) > 0).map((item) => `${quantities[item.key]} ${item.name}`).join(" + ");

  async function saveEntry() {
    if (units.some((item) => !Number.isInteger(Number(quantities[item.key] || 0)) || Number(quantities[item.key] || 0) < 0) || !Number.isSafeInteger(total) || total <= 0 || total > 2147483647) {
      setError("Quantités entières positives ou nulles requises, dont au moins une strictement positive (maximum 2147483647 unités de base)."); return;
    }
    setBusy(true); setError("");
    try {
      const { data } = await api.post<Product>(`/products/${product.id}/stock-entry`, {
        lines: units.filter((item) => Number(quantities[item.key]) > 0).map((item) => ({ packaging_id: item.packaging_id, quantity: Number(quantities[item.key]), ...(item.key === "primary" ? { unit: "packaging" } : {}) })),
        depot_id: depot ? Number(depot) : null, reason, note,
      });
      await onSaved(data); onClose();
    } catch (err) {
      setError(axios.isAxiosError(err) ? apiErrorMessage(err.response?.data?.detail, "Entrée de stock impossible.") : "Entrée de stock impossible.");
    } finally { setBusy(false); }
  }

  return <Modal open title="Ajouter du stock" size="compact" closeOnBackdrop={false} closeOnEscape={false} onClose={() => { if (!busy) onClose(); }} footer={<>
    <button className="btn-ghost" disabled={busy} onClick={onClose}>Annuler</button>
    <button className="btn-primary" disabled={busy || !!depotError} onClick={saveEntry}>{busy ? "Enregistrement..." : "Confirmer l'entrée"}</button>
  </>}>
    <div className="space-y-3">
      <p className="text-sm font-semibold">{product.name} · Stock actuel : {product.quantity}</p>
      {(error || depotError) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error || depotError}</p>}
      {units.map((item) => <label key={item.key} className="label">{item.name}{item.key !== "base" && ` (×${item.factor})`}<input className="input" aria-label={item.name} type="number" min={0} max={2147483647} step={1} value={quantities[item.key] ?? ""} onChange={(e) => setQuantities((previous) => ({ ...previous, [item.key]: e.target.value === "" ? "" : Number(e.target.value) }))} /></label>)}
      {activeDepots.length > 1 && <label className="label">Dépôt de réception<select className="input" value={depot} onChange={(e) => setDepot(e.target.value)}>
        <option value="">{activeDepots.find((item) => item.is_default)?.name || "Dépôt principal"} (par défaut)</option>
        {activeDepots.filter((item) => !item.is_default).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      <label className="label">Motif<select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>{["Arrivage", "Correction", "Autre"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="label">Note (facultative)<input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p aria-live="polite" className="text-sm text-slate-600">{breakdown || "0"} = {total} {baseLabel}. Cette entrée s'ajoute au stock, sans remplacer la quantité.</p>
    </div>
  </Modal>;
}
