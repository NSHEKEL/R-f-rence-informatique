import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { apiErrorMessage } from "../lib/apiErrors";
import { inventoryScan, inventoryTotal, inventoryUnits, type InventoryReport, type InventoryRow } from "../lib/inventoryReport";
import { mergeCounts, pendingCounts, queueCount, syncCounts } from "../lib/offlineInventory";
import { useOnline } from "../lib/useOnline";

export interface InventoryGridHandle {
  flush: () => Promise<void>;
  scan: (code: string) => void;
}
type Draft = { counts: Record<string, number | null>; note: string };

export default forwardRef<InventoryGridHandle, { report: InventoryReport; editable: boolean; onSaved: (row: InventoryRow, status: string) => void }>(function InventoryGrid({ report, editable, onSaved }, ref) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [page, setPage] = useState(0);
  const [revision, render] = useState(0);
  const [message, setMessage] = useState("");
  const [queued, setQueued] = useState(0);
  const online = useOnline();
  const [target, setTarget] = useState<{ id: number; key: string } | null>(null);
  const drafts = useRef(new Map<number, Draft>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<number, Promise<void>>());
  const errors = useRef(new Map<number, string>());
  const rows = report.rows.filter((row) => (!category || row.category === category) && (!supplier || row.supplier === supplier) && `${row.sku} ${row.name}`.toLowerCase().includes(search.toLowerCase()));
  const pageSize = 40;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  async function save(id: number): Promise<void> {
    clearTimeout(timers.current.get(id)); timers.current.delete(id);
    const previous = pending.current.get(id);
    const operation = (async () => {
      await previous?.catch(() => {});
      const draft = drafts.current.get(id);
      if (!draft) return;
      if (Object.values(draft.counts).some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647))) throw new Error("Quantité invalide");
      try {
        const row = report.rows.find((row) => row.product_id === id)!;
        const total = inventoryTotal(draft.counts, row);
        if (total !== null && (!Number.isSafeInteger(total) || total > 2147483647)) throw new Error("Quantité trop grande");
        const entry = await queueCount(report.id, id, draft.counts, draft.note);
        onSaved(mergeCounts({ ...report, rows: [row] }, { [id]: entry }).rows[0], report.status);
        if (drafts.current.get(id) === draft) drafts.current.delete(id);
        errors.current.delete(id);
        const result = await syncCounts(report.id);
        const remaining = await pendingCounts(report.id);
        for (const saved of result.rows) onSaved(mergeCounts({ ...report, rows: [saved] }, remaining).rows[0], report.status);
        setQueued(result.pending);
        if (result.error) setMessage(result.error);
      } catch (error) {
        errors.current.set(id, apiErrorMessage(error, "Enregistrement local impossible : ne fermez pas cette page, libérez de l'espace puis réessayez."));
        throw error;
      } finally { render((value) => value + 1); }
    })();
    pending.current.set(id, operation);
    try { await operation; } finally { if (pending.current.get(id) === operation) pending.current.delete(id); }
  }
  async function flush() {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    await Promise.all([...new Set([...drafts.current.keys(), ...pending.current.keys()])].map(save));
    if (drafts.current.size || errors.current.size) throw new Error("Comptages non enregistrés");
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
  function update(row: InventoryRow, key: string, value: string) {
    const current = drafts.current.get(row.product_id) || { counts: row.counts || { base: row.physical_qty }, note: row.note };
    const next = key === "note" ? { ...current, note: value } : { ...current, counts: { ...current.counts, [key]: value === "" ? null : Number(value) } };
    drafts.current.set(row.product_id, next);
    clearTimeout(timers.current.get(row.product_id));
    const total = inventoryTotal(next.counts, row);
    if (Object.values(next.counts).some((count) => count !== null && (!Number.isInteger(count) || count < 0)) || (total !== null && (!Number.isSafeInteger(total) || total > 2147483647))) {
      errors.current.set(row.product_id, "Quantités entières ≥ 0 requises, total maximal 2147483647.");
    } else {
      errors.current.delete(row.product_id);
      timers.current.set(row.product_id, setTimeout(() => { void save(row.product_id).catch(() => {}); }, 500));
    }
    render((value) => value + 1);
  }
  useImperativeHandle(ref, () => ({ flush, scan(code) {
    const match = inventoryScan(report.rows, code);
    if (!match) { setMessage("Code inconnu ou hors périmètre."); return; }
    const { row, key } = match;
    setSearch(""); setCategory(""); setSupplier("");
    setPage(Math.floor(report.rows.indexOf(row) / pageSize));
    setTarget({ id: row.product_id, key });
    const counted = drafts.current.has(row.product_id) ? inventoryTotal(drafts.current.get(row.product_id)!.counts, row) !== null : row.physical_qty !== null;
    setMessage(`${row.sku} — ${counted ? "déjà compté : modifiez les valeurs existantes" : "saisissez le comptage"}. Le scan n'ajoute aucune quantité.`);
  } }));
  useEffect(() => {
    const refresh = () => { void pendingCounts(report.id).then((counts) => setQueued(Object.keys(counts).length)); };
    refresh(); window.addEventListener("ri:inventory", refresh);
    return () => window.removeEventListener("ri:inventory", refresh);
  }, [report.id, online]);
  useEffect(() => {
    if (!target) return;
    const input = document.querySelector<HTMLInputElement>(`input[data-count-id="${target.id}"][data-count-key="${target.key}"]`);
    input?.focus(); input?.select(); input?.scrollIntoView({ block: "nearest" });
  }, [target, currentPage]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (drafts.current.size) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    const activeTimers = timers.current;
    return () => { window.removeEventListener("beforeunload", leave); for (const timer of activeTimers.values()) clearTimeout(timer); void flushRef.current().catch(() => {}); };
  }, []);
  function navigate(event: React.KeyboardEvent<HTMLInputElement>, row: InventoryRow, column: number) {
    if (!["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    let index = rows.indexOf(row), next = column;
    if (event.key === "ArrowDown") index++;
    else if (event.key === "ArrowUp") index--;
    else next += event.key === "ArrowLeft" ? -1 : 1;
    if (next >= inventoryUnits(row).length) { index++; next = 0; }
    if (next < 0) { index--; next = 1000; }
    const destination = rows[index];
    if (!destination) return;
    const units = inventoryUnits(destination);
    setPage(Math.floor(index / pageSize));
    setTarget({ id: destination.product_id, key: units[Math.min(next, units.length - 1)].key });
  }
  return <div className="space-y-3" data-revision={revision}>
    <div className="flex flex-wrap gap-2">
      <input className="input w-64" aria-label="Rechercher dans le comptage" placeholder="Référence / désignation" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
      <select className="input w-48" aria-label="Catégorie du comptage" value={category} onChange={(event) => { setCategory(event.target.value); setPage(0); }}><option value="">Toutes catégories</option>{[...new Set(report.rows.map((row) => row.category).filter(Boolean))].sort().map((value) => <option key={value}>{value}</option>)}</select>
      <select className="input w-48" aria-label="Fournisseur du comptage" value={supplier} onChange={(event) => { setSupplier(event.target.value); setPage(0); }}><option value="">Tous fournisseurs</option>{[...new Set(report.rows.map((row) => row.supplier).filter(Boolean))].sort().map((value) => <option key={value}>{value}</option>)}</select>
    </div>
    <p className="text-xs text-slate-500">Vide = non compté ; 0 = compté à zéro. Entrée / flèches : navigation. Sauvegarde locale automatique après 0,5 s. {drafts.current.size ? `${drafts.current.size} ligne(s) à enregistrer` : "Saisies conservées sur ce poste"}. <strong>{queued} ligne(s) en attente de synchronisation</strong>.</p>
    <p role="status">{message}</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Référence", "Désignation", "Catégorie / Fournisseur", "Comptage", "Total unités", ...(report.theoretical_visible ? ["Théorique", "Écart", "Valeur écart"] : [])].map((label) => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{visible.map((row) => {
      const draft = drafts.current.get(row.product_id);
      const counts = draft?.counts || row.counts || { base: row.physical_qty };
      const total = inventoryTotal(counts, row);
      const delta = total === null ? null : total - (row.theoretical_qty || 0);
      return <tr key={row.product_id} className="border-t align-top"><td className="p-2">{row.sku}</td><td className="p-2">{row.name}</td><td className="p-2">{row.category || "—"}<br />{row.supplier || "—"}</td><td className="min-w-80 p-2"><div className="flex flex-wrap gap-2">{inventoryUnits(row).map((unit, column) => <label className="label w-28" key={unit.key}>{unit.name}{unit.key !== "base" && ` ×${unit.factor}`}<input className="input" data-count-id={row.product_id} data-count-key={unit.key} aria-label={`${row.sku} ${unit.name}`} disabled={!editable} type="number" min={0} max={2147483647} step={1} value={counts[unit.key] ?? ""} onChange={(event) => update(row, unit.key, event.target.value)} onKeyDown={(event) => navigate(event, row, column)} /></label>)}</div><input className="input mt-2" aria-label={`Note ${row.sku}`} disabled={!editable} maxLength={4000} placeholder="Note" value={draft?.note ?? row.note} onChange={(event) => update(row, "note", event.target.value)} />{errors.current.has(row.product_id) && <p role="alert" className="text-red-600">{errors.current.get(row.product_id)}</p>}</td><td className="p-2 font-bold">{total ?? "Non compté"}</td>{report.theoretical_visible && <><td className="p-2">{row.theoretical_qty}</td><td className="p-2">{delta ?? "—"}</td><td className="p-2">{delta === null ? "—" : delta * (row.unit_cost || 0)}</td></>}</tr>;
    })}</tbody></table></div>
    <div className="flex items-center gap-3"><button className="btn-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Précédent</button><span>Page {currentPage + 1} / {pages} · {rows.length} articles</span><button className="btn-secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Suivant</button><button className="btn-secondary" onClick={() => void flush().then(() => setMessage("Toutes les saisies sont enregistrées.")).catch(() => setMessage("Sauvegarde impossible : vérifiez les lignes en erreur."))}>Enregistrer maintenant</button></div>
  </div>;
});
