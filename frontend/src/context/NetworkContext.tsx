import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import axios from "axios";
import { API_BASE } from "../api/client";
import { flushPendingSales, pendingSales } from "../lib/offline";

const PING_INTERVAL_MS = 15000;
const RECONNECT_BANNER_MS = 6000;

interface NetworkContextValue {
  online: boolean;
  /** Tickets recorded locally and waiting to reach the server. */
  pendingCount: number;
  justReconnected: boolean;
  syncErrors: string[];
  refresh: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextValue | undefined>(
  undefined
);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(pendingSales().length);
  const [justReconnected, setJustReconnected] = useState(false);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const wasOnline = useRef(true);

  const sync = useCallback(async () => {
    const result = await flushPendingSales();
    setPendingCount(pendingSales().length);
    if (result.rejected.length > 0) setSyncErrors(result.rejected);
    if (result.synced > 0) {
      window.dispatchEvent(new Event("ri:synced"));
    }
  }, []);

  const refresh = useCallback(async () => {
    let reachable = false;
    try {
      await axios.get(`${API_BASE}/api/health`, { timeout: 5000 });
      reachable = true;
    } catch {
      reachable = false;
    }
    setOnline(reachable);
    if (reachable && !wasOnline.current) {
      setJustReconnected(true);
      window.setTimeout(() => setJustReconnected(false), RECONNECT_BANNER_MS);
      await sync();
    }
    wasOnline.current = reachable;
    return reachable;
  }, [sync]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, PING_INTERVAL_MS);
    const onQueueChange = () => setPendingCount(pendingSales().length);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("ri:queue", onQueueChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("ri:queue", onQueueChange);
    };
  }, [refresh]);

  return (
    <NetworkContext.Provider
      value={{ online, pendingCount, justReconnected, syncErrors, refresh }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within NetworkProvider");
  return ctx;
}
