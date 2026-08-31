import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import central, { centralError, type Plan } from "../../api/central";

const emptyPlan = {
  code: "",
  name: "",
  description: "",
  price: 0,
  duration_days: 365,
  grace_days: 7,
};

/** "Formules & Droits": one ON/OFF switch per feature and per plan. */
export default function ConsolePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyPlan);

  function load() {
    central
      .get<Plan[]>("/plans")
      .then((res) => {
        setPlans(res.data);
        setSelected((code) => code || res.data[0]?.code || "");
      })
      .catch((err) => setError(centralError(err, "Formules indisponibles")));
  }

  useEffect(load, []);

  const plan = plans.find((item) => item.code === selected);

  async function toggle(code: string, allowed: boolean) {
    if (!plan) return;
    setError("");
    try {
      const res = await central.put<Plan>(`/plans/${plan.id}/rights`, {
        feature_code: code,
        allowed,
      });
      setPlans((list) =>
        list.map((item) => (item.id === res.data.id ? res.data : item))
      );
    } catch (err) {
      setError(centralError(err, "Modification impossible"));
    }
  }

  async function save(changes: Partial<Plan>) {
    if (!plan) return;
    try {
      const res = await central.put<Plan>(`/plans/${plan.id}`, changes);
      setPlans((list) =>
        list.map((item) => (item.id === res.data.id ? res.data : item))
      );
    } catch (err) {
      setError(centralError(err, "Enregistrement impossible"));
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      const res = await central.post<Plan>("/plans", draft);
      setCreating(false);
      setDraft(emptyPlan);
      setPlans((list) => [...list, res.data]);
      setSelected(res.data.code);
    } catch (err) {
      setError(centralError(err, "Création impossible"));
    }
  }

  const sections = plan
    ? [...new Set(plan.rights.map((right) => right.section || "Autres"))]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900">Formules &amp; Droits</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} /> Nouvelle formule
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {plans.map((item) => (
          <button
            key={item.code}
            type="button"
            onClick={() => setSelected(item.code)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              item.code === selected
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 shadow-sm"
            }`}
          >
            {item.name}
            <span className="ml-2 text-xs font-normal opacity-70">
              {item.clients_count} client(s)
            </span>
          </button>
        ))}
      </div>

      {plan && (
        <>
          <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Nom</span>
              <input
                defaultValue={plan.name}
                onBlur={(e) => void save({ name: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Prix ({plan.currency})</span>
              <input
                type="number"
                defaultValue={plan.price}
                onBlur={(e) => void save({ price: Number(e.target.value) })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Durée (jours)</span>
              <input
                type="number"
                defaultValue={plan.duration_days}
                onBlur={(e) =>
                  void save({ duration_days: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Grâce (jours)</span>
              <input
                type="number"
                defaultValue={plan.grace_days}
                onBlur={(e) => void save({ grace_days: Number(e.target.value) })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm sm:col-span-3">
              <span className="mb-1 block text-slate-500">Description</span>
              <input
                defaultValue={plan.description}
                onBlur={(e) => void save({ description: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={plan.is_public}
                onChange={(e) => void save({ is_public: e.target.checked })}
              />
              Proposée à l&apos;installation
            </label>
          </div>

          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-slate-700">
                  {section}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {plan.rights
                    .filter((right) => (right.section || "Autres") === section)
                    .map((right) => (
                      <label
                        key={right.code}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <span>{right.name}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={right.allowed}
                          aria-label={right.name}
                          onClick={() => void toggle(right.code, !right.allowed)}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                            right.allowed ? "bg-emerald-500" : "bg-slate-300"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                              right.allowed ? "left-[22px]" : "left-0.5"
                            }`}
                          />
                        </button>
                      </label>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={create}
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl"
          >
            <p className="text-lg font-bold text-slate-900">Nouvelle formule</p>
            <input
              required
              placeholder="Code (ex. business_plus)"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Nom affiché"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Description"
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-3 gap-3">
              <input
                type="number"
                value={draft.price}
                onChange={(e) =>
                  setDraft({ ...draft, price: Number(e.target.value) })
                }
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={draft.duration_days}
                onChange={(e) =>
                  setDraft({ ...draft, duration_days: Number(e.target.value) })
                }
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={draft.grace_days}
                onChange={(e) =>
                  setDraft({ ...draft, grace_days: Number(e.target.value) })
                }
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
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
