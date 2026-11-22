import {
  createContext,
  useContext,
  useEffect,
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
}

const SyncContext = createContext<SyncContextValue>({ version: 0, catalogueVersion: 0 });

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { online } = useNetwork();
  const [version, setVersion] = useState(0);
  const [catalogueVersion, setCatalogueVersion] = useState(0);
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    const updated = () => setLocalVersion((value) => value + 1);
    window.addEventListener("ri:queue", updated);
    return () => window.removeEventListener("ri:queue", updated);
  }, []);

  useEffect(() => {
    if (!user || !online) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const [res, catalogue] = await Promise.all([
          api.get<{ version: number }>("/sync/version"),
          api.get<{ version: number }>("/sync/version?scope=catalogue"),
        ]);
        if (!cancelled) {
          setVersion(res.data.version);
          setCatalogueVersion((previous) => Math.max(previous, catalogue.data.version));
        }
      } catch {
        /* offline: the network banner already tells the cashier */
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
    <SyncContext.Provider value={{ version: version + localVersion, catalogueVersion: catalogueVersion + localVersion }}>{children}</SyncContext.Provider>
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
  return useContext(SyncContext).catalogueVersion;
}
