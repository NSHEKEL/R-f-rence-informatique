import { useEffect, useState } from "react";
import { localApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { readPostePrinters, writePostePrinters, useCompany } from "../context/CompanyContext";
import { readPosteSettings, writePosteSettings } from "../lib/poste";

const PRINTER_LABELS: Record<string, string> = { receipt: "Reçus", label: "Étiquettes", documents: "Documents", delivery: "Livraisons", quote: "Devis", reports: "Rapports", settlement: "Règlements" };

export default function WorkstationSettings() {
  const { can } = useAuth();
  const { reload, printing } = useCompany();
  const edit = can("poste_modifier");
  const peripherals = can("peripheriques_modifier");
  const scannerEdit = edit || peripherals;
  const [form, setForm] = useState(readPosteSettings);
  const [printers, setPrinters] = useState(readPostePrinters);
  const [available, setAvailable] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => { localApi.get("/settings/printers").then(({ data }) => setAvailable(data.printers)).catch(() => setMessage("Détection locale indisponible ; saisie manuelle possible.")); }, []);
  function save() {
    if (!Number.isInteger(form.scanner_min_length) || form.scanner_min_length < 1 || form.scanner_min_length > 200 || !Number.isInteger(form.display_scale) || form.display_scale < 70 || form.display_scale > 130 || form.drawer_code !== undefined && (!/^\d+(\s*,\s*\d+)*$/.test(form.drawer_code) || form.drawer_code.split(",").some((v) => Number(v) > 255))) {
      setMessage("Longueur, échelle ou code du tiroir invalide."); return;
    }
    const current = readPosteSettings();
    writePosteSettings({ ...current, ...(scannerEdit ? { scanner_suffix: form.scanner_suffix, scanner_prefix: form.scanner_prefix, scanner_auto_add: form.scanner_auto_add, scanner_min_length: form.scanner_min_length } : {}), ...(edit ? { display_scale: form.display_scale } : {}), ...(peripherals ? { drawer_port: form.drawer_port, drawer_code: form.drawer_code } : {}) });
    if (edit) writePostePrinters(printers);
    void reload();
    setMessage("Préférences enregistrées sur ce poste uniquement.");
  }
  return <section className="card space-y-4 p-6"><h3 className="font-bold">Ce poste uniquement</h3>
    <p>Choix locaux, conservés dans le profil navigateur et sauvegardés dans le fichier natif du poste. Aucun réglage partagé n'est modifié.</p>
    {can("poste_consulter") && <fieldset disabled={!edit} className="space-y-3">
      <datalist id="local-printers">{available.map((name) => <option key={name} value={name} />)}</datalist>
      {Object.entries(PRINTER_LABELS).map(([key, label]) => <label className="label" key={key}>Imprimante locale — {label}<input className="input" list="local-printers" value={printers[key] ?? ""} onChange={(e) => setPrinters({ ...printers, [key]: e.target.value })} /></label>)}
      <label className="label">Échelle POS locale (%)<input className="input" type="number" min={70} max={130} value={form.display_scale} onChange={(e) => setForm({ ...form, display_scale: Number(e.target.value) })} /></label>
    </fieldset>}
    <fieldset disabled={!scannerEdit} className="space-y-3">
      <label className="label">Suffixe scanner<select className="input" value={form.scanner_suffix} onChange={(e) => setForm({ ...form, scanner_suffix: e.target.value as "Enter" | "Tab" })}><option>Enter</option><option>Tab</option></select></label>
      <label className="label">Préfixe à retirer<input className="input" maxLength={128} value={form.scanner_prefix} onChange={(e) => setForm({ ...form, scanner_prefix: e.target.value })} /></label>
      <label className="label">Longueur minimale<input className="input" type="number" min={1} max={200} value={form.scanner_min_length} onChange={(e) => setForm({ ...form, scanner_min_length: Number(e.target.value) })} /></label>
      <label><input type="checkbox" checked={form.scanner_auto_add} onChange={(e) => setForm({ ...form, scanner_auto_add: e.target.checked })} /> Ajouter automatiquement au scan</label>
    </fieldset>
    {can("peripheriques_consulter") && <fieldset disabled={!peripherals} className="space-y-3">
      <label className="label">Port tiroir local (vide = réglage société)<input className="input" value={form.drawer_port ?? ""} onChange={(e) => setForm({ ...form, drawer_port: e.target.value || undefined })} /></label>
      <label className="label">Code tiroir local (vide = réglage société)<input className="input" value={form.drawer_code ?? ""} onChange={(e) => setForm({ ...form, drawer_code: e.target.value || undefined })} /></label>
      <button className="btn-secondary" onClick={async () => { try { await localApi.post("/settings/company/open-drawer", { drawer_port: form.drawer_port, drawer_code: form.drawer_code, printer_name: printers.receipt ?? printing.receipt.printer_name }); setMessage("Commande d'ouverture envoyée."); } catch { setMessage("Ouverture impossible."); } }}>Tester le tiroir local</button>
    </fieldset>}
    <button className="btn-primary" disabled={!edit && !peripherals} onClick={save}>Enregistrer sur ce poste</button>
    <button className="btn-secondary" disabled={!edit} onClick={async () => { try { await localApi.post("/settings/printers/test", { printer_name: printers.receipt ?? printing.receipt.printer_name }); setMessage("Test envoyé."); } catch { setMessage("Test impossible."); } }}>Tester l'imprimante locale</button>
    <p role="status">{message}</p>
  </section>;
}
