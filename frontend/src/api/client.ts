import axios from "axios";

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

export function setServerUrl(url: string): void {
  const clean = normalizeServerUrl(url);
  if (clean) localStorage.setItem(SERVER_URL_KEY, clean);
  else localStorage.removeItem(SERVER_URL_KEY);
}

const api = axios.create();

// Resolved per request so a new server address applies without a reload.
api.interceptors.request.use((config) => {
  config.baseURL = `${getServerUrl()}/api`;
  const token = localStorage.getItem("ri_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
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

export function formatMoney(value: number, currency = "FCFA"): string {
  return (
    new Intl.NumberFormat("fr-FR", {
      style: "decimal",
      maximumFractionDigits: 0,
    }).format(value) +
    " " +
    currency
  );
}

export function formatXOF(value: number): string {
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
