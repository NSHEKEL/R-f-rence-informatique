import { useState } from "react";
import type { Product } from "../types";
import { formatXOF } from "../api/client";
import { formatQuantity } from "../lib/units";
import { tileVisibility, type PosDisplay } from "../lib/posDisplay";

const PAGE_SIZE = 60;

export default function PosProductGrid({ products, config, stockRight, selected, onAdd, price }: {
  products: Product[]; config: PosDisplay; stockRight: boolean;
  selected: ReadonlySet<number>; onAdd: (product: Product) => void; price: (product: Product) => number;
}) {
  const [requestedPage, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pages - 1);
  const visible = tileVisibility(config, stockRight);
  const lineHeight = config.font_size * 1.25;
  const textSpace = config.height - 18 - (visible.price ? 20 : 0) - (visible.stock ? 16 : 0);
  const imageHeight = visible.image ? Math.max(0, Math.min(48, textSpace - lineHeight)) : 0;
  const nameLines = Math.max(1, Math.min(3, Math.floor((textSpace - imageHeight) / lineHeight)));
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="grid min-h-0 flex-1 content-start overflow-auto p-1" style={{ gridTemplateColumns: config.columns ? `repeat(${config.columns}, minmax(0, 1fr))` : `repeat(auto-fill, minmax(min(100%, ${config.width}px), 1fr))`, columnGap: config.gap_x, rowGap: config.gap_y }}>
      {products.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((p) => <button key={p.id} type="button" title={p.name} aria-pressed={selected.has(p.id)} onClick={() => onAdd(p)}
        className={`flex min-w-0 flex-col justify-center overflow-hidden border px-3 py-2 shadow-sm transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand-400 ${selected.has(p.id) ? "ring-2 ring-brand-400" : ""}`}
        style={{ height: config.height, fontSize: config.font_size, fontFamily: config.font_family, textAlign: config.align, backgroundColor: config.background, color: config.text, borderColor: config.border, borderRadius: config.radius }}>
        {visible.image && (p.image ? <img src={p.image} alt="" loading="lazy" style={{ height: imageHeight }} className="mx-auto max-w-full shrink-0 object-contain" /> : <span style={{ height: imageHeight }} className="mx-auto flex shrink-0 items-center text-xs opacity-50">Sans image</span>)}
        <span className="flex min-h-0 w-full flex-1 flex-col justify-center overflow-hidden"><span className="line-clamp-3 break-words font-semibold" style={{ lineHeight: 1.25, WebkitLineClamp: nameLines }}>{p.name}</span></span>
        {visible.price && <span className="w-full shrink-0 truncate text-sm">{formatXOF(price(p))}</span>}
        {visible.stock && typeof p.quantity === "number" && <span className="w-full shrink-0 truncate text-xs">Stock : {formatQuantity(p, p.quantity)}</span>}
      </button>)}
      {!products.length && <p className="col-span-full py-8 text-center text-slate-400">Aucun article disponible.</p>}
    </div>
    <nav aria-label="Pages des produits" className="flex shrink-0 items-center justify-between gap-2 text-sm">
      <button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Précédent</button>
      <span>{products.length} articles · {page + 1} / {pages}</span>
      <button className="btn-ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Suivant</button>
    </nav>
  </div>;
}
