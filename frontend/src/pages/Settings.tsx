import { useEffect, useState } from "react";
import axios from "axios";
import {
  Building2,
  Check,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import logo from "../assets/logo.jpg";
import api from "../api/client";
import type { CompanySettings } from "../types";
import { useAuth } from "../context/AuthContext";

type CompanyForm = Omit<CompanySettings, "id">;

const emptyCompany: CompanyForm = {
  name: "",
  slogan: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  tax_id: "",
  currency: "FCFA",
  receipt_header: "",
  receipt_footer: "",
};

export default function Settings() {
  const { user } = useAuth();
  const [company, setCompany] = useState<CompanyForm>(emptyCompany);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<CompanySettings>("/settings/company")
      .then((res) => {
        const { id: _id, ...rest } = res.data;
        void _id;
        setCompany(rest);
      })
      .catch(() => setError("Impossible de charger la configuration."))
      .finally(() => setLoading(false));
  }, []);

  function update(patch: Partial<CompanyForm>) {
    setCompany((c) => ({ ...c, ...patch }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await api.put<CompanySettings>("/settings/company", company);
      const { id: _id, ...rest } = res.data;
      void _id;
      setCompany(rest);
      setSaved(true);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'enregistrement");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
            <img src={logo} alt="Logo" className="h-16 w-16 object-contain" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {company.name || "Référence Informatique"}
            </h2>
            <p className="text-sm text-slate-500">
              {company.slogan || "Application de gestion des ventes & du stock"}
            </p>
          </div>
        </div>
      </div>

      {/* Company configuration */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Building2 size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Configuration de l'entreprise
          </h3>
        </div>
        <p className="mb-5 text-sm text-slate-500">
          Ces informations apparaissent sur les reçus de caisse.
        </p>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-400">Chargement...</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Nom de l'entreprise</label>
              <input
                className="input"
                value={company.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Slogan</label>
              <input
                className="input"
                value={company.slogan}
                onChange={(e) => update({ slogan: e.target.value })}
                placeholder="Votre partenaire informatique"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Adresse</label>
              <input
                className="input"
                value={company.address}
                onChange={(e) => update({ address: e.target.value })}
                placeholder="Abidjan, Cocody"
              />
            </div>
            <div>
              <label className="label">Téléphone</label>
              <input
                className="input"
                value={company.phone}
                onChange={(e) => update({ phone: e.target.value })}
                placeholder="+225 07 00 00 00"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                value={company.email}
                onChange={(e) => update({ email: e.target.value })}
                placeholder="contact@reference.ci"
              />
            </div>
            <div>
              <label className="label">Site web</label>
              <input
                className="input"
                value={company.website}
                onChange={(e) => update({ website: e.target.value })}
                placeholder="www.reference.ci"
              />
            </div>
            <div>
              <label className="label">N° RCCM / NCC</label>
              <input
                className="input"
                value={company.tax_id}
                onChange={(e) => update({ tax_id: e.target.value })}
                placeholder="CI-ABJ-..."
              />
            </div>
            <div>
              <label className="label">Devise</label>
              <input
                className="input"
                value={company.currency}
                onChange={(e) => update({ currency: e.target.value })}
                placeholder="FCFA"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">En-tête du reçu (optionnel)</label>
              <input
                className="input"
                value={company.receipt_header}
                onChange={(e) => update({ receipt_header: e.target.value })}
                placeholder="REÇU DE CAISSE"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Message de pied de reçu</label>
              <textarea
                className="input min-h-[70px]"
                value={company.receipt_footer}
                onChange={(e) => update({ receipt_footer: e.target.value })}
                placeholder="Merci de votre confiance !"
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Enregistrement..." : "Enregistrer"}
              </button>
              {saved && (
                <span className="flex items-center gap-1 text-sm font-medium text-emerald-600">
                  <Check size={16} /> Enregistré
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card p-6">
        <h3 className="mb-4 text-base font-bold text-slate-900">Mon compte</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <User size={18} />
            </div>
            <div>
              <p className="text-xs text-slate-400">Nom</p>
              <p className="font-medium text-slate-800">{user?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Mail size={18} />
            </div>
            <div>
              <p className="text-xs text-slate-400">Email</p>
              <p className="font-medium text-slate-800">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <ShieldCheck size={18} />
            </div>
            <div>
              <p className="text-xs text-slate-400">Rôle</p>
              <p className="font-medium capitalize text-slate-800">{user?.role}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
