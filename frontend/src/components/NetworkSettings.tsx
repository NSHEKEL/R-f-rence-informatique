import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import api, { formatDateTime, getServerUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useNetwork } from "../context/NetworkContext";

interface Identity {
  hostname: string; port: number; lan_ips: string[]; connected_count: number;
  version: string; network_restrict_workstations: boolean;
}
interface Poste {
  id: number; ip: string; name: string; hostname: string; user_agent: string;
  status: string; last_user: string; last_seen: string; active: boolean;
}

export default function NetworkSettings({ restricted, onRestrictionChange }: {
  restricted: boolean; onRestrictionChange: (value: boolean) => void;
}) {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const { online, serverReachable, workstationStatus, lastContact, refresh } = useNetwork();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [postes, setPostes] = useState<Poste[]>([]);
  const [message, setMessage] = useState("");
  const [backup, setBackup] = useState<{ last_backup_at?: string; last_backup_error?: string } | null>(null);
  const [drive, setDrive] = useState<{ last_status: string; last_error: string; last_upload_at: string | null } | null>(null);
  let secondary = false;
  try { secondary = !!getServerUrl() && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(getServerUrl()).hostname); } catch { /* invalid URL is displayed below */ }

  const load = useCallback(async () => {
    const { data } = await api.get<Identity>("/network");
    setIdentity(data);
    if (admin) {
      const response = await api.get<Poste[]>("/network/workstations");
      setPostes(response.data);
      const [local, remote] = await Promise.all([api.get("/backups/status"), api.get("/backups/drive/status")]);
      setBackup(local.data); setDrive(remote.data);
    }
  }, [admin]);

  useEffect(() => {
    let loading = false;
    const poll = async () => {
      if (loading) return;
      loading = true;
      try { await load(); } catch { /* the live health status remains visible */ }
      finally { loading = false; }
    };
    void poll();
    const timer = window.setInterval(poll, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function action(work: () => Promise<unknown>) {
    setMessage("");
    try { await work(); await load(); setMessage("Configuration réseau mise à jour."); }
    catch (error) {
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null;
      setMessage(typeof detail === "string" ? detail : "Modification impossible. Vérifiez la connexion et le nom du poste (100 caractères maximum).");
    }
  }

  return <div className="card p-6">
    <h3 className="text-base font-bold text-slate-900">{secondary ? "Poste secondaire" : "Ordinateur principal"}</h3>
    <p className="mt-2 text-sm text-slate-600">{secondary ? "Ce poste utilise la base du serveur sélectionné." : "Le serveur EasyGest de cet ordinateur gère la base de données."}</p>
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-slate-500">Adresse du serveur</dt><dd className="font-mono">{getServerUrl() || window.location.origin}</dd></div>
      <div><dt className="text-slate-500">État du réseau</dt><dd>{online ? "Connecté" : serverReachable ? "Serveur joignable — autorisation requise" : "Déconnecté"}</dd></div>
      <div><dt className="text-slate-500">Serveur / version</dt><dd>{identity ? `${identity.hostname}:${identity.port} — ${identity.version}` : "Non disponible"}</dd></div>
      <div><dt className="text-slate-500">Postes vus depuis 10 minutes</dt><dd>{identity?.connected_count ?? "—"}</dd></div>
      <div><dt className="text-slate-500">Adresses réseau du serveur</dt><dd>{identity?.lan_ips.join(", ") || "Non disponible"}</dd></div>
      <div><dt className="text-slate-500">Dernier contact réussi avec le serveur</dt><dd>{lastContact ? formatDateTime(lastContact) : "Aucun"}</dd></div>
    </dl>
    <button className="btn-ghost mt-3" onClick={() => void refresh()}>Vérifier la connexion</button>
    {serverReachable && workstationStatus && workstationStatus !== "approved" && <p className="mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900">{workstationStatus === "blocked" ? "Poste bloqué." : "En attente d'autorisation."} Demandez à l'administrateur d'autoriser ce poste depuis Configuration → Réseau sur l'ordinateur principal.</p>}
    {admin && <>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
        <p>Dernière sauvegarde locale : {backup?.last_backup_at ? formatDateTime(backup.last_backup_at) : "Aucune"}</p>
        <p>Google Drive : {drive?.last_status || "Non utilisé"} — dernier envoi : {drive?.last_upload_at ? formatDateTime(drive.last_upload_at) : "Aucun"}</p>
        {(backup?.last_backup_error || drive?.last_error) && <p className="mt-1 text-red-600">{backup?.last_backup_error} {drive?.last_error}</p>}
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={restricted} onChange={(e) => onRestrictionChange(e.target.checked)} /> N'autoriser que les postes approuvés</label>
      <p className="mt-2 text-xs text-slate-500">Désactivé par défaut. Autorisez votre propre adresse avant d'activer la restriction à distance. L'accès local sur 127.0.0.1 reste toujours possible ; l'adresse IP peut changer avec le DHCP.</p>
      <button className="btn-primary mt-3" onClick={() => {
        if (restricted && !window.confirm("Activer la restriction ? Les postes non approuvés, y compris ce poste s'il est distant, perdront l'accès. L'administrateur peut toujours intervenir sur l'ordinateur principal via 127.0.0.1.")) return;
        void action(() => api.put("/settings/company", { network_restrict_workstations: restricted }));
      }}>Enregistrer la restriction</button>
      <h4 className="mt-5 font-bold text-slate-900">Autorisation des postes</h4>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th>Poste / IP</th><th>Dernier utilisateur</th><th>Dernière activité</th><th>État</th><th>Actions</th></tr></thead>
        <tbody>{postes.map((poste) => <tr key={poste.id} className="border-t border-slate-100">
          <td className="py-3" title={`${poste.hostname} ${poste.user_agent}`}>{poste.name || "Sans nom"}<span className="block font-mono text-xs">{poste.ip}</span></td>
          <td>{poste.last_user || "—"}</td><td>{formatDateTime(poste.last_seen)}<span className="block text-xs">{poste.active ? "Actif" : "Inactif"}</span></td>
          <td>{poste.status === "approved" ? "Autorisé" : poste.status === "blocked" ? "Bloqué" : "En attente"}</td>
          <td><div className="flex flex-wrap gap-1">
            <button className="btn-ghost" onClick={() => void action(() => api.patch(`/network/workstations/${poste.id}`, { status: "approved" }))}>Autoriser</button>
            <button className="btn-ghost" onClick={() => void action(() => api.patch(`/network/workstations/${poste.id}`, { status: "blocked" }))}>Bloquer</button>
            <button className="btn-ghost" onClick={() => { const name = window.prompt("Nom du poste", poste.name); if (name !== null) void action(() => api.patch(`/network/workstations/${poste.id}`, { name })); }}>Renommer</button>
            <button className="btn-ghost" onClick={() => { if (window.confirm("Supprimer ce poste ? Il réapparaîtra en attente à sa prochaine visite.")) void action(() => api.delete(`/network/workstations/${poste.id}`)); }}>Supprimer</button>
          </div></td>
        </tr>)}</tbody></table></div>
      {postes.length === 0 && <p className="mt-3 text-sm text-slate-500">Aucun poste distant n'a encore contacté ce serveur.</p>}
    </>}
    {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
  </div>;
}
