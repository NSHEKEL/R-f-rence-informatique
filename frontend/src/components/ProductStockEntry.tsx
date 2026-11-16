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
  const [quantity, setQuantity] = useState<number | "">(1);
  const [unit, setUnit] = useState("base");
  const [depot, setDepot] = useState("");
  const [reason, setReason] = useState("Arrivage");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeDepots = depots.filter((item) => item.active);
  const packaging = product.packagings?.find((item) => String(item.id) === unit && item.active);
  const factor = unit === "base" ? 1 : unit === "primary" ? product.units_per_packaging || 1 : packaging?.factor || 1;

  async function saveEntry() {
    if (!Number.isInteger(quantity) || Number(quantity) <= 0 || Number(quantity) * factor > 2147483647) {
      setError("Quantité entière strictement positive requise (maximum 2147483647 unités de base)."); return;
    }
    setBusy(true); setError("");
    try {
      const { data } = await api.post<Product>(`/products/${product.id}/stock-entry`, {
        quantity, unit: unit === "base" ? "base" : "packaging",
        packaging_id: packaging?.id ?? null, depot_id: depot ? Number(depot) : null, reason, note,
      });
      await onSaved(data); onClose();
    } catch (err) {
      setError(axios.isAxiosError(err) ? apiErrorMessage(err.response?.data?.detail, "Entrée de stock impossible.") : "Entrée de stock impossible.");
    } finally { setBusy(false); }
  }

  return <Modal open title="Ajouter du stock" size="compact" onClose={() => { if (!busy) onClose(); }} footer={<>
    <button className="btn-ghost" disabled={busy} onClick={onClose}>Annuler</button>
    <button className="btn-primary" disabled={busy || !!depotError} onClick={saveEntry}>{busy ? "Enregistrement..." : "Confirmer l'entrée"}</button>
  </>}>
    <div className="space-y-3">
      <p className="text-sm font-semibold">{product.name} · Stock actuel : {product.quantity}</p>
      {(error || depotError) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error || depotError}</p>}
      <label className="label">Quantité à ajouter<input className="input" type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))} /></label>
      <label className="label">Unité d'entrée<select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
        <option value="base">{product.base_unit || "Unité de base"}</option>
        {product.packaging_unit && <option value="primary">{product.packaging_unit} (×{product.units_per_packaging})</option>}
        {product.packagings?.filter((item) => item.active && item.id).map((item) => <option key={item.id} value={item.id}>{item.name} (×{item.factor})</option>)}
      </select></label>
      {activeDepots.length > 1 && <label className="label">Dépôt de réception<select className="input" value={depot} onChange={(e) => setDepot(e.target.value)}>
        <option value="">{activeDepots.find((item) => item.is_default)?.name || "Dépôt principal"} (par défaut)</option>
        {activeDepots.filter((item) => !item.is_default).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      <label className="label">Motif<select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>{["Arrivage", "Correction", "Autre"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="label">Note (facultative)<input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p className="text-sm text-slate-600">Entrée : +{Number(quantity) * factor} {product.base_unit || "unités de base"}. Cette entrée s'ajoute au stock, sans remplacer la quantité.</p>
    </div>
  </Modal>;
}
