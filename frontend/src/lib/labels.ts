import { formatXOF } from "../api/client";
import type { CompanySettings, LabelPrinterConfig } from "../types";
import { barcodeDataUrl } from "./barcode";

/** Article fields a price label needs, so a sample can be printed too. */
export interface LabelArticle {
  name: string;
  sale_price: number;
  wholesale_price: number;
  /** Article code printed under the price. */
  code: string;
  /** Value encoded in the barcode, usually the barcode or the code. */
  barcode: string;
}

/** One price label, following the switches of the label printer settings. */
export function priceLabelHtml(
  article: LabelArticle,
  company: CompanySettings | null,
  config: LabelPrinterConfig
): string {
  const bars = config.show_barcode ? barcodeDataUrl(article.barcode, 60) : "";
  return (
    `<div class="label">` +
    (config.show_logo && company?.logo
      ? `<img class="shop-logo" src="${company.logo}" alt="" />`
      : "") +
    (config.show_shop ? `<p class="shop">${company?.name ?? ""}</p>` : "") +
    (config.show_name ? `<p class="name">${article.name}</p>` : "") +
    (config.show_price
      ? `<p class="price">${formatXOF(article.sale_price)}</p>`
      : "") +
    (config.show_wholesale && article.wholesale_price > 0
      ? `<p class="wholesale">Gros : ${formatXOF(article.wholesale_price)}</p>`
      : "") +
    (config.show_code && article.code
      ? `<p class="code">${article.code}</p>`
      : "") +
    (bars ? `<img class="qr" src="${bars}" alt="" />` : "") +
    `</div>`
  );
}
