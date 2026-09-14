import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Activity,
  KeyRound,
  Lock,
  Server,
  User as UserIcon,
} from "lucide-react";
import logo from "../assets/logo-easygest.png";
import api, {
  getServerUrl,
  normalizeServerUrl,
  setServerUrl,
} from "../api/client";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";

type ForgotStep = "email" | "code";

type DiagnosticItem = {
  label: string;
  status: string;
  detail: string;
};

/** The cashier logs in many times a day: only the password is retyped. */
const LAST_EMAIL_KEY = "easygest.last-email";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(
    () => localStorage.getItem(LAST_EMAIL_KEY) ?? ""
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [serverOpen, setServerOpen] = useState(false);
  const [serverInput, setServerInput] = useState(getServerUrl());
  const [serverStatus, setServerStatus] = useState("");
  const [serverOk, setServerOk] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<ForgotStep>("email");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMessage, setForgotMessage] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recovery, setRecovery] = useState({
    key: "",
    identifier: "",
    password: "",
    confirm: "",
  });
  const [recoveryMessage, setRecoveryMessage] = useState("");

  const [diagOpen, setDiagOpen] = useState(false);
  const [diagItems, setDiagItems] = useState<DiagnosticItem[]>([]);
  const [diagError, setDiagError] = useState("");

  async function runDiagnostic() {
    setDiagError("");
    setDiagItems([]);
    setDiagOpen(true);
    try {
      const res = await api.get<{ items: DiagnosticItem[] }>(
        "/securite/diagnostic"
      );
      setDiagItems(res.data.items);
    } catch {
      setDiagError(
        "Impossible de joindre le service EasyGest de ce poste. " +
          "Vérifiez l'adresse du serveur ci-dessus."
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      localStorage.setItem(LAST_EMAIL_KEY, email);
      setPassword("");
      navigate("/");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(
          err.response?.data?.detail ??
            (err.response
              ? "Erreur de connexion"
              : "Serveur injoignable — vérifiez l'adresse du poste serveur")
        );
      } else {
        setError("Erreur de connexion");
      }
    } finally {
      setLoading(false);
    }
  }

  async function testServer() {
    const base = normalizeServerUrl(serverInput);
    setServerOk(false);
    setServerStatus("Test en cours...");
    try {
      const res = await axios.get<{ app: string }>(`${base}/api/health`, {
        timeout: 5000,
      });
      setServerOk(true);
      setServerStatus(`Connecté à ${res.data.app} (${base || "ce poste"})`);
    } catch {
      setServerStatus(
        `Aucune réponse de ${base || "ce poste"} — vérifiez que ` +
          "l'application est lancée sur le serveur et que le pare-feu " +
          "autorise le port 8000."
      );
    }
  }

  function saveServer() {
    setServerUrl(serverInput);
    setServerInput(getServerUrl());
    setServerOpen(false);
    setServerStatus("");
    setError("");
  }

  async function requestReset() {
    setForgotMessage("Envoi en cours...");
    try {
      const { data } = await api.post<{ sent: boolean; message: string }>(
        "/auth/forgot-password",
        { email: forgotEmail }
      );
      setForgotMessage(data.message);
      if (data.sent) setForgotStep("code");
    } catch {
      setForgotMessage("Serveur injoignable.");
    }
  }

  async function applyReset() {
    setForgotMessage("Enregistrement...");
    try {
      const { data } = await api.post<{ message: string }>(
        "/auth/reset-password",
        { token: resetToken, password: newPassword }
      );
      setForgotMessage(data.message);
      setResetToken("");
      setNewPassword("");
    } catch (err) {
      setForgotMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Code invalide"
          : "Code invalide"
      );
    }
  }

  async function applyRecovery() {
    setRecoveryMessage("Vérification...");
    try {
      const { data } = await api.post<{ message: string }>(
        "/auth/recuperation",
        recovery
      );
      setRecoveryMessage(data.message);
      setRecovery({ key: "", identifier: "", password: "", confirm: "" });
    } catch (err) {
      setRecoveryMessage(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Clé invalide"
          : "Clé invalide"
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-brand-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-card">
            <img src={logo} alt="EasyGest" className="h-20 w-20 object-contain" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-700">
            Easy<span className="text-slate-800">Gest</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Gestion des ventes &amp; du stock
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card p-7">
          <h2 className="mb-1 text-lg font-bold text-slate-900">Connexion</h2>
          <p className="mb-6 text-sm text-slate-500">
            Connectez-vous à votre espace de travail.
          </p>

          {error && (
            <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="label">Identifiant</label>
            <div className="relative">
              <UserIcon
                size={18}
                className="pointer-events-none absolute left-3.5 top-3 text-slate-400"
              />
              <input
                type="text"
                className="input pl-11"
                placeholder="admin"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Un simple nom suffit (admin, vendeur…) : l'adresse e-mail n'est
              pas obligatoire.
            </p>
          </div>

          <div className="mb-6">
            <label className="label">Mot de passe</label>
            <div className="relative">
              <Lock
                size={18}
                className="pointer-events-none absolute left-3.5 top-3 text-slate-400"
              />
              <input
                type="password"
                className="input pl-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                autoFocus={Boolean(email)}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Connexion..." : "Se connecter"}
          </button>

          <div className="mt-5 flex items-center justify-between text-xs">
            <button
              type="button"
              className="font-semibold text-brand-700 hover:underline"
              onClick={() => {
                setForgotStep("email");
                setForgotMessage("");
                setForgotOpen(true);
              }}
            >
              Mot de passe oublié ?
            </button>
            <button
              type="button"
              className="flex items-center gap-1 text-slate-400 hover:text-slate-600"
              onClick={() => {
                setServerInput(getServerUrl());
                setServerStatus("");
                setServerOpen(true);
              }}
            >
              <Server size={13} /> Poste serveur
            </button>
          </div>

          <button
            type="button"
            className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
            onClick={() => {
              setRecoveryMessage("");
              setRecoveryOpen(true);
            }}
          >
            <KeyRound size={13} /> Récupération administrateur
          </button>

          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
            onClick={() => void runDiagnostic()}
          >
            <Activity size={13} /> Diagnostic de connexion
          </button>
        </form>
      </div>

      <Modal
        open={serverOpen}
        onClose={() => setServerOpen(false)}
        title="Adresse du poste serveur"
        footer={
          <>
            <button className="btn-ghost" onClick={testServer}>
              Tester
            </button>
            <button className="btn-primary" onClick={saveServer}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Saisissez l'adresse affichée dans la fenêtre noire du poste serveur
            (par exemple <b>192.168.1.20</b>). Laissez vide si l'application
            tourne sur ce poste.
          </p>
          <input
            className="input"
            placeholder="192.168.1.20 ou http://192.168.1.20:8000"
            value={serverInput}
            onChange={(e) => setServerInput(e.target.value)}
          />
          {serverStatus && (
            <p
              className={`rounded-xl px-4 py-2.5 text-sm ${
                serverOk
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {serverStatus}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title="Mot de passe oublié"
        footer={
          forgotStep === "email" ? (
            <button className="btn-primary" onClick={requestReset}>
              Recevoir un code
            </button>
          ) : (
            <button className="btn-primary" onClick={applyReset}>
              Changer le mot de passe
            </button>
          )
        }
      >
        <div className="space-y-3">
          {forgotStep === "email" ? (
            <>
              <p className="text-sm text-slate-500">
                Indiquez l'adresse e-mail de votre compte : vous recevrez un
                code à usage unique.
              </p>
              <input
                className="input"
                type="text"
                placeholder="vous@entreprise.ci ou votre identifiant"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
              />
            </>
          ) : (
            <>
              <input
                className="input"
                placeholder="Code reçu par e-mail"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
              />
              <input
                className="input"
                type="password"
                placeholder="Nouveau mot de passe"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </>
          )}
          {forgotMessage && (
            <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
              {forgotMessage}
            </p>
          )}
          {forgotStep === "email" && (
            <button
              className="text-xs font-semibold text-brand-700 hover:underline"
              onClick={() => setForgotStep("code")}
            >
              J'ai déjà un code
            </button>
          )}
        </div>
      </Modal>

      <Modal
        open={diagOpen}
        onClose={() => setDiagOpen(false)}
        title="Diagnostic de connexion"
      >
        <div className="space-y-2">
          {diagError && <p className="text-sm text-red-600">{diagError}</p>}
          {!diagError && diagItems.length === 0 && (
            <p className="text-sm text-slate-500">Vérification en cours…</p>
          )}
          {diagItems.map((item) => (
            <div
              key={item.label}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2"
            >
              <div>
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="text-xs text-slate-500">{item.detail}</p>
              </div>
              <span
                className={`rounded-lg px-2 py-1 text-[11px] font-semibold uppercase ${
                  item.status === "ok"
                    ? "bg-emerald-50 text-emerald-700"
                    : item.status === "avertissement"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-red-50 text-red-700"
                }`}
              >
                {item.status === "ok"
                  ? "OK"
                  : item.status === "avertissement"
                    ? "Avertissement"
                    : "Erreur"}
              </span>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title="Récupération administrateur"
        footer={
          <button className="btn-primary" onClick={applyRecovery}>
            Rétablir l'accès
          </button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            À utiliser uniquement si plus aucun administrateur ne peut se
            connecter. Saisissez la clé de récupération générée dans
            Paramètres → Sécurité (ou fournie par votre prestataire). Aucune
            donnée commerciale n'est modifiée.
          </p>
          <input
            className="input"
            placeholder="Clé de récupération"
            value={recovery.key}
            onChange={(e) => setRecovery({ ...recovery, key: e.target.value })}
          />
          <input
            className="input"
            placeholder="Identifiant à rétablir (vide = premier administrateur)"
            value={recovery.identifier}
            onChange={(e) =>
              setRecovery({ ...recovery, identifier: e.target.value })
            }
          />
          <input
            className="input"
            type="password"
            placeholder="Nouveau mot de passe"
            value={recovery.password}
            onChange={(e) =>
              setRecovery({ ...recovery, password: e.target.value })
            }
          />
          <input
            className="input"
            type="password"
            placeholder="Confirmation"
            value={recovery.confirm}
            onChange={(e) =>
              setRecovery({ ...recovery, confirm: e.target.value })
            }
          />
          {recoveryMessage && (
            <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
              {recoveryMessage}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
