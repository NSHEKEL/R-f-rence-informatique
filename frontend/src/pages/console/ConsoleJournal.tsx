import { useEffect, useState } from "react";
import central, { centralError, type AdminLogEntry } from "../../api/central";

export default function ConsoleJournal() {
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    central
      .get<AdminLogEntry[]>("/logs", { params: { limit: 500 } })
      .then((res) => setLogs(res.data))
      .catch((err) => setError(centralError(err, "Journal indisponible")));
  }, []);

  const needle = filter.trim().toLowerCase();
  const rows = needle
    ? logs.filter((entry) =>
        [entry.action, entry.client_name, entry.admin_name]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
    : logs;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Journal</h1>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtrer par action, client ou administrateur"
        className="w-96 rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Administrateur</th>
              <th className="px-3 py-3">Client</th>
              <th className="px-3 py-3">Action</th>
              <th className="px-3 py-3">Ancienne valeur</th>
              <th className="px-3 py-3">Nouvelle valeur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((entry) => (
              <tr key={entry.id}>
                <td className="px-3 py-2.5 text-slate-500">
                  {new Date(entry.created_at).toLocaleString("fr-FR")}
                </td>
                <td className="px-3 py-2.5">{entry.admin_name || "—"}</td>
                <td className="px-3 py-2.5">{entry.client_name || "—"}</td>
                <td className="px-3 py-2.5 font-medium text-slate-900">
                  {entry.action}
                </td>
                <td className="px-3 py-2.5 text-slate-500">
                  {entry.old_value || "—"}
                </td>
                <td className="px-3 py-2.5 text-slate-500">
                  {entry.new_value || "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  Aucune action enregistrée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
