import { CloudOff, RefreshCw, Wifi, X } from "lucide-react";
import { useNetwork } from "../context/NetworkContext";

/** Connection state shown on every screen, with the offline ticket count. */
export default function NetworkBanner() {
  const {
    online,
    serverReachable,
    workstationStatus,
    pendingCount,
    justReconnected,
    syncErrors,
    rejected,
    dismissRejectedSale,
  } = useNetwork();

  return (
    <div className="no-print space-y-2 px-5 pt-4 lg:px-7">
      <div className={`flex items-center gap-2 text-xs font-medium ${online ? "text-emerald-700" : "text-amber-800"}`}>
        {online ? <Wifi size={13} /> : <CloudOff size={13} />}
        {online ? "Serveur connecté" : serverReachable ? "Serveur joignable — poste non autorisé" : "Serveur déconnecté"}
      </div>
      {serverReachable && workstationStatus && workstationStatus !== "approved" && <div className="rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
        <strong>{workstationStatus === "blocked" ? "Ce poste est bloqué." : "Ce poste est en attente d'autorisation."}</strong> Sur l'ordinateur principal, demandez à un administrateur d'ouvrir Configuration → Réseau et d'autoriser l'adresse IP de ce poste. Les tickets en attente restent conservés localement.
      </div>}
      {!online && !serverReachable && (
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
      {(rejected.length > 0 || syncErrors.length > 0) && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">
            Tickets refusés par le serveur — à resaisir :
          </p>
          <ul className="mt-1 space-y-1">
            {rejected.map((entry) => (
              <li
                key={entry.snapshot.reference}
                className="flex items-center gap-2"
              >
                <span>
                  {entry.snapshot.reference} — {entry.reason} (total{" "}
                  {entry.snapshot.total})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    dismissRejectedSale(entry.snapshot.reference)
                  }
                  className="ml-auto flex items-center gap-1 rounded-lg bg-red-100 px-2 py-0.5 text-xs font-semibold hover:bg-red-200"
                  title="Marquer comme resaisi"
                >
                  <X size={12} /> Resaisi
                </button>
              </li>
            ))}
            {rejected.length === 0 &&
              syncErrors.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
