import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Activity,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import api, { formatDateTime } from "../api/client";

interface DiagnosticItem {
  label: string;
  status: string;
  detail: string;
}

interface LogRow {
  id: number;
  at: string;
  event: string;
  identifier: string;
  detail: string;
  station: string;
  success: boolean;
  user?: { name: string } | null;
}

const EVENT_LABELS: Record<string, string> = {
  connexion: "Connexion réussie",
  connexion_echouee: "Tentative échouée",
  connexion_refusee: "Connexion refusée",
  deconnexion: "Déconnexion",
  utilisateur_cree: "Utilisateur créé",
  utilisateur_modifie: "Utilisateur modifié",
  utilisateur_supprime: "Utilisateur supprimé",
  mot_de_passe_reinitialise: "Mot de passe réinitialisé",
  changement_mot_de_passe: "Mot de passe changé",
  cle_recuperation_generee: "Clé de récupération générée",
  recuperation_admin: "Récupération administrateur",
  reparation_authentification: "Réparation de l'authentification",
  purge_journal: "Purge du journal",
};

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  avertissement: "bg-amber-50 text-amber-700",
  erreur: "bg-red-50 text-red-600",
};

/** Accounts, recovery and diagnostic: never any business data here. */
export default function SecuritySettings() {
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [check, journal] = await Promise.all([
      api.get<{ items: DiagnosticItem[] }>("/securite/diagnostic"),
      api.get<LogRow[]>("/securite/journal", { params: { limit: 100 } }),
    ]);
    setItems(check.data.items);
    setLogs(journal.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generateKey() {
    if (
      !confirm(
        "Générer une nouvelle clé de récupération ? L'ancienne cessera de " +
          "fonctionner. Aucune donnée commerciale n'est modifiée."
      )
    )
      return;
    setBusy(true);
    try {
      const { data } = await api.post<{ key: string }>(
        "/securite/cle-recuperation"
      );
      setRecoveryKey(data.key);
      setMessage(
        "Notez cette clé et conservez-la hors de l'application : elle ne " +
          "sera plus affichée."
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function repair() {
    if (
      !confirm(
        "Réparer l'authentification ?\n\nCela remet à zéro les compteurs de " +
          "tentatives, efface les codes de réinitialisation en attente et " +
          "réactive les comptes administrateurs.\n\nAucune vente, aucun " +
          "produit, client, dette ou paramètre commercial n'est supprimé."
      )
    )
      return;
    setBusy(true);
    try {
      const { data } = await api.post<{ message: string }>(
        "/securite/reparer-authentification"
      );
      setMessage(data.message);
      await load();
    } catch (err) {
      setMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Réparation impossible"
          : "Réparation impossible"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-slate-400" />
            <h3 className="text-base font-bold text-slate-900">
              Diagnostic de connexion
            </h3>
          </div>
          <button className="btn-ghost" onClick={load}>
            <RefreshCw size={16} /> Actualiser
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-100 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">{item.label}</p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                    STATUS_STYLES[item.status] ?? STATUS_STYLES.ok
                  }`}
                >
                  {item.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound size={18} className="text-slate-400" />
          <h3 className="text-base font-bold text-slate-900">
            Clé de récupération administrateur
          </h3>
        </div>
        <p className="text-sm text-slate-500">
          Cette clé permet de rétablir l'accès administrateur depuis l'écran de
          connexion si plus personne ne peut se connecter. Elle est générée au
          hasard, stockée uniquement sous forme d'empreinte et peut être
          régénérée à tout moment.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={generateKey} disabled={busy}>
            <ShieldCheck size={16} /> Générer une nouvelle clé
          </button>
          <button className="btn-ghost" onClick={repair} disabled={busy}>
            <Wrench size={16} /> Réparer / réinitialiser l'authentification
          </button>
        </div>
        {recoveryKey && (
          <p className="mt-4 select-all rounded-xl bg-slate-900 px-4 py-3 text-center font-mono text-lg tracking-widest text-white">
            {recoveryKey}
          </p>
        )}
        {message && (
          <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            {message}
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
          <ShieldCheck size={18} className="text-slate-400" />
          <h3 className="text-base font-bold text-slate-900">
            Journal de sécurité
          </h3>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Compte</th>
                <th className="px-5 py-3">Détail</th>
                <th className="px-5 py-3">Poste</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                    {formatDateTime(row.at)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={
                        row.success
                          ? "font-medium text-slate-800"
                          : "font-medium text-red-600"
                      }
                    >
                      {EVENT_LABELS[row.event] ?? row.event}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {row.user?.name ?? row.identifier ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{row.detail || "—"}</td>
                  <td className="px-5 py-3 text-slate-400">{row.station || "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                    Aucun événement enregistré.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
