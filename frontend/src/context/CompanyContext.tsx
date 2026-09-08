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
import type { CompanySettings } from "../types";

export const COMPANY_CACHE_KEY = "company";
export const DEFAULT_BRAND = "EasyGest";

interface CompanyContextValue {
  company: CompanySettings | null;
  brandName: string;
  /** Uploaded logo when the company set one, otherwise the bundled mark. */
  logoSrc: string;
  hasCustomLogo: boolean;
  setCompany: (company: CompanySettings) => void;
  reload: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | undefined>(
  undefined
);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [company, setCompanyState] = useState<CompanySettings | null>(() =>
    cacheRead<CompanySettings>(COMPANY_CACHE_KEY)
  );

  const setCompany = useCallback((next: CompanySettings) => {
    setCompanyState(next);
    cacheWrite(COMPANY_CACHE_KEY, next);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<CompanySettings>("/settings/company");
      setCompany(res.data);
    } catch {
      /* offline: keep the cached branding */
    }
  }, [setCompany]);

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
