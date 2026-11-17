import { useCallback, useEffect, useRef, useState } from "react";
import api, { formatDateTime } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { exportCsv } from "../lib/exportCsv";
import { printDocument } from "../lib/print";
import { INVENTORY_STATS, inventoryTable, reportHtml, type InventoryHeader, type InventoryReport } from "../lib/inventoryReport";
import InventoryGrid, { type InventoryGridHandle } from "./InventoryGrid";
import { depotScope, useDepots } from "../lib/depots";
import { lastSession, readOffline, readSession, rememberSession, syncCounts } from "../lib/offlineInventory";
import { useOnline } from "../lib/useOnline";
import OfflineBanner from "./OfflineBanner";

const STATUS: Record<string, string> = { draft: "Brouillon", in_progress: "En cours", validated: "Validé", cancelled: "Annulé" };
const SCOPES: Record<string, string> = { general: "Général", category: "Catégorie", rayon: "Rayon", emplacement: "Emplacement", selection: "Sélection d'articles", depot: "Dépôt" };

export default function InventorySessions() {
  const { depots, error: depotError } = useDepots();
  const { can } = useAuth();
  const online = useOnline();
  const [cached, setCached] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const offline = !online || cached;
  const [history, setHistory] = useState<InventoryHeader[]>([]);
  const [options, setOptions] = useState<{ products: { id: number; name: string; sku: string; rayon?: string | null; emplacement?: string | null }[]; categories: { id: number; name: string }[] }>({ products: [], categories: [] });
  const [current, setCurrent] = useState<InventoryReport | null>(null);
  const [filter, setFilter] = useState({ q: "", status: "", scope_type: "", start: "", end: "" });
  const [form, setForm] = useState({ name: "", scope_type: "general", value: "", blind: false, note: "" });
  const [code, setCode] = useState("");
  const grid = useRef<InventoryGridHandle>(null);
  const selected = useRef(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loadHistory = useCallback(async () => {
    try { const { data } = await readOffline<InventoryHeader[]>(`/inventory/sessions?${new URLSearchParams(Object.fromEntries(Object.entries(filter).filter(([, value]) => value)))}`, `sessions:${JSON.stringify(filter)}`); setHistory(data); }
    catch { setMessage("Historique indisponible."); }
  }, [filter]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => {
    void readOffline<typeof options>("/inventory/sessions/options", "inventory-options").then(({ data }) => setOptions(data)).catch(() => setMessage("Liste du catalogue indisponible."));
    let alive = true;
    void lastSession().then(async (id) => { if (id) { const result = await readSession(id); if (alive && !selected.current) { setCurrent(result.data); setCached(result.fromCache); setSavedAt(result.savedAt); } } }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId) return;
    let active = true;
    const refresh = async () => {
      try {
        const synced = await syncCounts(currentId);
        if (synced.error && active) setMessage(synced.error);
        const result = await readSession(currentId);
        if (active) { setCurrent((previous) => previous?.id === result.data.id ? result.data : previous); setCached(result.fromCache); setSavedAt(result.savedAt); }
      } catch { /* local pending counts remain durable */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [currentId, online]);
  function enqueue(path: string, payload: object, method: "post" | "put" = "post"): Promise<void> {
    const operation = queue.current.catch(() => {}).then(async () => {
      const { data } = await api[method]<InventoryReport>(path, payload);
      await rememberSession(data); setCached(false); setSavedAt(new Date().toISOString());
      setCurrent((previous) => previous?.id === data.id ? data : previous);
    });
    queue.current = operation;
    return operation;
  }
  async function create() {
    selected.current = true;
    setBusy(true); setMessage("");
    const scope = form.scope_type === "depot" ? depotScope(form.value) : form.scope_type === "category" ? { category_id: Number(form.value) } : form.scope_type === "selection" ? { product_ids: form.value.split(/[,;\s]+/).filter(Boolean).map(Number) } : form.scope_type === "general" ? {} : { [form.scope_type]: form.value };
    try { const { data } = await api.post<InventoryReport>("/inventory/sessions", { ...form, scope }); await rememberSession(data); setCurrent(data); setCached(false); setSavedAt(new Date().toISOString()); await loadHistory(); }
    catch { setMessage("Création impossible : vérifiez le nom et le périmètre (non vide)."); }
    finally { setBusy(false); }
  }
  async function transition(action: string) {
    if (!current) return;
    if (offline) { setMessage("Connexion au serveur requise pour démarrer, annuler ou valider une session."); return; }
    (document.activeElement as HTMLElement | null)?.blur();
    setBusy(true); setMessage("");
    try {
      await grid.current?.flush();
      const synced = await syncCounts(current.id);
      if (synced.pending) throw new Error("Comptages en attente de synchronisation");
      await queue.current;
      if (action === "validate") {
        const { data } = await api.get<InventoryReport>(`/inventory/sessions/${current.id}/report`);
        setCurrent(data);
        if (!window.confirm(`Valider définitivement ?\n${data.stats.counted} articles comptés ; ${data.stats.not_counted} non comptés.\n${data.theoretical_visible ? `Valeur totale des écarts : ${data.stats.variance_value}\n` : ""}Les non comptés resteront inchangés ; les mouvements intermédiaires seront préservés.`)) return;
      } else if (action === "cancel" && !window.confirm("Annuler définitivement cette session ?")) return;
      await enqueue(`/inventory/sessions/${current.id}/${action}`, {});
      await loadHistory();
    } catch { setMessage("Action refusée : droits, session déjà clôturée ou stock insuffisant. Rechargez pour vérifier."); }
    finally { setBusy(false); }
  }
  async function output(kind: string) {
    if (!current) return;
    try {
      await grid.current?.flush();
      await queue.current;
      if (kind === "grid") {
        const { data } = await api.get<{ headers: string[]; rows: (string | number)[][] }>(`/inventory/sessions/${current.id}/grid-export`);
        const saved = await exportCsv(`${current.reference}-grille`, data.headers, data.rows);
        setMessage(saved ? "Grille Excel exportée." : "Export annulé."); return;
      }
      const { data } = await readSession(current.id);
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
  async function importGrid(file: File) {
    if (!current) return;
    setBusy(true);
    try {
      await grid.current?.flush();
      const body = new FormData(); body.append("file", file);
      const { data } = await api.post<{ updated: number; errors: { line: number; message: string }[]; report: InventoryReport }>(`/inventory/sessions/${current.id}/grid-import`, body);
      await rememberSession(data.report); setCurrent(data.report);
      setMessage(`${data.updated} ligne(s) importée(s). ${data.errors.length} erreur(s). ${data.errors.map((error) => `Ligne ${error.line} : ${error.message}`).join(" ; ")}`);
    } catch { setMessage("Import impossible : vérifiez le fichier exporté et les saisies non enregistrées."); }
    finally { setBusy(false); }
  }
  return <section className="card space-y-4 p-5">
    <h2 className="text-xl font-bold">Inventaire physique — sessions</h2>
    <OfflineBanner visible={offline} since={savedAt} />
    {offline && <p>Comptages locaux autorisés pour une session déjà démarrée et chargée sur ce poste. Validation désactivée : connexion au serveur requise.</p>}
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
      <button className="btn-primary" disabled={busy || offline || !form.name.trim()} onClick={() => { void grid.current?.flush().then(create).catch(() => setMessage("Enregistrez les saisies avant de changer de session.")); if (!grid.current) void create(); }}>Créer un brouillon</button>
    </div>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Rechercher une session" className="input w-48" placeholder="Référence / nom" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
      <select aria-label="Statut des sessions" className="input w-40" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">Tous les statuts</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Filtrer le périmètre" className="input w-40" value={filter.scope_type} onChange={(e) => setFilter({ ...filter, scope_type: e.target.value })}><option value="">Tous les périmètres</option>{Object.entries(SCOPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input aria-label="Sessions depuis" type="date" className="input w-40" value={filter.start} onChange={(e) => setFilter({ ...filter, start: e.target.value })} /><input aria-label="Sessions jusqu'au" type="date" className="input w-40" value={filter.end} onChange={(e) => setFilter({ ...filter, end: e.target.value })} />
      <button className="btn-secondary" onClick={() => void loadHistory()}>Actualiser</button>
    </div>
    <div className="max-h-48 overflow-auto">{history.length === 0 && <p>Aucune session.</p>}{history.map((session) => <button disabled={busy} className="block w-full border-b p-2 text-left" key={session.id} onClick={async () => { selected.current = true; try { await grid.current?.flush(); await queue.current; const result = await readSession(session.id); setCurrent(result.data); setCached(result.fromCache); setSavedAt(result.savedAt); if (!result.fromCache) await rememberSession(result.data); } catch { setMessage("Session indisponible ou saisie non enregistrée."); } }}>{session.reference} — {session.name} — {STATUS[session.status]} — {session.created_by_name} {formatDateTime(session.created_at)}{session.validated_at && ` — Validé par ${session.validated_by_name} le ${formatDateTime(session.validated_at)}`}</button>)}</div>
    {current && <div className="space-y-3">
      <h3 className="font-bold">{current.reference} — {current.name} — {STATUS[current.status]}</h3>
      <p>{current.scope?.depot_name ? `Dépôt : ${current.scope.depot_name}` : "Tous dépôts — écart appliqué au principal"}</p>
      <p>{current.note}</p>
      {current.blind && !current.theoretical_visible && <p>Mode aveugle : le serveur masque le théorique, les écarts et les valeurs.</p>}
      {current.validated_at && <p>Validé par {current.validated_by_name} le {formatDateTime(current.validated_at)}</p>}
      <div className="flex flex-wrap gap-2">{Object.entries(current.stats).map(([key, value]) => <span className="rounded bg-slate-100 p-2 text-xs" key={key}>{INVENTORY_STATS[key] || key} : {value}</span>)}</div>
      <div className="flex flex-wrap gap-2">
        {current.status === "draft" && <button disabled={busy || offline} className="btn-secondary" onClick={() => void transition("start")}>Démarrer le comptage</button>}
        {open && <><button className="btn-primary" disabled={busy || offline || !can("inventaire_valider")} onClick={() => void transition("validate")}>Valider définitivement</button><button className="btn-danger" disabled={busy || offline || !can("inventaire_valider")} onClick={() => void transition("cancel")}>Annuler la session</button></>}
        <button className="btn-secondary" onClick={() => void output("print")}>Imprimer</button><button className="btn-secondary" onClick={() => void output("excel")}>Excel</button><button className="btn-secondary" onClick={() => void output("pdf")}>PDF</button>
        <button className="btn-secondary" disabled={busy || offline} onClick={() => void output("grid")}>Exporter la grille Excel</button>
        {open && <label className="btn-secondary">Importer la grille<input className="hidden" type="file" accept=".xlsx,.xls,.csv" disabled={busy || offline} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importGrid(file); }} /></label>}
      </div>
      {!open && <p role="status" className="rounded border border-amber-500 bg-amber-50 p-3 text-amber-800">Session {STATUS[current.status].toLowerCase()} : consultation uniquement. Créez une nouvelle session ci-dessus pour saisir un nouveau comptage.</p>}
      {current.status === "draft" && <p className="text-sm">Saisissez directement les quantités : la première sauvegarde démarre le comptage. Hors ligne, démarrez d'abord la session en étant connecté au serveur.</p>}
      {open && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); grid.current?.scan(code); setCode(""); }}><input className="input" aria-label="Scanner inventaire" placeholder="Code produit / variante / conditionnement + Entrée" value={code} onChange={(event) => setCode(event.target.value)} /><button className="btn-secondary">Trouver le comptage</button></form>}
      <InventoryGrid key={current.id} ref={grid} report={current} editable={!!open && (current.status !== "draft" || !offline) && !busy} onSaved={(row, status) => setCurrent((previous) => previous?.id === current.id ? { ...previous, status, rows: previous.rows.map((old) => old.product_id === row.product_id ? row : old) } : previous)} />
    </div>}
    <p role="status">{message}</p>
  </section>;
}
