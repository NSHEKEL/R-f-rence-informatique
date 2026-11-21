import api from "../api/client";
import { apiErrorMessage } from "./apiErrors";
import type { Product, Sale } from "../types";

const CACHE_PREFIX = "ri_cache_";
const QUEUE_KEY = "ri_pending_sales";

export interface SalePayload {
  client_id: string;
  cash_session_id?: number;
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
    packaging_divisor?: number;
    price_tier?: "detail" | "semi_gros" | "gros" | "auto";
    product_id: number;
    quantity: number;
    packaging_quantity?: number;
    piece_quantity?: number;
    expected_units_per_packaging?: number;
    unit_price?: number;
    price_edited?: boolean;
    discount?: number;
  }[];
  /** Tender legs for a « Mixte » payment; must add up to the total. */
  payments?: { method: string; amount: number }[];
  /** Gift sale: articles offerts, excluded from revenue. */
  is_gift?: boolean;
}

export interface PendingSale {
  scope?: string;
  reason?: string;
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
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value, (field, data) => ["image", "photo", "logo"].includes(field) ? "" : data));
    localStorage.setItem(CACHE_PREFIX + key + "_at", new Date().toISOString());
  } catch {
    /* quota exceeded: the cache is best-effort */
  }
}

export function activeCatalogue<T extends { active?: boolean }>(products: T[]): T[] {
  return products.filter((product) => product.active !== false);
}

function catalogueData<T>(path: string, data: T): T {
  return ["/products", "/products/pos"].includes(path.split("?")[0]) && !/[?&]state=(all|inactive)(&|$)/.test(path) && Array.isArray(data)
    ? activeCatalogue(data) as T : data;
}

/** Fetches from the API, falling back to the last cached payload offline. */
export async function fetchCached<T>(
  path: string,
  key: string,
  overlay = true
): Promise<{ data: T; fromCache: boolean }> {
  try {
    const res = await api.get<T>(path, { timeout: 8000 });
    const data = catalogueData(path, res.data);
    cacheWrite(key, data);
    return { data: overlay ? pendingCatalogue(path, data) : data, fromCache: false };
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 401 || status === 403) throw err;
    const cached = cacheRead<T>(key);
    if (cached !== null) return { data: overlay ? pendingCatalogue(path, catalogueData(path, cached)) : catalogueData(path, cached), fromCache: true };
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
  writeQueue([...pendingSales(), { ...entry, scope: saleScope() }]);
}

function saleScope(): string {
  let user = "local";
  try { user = String(JSON.parse(localStorage.getItem("ri_auth_cache") || "{}").user?.id || user); } catch { /* no cached login */ }
  try {
    const token = localStorage.getItem("ri_token");
    if (token) user = String(JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || user);
  } catch { /* cached identity remains available offline */ }
  return `${localStorage.getItem("ri_server_url") || "local"}:${user}`;
}

export function newClientId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface SyncResult {
  synced: number;
  rejected: string[];
}

export type ProductPayload = Omit<Product, "id" | "created_at" | "category" | "supplier" | "sold_quantity" | "last_sold_at"> & {
  client_uuid: string;
  initial_expiry_date?: string | null;
};

export interface PendingProduct {
  payload: ProductPayload;
  updated_at: string;
  reason: string;
  attempted?: boolean;
  product_id?: number;
  base?: Product;
  changes?: Record<string, unknown>;
  originals?: Record<string, unknown>;
  force?: boolean;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

const productUpdateFields = new Set([
  "barcodes", "rayon", "emplacement", "semi_wholesale_price", "supplier_purchase_price",
  "semi_wholesale_min_qty", "wholesale_min_qty", "packagings", "base_unit", "packaging_unit",
  "units_per_packaging", "packaging_sale_price", "wholesale_packaging_price", "name", "sku",
  "description", "category_id", "supplier_id", "purchase_price", "sale_price", "wholesale_price",
  "quantity", "min_stock", "qr_code", "barcode", "image",
]);

function updateFields(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([field]) => productUpdateFields.has(field)));
}

export function queueProductEdit(product: Product, payload: ProductPayload): void {
  const previous = pendingProducts().find((entry) => entry.product_id === product.id);
  if (previous?.attempted && !previous.reason) throw new Error("Envoi déjà tenté : réessayez sans modifier pour confirmer la modification sur le serveur.");
  const base = previous?.base || product;
  const changes: Record<string, unknown> = {}, originals: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(payload)) {
    if (!productUpdateFields.has(field)) continue;
    const original = base[field as keyof Product];
    if (canonical(value) !== canonical(original)) { changes[field] = value; originals[field] = original ?? null; }
  }
  const queue = pendingProducts().filter((entry) => entry.product_id !== product.id);
  if (Object.keys(changes).length) queue.push({ payload: { ...payload, client_uuid: newProductUuid() }, product_id: product.id, base, changes, originals, updated_at: new Date().toISOString(), reason: "" });
  writeProducts(productQueueKey(), queue);
}

export function pendingCatalogue<T>(path: string, data: T, queue = pendingProducts()): T {
  if (!["/products", "/products/pos"].includes(path.split("?")[0]) || !Array.isArray(data)) return data;
  const updates = queue.filter((entry) => entry.product_id != null);
  return data.map((product: Product) => {
    const entry = updates.find((item) => item.product_id === product.id);
    return entry ? { ...product, ...entry.changes } : product;
  }) as T;
}

export function retryPendingProduct(clientUuid: string, force = false): void {
  writeProducts(productQueueKey(), pendingProducts().map((entry) => entry.payload.client_uuid !== clientUuid ? entry : {
    ...entry, reason: "", ...(force && entry.product_id != null ? { force: true, attempted: false, payload: { ...entry.payload, client_uuid: newProductUuid() } } : {}),
  }));
}

function productQueueKey(): string {
  let user = "local";
  try { user = String(JSON.parse(localStorage.getItem("ri_auth_cache") || "{}").user?.id || user); } catch { /* no cached login */ }
  return `ri_pending_products:${localStorage.getItem("ri_server_url") || "local"}:${user}`;
}

function readProducts(key: string): PendingProduct[] {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) as PendingProduct[] : [];
}

function writeProducts(key: string, entries: PendingProduct[]): void {
  try { localStorage.setItem(key, JSON.stringify(entries)); }
  catch { throw new Error("Stockage local plein ou indisponible : libérez de l'espace avant d'enregistrer."); }
  window.dispatchEvent(new Event("ri:queue"));
}

export function pendingProducts(): PendingProduct[] {
  try { return readProducts(productQueueKey()); } catch { return []; }
}

export function pendingProductMatches(entry: PendingProduct, query: string): boolean {
  const product = entry.payload, text = query.trim().toLowerCase();
  return [product.name, product.sku, product.barcode, product.qr_code,
    ...(product.barcodes || []).filter((code) => code.active).map((code) => code.code),
    ...(product.packagings || []).filter((pack) => pack.active).map((pack) => pack.barcode || ""),
  ].some((value) => value.toLowerCase().includes(text));
}

export function newProductUuid(): string {
  return globalThis.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const value = Math.floor(Math.random() * 16);
    return (c === "x" ? value : (value & 3) | 8).toString(16);
  });
}

export function queueProduct(payload: ProductPayload): void {
  const key = productQueueKey();
  const entries = readProducts(key), previous = entries.find((entry) => entry.payload.client_uuid === payload.client_uuid);
  if (previous?.attempted && !previous.reason && JSON.stringify(previous.payload) !== JSON.stringify(payload)) {
    throw new Error("Envoi déjà tenté : réessayez sans modifier pour confirmer la création sur le serveur.");
  }
  writeProducts(key, [...entries.filter((entry) => entry.payload.client_uuid !== payload.client_uuid), {
    payload, updated_at: new Date().toISOString(), reason: "", attempted: previous?.attempted && !previous.reason,
  }]);
}

export function discardPendingProduct(uuid: string): void {
  const key = productQueueKey();
  writeProducts(key, readProducts(key).filter((entry) => entry.payload.client_uuid !== uuid));
}

const productSyncs = new Map<string, Promise<SyncResult>>();

export function flushPendingProducts(): Promise<SyncResult> {
  const key = productQueueKey(), running = productSyncs.get(key);
  if (running) return running;
  const operation = (async () => {
    const result: SyncResult = { synced: 0, rejected: [] };
    for (const entry of readProducts(key)) {
      if (entry.reason) continue;
      let reason = "";
      writeProducts(key, readProducts(key).map((current) => current.payload.client_uuid === entry.payload.client_uuid ? { ...current, attempted: true } : current));
      try {
        if (entry.product_id != null) {
          const changes = updateFields(entry.changes || {});
          if (Object.keys(changes).length) await api.post<Product>(`/products/${entry.product_id}/offline-update`, { operation_id: entry.payload.client_uuid, changes, originals: updateFields(entry.originals || {}), force: entry.force || false });
        } else {
          await api.post<Product>("/products", entry.payload);
        }
        result.synced++;
      }
      catch (error) {
        const response = (error as { response?: { status?: number; data?: { detail?: unknown } } }).response;
        if (!response?.status || response.status >= 500) break;
        reason = apiErrorMessage(response.data?.detail, "Produit refusé par le serveur");
        result.rejected.push(`${entry.payload.sku} : ${reason}`);
      }
      const same = (current: PendingProduct) => current.payload.client_uuid === entry.payload.client_uuid && current.updated_at === entry.updated_at && JSON.stringify(current.payload) === JSON.stringify(entry.payload);
      writeProducts(key, readProducts(key).flatMap((current) => same(current) ? reason ? [{ ...current, reason }] : [] : [current]));
    }
    return result;
  })();
  productSyncs.set(key, operation);
  void operation.finally(() => productSyncs.delete(key)).catch(() => {});
  return operation;
}

/**
 * Pushes the queued tickets. `client_id` makes the POST idempotent, so a
 * ticket that reached the server before the connection dropped is not
 * duplicated. Tickets refused by the server (e.g. stock sold meanwhile) are
 * dropped from the queue and reported.
 */
let saleSync: Promise<SyncResult> | null = null;

export function flushPendingSales(): Promise<SyncResult> {
  if (saleSync) return saleSync;
  saleSync = syncPendingSales().finally(() => { saleSync = null; });
  return saleSync;
}

async function syncPendingSales(): Promise<SyncResult> {
  const queue = pendingSales();
  if (queue.length === 0) return { synced: 0, rejected: [] };
  const scope = saleScope();

  const remaining: PendingSale[] = [];
  const rejected: string[] = [];
  let synced = 0;

  for (const entry of queue) {
    if (saleScope() !== scope || (entry.scope !== scope && (entry.scope || scope !== "local:local"))) {
      remaining.push({ ...entry, reason: entry.scope ? "Reconnectez le caissier au serveur d'origine pour synchroniser ce ticket." : "Ancien ticket hors ligne : faites vérifier son caissier et son serveur avant de le ressaisir." });
      continue;
    }
    if (!entry.payload.client_id) {
      entry.payload.client_id = newClientId();
      writeQueue(queue);
    }
    try {
      await api.post<Sale>("/sales", entry.payload, { timeout: 15000 });
      synced += 1;
    } catch (err) {
      if ((err as { response?: { data?: { code?: string } } }).response?.data?.code === "workstation_not_authorized") {
        remaining.push({ ...entry, reason: "Poste non autorisé : demandez l'autorisation à l'administrateur." });
        continue;
      }
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      if (status && status >= 400 && status < 500 && ![401, 408, 425, 429].includes(status)) {
        const detail = (
          err as { response?: { data?: { detail?: unknown } } }
        ).response?.data?.detail;
        const reason = apiErrorMessage(detail, "refusé par le serveur");
        rejected.push(`${entry.snapshot.reference} : ${reason}`);
        writeRejected([
          ...rejectedSales(),
          { ...entry, reason, rejected_at: new Date().toISOString() },
        ]);
      } else {
        remaining.push({ ...entry, reason: status === 401 ? "Reconnectez le caissier pour synchroniser ce ticket." : "Serveur indisponible : ticket conservé, nouvel essai automatique." });
      }
    }
  }

  const attempted = new Set(queue.map((entry) => entry.payload.client_id));
  writeQueue([...remaining, ...pendingSales().filter((entry) => !attempted.has(entry.payload.client_id))]);
  return { synced, rejected };
}
