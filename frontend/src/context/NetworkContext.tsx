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
import { getServerUrl } from "../api/client";
import {
  dismissRejected,
  flushPendingSales,
  pendingSales,
  rejectedSales,
  type RejectedSale,
} from "../lib/offline";

const PING_INTERVAL_MS = 15000;
const RECONNECT_BANNER_MS = 6000;

interface NetworkContextValue {
  online: boolean;
  serverReachable: boolean;
  workstationStatus: string;
  lastContact: string | null;
  /** Tickets recorded locally and waiting to reach the server. */
  pendingCount: number;
  justReconnected: boolean;
  syncErrors: string[];
  /** Tickets the server refused outright — kept until the cashier dismisses them. */
  rejected: RejectedSale[];
  dismissRejectedSale: (reference: string) => void;
  refresh: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextValue | undefined>(
  undefined
);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [serverReachable, setServerReachable] = useState(false);
  const [workstationStatus, setWorkstationStatus] = useState("");
  const [lastContact, setLastContact] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(pendingSales().length);
  const [justReconnected, setJustReconnected] = useState(false);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const [rejected, setRejected] = useState<RejectedSale[]>(rejectedSales());
  const wasOnline = useRef(true);

  const sync = useCallback(async () => {
    const result = await flushPendingSales();
    setPendingCount(pendingSales().length);
    setRejected(rejectedSales());
    if (result.rejected.length > 0) setSyncErrors(result.rejected);
    if (result.synced > 0) {
      window.dispatchEvent(new Event("ri:synced"));
    }
  }, []);

  const refresh = useCallback(async () => {
    let reachable = false;
    try {
      const { data } = await axios.get(`${getServerUrl()}/api/health`, { timeout: 5000 });
      const authorized = !data.workstation_status || data.workstation_status === "approved";
      reachable = data.status === "ok" && data.app === "EasyGest" && authorized;
      setServerReachable(data.status === "ok" && data.app === "EasyGest");
      setWorkstationStatus(data.workstation_status || "");
      if (data.status === "ok" && data.app === "EasyGest") setLastContact(new Date().toISOString());
    } catch {
      reachable = false;
      setServerReachable(false);
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
    const onQueueChange = () => {
      setPendingCount(pendingSales().length);
      setRejected(rejectedSales());
    };
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
      value={{
        online,
        serverReachable,
        workstationStatus,
        lastContact,
        pendingCount,
        justReconnected,
        syncErrors,
        rejected,
        dismissRejectedSale: (reference: string) => {
          dismissRejected(reference);
          setRejected(rejectedSales());
        },
        refresh,
      }}
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
