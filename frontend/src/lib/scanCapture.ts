export interface ScanSettings { scanner_prefix: string; scanner_suffix: "Enter" | "Tab"; scanner_min_length: number }
const french = "&é\"'(-è_çà";

export function scanTargetAllowed(owned: boolean, editable: boolean, dialogOpen: boolean, inDialog: boolean, scanDialog: boolean) {
  return !(dialogOpen && (!inDialog || !scanDialog)) && (owned || !editable);
}

export function scanCandidates(raw: string, physical = "", prefix = "", minLength = 1): string[] {
  const strip = (s: string) => prefix && s.startsWith(prefix) ? s.slice(prefix.length) : s;
  const digits = (s: string) => s.replace(/[&é"'(-è_çà]/g, (c) => String((french.indexOf(c) + 1) % 10));
  const letters = (s: string, reverse = false) => s.replace(/[aqwzmAQWZM,;]/g, (c) => ({ a: "q", q: "a", w: "z", z: "w", A: "Q", Q: "A", W: "Z", Z: "W", m: reverse ? ";" : ",", M: reverse ? ":" : "?", ",": reverse ? "m" : ";", ";": reverse ? "," : "m" })[c]!);
  const clean = [...raw].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join("");
  const values = [raw, physical, digits(raw), letters(digits(raw)), letters(digits(raw), true), letters(raw), letters(raw, true), clean];
  return [...new Set(values.map((value) => strip(value.trim())).filter((value) => value.length >= minLength))];
}

export function scanQueue(consume: (codes: string[]) => Promise<void>, onError: (error: unknown) => void) {
  let tail = Promise.resolve();
  return (codes: string[]) => { tail = tail.then(() => consume(codes)).catch(onError); return tail; };
}

export class ScanCapture {
  private raw = "";
  private physical = "";
  private start = 0;
  private last = 0;
  private count = 0;
  private previous = "";
  private previousAt = -Infinity;
  reset() { this.raw = ""; this.physical = ""; this.count = 0; }
  feed(event: Pick<KeyboardEvent, "key" | "code" | "isComposing" | "ctrlKey" | "altKey" | "metaKey" | "repeat">, now: number, settings: ScanSettings) {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.repeat) { this.reset(); return null; }
    if (event.key === settings.scanner_suffix) {
      const rapid = this.count >= 3 && now - this.last <= 200 && (this.last - this.start) / Math.max(1, this.count - 1) <= 180;
      if (!rapid) { this.reset(); return null; }
      const codes = scanCandidates(this.raw, this.physical, settings.scanner_prefix, settings.scanner_min_length);
      const identity = (scanCandidates(this.physical, "", settings.scanner_prefix, settings.scanner_min_length)[0] || codes[0] || "").toLowerCase();
      this.reset();
      if (!codes.length) return null;
      if (identity === this.previous && now - this.previousAt < 300) return [];
      this.previous = identity; this.previousAt = now;
      return codes;
    }
    if (event.key.length !== 1) { if (event.key !== "Shift" && event.key !== "CapsLock") this.reset(); return null; }
    if (now - this.last > 200) this.reset();
    if (!this.count) this.start = now;
    this.count++; this.last = now;
    this.raw += event.key;
    this.physical += /^Digit\d$/.test(event.code) ? event.code.slice(5) : /^Numpad\d$/.test(event.code) ? event.code.slice(6) : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : event.key;
    if (this.raw.length > 512) this.reset();
    return null;
  }
}
