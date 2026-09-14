import { useMemo } from "react";
import { Download, Printer } from "lucide-react";
import type { Product } from "../types";
import { scanCode } from "../lib/scan";
import { barcodeDataUrl } from "../lib/barcode";
import { documentHeader, printDocument } from "../lib/print";
import { useCompany } from "../context/CompanyContext";

interface ProductQrCodeProps {
  product: Product;
  size?: number;
}

/** Sticker of the article: scannable bars with the code printed underneath. */
export default function ProductQrCode({
  product,
  size = 240,
}: ProductQrCodeProps) {
  const { company } = useCompany();
  const value = scanCode(product);
  const dataUrl = useMemo(() => barcodeDataUrl(value, 70), [value]);

  function download() {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `Code-${value}.png`;
    link.click();
  }

  function print() {
    printDocument(
      `Code ${value}`,
      "@page { size: A4 portrait; margin: 0; }" +
        "body { font-family: sans-serif; text-align: center; margin: 0;" +
        " padding: 12mm; }" +
        ".code-img { width: 260px; }" +
        ".name { font-weight: 700; margin: 8px 0 0; }" +
        ".doc-head { display: flex; align-items: center; gap: 12px;" +
        " text-align: left; border-bottom: 2px solid #0f172a;" +
        " padding-bottom: 8px; margin-bottom: 16px; }" +
        ".doc-head img { width: 56px; height: 56px; object-fit: contain; }" +
        ".doc-head h1 { font-size: 16px; margin: 0; }" +
        ".doc-head .meta { margin: 0; font-size: 12px; color: #475569; }",
      documentHeader(company) +
        `<img class="code-img" src="${dataUrl}" alt="" />` +
        `<p class="name">${product.name}</p>`
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={value}
          className="rounded-xl border border-slate-200 bg-white p-2"
          style={{ width: size }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-xl bg-slate-50 text-xs text-slate-400"
          style={{ width: size, height: 90 }}
        >
          Aucun code
        </div>
      )}
      <p className="text-center text-sm font-semibold text-slate-700">
        {product.name}
      </p>
      <div className="flex gap-2">
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={download}>
          <Download size={14} /> Télécharger
        </button>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={print}>
          <Printer size={14} /> Imprimer
        </button>
      </div>
    </div>
  );
}
