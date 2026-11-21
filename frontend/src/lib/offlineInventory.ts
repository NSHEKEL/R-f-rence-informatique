import api from "../api/client";
import { readAuthCache } from "./authCache";
import { apiErrorMessage } from "./apiErrors";
import { cacheRead, fetchCached, newClientId, pendingCatalogue } from "./offline";
import { inventoryTotal, type InventoryReport, type InventoryRow } from "./inventoryReport";

interface Snapshot<T> { data: T; savedAt: string }
export interface QueuedCount {
  product_id: number;
  counts: Record<string, number | null>;
  note: string;
  client_updated_at: string;
  client_id: string;
}
type Queue = Record<string, QueuedCount>;

function scope() {
  const token = localStorage.getItem("ri_token") || "";
  return `${localStorage.getItem("ri_server_url") || "same-origin"}:${readAuthCache(token)?.user.id || "anonymous"}`;
}
function key(name: string) { return `ri_inventory:${scope()}:${name}`; }
let database: Promise<IDBDatabase> | undefined;
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("easygest-offline", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
async function read<T>(name: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction("records").objectStore("records").get(name);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } catch { return JSON.parse(localStorage.getItem(name) || "null") ?? undefined; }
}
async function mutate<T>(name: string, change: (previous: T | undefined) => T): Promise<T> {
  let db: IDBDatabase;
  try { db = await open(); } catch {
    const next = change(JSON.parse(localStorage.getItem(name) || "null") ?? undefined);
    if (next === undefined) localStorage.removeItem(name); else localStorage.setItem(name, JSON.stringify(next)); return next;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("records", "readwrite"), store = transaction.objectStore("records");
    const request = store.get(name);
    let value: T;
    request.onsuccess = () => { try { value = change(request.result); if (value === undefined) store.delete(name); else store.put(value, name); } catch (error) { transaction.abort(); reject(error); } };
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Enregistrement local impossible"));
  });
}
function compact<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (field, value) => ["image", "photo", "logo"].includes(field) ? "" : value));
}
export async function readOffline<T>(path: string, name: string): Promise<Snapshot<T> & { fromCache: boolean }> {
  const snapshot = await readSnapshot<T>(path, name);
  return { ...snapshot, data: pendingCatalogue(path, snapshot.data) };
}

async function readSnapshot<T>(path: string, name: string): Promise<Snapshot<T> & { fromCache: boolean }> {
  const storageKey = key(`cache:${name}`);
  const cached = await read<Snapshot<T>>(storageKey);
  if (navigator.onLine === false && cached) return { ...cached, fromCache: true };
  try {
    const result = await fetchCached<T>(path, storageKey, false);
    if (result.fromCache) return { data: cached?.data ?? result.data, savedAt: cached?.savedAt || localStorage.getItem(`ri_cache_${storageKey}_at`) || "", fromCache: true };
    const snapshot = { data: compact(result.data), savedAt: new Date().toISOString() };
    await mutate(storageKey, () => snapshot);
    return { ...snapshot, data: result.data, fromCache: false };
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 401 || status === 403) throw error;
    const fallback = cached || (cacheRead<T>(storageKey) ? { data: cacheRead<T>(storageKey)!, savedAt: localStorage.getItem(`ri_cache_${storageKey}_at`) || "" } : null);
    if (fallback) return { ...fallback, fromCache: true };
    throw error;
  }
}
export async function pendingCounts(sessionId: number): Promise<Queue> { return await read<Queue>(key(`queue:${sessionId}`)) || {}; }
export function newerCount(left: Pick<QueuedCount, "client_updated_at" | "client_id">, right: Pick<QueuedCount, "client_updated_at" | "client_id">) {
  const leftTime = Date.parse(left.client_updated_at), rightTime = Date.parse(right.client_updated_at);
  return leftTime > rightTime || (leftTime === rightTime && left.client_id > right.client_id);
}
export function mergeCounts(report: InventoryReport, queue: Queue): InventoryReport {
  if (!["draft", "in_progress"].includes(report.status)) return report;
  const rows = report.rows.map((row) => {
    const local = queue[row.product_id];
    if (!local || (row.client_updated_at && !newerCount(local, { client_updated_at: row.client_updated_at, client_id: row.client_id || "" }))) return row;
    const total = inventoryTotal(local.counts, row);
    const variance = total === null || row.theoretical_qty === undefined ? null : total - row.theoretical_qty;
    return { ...row, ...local, physical_qty: total, variance, physical_value: total === null ? null : total * (row.unit_cost || 0), variance_value: variance === null ? null : variance * (row.unit_cost || 0) };
  });
  const stats = { ...report.stats, counted: rows.filter((row) => row.physical_qty !== null).length, not_counted: rows.filter((row) => row.physical_qty === null).length };
  if (report.theoretical_visible) {
    Object.assign(stats, { variance_value: rows.reduce((total, row) => total + (row.variance_value || 0), 0), physical_value: rows.reduce((total, row) => total + (row.physical_value || 0), 0), conforme: rows.filter((row) => row.variance === 0).length, manquant: rows.filter((row) => (row.variance ?? 0) < 0).length, excedent: rows.filter((row) => (row.variance ?? 0) > 0).length });
  }
  return { ...report, rows, stats };
}
export async function queueCount(sessionId: number, productId: number, counts: Record<string, number | null>, note: string): Promise<QueuedCount> {
  let client = localStorage.getItem("ri_inventory_client");
  if (!client) { client = newClientId(); localStorage.setItem("ri_inventory_client", client); }
  let entry: QueuedCount;
  await mutate<Queue>(key(`queue:${sessionId}`), (previous = {}) => {
    const timestamp = Math.max(Date.now(), Date.parse(previous[productId]?.client_updated_at || "") + 1 || 0);
    entry = { product_id: productId, counts, note, client_updated_at: new Date(timestamp).toISOString(), client_id: client! };
    return { ...previous, [productId]: entry };
  });
  window.dispatchEvent(new Event("ri:inventory"));
  return entry!;
}
const syncing = new Map<string, Promise<{ rows: InventoryRow[]; pending: number; error: string; status?: string }>>();
export function syncCounts(sessionId: number) {
  const queueKey = key(`queue:${sessionId}`);
  const owner = scope(), snapshotKey = key(`cache:session:${sessionId}`);
  const existing = syncing.get(queueKey); if (existing) return existing;
  const operation = (async () => {
    const rows: InventoryRow[] = []; let error = "", status: string | undefined;
    if (navigator.onLine !== false) {
      for (const entry of Object.values(await read<Queue>(queueKey) || {})) {
        if (scope() !== owner) break;
        try {
          const { data } = await api.put<InventoryReport>(`/inventory/sessions/${sessionId}/counts/${entry.product_id}?line_only=true`, entry, { timeout: 8000 });
          if (scope() !== owner) break;
          rows.push(data.rows[0]);
          status = data.status;
          await mutate<Queue>(queueKey, (queue = {}) => {
            const next = { ...queue };
            if (next[entry.product_id]?.client_updated_at === entry.client_updated_at && next[entry.product_id]?.client_id === entry.client_id) delete next[entry.product_id];
            return next;
          });
          await mutate<Snapshot<InventoryReport> | undefined>(snapshotKey, (snapshot) => snapshot ? { ...snapshot, data: { ...snapshot.data, rows: snapshot.data.rows.map((row) => row.product_id === entry.product_id ? data.rows[0] : row) } } : undefined);
        } catch (cause) {
          const detail = (cause as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
          error = `${apiErrorMessage(detail || cause, "Synchronisation indisponible ou session clôturée.")} Les comptages restent conservés sur ce poste.`; break;
        }
      }
    }
    const pending = Object.keys(await read<Queue>(queueKey) || {}).length;
    window.dispatchEvent(new Event("ri:inventory"));
    return { rows, pending, error, status };
  })();
  syncing.set(queueKey, operation);
  void operation.finally(() => { syncing.delete(queueKey); }).catch(() => {});
  return operation;
}
export async function readSession(sessionId: number) {
  const result = await readOffline<InventoryReport>(`/inventory/sessions/${sessionId}`, `session:${sessionId}`);
  return { ...result, data: mergeCounts(result.data, await pendingCounts(sessionId)) };
}

export async function rememberSession(report: InventoryReport) {
  await mutate(key(`cache:session:${report.id}`), () => ({ data: compact(report), savedAt: new Date().toISOString() }));
  await mutate(key("last-session"), () => report.id);
}
export async function lastSession() { return read<number>(key("last-session")); }
