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
import api, { getServerUrl } from "../api/client";
import { desktopOffline, type JournalState } from "../lib/desktopOffline";
import { authDenied, clearAuthCache, writeAuthCache } from "../lib/authCache";
import type { User } from "../types";
import {
  dismissRejected,
  flushPendingSales,
  pendingSales,
  pendingProducts,
  flushPendingProducts,
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
  journal: JournalState | null;
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
  const [pendingCount, setPendingCount] = useState(pendingSales().length + pendingProducts().length);
  const [justReconnected, setJustReconnected] = useState(false);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const [journal, setJournal] = useState<JournalState | null>(null);
  const [rejected, setRejected] = useState<RejectedSale[]>(rejectedSales());
  const wasOnline = useRef(false);

  const sync = useCallback(async () => {
    const result = await flushPendingSales();
    const products = await flushPendingProducts();
    setPendingCount(pendingSales().length + pendingProducts().length);
    setRejected(rejectedSales());
    setSyncErrors([...pendingSales().filter((entry) => entry.reason).map((entry) => `${entry.snapshot.reference} : ${entry.reason}`), ...pendingProducts().filter((entry) => entry.reason).map((entry) => `${entry.payload.sku} : ${entry.reason}`)]);
    if (result.synced > 0 || products.synced > 0) {
      window.dispatchEvent(new Event("ri:synced"));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (desktopOffline.available()) {
      try {
        const current = await desktopOffline.refresh(true);
        setJournal(current);
        if (!current.locked || current.pending.length > 0 || current.revoked) {
          setOnline(current.online);
          setServerReachable(current.online);
          setPendingCount(current.pending.length + pendingProducts().length);
          setSyncErrors(current.pending.filter((row) => row.reason).map((row) => `${row.reference} : ${row.reason}`));
          setJustReconnected(current.online && !wasOnline.current);
          if (current.online) setLastContact(new Date().toISOString());
          if (current.synced) window.dispatchEvent(new Event("ri:synced"));
          if (current.online && !current.locked) {
            const account = await desktopOffline.command<{ access_token: string }>("account");
            localStorage.setItem("ri_token", account.access_token);
            const products = await flushPendingProducts();
            if (products.synced) window.dispatchEvent(new Event("ri:synced"));
            setPendingCount(current.pending.length + pendingProducts().length);
          }
          wasOnline.current = current.online;
          return current.online;
        }
      } catch { /* a local-store error is surfaced at checkout, never acknowledged as a sale */ }
    }
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
    }
    let authenticated = false;
    try { authenticated = Boolean(localStorage.getItem("ri_token") && JSON.parse(localStorage.getItem("ri_auth_cache") || "{}").token === localStorage.getItem("ri_token")); } catch { /* no cached login */ }
    if (reachable && authenticated) {
      try {
        const [account, permissions] = await Promise.all([api.get<User>("/auth/me"), api.get<{ allowed: string[] }>("/permissions/me")]);
        const token = localStorage.getItem("ri_token");
        if (token) { writeAuthCache(token, account.data, permissions.data.allowed); window.dispatchEvent(new Event("ri:account-validated")); await sync(); }
      } catch (error) {
        if (authDenied(error)) { localStorage.removeItem("ri_token"); clearAuthCache(); window.dispatchEvent(new Event("ri:account-denied")); }
      }
    }
    wasOnline.current = reachable;
    return reachable;
  }, [sync]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, PING_INTERVAL_MS);
    const onQueueChange = () => {
      if (desktopOffline.available()) {
        const current = desktopOffline.state();
        setJournal(current);
        setPendingCount(current.pending.length + pendingProducts().length);
        setSyncErrors(current.pending.filter((row) => row.reason).map((row) => `${row.reference} : ${row.reason}`));
        setOnline(current.online);
        return;
      }
      setPendingCount(pendingSales().length + pendingProducts().length);
      setRejected(rejectedSales());
      setSyncErrors([...pendingSales().filter((entry) => entry.reason).map((entry) => `${entry.snapshot.reference} : ${entry.reason}`), ...pendingProducts().filter((entry) => entry.reason).map((entry) => `${entry.payload.sku} : ${entry.reason}`)]);
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
        journal,
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
