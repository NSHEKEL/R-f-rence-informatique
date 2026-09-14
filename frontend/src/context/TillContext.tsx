import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import api from "../api/client";
import type { CashSessionDetail } from "../types";
import { useAuth } from "./AuthContext";

/**
 * State of the cashier's till.
 *
 * Selling — and even looking at the articles on sale — requires an open till,
 * so the whole application needs to know whether this user opened theirs.
 * Only sellers stand at the counter: the administrator and the stock manager
 * keep their screens whatever the till does.
 */
interface TillState {
  session: CashSessionDetail | null;
  dayClosed: boolean;
  loading: boolean;
  /** Sales screens are usable: till open, or the user is not a seller. */
  selling: boolean;
  refresh: () => Promise<void>;
}

const TillContext = createContext<TillState>({
  session: null,
  dayClosed: false,
  loading: true,
  selling: false,
  refresh: async () => undefined,
});

/** Pages a cashier only reaches with an open till. */
export const TILL_GATED = new Set([
  "vente_nouvelle",
  "ventes",
  "produits",
  "inventaire",
  "retours",
  "proformas",
]);

export function TillProvider({ children }: { children: React.ReactNode }) {
  const { user, can } = useAuth();
  const [session, setSession] = useState<CashSessionDetail | null>(null);
  const [dayClosed, setDayClosed] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user || !can("caisse")) {
      setSession(null);
      setDayClosed(false);
      setLoading(false);
      return;
    }
    try {
      const [open, today] = await Promise.all([
        api.get<CashSessionDetail | null>("/cash-sessions/current"),
        api.get<CashSessionDetail | null>("/cash-sessions/today"),
      ]);
      setSession(open.data ?? null);
      setDayClosed(Boolean(today.data && today.data.closed_at));
    } catch {
      // Offline or server restarting: keep the last known state.
    } finally {
      setLoading(false);
    }
  }, [user, can]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const value = useMemo<TillState>(
    () => ({
      session,
      dayClosed,
      loading,
      selling: user?.role !== "vendeur" || session !== null,
      refresh,
    }),
    [session, dayClosed, loading, user, refresh]
  );

  return <TillContext.Provider value={value}>{children}</TillContext.Provider>;
}

export function useTill(): TillState {
  return useContext(TillContext);
}
