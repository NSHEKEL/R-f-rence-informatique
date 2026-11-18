import { useState } from "react";
import { formatXOF } from "../api/client";
import { packagingChoices } from "../lib/posPackaging";
import { catalogPrices, resolveTier, withPackaging, type PriceTier } from "../lib/units";
import type { Product } from "../types";
import Modal from "./Modal";

export interface MixedSelection {
  product: Product;
  packaging_id?: number;
  packs: number;
  pieces: number;
  tier: PriceTier;
  packPrice: number;
  piecePrice: number;
}

export default function PosMixedEditor({ product, tier, packagingId, quantity, discount, error, onClose, onConfirm }: {
  product: Product; tier: PriceTier; packagingId?: number; quantity: number; discount: number;
  error?: string;
  onClose: () => void; onConfirm: (selection: MixedSelection) => void;
}) {
  const choices = packagingChoices(product).filter((choice) => choice.key !== "base");
  const [key, setKey] = useState(() => choices.find((choice) => choice.key === String(packagingId))?.key || choices[0]?.key || "primary");
  const initial = withPackaging(product, key === "primary" ? undefined : Number(key));
  const [packs, setPacks] = useState(() => Math.floor(quantity / (initial.units_per_packaging || 1)));
  const [pieces, setPieces] = useState(() => quantity % (initial.units_per_packaging || 1));
  const packaging_id = key === "primary" ? undefined : Number(key);
  const selected = withPackaging(product, packaging_id);
  const factor = selected.units_per_packaging || 1;
  const total = packs * factor + pieces;
  const resolvedTier = resolveTier(selected, tier, total);
  const prices = catalogPrices(selected, resolvedTier, total);
  const valid = Number.isSafeInteger(packs) && packs >= 0 && Number.isSafeInteger(pieces) && pieces >= 0 && Number.isSafeInteger(total) && total > 0;
  const amount = prices.carton * packs + prices.piece * pieces;

  return <Modal open size="compact" wide title={`Vente mixte — ${product.name}`} onClose={onClose} footer={<>
    <button className="btn-ghost" onClick={onClose}>Annuler</button>
    <button className="btn-primary" disabled={!valid} onClick={() => onConfirm({ product: selected, packaging_id, packs, pieces, tier: resolvedTier, packPrice: prices.carton, piecePrice: prices.piece })}>Valider</button>
  </>}>
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-600">{error}</p>}
      {choices.length > 1 ? <label className="label">Conditionnement<select className="input" value={key} onChange={(event) => setKey(event.target.value)}>{choices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</select></label> : <p className="font-semibold">{selected.packaging_unit}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="label">Nombre de {selected.packaging_unit}<input className="input" type="number" min="0" step="1" value={packs} onChange={(event) => setPacks(Number(event.target.value))} /></label>
        <label className="label">Nombre de {product.base_unit || "pièces"}<input className="input" type="number" min="0" step="1" value={pieces} onChange={(event) => setPieces(Number(event.target.value))} /></label>
      </div>
      <div className="space-y-1 rounded-xl bg-slate-50 p-4" aria-live="polite">
        {valid ? <>
          <p>{packs} {selected.packaging_unit} × {factor} + {pieces} = <strong>{total} {product.base_unit || "pièces"}</strong></p>
          <p>{formatXOF(prices.carton)} × {packs} = {formatXOF(prices.carton * packs)}</p>
          <p>{formatXOF(prices.piece)} × {pieces} = {formatXOF(prices.piece * pieces)}</p>
          {discount > 0 && <p>Remise conservée : {formatXOF(Math.min(discount, amount))}</p>}
          <p className="font-bold">Total : {formatXOF(Math.max(0, amount - discount))}</p>
        </> : <p>Saisissez des quantités entières positives ou nulles, avec au moins une unité.</p>}
      </div>
    </div>
  </Modal>;
}
