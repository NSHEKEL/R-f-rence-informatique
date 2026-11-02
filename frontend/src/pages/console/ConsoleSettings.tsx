import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import central, { centralError } from "../../api/central";

interface SupportSettings {
  phone: string;
  email: string;
  whatsapp: string;
}

/**
 * Coordonnées du service commercial affichées à une boutique dont la licence
 * a expiré (écran de verrouillage : téléphone, WhatsApp, e-mail).
 */
export default function ConsoleSettings() {
  const [form, setForm] = useState<SupportSettings>({
    phone: "",
    email: "",
    whatsapp: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    central
      .get<SupportSettings>("/settings")
      .then((res) => setForm(res.data))
      .catch((err) => setError(centralError(err, "Enregistrement impossible")))
      .finally(() => setLoading(false));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await central.put("/settings", form);
      setMessage(
        "Coordonnées enregistrées : elles sont signées dans les licences et visibles dès la prochaine synchronisation."
      );
    } catch (err) {
      setError(centralError(err, "Enregistrement impossible"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-6 text-slate-500">Chargement…</p>;

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-bold text-slate-900">
        Service commercial — contacts
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Affichés sur l'écran de verrouillage d'une boutique dont la licence ou
        l'essai a expiré, avec les boutons d'appel, WhatsApp et e-mail.
      </p>
      <form onSubmit={save} className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Téléphone
          </span>
          <input
            className="input w-full"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+225 07 00 00 00 00"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            WhatsApp (format international)
          </span>
          <input
            className="input w-full"
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            placeholder="2250700000000"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">E-mail</span>
          <input
            type="email"
            className="input w-full"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="commercial@easygest.app"
          />
        </label>
        <button className="btn-primary flex items-center gap-2" disabled={saving}>
          <Save size={16} /> {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
