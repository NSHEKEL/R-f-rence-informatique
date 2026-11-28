import { useEffect, useState } from "react";
import api from "../api/client";

interface LogInfo {
  folder: string;
  file: string;
  can_open: boolean;
  local?: boolean;
}

interface LogBridge {
  log_info?: () => Promise<LogInfo>;
  open_logs_folder?: (folder: string) => Promise<unknown>;
}

function bridge(): LogBridge | undefined {
  return (window as unknown as { pywebview?: { api?: LogBridge } }).pywebview?.api;
}

export default function LogDiagnostics() {
  const [server, setServer] = useState<LogInfo | null>(null);
  const [local, setLocal] = useState<LogInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      const [remote, native] = await Promise.allSettled([
        api.get<LogInfo>("/settings/logs"),
        bridge()?.log_info?.() ?? Promise.resolve(null),
      ]);
      if (!active || current !== generation) return;
      const remoteInfo = remote.status === "fulfilled" && remote.value.data?.folder ? remote.value.data : null;
      const localInfo = native.status === "fulfilled" && native.value?.folder ? native.value : null;
      setServer(remoteInfo);
      setLocal(localInfo);
      setError(!remoteInfo && !localInfo
        ? "Chemin des journaux indisponible. Reconnectez-vous avec un compte administrateur ou utilisez l'application de bureau."
        : "");
    };
    void load();
    window.addEventListener("pywebviewready", load);
    return () => { active = false; window.removeEventListener("pywebviewready", load); };
  }, []);

  async function open(info: LogInfo, native: boolean) {
    setError("");
    try {
      const nativeApi = bridge();
      if (native && nativeApi?.open_logs_folder) await nativeApi.open_logs_folder(info.folder);
      else await api.post("/settings/logs/open");
    } catch {
      setError("Impossible d'ouvrir ce dossier. Copiez le chemin affiché dans l'Explorateur du PC concerné.");
    }
  }

  const nativeOpen = Boolean(bridge()?.open_logs_folder);
  const own = local && (!server?.local || server.folder !== local.folder) ? local : null;
  return <section className="card space-y-3 p-6" aria-label="Diagnostic et journaux">
    <h3 className="font-bold">Diagnostic et journaux</h3>
    <p className="text-sm text-slate-600">En cas d'erreur, transmettez le fichier easygest.log au support. Les journaux du serveur et de ce poste peuvent être dans des dossiers différents.</p>
    {server && <div className="space-y-2 text-sm"><p>PC serveur : <code className="break-all">{server.file}</code></p><button type="button" className="btn-secondary" disabled={!server.can_open && !(server.local && nativeOpen)} onClick={() => void open(server, Boolean(server.local && nativeOpen))}>Ouvrir le dossier des journaux</button>{!server.local && <p>Ouvrez ce chemin sur le PC serveur, pas sur ce poste distant.</p>}</div>}
    {own && <div className="space-y-2 text-sm"><p>Ce poste : <code className="break-all">{own.file}</code></p><button type="button" className="btn-secondary" disabled={!own.can_open || !nativeOpen} onClick={() => void open(own, true)}>Ouvrir le dossier des journaux de ce poste</button></div>}
    {!server && !local && !error && <p className="text-sm">Recherche du dossier des journaux…</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>;
}
