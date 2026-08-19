import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
  Flame,
  Image as ImageIcon,
  Minus,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  WifiOff,
  X,
} from "lucide-react";
import api, { formatXOF } from "../api/client";
import type {
  CashSessionDetail,
  Category,
  Customer,
  Product,
  ReceiptFormat,
  Sale,
} from "../types";
import Modal from "../components/Modal";
import PrinterHint from "../components/PrinterHint";
import Receipt from "../components/Receipt";
import { printReceipt } from "../lib/print";
import { scanCodes } from "../lib/scan";
import { vatBreakdown } from "../lib/vat";
import {
  fetchCached,
  newClientId,
  queueSale,
  type SalePayload,
} from "../lib/offline";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useNetwork } from "../context/NetworkContext";
import { useSyncVersion } from "../context/SyncContext";

const PAYMENTS = ["Espèces", "Mobile Money", "Carte bancaire", "Virement"];

type PriceMode = "detail" | "gros";

/** Wholesale price when the till is in "gros" mode and the article has one. */
function unitPrice(product: Product, mode: PriceMode): number {
  return mode === "gros" && (product.wholesale_price || 0) > 0
    ? product.wholesale_price
    : product.sale_price;
}

interface CartLine {
  product: Product;
  quantity: number;
}

/** Local receipt shown while a ticket recorded offline waits for the server. */
function offlineSale(
  reference: string,
  cart: CartLine[],
  customer: Customer | null,
  payment: string,
  note: string,
  sellerName: string,
  priceMode: PriceMode
): Sale {
  return {
    id: -Date.now(),
    reference,
    customer_id: customer?.id ?? null,
    customer,
    date: new Date().toISOString(),
    total: cart.reduce(
      (s, l) => s + unitPrice(l.product, priceMode) * l.quantity,
      0
    ),
    status: "Payée",
    payment_method: payment,
    note,
    receipt_footer: "",
    price_mode: priceMode,
    created_by: { id: 0, name: sellerName, email: "", role: "", is_active: true },
    items: cart.map((l, index) => ({
      id: index,
      product_id: l.product.id,
      product_name: l.product.name,
      quantity: l.quantity,
      unit_price: unitPrice(l.product, priceMode),
      subtotal: unitPrice(l.product, priceMode) * l.quantity,
      returned_quantity: 0,
    })),
    print_count: 0,
    returned_total: 0,
    pending_sync: true,
  };
}

export default function NouvelleVente() {
  const { user, isAdmin } = useAuth();
  const { company } = useCompany();
  const { online } = useNetwork();
  const version = useSyncVersion();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bestSellerIds, setBestSellerIds] = useState<number[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | "top">("top");
  const [priceMode, setPriceMode] = useState<PriceMode>("detail");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [session, setSession] = useState<CashSessionDetail | null>(null);
  const [tillLoaded, setTillLoaded] = useState(false);
  const [dayClosed, setDayClosed] = useState(false);

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payment, setPayment] = useState(PAYMENTS[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);

  const [newCustomer, setNewCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
  });

  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [format, setFormat] = useState<ReceiptFormat>("A4");
  const searchRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(async () => {
    const { data } = await fetchCached<Product[]>("/products", "products");
    setProducts(data);
    const cats = await fetchCached<Category[]>("/categories", "categories");
    setCategories(cats.data);
    try {
      const top = await api.get<Product[]>("/products/best-sellers");
      setBestSellerIds(top.data.map((p) => p.id));
    } catch {
      /* offline: fall back to every article */
    }
  }, []);


  const loadSession = useCallback(async () => {
    try {
      const [current, today] = await Promise.all([
        api.get<CashSessionDetail | null>("/cash-sessions/current"),
        api.get<CashSessionDetail | null>("/cash-sessions/today"),
      ]);
      setSession(current.data);
      setDayClosed(Boolean(today.data?.closed_at));
    } catch {
      /* offline: keep selling with the last known state */
    } finally {
      setTillLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadProducts().catch(() => setProducts([]));
    loadSession();
  }, [loadProducts, loadSession, version]);

  // Customers are looked up on demand: the till never lists the whole file.
  useEffect(() => {
    const term = customerQuery.trim();
    if (term.length < 2) {
      setCustomers([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<Customer[]>("/customers/search", { params: { q: term } })
        .then((res) => setCustomers(res.data))
        .catch(() => setCustomers([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerQuery]);

  useEffect(() => {
    if (company) {
      setFormat(company.receipt_format === "80mm" ? "80mm" : "A4");
    }
  }, [company]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = products.filter((p) => p.quantity > 0);
    if (q) {
      return available
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            scanCodes(p).some((code) => code.includes(q))
        )
        .slice(0, 60);
    }
    if (activeCategory === "top") {
      const ranked = bestSellerIds
        .map((id) => available.find((p) => p.id === id))
        .filter((p): p is Product => Boolean(p));
      return ranked.length > 0 ? ranked : available.slice(0, 40);
    }
    return available.filter((p) => p.category_id === activeCategory);
  }, [products, query, activeCategory, bestSellerIds]);

  const total = useMemo(
    () =>
      cart.reduce(
        (sum, l) => sum + unitPrice(l.product, priceMode) * l.quantity,
        0
      ),
    [cart, priceMode]
  );

  const vat = vatBreakdown(total, company);

  const itemCount = useMemo(
    () => cart.reduce((sum, l) => sum + l.quantity, 0),
    [cart]
  );

  const addToCart = useCallback((product: Product) => {
    setError("");
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (!existing) return [...prev, { product, quantity: 1 }];
      if (existing.quantity >= product.quantity) return prev;
      return prev.map((l) =>
        l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l
      );
    });
  }, []);

  /** Enter validates the search: exact code first (scanner), else best match. */
  function submitSearch() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = products.find(
      (p) => scanCodes(p).includes(q) || p.name.toLowerCase() === q
    );
    const target = exact ?? filtered[0];
    if (!target) {
      setError(`Aucun article pour « ${query.trim()} »`);
      return;
    }
    if (target.quantity <= 0) {
      setError(`${target.name} est en rupture de stock`);
      return;
    }
    addToCart(target);
    setFlash(`${target.name} ajouté`);
    window.setTimeout(() => setFlash(""), 1500);
    setQuery("");
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

  async function createCustomer() {
    if (!customerForm.name.trim()) {
      setError("Le nom du client est obligatoire");
      return;
    }
    try {
      const res = await api.post<Customer>("/customers", customerForm);
      setCustomer(res.data);
      setCustomerQuery("");
      setCustomers([]);
      setNewCustomer(false);
      setCustomerForm({ name: "", phone: "", email: "", address: "" });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible de créer le client");
      }
    }
  }

  async function checkout() {
    if (cart.length === 0) {
      setError("Le panier est vide.");
      return;
    }
    setSaving(true);
    setError("");
    const payload: SalePayload = {
      client_id: newClientId(),
      customer_id: customer?.id ?? null,
      payment_method: payment,
      status: "Payée",
      price_mode: priceMode,
      note,
      items: cart.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
      })),
    };
    try {
      const res = await api.post<Sale>("/sales", payload);
      setLastSale(res.data);
      resetCart();
      await Promise.all([loadProducts(), loadSession()]);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status) {
        setError(
          axios.isAxiosError(err)
            ? err.response?.data?.detail ?? "Erreur lors de l'encaissement"
            : "Erreur lors de l'encaissement"
        );
        setSaving(false);
        return;
      }
      // No answer from the server: keep the ticket locally and print it.
      const snapshot = offlineSale(
        `HORS-LIGNE-${new Date().toISOString().slice(11, 19)}`,
        cart,
        customer,
        payment,
        note,
        user?.name ?? "",
        priceMode
      );
      queueSale({ payload, snapshot });
      setLastSale(snapshot);
      resetCart();
    } finally {
      setSaving(false);
    }
  }

  function resetCart() {
    setCart([]);
    setNote("");
    setCustomer(null);
    setCustomerQuery("");
    setCustomers([]);
    setQuery("");
    searchRef.current?.focus();
  }

  if (tillLoaded && !session) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="card max-w-md space-y-3 p-8 text-center">
          <h2 className="text-lg font-bold text-slate-900">
            {dayClosed
              ? "Votre caisse est fermée pour aujourd'hui"
              : "Votre caisse n'est pas ouverte"}
          </h2>
          <p className="text-sm text-slate-500">
            {dayClosed
              ? "La caisse ne se rouvre pas le même jour : les ventes reprendront à la prochaine ouverture."
              : "Ouvrez votre caisse pour enregistrer des ventes. L'ouverture se fait une seule fois par jour."}
          </p>
          <Link className="btn-primary inline-flex" to="/caisse">
            {dayClosed ? "Voir ma caisse" : "Ouvrir ma caisse"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-base font-bold text-slate-900">Nouvelle vente</h1>
        {session && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            Caisse ouverte · {formatXOF(session.expected_cash)}
          </span>
        )}
        {!online && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            <WifiOff size={13} /> Mode local
          </span>
        )}
        <Link className="btn-ghost ml-auto" to="/ventes">
          Historique des ventes
        </Link>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[380px_1fr]">
        {/* Ticket in progress */}
        <div className="card flex min-h-0 flex-col overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
            <input
              ref={searchRef}
              autoFocus
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Scanner ou taper un article"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitSearch();
                }
              }}
            />
            {query && (
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setQuery("")}
              >
                <X size={16} />
              </button>
            )}
            <button className="btn-primary shrink-0 py-1.5" onClick={submitSearch}>
              <Search size={15} /> Scan
            </button>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 px-4 py-2">
            <ShoppingCart size={15} className="text-slate-500" />
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Ticket · {cart.length} ligne(s)
            </span>
            <div className="ml-auto flex rounded-lg bg-white p-0.5 text-[11px] font-semibold">
              {(["detail", "gros"] as PriceMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPriceMode(mode)}
                  className={`rounded-md px-2 py-1 transition ${
                    priceMode === mode
                      ? "bg-brand-600 text-white"
                      : "text-slate-500"
                  }`}
                >
                  {mode === "detail" ? "Détail" : "Gros"}
                </button>
              ))}
            </div>
          </div>

          {flash && (
            <p className="bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700">
              {flash}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Scannez un code ou cliquez sur un article.
              </p>
            )}
            {cart.map((l) => (
              <div
                key={l.product.id}
                className="border-b border-slate-100 px-4 py-2.5"
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">
                    {l.product.name}
                  </p>
                  <span className="w-8 text-center text-sm text-slate-600">
                    {l.quantity}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right text-sm font-bold text-slate-900">
                    {formatXOF(unitPrice(l.product, priceMode) * l.quantity)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <span className="mr-auto text-xs text-slate-400">
                    {formatXOF(unitPrice(l.product, priceMode))} l'unité
                  </span>
                  <button
                    className="rounded-lg bg-slate-100 p-1 text-slate-600 hover:bg-slate-200"
                    onClick={() => setQuantity(l.product.id, l.quantity - 1)}
                  >
                    <Minus size={13} />
                  </button>
                  <input
                    className="w-11 rounded-lg border border-slate-200 py-0.5 text-center text-sm"
                    value={l.quantity}
                    onChange={(e) =>
                      setQuantity(l.product.id, Number(e.target.value) || 0)
                    }
                  />
                  <button
                    className="rounded-lg bg-slate-100 p-1 text-slate-600 hover:bg-slate-200"
                    onClick={() => setQuantity(l.product.id, l.quantity + 1)}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => setQuantity(l.product.id, 0)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {error && (
            <p className="bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <div className="space-y-2 border-t border-slate-100 px-4 py-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex items-center justify-between">
                  <label className="label">Client</label>
                  <button
                    className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                    onClick={() => setNewCustomer(true)}
                  >
                    <UserPlus size={13} /> Nouveau
                  </button>
                </div>
                {customer ? (
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <span className="truncate font-semibold text-slate-700">
                      {customer.name}
                    </span>
                    <button
                      className="ml-auto text-slate-400 hover:text-slate-600"
                      onClick={() => setCustomer(null)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      className="input"
                      placeholder="Client de passage — tapez un nom"
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                    />
                    {customers.length > 0 && (
                      <ul className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                        {customers.map((c) => (
                          <li key={c.id}>
                            <button
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                              onClick={() => {
                                setCustomer(c);
                                setCustomerQuery("");
                                setCustomers([]);
                              }}
                            >
                              {c.name}
                              {c.phone ? ` · ${c.phone}` : ""}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
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
          </div>

          <div className="bg-slate-800 px-4 py-3 text-white">
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>Articles</span>
              <span>{itemCount}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm text-slate-300">
              <span>{vat ? "Total HT" : "Sous-total"}</span>
              <span>{formatXOF(vat ? vat.excluded : total)}</span>
            </div>
            {vat && (
              <div className="mt-1 flex items-center justify-between text-sm text-slate-300">
                <span>TVA ({vat.rate} %)</span>
                <span>{formatXOF(vat.vat)}</span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-slate-600 pt-2">
              <span className="text-base font-bold uppercase">
                {vat ? "Total TTC" : "Total"}
              </span>
              <span className="text-2xl font-extrabold">
                {formatXOF(total)}
              </span>
            </div>
          </div>

          <div className="flex gap-2 p-3">
            <button
              className="btn-ghost flex-1 justify-center py-3"
              onClick={resetCart}
              disabled={cart.length === 0}
            >
              Vider
            </button>
            <button
              className="btn-primary flex-[2] justify-center py-3 text-base"
              onClick={checkout}
              disabled={saving || cart.length === 0}
            >
              {saving ? "Encaissement..." : `Payer ${formatXOF(total)}`}
            </button>
          </div>
        </div>

        {/* Article picker */}
        <div className="card flex min-h-0 flex-col p-4">
          {!query && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveCategory("top")}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  activeCategory === "top"
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Flame size={13} /> Meilleures ventes
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    activeCategory === c.id
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="flex flex-col items-center rounded-2xl border-2 border-brand-500 bg-white p-3 text-center transition hover:bg-brand-50"
              >
                {p.image ? (
                  <img
                    src={p.image}
                    alt=""
                    className="mb-2 h-24 w-full rounded-xl object-contain"
                  />
                ) : (
                  <span className="mb-2 flex h-24 w-full items-center justify-center rounded-xl bg-slate-100 text-slate-300">
                    <ImageIcon size={22} />
                  </span>
                )}
                <p className="line-clamp-2 text-sm font-bold text-slate-800">
                  {p.name}
                </p>
                <p className="mt-auto pt-1 text-sm font-extrabold text-brand-700">
                  {formatXOF(unitPrice(p, priceMode))}
                </p>
                {isAdmin && (
                  <p className="text-xs text-slate-400">Stock : {p.quantity}</p>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-slate-400">
                Aucun article disponible.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* New customer */}
      <Modal
        open={newCustomer}
        onClose={() => setNewCustomer(false)}
        title="Nouveau client"
        footer={
          <button className="btn-primary" onClick={createCustomer}>
            Enregistrer le client
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Nom *</label>
            <input
              autoFocus
              className="input"
              value={customerForm.name}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, name: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Téléphone</label>
              <input
                className="input"
                value={customerForm.phone}
                onChange={(e) =>
                  setCustomerForm({ ...customerForm, phone: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                value={customerForm.email}
                onChange={(e) =>
                  setCustomerForm({ ...customerForm, email: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <label className="label">Adresse</label>
            <input
              className="input"
              value={customerForm.address}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, address: e.target.value })
              }
            />
          </div>
        </div>
      </Modal>

      {/* Receipt preview right after checkout */}
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
              <PrinterHint />
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
          <>
            {lastSale.pending_sync && (
              <p className="no-print mb-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
                Ticket enregistré localement : il partira au serveur dès le
                retour du réseau.
              </p>
            )}
            <Receipt sale={lastSale} company={company} format={format} />
          </>
        )}
      </Modal>
    </div>
  );
}
