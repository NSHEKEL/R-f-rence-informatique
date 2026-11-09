import { useCallback, useEffect, useRef, useState } from "react";
import api, { formatDateTime } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { exportCsv } from "../lib/exportCsv";
import { printDocument } from "../lib/print";
import { INVENTORY_STATS, inventoryTable, reportHtml, type InventoryHeader, type InventoryReport, type InventoryRow } from "../lib/inventoryReport";
import PackagingQuantity from "./PackagingQuantity";
import { depotScope, useDepots } from "../lib/depots";

const STATUS: Record<string, string> = { draft: "Brouillon", in_progress: "En cours", validated: "Validé", cancelled: "Annulé" };
const SCOPES: Record<string, string> = { general: "Général", category: "Catégorie", rayon: "Rayon", emplacement: "Emplacement", selection: "Sélection d'articles", depot: "Dépôt" };
type SaveCount = (productId: number, payload: object) => Promise<void>;

function CountEditor({ row, save }: { row: InventoryRow; save: SaveCount }) {
  const [value, setValue] = useState(row.physical_qty === null ? "" : String(row.physical_qty));
  const [note, setNote] = useState(row.note);
  const [packagingId, setPackagingId] = useState(0);
  const [message, setMessage] = useState("");
  const dirty = useRef(false);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!dirty.current) { setValue(row.physical_qty === null ? "" : String(row.physical_qty)); setNote(row.note); }
  }, [row.physical_qty, row.note]);
  useEffect(() => () => { clearTimeout(timer.current); pending.current?.(); }, []);
  function update(next: string, nextNote: string) {
    setValue(next); setNote(nextNote); dirty.current = true;
    const version = ++revision.current;
    clearTimeout(timer.current);
    const quantity = next === "" ? null : Number(next);
    if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647)) { setMessage("Quantité entière positive requise"); pending.current = undefined; return; }
    const flush = () => {
      pending.current = undefined;
      setMessage("Enregistrement…");
      void save(row.product_id, { physical_qty: quantity, note: nextNote }).then(() => { if (version === revision.current) { dirty.current = false; setMessage("Enregistré"); } }).catch(() => setMessage("Échec : réessayez en modifiant la saisie"));
    };
    pending.current = flush;
    timer.current = setTimeout(flush, 500);
  }
  function blur() { clearTimeout(timer.current); pending.current?.(); }
  const packaging = row.packagings.find((pack) => pack.id === packagingId);
  return <div className="min-w-64 space-y-2" onBlur={blur}>
    <input aria-label={`Quantité physique ${row.sku}`} className="input" type="number" min={0} step={1} placeholder="Non compté" value={value} onChange={(e) => update(e.target.value, note)} />
    <select aria-label={`Conditionnement ${row.sku}`} className="input" value={packagingId} onChange={(e) => setPackagingId(Number(e.target.value))}><option value={0}>{row.packaging_unit || "Unité principale"} × {row.units_per_packaging}</option>{row.packagings.map((pack) => <option key={pack.id} value={pack.id}>{pack.name} × {pack.factor}</option>)}</select>
    <PackagingQuantity product={{ base_unit: row.base_unit, packaging_unit: packaging?.name || row.packaging_unit, units_per_packaging: packaging?.factor || row.units_per_packaging }} value={Number(value) || 0} onChange={(quantity) => update(String(quantity), note)} />
    <input aria-label={`Note ${row.sku}`} className="input" placeholder="Note de comptage" maxLength={4000} value={note} onChange={(e) => update(value, e.target.value)} />
    <span role="status" className="text-xs">{message}</span>
  </div>;
}

export default function InventorySessions() {
  const { depots, error: depotError } = useDepots();
  const { can } = useAuth();
  const [history, setHistory] = useState<InventoryHeader[]>([]);
  const [options, setOptions] = useState<{ products: { id: number; name: string; sku: string; rayon?: string | null; emplacement?: string | null }[]; categories: { id: number; name: string }[] }>({ products: [], categories: [] });
  const [current, setCurrent] = useState<InventoryReport | null>(null);
  const [filter, setFilter] = useState({ q: "", status: "", scope_type: "", start: "", end: "" });
  const [form, setForm] = useState({ name: "", scope_type: "general", value: "", blind: false, note: "" });
  const [code, setCode] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loadHistory = useCallback(async () => {
    try { const { data } = await api.get<InventoryHeader[]>("/inventory/sessions", { params: Object.fromEntries(Object.entries(filter).filter(([, value]) => value)) }); setHistory(data); }
    catch { setMessage("Historique indisponible."); }
  }, [filter]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { void api.get("/inventory/sessions/options").then(({ data }) => setOptions(data)).catch(() => setMessage("Liste du catalogue indisponible.")); }, []);
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId) return;
    const timer = setInterval(() => { void api.get<InventoryReport>(`/inventory/sessions/${currentId}`).then(({ data }) => setCurrent((previous) => previous?.id === data.id ? data : previous)).catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, [currentId]);
  function enqueue(path: string, payload: object, method: "post" | "put" = "post"): Promise<void> {
    const operation = queue.current.catch(() => {}).then(async () => {
      const { data } = await api[method]<InventoryReport>(path, payload);
      setCurrent((previous) => previous?.id === data.id ? data : previous);
    });
    queue.current = operation;
    return operation;
  }
  async function create() {
    setBusy(true); setMessage("");
    const scope = form.scope_type === "depot" ? depotScope(form.value) : form.scope_type === "category" ? { category_id: Number(form.value) } : form.scope_type === "selection" ? { product_ids: form.value.split(/[,;\s]+/).filter(Boolean).map(Number) } : form.scope_type === "general" ? {} : { [form.scope_type]: form.value };
    try { const { data } = await api.post<InventoryReport>("/inventory/sessions", { ...form, scope }); setCurrent(data); await loadHistory(); }
    catch { setMessage("Création impossible : vérifiez le nom et le périmètre (non vide)."); }
    finally { setBusy(false); }
  }
  async function transition(action: string) {
    if (!current) return;
    (document.activeElement as HTMLElement | null)?.blur();
    setBusy(true); setMessage("");
    try {
      await queue.current;
      if (action !== "start" && !window.confirm(action === "validate" ? "Valider définitivement ? Les articles non comptés resteront inchangés. Les ventes intervenues pendant le comptage seront préservées." : "Annuler définitivement cette session ?")) return;
      await enqueue(`/inventory/sessions/${current.id}/${action}`, {});
      await loadHistory();
    } catch { setMessage("Action refusée : droits, session déjà clôturée ou stock insuffisant. Rechargez pour vérifier."); }
    finally { setBusy(false); }
  }
  async function output(kind: string) {
    if (!current) return;
    try {
      await queue.current;
      const { data } = await api.get<InventoryReport>(`/inventory/sessions/${current.id}/report`);
      const { headers, rows } = inventoryTable(data);
      const title = `${data.reference} — ${data.name} — ${STATUS[data.status]} — ${data.scope?.depot_name || "Tous dépôts (écart au principal)"}`;
      const summary: (string | number)[][] = [["Session", data.reference], ["Créé par", data.created_by_name], ["Créé le", formatDateTime(data.created_at)], ...(data.validated_at ? [["Validé par", data.validated_by_name || ""], ["Validé le", formatDateTime(data.validated_at)]] : []), ...Object.entries(data.stats).map(([key, value]) => [INVENTORY_STATS[key] || key, value])];
      let destination: string | boolean;
      if (kind === "excel") destination = await exportCsv(data.reference, headers, [...rows, [], ...summary]);
      else if (kind === "pdf") { const { exportReportPdf } = await import("../lib/reportPdf"); destination = await exportReportPdf(data.reference, title, headers, [...rows, [], ...summary]); }
      else destination = await printDocument(title, "@page{size:A4 landscape}body{font:10px Arial}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px}thead{display:table-header-group}", reportHtml(title, headers, rows) + reportHtml("Synthèse", ["Indicateur", "Valeur"], summary));
      setMessage(destination ? "Export / impression transmis." : "Export / impression annulé.");
    } catch { setMessage("Export impossible ou enregistrement en échec."); }
  }
  const open = current && ["draft", "in_progress"].includes(current.status);
  const table = current ? inventoryTable({ ...current, rows: current.rows.filter((row) => `${row.sku} ${row.name}`.toLowerCase().includes(search.toLowerCase())) }) : null;
  return <section className="card space-y-4 p-5">
    <h2 className="text-xl font-bold">Sessions d'inventaire</h2>
    <p>Comptage partagé et sauvegardé automatiquement. Le stock n'est ajusté qu'à la validation. Les brouillons prennent leur stock de référence au démarrage.</p>
    <p className="text-sm">Hors périmètre Dépôt, le théorique inclut tous les dépôts et l'écart est appliqué au principal uniquement.</p>
    {depotError && <p role="status">{depotError}</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <input aria-label="Nom de session" className="input" placeholder="Nom de l'inventaire" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <select aria-label="Périmètre" className="input" value={form.scope_type} onChange={(e) => setForm({ ...form, scope_type: e.target.value, value: "" })}>{Object.entries(SCOPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {form.scope_type === "category" && <select aria-label="Catégorie du périmètre" className="input" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}><option value="">Choisir une catégorie</option>{options.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>}
      {form.scope_type === "depot" && <select aria-label="Dépôt du périmètre" className="input" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}><option value="">Choisir un dépôt</option>{depots.filter((depot) => depot.active).map((depot) => <option key={depot.id} value={depot.id}>{depot.name}</option>)}</select>}
      {form.scope_type === "selection" && <label className="label">Articles (sélection multiple)<select aria-label="Articles du périmètre" className="input" multiple value={form.value ? form.value.split(",") : []} onChange={(e) => setForm({ ...form, value: Array.from(e.target.selectedOptions).map((option) => option.value).join(",") })}>{options.products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>)}</select></label>}
      {(form.scope_type === "rayon" || form.scope_type === "emplacement") && <><input aria-label="Valeur du périmètre" className="input" placeholder="Nom exact" list="inventory-locations" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /><datalist id="inventory-locations">{[...new Set(options.products.map((product) => form.scope_type === "rayon" ? product.rayon : product.emplacement).filter(Boolean))].map((value) => <option key={value} value={value || ""} />)}</datalist></>}
      <label><input type="checkbox" checked={form.blind} onChange={(e) => setForm({ ...form, blind: e.target.checked })} /> Comptage aveugle</label>
      <input aria-label="Note de session" className="input" placeholder="Note de session" maxLength={4000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      <button className="btn-primary" disabled={busy || !form.name.trim()} onClick={() => void create()}>Créer un brouillon</button>
    </div>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Rechercher une session" className="input w-48" placeholder="Référence / nom" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
      <select aria-label="Statut des sessions" className="input w-40" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">Tous les statuts</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Filtrer le périmètre" className="input w-40" value={filter.scope_type} onChange={(e) => setFilter({ ...filter, scope_type: e.target.value })}><option value="">Tous les périmètres</option>{Object.entries(SCOPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input aria-label="Sessions depuis" type="date" className="input w-40" value={filter.start} onChange={(e) => setFilter({ ...filter, start: e.target.value })} /><input aria-label="Sessions jusqu'au" type="date" className="input w-40" value={filter.end} onChange={(e) => setFilter({ ...filter, end: e.target.value })} />
      <button className="btn-secondary" onClick={() => void loadHistory()}>Actualiser</button>
    </div>
    <div className="max-h-48 overflow-auto">{history.length === 0 && <p>Aucune session.</p>}{history.map((session) => <button className="block w-full border-b p-2 text-left" key={session.id} onClick={async () => { try { await queue.current; const { data } = await api.get<InventoryReport>(`/inventory/sessions/${session.id}`); setCurrent(data); } catch { setMessage("Session indisponible ou saisie non enregistrée."); } }}>{session.reference} — {session.name} — {STATUS[session.status]} — {session.created_by_name} {formatDateTime(session.created_at)}{session.validated_at && ` — Validé par ${session.validated_by_name} le ${formatDateTime(session.validated_at)}`}</button>)}</div>
    {current && table && <div className="space-y-3">
      <h3 className="font-bold">{current.reference} — {current.name} — {STATUS[current.status]}</h3>
      <p>{current.scope?.depot_name ? `Dépôt : ${current.scope.depot_name}` : "Tous dépôts — écart appliqué au principal"}</p>
      <p>{current.note}</p>
      {current.blind && !current.theoretical_visible && <p>Mode aveugle : le serveur masque le théorique, les écarts et les valeurs.</p>}
      {current.validated_at && <p>Validé par {current.validated_by_name} le {formatDateTime(current.validated_at)}</p>}
      <div className="flex flex-wrap gap-2">{Object.entries(current.stats).map(([key, value]) => <span className="rounded bg-slate-100 p-2 text-xs" key={key}>{INVENTORY_STATS[key] || key} : {value}</span>)}</div>
      <div className="flex flex-wrap gap-2">
        {current.status === "draft" && <button disabled={busy} className="btn-secondary" onClick={() => void transition("start")}>Démarrer le comptage</button>}
        {open && <><button className="btn-primary" disabled={busy || !can("inventaire_valider")} onClick={() => void transition("validate")}>Valider définitivement</button><button className="btn-danger" disabled={busy || !can("inventaire_valider")} onClick={() => void transition("cancel")}>Annuler la session</button></>}
        <button className="btn-secondary" onClick={() => void output("print")}>Imprimer</button><button className="btn-secondary" onClick={() => void output("excel")}>Excel</button><button className="btn-secondary" onClick={() => void output("pdf")}>PDF</button>
      </div>
      {open && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!code.trim()) return; void enqueue(`/inventory/sessions/${current.id}/scan`, { code }).then(() => setCode("")).catch(() => setMessage("Code inconnu, hors périmètre ou session clôturée.")); }}><input className="input" aria-label="Scanner inventaire" placeholder="Code produit ou conditionnement + Entrée" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn-secondary">Ajouter le scan</button></form>}
      <input className="input" aria-label="Rechercher dans le comptage" placeholder="Rechercher un article" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{table.headers.map((header) => <th className="p-2" key={header}>{header}</th>)}{open && <th>Saisie / conditionnements</th>}</tr></thead><tbody>{table.rows.map((values, index) => {
        const row = current.rows.filter((r) => `${r.sku} ${r.name}`.toLowerCase().includes(search.toLowerCase()))[index];
        return <tr className="border-t" key={row.product_id}>{values.map((value, column) => <td className="p-2" key={column}>{value}</td>)}{open && <td className="p-2"><CountEditor key={`${current.id}-${row.product_id}`} row={row} save={(productId, payload) => enqueue(`/inventory/sessions/${current.id}/counts/${productId}`, payload, "put")} /></td>}</tr>;
      })}</tbody></table></div>
    </div>}
    <p role="status">{message}</p>
  </section>;
}
