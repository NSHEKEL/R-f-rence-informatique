import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Building2,
  Check,
  Database,
  Download,
  DownloadCloud,
  FolderOpen,
  HardDriveUpload,
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
  formatDateTime,
  normalizeServerUrl,
  setServerUrl,
} from "../api/client";
import type { BackupFile, CompanySettings, UpdateStatus } from "../types";
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
  backup_dir: "",
  backup_auto: true,
  backup_keep: 30,
  backup_on_sale: false,
  last_backup_at: null,
};

/** Native folder picker, only available inside the desktop window. */
function nativeApi(): { choose_folder?: () => Promise<string> } | undefined {
  return (
    window as unknown as {
      pywebview?: { api?: { choose_folder?: () => Promise<string> } };
    }
  ).pywebview?.api;
}

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
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [backupMessage, setBackupMessage] = useState("");
  const [lanAddress, setLanAddress] = useState("");
  const restoreInput = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    api
      .get<{ address: string }>("/network")
      .then((res) => setLanAddress(res.data.address))
      .catch(() => setLanAddress(""));
  }, []);

  const loadBackups = useCallback(async () => {
    try {
      const { data } = await api.get<BackupFile[]>("/backups");
      setBackups(data);
    } catch {
      /* the list is optional: keep the page usable */
    }
  }, []);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  async function createBackup() {
    setBackupMessage("Sauvegarde en cours...");
    try {
      const { data } = await api.post<{ name: string; size: number }>(
        "/backups"
      );
      setBackupMessage(
        `Sauvegarde ${data.name} créée (${Math.round(data.size / 1024)} Ko).`
      );
      await loadBackups();
    } catch (err) {
      setBackupMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Sauvegarde impossible"
          : "Sauvegarde impossible"
      );
    }
  }

  /**
   * Saves a copy where the user can pick it up. The desktop window has no
   * browser download, so the application writes the file itself into the
   * backup folder (USB key, cloud folder) or the Downloads folder.
   */
  async function exportBackup(name: string) {
    setBackupMessage("Copie en cours...");
    try {
      const { data } = await api.post<{ path: string }>(
        `/backups/${name}/export`,
        { folder: company.backup_dir }
      );
      setBackupMessage(`Copie enregistrée : ${data.path}`);
    } catch (err) {
      setBackupMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Copie impossible"
          : "Copie impossible"
      );
    }
  }

  /** Chooses the backup folder in a real Windows dialog, then stores it. */
  async function chooseBackupFolder() {
    const chooser = nativeApi()?.choose_folder;
    if (!chooser) return;
    const folder = await chooser();
    if (!folder) return;
    setCompany((c) => ({ ...c, backup_dir: folder }));
    await saveBackupFolder(folder);
  }

  /** The folder must survive a reload even if the page is not saved. */
  async function saveBackupFolder(folder: string) {
    try {
      await api.put("/settings/company", { backup_dir: folder });
      setBackupMessage(
        folder
          ? `Dossier de sauvegarde enregistré : ${folder}`
          : "Dossier de sauvegarde retiré."
      );
    } catch (err) {
      setBackupMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Enregistrement impossible"
          : "Enregistrement impossible"
      );
    }
  }

  async function restoreBackup(file: File | undefined) {
    if (!file) return;
    if (
      !window.confirm(
        `Restaurer « ${file.name} » ? Les données actuelles seront ` +
          "remplacées au prochain démarrage."
      )
    ) {
      return;
    }
    const body = new FormData();
    body.append("file", file);
    try {
      const { data } = await api.post<{ detail: string }>(
        "/backups/restore",
        body
      );
      setBackupMessage(data.detail);
    } catch (err) {
      setBackupMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Restauration impossible"
          : "Restauration impossible"
      );
    }
  }

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
              {company.name || "EasyGest"}
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
        {lanAddress && (
          <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            Adresse de ce poste sur le réseau :{" "}
            <span className="font-mono font-semibold">{lanAddress}</span>
            <br />
            À saisir sur les autres ordinateurs et dans l'application Android
            (même réseau Wi-Fi, EasyGest ouvert sur ce poste).
          </div>
        )}
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

      {/* Backups */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Database size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Sauvegarde et restauration des données
          </h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Une copie complète est enregistrée automatiquement chaque jour. Pour
          ne rien perdre en cas de panne du poste, indiquez un second dossier
          (clé USB, disque externe, dossier Google&nbsp;Drive / OneDrive ou
          partage réseau) : chaque sauvegarde y est recopiée.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">Second dossier de sauvegarde</label>
            <div className="flex gap-2">
              <input
                className="input"
                value={company.backup_dir}
                onChange={(e) => update({ backup_dir: e.target.value })}
                onBlur={(e) => saveBackupFolder(e.target.value)}
                placeholder="E:\Sauvegardes EasyGest"
              />
              {nativeApi()?.choose_folder && (
                <button
                  className="btn-ghost whitespace-nowrap"
                  onClick={chooseBackupFolder}
                >
                  <FolderOpen size={16} /> Parcourir
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Le dossier est enregistré dès que vous quittez le champ.
            </p>
          </div>
          <div>
            <label className="label">Copies conservées</label>
            <input
              type="number"
              min={1}
              className="input"
              value={company.backup_keep}
              onChange={(e) => update({ backup_keep: Number(e.target.value) })}
            />
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={company.backup_auto}
            onChange={(e) => update({ backup_auto: e.target.checked })}
          />
          Sauvegarde automatique quotidienne
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={company.backup_on_sale}
            onChange={(e) => update({ backup_on_sale: e.target.checked })}
          />
          Sauvegarder aussi après chaque vente (copie immédiate dans le
          dossier ci-dessus)
        </label>
        {company.last_backup_at && (
          <p className="mt-2 text-xs text-slate-400">
            Dernière sauvegarde : {formatDateTime(company.last_backup_at)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={createBackup}>
            <Database size={16} /> Sauvegarder maintenant
          </button>
          <button
            className="btn-ghost"
            onClick={() => restoreInput.current?.click()}
          >
            <HardDriveUpload size={16} /> Restaurer un fichier
          </button>
          <input
            ref={restoreInput}
            type="file"
            className="hidden"
            onChange={(e) => restoreBackup(e.target.files?.[0])}
          />
          {backupMessage && (
            <span className="text-sm text-slate-600">{backupMessage}</span>
          )}
        </div>

        {backups.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
            {backups.slice(0, 8).map((b) => (
              <li
                key={b.name}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-700">
                    {b.name}
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatDateTime(b.created_at)} ·{" "}
                    {Math.round(b.size / 1024)} Ko
                  </span>
                </span>
                <button
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => exportBackup(b.name)}
                >
                  <Download size={14} /> Enregistrer une copie
                </button>
              </li>
            ))}
          </ul>
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
            l'application installée (EasyGest).
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
