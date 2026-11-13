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
  /** Discount granted on the whole ticket. */
  discount: number;
  /** Cash handed over, used to print the change given back. */
  paid_amount: number;
  items: {
    scanned_code?: string | null;
    packaging_id?: number;
    price_tier?: "detail" | "semi_gros" | "gros" | "auto";
    product_id: number;
    quantity: number;
    packaging_quantity?: number;
    piece_quantity?: number;
    expected_units_per_packaging?: number;
    unit_price?: number;
    discount?: number;
  }[];
  /** Tender legs for a « Mixte » payment; must add up to the total. */
  payments?: { method: string; amount: number }[];
  /** Gift sale: articles offerts, excluded from revenue. */
  is_gift?: boolean;
}

export interface PendingSale {
  payload: SalePayload;
  /** Receipt built locally so the cashier can print before the sync. */
  snapshot: Sale;
}

export interface RejectedSale extends PendingSale {
  /** Why the server refused the ticket (HTTP detail). */
  reason: string;
  /** When the rejection happened (ISO). */
  rejected_at: string;
}

const REJECTED_KEY = "ri_rejected_sales";

/**
 * Tickets the server refused for good (4xx). They are moved out of the retry
 * queue but never dropped: the cashier sees them in the banner and re-rings
 * them manually, so a sale is never lost silently.
 */
export function rejectedSales(): RejectedSale[] {
  try {
    const raw = localStorage.getItem(REJECTED_KEY);
    return raw ? (JSON.parse(raw) as RejectedSale[]) : [];
  } catch {
    return [];
  }
}

function writeRejected(queue: RejectedSale[]): void {
  localStorage.setItem(REJECTED_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event("ri:queue"));
}

/** Cashier re-rang the ticket on a fresh sale: drop it from the reject list. */
export function dismissRejected(reference: string): void {
  writeRejected(rejectedSales().filter((r) => r.snapshot.reference !== reference));
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
  if (!entry.payload.client_id) entry.payload.client_id = newClientId();
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
    if (!entry.payload.client_id) {
      entry.payload.client_id = newClientId();
      writeQueue(queue);
    }
    try {
      await api.post<Sale>("/sales", entry.payload);
      synced += 1;
    } catch (err) {
      if ((err as { response?: { data?: { code?: string } } }).response?.data?.code === "workstation_not_authorized") {
        remaining.push(entry);
        continue;
      }
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      if (status && status >= 400 && status < 500) {
        const detail = (
          err as { response?: { data?: { detail?: unknown } } }
        ).response?.data?.detail;
        // A 422 body carries an array of {loc,msg,...} objects, not a string.
        const reason =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail
                  .map((d) =>
                    d && typeof d === "object" && "msg" in d
                      ? String((d as { msg: unknown }).msg)
                      : String(d)
                  )
                  .join("; ")
              : detail
                ? JSON.stringify(detail)
                : "refusé par le serveur";
        rejected.push(`${entry.snapshot.reference} : ${reason}`);
        writeRejected([
          ...rejectedSales(),
          { ...entry, reason, rejected_at: new Date().toISOString() },
        ]);
      } else {
        remaining.push(entry);
      }
    }
  }

  writeQueue(remaining);
  return { synced, rejected };
}
