import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, MailWarning, Search } from "lucide-react";
import central, { centralError } from "../../api/central";

interface SupportRequest {
  id: number;
  client_id: number;
  client_name: string;
  installation_uid: string;
  shop_name: string;
  local_id: number;
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
  status: string;
  internal_note: string;
  email_sent: boolean;
  email_attempts: number;
  email_error: string;
  created_at: string | null;
}

const STATUSES: { value: string; label: string }[] = [
  { value: "nouvelle", label: "Nouvelle" },
  { value: "en_cours", label: "En cours" },
  { value: "resolue", label: "Résolue" },
  { value: "fermee", label: "Fermée" },
];

const CATEGORIES = ["assistance", "bug", "suggestion", "critique", "autre"];

const statusBadge: Record<string, string> = {
  nouvelle: "bg-brand-50 text-brand-700",
  en_cours: "bg-amber-50 text-amber-700",
  resolue: "bg-emerald-50 text-emerald-700",
  fermee: "bg-slate-100 text-slate-500",
};

export default function ConsoleSuggestions() {
  const [items, setItems] = useState<SupportRequest[]>([]);
  const [selected, setSelected] = useState<SupportRequest | null>(null);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await central.get<SupportRequest[]>(
        "/support-requests",
        {
          params: {
            status: status || undefined,
            category: category || undefined,
            q: query || undefined,
          },
        }
      );
      setItems(data);
    } catch (err) {
      setError(centralError(err, "Impossible de charger les demandes"));
    }
  }, [status, category, query]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (row: SupportRequest) => {
    setSelected(row);
    setNote(row.internal_note);
    setSaved("");
    // A demand the admin opens leaves "nouvelle" for "en cours" unless they
    // already chose another status.
    if (row.status === "nouvelle") {
      await update(row.id, { status: "en_cours" });
    }
  };

  const update = async (id: number, patch: { status?: string; internal_note?: string }) => {
    try {
      const { data } = await central.put<SupportRequest>(
        `/support-requests/${id}`,
        patch
      );
      setItems((list) => list.map((r) => (r.id === id ? data : r)));
      setSelected((cur) => (cur?.id === id ? data : cur));
      setSaved("Enregistré");
      setTimeout(() => setSaved(""), 2000);
    } catch (err) {
      setError(centralError(err, "Enregistrement impossible"));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-slate-900">
          Suggestions et critiques
        </h1>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Tous les statuts</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Toutes catégories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="rounded-lg border border-slate-300 py-1.5 pl-8 pr-2 text-sm"
              placeholder="Rechercher…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Client / Magasin</th>
                <th className="px-4 py-3">Catégorie</th>
                <th className="px-4 py-3">Sujet</th>
                <th className="px-4 py-3">Statut</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => open(row)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                    selected?.id === row.id ? "bg-brand-50/50" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                    {row.created_at
                      ? new Date(row.created_at).toLocaleString("fr-FR")
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="block font-semibold text-slate-800">
                      {row.client_name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {row.shop_name || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{row.category}</td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 font-medium">
                    {row.subject}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        statusBadge[row.status] || ""
                      }`}
                    >
                      {STATUSES.find((s) => s.value === row.status)?.label ||
                        row.status}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Aucune demande reçue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          {selected ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {selected.subject}
                </h2>
                <p className="text-xs text-slate-400">
                  #{selected.id} ·{" "}
                  {selected.created_at
                    ? new Date(selected.created_at).toLocaleString("fr-FR")
                    : ""}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">De</dt>
                  <dd className="font-semibold">
                    {selected.name}
                    {selected.email ? ` <${selected.email}>` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Client / Magasin</dt>
                  <dd className="font-semibold">
                    {selected.client_name} — {selected.shop_name || "—"}
                  </dd>
                </div>
              </dl>
              <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                {selected.message}
              </p>
              <p className="flex items-center gap-1.5 text-xs">
                {selected.email_sent ? (
                  <span className="flex items-center gap-1 font-semibold text-emerald-600">
                    <CheckCircle2 size={14} /> Alerte e-mail envoyée
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-semibold text-amber-600">
                    <MailWarning size={14} /> Alerte e-mail non envoyée
                    {selected.email_attempts
                      ? ` (${selected.email_attempts} essai(s)${selected.email_error ? ` — ${selected.email_error}` : ""})`
                      : " — SMTP non configuré"}
                  </span>
                )}
              </p>
              <label className="block text-sm font-semibold text-slate-700">
                Statut
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={selected.status}
                  onChange={(e) =>
                    update(selected.id, { status: e.target.value })
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-semibold text-slate-700">
                Note interne (invisible pour le client)
                <textarea
                  className="mt-1 min-h-[90px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={5000}
                />
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => update(selected.id, { internal_note: note })}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
                >
                  Enregistrer la note
                </button>
                {saved && (
                  <span className="text-sm font-semibold text-emerald-600">
                    {saved}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-slate-400">
              Sélectionnez une demande pour lire le message complet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
