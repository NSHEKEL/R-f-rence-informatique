import axios from "axios";

const SERVER_URL_KEY = "ri_server_url";

/**
 * Address of the shared server. Empty means "same origin", which covers both
 * the desktop package and workstations that simply open the server's address.
 * A poste can also point at a central server (e.g. http://192.168.1.20:8000).
 */
export const API_BASE = (
  localStorage.getItem(SERVER_URL_KEY) ??
  (import.meta.env.VITE_API_URL as string | undefined) ??
  ""
).replace(/\/+$/, "");

export function setServerUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean) localStorage.setItem(SERVER_URL_KEY, clean);
  else localStorage.removeItem(SERVER_URL_KEY);
}

const api = axios.create({
  baseURL: `${API_BASE}/api`,
});

api.interceptors.request.use((config) => {
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
