import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import central, {
  centralError,
  getCentralUrl,
  setCentralToken,
  setCentralUrl,
} from "../../api/central";

/** Sign-in of the software owner, separate from the shop accounts. */
export default function ConsoleLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState(getCentralUrl());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCentralUrl(url);
    try {
      const res = await central.post<{ access_token: string }>("/auth/login", {
        email,
        password,
      });
      setCentralToken(res.data.access_token);
      navigate("/console");
    } catch (err) {
      setError(centralError(err, "Identifiants incorrects"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
            <ShieldCheck size={24} />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-900">
              Console Administrateur Global
            </p>
            <p className="text-sm text-slate-500">EasyGest — gestion centrale</p>
          </div>
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-700">
          Adresse du serveur central
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://central.easygest.ci (vide = ce serveur)"
          className="mb-4 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">
          Adresse e-mail
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">
          Mot de passe
        </label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
        />

        {error && (
          <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
