import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import central, {
  centralError,
  STATUS_STYLES,
  type AdminLogEntry,
  type ClientDetail,
  type Installation,
  type MagasinStats,
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

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}

/** Full record of one client: licence, installations, rights and history. */
export default function ConsoleClient() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [graceDays, setGraceDays] = useState("");
  const [about, setAbout] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [stats, setStats] = useState<MagasinStats[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await central.get<ClientDetail>(`/clients/${id}`);
      setClient(res.data);
      setEndsAt(res.data.license?.ends_at?.slice(0, 10) ?? "");
      setGraceDays(String(res.data.license?.grace_days ?? 7));
      setAbout(res.data.about ?? "");
      const history = await central.get<AdminLogEntry[]>("/logs", {
        params: { client_id: id, limit: 30 },
      });
      setLogs(history.data);
      const magasins = await central.get<MagasinStats[]>(
        `/clients/${id}/magasins/stats`
      );
      setStats(magasins.data);
    } catch (err) {
      setError(centralError(err, "Client introuvable"));
    }
  }, [id]);

  useEffect(() => {
    void load();
    central
      .get<Plan[]>("/plans")
      .then((res) => setPlans(res.data))
      .catch(() => setPlans([]));
  }, [load]);

  async function run(label: string, call: () => Promise<unknown>) {
    setError("");
    setNotice("");
    try {
      await call();
      setNotice(`${label} : effectué`);
      await load();
    } catch (err) {
      setError(centralError(err, `${label} impossible`));
    }
  }

  if (error && !client) return <p className="text-sm text-red-600">{error}</p>;
  if (!client) return <p className="text-sm text-slate-500">Chargement...</p>;

  const licence = client.license;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate("/console/clients")}
        className="flex items-center gap-2 text-sm text-slate-600"
      >
        <ArrowLeft size={16} /> Mes clients
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900">{client.company}</h1>
        {licence && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              STATUS_STYLES[licence.status] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {licence.status_label || licence.status}
          </span>
        )}
      </div>

      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-slate-700">
            Informations générales
          </p>
          <Line label="Responsable" value={client.manager || "—"} />
          <Line label="Téléphone" value={client.phone || "—"} />
          <Line label="E-mail" value={client.email || "—"} />
          <Line label="Adresse" value={client.address || "—"} />
          <Line label="Ville" value={client.city || "—"} />
          <Line label="Créé le" value={moment(client.created_at)} />
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-slate-700">Licence</p>
          <Line label="Formule" value={licence?.plan_name ?? "—"} />
          <Line label="Clé" value={licence?.key ?? "—"} />
          <Line label="Début" value={moment(licence?.starts_at ?? null)} />
          <Line label="Fin" value={moment(licence?.ends_at ?? null)} />
          <Line
            label="Jours restants"
            value={licence?.days_left === null || licence === null
              ? "—"
              : String(licence.days_left)}
          />
          <Line label="Grâce" value={`${licence?.grace_days ?? 0} jour(s)`} />
          {licence?.suspended_reason && (
            <Line label="Motif" value={licence.suspended_reason} />
          )}
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-slate-700">
            Fonctionnalités autorisées
          </p>
          <div className="flex flex-wrap gap-1.5">
            {client.features.map((code) => (
              <span
                key={code}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
              >
                {code}
              </span>
            ))}
            {client.features.length === 0 && (
              <span className="text-sm text-slate-500">Aucune</span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">
          Actions à distance
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={licence?.plan_code ?? ""}
            onChange={(e) =>
              void run("Changement de formule", () =>
                central.put(`/clients/${client.id}/plan`, {
                  plan_code: e.target.value,
                })
              )
            }
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            {plans.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name}
              </option>
            ))}
          </select>
          {[
            ["activer", "Activer"],
            ["suspendre", "Suspendre"],
            ["reactiver", "Réactiver"],
            ["expirer", "Expirer"],
          ].map(([action, label]) => (
            <button
              key={action}
              type="button"
              onClick={() =>
                void run(label, () =>
                  central.post(`/clients/${client.id}/license`, { action })
                )
              }
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              void run("Renouvellement", () =>
                central.post(`/clients/${client.id}/renew`, {
                  duration_days: 365,
                })
              )
            }
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            Renouveler 1 an
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500">
              Date de fin
            </label>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">
              Période de grâce (jours)
            </label>
            <input
              type="number"
              min={0}
              value={graceDays}
              onChange={(e) => setGraceDays(e.target.value)}
              className="w-32 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              void run("Mise à jour de la licence", () =>
                central.post(`/clients/${client.id}/renew`, {
                  ends_at: endsAt ? `${endsAt}T00:00:00` : null,
                  grace_days: Number(graceDays) || 0,
                })
              )
            }
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
          >
            Enregistrer les dates
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">
          Administrateurs du client
        </p>
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Nom</th>
              <th className="py-2">Identifiant</th>
              <th className="py-2">État</th>
              <th className="py-2">Modifié le</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {client.admins.map((entry) => (
              <tr key={entry.id}>
                <td className="py-2">{entry.name}</td>
                <td className="py-2">{entry.email}</td>
                <td className="py-2">
                  {entry.is_active ? "Actif" : "Désactivé"}
                </td>
                <td className="py-2">{moment(entry.updated_at)}</td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void run("Modification de l'administrateur", () =>
                          central.put(
                            `/clients/${client.id}/admins/${entry.id}`,
                            { is_active: !entry.is_active }
                          )
                        )
                      }
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                    >
                      {entry.is_active ? "Désactiver" : "Activer"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const value = window.prompt(
                          `Nouveau mot de passe pour ${entry.email}`
                        );
                        if (!value) return;
                        void run("Changement de mot de passe", () =>
                          central.put(
                            `/clients/${client.id}/admins/${entry.id}`,
                            { password: value }
                          )
                        );
                      }}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                    >
                      Mot de passe
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Retirer l'administrateur ${entry.email} ? Son compte sera désactivé chez le client, son historique reste intact.`
                          )
                        )
                          return;
                        void run("Suppression de l'administrateur", () =>
                          central.delete(
                            `/clients/${client.id}/admins/${entry.id}`
                          )
                        );
                      }}
                      className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600"
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {client.admins.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">
                  Aucun administrateur piloté depuis la console
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500">Nom</label>
            <input
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="Administrateur"
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">Identifiant</label>
            <input
              value={adminEmail}
              placeholder="admin"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">
              Mot de passe
            </label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              void run("Création de l'administrateur", async () => {
                await central.post(`/clients/${client.id}/admins`, {
                  name: adminName || "Administrateur",
                  email: adminEmail,
                  password: adminPassword,
                });
                setAdminName("");
                setAdminEmail("");
                setAdminPassword("");
              })
            }
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            Ajouter
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Le poste du client crée ou met à jour ces comptes à sa prochaine
          synchronisation. Un compte retiré est désactivé, jamais effacé :
          l'historique des connexions et des ventes reste consultable.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">
          À propos de nous (texte affiché chez le client)
        </p>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={6}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() =>
            void run("Mise à jour d'« À propos »", () =>
              central.put(`/clients/${client.id}/about`, { about })
            )
          }
          className="mt-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          Enregistrer
        </button>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">
          Magasins — activité comparée
        </p>
        {stats.length > 0 ? (
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Magasin</th>
                <th className="py-2">Ville</th>
                <th className="py-2">Ventes (période)</th>
                <th className="py-2">CA (période)</th>
                <th className="py-2">Ventes du jour</th>
                <th className="py-2">CA du jour</th>
                <th className="py-2">Top articles</th>
                <th className="py-2">Dernière vente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.map((s) => (
                <tr key={s.installation_uid} className={s.is_active ? "" : "opacity-50"}>
                  <td className="py-2 font-semibold">
                    {s.shop_name || "—"}
                    {!s.is_active && (
                      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                        désactivé
                      </span>
                    )}
                  </td>
                  <td className="py-2">{s.city || "—"}</td>
                  <td className="py-2">{s.ventes}</td>
                  <td className="py-2">
                    {s.chiffre_affaires.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="py-2">{s.ventes_jour}</td>
                  <td className="py-2">
                    {s.ca_jour.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="max-w-[220px] py-2 text-xs text-slate-600">
                    {s.top_produits.length
                      ? s.top_produits
                          .map((p) => `${p.name} ×${p.quantity}`)
                          .join(", ")
                      : "—"}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {moment(s.derniere_vente)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-4 text-center text-sm text-slate-500">
            Aucune vente copiée pour l'instant.
          </p>
        )}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">
          Magasins — fiches (nom, ville, adresse, responsable, actif)
        </p>
        <div className="space-y-3">
          {client.installations.map((inst) => (
            <MagasinForm
              key={inst.id}
              clientId={client.id}
              installation={inst}
              onSaved={load}
            />
          ))}
          {client.installations.length === 0 && (
            <p className="py-2 text-sm text-slate-500">
              Aucune installation enregistrée.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">
          Installations
        </p>
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Identifiant</th>
              <th className="py-2">Poste</th>
              <th className="py-2">Version</th>
              <th className="py-2">Utilisateurs</th>
              <th className="py-2">Adresse</th>
              <th className="py-2">Dernière connexion</th>
              <th className="py-2">Dernière synchro</th>
              <th className="py-2">État</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {client.installations.map((installation) => (
              <tr key={installation.id}>
                <td className="py-2 font-mono text-xs">{installation.uid}</td>
                <td className="py-2">{installation.hostname || "—"}</td>
                <td className="py-2">{installation.version || "—"}</td>
                <td className="py-2">{installation.users_count}</td>
                <td className="py-2">{installation.last_ip || "—"}</td>
                <td className="py-2">{moment(installation.last_seen)}</td>
                <td className="py-2">{moment(installation.last_sync)}</td>
                <td className="py-2">
                  {installation.is_revoked
                    ? "Révoquée"
                    : installation.online
                      ? "En ligne"
                      : "Hors ligne"}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        installation.is_revoked
                          ? "Réautorisation"
                          : "Révocation",
                        () =>
                          central.post(
                            `/installations/${installation.id}/revoke`
                          )
                      )
                    }
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                  >
                    {installation.is_revoked ? "Réautoriser" : "Révoquer"}
                  </button>
                </td>
              </tr>
            ))}
            {client.installations.length === 0 && (
              <tr>
                <td colSpan={9} className="py-4 text-center text-slate-500">
                  Aucune installation enregistrée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">Historique</p>
        <ul className="space-y-1.5 text-sm">
          {logs.map((entry) => (
            <li key={entry.id} className="flex flex-wrap gap-2">
              <span className="text-slate-500">{moment(entry.created_at)}</span>
              <span className="font-medium text-slate-900">{entry.action}</span>
              {(entry.old_value || entry.new_value) && (
                <span className="text-slate-500">
                  {entry.old_value || "—"} → {entry.new_value || "—"}
                </span>
              )}
              <span className="text-slate-400">({entry.admin_name})</span>
            </li>
          ))}
          {logs.length === 0 && (
            <li className="text-slate-500">Aucune action enregistrée</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** Editable identity card of one magasin (one installation of the client). */
function MagasinForm({
  clientId,
  installation,
  onSaved,
}: {
  clientId: number;
  installation: Installation;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    shop_name: installation.shop_name || "",
    city: installation.city || "",
    address: installation.address || "",
    manager: installation.manager || "",
    is_active: installation.is_active,
  });
  const [message, setMessage] = useState("");

  const save = async () => {
    try {
      await central.put(
        `/clients/${clientId}/magasins/${installation.id}`,
        form
      );
      setMessage("Enregistré");
      setTimeout(() => setMessage(""), 2000);
      onSaved();
    } catch (err) {
      setMessage(centralError(err, "Enregistrement impossible"));
    }
  };

  const field =
    "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <div className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-6">
      <input
        className={`${field} sm:col-span-2`}
        placeholder="Nom du magasin"
        value={form.shop_name}
        onChange={(e) => setForm({ ...form, shop_name: e.target.value })}
      />
      <input
        className={field}
        placeholder="Ville"
        value={form.city}
        onChange={(e) => setForm({ ...form, city: e.target.value })}
      />
      <input
        className={field}
        placeholder="Adresse"
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
      <input
        className={field}
        placeholder="Responsable"
        value={form.manager}
        onChange={(e) => setForm({ ...form, manager: e.target.value })}
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) =>
              setForm({ ...form, is_active: e.target.checked })
            }
          />
          Actif
        </label>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Enregistrer
        </button>
      </div>
      {message && (
        <p className="sm:col-span-6 text-xs font-semibold text-emerald-600">
          {message}
        </p>
      )}
    </div>
  );
}
