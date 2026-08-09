import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
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
  Customer,
  Product,
  ReceiptFormat,
  Sale,
} from "../types";
import Modal from "../components/Modal";
import PrinterHint from "../components/PrinterHint";
import Receipt from "../components/Receipt";
import { printReceipt } from "../lib/print";
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
  sellerName: string
): Sale {
  return {
    id: -Date.now(),
    reference,
    customer_id: customer?.id ?? null,
    customer,
    date: new Date().toISOString(),
    total: cart.reduce((s, l) => s + l.product.sale_price * l.quantity, 0),
    status: "Payée",
    payment_method: payment,
    note,
    receipt_footer: "",
    created_by: { id: 0, name: sellerName, email: "", role: "", is_active: true },
    items: cart.map((l, index) => ({
      id: index,
      product_id: l.product.id,
      product_name: l.product.name,
      quantity: l.quantity,
      unit_price: l.product.sale_price,
      subtotal: l.product.sale_price * l.quantity,
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [session, setSession] = useState<CashSessionDetail | null>(null);
  const [tillLoaded, setTillLoaded] = useState(false);
  const [dayClosed, setDayClosed] = useState(false);

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
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
  }, []);

  const loadCustomers = useCallback(async () => {
    const { data } = await fetchCached<Customer[]>("/customers", "customers");
    setCustomers(data);
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
    loadCustomers().catch(() => setCustomers([]));
    loadSession();
  }, [loadProducts, loadCustomers, loadSession, version]);

  useEffect(() => {
    if (company) {
      setFormat(company.receipt_format === "80mm" ? "80mm" : "A4");
    }
  }, [company]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = products.filter((p) => p.quantity > 0);
    if (!q) return available.slice(0, 40);
    return available
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.qr_code || "").toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [products, query]);

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + l.product.sale_price * l.quantity, 0),
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
      (p) =>
        p.sku.toLowerCase() === q ||
        (p.qr_code || "").toLowerCase() === q ||
        p.name.toLowerCase() === q
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
      setCustomers((prev) => [...prev, res.data]);
      setCustomerId(String(res.data.id));
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
    const customer = customers.find((c) => String(c.id) === customerId) ?? null;
    const payload: SalePayload = {
      client_id: newClientId(),
      customer_id: customer?.id ?? null,
      payment_method: payment,
      status: "Payée",
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
        user?.name ?? ""
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
    setCustomerId("");
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Article picker */}
        <div className="card flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <Search size={18} className="text-slate-400" />
            <input
              ref={searchRef}
              autoFocus
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Nom, code article ou scan du QR code, puis Entrée..."
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
          </div>
          {flash && (
            <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              {flash}
            </p>
          )}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="flex flex-col rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-400 hover:bg-brand-50"
              >
                <p className="line-clamp-2 text-sm font-semibold text-slate-800">
                  {p.name}
                </p>
                <p className="mt-auto pt-2 text-sm font-extrabold text-brand-700">
                  {formatXOF(p.sale_price)}
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

        {/* Cart */}
        <div className="card flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShoppingCart size={18} className="text-brand-600" />
            <h2 className="text-base font-bold text-slate-900">Panier</h2>
            <span className="ml-auto text-sm text-slate-400">
              {cart.length} ligne(s)
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {cart.length === 0 && (
              <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                Scannez un code ou cliquez sur un article.
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

          {error && (
            <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-2 gap-3">
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
              <span className="text-2xl font-extrabold">
                {formatXOF(total)}
              </span>
            </div>
            <button
              className="btn-primary w-full py-3 text-base"
              onClick={checkout}
              disabled={saving || cart.length === 0}
            >
              {saving ? "Encaissement..." : "Valider la vente"}
            </button>
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
