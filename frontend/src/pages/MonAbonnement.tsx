import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Lock, RefreshCw } from "lucide-react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useLicense } from "../context/LicenseContext";

interface OfferedPlan {
  code: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  duration_days: number;
  features: string[];
}

function moment(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function errorText(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { data?: { detail?: unknown } } }).response
      ?.data?.detail === "string"
  ) {
    return (error as { response: { data: { detail: string } } }).response.data
      .detail;
  }
  return fallback;
}

/** "Mon abonnement": what the shop pays for, and the first registration. */
export default function MonAbonnement() {
  const { license, refresh } = useLicense();
  const { isAdmin } = useAuth();
  const { company } = useCompany();
  const [plans, setPlans] = useState<OfferedPlan[]>([]);
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState("");
  const [form, setForm] = useState({
    company: "",
    manager: "",
    phone: "",
    email: "",
    address: "",
    city: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!license) return;
    setUrl((current) => current || license.central_url);
  }, [license]);

  useEffect(() => {
    if (!company) return;
    setForm((current) => ({
      ...current,
      company: current.company || company.name || "",
      phone: current.phone || company.phone || "",
      email: current.email || company.email || "",
      address: current.address || company.address || "",
    }));
  }, [company]);

  const loadPlans = useCallback(
    async (target: string) => {
      if (!target.trim()) return;
      setError("");
      try {
        const res = await api.get<OfferedPlan[]>("/license/plans", {
          params: { url: target.trim() },
        });
        setPlans(res.data);
        setChosen((code) => code || res.data[0]?.code || "");
      } catch (err) {
        setPlans([]);
        setError(errorText(err, "Serveur central injoignable"));
      }
    },
    []
  );

  useEffect(() => {
    if (license && !license.registered && license.central_url) {
      void loadPlans(license.central_url);
    }
  }, [license, loadPlans]);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post("/license/register", {
        central_url: url.trim(),
        plan_code: chosen,
        ...form,
      });
      setNotice("Licence activée.");
      await refresh();
    } catch (err) {
      setError(errorText(err, "Enregistrement impossible"));
    } finally {
      setBusy(false);
    }
  }

  async function synchronise() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post("/license/sync");
      setNotice("Synchronisation effectuée.");
      await refresh();
    } catch (err) {
      setError(errorText(err, "Synchronisation impossible"));
    } finally {
      setBusy(false);
    }
  }

  if (!license) {
    return <p className="text-sm text-slate-500">Chargement...</p>;
  }

  const local = license.mode === "local";
  const soon =
    license.days_left !== null && license.days_left >= 0 && license.days_left <= 15;

  return (
    <div className="space-y-5">
      {license.blocked && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {license.message}
        </p>
      )}
      {!license.blocked && soon && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Votre licence expire dans {license.days_left} jour(s), le{" "}
          {moment(license.ends_at)}.
        </p>
      )}

      {local && !license.central_url && (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          Cette installation fonctionne en autonomie : aucun serveur central
          n&apos;est configuré, toutes les fonctionnalités sont disponibles.
        </p>
      )}

      {!license.registered && isAdmin && (
        <form
          onSubmit={register}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-sm"
        >
          <p className="text-lg font-bold text-slate-900">
            Choisissez votre formule
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">
                Adresse du serveur central
              </span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://central.easygest.ci"
                className="w-80 rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadPlans(url)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium"
            >
              Voir les formules
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((plan) => (
              <button
                key={plan.code}
                type="button"
                onClick={() => setChosen(plan.code)}
                className={`rounded-2xl border p-4 text-left ${
                  chosen === plan.code
                    ? "border-brand-500 bg-brand-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <p className="text-base font-bold text-slate-900">{plan.name}</p>
                <p className="text-sm text-slate-500">{plan.description}</p>
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  {plan.price.toLocaleString("fr-FR")} {plan.currency} /{" "}
                  {plan.duration_days} jours
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {plan.features.length} fonctionnalité(s)
                </p>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required
              placeholder="Nom de l'entreprise"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Responsable"
              value={form.manager}
              onChange={(e) => setForm({ ...form, manager: e.target.value })}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Téléphone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="E-mail"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Adresse"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Ville"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={busy || !chosen}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Activation..." : "Activer ma licence"}
          </button>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-700">Ma formule</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {license.plan_name || (local ? "Installation autonome" : "—")}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Statut : {license.blocked ? license.message : "à jour"}
          </p>
          <p className="text-sm text-slate-500">
            Expiration : {moment(license.ends_at)}
          </p>
          <p className="text-sm text-slate-500">
            Période de grâce : {license.grace_days} jour(s)
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-700">Installation</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-600">
            {license.installation_uid}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Client : {license.client_name || "—"}
          </p>
          <p className="text-sm text-slate-500">
            Clé : {license.license_key || "—"}
          </p>
          <p className="text-sm text-slate-500">
            Dernière synchronisation :{" "}
            {license.last_sync
              ? new Date(license.last_sync).toLocaleString("fr-FR")
              : "—"}
          </p>
          {license.last_error && (
            <p className="mt-1 text-sm text-amber-700">{license.last_error}</p>
          )}
          {isAdmin && license.registered && (
            <button
              type="button"
              onClick={() => void synchronise()}
              disabled={busy}
              className="mt-3 flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              <RefreshCw size={16} /> Synchroniser maintenant
            </button>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-700">Serveur central</p>
          <p className="mt-1 break-all text-sm text-slate-600">
            {license.central_url || "aucun"}
          </p>
          {notice && <p className="mt-2 text-sm text-emerald-700">{notice}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">
          Fonctionnalités
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {license.catalogue.map((feature) => (
            <div
              key={feature.code}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                feature.allowed
                  ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              {feature.allowed ? (
                <CheckCircle2 size={16} />
              ) : (
                <Lock size={16} />
              )}
              <span>
                {feature.allowed
                  ? feature.name
                  : `🔒 ${feature.name} — non incluse dans votre formule`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
