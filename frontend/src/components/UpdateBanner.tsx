import { useCallback, useEffect, useState } from "react";
import { DownloadCloud, X } from "lucide-react";
import axios from "axios";
import { localApi } from "../api/client";
import type { UpdateStatus } from "../types";

const DISMISSED_KEY = "ri_update_dismissed";
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/**
 * Offers the new version on the workstation the user sits at — the update
 * replaces the program installed here, not the one on the central server.
 */
export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const check = useCallback(async () => {
    try {
      const { data } = await localApi.get<UpdateStatus>("/updates");
      setStatus(data);
      if (localStorage.getItem(DISMISSED_KEY) !== data.latest_version) {
        setHidden(false);
      }
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL);
    return () => window.clearInterval(timer);
  }, [check]);

  async function install() {
    setBusy(true);
    setMessage("Téléchargement et installation en cours...");
    try {
      await localApi.post("/updates/install");
      setMessage(
        "Mise à jour lancée : l'application se ferme et redémarre toute " +
          "seule dans quelques secondes."
      );
    } catch (err) {
      setBusy(false);
      setMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Échec de la mise à jour"
          : "Échec de la mise à jour"
      );
    }
  }

  if (!status?.available || !status.packaged || hidden) return null;

  function dismiss() {
    if (status) localStorage.setItem(DISMISSED_KEY, status.latest_version);
    setHidden(true);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-brand-50 px-5 py-3 text-sm text-brand-900">
      <DownloadCloud size={18} className="text-brand-600" />
      <span>
        Version <b>{status.latest_version}</b> disponible sur cet ordinateur
        (installée : {status.current_version}).
      </span>
      <button className="btn-primary py-1.5" onClick={install} disabled={busy}>
        Mettre à jour maintenant
      </button>
      {message && <span className="text-brand-700">{message}</span>}
      <button
        className="ml-auto rounded-lg p-1 text-brand-700 hover:bg-brand-100"
        onClick={dismiss}
        aria-label="Masquer"
      >
        <X size={16} />
      </button>
    </div>
  );
}
