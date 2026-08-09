import api from "../api/client";
import type { Sale } from "../types";

const CACHE_PREFIX = "ri_cache_";
const QUEUE_KEY = "ri_pending_sales";

export interface SalePayload {
  client_id: string;
  customer_id: number | null;
  payment_method: string;
  status: string;
  price_mode: string;
  note: string;
  items: { product_id: number; quantity: number }[];
}

export interface PendingSale {
  payload: SalePayload;
  /** Receipt built locally so the cashier can print before the sync. */
  snapshot: Sale;
}

/** Last successful server response for a screen, replayed when offline. */
export function cacheRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function cacheWrite<T>(key: string, value: T): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota exceeded: the cache is best-effort */
  }
}

/** Fetches from the API, falling back to the last cached payload offline. */
export async function fetchCached<T>(
  path: string,
  key: string
): Promise<{ data: T; fromCache: boolean }> {
  try {
    const res = await api.get<T>(path);
    cacheWrite(key, res.data);
    return { data: res.data, fromCache: false };
  } catch (err) {
    const cached = cacheRead<T>(key);
    if (cached !== null) return { data: cached, fromCache: true };
    throw err;
  }
}

export function pendingSales(): PendingSale[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingSale[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingSale[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event("ri:queue"));
}

export function queueSale(entry: PendingSale): void {
  writeQueue([...pendingSales(), entry]);
}

export function newClientId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface SyncResult {
  synced: number;
  rejected: string[];
}

/**
 * Pushes the queued tickets. `client_id` makes the POST idempotent, so a
 * ticket that reached the server before the connection dropped is not
 * duplicated. Tickets refused by the server (e.g. stock sold meanwhile) are
 * dropped from the queue and reported.
 */
export async function flushPendingSales(): Promise<SyncResult> {
  const queue = pendingSales();
  if (queue.length === 0) return { synced: 0, rejected: [] };

  const remaining: PendingSale[] = [];
  const rejected: string[] = [];
  let synced = 0;

  for (const entry of queue) {
    try {
      await api.post<Sale>("/sales", entry.payload);
      synced += 1;
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      if (status && status >= 400 && status < 500) {
        const detail = (
          err as { response?: { data?: { detail?: string } } }
        ).response?.data?.detail;
        rejected.push(
          `${entry.snapshot.reference} : ${detail ?? "refusé par le serveur"}`
        );
      } else {
        remaining.push(entry);
      }
    }
  }

  writeQueue(remaining);
  return { synced, rejected };
}
