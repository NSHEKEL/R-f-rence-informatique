import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { LogOut, RefreshCw, Search, Smartphone } from "lucide-react";

/**
 * Consultation of the sales from a phone, wherever the shop is.
 *
 * Served by the central server: the shop pushes a read-only copy of its
 * accounts and of its sales, so the shop computer never has to be reachable
 * from the internet. Signing in uses the very same account as at the counter.
 */

interface Session {
  token: string;
  company: string;
  name: string;
  role: string;
  full_view: boolean;
}

interface MobileSale {
  reference: string;
  date: string;
  total: number;
  status: string;
  payment_method: string;
  customer: string;
  seller: string;
  items: { name: string; quantity: number; unit_price: number }[];
}

interface Summary {
  company: string;
  today_total: number;
  today_count: number;
  month_total: number;
  month_count: number;
  sales_count: number;
  last_sync: string;
}

const SESSION_KEY = "easygest_mobile_session";
const api = axios.create({ baseURL: "/api/central/mobile" });

function money(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(Math.round(value || 0));
}

function when(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function Mobile() {
  const [session, setSession] = useState<Session | null>(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    return saved ? (JSON.parse(saved) as Session) : null;
  });
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sales, setSales] = useState<MobileSale[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState("");

  const signOut = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setSales([]);
    setSummary(null);
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${session.token}` };
      const [list, totals] = await Promise.all([
        api.get<MobileSale[]>("/sales", { headers, params: { search } }),
        api.get<Summary>("/summary", { headers }),
      ]);
      setSales(list.data);
      setSummary(totals.data);
      setError("");
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) signOut();
      else setError("Consultation impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  }, [session, search, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.post<Session>("/login", {
        code: code.trim().toUpperCase(),
        email: email.trim(),
        password,
      });
      localStorage.setItem(SESSION_KEY, JSON.stringify(res.data));
      setSession(res.data);
      setPassword("");
    } catch (err) {
      setError(
        axios.isAxiosError(err) && typeof err.response?.data?.detail === "string"
          ? err.response.data.detail
          : "Connexion impossible"
      );
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <form
          onSubmit={submit}
          className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow"
        >
          <div className="flex items-center gap-2 text-brand-600">
            <Smartphone size={22} />
            <h1 className="text-lg font-semibold">EasyGest — Mes ventes</h1>
          </div>
          <p className="text-sm text-slate-500">
            Consultez les ventes de votre boutique où que vous soyez.
          </p>
          <input
            className="input w-full uppercase"
            placeholder="Code boutique"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <input
            className="input w-full"
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input w-full"
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-8">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
        <div>
          <p className="text-sm font-semibold">{session.company}</p>
          <p className="text-xs opacity-80">{session.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} title="Actualiser">
            <RefreshCw size={18} className={busy ? "animate-spin" : ""} />
          </button>
          <button onClick={signOut} title="Déconnexion">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="space-y-3 p-4">
        {summary && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500">Aujourd'hui</p>
              <p className="text-lg font-semibold">{money(summary.today_total)}</p>
              <p className="text-xs text-slate-400">{summary.today_count} vente(s)</p>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500">Ce mois</p>
              <p className="text-lg font-semibold">{money(summary.month_total)}</p>
              <p className="text-xs text-slate-400">{summary.month_count} vente(s)</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-sm">
          <Search size={16} className="text-slate-400" />
          <input
            className="w-full outline-none"
            placeholder="Référence ou client"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="space-y-2">
          {sales.map((sale) => (
            <button
              key={sale.reference}
              onClick={() =>
                setOpened(opened === sale.reference ? "" : sale.reference)
              }
              className="w-full rounded-xl bg-white p-3 text-left shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{sale.reference}</span>
                <span className="font-semibold">{money(sale.total)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{when(sale.date)}</span>
                <span>{sale.customer || sale.payment_method}</span>
              </div>
              {opened === sale.reference && (
                <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-slate-600">
                  {sale.items.map((item, index) => (
                    <li key={index} className="flex justify-between">
                      <span>
                        {item.quantity} × {item.name}
                      </span>
                      <span>{money(item.quantity * item.unit_price)}</span>
                    </li>
                  ))}
                  {sale.seller && (
                    <li className="pt-1 text-slate-400">Vendeur : {sale.seller}</li>
                  )}
                </ul>
              )}
            </button>
          ))}
          {!sales.length && !busy && (
            <p className="pt-6 text-center text-sm text-slate-500">
              Aucune vente à afficher.
            </p>
          )}
        </div>

        {summary?.last_sync && (
          <p className="pt-2 text-center text-xs text-slate-400">
            Dernière mise à jour de la boutique : {when(summary.last_sync)}
          </p>
        )}
      </div>
    </div>
  );
}
