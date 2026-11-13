import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Cloud } from "lucide-react";
import api, { formatDateTime } from "../api/client";
import type { CompanySettings } from "../types";

interface Inspection {
  created_at: string | null;
  app_version: string | null;
  compatible: boolean;
  integrity: string;
  sha256: string;
  row_counts: Record<string, number>;
}

interface DriveStatus {
  client_configured: boolean;
  client_id_suffix: string;
  client_from_env: boolean;
  connected: boolean;
  account_email: string;
  quota_used: string | null;
  quota_limit: string | null;
  last_upload_at: string | null;
  last_status: string;
  last_error: string;
}

interface DriveFile { id: string; name: string; size: string; createdTime: string }

export default function GoogleDriveSettings({ company, onChange, onRestore }: {
  company: Pick<CompanySettings, "drive_enabled" | "drive_folder_name" | "drive_keep">;
  onChange: (values: Partial<CompanySettings>) => void;
  onRestore: (name: string, report: Inspection) => void;
}) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await api.get<DriveStatus>("/backups/drive/status");
    setStatus(data);
    if (!data.connected) setFiles([]);
    return data;
  }, []);

  const loadFiles = useCallback(async () => {
    const { data } = await api.get<DriveFile[]>("/backups/drive/files");
    setFiles(data);
  }, []);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const { data } = await api.get<DriveStatus>("/backups/drive/status");
        if (active) {
          setStatus(data);
          if (!data.connected) setFiles([]);
        }
      } catch { /* a disconnected shop server must not erase the form */ }
    }
    void poll();
    const timer = window.setInterval(poll, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function action(work: () => Promise<string>) {
    setBusy(true);
    setMessage("");
    try { setMessage(await work()); }
    catch (error) {
      setMessage(axios.isAxiosError(error)
        ? error.response?.data?.detail ?? "Google Drive indisponible. Vérifiez la connexion Internet."
        : "Opération Google Drive impossible.");
    } finally {
      setBusy(false);
      try { await refresh(); } catch { /* the original error remains visible */ }
    }
  }

  function quota(value: string | null) {
    return value === null ? "Non communiqué" : `${(Number(value) / 1024 ** 3).toFixed(2)} Go`;
  }

  return <div className="card p-6">
    <div className="mb-4 flex items-center gap-2"><Cloud size={18} className="text-brand-600" />
      <h3 className="text-base font-bold text-slate-900">Google Drive</h3>
    </div>
    <p className="mb-4 text-sm text-slate-500">Copie en ligne des sauvegardes ZIP vérifiées, sans remplacer les sauvegardes locales. La connexion Google doit être effectuée depuis le poste qui héberge le serveur EasyGest.</p>
    <p className="mb-3 text-sm">Client OAuth : {status?.client_configured ? `Configuré (${status.client_id_suffix})` : "Non configuré"}{status?.client_from_env && " — variables d'environnement"}</p>
    {!status?.client_from_env && <div className="mb-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Identifiant du client OAuth (application de bureau)</label>
          <input className="input" value={clientId} autoComplete="off" onChange={(e) => setClientId(e.target.value)} disabled={status?.connected || busy} /></div>
        <div><label className="label">Secret du client OAuth</label>
          <input className="input" type="password" value={clientSecret} autoComplete="new-password" onChange={(e) => setClientSecret(e.target.value)} disabled={status?.connected || busy} /></div>
      </div>
      <button className="btn-ghost" disabled={busy || status?.connected || !clientId.trim() || !clientSecret.trim()}
        onClick={() => void action(async () => {
          await api.post("/backups/drive/client", { client_id: clientId, client_secret: clientSecret });
          setClientId(""); setClientSecret(""); return "Client OAuth enregistré sur le serveur.";
        })}>Enregistrer le client OAuth</button>
      <p className="text-xs text-slate-400">Les identifiants ne sont jamais relus dans cette page. Déconnectez Drive avant de changer de client.</p>
    </div>}
    <div className="mb-4 flex flex-wrap gap-3">
      <button className="btn-primary" disabled={busy || !status?.client_configured || status.connected}
        onClick={() => void action(async () => {
          const { data } = await api.post<{ authorization_url: string }>("/backups/drive/connect");
          window.open(data.authorization_url, "_blank", "noopener,noreferrer");
          return "Terminez la connexion dans votre navigateur. Cette page vérifie le résultat automatiquement. Si aucun onglet ne s'ouvre, autorisez les fenêtres surgissantes.";
        })}>Connecter Google Drive</button>
      <button className="btn-ghost" disabled={busy || !status?.connected}
        onClick={() => void action(async () => { await api.post("/backups/drive/disconnect"); onChange({ drive_enabled: false }); return "Google Drive déconnecté."; })}>Déconnecter</button>
    </div>
    <p className="text-sm">Connexion : {status?.connected ? "Connecté" : "Déconnecté"}{status?.account_email && ` — ${status.account_email}`}</p>
    {status?.connected && <p className="mt-1 text-xs text-slate-500">Espace utilisé : {quota(status.quota_used)} / {quota(status.quota_limit)}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div><label className="label">Dossier Google Drive</label><input className="input" value={company.drive_folder_name} maxLength={200} onChange={(e) => onChange({ drive_folder_name: e.target.value })} /></div>
      <div><label className="label">Sauvegardes à conserver sur Drive</label><input className="input" type="number" min={1} max={1000} value={company.drive_keep} onChange={(e) => onChange({ drive_keep: Number(e.target.value) })} /></div>
    </div>
    <label className="mt-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={company.drive_enabled} disabled={!status?.connected} onChange={(e) => onChange({ drive_enabled: e.target.checked })} />
      Envoyer automatiquement les sauvegardes manuelles, planifiées et du démarrage (pas après chaque vente)
    </label>
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="btn-ghost" disabled={busy} onClick={() => void action(async () => {
        await api.put("/settings/company", { drive_enabled: company.drive_enabled, drive_folder_name: company.drive_folder_name, drive_keep: company.drive_keep });
        return "Paramètres Google Drive enregistrés.";
      })}>Enregistrer les paramètres Drive</button>
      <button className="btn-ghost" disabled={busy || !status?.connected} onClick={() => void action(async () => {
        const { data } = await api.post<{ detail: string }>("/backups/drive/test", undefined, { timeout: 210000 }); return data.detail;
      })}>Tester la connexion</button>
      <button className="btn-primary" disabled={busy || !status?.connected} onClick={() => void action(async () => {
        const { data } = await api.post<{ name: string; drive: { status: string; error?: string } }>("/backups?drive=true", undefined, { timeout: 240000 });
        await loadFiles();
        return data.drive.status === "ok" ? `Sauvegarde ${data.name} envoyée et vérifiée sur Drive.` : `Sauvegarde locale ${data.name} créée. Échec Drive : ${data.drive.error}`;
      })}>Sauvegarder maintenant sur Drive</button>
    </div>
    <p className="mt-3 text-xs text-slate-500">Dernier envoi réussi : {status?.last_upload_at ? formatDateTime(status.last_upload_at) : "Aucun"} — État : {status?.last_status || "Aucun envoi"}</p>
    {status?.last_error && <p className="mt-2 text-sm text-red-600">{status.last_error}</p>}
    {message && <p className="mt-3 text-sm text-slate-600" role="status">{message}</p>}
    {busy && <p className="mt-2 text-sm text-slate-500">Opération en cours…</p>}
    <button className="btn-ghost mt-4" disabled={busy || !status?.connected} onClick={() => void action(async () => { await loadFiles(); return "Liste des sauvegardes Drive actualisée."; })}>Afficher les sauvegardes Drive</button>
    <ul className="mt-3 divide-y divide-slate-100">{files.map((file) => <li key={file.id} className="flex items-center justify-between gap-3 py-3 text-sm">
      <span className="min-w-0"><span className="block truncate font-medium">{file.name}</span><span className="text-xs text-slate-400">{formatDateTime(file.createdTime)} · {Math.round(Number(file.size) / 1024)} Ko</span></span>
      <button className="btn-ghost" disabled={busy} onClick={() => void action(async () => {
        const { data } = await api.post<{ name: string; inspection: Inspection }>(`/backups/drive/download/${encodeURIComponent(file.id)}`, undefined, { timeout: 210000 });
        onRestore(data.name, data.inspection); return "Archive téléchargée et vérifiée. Consultez l'inspection dans la section restauration puis saisissez RESTAURER.";
      })}>Restaurer</button>
    </li>)}</ul>
  </div>;
}
