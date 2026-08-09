import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Lock, Mail, Server } from "lucide-react";
import logo from "../assets/logo.jpg";
import api, {
  getServerUrl,
  normalizeServerUrl,
  setServerUrl,
} from "../api/client";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";

type ForgotStep = "email" | "code";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-brand-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-card">
            <img src={logo} alt="Référence Informatique" className="h-20 w-20 object-contain" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-700">
            RÉFÉRENCE <span className="text-slate-800">INFORMATIQUE</span>
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
            <label className="label">Email</label>
            <div className="relative">
              <Mail
                size={18}
                className="pointer-events-none absolute left-3.5 top-3 text-slate-400"
              />
              <input
                type="email"
                className="input pl-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
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
                type="email"
                placeholder="vous@entreprise.ci"
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
    </div>
  );
}
