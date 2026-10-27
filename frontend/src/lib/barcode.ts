import JsBarcode from "jsbarcode";

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
