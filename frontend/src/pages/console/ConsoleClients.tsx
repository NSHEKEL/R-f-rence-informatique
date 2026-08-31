import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import central, {
  centralError,
  STATUS_STYLES,
  type ClientPage,
  type Plan,
} from "../../api/central";

function moment(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function day(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR");
}

const emptyClient = {
  company: "",
  manager: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  note: "",
  plan_code: "",
};

export default function ConsoleClients() {
  const navigate = useNavigate();
  const [page, setPage] = useState<ClientPage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [sort, setSort] = useState("company");
  const [number, setNumber] = useState(1);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyClient);

  const load = useCallback(() => {
    central
      .get<ClientPage>("/clients", {
        params: { search, status, plan, sort, page: number, size: 25 },
      })
      .then((res) => setPage(res.data))
      .catch((err) => setError(centralError(err, "Liste indisponible")));
  }, [search, status, plan, sort, number]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    central
      .get<Plan[]>("/plans")
      .then((res) => setPlans(res.data))
      .catch(() => setPlans([]));
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const res = await central.post<{ id: number }>("/clients", draft);
      setCreating(false);
      setDraft(emptyClient);
      navigate(`/console/clients/${res.data.id}`);
    } catch (err) {
      setError(centralError(err, "Création impossible"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900">Mes clients</h1>
        <span className="text-sm text-slate-500">
          {page ? `${page.total} client(s)` : ""}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft({ ...emptyClient, plan_code: plans[0]?.code ?? "" });
            setCreating(true);
          }}
          className="ml-auto flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} /> Nouveau client
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
          <Search size={16} className="text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setNumber(1);
              setSearch(e.target.value);
            }}
            placeholder="Entreprise, responsable, e-mail, identifiant..."
            className="w-72 text-sm outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setNumber(1);
            setStatus(e.target.value);
          }}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Tous les statuts</option>
          <option value="active">Active</option>
          <option value="suspended">Suspendue</option>
          <option value="expired">Expirée</option>
          <option value="revoked">Révoquée</option>
        </select>
        <select
          value={plan}
          onChange={(e) => {
            setNumber(1);
            setPlan(e.target.value);
          }}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Toutes les formules</option>
          {plans.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="company">Trier par entreprise</option>
          <option value="plan">Trier par formule</option>
          <option value="status">Trier par statut</option>
          <option value="ends_at">Trier par expiration</option>
          <option value="last_sync">Trier par synchronisation</option>
          <option value="users">Trier par utilisateurs</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">ID</th>
              <th className="px-3 py-3">Entreprise</th>
              <th className="px-3 py-3">Responsable</th>
              <th className="px-3 py-3">Téléphone</th>
              <th className="px-3 py-3">E-mail</th>
              <th className="px-3 py-3">Ville</th>
              <th className="px-3 py-3">Installation</th>
              <th className="px-3 py-3">Formule</th>
              <th className="px-3 py-3">Activation</th>
              <th className="px-3 py-3">Expiration</th>
              <th className="px-3 py-3">Statut</th>
              <th className="px-3 py-3">Dernière connexion</th>
              <th className="px-3 py-3">Dernière synchro</th>
              <th className="px-3 py-3">Version</th>
              <th className="px-3 py-3">Utilisateurs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {page?.rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(`/console/clients/${row.id}`)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-3 py-2.5 text-slate-500">#{row.id}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-900">
                  {row.company}
                  {row.online && (
                    <span className="ml-2 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  )}
                </td>
                <td className="px-3 py-2.5">{row.manager || "—"}</td>
                <td className="px-3 py-2.5">{row.phone || "—"}</td>
                <td className="px-3 py-2.5">{row.email || "—"}</td>
                <td className="px-3 py-2.5">{row.city || "—"}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-500">
                  {row.installation_uid
                    ? `${row.installation_uid.slice(0, 10)}…`
                    : "—"}
                </td>
                <td className="px-3 py-2.5">{row.plan_name || "—"}</td>
                <td className="px-3 py-2.5">{day(row.starts_at)}</td>
                <td className="px-3 py-2.5">{day(row.ends_at)}</td>
                <td className="px-3 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {row.status_label || row.status}
                  </span>
                </td>
                <td className="px-3 py-2.5">{moment(row.last_seen)}</td>
                <td className="px-3 py-2.5">{moment(row.last_sync)}</td>
                <td className="px-3 py-2.5">{row.version || "—"}</td>
                <td className="px-3 py-2.5">{row.users_count}</td>
              </tr>
            ))}
            {page && page.rows.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-8 text-center text-slate-500">
                  Aucun client
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {page && page.pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={number <= 1}
            onClick={() => setNumber((n) => n - 1)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
          >
            Précédent
          </button>
          <span>
            Page {page.page} / {page.pages}
          </span>
          <button
            type="button"
            disabled={number >= page.pages}
            onClick={() => setNumber((n) => n + 1)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
          >
            Suivant
          </button>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={create}
            className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-6 shadow-xl"
          >
            <p className="text-lg font-bold text-slate-900">Nouveau client</p>
            <input
              required
              placeholder="Entreprise"
              value={draft.company}
              onChange={(e) => setDraft({ ...draft, company: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Responsable"
                value={draft.manager}
                onChange={(e) => setDraft({ ...draft, manager: e.target.value })}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Téléphone"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="E-mail"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Ville"
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <select
              required
              value={draft.plan_code}
              onChange={(e) => setDraft({ ...draft, plan_code: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Formule...</option>
              {plans.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Créer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
