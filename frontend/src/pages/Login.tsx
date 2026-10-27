import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Lock, Mail } from "lucide-react";
import logo from "../assets/logo.jpg";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@reference.ci");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur de connexion");
      } else {
        setError("Erreur de connexion");
      }
    } finally {
      setLoading(false);
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
            Connectez-vous à votre espace d'administration.
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

          <p className="mt-5 text-center text-xs text-slate-400">
            Démo : admin@reference.ci / admin123
          </p>
        </form>
      </div>
    </div>
  );
}
