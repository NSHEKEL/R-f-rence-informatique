import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import api from "../api/client";
import defaultLogo from "../assets/logo-easygest.png";
import { cacheRead, cacheWrite } from "../lib/offline";
import type { CompanySettings, PrintingConfig } from "../types";
import { mergePrinting } from "../lib/printStyle";
import { applyPosteDrawer, restorePosteSettings } from "../lib/poste";

export const COMPANY_CACHE_KEY = "company";
export const PRINTING_CACHE_KEY = "printing";
export const DEFAULT_BRAND = "EasyGest";

interface CompanyContextValue {
  company: CompanySettings | null;
  brandName: string;
  /** Uploaded logo when the company set one, otherwise the bundled mark. */
  logoSrc: string;
  hasCustomLogo: boolean;
  setCompany: (company: CompanySettings) => void;
  /** Receipt and label printer settings, configured once and reused. */
  printing: PrintingConfig;
  sharedPrinting: PrintingConfig;
  setPrinting: (printing: PrintingConfig) => void;
  reload: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | undefined>(
  undefined
);

/** A cache or a server older than a section still yields a usable config. */
function withDefaults(config: PrintingConfig | null): PrintingConfig {
  return mergePrinting(config);
}

const POSTE_PRINTERS_KEY = "ri_printers_poste";

/** Printer names chosen on this workstation, kept out of the shared config. */
export function readPostePrinters(): Record<string, string> {
  try {
    return JSON.parse(
      localStorage.getItem(POSTE_PRINTERS_KEY) || "{}"
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export function writePostePrinters(names: Record<string, string>): void {
  localStorage.setItem(POSTE_PRINTERS_KEY, JSON.stringify(names));
  window.dispatchEvent(new Event("easygest-poste-changed"));
  // Backup copy on the workstation's disk: if the app data is wiped the
  // file next to EasyGest still holds this poste's printer choices.
  const bridge = (
    window as unknown as {
      pywebview?: {
        api?: { write_pref_file?: (n: string, c: string) => Promise<string> };
      };
    }
  ).pywebview?.api?.write_pref_file;
  if (bridge) {
    bridge(POSTE_PRINTERS_FILE, JSON.stringify(names)).catch(() => {});
  }
}

const POSTE_PRINTERS_FILE = "easygest-imprimantes-poste.json";
const POSTE_PRINTER_KEYS = [
  "receipt",
  "label",
  "documents",
  "delivery",
  "quote",
  "reports",
  "settlement",
];

/**
 * Restores this poste's printer assignments from the on-disk backup when
 * localStorage lost them (reinstall, wiped app data). Returns the merged
 * map, or null when nothing was recovered.
 */
export async function restorePostePrinters(): Promise<Record<
  string,
  string
> | null> {
  const current = readPostePrinters();
  const missing = POSTE_PRINTER_KEYS.filter((key) => current[key] === undefined);
  if (!missing.length) return null;
  const bridge = (
    window as unknown as {
      pywebview?: { api?: { read_pref_file?: (n: string) => Promise<string> } };
    }
  ).pywebview?.api?.read_pref_file;
  if (!bridge) return null;
  try {
    const raw = await bridge(POSTE_PRINTERS_FILE);
    if (!raw) return null;
    // A truncated or hand-edited file must not poison the poste's choices:
    // only a plain object of strings is accepted, anything else is ignored.
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const fromFile = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([key, value]) =>
          POSTE_PRINTER_KEYS.includes(key) && typeof value === "string"
      )
    ) as Record<string, string>;
    if (!Object.keys(fromFile).length) return null;
    const merged = { ...fromFile, ...current };
    writePostePrinters(merged);
    return merged;
  } catch {
    return null;
  }
}

/** Server config overlaid with the printer names chosen on this poste. */
export function applyPostePrinters(config: PrintingConfig): PrintingConfig {
  const poste = readPostePrinters();
  return {
    ...config,
    receipt: {
      ...config.receipt,
      printer_name: poste.receipt ?? config.receipt.printer_name,
    },
    label: {
      ...config.label,
      printer_name: poste.label ?? config.label.printer_name,
    },
    documents: {
      ...config.documents,
      printer_name: poste.documents ?? config.documents.printer_name,
      delivery_printer_name:
        poste.delivery ?? config.documents.delivery_printer_name,
      quote_printer_name:
        poste.quote ?? config.documents.quote_printer_name,
      reports_printer_name:
        poste.reports ?? config.documents.reports_printer_name,
      settlement_printer_name:
        poste.settlement ?? config.documents.settlement_printer_name,
    },
  };
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [, updatePoste] = useState(0);
  useEffect(() => {
    const refresh = () => updatePoste((value) => value + 1);
    window.addEventListener("easygest-poste-changed", refresh);
    void restorePosteSettings();
    return () => window.removeEventListener("easygest-poste-changed", refresh);
  }, []);
  const [company, setCompanyState] = useState<CompanySettings | null>(() =>
    cacheRead<CompanySettings>(COMPANY_CACHE_KEY)
  );

  const [printing, setPrintingState] = useState<PrintingConfig>(() =>
    withDefaults(cacheRead<PrintingConfig>(PRINTING_CACHE_KEY))
  );

  const setCompany = useCallback((next: CompanySettings) => {
    setCompanyState(next);
    cacheWrite(COMPANY_CACHE_KEY, next);
  }, []);

  const setPrinting = useCallback((next: PrintingConfig) => {
    const merged = withDefaults(next);
    setPrintingState(merged);
    cacheWrite(PRINTING_CACHE_KEY, merged);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<CompanySettings>("/settings/company");
      setCompany(res.data);
    } catch {
      /* offline: keep the cached branding */
    }
    try {
      const res = await api.get<PrintingConfig>("/settings/printing");
      setPrinting(res.data);
    } catch {
      /* offline, or a server older than the printing module */
    }
  }, [setCompany, setPrinting]);

  // The settings also change without the user touching them: another
  // workstation edits the company sheet, or the owner pushes a new "À propos"
  // from his console. They are read again regularly and when the window is
  // brought back to the front.
  useEffect(() => {
    const refresh = () => {
      if (localStorage.getItem("ri_token")) reload();
    };
    refresh();
    const timer = window.setInterval(refresh, 300000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);

  // Repaired from the on-disk backup when the browser storage was wiped:
  // the assignments below already read localStorage, so a restore fills it
  // and the overlay picks the poste's printers up on the next render.
  useEffect(() => {
    void restorePostePrinters();
  }, []);

  return (
    <CompanyContext.Provider
      value={{
        company: company ? applyPosteDrawer(company) : null,
        brandName: company?.name || DEFAULT_BRAND,
        logoSrc: company?.logo || defaultLogo,
        hasCustomLogo: Boolean(company?.logo),
        setCompany,
        printing: applyPostePrinters(printing),
        sharedPrinting: printing,
        setPrinting,
        reload,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
