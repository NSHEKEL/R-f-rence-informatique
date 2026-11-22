import { useEffect, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { apiErrorMessage } from "../lib/apiErrors";

interface EventRow { id: string; kind: string; state: string; user_id: number; result: { reason?: string }; }

export default function OfflineSettings() {
  const { isAdmin } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [hours, setHours] = useState(24);
  const [fingerprint, setFingerprint] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!isAdmin) return;
    void Promise.all([api.get("/settings/company"), api.get("/offline/identity"), api.get<EventRow[]>("/offline/events")]).then(([company, identity, rows]) => {
      setEnabled(company.data.offline_enabled ?? true); setHours(company.data.offline_authorization_hours ?? 24);
      setFingerprint(identity.data.fingerprint); setEvents(rows.data);
    }).catch(() => setMessage("Ces réglages nécessitent le serveur."));
  }, [isAdmin]);
  if (!isAdmin) return null;
  async function save() {
    try {
      await api.put("/settings/company", { offline_enabled: enabled, offline_authorization_hours: hours });
      setMessage("Politique enregistrée. La durée part du dernier login serveur et n'est jamais prolongée par une synchronisation.");
    } catch (error) { setMessage(apiErrorMessage((error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail, "Enregistrement refusé")); }
  }
  async function resolve(row: EventRow) {
    const reason = window.prompt("Motif de validation administrateur (minimum 5 caractères). L'original sera conservé.");
    if (!reason || reason.trim().length < 5) return;
    const regularize = row.kind === "open" && window.confirm("Régulariser dans une nouvelle caisse de la période actuelle ? Annuler réessaie seulement le rattachement d'origine. Aucun ancien Z ne sera modifié.");
    try {
      const result = await api.post(`/offline/events/${row.id}/resolve`, { reason, regularize });
      setMessage(result.data.state === "applied" ? "Opération rapprochée une fois." : result.data.reason || "Le conflit nécessite encore une vérification.");
      setEvents((await api.get<EventRow[]>("/offline/events")).data);
    } catch { setMessage("Rapprochement refusé ; l'opération originale reste conservée."); }
  }
  return <section className="card space-y-4 p-6">
    <h3 className="font-bold">Postes vendeurs hors ligne</h3>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Autoriser le mode hors ligne après connexion serveur</label>
    <label className="label">Validité depuis le dernier login serveur (heures)<input className="input" type="number" min={1} max={8760} value={hours} onChange={(event) => setHours(Number(event.target.value))} /></label>
    <p className="text-xs text-amber-800">24 h par défaut ; 168 h = 7 jours. Un compte désactivé ne peut pas être révoqué à distance tant que le poste n'a aucun réseau. Une longue durée augmente ce risque.</p>
    <button className="btn-primary" onClick={save}>Enregistrer la politique hors ligne</button>
    <div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="font-semibold">Empreinte du serveur à comparer lors de la préparation unique d'un poste par l'administrateur</p><code className="break-all">{fingerprint || "Indisponible hors ligne"}</code><p>Le vendeur ne règle rien ensuite : il utilise son identifiant et son mot de passe habituels.</p></div>
    {message && <p className="text-sm" role="status">{message}</p>}
    <details><summary className="cursor-pointer text-sm font-semibold">Opérations reçues des postes ({events.filter((row) => row.state !== "applied").length} à vérifier)</summary>
      <ul className="mt-2 max-h-64 space-y-2 overflow-auto text-xs">{events.map((row) => <li key={row.id} className="rounded border p-2">{row.kind} · vendeur {row.user_id} · {row.state}<code className="ml-2 break-all">{row.id}</code>{row.result.reason && <p>{row.result.reason}</p>}{row.state !== "applied" && <button className="btn-secondary mt-1" onClick={() => resolve(row)}>Vérifier et réessayer</button>}</li>)}</ul>
    </details>
  </section>;
}
