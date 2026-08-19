import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download, Printer } from "lucide-react";
import type { Product } from "../types";
import { scanCode } from "../lib/scan";
import { documentHeader, printDocument } from "../lib/print";
import { useCompany } from "../context/CompanyContext";

interface ProductQrCodeProps {
  product: Product;
  size?: number;
}

export default function ProductQrCode({
  product,
  size = 180,
}: ProductQrCodeProps) {
  const { company } = useCompany();
  const [dataUrl, setDataUrl] = useState("");
  const value = scanCode(product);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => setDataUrl(""));
    return () => {
      active = false;
    };
  }, [value, size]);

  function download() {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `QR-${value}.png`;
    link.click();
  }

  function print() {
    printDocument(
      `QR ${value}`,
      "@page { size: A4 portrait; margin: 0; }" +
        "body { font-family: sans-serif; text-align: center; margin: 0;" +
        " padding: 12mm; }" +
        ".qr { width: 220px; height: 220px; }" +
        ".name { font-weight: 700; margin: 8px 0 0; }" +
        ".code { margin: 2px 0 0; }" +
        ".doc-head { display: flex; align-items: center; gap: 12px;" +
        " text-align: left; border-bottom: 2px solid #0f172a;" +
        " padding-bottom: 8px; margin-bottom: 16px; }" +
        ".doc-head img { width: 56px; height: 56px; object-fit: contain; }" +
        ".doc-head h1 { font-size: 16px; margin: 0; }" +
        ".doc-head .meta { margin: 0; font-size: 12px; color: #475569; }",
      documentHeader(company) +
        `<img class="qr" src="${dataUrl}" alt="" />` +
        `<p class="name">${product.name}</p>` +
        `<p class="code">${value}</p>`
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR ${value}`}
          className="rounded-xl border border-slate-200 p-2"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-xl bg-slate-50 text-xs text-slate-400"
          style={{ width: size, height: size }}
        >
          Génération...
        </div>
      )}
      <p className="text-center text-sm font-semibold text-slate-700">
        {product.name}
        <span className="block text-xs font-normal text-slate-400">{value}</span>
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
