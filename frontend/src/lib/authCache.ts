import type { User } from "../types";

const KEY = "ri_auth_cache";
export function authDenied(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === 403;
}
export function readAuthCache(token: string): { user: User; rights: string[] } | null {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "null");
    return data?.token === token && data.user?.id && Array.isArray(data.rights) && data.rights.every((key: unknown) => typeof key === "string") ? data : null;
  } catch { return null; }
}
export function writeAuthCache(token: string, user: User, rights: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify({ token, user, rights })); } catch { /* storage unavailable */ }
}
export function clearAuthCache() { localStorage.removeItem(KEY); }
