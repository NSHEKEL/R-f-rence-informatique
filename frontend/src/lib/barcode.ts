import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

/**
 * Scannable barcode of a code, as a PNG data URL with the code printed
 * underneath — the sticker look used on the shelves and at the bottom of the
 * printed documents.
 */
export function barcodeDataUrl(value: string, height = 46): string {
  const code = value.trim();
  if (!code) return "";
  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, code, {
      format: "CODE128",
      height,
      width: 2,
      margin: 6,
      displayValue: true,
      fontSize: 15,
      textMargin: 2,
      background: "#ffffff",
      lineColor: "#000000",
    });
  } catch {
    return "";
  }
  return canvas.toDataURL("image/png");
}

/**
 * QR code of a payload, as a PNG data URL on white. QRCode.create is
 * synchronous, so the picture is in the DOM before the print starts — the
 * same guarantee the barcode already gives.
 */
export function qrDataUrl(value: string, sizePx = 120): string {
  const text = value.trim();
  if (!text) return "";
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const modules = qr.modules.size;
    const quiet = 4;
    const scale = Math.max(
      2,
      Math.floor(sizePx / (modules + quiet * 2))
    );
    const dim = (modules + quiet * 2) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = "#000000";
    const data = qr.modules.data;
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (data[row * modules + col]) {
          ctx.fillRect(
            (col + quiet) * scale,
            (row + quiet) * scale,
            scale,
            scale
          );
        }
      }
    }
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}
