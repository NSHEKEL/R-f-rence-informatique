import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import api from "../api/client";
import type { User } from "../types";

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [rights, setRights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadRights() {
    try {
      const res = await api.get<{ allowed: string[] }>("/permissions/me");
      setRights(res.data.allowed);
    } catch {
      setRights([]);
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
        setUser(res.data);
        await loadRights();
      })
      .catch(() => localStorage.removeItem("ri_token"))
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
    localStorage.setItem("ri_token", res.data.access_token);
    const me = await api.get<User>("/auth/me");
    setUser(me.data);
    await loadRights();
  }

  function logout() {
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
