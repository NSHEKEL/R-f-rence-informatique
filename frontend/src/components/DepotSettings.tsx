import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import api, { formatDateTime } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Depot } from "../lib/depots";

interface Product { id: number; name: string; sku: string }
interface Transfer { id: number; reference: string; source_depot_id: number; destination_depot_id: number; created_at: string; note: string; items: { product_id: number; product_name: string; quantity: number }[] }

export default function DepotSettings() {
  const { can } = useAuth();
  const manage = can("depots_gerer"), move = can("depots_transferer");
  const [depots, setDepots] = useState<Depot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [history, setHistory] = useState<Transfer[]>([]);
  const [form, setForm] = useState({ code: "", name: "", active: true });
  const [editing, setEditing] = useState<number | null>(null);
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [lines, setLines] = useState([{ product_id: "", quantity: "" }]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await api.get<Depot[]>("/depots"); setDepots(data);
    setSource((previous) => previous || String(data.find((d) => d.is_default)?.id || ""));
    if (move) { const [catalogue, documents] = await Promise.all([api.get<Product[]>("/depots/options"), api.get<Transfer[]>("/depots/transfers")]); setProducts(catalogue.data); setHistory(documents.data); }
  }, [move]);
  useEffect(() => { void load().catch(() => setMessage("Chargement des dépôts impossible.")); }, [load]);
  async function action(work: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await work(); await load(); }
    catch (error) { setMessage(axios.isAxiosError(error) ? String(error.response?.data?.detail || "Opération impossible") : "Opération impossible"); }
    finally { setBusy(false); }
  }
  return <section className="card space-y-4 p-5"><h2 className="text-xl font-bold">Dépôts et transferts internes</h2>
    <p className="text-sm">Toutes les opérations commerciales utilisent automatiquement le magasin principal. Un solde négatif du principal est à réapprovisionner depuis les réserves. Les ventes restent contrôlées sur le stock total.</p>
    {depots.map((depot) => <div key={depot.id} className="flex items-center gap-3 border-b py-2"><span>{depot.code} — {depot.name} {depot.is_default ? "(principal)" : ""} {!depot.active ? "(désactivé)" : ""}</span>{manage && <button className="btn-secondary" onClick={() => { setEditing(depot.id); setForm({ code: depot.code, name: depot.name, active: depot.active }); }}>Modifier</button>}</div>)}
    {manage && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void action(async () => { if (editing) await api.put(`/depots/${editing}`, form); else await api.post("/depots", form); setEditing(null); setForm({ code: "", name: "", active: true }); }); }}>
      <label className="label">Code<input className="input" required maxLength={40} pattern="[A-Za-z0-9_-]+" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
      <label className="label">Nom<input className="input" required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Actif</label>
      <button disabled={busy} className="btn-primary">{editing ? "Enregistrer le dépôt" : "Créer un dépôt"}</button>{editing && <button type="button" className="btn-secondary" onClick={() => { setEditing(null); setForm({ code: "", name: "", active: true }); }}>Annuler</button>}
    </form>}
    {manage && <button disabled={busy} className="btn-secondary" onClick={() => void action(async () => { const { data } = await api.get<{ ok: boolean; errors: unknown[] }>("/depots/consistency"); setMessage(data.ok ? "Cohérence des stocks : OK" : `${data.errors.length} incohérence(s) détectée(s).`); })}>Vérifier la cohérence des stocks</button>}
    {move && <form className="space-y-3 border-t pt-4" onSubmit={(event) => { event.preventDefault(); if (!window.confirm("Valider ce transfert définitif ?")) return; void action(async () => { await api.post("/depots/transfers", { source_depot_id: Number(source), destination_depot_id: Number(destination), note, items: lines.map((line) => ({ product_id: Number(line.product_id), quantity: Number(line.quantity) })) }); setLines([{ product_id: "", quantity: "" }]); setNote(""); }); }}>
      <h3 className="font-bold">Nouveau transfert</h3><div className="flex gap-3">{(["source", "destination"] as const).map((key) => <label className="label" key={key}>{key === "source" ? "Dépôt source" : "Dépôt destination"}<select className="input" required value={key === "source" ? source : destination} onChange={(e) => key === "source" ? setSource(e.target.value) : setDestination(e.target.value)}><option value="">Choisir</option>{depots.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>)}</div>
      {lines.map((line, index) => <div className="flex gap-2" key={index}><select aria-label={`Article ${index + 1}`} className="input" required value={line.product_id} onChange={(e) => setLines(lines.map((row, i) => i === index ? { ...row, product_id: e.target.value } : row))}><option value="">Article</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>)}</select><input aria-label={`Quantité de base ${index + 1}`} className="input w-32" required type="number" min={1} max={2147483647} step={1} value={line.quantity} onChange={(e) => setLines(lines.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} />{lines.length > 1 && <button type="button" className="btn-secondary" onClick={() => setLines(lines.filter((_, i) => i !== index))}>Retirer</button>}</div>)}
      <button type="button" className="btn-secondary" onClick={() => setLines([...lines, { product_id: "", quantity: "" }])}>Ajouter un article</button><input aria-label="Note du transfert" className="input" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn-primary" disabled={busy || source === destination}>Valider le transfert</button>
    </form>}
    {move && <div><h3 className="font-bold">Historique des transferts</h3>{!history.length && <p>Aucun transfert.</p>}{history.map((document) => <details className="border-b p-2" key={document.id}><summary>{document.reference} — {formatDateTime(document.created_at)} — {depots.find((d) => d.id === document.source_depot_id)?.name} → {depots.find((d) => d.id === document.destination_depot_id)?.name}</summary>{document.items.map((item) => <p key={item.product_id}>{item.product_name} : {item.quantity} unités de base</p>)}<p>{document.note}</p></details>)}</div>}
    <p role="status">{message}</p></section>;
}
