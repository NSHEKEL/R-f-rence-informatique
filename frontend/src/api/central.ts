import axios from "axios";

/**
 * Calls of the Global Administrator console.
 *
 * The console is served by the central server, so it normally talks to its own
 * origin; a developer (or the owner opening the console from a workstation)
 * can point it elsewhere, and the address is remembered.
 */
const URL_KEY = "easygest_central_url";
const TOKEN_KEY = "easygest_central_token";

export function getCentralUrl(): string {
  return (
    localStorage.getItem(URL_KEY) ??
    (import.meta.env.VITE_CENTRAL_URL as string | undefined) ??
    ""
  ).replace(/\/+$/, "");
}

export function setCentralUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean) localStorage.setItem(URL_KEY, clean);
  else localStorage.removeItem(URL_KEY);
}

export function getCentralToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setCentralToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const central = axios.create();

central.interceptors.request.use((config) => {
  config.baseURL = `${getCentralUrl()}/api/central`;
  const token = getCentralToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

central.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      setCentralToken("");
      if (window.location.pathname !== "/console/connexion") {
        window.location.href = "/console/connexion";
      }
    }
    return Promise.reject(error);
  }
);

export default central;

export interface PlanRight {
  code: string;
  name: string;
  section: string;
  allowed: boolean;
}

export interface Plan {
  id: number;
  code: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  duration_days: number;
  grace_days: number;
  is_active: boolean;
  is_public: boolean;
  clients_count: number;
  rights: PlanRight[];
}

export interface ClientRow {
  id: number;
  company: string;
  manager: string;
  phone: string;
  email: string;
  city: string;
  installation_uid: string;
  plan_code: string;
  plan_name: string;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  status_label: string;
  last_seen: string | null;
  last_sync: string | null;
  version: string;
  users_count: number;
  online: boolean;
}

export interface ClientPage {
  total: number;
  page: number;
  pages: number;
  rows: ClientRow[];
}

export interface Installation {
  id: number;
  uid: string;
  hostname: string;
  version: string;
  users_count: number;
  last_seen: string | null;
  last_sync: string | null;
  last_ip: string;
  is_revoked: boolean;
  online: boolean;
}

export interface License {
  id: number;
  key: string;
  plan_code: string;
  plan_name: string;
  starts_at: string | null;
  ends_at: string | null;
  grace_days: number;
  status: string;
  status_label: string;
  suspended_reason: string;
  days_left: number | null;
}

export interface ClientDetail {
  id: number;
  company: string;
  manager: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  note: string;
  created_at: string | null;
  license: License | null;
  installations: Installation[];
  features: string[];
}

export interface AdminLogEntry {
  id: number;
  admin_name: string;
  client_name: string;
  action: string;
  old_value: string;
  new_value: string;
  created_at: string;
}

export interface Dashboard {
  clients: number;
  per_plan: Record<string, number>;
  active: number;
  expired: number;
  suspended: number;
  revoked: number;
  expiring_soon: number;
  online: number;
  offline: number;
  signups: { month: string; clients: number }[];
}

/** Colours of a licence status, shared by the console screens. */
export const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  suspended: "bg-amber-100 text-amber-700",
  expired: "bg-slate-200 text-slate-700",
  revoked: "bg-red-100 text-red-700",
  pending: "bg-sky-100 text-sky-700",
};

export function centralError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (!error.response) return "Serveur central injoignable";
  }
  return fallback;
}
