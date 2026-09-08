import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import api from "../api/client";

export interface LicenseFeature {
  code: string;
  name: string;
  section: string;
  allowed: boolean;
}

export interface LicenseStatus {
  mode: string;
  plan_code: string;
  plan_name: string;
  status: string;
  message: string;
  blocked: boolean;
  registered: boolean;
  client_name: string;
  license_key: string;
  ends_at: string | null;
  days_left: number | null;
  grace_days: number;
  last_sync: string | null;
  last_error: string;
  central_url: string;
  installation_uid: string;
  features: string[];
  catalogue: LicenseFeature[];
}

interface LicenseContextValue {
  license: LicenseStatus | null;
  /** True while nothing is known yet: the menu stays as it was. */
  loading: boolean;
  /** A shop with no central server keeps every capability. */
  hasFeature: (code: string) => boolean;
  /** Name of a capability, for the "🔒 Fonctionnalité ..." messages. */
  featureName: (code: string) => string;
  refresh: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | undefined>(undefined);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<LicenseStatus>("/license");
      setLicense(res.data);
    } catch {
      setLicense(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const hasFeature = useCallback(
    (code: string) => {
      if (!license || license.mode === "local") return true;
      if (license.blocked) return false;
      return license.features.includes(code);
    },
    [license]
  );

  const featureName = useCallback(
    (code: string) =>
      license?.catalogue.find((item) => item.code === code)?.name ?? code,
    [license]
  );

  return (
    <LicenseContext.Provider
      value={{ license, loading, hasFeature, featureName, refresh }}
    >
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense(): LicenseContextValue {
  const value = useContext(LicenseContext);
  if (!value) throw new Error("useLicense hors LicenseProvider");
  return value;
}
