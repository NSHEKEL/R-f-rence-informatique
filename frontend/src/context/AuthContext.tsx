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

interface AuthContextValue {
  user: User | null;
  loading: boolean;
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
    const token = localStorage.getItem("ri_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/auth/me")
      .then(async (res) => {
        if (localStorage.getItem("ri_token") !== token) return;
        setUser(res.data);
        setRights(readAuthCache(token)?.rights ?? []);
        await loadRights(res.data);
      })
      .catch((error) => {
        if (authDenied(error)) { localStorage.removeItem("ri_token"); clearAuthCache(); setRights([]); }
        else { const cached = readAuthCache(token); if (cached) { setUser(cached.user); setRights(cached.rights); } }
      })
      .finally(() => setLoading(false));
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
    const res = await api.post<{ access_token: string }>("/auth/login", {
      email,
      password,
    });
    clearAuthCache();
    setRights([]);
    localStorage.setItem("ri_token", res.data.access_token);
    const me = await api.get<User>("/auth/me");
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
