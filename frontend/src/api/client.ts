import axios from "axios";
import { desktopOffline } from "../lib/desktopOffline";

const SERVER_URL_KEY = "ri_server_url";

/**
 * Address of the shared server. Empty means "same origin", which covers both
 * the desktop package and workstations that simply open the server's address.
 * A poste can also point at a central server (e.g. http://192.168.1.20:8000).
 */
const DEFAULT_PORT = "8000";

/**
 * Accepts what a shop actually types: "192.168.1.20", "192.168.1.20:8000"
 * or a full URL, and turns it into "http://192.168.1.20:8000".
 */
export function normalizeServerUrl(url: string): string {
  let value = url.trim().replace(/\/+$/, "");
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const parsed = new URL(value);
    if (!parsed.port && parsed.protocol === "http:") parsed.port = DEFAULT_PORT;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

export function getServerUrl(): string {
  return (
    localStorage.getItem(SERVER_URL_KEY) ??
    (import.meta.env.VITE_API_URL as string | undefined) ??
    ""
  ).replace(/\/+$/, "");
}

/** Kept for call sites that only display the configured address. */
export const API_BASE = getServerUrl();

/**
 * Identify what answers at an address the user typed as "server": a shop
 * backend (EasyGest server poste), the hosted central console — a common
 * mix-up that makes every call fail with HTTP 405 — or nothing at all.
 */
export async function probeServer(
  base: string
): Promise<{ kind: "shop"; app: string } | { kind: "central" } | { kind: "down" }> {
  try {
    const res = await axios.get<{ app: string }>(`${base}/api/health`, {
      timeout: 5000,
    });
    return { kind: "shop", app: res.data.app || "EasyGest" };
  } catch {
    // not a shop server — maybe the hosted central console?
  }
  try {
    await axios.get(`${base}/api/central/health`, { timeout: 5000 });
    return { kind: "central" };
  } catch {
    return { kind: "down" };
  }
}

export function setServerUrl(url: string): void {
  const clean = normalizeServerUrl(url);
  if (clean) localStorage.setItem(SERVER_URL_KEY, clean);
  else localStorage.removeItem(SERVER_URL_KEY);
}

const api = axios.create();

// Resolved per request so a new server address applies without a reload.
api.interceptors.request.use((config) => {
  config.baseURL = `${getServerUrl()}/api`;
  let workstation = localStorage.getItem("ri_workstation_id");
  if (!workstation) {
    workstation = `poste-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("ri_workstation_id", workstation);
  }
  config.headers["X-Workstation-Name"] = workstation;
  const token = localStorage.getItem("ri_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (desktopOffline.available()) {
    const state = desktopOffline.state();
    const path = (config.url || "").split("?")[0];
    const method = (config.method || "get").toUpperCase();
    const cash = path.startsWith("/cash-sessions");
    const cached = ["/auth/me", "/permissions/me", "/settings/company", "/settings/printing", "/settings/pos-display", "/categories", "/license"].includes(path);
    if (!state.locked && ((cash && (state.journal_session || !state.online)) || (cached && !state.online) || (path === "/accounting/expenses" && method === "POST" && !state.online))) {
      config.headers["X-Easygest-Journal"] = "1";
      config.adapter = async () => ({ data: await desktopOffline.command("request", { method, path, data: typeof config.data === "string" ? JSON.parse(config.data) : config.data }), status: 200, statusText: "OK", headers: {}, config });
    }
    if (state.locked && !state.online && ["/auth/me", "/permissions/me"].includes(path)) {
      config.timeout = 800;
    } else if (!state.online) config.timeout = Math.min(config.timeout || 1500, 1500);
  }
  return config;
});

api.interceptors.response.use(
  async (response) => {
    if (desktopOffline.available() && !desktopOffline.state().locked && response.config.method === "get" && response.config.headers["X-Easygest-Journal"] !== "1") {
      await desktopOffline.command("remember", { path: response.config.url || "", data: response.data, access_token: String(response.config.headers.Authorization || "").replace(/^Bearer /, "") }).catch(() => {});
    }
    return response;
  },
  async (error) => {
    if (desktopOffline.available() && !error.response && !desktopOffline.state().locked) {
      const path = error.config?.url || "";
      if (path.startsWith("/cash-sessions") || ((error.config?.method || "get").toLowerCase() === "get")) {
        const data = await desktopOffline.command("request", { method: (error.config?.method || "get").toUpperCase(), path, data: error.config?.data ? JSON.parse(error.config.data) : undefined });
        await desktopOffline.refresh();
        return { data, status: 200, statusText: "OK", headers: {}, config: error.config };
      }
    }
    if (error.response?.status === 401) {
      localStorage.removeItem("ri_token");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;

/**
 * Calls served by the computer in front of the user, whatever central server
 * holds the data: updating EasyGest replaces the program installed here.
 */
export const localApi = axios.create();

/**
 * Same origin inside the EasyGest window (it is served by this computer);
 * otherwise the loopback address, so a page opened from the central server
 * still updates the workstation in front of the user.
 */
export function localBaseUrl(): string {
  const { hostname, origin, port } = window.location;
  if (["127.0.0.1", "::1", "[::1]", "localhost"].includes(hostname)) return `${origin}/api`;
  return `http://127.0.0.1:${port || DEFAULT_PORT}/api`;
}

localApi.interceptors.request.use((config) => {
  config.baseURL = localBaseUrl();
  if (["/settings/printers", "/settings/printers/diagnose"].includes(config.url || "")) config.timeout = 5000;
  const token = localStorage.getItem("ri_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function formatMoney(value: number | null | undefined, currency = "FCFA"): string {
  if (value == null) return "—";
  return (
    new Intl.NumberFormat("fr-FR", {
      style: "decimal",
      maximumFractionDigits: 0,
    }).format(value) +
    " " +
    currency
  );
}

export function formatXOF(value: number | null | undefined): string {
  return formatMoney(value);
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** "23/07/2026 à 10:53" — used wherever the hour matters (receipts, sales). */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${formatDate(value)} à ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
