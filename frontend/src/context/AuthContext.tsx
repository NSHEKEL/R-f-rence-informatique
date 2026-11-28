import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import api from "../api/client";
import type { User } from "../types";
import { authDenied, clearAuthCache, readAuthCache, writeAuthCache } from "../lib/authCache";
import { desktopOffline, type DesktopAccount } from "../lib/desktopOffline";
import { getServerUrl } from "../api/client";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  recoveryWarning: string;
  retryLocalRecovery: () => Promise<void>;
  isAdmin: boolean;
  /** Administrators and stock managers: catalogue, stock and purchases. */
  isStockManager: boolean;
  isSeller: boolean;
  /** Rights the administrator granted to this role. */
  can: (permission: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-read the account (after changing one's own picture, for instance). */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [rights, setRights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [desktopBound, setDesktopBound] = useState(false);
  const [recoveryWarning, setRecoveryWarning] = useState("");

  async function recoverLocalJournal(token: string) {
    try {
      await desktopOffline.recoverLocal(token);
      if (localStorage.getItem("ri_token") === token) setRecoveryWarning("");
    } catch (error) {
      if (localStorage.getItem("ri_token") !== token) return;
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Reprise locale impossible ; les opérations restent conservées";
      setRecoveryWarning(message);
    }
  }

  async function retryLocalRecovery() {
    const token = localStorage.getItem("ri_token");
    if (token) {
      await recoverLocalJournal(token);
      window.dispatchEvent(new CustomEvent("ri:offline-state"));
    }
  }

  async function loadRights(account: User | null = user) {
    const token = localStorage.getItem("ri_token");
    if (!token) return;
    try {
      const res = await api.get<{ allowed: string[] }>("/permissions/me");
      if (localStorage.getItem("ri_token") !== token) return;
      setRights(res.data.allowed);
      if (account) writeAuthCache(token, account, res.data.allowed);
    } catch (error) {
      const current = localStorage.getItem("ri_token");
      if (current && current !== token) return;
      if (authDenied(error)) { setRights([]); clearAuthCache(); }
    }
  }

  useEffect(() => {
    if (desktopOffline.available()) {
      setLoading(false);
      void desktopOffline.command<DesktopAccount | null>("resume").then(async (account) => {
        if (!account) return;
        localStorage.setItem("ri_token", account.access_token);
        writeAuthCache(account.access_token, account.user, account.rights);
        setUser(account.user);
        setRights(account.rights);
        setDesktopBound(true);
        await desktopOffline.importLegacy();
        await desktopOffline.refresh();
      }).catch(() => {});
      return;
    }
    const token = localStorage.getItem("ri_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/auth/me")
      .then(async (res) => {
        if (localStorage.getItem("ri_token") !== token) return;
        await recoverLocalJournal(token);
        if (localStorage.getItem("ri_token") !== token) return;
        setUser(res.data);
        setRights(readAuthCache(token)?.rights ?? []);
        await loadRights(res.data);
      })
      .catch((error) => {
        if (authDenied(error)) { localStorage.removeItem("ri_token"); clearAuthCache(); setRights([]); }
        else if (desktopOffline.local() && error instanceof Error) window.alert(error.message);
        else if (!desktopOffline.local()) { const cached = readAuthCache(token); if (cached) { setUser(cached.user); setRights(cached.rights); } }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const changed = () => {
      if (!desktopBound) return;
      if (desktopOffline.state().locked) { clearAuthCache(); localStorage.removeItem("ri_token"); setUser(null); setRights([]); setDesktopBound(false); return; }
      void desktopOffline.command<DesktopAccount>("account").then((account) => {
        localStorage.setItem("ri_token", account.access_token);
        writeAuthCache(account.access_token, account.user, account.rights);
        setUser((old) => JSON.stringify(old) === JSON.stringify(account.user) ? old : account.user);
        setRights((old) => JSON.stringify(old) === JSON.stringify(account.rights) ? old : account.rights);
      }).catch(() => {});
    };
    window.addEventListener("ri:offline-state", changed);
    return () => window.removeEventListener("ri:offline-state", changed);
  }, [desktopBound]);

  useEffect(() => {
    const validated = () => {
      const token = localStorage.getItem("ri_token");
      const cached = token ? readAuthCache(token) : null;
      if (cached) { setUser(cached.user); setRights(cached.rights); }
    };
    const denied = () => { setUser(null); setRights([]); };
    window.addEventListener("ri:account-validated", validated);
    window.addEventListener("ri:account-denied", denied);
    return () => { window.removeEventListener("ri:account-validated", validated); window.removeEventListener("ri:account-denied", denied); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadRights();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user]);

  async function login(email: string, password: string) {
    if (desktopOffline.available()) {
      let account = await desktopOffline.login(getServerUrl() || window.location.origin, email, password);
      if (!account.offline_ready && account.user.role === "admin" && account.fingerprint) {
        const expected = window.prompt("Préparation unique du poste hors ligne : comparez avec Configuration du PC serveur, puis recopiez son empreinte SHA-256. Annuler conserve la connexion en ligne uniquement.", "");
        if (expected) account = await desktopOffline.login(getServerUrl() || window.location.origin, email, password, expected.trim());
      }
      clearAuthCache();
      localStorage.setItem("ri_token", account.access_token);
      writeAuthCache(account.access_token, account.user, account.rights);
      setRecoveryWarning("");
      setUser(account.user);
      setRights(account.rights);
      setDesktopBound(Boolean(account.offline_ready));
      if (account.warning) window.alert(account.warning);
      if (account.offline_ready) void desktopOffline.catalogue(false).catch(() => {});
      return;
    }
    const res = await api.post<{ access_token: string }>("/auth/login", {
      email,
      password,
    });
    clearAuthCache();
    setRights([]);
    localStorage.setItem("ri_token", res.data.access_token);
    const me = await api.get<User>("/auth/me");
    await recoverLocalJournal(res.data.access_token);
    setUser(me.data);
    await loadRights(me.data);
  }

  async function refreshUser() {
    try {
      const me = await api.get<User>("/auth/me");
      setUser(me.data);
    } catch {
      /* keep the account currently in memory */
    }
  }

  function logout() {
    setRecoveryWarning("");
    if (desktopOffline.available()) void desktopOffline.command("logout").then(() => desktopOffline.refresh());
    setDesktopBound(false);
    clearAuthCache();
    localStorage.removeItem("ri_token");
    setUser(null);
    setRights([]);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        recoveryWarning,
        retryLocalRecovery,
        isAdmin: user?.role === "admin",
        isStockManager: user?.role === "admin" || user?.role === "gestionnaire",
        isSeller: user?.role === "vendeur",
        can: (permission: string) =>
          user?.role === "admin" || rights.includes(permission),
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
