import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Building2,
  Check,
  DownloadCloud,
  ImagePlus,
  Mail,
  Printer,
  Server,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import api, {
  API_BASE,
  normalizeServerUrl,
  setServerUrl,
} from "../api/client";
import type { CompanySettings, UpdateStatus } from "../types";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";

type CompanyForm = Omit<CompanySettings, "id"> & { smtp_password?: string };

const LOGO_MAX_BYTES = 400_000;

const emptyCompany: CompanyForm = {
  name: "",
  slogan: "",
  logo: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  tax_id: "",
  currency: "FCFA",
  about: "",
  receipt_header: "",
  receipt_footer: "",
  receipt_format: "A4",
  printer_name: "",
  auto_print_cash: true,
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_from: "",
  smtp_tls: true,
  smtp_configured: false,
  smtp_password: "",
};

export default function Settings() {
  const { user } = useAuth();
  const { setCompany: setBranding } = useCompany();
  const [company, setCompany] = useState<CompanyForm>(emptyCompany);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);

  const [serverUrl, setServerUrlValue] = useState(API_BASE);
  const [serverStatus, setServerStatus] = useState("");
  const [mailStatus, setMailStatus] = useState("");
  const [update_, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");

  useEffect(() => {
    api
      .get<CompanySettings>("/settings/company")
      .then((res) => {
        const { id: _id, ...rest } = res.data;
        void _id;
        setCompany({ ...rest, smtp_password: "" });
      })
      .catch(() => setError("Impossible de charger la configuration."))
      .finally(() => setLoading(false));
  }, []);

  function pickLogo(file: File) {
    if (file.size > LOGO_MAX_BYTES) {
      setError("Logo trop lourd : choisissez une image de moins de 400 Ko.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError("");
      update({ logo: String(reader.result) });
    };
    reader.readAsDataURL(file);
  }

  async function testMail() {
    setMailStatus("Envoi du message de test...");
    try {
      const { data } = await api.post<{ sent: boolean; to: string }>(
        "/settings/company/test-mail"
      );
      setMailStatus(`Message de test envoyé à ${data.to}.`);
    } catch (err) {
      setMailStatus(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Échec de l'envoi"
          : "Échec de l'envoi"
      );
    }
  }

  async function checkUpdate() {
    setUpdateMessage("Recherche d'une mise à jour...");
    try {
      const { data } = await api.get<UpdateStatus>("/updates");
      setUpdateStatus(data);
      setUpdateMessage(
        data.error ||
          (data.available
            ? `Version ${data.latest_version} disponible.`
            : "L'application est à jour.")
      );
    } catch {
      setUpdateMessage("Impossible de contacter le serveur de mise à jour.");
    }
  }

  async function installUpdate() {
    if (
      !window.confirm(
        "L'application va se fermer, se mettre à jour puis redémarrer. " +
          "Assurez-vous qu'aucune vente n'est en cours. Continuer ?"
      )
    )
      return;
    setUpdateMessage("Téléchargement et installation en cours...");
    try {
      await api.post("/updates/install");
      setUpdateMessage(
        "Mise à jour lancée : l'application redémarre dans quelques " +
          "secondes. Rechargez cette page ensuite."
      );
    } catch (err) {
      setUpdateMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Échec de la mise à jour"
          : "Échec de la mise à jour"
      );
    }
  }

  /** Points this workstation at the central server hosting the database. */
  async function testServer() {
    setServerStatus("Test en cours...");
    const base = normalizeServerUrl(serverUrl);
    try {
      const res = await axios.get<{ status: string; app: string }>(
        `${base}/api/health`,
        { timeout: 5000 }
      );
      setServerStatus(`Connexion réussie : ${res.data.app}`);
    } catch {
      setServerStatus("Serveur injoignable à cette adresse.");
    }
  }

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
      setCompany({ ...rest, smtp_password: "" });
      setBranding(res.data);
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
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-slate-50 text-xs text-slate-400 ring-1 ring-slate-100">
            {company.logo ? (
              <img
                src={company.logo}
                alt="Logo"
                className="h-16 w-16 object-contain"
              />
            ) : (
              "Sans logo"
            )}
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
              <label className="label">Logo de l'entreprise (facultatif)</label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) pickLogo(file);
                    e.target.value = "";
                  }}
                />
                <button
                  className="btn-ghost"
                  onClick={() => logoInput.current?.click()}
                >
                  <ImagePlus size={16} /> Choisir une image
                </button>
                {company.logo && (
                  <button
                    className="btn-ghost text-red-600"
                    onClick={() => update({ logo: "" })}
                  >
                    <Trash2 size={16} /> Retirer le logo
                  </button>
                )}
                <span className="text-xs text-slate-400">
                  Sans logo, cette zone reste vide sur le reçu.
                </span>
              </div>
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
              <label className="label">
                Texte « À propos de nous »
              </label>
              <textarea
                className="input min-h-[90px]"
                value={company.about}
                onChange={(e) => update({ about: e.target.value })}
                placeholder="Présentez votre entreprise, vos activités et vos services."
              />
              <p className="mt-1 text-xs text-slate-400">
                Affiché sur la page « À propos de nous » du menu.
              </p>
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
            <div>
              <label className="label">Format d'impression du reçu</label>
              <select
                className="input"
                value={company.receipt_format}
                onChange={(e) =>
                  update({
                    receipt_format:
                      e.target.value === "80mm" ? "80mm" : "A4",
                  })
                }
              >
                <option value="A4">Feuille A4 (imprimante classique)</option>
                <option value="80mm">Ticket 80 mm (imprimante thermique)</option>
              </select>
            </div>
            <div>
              <label className="label">Imprimante à utiliser</label>
              <input
                className="input"
                value={company.printer_name}
                onChange={(e) => update({ printer_name: e.target.value })}
                placeholder="Ex. EPSON TM-T20 (nom Windows)"
              />
              <p className="mt-1 text-xs text-slate-400">
                Nom rappelé sur l'écran d'impression ; sélectionnez la même
                imprimante dans la boîte de dialogue Windows.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={company.auto_print_cash}
                  onChange={(e) =>
                    update({ auto_print_cash: e.target.checked })
                  }
                />
                Imprimer automatiquement les tickets d'ouverture et de fermeture
                de caisse
              </label>
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

      {/* Outgoing mail */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Mail size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Envoi d'e-mails (mot de passe oublié)
          </h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Sans ces paramètres, la réinitialisation se fait par l'administrateur
          depuis la page Utilisateurs. Avec Gmail, utilisez un
          <strong> mot de passe d'application </strong>
          (et non le mot de passe du compte).
        </p>
        <button
          className="btn-ghost mb-4"
          onClick={() =>
            update({
              smtp_host: "smtp.gmail.com",
              smtp_port: 587,
              smtp_tls: true,
            })
          }
        >
          Pré-remplir pour Gmail
        </button>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Serveur SMTP</label>
            <input
              className="input"
              value={company.smtp_host}
              onChange={(e) => update({ smtp_host: e.target.value })}
              placeholder="smtp.gmail.com"
            />
          </div>
          <div>
            <label className="label">Port</label>
            <input
              className="input"
              type="number"
              value={company.smtp_port}
              onChange={(e) => update({ smtp_port: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Identifiant</label>
            <input
              className="input"
              value={company.smtp_user}
              onChange={(e) => update({ smtp_user: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Mot de passe</label>
            <input
              className="input"
              type="password"
              value={company.smtp_password ?? ""}
              onChange={(e) => update({ smtp_password: e.target.value })}
              placeholder={
                company.smtp_configured ? "•••••• (inchangé)" : ""
              }
            />
          </div>
          <div>
            <label className="label">Adresse d'expédition</label>
            <input
              className="input"
              value={company.smtp_from}
              onChange={(e) => update({ smtp_from: e.target.value })}
              placeholder="contact@reference.ci"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={company.smtp_tls}
                onChange={(e) => update({ smtp_tls: e.target.checked })}
              />
              Connexion sécurisée (TLS)
            </label>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className="btn-primary" onClick={save} disabled={saving}>
              Enregistrer
            </button>
            <button className="btn-ghost" onClick={testMail}>
              Envoyer un test
            </button>
            {mailStatus && (
              <span className="text-sm text-slate-600">{mailStatus}</span>
            )}
          </div>
        </div>
      </div>

      {/* Central server */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Server size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Serveur central (base de données partagée)
          </h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Adresse du poste serveur sur lequel tourne l'application. Tous les
          ordinateurs qui pointent vers la même adresse partagent les mêmes
          données. Laissez vide sur le poste serveur lui-même.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="input"
            value={serverUrl}
            onChange={(e) => setServerUrlValue(e.target.value)}
            placeholder="http://192.168.1.20:8000"
          />
          <button className="btn-ghost shrink-0" onClick={testServer}>
            Tester
          </button>
          <button
            className="btn-primary shrink-0"
            onClick={() => {
              setServerUrl(serverUrl);
              window.location.reload();
            }}
          >
            Enregistrer et recharger
          </button>
        </div>
        {serverStatus && (
          <p className="mt-3 text-sm font-medium text-slate-600">
            {serverStatus}
          </p>
        )}
      </div>

      {/* Remote update */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <DownloadCloud size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Mise à jour de l'application
          </h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          L'application vérifie la dernière version publiée, la télécharge et
          redémarre toute seule. À lancer sur le poste serveur.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={checkUpdate}>
            Rechercher une mise à jour
          </button>
          {update_?.available && update_.packaged && (
            <button className="btn-primary" onClick={installUpdate}>
              <DownloadCloud size={16} /> Installer la version{" "}
              {update_.latest_version}
            </button>
          )}
          {update_ && (
            <span className="text-sm text-slate-500">
              Version installée : {update_.current_version}
            </span>
          )}
        </div>
        {updateMessage && (
          <p className="mt-3 text-sm font-medium text-slate-600">
            {updateMessage}
          </p>
        )}
        {update_ && update_.available && !update_.packaged && (
          <p className="mt-2 text-sm text-amber-600">
            Mise à jour automatique disponible uniquement depuis
            ReferenceInformatique.exe.
          </p>
        )}
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Printer size={18} className="text-slate-400" />
          <h3 className="text-base font-bold text-slate-900">Mon compte</h3>
        </div>
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
