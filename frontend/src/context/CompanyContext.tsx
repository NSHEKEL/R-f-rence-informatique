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
import { DEFAULT_PRINTING } from "../types";

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
  setPrinting: (printing: PrintingConfig) => void;
  reload: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | undefined>(
  undefined
);

/** A cache or a server older than a section still yields a usable config. */
function withDefaults(config: PrintingConfig | null): PrintingConfig {
  if (!config) return DEFAULT_PRINTING;
  return {
    receipt: { ...DEFAULT_PRINTING.receipt, ...config.receipt },
    label: { ...DEFAULT_PRINTING.label, ...config.label },
    documents: { ...DEFAULT_PRINTING.documents, ...config.documents },
  };
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

  return (
    <CompanyContext.Provider
      value={{
        company,
        brandName: company?.name || DEFAULT_BRAND,
        logoSrc: company?.logo || defaultLogo,
        hasCustomLogo: Boolean(company?.logo),
        setCompany,
        printing: applyPostePrinters(printing),
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
