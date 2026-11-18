import { useEffect, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { DEFAULT_POS, mergePos, type PosDisplay } from "../lib/posDisplay";
import PosProductGrid from "./PosProductGrid";
import type { Product } from "../types";

const PREVIEW = [{ id: 1, name: "Riz parfumé — paquet familial", quantity: 120, sale_price: 1500 }, { id: 2, name: "Savon", quantity: 24, sale_price: 500 }] as Product[];
const EMPTY_SELECTION = new Set<number>();
const NOOP = () => {};
const PRICE = (product: Product) => product.sale_price;

export default function PosDisplaySettings() {
  const { can } = useAuth();
  const admin = can("articles_modifier");
  const [config, setConfig] = useState<PosDisplay>(DEFAULT_POS);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { let live = true; api.get("/settings/pos-display").then(({ data }) => { if (live) { setConfig(mergePos(data)); setReady(true); } }).catch(() => { if (live) setMessage("Chargement impossible. Rouvrez cette section."); }); return () => { live = false; }; }, []);
  function update<K extends keyof PosDisplay>(key: K, value: PosDisplay[K]) { setConfig((previous) => ({ ...previous, [key]: value })); }
  async function save() {
    if (!admin || saving) return;
    setSaving(true); setMessage("");
    try { const { data } = await api.put("/settings/pos-display", config); setConfig(mergePos(data)); setMessage("Affichage POS enregistré."); }
    catch { setMessage("Enregistrement impossible. Vérifiez les valeurs et la connexion."); }
    finally { setSaving(false); }
  }
  return <section className="card space-y-4 p-6"><h2 className="text-lg font-bold">Affichage POS</h2>
    <p className="text-sm text-slate-500">Grille automatique : la largeur est la largeur minimale souhaitée. En colonnes fixes, la largeur s'adapte à l'espace disponible. Les changements sont appliqués après enregistrement et réouverture du POS.</p>
    <fieldset disabled={!admin || !ready || saving} className="grid gap-4 sm:grid-cols-3">
      <label className="label">Mode<select className="input" value={config.mode} onChange={(e) => update("mode", e.target.value as PosDisplay["mode"])}>{["nom", "nom+prix", "nom+prix+stock", "image+nom+prix", "image+nom+prix+stock"].map((mode) => <option key={mode}>{mode}</option>)}</select></label>
      {([["width", "Largeur", 100, 400], ["height", "Hauteur", 70, 400], ["font_size", "Taille du texte", 10, 36], ["columns", "Colonnes (0 = auto)", 0, 12], ["gap_x", "Espacement horizontal", 0, 40], ["gap_y", "Espacement vertical", 0, 40], ["radius", "Rayon des angles", 0, 40]] as const).map(([key, label, min, max]) => <label className="label" key={key}>{label}<input className="input" type="number" min={min} max={max} value={config[key]} onChange={(e) => update(key, Number(e.target.value))} /></label>)}
      <label className="label">Police<select className="input" value={config.font_family} onChange={(e) => update("font_family", e.target.value)}>{["Arial", "Verdana", "Tahoma", "Georgia", "sans-serif"].map((font) => <option key={font}>{font}</option>)}</select></label>
      <label className="label">Alignement<select className="input" value={config.align} onChange={(e) => update("align", e.target.value as PosDisplay["align"])}><option value="center">Centré</option><option value="left">Gauche</option><option value="right">Droite</option></select></label>
      {([["background", "Fond"], ["text", "Texte"], ["border", "Bordure"]] as const).map(([key, label]) => <label className="label" key={key}>{label}<input type="color" value={config[key]} onChange={(e) => update(key, e.target.value)} /></label>)}
      <label><input type="checkbox" checked={config.images} onChange={(e) => update("images", e.target.checked)} /> Afficher les images</label>
      <label><input type="checkbox" checked={config.stock} onChange={(e) => update("stock", e.target.checked)} /> Afficher le stock (selon les droits)</label>
    </fieldset>
    <h3 className="font-semibold">Aperçu en direct</h3><div className="flex h-80 flex-col"><PosProductGrid products={PREVIEW} config={mergePos(config)} stockRight={can("produits") || can("inventaire")} selected={EMPTY_SELECTION} onAdd={NOOP} price={PRICE} /></div>
    <div className="flex flex-wrap gap-3"><button className="btn-primary" disabled={!admin || !ready || saving} onClick={save}>{saving ? "Enregistrement…" : "Enregistrer"}</button><button className="btn-ghost" disabled={!admin || !ready || saving} onClick={() => { setConfig({ ...DEFAULT_POS }); setMessage("Valeurs par défaut restaurées dans l'aperçu. Enregistrez pour les conserver."); }}>Restaurer les paramètres par défaut</button></div>
    {message && <p role="status">{message}</p>}{!admin && <p>Affichage en lecture seule.</p>}
  </section>;
}
