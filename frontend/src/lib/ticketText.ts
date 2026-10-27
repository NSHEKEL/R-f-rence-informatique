/**
 * Text version of the receipt, for the counter printer.
 *
 * The browser printer always stamps the date, the window title, the local
 * address and a page number around the ticket. The thermal printer takes
 * plain text instead, so the ticket shown on screen is read back and turned
 * into lines of the paper width: what comes out is the receipt alone.
 */
import type { ReceiptFormat } from "../types";

export interface TicketLine {
  text?: string;
  align?: "left" | "center";
  bold?: boolean;
  big?: boolean;
  barcode?: string;
  /** Logo, as base64 rows of packed black-and-white pixels. */
  image?: string;
  image_width?: number;
  image_height?: number;
}

/** Characters per line, at the printer's standard font. */
function columns(format: ReceiptFormat): number {
  return format === "58mm" ? 32 : 42;
}

/** Printing dots across the paper, at the usual 203 dpi. */
function dots(format: ReceiptFormat): number {
  return format === "58mm" ? 384 : 576;
}

/**
 * Logo turned into the bitmap the thermal printer understands: it prints
 * text and dots only, so the picture is drawn on a canvas, reduced to black
 * or white and packed eight pixels per byte.
 */
function logoLine(
  image: HTMLImageElement,
  format: ReceiptFormat
): TicketLine | null {
  const natural = image.naturalWidth;
  if (!natural || !image.naturalHeight || !image.complete) return null;
  // Half the paper width keeps the logo readable without eating the roll.
  const width = Math.floor(dots(format) / 2 / 8) * 8;
  const height = Math.max(
    8,
    Math.round((image.naturalHeight / natural) * width)
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  try {
    context.drawImage(image, 0, 0, width, height);
  } catch {
    return null; // Logo served from elsewhere: the canvas refuses to read it.
  }
  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
  const bytesPerRow = width / 8;
  const packed = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const alpha = pixels[at + 3] / 255;
      // Transparent areas are paper, not ink.
      const grey =
        (0.299 * pixels[at] + 0.587 * pixels[at + 1] + 0.114 * pixels[at + 2]) *
          alpha +
        255 * (1 - alpha);
      if (grey < 160) {
        packed[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  let binary = "";
  packed.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return {
    image: btoa(binary),
    image_width: width,
    image_height: height,
  };
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Label on the left, value on the right, on the same line. */
function pair(label: string, value: string, width: number): string[] {
  if (label.length + value.length + 1 <= width) {
    return [label + " ".repeat(width - label.length - value.length) + value];
  }
  return [label, " ".repeat(Math.max(width - value.length, 0)) + value];
}

function rule(width: number): TicketLine {
  return { text: "-".repeat(width) };
}

function metaLines(block: Element, width: number): TicketLine[] {
  const cells = Array.from(block.querySelectorAll("span")).map((s) =>
    clean(s.textContent)
  );
  const lines: TicketLine[] = [];
  for (let i = 0; i + 1 < cells.length; i += 2) {
    pair(cells[i], cells[i + 1], width).forEach((text) => lines.push({ text }));
  }
  return lines;
}

function itemLines(table: Element, width: number): TicketLine[] {
  const lines: TicketLine[] = [];
  table.querySelectorAll("tbody tr").forEach((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((c) =>
      clean(c.textContent)
    );
    if (cells.length === 0) return;
    const name = cells[0];
    const total = cells[cells.length - 1];
    const middle = cells.slice(1, -1).join(" x ");
    lines.push({ text: name.slice(0, width) });
    pair(middle ? `  ${middle}` : "  ", total, width).forEach((text) =>
      lines.push({ text })
    );
  });
  return lines;
}

/** Reads the printed copy of the ticket and rewrites it for the printer. */
export function ticketLines(
  root: HTMLElement,
  format: ReceiptFormat
): TicketLine[] {
  const width = columns(format);
  const lines: TicketLine[] = [];
  const centred = (node: Element, extra: Partial<TicketLine> = {}) => {
    // Double-size characters are twice as wide, so they fit half a line.
    const room = extra.big ? Math.floor(width / 2) : width;
    const text = clean(node.textContent).slice(0, room);
    if (text) lines.push({ align: "center", ...extra, text });
  };
  // Kept in the order of the ticket on screen, so the printed copy reads the
  // same: letterhead, references, items, totals, barcode, thanks.
  const logo = root.querySelector<HTMLImageElement>("img.receipt-logo");
  if (logo) {
    const line = logoLine(logo, format);
    if (line) lines.push(line);
  }
  const blocks = root.querySelectorAll(
    ".receipt-company,.receipt-slogan,.receipt-contact p,.receipt-title," +
      ".receipt-duplicate,.receipt-meta,.receipt-items,.receipt-total," +
      ".receipt-barcode,.receipt-footer"
  );
  blocks.forEach((node) => {
    const kind = node.classList;
    if (kind.contains("receipt-company")) centred(node, { bold: true, big: true });
    else if (kind.contains("receipt-title")) {
      lines.push(rule(width));
      centred(node, { bold: true });
      lines.push(rule(width));
    } else if (kind.contains("receipt-duplicate")) centred(node, { bold: true });
    else if (kind.contains("receipt-meta")) lines.push(...metaLines(node, width));
    else if (kind.contains("receipt-items")) {
      lines.push(rule(width));
      lines.push(...itemLines(node, width));
      lines.push(rule(width));
    } else if (kind.contains("receipt-total")) {
      const cells = Array.from(node.querySelectorAll("span")).map((s) =>
        clean(s.textContent)
      );
      pair(cells[0] ?? "Total", cells[1] ?? "", width).forEach((text) =>
        lines.push({ text, bold: true })
      );
    } else if (kind.contains("receipt-barcode")) {
      const reference = node.getAttribute("alt");
      if (reference) lines.push({ barcode: reference });
    } else centred(node);
  });
  return lines;
}
