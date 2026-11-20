import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import api, { formatXOF } from "../api/client";
import { apiErrorMessage } from "../lib/apiErrors";
import { useSyncVersion } from "../context/SyncContext";
import Modal from "./Modal";

const modes = [["cash", "Espèces"], ["mobile_money", "Mobile Money"], ["bank", "Bancaire"], ["credit", "Crédit (non encaissé)"], ["other", "Autres moyens"]] as const;
type Groups = Record<string, number>;
interface GlobalReport {
  id?: number;
  closed_at?: string;
  date_from: string;
  date_to: string;
  payments: Groups;
  payment_groups: Groups;
  inflow_groups?: Groups;
  outflow_groups?: Groups;
  cashiers: { user_id: number; name: string; own: boolean; sales_count: number; total_sales: number; payment_groups: Groups }[];
  sessions: { session_id: number; cashier: string; workstation: string | null; business_day: string; opened_at: string; closed_at: string | null; total_sales: number; payment_groups: Groups; expected_cash: number; counted_cash: number | null; difference: number | null }[];
  total_sales: number;
  open_sessions: number;
  expected_cash: number;
  counted_cash: number | null;
  difference: number | null;
  opening_balance: number;
  entries_total: number;
  exits_total: number;
  expenses_total: number;
  cash_expenses: number;
  refunds_total: number;
  cash_refunds: number;
  cash_settlements: number;
  deposits_total: number;
  advances_total: number;
  note?: string;
}
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function GlobalCash() {
  const [from, setFrom] = useState(localDay);
  const [to, setTo] = useState(localDay);
  const [report, setReport] = useState<GlobalReport | null>(null);
  const [closures, setClosures] = useState<GlobalReport[]>([]);
  const [selected, setSelected] = useState<GlobalReport | null>(null);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const version = useSyncVersion();
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const [current, history] = await Promise.all([
        api.get<GlobalReport>("/cash-sessions/global", { params: { date_from: from, date_to: to } }),
        api.get<GlobalReport[]>("/cash-sessions/global/closures"),
      ]);
      if (id !== requestId.current) return;
      setReport(current.data); setClosures(history.data); setError("");
    } catch (e) {
      if (id !== requestId.current) return;
      setReport(null);
      setError(axios.isAxiosError(e) ? apiErrorMessage(e.response?.data?.detail, "Centralisation indisponible") : "Centralisation indisponible");
    }
  }, [from, to]);
  useEffect(() => {
    const pending = requestId;
    const refresh = () => { if (document.visibilityState !== "hidden") void load(); };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("ri:synced", refresh);
    return () => {
      ++pending.current;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("ri:synced", refresh);
    };
  }, [load, version]);
  const data = selected || report;
  async function close() {
    if (!report) return;
    setSaving(true); setError("");
    try {
      await api.post<GlobalReport>("/cash-sessions/global/close", { date_from: from, date_to: to,
        session_ids: report.sessions.map((s) => s.session_id), closing_balance: Number(counted), note });
      setClosing(false); setSelected(null); await load();
    } catch (e) {
      setError(axios.isAxiosError(e) ? apiErrorMessage(e.response?.data?.detail, "Clôture globale impossible") : "Clôture globale impossible");
    } finally { setSaving(false); }
  }
  return <section className="card space-y-4 p-5" aria-label="Caisse globale de l'établissement">
    <h2 className="text-lg font-bold">Caisse globale de l'établissement</h2>
    <p className="text-sm">Ventes de toutes les caisses centrales, sans recopier les opérations. Période selon la journée d'ouverture des sessions. Les clôtures déjà consolidées sont dans l'historique.</p>
    <p className="text-xs">Vue courante actualisée automatiquement toutes les 15 s tant que la page est visible, et à la synchronisation. Les archives choisies restent figées.</p>
    <div className="flex flex-wrap gap-2">
      <label className="label">Du<input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setSelected(null); }} /></label>
      <label className="label">Au<input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setSelected(null); }} /></label>
      <button className="btn-secondary" onClick={() => { setSelected(null); void load(); }}>Actualiser les sessions non consolidées</button>
      <select className="input sm:w-72" aria-label="Historique des clôtures globales" value={selected?.id || ""} onChange={(e) => setSelected(closures.find((r) => r.id === Number(e.target.value)) || null)}>
        <option value="">Sessions non consolidées</option>{closures.map((r) => <option key={r.id} value={r.id}>Clôture #{r.id} · {r.date_from} → {r.date_to}</option>)}
      </select>
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {data && <>
      {selected && <h3 className="font-bold">Clôture globale #{selected.id} — récapitulatif figé · {selected.date_from} → {selected.date_to}</h3>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Mode de paiement</th><th>Moi (administrateur)</th><th>Autres caissiers</th><th>Total global</th></tr></thead><tbody>
        {modes.map(([key, label]) => { const own = data.cashiers.filter((c) => c.own).reduce((sum, c) => sum + (c.payment_groups[key] || 0), 0); return <tr key={key}><td>{label}</td><td className="text-center">{formatXOF(own)}</td><td className="text-center">{formatXOF((data.payment_groups[key] || 0) - own)}</td><td className="text-center font-bold">{formatXOF(data.payment_groups[key] || 0)}</td></tr>; })}
        <tr className="font-bold"><td>Total des ventes</td><td className="text-center">{formatXOF(data.cashiers.filter((c) => c.own).reduce((sum, c) => sum + c.total_sales, 0))}</td><td className="text-center">{formatXOF(data.cashiers.filter((c) => !c.own).reduce((sum, c) => sum + c.total_sales, 0))}</td><td className="text-center">{formatXOF(data.total_sales)}</td></tr>
      </tbody></table></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Caissier</th><th>Ventes</th>{modes.map(([key, label]) => <th key={key}>{label}</th>)}<th>Total</th></tr></thead><tbody>{data.cashiers.map((c) => <tr key={c.user_id}><td>{c.name}</td><td className="text-center">{c.sales_count}</td>{modes.map(([key]) => <td className="text-center" key={key}>{formatXOF(c.payment_groups[key] || 0)}</td>)}<td className="text-center">{formatXOF(c.total_sales)}</td></tr>)}</tbody></table></div>
      <details><summary>Détail des moyens de paiement</summary>{Object.entries(data.payments).map(([method, amount]) => <p key={method}>{method} : {formatXOF(amount)}</p>)}</details>
      {data.inflow_groups && data.outflow_groups ? <div className="overflow-x-auto"><h3 className="font-bold">Recettes et sorties de caisse par mode</h3><table className="w-full text-sm"><thead><tr><th className="text-left">Mode</th><th>Recettes encaissées</th><th>Sorties</th><th>Flux net</th></tr></thead><tbody>{modes.filter(([key]) => key !== "credit").map(([key, label]) => <tr key={key}><td>{label}</td><td className="text-center">{formatXOF(data.inflow_groups?.[key])}</td><td className="text-center">{formatXOF(data.outflow_groups?.[key])}</td><td className="text-center">{formatXOF((data.inflow_groups?.[key] || 0) - (data.outflow_groups?.[key] || 0))}</td></tr>)}</tbody></table><p className="text-xs">Ventes encaissées, entrées et règlements reçus ; sorties, dépenses, remboursements, règlements versés et versements bancaires. Fonds d'ouverture et crédit exclus des recettes. Les virements internes vers la banque ne sont pas comptés une seconde fois comme recettes.</p><p className="text-sm">Espèces attendues = fonds {formatXOF(data.opening_balance)} + recettes espèces {formatXOF(data.inflow_groups.cash)} − sorties espèces {formatXOF(data.outflow_groups.cash)}.</p></div> : <p className="text-xs">Ventilation des flux non enregistrée dans cette ancienne clôture.</p>}
      {data.inflow_groups && <p className="text-xs">Anciens Z : moyens non enregistrés classés dans « Autres », règlements conservés nets. Aucun historique n'est réécrit.</p>}
      {data.inflow_groups && <p className="text-xs">Les avoirs figurent dans « Autres » : ce sont des retours non monétaires, sans sortie d'espèces.</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{([
        ["Fonds d'ouverture (espèces)", data.opening_balance], ["Entrées espèces", data.entries_total], ["Sorties espèces", data.exits_total],
        ["Dépenses (tous modes)", data.expenses_total], ["Dépenses espèces", data.cash_expenses], ["Retours / remboursements (tous modes)", data.refunds_total],
        ["Remboursements espèces", data.cash_refunds], ["Règlements espèces nets", data.cash_settlements], ["Versements bancaires prélevés en espèces", data.deposits_total],
        ["Acomptes commandes (suivi, hors flux sans mode enregistré)", data.advances_total],
        ["Espèces théoriques attendues", data.expected_cash], ["Espèces comptées / déclarées", data.counted_cash], ["Écart espèces", data.difference],
      ] as const).map(([label, amount]) => <div key={label} className="rounded border p-2"><p className="text-xs">{label}</p><p className="font-bold">{amount == null ? "—" : formatXOF(amount)}</p></div>)}</div>
      <p className="text-xs">Les paiements électroniques ne sont pas des espèces physiques. Le crédit n'est pas un encaissement. Les fonds d'ouverture sont additionnés par caisse, pas considérés comme des ventes.</p>
      <details><summary>Sessions et postes inclus ({data.sessions.length})</summary>{data.sessions.map((s) => <p className="text-sm" key={s.session_id}>#{s.session_id} · {s.cashier} · {s.workstation || "Poste non renseigné"} · journée {s.business_day} · {new Date(s.opened_at).toLocaleString("fr-FR")} → {s.closed_at ? new Date(s.closed_at).toLocaleString("fr-FR") : "encore ouverte"}</p>)}</details>
      {data.sessions.some((s) => s.closed_at) && <div className="space-y-2"><h3 className="font-bold">Clôtures individuelles reçues</h3>{data.sessions.filter((s) => s.closed_at).map((s) => <div className="rounded border p-2 text-sm" key={s.session_id}>
        <p className="font-semibold">{s.cashier} · {s.workstation || "Poste non renseigné"} · #{s.session_id}</p>
        <p>Ventes : {formatXOF(s.total_sales)} · espèces : {formatXOF(s.payment_groups.cash)} · Mobile Money : {formatXOF(s.payment_groups.mobile_money)} · banque : {formatXOF(s.payment_groups.bank)}</p>
        <p>Espèces attendues : {formatXOF(s.expected_cash)} · comptées : {s.counted_cash == null ? "—" : formatXOF(s.counted_cash)} · écart : {s.counted_cash == null ? "—" : formatXOF(s.difference ?? (s.counted_cash - s.expected_cash))}</p>
      </div>)}</div>}
      {data.note && <p>Justification : {data.note}</p>}
      {!selected && <><p className="text-sm">Avant clôture globale : reconnectez les postes, synchronisez leurs tickets et clôturez chaque caisse individuellement. {data.open_sessions} session(s) encore ouverte(s).</p>
        <button className="btn-primary" disabled={!data.sessions.length || data.open_sessions > 0 || saving} onClick={() => { setCounted(String(data.counted_cash ?? "")); setNote(""); setClosing(true); }}>Clôturer le montant global</button>
      </>}
    </>}
    <Modal open={closing} onClose={() => setClosing(false)} title="Confirmer la clôture globale" footer={<button className="btn-primary" disabled={saving || !counted.trim() || !Number.isFinite(Number(counted)) || Number(counted) < 0} onClick={close}>Valider la clôture globale</button>}>
      <p>Espèces théoriques : {formatXOF(report?.expected_cash)} · ventes : {formatXOF(report?.total_sales)}. Cette clôture fige les sessions affichées sans générer de nouvelles ventes.</p>
      <label className="label">Espèces réellement comptées / déclarées<input className="input" type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} /></label>
      <p>Écart espèces : {formatXOF(Number(counted) - (report?.expected_cash || 0))}</p>
      <label className="label">Justification de l'écart / note<textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </Modal>
  </section>;
}
