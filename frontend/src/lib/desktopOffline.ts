import type { Product, Sale, User } from "../types";

export interface DesktopAccount {
  access_token: string;
  user: User;
  rights: string[];
  offline_ready?: boolean;
  fingerprint?: string;
  warning?: string;
  expires_at?: number;
}
export interface JournalState {
  online: boolean;
  locked: boolean;
  checking: boolean;
  journal_session: boolean;
  pending: { id: string; kind: string; state: string; reference: string; reason: string }[];
  last_synced: string | null;
  revoked?: boolean;
  synced?: number;
}

let nonce = "";
let local = false;
let unsupported = false;
let ready = false;
let serverAddress = () => localStorage.getItem("ri_server_url") || window.location.origin;
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
let state: JournalState = { online: true, locked: true, checking: false, journal_session: false, pending: [], last_synced: null };

function remoteApi() {
  try {
    const target = new URL(serverAddress() || window.location.origin);
    return target.hostname !== window.location.hostname && !localHosts.has(target.hostname.toLowerCase()) && !/^127\.\d+\.\d+\.\d+$/.test(target.hostname);
  } catch { return false; }
}

export class DesktopOfflineError extends Error {
  isAxiosError = true;
  response: { status: number; data: { detail: string } };
  constructor(status: number, message: string) {
    super(message);
    this.response = { status, data: { detail: message } };
  }
}

export async function initializeDesktopOffline(address?: () => string) {
  if (address) serverAddress = address;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
  try {
    const response = await fetch("/api/local-offline/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(1500) });
    if (response.status === 404) return;
    local = true;
    const result = await response.json();
    unsupported = result.supported === false;
    if (!response.ok || !result.supported) return;
    nonce = result.nonce;
    for (const host of result.local_hosts || []) localHosts.add(host.toLowerCase());
    ready = true;
    state.locked = result.locked;
    localStorage.setItem("ri_workstation_id", result.device_id);
    if (result.server && !localStorage.getItem("ri_server_url")) localStorage.setItem("ri_server_url", result.server);
  } catch { /* online use remains available; never fake a successful local write */ }
}

export const desktopOffline = {
  available: () => ready && remoteApi(),
  local: () => local,
  state: () => state,
  async recoverLocal(token: string) {
    if (!local || unsupported || remoteApi()) return;
    if (!ready) throw new DesktopOfflineError(507, "Journal local indisponible : ne rouvrez pas la caisse, vérifiez le profil Windows et relancez EasyGest");
    const response = await fetch("/api/local-offline/recover", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Easygest-Offline": nonce, Authorization: "Bearer " + token },
    });
    const result = await response.json();
    if (!response.ok) throw new DesktopOfflineError(response.status, typeof result.detail === "string" ? result.detail : "Récupération du journal local impossible : ne rouvrez pas la caisse");
  },
  async command<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!ready) throw new DesktopOfflineError(507, "Journal durable indisponible sur ce poste : vente hors ligne non validée");
    const response = await fetch("/api/local-offline/command", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Easygest-Offline": nonce },
      body: JSON.stringify({ action, params }), signal: AbortSignal.timeout(action === "sync" ? 30000 : 15000),
    });
    const result = await response.json();
    if (!response.ok) throw new DesktopOfflineError(response.status, typeof result.detail === "string" ? result.detail : "Opération locale impossible");
    return result as T;
  },
  async refresh(sync = false) {
    const next = await this.command<JournalState>(sync ? "sync" : "state");
    state = next;
    window.dispatchEvent(new CustomEvent("ri:offline-state", { detail: next }));
    return next;
  },
  async login(server: string, email: string, password: string, trusted_fingerprint?: string) {
    const result = await this.command<DesktopAccount>("login", { server, email, password, trusted_fingerprint });
    if (result.offline_ready) await this.importLegacy();
    await this.refresh();
    return result;
  },
  async importLegacy() {
    const keys = ["ri_pending_sales", "ri_rejected_sales"];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const entries = JSON.parse(raw);
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const result = await this.command<{ stored: number }>("import_legacy", { entries });
        if (result.stored === entries.length && localStorage.getItem(key) === raw) localStorage.removeItem(key);
      } catch { /* original file remains untouched until the durable import succeeds */ }
    }
  },
  async catalogue(images: boolean) {
    return this.command<{ data: Product[]; fromCache: boolean }>("catalogue", { images });
  },
  async sale(payload: unknown, snapshot: Sale) {
    const receipt = await this.command<Sale>("sale", { payload, snapshot });
    await this.refresh();
    window.dispatchEvent(new Event("ri:queue"));
    return receipt;
  },
};
