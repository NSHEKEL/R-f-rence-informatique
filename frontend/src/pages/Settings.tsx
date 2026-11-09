import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { updateLocal } from "../lib/updateLocal";
import {
  Building2,
  Check,
  Database,
  Download,
  DownloadCloud,
  FileCheck2,
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
  probeServer,
  setServerUrl,
} from "../api/client";
import type {
  BackupFile,
  CompanySettings,
  UpdateStatus,
  Workstation,
} from "../types";
import { documentHeader, readDocumentLayout } from "../lib/print";
import GoogleDriveSettings from "../components/GoogleDriveSettings";
import NetworkSettings from "../components/NetworkSettings";
import type { DocumentLayout } from "../lib/print";
import { useAuth } from "../context/AuthContext";
import PhotoPicker from "../components/PhotoPicker";
import PrintingSettings from "../components/PrintingSettings";
import PosDisplaySettings from "../components/PosDisplaySettings";
import SecuritySettings from "../components/SecuritySettings";
import FneSettings from "../components/FneSettings";
import { useCompany } from "../context/CompanyContext";
import { canOpenSettingsTab, companyUpdatePayload, TAB_CATEGORIES } from "../lib/settingsAccess";
import WorkstationSettings from "../components/WorkstationSettings";
import CatalogPriceSettings from "../components/CatalogPriceSettings";
import DepotSettings from "../components/DepotSettings";

type CompanyForm = Omit<CompanySettings, "id"> & { smtp_password?: string };

const LOGO_MAX_BYTES = 400_000;
const SETTING_LABELS: Record<string, string> = { expiry_critical_days: "Péremption critique (jours)", expiry_alert_days: "Alerte péremption (jours)", expiry_watch_days: "Surveillance péremption (jours)", tax_id: "N° RCCM / NCC", rccm: "RCCM", ncc: "NCC", capital_social: "Capital social", regime_fiscal: "Régime fiscal", vat_rate: "TVA (%)", drawer_enabled: "Activer le tiroir-caisse", drawer_port: "Port / imprimante du tiroir partagé", drawer_code: "Code d'ouverture partagé", auto_print_cash: "Impression automatique après encaissement", drawer_open_after_sale: "Ouverture automatique du tiroir après vente" };

/** The page is long: each domain gets its own tab instead of one scroll. */
const TABS = [
  { key: "entreprise", label: "Entreprise", icon: Building2 },
  { key: "impression", label: "Impression", icon: Printer },
  { key: "pos", label: "Affichage POS", icon: Printer },
  { key: "articles", label: "Articles", icon: Building2 },
  { key: "depots", label: "Dépôts", icon: Building2 },
  { key: "tarifs", label: "Tarifs", icon: Building2 },
  { key: "fiscalite", label: "Fiscalité", icon: FileCheck2 },
  { key: "poste", label: "Ce poste", icon: Printer },
  { key: "peripheriques", label: "Périphériques", icon: Printer },
  { key: "caisse", label: "Réglages caisse", icon: Printer },
  { key: "reseau", label: "Réseau & postes", icon: Server },
  { key: "sauvegarde", label: "Sauvegarde", icon: Database },
  { key: "maj", label: "Mise à jour", icon: DownloadCloud },
  { key: "emails", label: "E-mails", icon: Mail },
  { key: "fne", label: "FNE", icon: FileCheck2, admin: true },
  { key: "securite", label: "Sécurité", icon: ShieldCheck, admin: true },
  { key: "compte", label: "Mon compte", icon: User },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const TAB_KEY = "easygest_settings_tab";

const DOC_TYPES = [
  { key: "facture", label: "Facture" },
  { key: "devis", label: "Devis / Proforma" },
  { key: "livraison", label: "Bon de livraison" },
  { key: "commande", label: "Bon de commande" },
  { key: "approvisionnement", label: "Bon d'approvisionnement" },
  { key: "avoir", label: "Avoir / Retour" },
  { key: "reglement", label: "Reçu de règlement" },
  { key: "etat", label: "États & rapports" },
];

const emptyCompany: CompanyForm = {
  name: "",
  slogan: "",
  logo: "",
  address: "",
  phone: "",
  phone2: "",
  email: "",
  website: "",
  tax_id: "",
  country: "",
  rccm: "",
  ncc: "",
  capital_social: "",
  regime_fiscal: "",
  document_layouts: "",
  currency: "FCFA",
  vat_rate: 0,
  about: "",
  receipt_header: "",
  receipt_footer: "",
  receipt_format: "A4",
  printer_name: "",
  auto_print_cash: true,
  drawer_enabled: false,
  drawer_port: "",
  drawer_code: "27,112,0,25,250",
  drawer_open_after_sale: true,
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
  backup_auto_enabled: false,
  backup_frequency: "daily",
  backup_time: "20:00",
  backup_weekday: 0,
  backup_monthday: 1,
  last_backup_status: "",
  last_backup_error: "",
  drive_enabled: false,
  drive_folder_name: "EasyGest Sauvegardes",
  drive_folder_id: "",
  drive_keep: 30,
  drive_last_upload_at: null,
  drive_last_status: "",
  drive_last_error: "",
  drive_last_file_id: "",
  drive_account_email: "",
  network_restrict_workstations: false,
  city: "",
  support_whatsapp: "0710069059",
  support_email: "",
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
  const { user, refreshUser, can } = useAuth();
  const [photoMessage, setPhotoMessage] = useState("");
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
  const [backupStatus, setBackupStatus] = useState<{
    next_run_at: string | null; last_backup_at?: string | null;
    last_backup_status?: string; last_backup_error?: string; sqlite: boolean;
  } | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreName, setRestoreName] = useState("");
  const [restoreReport, setRestoreReport] = useState<{
    created_at: string | null; app_version: string | null; compatible: boolean;
    integrity: string; sha256: string; row_counts: Record<string, number>;
  } | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [lanAddress, setLanAddress] = useState("");
  const [mobileCode, setMobileCode] = useState("");
  const [mobileUrl, setMobileUrl] = useState("");
  const [mobileStatus, setMobileStatus] = useState("");
  const [storedTab, setTab] = useState<TabKey>(() => {
    const saved_ = localStorage.getItem(TAB_KEY);
    return TABS.some((item) => item.key === saved_)
      ? (saved_ as TabKey)
      : "entreprise";
  });
  const visibleTabs = TABS.filter((item) => canOpenSettingsTab(item.key, user?.role === "admin", can));
  const tab = visibleTabs.some((item) => item.key === storedTab) ? storedTab : visibleTabs[0]?.key;
  const tabEditable = tab === "depots" || tab === "tarifs" ? true : tab === "reseau" || tab === "securite" ? user?.role === "admin" : tab === "poste" ? can("poste_modifier") || can("peripheriques_modifier") : tab === "compte" || !!tab && can(`${TAB_CATEGORIES[tab]}_modifier`);
  const [workstations, setWorkstations] = useState<Workstation[]>([]);
  const [layoutDoc, setLayoutDoc] = useState(DOC_TYPES[0].key);
  const docLayout = readDocumentLayout(
    company as unknown as CompanySettings,
    layoutDoc
  );
  function saveDocLayout(layout: DocumentLayout) {
    let all: Record<string, DocumentLayout> = {};
    try {
      all = JSON.parse(company.document_layouts || "{}");
    } catch {
      all = {};
    }
    update({
      document_layouts: JSON.stringify({ ...all, [layoutDoc]: layout }),
    });
  }
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    password: "",
    confirm: "",
  });
  const [passwordMessage, setPasswordMessage] = useState("");
  const restoreInput = useRef<HTMLInputElement>(null);

  async function changeMyPassword() {
    setPasswordMessage("Enregistrement...");
    try {
      const { data } = await api.post<{ message: string }>(
        "/auth/changer-mot-de-passe",
        passwordForm
      );
      setPasswordMessage(data.message);
      setPasswordForm({ current_password: "", password: "", confirm: "" });
    } catch (err) {
      setPasswordMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Changement impossible"
          : "Changement impossible"
      );
    }
  }

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

  const loadWorkstations = useCallback(async () => {
    if (user?.role !== "admin") return;
    try {
      const { data } = await api.get<Workstation[]>("/network/clients");
      setWorkstations(data);
    } catch {
      /* only the administrator sees the list: keep the page usable */
    }
  }, [user?.role]);

  useEffect(() => {
    loadWorkstations();
  }, [loadWorkstations]);

  const loadBackups = useCallback(async () => {
    if (!can("sauvegarde_consulter")) return;
    try {
      const { data } = await api.get<BackupFile[]>("/backups");
      setBackups(data);
      const status = await api.get("/backups/status");
      setBackupStatus(status.data);
    } catch {
      /* the list is optional: keep the page usable */
    }
  }, [can]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  useEffect(() => {
    if (tab !== "sauvegarde") return;
    const timer = window.setInterval(loadBackups, 60000);
    return () => window.clearInterval(timer);
  }, [tab, loadBackups]);

  useEffect(() => {
    if (tab) localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

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

  async function inspectBackup(file: File | undefined) {
    setRestoreReport(null);
    setRestoreFile(null);
    setRestoreName("");
    setRestoreConfirm("");
    if (!file) return;
    setRestoreBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/backups/inspect", body);
      setRestoreReport(data);
      setRestoreFile(file);
    } catch (err) {
      setBackupMessage(axios.isAxiosError(err)
        ? err.response?.data?.detail ?? "Inspection impossible" : "Inspection impossible");
    } finally {
      setRestoreBusy(false);
    }
  }

  async function restoreBackup() {
    if (!can("parametres_sauvegarde_restaurer") || (!restoreFile && !restoreName) || !restoreReport?.compatible || restoreConfirm !== "RESTAURER") return;
    setRestoreBusy(true);
    const body = new FormData();
    if (restoreFile) body.append("file", restoreFile);
    else body.append("name", restoreName);
    body.append("confirm", restoreConfirm);
    try {
      const { data } = await api.post<{ detail: string }>(
        "/backups/restore",
        body
      );
      setBackupMessage(data.detail);
      setRestoreFile(null);
      setRestoreName("");
      setRestoreReport(null);
      setRestoreConfirm("");
      await loadBackups();
    } catch (err) {
      setBackupMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Restauration impossible"
          : "Restauration impossible"
      );
    } finally {
      setRestoreBusy(false);
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
      const data = await updateLocal();
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
      await updateLocal(true);
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
  async function publishMobile() {
    setMobileStatus("Publication en cours...");
    try {
      const res = await api.post<{
        code: string;
        sales: number;
        url: string;
      }>("/license/mobile");
      setMobileCode(res.data.code);
      setMobileUrl(res.data.url);
      setMobileStatus(
        `${res.data.sales} vente(s) consultables depuis un téléphone.`
      );
    } catch (err) {
      setMobileStatus(
        axios.isAxiosError(err)
          ? typeof err.response?.data?.detail === "string"
            ? err.response.data.detail
            : "Serveur central injoignable. Vérifiez la connexion internet puis réessayez."
          : "Publication impossible pour le moment."
      );
    }
  }

  async function testServer() {
    setServerStatus("Test en cours...");
    const base = normalizeServerUrl(serverUrl);
    const probe = await probeServer(base);
    if (probe.kind === "shop") {
      setServerStatus(`Connexion réussie : ${probe.app}`);
    } else if (probe.kind === "central") {
      setServerStatus(
        "Cette adresse est le serveur central EasyGest (console d'administration), " +
          "pas le serveur de la boutique — les écrans afficheront des erreurs " +
          "(ex. « method not allowed »). Indiquez l'adresse du poste serveur."
      );
    } else {
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
      const res = await api.put<CompanySettings>("/settings/company", companyUpdatePayload(company, can, user?.role === "admin"));
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

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
              tab === item.key
                ? "bg-brand-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </div>

      <fieldset disabled={!tabEditable} className="min-w-0 space-y-6">
      {tab === "depots" && <DepotSettings />}
      {tab === "poste" && <WorkstationSettings />}
      {tab === "tarifs" && <CatalogPriceSettings />}
      {(["articles", "fiscalite", "peripheriques", "caisse"] as string[]).includes(tab || "") && <div className="card space-y-4 p-6">
        <h3 className="font-bold">{visibleTabs.find((item) => item.key === tab)?.label}</h3>
        {(tab === "articles" ? ["expiry_critical_days", "expiry_alert_days", "expiry_watch_days"] : tab === "fiscalite" ? ["tax_id", "rccm", "ncc", "capital_social", "regime_fiscal", "vat_rate"] : tab === "peripheriques" ? ["drawer_enabled", "drawer_port", "drawer_code"] : ["auto_print_cash", "drawer_open_after_sale"]).map((field) => {
          const key = field as keyof CompanyForm;
          return <label className="label" key={key}>{SETTING_LABELS[key] || key}{typeof company[key] === "boolean" ? <input type="checkbox" checked={Boolean(company[key])} onChange={(e) => update({ [key]: e.target.checked })} /> : <input className="input" type={typeof company[key] === "number" ? "number" : "text"} min={0} value={String(company[key] ?? "")} onChange={(e) => update({ [key]: typeof company[key] === "number" ? Number(e.target.value) : e.target.value })} />}</label>;
        })}
        <button className="btn-primary" onClick={save}>Enregistrer</button>
        {tab === "peripheriques" && <WorkstationSettings />}
      </div>}
      {/* Company configuration */}
      {tab === "entreprise" && (
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
              <label className="label">Ville du magasin</label>
              <input
                className="input"
                value={company.city}
                onChange={(e) => update({ city: e.target.value })}
                placeholder="Abidjan"
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
              <label className="label">Téléphone secondaire</label>
              <input
                className="input"
                value={company.phone2}
                onChange={(e) => update({ phone2: e.target.value })}
                placeholder="+225 05 00 00 00"
              />
            </div>
            <div>
              <label className="label">Pays</label>
              <input
                className="input"
                value={company.country}
                onChange={(e) => update({ country: e.target.value })}
                placeholder="Côte d'Ivoire"
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
            <fieldset disabled={!can("fiscaux_modifier")} className="contents">
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
              <label className="label">RCCM</label>
              <input
                className="input"
                value={company.rccm}
                onChange={(e) => update({ rccm: e.target.value })}
                placeholder="CI-ABJ-2024-B-..."
              />
            </div>
            <div>
              <label className="label">NCC (contribuable)</label>
              <input
                className="input"
                value={company.ncc}
                onChange={(e) => update({ ncc: e.target.value })}
                placeholder="0123456A"
              />
            </div>
            <div>
              <label className="label">Capital social</label>
              <input
                className="input"
                value={company.capital_social}
                onChange={(e) => update({ capital_social: e.target.value })}
                placeholder="1 000 000 FCFA"
              />
            </div>
            <div>
              <label className="label">Régime fiscal</label>
              <input
                className="input"
                value={company.regime_fiscal}
                onChange={(e) => update({ regime_fiscal: e.target.value })}
                placeholder="Régime simplifié"
              />
            </div>
            </fieldset>
            <fieldset disabled={!can("imprimantes_modifier")} className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
              <p className="label">Disposition des en-têtes de documents</p>
              <p className="mb-2 text-xs text-slate-400">
                Réglage indépendant pour chaque type de document.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label">Document</label>
                  <select
                    className="input"
                    value={layoutDoc}
                    onChange={(e) => setLayoutDoc(e.target.value)}
                  >
                    {DOC_TYPES.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Position du logo</label>
                  <select
                    className="input"
                    value={docLayout.logo_position ?? "gauche"}
                    onChange={(e) =>
                      saveDocLayout({
                        ...docLayout,
                        logo_position: e.target
                          .value as DocumentLayout["logo_position"],
                      })
                    }
                  >
                    <option value="gauche">Gauche</option>
                    <option value="centre">Centre</option>
                    <option value="droite">Droite</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={docLayout.show_contact !== false}
                    onChange={(e) =>
                      saveDocLayout({
                        ...docLayout,
                        show_contact: e.target.checked,
                      })
                    }
                  />
                  Coordonnées
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={docLayout.show_admin !== false}
                    onChange={(e) =>
                      saveDocLayout({
                        ...docLayout,
                        show_admin: e.target.checked,
                      })
                    }
                  />
                  Infos administratives
                </label>
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
                <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
                  Aperçu
                </p>
                <div
                  className="doc-preview"
                  dangerouslySetInnerHTML={{
                    __html: documentHeader(
                      company as unknown as CompanySettings,
                      undefined,
                      layoutDoc
                    ),
                  }}
                />
              </div>
            </fieldset>
            <div>
              <label className="label">WhatsApp d'assistance</label>
              <input
                className="input"
                value={company.support_whatsapp}
                onChange={(e) => update({ support_whatsapp: e.target.value })}
                placeholder="0710069059"
              />
            </div>
            <div>
              <label className="label">E-mail d'assistance</label>
              <input
                className="input"
                value={company.support_email}
                onChange={(e) => update({ support_email: e.target.value })}
                placeholder="support@exemple.ci"
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
            <div>
              <label className="label">TVA appliquée (%)</label>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                step={0.1}
                disabled={!can("fiscaux_modifier")}
                value={company.vat_rate}
                onChange={(e) =>
                  update({ vat_rate: Number(e.target.value) || 0 })
                }
                placeholder="18"
              />
              <p className="mt-1 text-xs text-slate-500">
                0 = aucune TVA. Les prix du catalogue sont TTC : le reçu
                affiche le total HT, la TVA et le total TTC.
              </p>
            </div>
            <div className="sm:col-span-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Reçus, tiroir-caisse et étiquettes se règlent désormais dans
              l'onglet <span className="font-semibold">Impression</span>.
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
      )}

      {/* Receipt and label printers */}
      {tab === "pos" && <PosDisplaySettings />}
      {tab === "impression" && (
        <PrintingSettings
          company={company}
          update={update}
          saveCompany={save}
        />
      )}

      {/* Outgoing mail */}
      {tab === "emails" && (
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
      )}

      {/* Central server */}
      {tab === "reseau" && <NetworkSettings restricted={company.network_restrict_workstations}
        onRestrictionChange={(value) => update({ network_restrict_workstations: value })} />}
      {tab === "reseau" && (
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

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900">
              Postes connectés à ce serveur
            </h4>
            <button className="btn-ghost" onClick={loadWorkstations}>
              Actualiser
            </button>
          </div>
          {workstations.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucun autre poste n'a encore utilisé ce serveur.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Adresse</th>
                  <th className="py-1">Utilisateur</th>
                  <th className="py-1">Dernière activité</th>
                  <th className="py-1">État</th>
                </tr>
              </thead>
              <tbody>
                {workstations.map((poste) => (
                  <tr key={poste.address} className="border-t border-slate-100">
                    <td className="py-1 font-mono">{poste.address}</td>
                    <td className="py-1">{poste.user ?? "—"}</td>
                    <td className="py-1">
                      {new Date(poste.last_seen).toLocaleString("fr-FR")}
                    </td>
                    <td className="py-1">
                      {poste.active ? "En ligne" : "Hors ligne"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-6 border-t border-slate-100 pt-4">
          <h4 className="mb-2 text-sm font-bold text-slate-900">
            Consultation des ventes depuis un téléphone
          </h4>
          <p className="mb-3 text-sm text-slate-500">
            Publie une copie en lecture seule des ventes sur le serveur
            EasyGest : vos ventes se consultent alors depuis n'importe où, sans
            ouvrir ce poste sur Internet. Connexion avec les comptes habituels.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={publishMobile}>
              Activer / actualiser
            </button>
            {mobileCode && (
              <span className="text-sm text-slate-700">
                Code boutique :{" "}
                <span className="font-mono text-base font-semibold">
                  {mobileCode}
                </span>{" "}
                — adresse : <span className="font-mono">{mobileUrl}</span>
              </span>
            )}
          </div>
          {mobileStatus && (
            <p className="mt-2 text-sm font-medium text-slate-600">
              {mobileStatus}
            </p>
          )}
        </div>
      </div>
      )}

      {/* Backups */}
      {tab === "sauvegarde" && (
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Database size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Sauvegarde et restauration des données
          </h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Les sauvegardes SQLite sont des archives ZIP vérifiées. Pour
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
          Sauvegarde quotidienne au démarrage (mode historique)
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
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={company.backup_auto_enabled}
              disabled={backupStatus?.sqlite === false}
              onChange={(e) => update({ backup_auto_enabled: e.target.checked })} />
            Activer les sauvegardes planifiées (SQLite)
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Fréquence</label>
              <select className="input" value={company.backup_frequency}
                onChange={(e) => update({ backup_frequency: e.target.value as CompanySettings["backup_frequency"] })}>
                <option value="daily">Chaque jour</option><option value="weekly">Chaque semaine</option><option value="monthly">Chaque mois</option>
              </select>
            </div>
            <div><label className="label">Heure locale</label>
              <input className="input" type="time" value={company.backup_time}
                onChange={(e) => update({ backup_time: e.target.value })} />
            </div>
            {company.backup_frequency === "weekly" && <div><label className="label">Jour de la semaine</label>
              <select className="input" value={company.backup_weekday}
                onChange={(e) => update({ backup_weekday: Number(e.target.value) })}>
                {["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"].map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
            </div>}
            {company.backup_frequency === "monthly" && <div><label className="label">Jour du mois (1 à 28)</label>
              <input className="input" type="number" min={1} max={28} value={company.backup_monthday}
                onChange={(e) => update({ backup_monthday: Number(e.target.value) })} />
            </div>}
          </div>
          <p className="text-xs text-slate-500">Enregistrez la configuration pour appliquer la planification. L'application doit rester ouverte ; une échéance manquée est rattrapée une seule fois à la prochaine ouverture.</p>
          <p className="text-xs text-slate-500">Prochaine exécution enregistrée : {backupStatus?.next_run_at ? formatDateTime(backupStatus.next_run_at) : "Non planifiée"}</p>
          <p className="text-xs text-slate-500">État : {backupStatus?.last_backup_status === "ok" ? "Réussie" : backupStatus?.last_backup_status === "erreur" ? "Échec" : "Aucune sauvegarde"}</p>
          {backupStatus?.last_backup_error && <p className="text-sm text-red-600">{backupStatus.last_backup_error}</p>}
        </div>
        {(backupStatus?.last_backup_at || company.last_backup_at) && (
          <p className="mt-2 text-xs text-slate-400">
            Dernière sauvegarde réussie : {formatDateTime((backupStatus?.last_backup_at || company.last_backup_at)!)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={createBackup}>
            <Database size={16} /> Sauvegarder maintenant
          </button>
          <button
            className="btn-ghost"
            disabled={restoreBusy}
            onClick={() => restoreInput.current?.click()}
          >
            <HardDriveUpload size={16} /> Restaurer un fichier
          </button>
          <input
            ref={restoreInput}
            type="file"
            accept=".zip,.db"
            className="hidden"
            onChange={(e) => { void inspectBackup(e.target.files?.[0]); e.target.value = ""; }}
          />
          {backupMessage && (
            <span className="text-sm text-slate-600">{backupMessage}</span>
          )}
        </div>

        {restoreBusy && <p className="mt-3 text-sm text-slate-500">Vérification ou restauration en cours…</p>}
        {restoreReport && <div id="backup-restore-inspection" className="mt-4 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-bold">Inspection : {restoreFile?.name || restoreName}</p>
          <p>Date : {restoreReport.created_at ? formatDateTime(restoreReport.created_at) : "Inconnue (ancien format)"}</p>
          <p>Version : {restoreReport.app_version || "Inconnue (ancien format)"} — {restoreReport.compatible ? "Compatible" : "Incompatible : version plus récente"}</p>
          <p>Intégrité : {restoreReport.integrity} — SHA-256 : {restoreReport.sha256}</p>
          <details><summary>Nombre de lignes par table</summary><ul>{Object.entries(restoreReport.row_counts).map(([table, count]) => <li key={table}>{table} : {count}</li>)}</ul></details>
          <p>Une sauvegarde de sécurité « avant-restauration » sera créée avant toute restauration. Les données seront remplacées au prochain démarrage.</p>
          <label className="label">Saisissez RESTAURER pour confirmer</label>
          <input className="input" value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)} autoComplete="off" />
          <button className="btn-primary" disabled={!can("parametres_sauvegarde_restaurer") || restoreBusy || !restoreReport.compatible || restoreConfirm !== "RESTAURER"} onClick={restoreBackup}>Confirmer la restauration</button>
          <button className="btn-ghost" onClick={() => { setRestoreReport(null); setRestoreFile(null); setRestoreName(""); setRestoreConfirm(""); }}>Annuler</button>
        </div>}

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
      )}

      {tab === "sauvegarde" && <GoogleDriveSettings company={company} onChange={update}
        onRestore={(name, report) => {
          setRestoreFile(null); setRestoreName(name); setRestoreReport(report); setRestoreConfirm("");
          void loadBackups();
          window.requestAnimationFrame(() => document.getElementById("backup-restore-inspection")?.scrollIntoView({ block: "center", behavior: "smooth" }));
        }} />}

      {/* Remote update */}
      {tab === "maj" && (
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <DownloadCloud size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Mise à jour de l'application
          </h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          L'application vérifie la dernière version publiée, la télécharge et
          redémarre toute seule. La mise à jour concerne cet ordinateur : à
          lancer sur chaque poste.
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
      )}

      {tab === "fne" && <FneSettings />}
      {tab === "securite" && user?.role === "admin" && <SecuritySettings />}

      {tab === "compte" && (
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Printer size={18} className="text-slate-400" />
          <h3 className="text-base font-bold text-slate-900">Mon compte</h3>
        </div>
        <div className="space-y-4">
          <PhotoPicker
            label="Ma photo"
            value={user?.photo ?? ""}
            rounded="rounded-full"
            onError={setPhotoMessage}
            onChange={async (photo) => {
              setPhotoMessage("");
              try {
                await api.put("/users/me/photo", { photo });
                await refreshUser();
                setPhotoMessage("Photo enregistrée");
              } catch {
                setPhotoMessage("Impossible d'enregistrer la photo");
              }
            }}
          />
          {photoMessage && (
            <p className="text-sm text-slate-500">{photoMessage}</p>
          )}
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
              <p className="text-xs text-slate-400">Identifiant</p>
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

          <div className="border-t border-slate-100 pt-4">
            <h4 className="mb-3 text-sm font-bold text-slate-900">
              Changer mon mot de passe
            </h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className="input"
                type="password"
                placeholder="Ancien mot de passe"
                value={passwordForm.current_password}
                onChange={(e) =>
                  setPasswordForm({
                    ...passwordForm,
                    current_password: e.target.value,
                  })
                }
              />
              <input
                className="input"
                type="password"
                placeholder="Nouveau mot de passe"
                value={passwordForm.password}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, password: e.target.value })
                }
              />
              <input
                className="input"
                type="password"
                placeholder="Confirmation"
                value={passwordForm.confirm}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, confirm: e.target.value })
                }
              />
            </div>
            <button className="btn-primary mt-3" onClick={changeMyPassword}>
              <Check size={16} /> Enregistrer le mot de passe
            </button>
            {passwordMessage && (
              <p className="mt-3 text-sm text-slate-600">{passwordMessage}</p>
            )}
          </div>
        </div>
      </div>
      )}
      </fieldset>
    </div>
  );
}
