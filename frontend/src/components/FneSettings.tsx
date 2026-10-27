import { useEffect, useState } from "react";
import { FileCheck2, Loader2 } from "lucide-react";
import api from "../api/client";
import type { FneSettings } from "../types";

/** Connexion à l'API officielle FNE (DGI) — onglet Paramètres, admin seul. */
export default function FneSettings() {
  const [form, setForm] = useState<FneSettings | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<FneSettings>("/fne/settings")
      .then((res) => setForm(res.data))
      .catch(() => setError("Impossible de charger la configuration FNE."));
  }, []);

  const update = (field: keyof FneSettings, value: string | boolean) =>
    setForm((f) => (f ? { ...f, [field]: value } : f));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const res = await api.put<FneSettings>("/fne/settings", {
        enabled: form.enabled,
        environment: form.environment,
        api_url: form.api_url.trim(),
        token_url: form.token_url.trim(),
        client_id: form.client_id.trim(),
        // Vides = inchangés : les secrets ne sont jamais renvoyés par l'API.
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      setForm(res.data);
      setClientSecret("");
      setApiKey("");
      setMessage("Configuration FNE enregistrée.");
    } catch {
      setError("Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  if (!form) return <p className="text-slate-500">{error || "Chargement…"}</p>;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <FileCheck2 className="text-brand-600" size={22} />
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            Facture Normalisée Électronique (DGI)
          </h2>
          <p className="text-sm text-slate-500">
            Connexion à la plateforme officielle. Inscrivez l'entreprise sur
            l'environnement de test FNE, puis renseignez l'URL et les
            identifiants remis dans votre espace (onglet « Paramétrage »). Les
            secrets saisis ne sont jamais réaffichés.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => update("enabled", e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-brand-600"
        />
        Activer la certification FNE des ventes
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          Environnement
          <select
            value={form.environment}
            onChange={(e) => update("environment", e.target.value)}
            className="input mt-1"
          >
            <option value="test">Test (recommandé d'abord)</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label className="text-sm text-slate-600">
          URL de l'API FNE
          <input
            value={form.api_url}
            onChange={(e) => update("api_url", e.target.value)}
            placeholder="https://…/api/…"
            className="input mt-1"
          />
        </label>
        <label className="text-sm text-slate-600">
          Clé API
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={form.credentials_configured ? "•••••• (enregistrée)" : ""}
            autoComplete="off"
            className="input mt-1"
          />
        </label>
        <label className="text-sm text-slate-600">
          Identifiant client (OAuth 2.0)
          <input
            value={form.client_id}
            onChange={(e) => update("client_id", e.target.value)}
            autoComplete="off"
            className="input mt-1"
          />
        </label>
        <label className="text-sm text-slate-600">
          URL du jeton OAuth 2.0
          <input
            value={form.token_url}
            onChange={(e) => update("token_url", e.target.value)}
            placeholder="https://…/oauth/token"
            className="input mt-1"
          />
        </label>
        <label className="text-sm text-slate-600">
          Secret client (OAuth 2.0)
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={form.credentials_configured ? "•••••• (enregistré)" : ""}
            autoComplete="off"
            className="input mt-1"
          />
        </label>
      </div>
      <p className="text-xs text-slate-400">
        Deux modes d'authentification prévus par la DGI : clé API seule, ou
        jeton OAuth 2.0 (URL du jeton + identifiant + secret). Renseignez celui
        indiqué par votre documentation d'inscription.
      </p>

      {form.enabled && !form.configured && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Configuration incomplète : l'URL de l'API et une clé API ou un jeton
          OAuth sont requis pour certifier une vente.
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      )}

      <button className="btn-primary" onClick={save} disabled={saving}>
        {saving && <Loader2 size={16} className="mr-1 inline animate-spin" />}
        Enregistrer
      </button>
    </section>
  );
}
