import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Lock,
  Minus,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  Unlock,
  Wallet,
} from "lucide-react";
import api, { formatXOF } from "../api/client";
import type {
  CashSessionDetail,
  CompanySettings,
  Customer,
  Product,
  ReceiptFormat,
  Sale,
} from "../types";
import Modal from "../components/Modal";
import Receipt from "../components/Receipt";
import { printReceipt } from "../lib/print";
import { useAuth } from "../context/AuthContext";

const PAYMENTS = ["Espèces", "Mobile Money", "Carte bancaire", "Virement"];

interface CartLine {
  product: Product;
  quantity: number;
}

export default function Caisse() {
  const { isAdmin } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [session, setSession] = useState<CashSessionDetail | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [payment, setPayment] = useState(PAYMENTS[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [openCash, setOpenCash] = useState(false);
  const [closeCash, setCloseCash] = useState(false);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [countedBalance, setCountedBalance] = useState("0");
  const [cashNote, setCashNote] = useState("");

  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [format, setFormat] = useState<ReceiptFormat>("A4");

  const loadSession = useCallback(async () => {
    const res = await api.get<CashSessionDetail | null>(
      "/cash-sessions/current"
    );
    setSession(res.data);
  }, []);

  const loadProducts = useCallback(async () => {
    const res = await api.get<Product[]>("/products");
    setProducts(res.data);
  }, []);

  useEffect(() => {
    loadProducts();
    loadSession();
    api
      .get<Customer[]>("/customers")
      .then((res) => setCustomers(res.data))
      .catch(() => setCustomers([]));
    api
      .get<CompanySettings>("/settings/company")
      .then((res) => {
        setCompany(res.data);
        setFormat(res.data.receipt_format === "80mm" ? "80mm" : "A4");
      })
      .catch(() => setCompany(null));
  }, [loadProducts, loadSession]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = products.filter((p) => p.quantity > 0);
    if (!q) return available.slice(0, 24);
    return available
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      )
      .slice(0, 24);
  }, [products, query]);

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + l.product.sale_price * l.quantity, 0),
    [cart]
  );

  function addToCart(product: Product) {
    setError("");
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (!existing) return [...prev, { product, quantity: 1 }];
      if (existing.quantity >= product.quantity) return prev;
      return prev.map((l) =>
        l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l
      );
    });
  }

  function setQuantity(productId: number, quantity: number) {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.product.id !== productId) return [l];
        const capped = Math.min(Math.max(quantity, 0), l.product.quantity);
        return capped === 0 ? [] : [{ ...l, quantity: capped }];
      })
    );
  }

  async function checkout() {
    if (cart.length === 0) {
      setError("Le panier est vide.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.post<Sale>("/sales", {
        customer_id: customerId === "" ? null : Number(customerId),
        payment_method: payment,
        status: "Payée",
        note,
        items: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
        })),
      });
      setCart([]);
      setNote("");
      setCustomerId("");
      setLastSale(res.data);
      await Promise.all([loadProducts(), loadSession()]);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'encaissement");
      }
    } finally {
      setSaving(false);
    }
  }

  async function submitOpen() {
    setError("");
    try {
      await api.post("/cash-sessions/open", {
        opening_balance: Number(openingBalance) || 0,
        note: cashNote,
      });
      setOpenCash(false);
      setCashNote("");
      setOpeningBalance("0");
      await loadSession();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible d'ouvrir la caisse");
      }
    }
  }

  async function submitClose() {
    setError("");
    try {
      await api.post("/cash-sessions/close", {
        closing_balance: Number(countedBalance) || 0,
        note: cashNote,
      });
      setCloseCash(false);
      setCashNote("");
      setCountedBalance("0");
      await loadSession();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible de fermer la caisse");
      }
    }
  }

  const countedDifference =
    (Number(countedBalance) || 0) - (session?.expected_cash ?? 0);

  return (
    <div className="space-y-5">
      {/* Cash session banner */}
      <div className="card p-5">
        {session ? (
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Unlock size={20} />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  Caisse ouverte
                </p>
                <p className="text-xs text-slate-500">
                  Par {session.opened_by?.name ?? "—"} ·{" "}
                  {new Date(session.opened_at).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <p className="text-xs text-slate-400">Fonds d'ouverture</p>
                <p className="font-bold text-slate-800">
                  {formatXOF(session.opening_balance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Ventes espèces</p>
                <p className="font-bold text-slate-800">
                  {formatXOF(session.cash_sales)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Autres paiements</p>
                <p className="font-bold text-slate-800">
                  {formatXOF(session.other_sales)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Solde attendu</p>
                <p className="font-extrabold text-brand-700">
                  {formatXOF(session.expected_cash)}
                </p>
              </div>
            </div>
            <button
              className="btn-ghost ml-auto"
              onClick={() => {
                setCountedBalance(String(session.expected_cash));
                setCashNote("");
                setCloseCash(true);
              }}
            >
              <Lock size={16} /> Fermer la caisse
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Wallet size={20} />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">Caisse fermée</p>
              <p className="text-xs text-slate-500">
                Ouvrez la caisse avec le fonds initial pour suivre les
                encaissements de la journée.
              </p>
            </div>
            <button
              className="btn-primary ml-auto"
              onClick={() => setOpenCash(true)}
            >
              <Unlock size={16} /> Ouvrir la caisse
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Product picker */}
        <div className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <Search size={18} className="text-slate-400" />
            <input
              autoFocus
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Rechercher un article (nom ou code)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-400 hover:bg-brand-50"
              >
                <p className="line-clamp-2 text-sm font-semibold text-slate-800">
                  {p.name}
                </p>
                <p className="mt-1 text-sm font-extrabold text-brand-700">
                  {formatXOF(p.sale_price)}
                </p>
                {isAdmin && (
                  <p className="text-xs text-slate-400">
                    Stock : {p.quantity}
                  </p>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-slate-400">
                Aucun article disponible.
              </p>
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="card flex flex-col p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShoppingCart size={18} className="text-brand-600" />
            <h3 className="text-base font-bold text-slate-900">Panier</h3>
            <span className="ml-auto text-sm text-slate-400">
              {cart.length} ligne(s)
            </span>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto">
            {cart.length === 0 && (
              <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                Cliquez sur un article pour l'ajouter.
              </p>
            )}
            {cart.map((l) => (
              <div
                key={l.product.id}
                className="flex items-center gap-2 rounded-xl border border-slate-100 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {l.product.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatXOF(l.product.sale_price)} ×{l.quantity} ={" "}
                    <span className="font-semibold text-slate-700">
                      {formatXOF(l.product.sale_price * l.quantity)}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200"
                    onClick={() => setQuantity(l.product.id, l.quantity - 1)}
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    className="w-12 rounded-lg border border-slate-200 py-1 text-center text-sm"
                    value={l.quantity}
                    onChange={(e) =>
                      setQuantity(l.product.id, Number(e.target.value) || 0)
                    }
                  />
                  <button
                    className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200"
                    onClick={() => setQuantity(l.product.id, l.quantity + 1)}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => setQuantity(l.product.id, 0)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Client</label>
                <select
                  className="input"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Client de passage</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Paiement</label>
                <select
                  className="input"
                  value={payment}
                  onChange={(e) => setPayment(e.target.value)}
                >
                  {PAYMENTS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <input
              className="input"
              placeholder="Note sur le reçu (facultatif)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
              <span className="text-sm font-medium uppercase">Total</span>
              <span className="text-xl font-extrabold">{formatXOF(total)}</span>
            </div>
            <button
              className="btn-primary w-full py-3 text-base"
              onClick={checkout}
              disabled={saving || cart.length === 0}
            >
              {saving ? "Encaissement..." : "Encaisser"}
            </button>
          </div>
        </div>
      </div>

      {/* Open cash modal */}
      <Modal
        open={openCash}
        onClose={() => setOpenCash(false)}
        title="Ouverture de caisse"
        footer={
          <button className="btn-primary" onClick={submitOpen}>
            Ouvrir la caisse
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Fonds de caisse initial (FCFA)</label>
            <input
              className="input"
              type="number"
              min="0"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Note (facultatif)</label>
            <input
              className="input"
              value={cashNote}
              onChange={(e) => setCashNote(e.target.value)}
              placeholder="Ex. billets remis par le gérant"
            />
          </div>
        </div>
      </Modal>

      {/* Close cash modal */}
      <Modal
        open={closeCash}
        onClose={() => setCloseCash(false)}
        title="Fermeture de caisse"
        footer={
          <button className="btn-primary" onClick={submitClose}>
            Fermer la caisse
          </button>
        }
      >
        {session && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
              <span className="text-slate-500">Fonds d'ouverture</span>
              <span className="text-right font-semibold">
                {formatXOF(session.opening_balance)}
              </span>
              <span className="text-slate-500">Ventes en espèces</span>
              <span className="text-right font-semibold">
                {formatXOF(session.cash_sales)}
              </span>
              <span className="text-slate-500">Solde attendu</span>
              <span className="text-right font-extrabold text-brand-700">
                {formatXOF(session.expected_cash)}
              </span>
            </div>
            <div>
              <label className="label">Montant compté en caisse (FCFA)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={countedBalance}
                onChange={(e) => setCountedBalance(e.target.value)}
              />
            </div>
            <p
              className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                Math.abs(countedDifference) < 1
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {Math.abs(countedDifference) < 1
                ? "Caisse conforme"
                : `Écart : ${formatXOF(countedDifference)}`}
            </p>
            <div>
              <label className="label">Note de fermeture (facultatif)</label>
              <input
                className="input"
                value={cashNote}
                onChange={(e) => setCashNote(e.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Receipt after checkout */}
      <Modal
        open={lastSale !== null}
        onClose={() => setLastSale(null)}
        title={lastSale ? `Vente enregistrée — ${lastSale.reference}` : ""}
        footer={
          lastSale && (
            <div className="no-print flex w-full items-center justify-end gap-3">
              <select
                className="input w-auto"
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value === "80mm" ? "80mm" : "A4")
                }
              >
                <option value="A4">Feuille A4</option>
                <option value="80mm">Ticket 80 mm</option>
              </select>
              <button className="btn-ghost" onClick={() => setLastSale(null)}>
                Nouvelle vente
              </button>
              <button
                className="btn-primary"
                onClick={() => printReceipt(format)}
              >
                <Printer size={16} /> Imprimer le reçu
              </button>
            </div>
          )
        }
      >
        {lastSale && (
          <Receipt sale={lastSale} company={company} format={format} />
        )}
      </Modal>
    </div>
  );
}
