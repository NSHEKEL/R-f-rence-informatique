import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download, Printer } from "lucide-react";
import type { Product } from "../types";
import { scanCode } from "../lib/scan";

interface ProductQrCodeProps {
  product: Product;
  size?: number;
}

export default function ProductQrCode({
  product,
  size = 180,
}: ProductQrCodeProps) {
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
    const win = window.open("", "_blank", "width=420,height=520");
    if (!win) return;
    win.document.write(
      `<html><head><title>QR ${value}</title></head>` +
        `<body style="font-family:sans-serif;text-align:center;padding:24px">` +
        `<img src="${dataUrl}" style="width:220px;height:220px" />` +
        `<p style="font-weight:700;margin:8px 0 0">${product.name}</p>` +
        `<p style="margin:2px 0 0">${value}</p>` +
        `</body></html>`
    );
    win.document.close();
    win.focus();
    win.print();
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
