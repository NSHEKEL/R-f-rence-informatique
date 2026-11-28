import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import api from "../api/client";
import { useAuth } from "./AuthContext";
import { useNetwork } from "./NetworkContext";

/** How fast a change made on another workstation shows up here. */
const POLL_INTERVAL_MS = 4000;

interface SyncContextValue {
  /** Revision of the shared database; bumps on every write, anywhere. */
  version: number;
  catalogueVersion: number;
  productIds: number[] | null;
}

const SyncContext = createContext<SyncContextValue>({ version: 0, catalogueVersion: 0, productIds: null });

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { online } = useNetwork();
  const [version, setVersion] = useState(0);
  const [catalogueVersion, setCatalogueVersion] = useState(0);
  const [productIds, setProductIds] = useState<number[] | null>(null);
  const catalogueCursor = useRef(0);
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    const updated = () => setLocalVersion((value) => value + 1);
    window.addEventListener("ri:queue", updated);
    return () => window.removeEventListener("ri:queue", updated);
  }, []);

  useEffect(() => {
    if (!user || !online) return;
    let cancelled = false;
    let polling = false;

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const [res, catalogue] = await Promise.all([
          api.get<{ version: number }>("/sync/version"),
          api.get<{ version: number; product_ids?: number[] | null }>(`/sync/version?scope=catalogue&since=${catalogueCursor.current}`),
        ]);
        if (!cancelled) {
          setVersion(res.data.version);
          if (catalogue.data.version !== catalogueCursor.current) {
            setProductIds(catalogue.data.product_ids ?? null);
            catalogueCursor.current = catalogue.data.version;
            setCatalogueVersion(catalogue.data.version);
          }
        }
      } catch {
        /* offline: the network banner already tells the cashier */
      } finally {
        polling = false;
      }
    };

    poll();
    window.addEventListener("ri:synced", poll);
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("ri:synced", poll);
    };
  }, [user, online]);

  return (
    <SyncContext.Provider value={{ version: version + localVersion, catalogueVersion, productIds }}>{children}</SyncContext.Provider>
  );
}

/**
 * Screens call this to reload when any workstation changed the data:
 * `useEffect(() => { load(); }, [load, version])`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSyncVersion(): number {
  return useContext(SyncContext).version;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCatalogueVersion(): number {
  const { catalogueVersion } = useContext(SyncContext);
  return catalogueVersion;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCatalogueChanges() {
  const { catalogueVersion, productIds } = useContext(SyncContext);
  return { version: catalogueVersion, productIds };
}
