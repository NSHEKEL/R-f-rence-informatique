import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useNetwork } from "../context/NetworkContext";

/** Connection state shown on every screen, with the offline ticket count. */
export default function NetworkBanner() {
  const { online, pendingCount, justReconnected, syncErrors } = useNetwork();

  if (online && !justReconnected && syncErrors.length === 0) return null;

  return (
    <div className="no-print space-y-2 px-5 pt-4 lg:px-7">
      {!online && (
        <div className="flex items-center gap-3 rounded-xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900">
          <CloudOff size={18} />
          <span>
            Pas de réseau, l'application fonctionne et se mettra à jour quand le
            réseau sera rétabli.
          </span>
          {pendingCount > 0 && (
            <span className="ml-auto flex items-center gap-1.5 rounded-lg bg-amber-200 px-2.5 py-1 text-xs">
              <RefreshCw size={13} /> {pendingCount} ticket(s) en attente
            </span>
          )}
        </div>
      )}
      {online && justReconnected && (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-900">
          <Wifi size={18} />
          <span>Vous êtes connecté au réseau</span>
          {pendingCount > 0 && (
            <span className="ml-auto text-xs">
              Synchronisation de {pendingCount} ticket(s)...
            </span>
          )}
        </div>
      )}
      {syncErrors.length > 0 && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">Tickets non synchronisés :</p>
          <ul className="mt-1 list-inside list-disc">
            {syncErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
