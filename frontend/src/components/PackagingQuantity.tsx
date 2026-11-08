import { formatQuantity, splitQuantity, type UnitMode, type QuantitySpec } from "../lib/units";

interface Props {
  product: QuantitySpec;
  value: number;
  onChange: (quantity: number, packs: number, pieces: number) => void;
  parts?: { packaging_quantity: number; piece_quantity: number };
  mode?: UnitMode;
  max?: number;
}

export default function PackagingQuantity({ product, value, onChange, mode = "mixed", max, parts }: Props) {
  const factor = product.units_per_packaging || 1;
  const { packaging_quantity: packs, piece_quantity: pieces } = parts ?? splitQuantity(product, value, mode);
  function change(nextPacks: number, nextPieces: number) {
    const quantity = nextPacks * factor + nextPieces;
    if (Number.isSafeInteger(nextPacks) && Number.isSafeInteger(nextPieces) && nextPacks >= 0 && nextPieces >= 0 && Number.isSafeInteger(quantity) && (max === undefined || quantity <= max)) onChange(quantity, nextPacks, nextPieces);
  }
  return <div className="space-y-1">
    <div className="flex gap-2">
      {product.packaging_unit && mode !== "base" && <label className="min-w-0 flex-1 text-xs">{product.packaging_unit}<input aria-label={`Quantité en ${product.packaging_unit}`} className="input" type="number" min="0" step="1" value={packs} onChange={(e) => change(Number(e.target.value), pieces)} /></label>}
      {mode !== "packaging" && <label className="min-w-0 flex-1 text-xs">{product.base_unit || "pièce"}<input aria-label={`Quantité en ${product.base_unit || "pièce"}`} className="input" type="number" min="0" step="1" value={pieces} onChange={(e) => change(packs, Number(e.target.value))} /></label>}
    </div>
    <p className="text-xs text-slate-500">{formatQuantity(product, value)}</p>
  </div>;
}
