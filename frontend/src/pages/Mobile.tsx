import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  BadgeInfo,
  Calculator,
  LogOut,
  Moon,
  RefreshCw,
  Search,
  Settings2,
  ShoppingBag,
  Smartphone,
  Sun,
  Users,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";

/**
 * Consultation of the shop from a phone, wherever it is.
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

interface TeamMember {
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  sales_count: number;
  sales_total: number;
}

interface Accounting {
  days: { day: string; total: number; count: number }[];
  payments: { method: string; total: number; count: number }[];
  products: { name: string; quantity: number; total: number }[];
  period_total: number;
  period_count: number;
}

interface About {
  company: string;
  manager: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  about: string;
  version: string;
}

type Tab = "ventes" | "comptabilite" | "utilisateurs" | "parametres" | "apropos";

const SESSION_KEY = "easygest_mobile_session";
const AUTO_KEY = "easygest_mobile_auto";
// A sale rung up at the counter reaches the phone within this delay, without
// anyone touching the screen.
const AUTO_REFRESH_MS = 8000;
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

function day(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export default function Mobile() {
  const { theme, toggle } = useTheme();
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
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [accounting, setAccounting] = useState<Accounting | null>(null);
  const [about, setAbout] = useState<About | null>(null);
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState("");
  const [tab, setTab] = useState<Tab>("ventes");
  const [auto, setAuto] = useState(
    () => localStorage.getItem(AUTO_KEY) !== "0"
  );
  const [fresh, setFresh] = useState("");
  const known = useRef<string>("");

  const signOut = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setSales([]);
    setSummary(null);
    setTeam([]);
    setAccounting(null);
    setAbout(null);
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!session) return;
      if (!silent) setBusy(true);
      try {
        const headers = { Authorization: `Bearer ${session.token}` };
        const [list, totals] = await Promise.all([
          api.get<MobileSale[]>("/sales", { headers, params: { search } }),
          api.get<Summary>("/summary", { headers }),
        ]);
        const latest = list.data[0]?.reference ?? "";
        if (known.current && latest && latest !== known.current) {
          setFresh(latest);
          window.setTimeout(() => setFresh(""), 6000);
        }
        known.current = latest;
        setSales(list.data);
        setSummary(totals.data);
        setError("");
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 401) signOut();
        else if (!silent) setError("Consultation impossible pour le moment.");
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [session, search, signOut]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live view: the list refreshes on its own, and again as soon as the phone
  // comes back to the screen.
  useEffect(() => {
    if (!session || !auto) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, AUTO_REFRESH_MS);
    const wake = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [session, auto, load]);

  useEffect(() => {
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.token}` };
    if (tab === "utilisateurs" && session.full_view) {
      api
        .get<TeamMember[]>("/team", { headers })
        .then((res) => setTeam(res.data))
        .catch(() => setTeam([]));
    }
    if (tab === "comptabilite") {
      api
        .get<Accounting>("/accounting", { headers })
        .then((res) => setAccounting(res.data))
        .catch(() => setAccounting(null));
    }
    if (tab === "apropos") {
      api
        .get<About>("/about", { headers })
        .then((res) => setAbout(res.data))
        .catch(() => setAbout(null));
    }
  }, [tab, session, sales.length]);

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

  function switchAuto(next: boolean) {
    setAuto(next);
    localStorage.setItem(AUTO_KEY, next ? "1" : "0");
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
        <form
          onSubmit={submit}
          className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow dark:bg-slate-900"
        >
          <div className="flex items-center gap-2 text-brand-600 dark:text-brand-300">
            <Smartphone size={22} />
            <h1 className="text-lg font-semibold">EasyGest — Ma boutique</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Consultez votre boutique où que vous soyez.
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
          {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <button className="btn-primary w-full py-3 text-base" disabled={busy}>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    );
  }

  const tabs: [Tab, string, typeof ShoppingBag][] = [
    ["ventes", "Ventes", ShoppingBag],
    ["comptabilite", "Compta", Calculator],
    ...(session.full_view
      ? ([["utilisateurs", "Équipe", Users]] as [Tab, string, typeof ShoppingBag][])
      : []),
    ["parametres", "Réglages", Settings2],
    ["apropos", "À propos", BadgeInfo],
  ];

  return (
    <div className="min-h-screen bg-slate-100 pb-24 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
        <div>
          <p className="text-sm font-semibold">{session.company}</p>
          <p className="text-xs opacity-80">{session.name}</p>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => void load()} title="Actualiser" className="p-1">
            <RefreshCw size={20} className={busy ? "animate-spin" : ""} />
          </button>
          <button onClick={signOut} title="Déconnexion" className="p-1">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {fresh && (
        <p className="bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white">
          Nouvelle vente : {fresh}
        </p>
      )}

      <div className="space-y-3 p-4">
        {tab === "ventes" && (
          <>
            {summary && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Aujourd'hui</p>
                  <p className="text-lg font-semibold">{money(summary.today_total)}</p>
                  <p className="text-xs text-slate-400">{summary.today_count} vente(s)</p>
                </div>
                <div className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Ce mois</p>
                  <p className="text-lg font-semibold">{money(summary.month_total)}</p>
                  <p className="text-xs text-slate-400">{summary.month_count} vente(s)</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-sm dark:bg-slate-900">
              <Search size={16} className="text-slate-400" />
              <input
                className="w-full bg-transparent outline-none"
                placeholder="Référence ou client"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}

            <div className="space-y-2">
              {sales.map((sale) => (
                <button
                  key={sale.reference}
                  onClick={() =>
                    setOpened(opened === sale.reference ? "" : sale.reference)
                  }
                  className="w-full rounded-xl bg-white p-3 text-left shadow-sm dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{sale.reference}</span>
                    <span className="font-semibold">{money(sale.total)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>{when(sale.date)}</span>
                    <span>{sale.customer || sale.payment_method}</span>
                  </div>
                  {opened === sale.reference && (
                    <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
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
                <p className="pt-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  Aucune vente à afficher.
                </p>
              )}
            </div>

            {summary?.last_sync && (
              <p className="pt-2 text-center text-xs text-slate-400">
                Dernière mise à jour de la boutique : {when(summary.last_sync)}
              </p>
            )}
          </>
        )}

        {tab === "comptabilite" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">7 derniers jours</p>
                <p className="text-lg font-semibold">
                  {money(accounting?.period_total || 0)}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Tickets</p>
                <p className="text-lg font-semibold">{accounting?.period_count || 0}</p>
              </div>
            </div>
            <section className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
              <h2 className="mb-2 text-sm font-semibold">Par jour</h2>
              {accounting?.days.length ? (
                accounting.days.map((row) => (
                  <div key={row.day} className="flex justify-between py-1 text-sm">
                    <span className="text-slate-500 dark:text-slate-400">{day(row.day)}</span>
                    <span className="font-medium">{money(row.total)}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Aucun mouvement.</p>
              )}
            </section>
            <section className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
              <h2 className="mb-2 text-sm font-semibold">Par mode de paiement</h2>
              {accounting?.payments.length ? (
                accounting.payments.map((row) => (
                  <div key={row.method} className="flex justify-between py-1 text-sm">
                    <span className="text-slate-500 dark:text-slate-400">{row.method}</span>
                    <span className="font-medium">{money(row.total)}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Aucun mouvement.</p>
              )}
            </section>
            <section className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
              <h2 className="mb-2 text-sm font-semibold">Meilleures ventes</h2>
              {accounting?.products.length ? (
                accounting.products.map((row) => (
                  <div key={row.name} className="flex justify-between py-1 text-sm">
                    <span className="text-slate-500 dark:text-slate-400">
                      {row.quantity} × {row.name}
                    </span>
                    <span className="font-medium">{money(row.total)}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Aucun article vendu.</p>
              )}
            </section>
          </div>
        )}

        {tab === "utilisateurs" && (
          <div className="space-y-2">
            {team.map((member) => (
              <div
                key={member.email}
                className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{member.name}</span>
                  <span
                    className={
                      member.is_active
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                        : "rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                    }
                  >
                    {member.is_active ? "Actif" : "Désactivé"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {member.role || "—"} · {member.email}
                </p>
                <p className="pt-1 text-sm">
                  {member.sales_count} vente(s) · {money(member.sales_total)}
                </p>
              </div>
            ))}
            {!team.length && (
              <p className="pt-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucun compte à afficher.
              </p>
            )}
          </div>
        )}

        {tab === "parametres" && (
          <div className="space-y-3">
            <section className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
              <h2 className="mb-2 text-sm font-semibold">Mon compte</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {session.name} · {session.role || "—"}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{session.company}</p>
            </section>
            <section className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
              <h2 className="mb-2 text-sm font-semibold">Affichage</h2>
              <button
                onClick={toggle}
                className="flex w-full items-center justify-between py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
                  Thème {theme === "dark" ? "sombre" : "clair"}
                </span>
                <span className="text-brand-600 dark:text-brand-300">Changer</span>
              </button>
            </section>
            <section className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900">
              <h2 className="mb-2 text-sm font-semibold">Temps réel</h2>
              <label className="flex items-center justify-between py-2 text-sm">
                <span>Actualisation automatique</span>
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={auto}
                  onChange={(e) => switchAuto(e.target.checked)}
                />
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Les ventes du comptoir apparaissent ici en quelques secondes.
              </p>
            </section>
            <button onClick={signOut} className="btn-danger w-full py-3">
              Déconnexion
            </button>
          </div>
        )}

        {tab === "apropos" && (
          <div className="space-y-3">
            <section className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900">
              <h2 className="text-base font-semibold">{about?.company || session.company}</h2>
              {about?.manager && (
                <p className="text-sm text-slate-500 dark:text-slate-400">{about.manager}</p>
              )}
              {(about?.address || about?.city) && (
                <p className="pt-1 text-sm">
                  {[about?.address, about?.city].filter(Boolean).join(", ")}
                </p>
              )}
              {about?.phone && <p className="text-sm">Tél. : {about.phone}</p>}
              {about?.email && <p className="text-sm">{about.email}</p>}
            </section>
            {about?.about && (
              <section className="whitespace-pre-line rounded-xl bg-white p-4 text-sm shadow-sm dark:bg-slate-900">
                {about.about}
              </section>
            )}
            <p className="text-center text-xs text-slate-400">
              EasyGest {about?.version ? `— version ${about.version}` : ""}
            </p>
          </div>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] ${
              tab === key
                ? "text-brand-600 dark:text-brand-300"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
