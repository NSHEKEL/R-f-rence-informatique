import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import {
  type LucideIcon,
  Barcode,
  CreditCard,
  FileCheck2,
  FilePenLine,
  Flame,
  Image as ImageIcon,
  LayoutGrid,
  Minus,
  Pause,
  Percent,
  Play,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Truck,
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

const PAYMENTS = [
  "Espèces",
  "Mobile Money",
  "Carte bancaire",
  "Chèque",
  "Virement",
  "Crédit (à régler plus tard)",
  "Mixte",
];

/** Tender methods that may be combined inside a « Mixte » payment. */
const MIXABLE = PAYMENTS.slice(0, -1);

const PARK_KEY = "ri_parked_carts";

interface ParkedCart {
  id: string;
  at: string;
  customer_name: string;
  cart: CartLine[];
  customer: Customer | null;
  note: string;
  discount: number;
  payment: string;
  legs: Record<string, number>;
}

function readParked(): ParkedCart[] {
  try {
    const raw = localStorage.getItem(PARK_KEY);
    return raw ? (JSON.parse(raw) as ParkedCart[]) : [];
  } catch {
    return [];
  }
}

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
  /** Price agreed at the counter, when it differs from the product sheet. */
  price?: number;
  /** Discount granted on this line only, in currency units. */
  discount?: number;
}

/** Price actually charged for a cart line. */
function linePrice(line: CartLine, mode: PriceMode): number {
  return line.price ?? unitPrice(line.product, mode);
}

/** Line total after its own discount. */
function lineNet(line: CartLine, mode: PriceMode): number {
  return Math.max(
    linePrice(line, mode) * line.quantity - (line.discount ?? 0),
    0
  );
}

/** Local receipt shown while a ticket recorded offline waits for the server. */
function offlineSale(
  reference: string,
  cart: CartLine[],
  customer: Customer | null,
  payment: string,
  note: string,
  sellerName: string,
  priceMode: PriceMode,
  discount: number,
  paidAmount: number,
  legs?: { method: string; amount: number }[]
): Sale {
  const gross = cart.reduce((s, l) => s + lineNet(l, priceMode), 0);
  return {
    id: -Date.now(),
    reference,
    customer_id: customer?.id ?? null,
    customer,
    date: new Date().toISOString(),
    total: Math.max(gross - discount, 0),
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
      unit_price: linePrice(l, priceMode),
      discount: l.discount ?? 0,
      subtotal: lineNet(l, priceMode),
      returned_quantity: 0,
    })),
    print_count: 0,
    returned_total: 0,
    paid_amount: paidAmount,
    discount,
    payments: legs?.map((leg, index) => ({ id: index, ...leg })),
    pending_sync: true,
  };
}

export default function NouvelleVente() {
  const { user, can } = useAuth();
  const canChangePrice = can("prix_modifier");
  const canQuote = can("proformas");
  const { company, printing } = useCompany();
  const { online } = useNetwork();
  const version = useSyncVersion();
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bestSellerIds, setBestSellerIds] = useState<number[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | "top" | "all">(
    "top"
  );
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
  /** Per-method amounts when « Mixte » is selected. */
  const [legs, setLegs] = useState<Record<string, number>>({});
  const [parked, setParked] = useState<ParkedCart[]>(readParked());
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileView, setMobileView] = useState<"catalog" | "cart">("catalog");
  const [showParked, setShowParked] = useState(true);
  const discountRef = useRef<HTMLInputElement>(null);

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
    setFormat(printing.receipt.width);
  }, [printing.receipt.width]);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );
  const categoryName = useCallback(
    (id: number | null | undefined) =>
      id ? (categoryById.get(id) ?? "") : "Sans catégorie",
    [categoryById]
  );

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
    if (activeCategory === "all") {
      return available.slice(0, 80);
    }
    if (activeCategory === "top") {
      const ranked = bestSellerIds
        .map((id) => available.find((p) => p.id === id))
        .filter((p): p is Product => Boolean(p));
      return ranked.length > 0 ? ranked : available.slice(0, 40);
    }
    return available.filter((p) => p.category_id === activeCategory);
  }, [products, query, activeCategory, bestSellerIds]);

  const recents = useMemo(
    () =>
      [...products]
        .filter((p) => p.quantity > 0)
        .sort((a, b) => b.id - a.id)
        .slice(0, 6),
    [products]
  );

  const subtotal = useMemo(
    () => cart.reduce((sum, l) => sum + lineNet(l, priceMode), 0),
    [cart, priceMode]
  );
  const total = Math.max(subtotal - discount, 0);
  const change = paidAmount > 0 ? Math.max(paidAmount - total, 0) : 0;

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

  function setLinePrice(productId: number, value: string) {
    const price = Number(value.replace(",", "."));
    setCart((prev) =>
      prev.map((l) =>
        l.product.id === productId
          ? {
              ...l,
              price:
                value.trim() === "" || Number.isNaN(price) || price < 0
                  ? undefined
                  : price,
            }
          : l
      )
    );
  }

  function setLineDiscount(productId: number, value: string) {
    const discount = Number(value.replace(",", "."));
    setCart((prev) =>
      prev.map((l) =>
        l.product.id === productId
          ? {
              ...l,
              discount:
                value.trim() === "" || Number.isNaN(discount) || discount < 0
                  ? undefined
                  : discount,
            }
          : l
      )
    );
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

  /** True when the till must open by itself once the sale is cashed in. */
  function drawerWanted(): boolean {
    return Boolean(
      company?.drawer_enabled &&
        company.drawer_open_after_sale &&
        printing.receipt.open_drawer
    );
  }

  /**
   * Kick code of the drawer, sent along with the ticket when possible.
   * All fields must parse as bytes: a malformed code returns an empty kick so
   * the drawer API reports the bad configuration instead of sending a
   * truncated command.
   */
  function drawerKick(): number[] {
    if (!drawerWanted()) return [];
    const parts = (company?.drawer_code || "27,112,0,25,250")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const values = parts.map((part) => Number(part));
    return values.length > 0 &&
      values.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255
      )
      ? values
      : [];
  }

  /**
   * Kick code embedded in the receipt job: only when the drawer hangs off the
   * receipt printer itself (no dedicated port/printer configured). A drawer
   * configured on another COM/LPT port or another printer is left to
   * openDrawer(), which routes the kick to drawer_port.
   */
  function receiptKick(): number[] {
    const target = (company?.drawer_port || "").trim().toLowerCase();
    const receiptPrinter = (printing.receipt.printer_name || "")
      .trim()
      .toLowerCase();
    if (target && target !== receiptPrinter) return [];
    return drawerKick();
  }

  /** Electronic drawer: opening it must never hold back the next customer. */
  function openDrawer() {
    if (!drawerWanted()) return;
    api.post("/settings/company/open-drawer").catch(() => {
      setFlash("Caisse électronique : ouverture impossible.");
    });
  }

  /**
   * Checkout epilogue, in the order the counter expects: the ticket is shown,
   * printed when the printer is set to automatic, and only then the drawer is
   * asked to open.
   */
  function finishSale(sale: Sale) {
    setLastSale(sale);
    if (printing.receipt.auto_print) {
      // Let the hidden print copy mount before calling the printer.
      window.setTimeout(() => {
        printReceipt(
          printing.receipt.width,
          printing.receipt,
          receiptKick()
        ).then((drawerOpened) => {
          // The ticket carried the kick code: no second order to the till.
          // A drawer on another target (port or printer) still gets its kick
          // here, routed by the backend to drawer_port.
          if (!drawerOpened) openDrawer();
        });
      }, 400);
      return;
    }
    openDrawer();
  }

  async function checkout() {
    if (cart.length === 0) {
      setError("Le panier est vide.");
      return;
    }
    if (payment === "Mixte") {
      const legTotal = Object.values(legs).reduce((s, a) => s + a, 0);
      if (Math.abs(legTotal - total) > 0.01 || legTotal <= 0) {
        setError(
          `Paiement mixte : la somme des montants (${formatXOF(legTotal)}) ` +
            `doit égaler le total (${formatXOF(total)}).`
        );
        return;
      }
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
      discount,
      paid_amount: paidAmount,
      items: cart.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        unit_price: linePrice(l, priceMode),
        discount: l.discount ?? 0,
      })),
      payments:
        payment === "Mixte"
          ? Object.entries(legs)
              .filter(([, amount]) => amount > 0)
              .map(([method, amount]) => ({ method, amount }))
          : undefined,
    };
    try {
      const res = await api.post<Sale>("/sales", payload);
      finishSale(res.data);
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
        priceMode,
        discount,
        paidAmount,
        payload.payments
      );
      queueSale({ payload, snapshot });
      finishSale(snapshot);
      resetCart();
    } finally {
      setSaving(false);
    }
  }

  function resetCart() {
    setCart([]);
    setNote("");
    setDiscount(0);
    setPaidAmount(0);
    setLegs({});
    setCustomer(null);
    setCustomerQuery("");
    setCustomers([]);
    setQuery("");
    searchRef.current?.focus();
  }

  /**
   * Parks the current ticket: nothing is written to the server, no stock is
   * touched — the cart is kept on this till until the cashier resumes it.
   */
  function parkCart() {
    if (cart.length === 0) return;
    const entry: ParkedCart = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      customer_name: customer?.name ?? customerQuery.trim() ?? "Client",
      cart,
      customer,
      note,
      discount,
      payment,
      legs,
    };
    const next = [...readParked(), entry];
    localStorage.setItem(PARK_KEY, JSON.stringify(next));
    setParked(next);
    setFlash(
      `Ticket mis en attente${entry.customer_name ? ` (${entry.customer_name})` : ""}`
    );
    window.setTimeout(() => setFlash(""), 2000);
    resetCart();
  }

  /** Brings a parked ticket back into the cart and frees its slot. */
  function resumeCart(id: string) {
    const entry = readParked().find((p) => p.id === id);
    if (!entry) return;
    // Drop lines whose product vanished or no longer has enough stock.
    const restored = entry.cart.filter((l) => {
      const fresh = products.find((p) => p.id === l.product.id);
      if (!fresh) return false;
      l.product = fresh;
      return l.quantity <= fresh.quantity;
    });
    if (restored.length < entry.cart.length) {
      setError("Certaines lignes du ticket en attente ne sont plus disponibles.");
    }
    setCart(restored);
    setCustomer(entry.customer);
    setCustomerQuery(entry.customer?.name ?? entry.customer_name);
    setNote(entry.note);
    setDiscount(entry.discount);
    setPayment(entry.payment);
    setLegs(entry.legs ?? {});
    const next = readParked().filter((p) => p.id !== id);
    localStorage.setItem(PARK_KEY, JSON.stringify(next));
    setParked(next);
  }

  function dropParked(id: string) {
    const next = readParked().filter((p) => p.id !== id);
    localStorage.setItem(PARK_KEY, JSON.stringify(next));
    setParked(next);
  }

  /** Empties the ticket after the cashier confirms — never silently. */
  function clearCart() {
    if (cart.length === 0) return;
    if (
      !window.confirm(
        "Vider le panier ? Toutes les lignes du ticket seront supprimées."
      )
    ) {
      return;
    }
    resetCart();
  }

  /**
   * Saves the current ticket as a commercial offer ("devis") instead of
   * cashing it in — same lines and prices, the sale happens later from the
   * proformas page.
   */
  async function saveQuote(kind: "devis" | "proforma" = "devis") {
    if (cart.length === 0) {
      setError("Le panier est vide.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.post<{ reference: string }>("/proformas", {
        kind,
        status: "Brouillon",
        customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? customerQuery.trim(),
        note,
        discount,
        items: cart.map((l) => ({
          product_id: l.product.id,
          product_name: l.product.name,
          quantity: l.quantity,
          unit_price: linePrice(l, priceMode),
          discount: l.discount ?? 0,
        })),
      });
      resetCart();
      setFlash(
        `${kind === "proforma" ? "Proforma" : "Devis"} ${res.data.reference} enregistré`
      );
      window.setTimeout(() => setFlash(""), 3000);
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Impossible d'enregistrer le devis"
          : "Impossible d'enregistrer le devis"
      );
    } finally {
      setSaving(false);
    }
  }

  const quickActions: {
    icon: LucideIcon;
    label: string;
    sub: string;
    tint: string;
    onClick: () => void;
    disabled?: boolean;
  }[] = [
    {
      icon: ReceiptText,
      label: "Facture",
      sub: "Nouveau ticket",
      tint: "bg-blue-600",
      onClick: clearCart,
    },
    ...(canQuote
      ? [
          {
            icon: FileCheck2,
            label: "Pro forma",
            sub: "Facture provisoire",
            tint: "bg-violet-600",
            onClick: () => saveQuote("proforma"),
            disabled: saving || cart.length === 0,
          },
          {
            icon: FilePenLine,
            label: "Devis",
            sub: "Établir un devis",
            tint: "bg-teal-500",
            onClick: () => saveQuote("devis"),
            disabled: saving || cart.length === 0,
          },
        ]
      : []),
    ...(can("livraisons")
      ? [
          {
            icon: Truck,
            label: "Livraison",
            sub: "Bon de livraison",
            tint: "bg-cyan-600",
            onClick: () => navigate("/livraisons"),
          },
        ]
      : []),
    {
      icon: UserPlus,
      label: "Client",
      sub: "Ajouter un client",
      tint: "bg-orange-500",
      onClick: () => setNewCustomer(true),
    },
    {
      icon: Percent,
      label: "Remise",
      sub: "Remise globale",
      tint: "bg-pink-600",
      onClick: () => discountRef.current?.focus(),
      disabled: cart.length === 0 || !canChangePrice,
    },
    {
      icon: Printer,
      label: "Imprimer",
      sub: "Dernier document",
      tint: "bg-sky-700",
      onClick: () =>
        lastSale
          ? void printReceipt(format, printing.receipt)
          : navigate("/ventes"),
    },
    ...(can("retours")
      ? [
          {
            icon: RotateCcw,
            label: "Retour",
            sub: "Retour d'articles",
            tint: "bg-rose-600",
            onClick: () => navigate("/retours"),
          },
        ]
      : []),
    {
      icon: Pause,
      label: "Suspendre",
      sub: "Mettre en attente",
      tint: "bg-slate-600",
      onClick: parkCart,
      disabled: cart.length === 0,
    },
    {
      icon: Play,
      label: `Reprendre${parked.length ? ` (${parked.length})` : ""}`,
      sub: "Tickets suspendus",
      tint: "bg-amber-600",
      onClick: () => setShowParked((v) => !v),
      disabled: parked.length === 0,
    },
    {
      icon: CreditCard,
      label: "Crédit",
      sub: "Payer plus tard",
      tint: "bg-indigo-600",
      onClick: () => setPayment("Crédit (à régler plus tard)"),
    },
  ];

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

      {/* Barre d'actions rapides */}
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2">
        {quickActions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
            className={`flex min-w-[104px] shrink-0 flex-col items-center gap-1 rounded-xl px-3 py-2 text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${action.tint}`}
          >
            <action.icon size={17} />
            <span className="text-xs font-bold leading-none">{action.label}</span>
            <span className="text-[10px] font-medium leading-none opacity-80">
              {action.sub}
            </span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* Ticket in progress */}
        <div
          className={`card min-h-0 w-full flex-col overflow-y-auto p-0 md:order-2 md:flex md:w-[400px] md:shrink-0 xl:w-[440px] ${
            mobileView === "cart" ? "flex" : "hidden"
          }`}
        >
          <div className="sticky top-0 z-10 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
            <span className="flex items-center gap-2 text-base font-bold text-slate-900">
              <ShoppingCart size={18} className="text-brand-600" />
              Panier / Ticket
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
              {itemCount} article(s)
            </span>
            <div className="ml-auto flex gap-2">
              <button
                className="btn-ghost border border-brand-200 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                onClick={() => searchRef.current?.focus()}
              >
                <Plus size={15} /> Ajouter un article
              </button>
              <button
                className="btn-ghost border border-red-200 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
                onClick={clearCart}
                disabled={cart.length === 0}
              >
                <Trash2 size={15} /> Vider le panier
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 px-4 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Mode de prix
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

          {parked.length > 0 && showParked && (
            <div className="border-t border-amber-100 bg-amber-50 px-4 py-2">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-700">
                Tickets en attente
              </p>
              <div className="flex flex-wrap gap-1.5">
                {parked.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-amber-800 shadow-sm"
                  >
                    {p.customer_name} · {new Date(p.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    <button
                      className="rounded-full bg-amber-600 px-1.5 py-0.5 text-white"
                      onClick={() => resumeCart(p.id)}
                    >
                      Reprendre
                    </button>
                    <button
                      className="rounded-full bg-slate-200 px-1.5 py-0.5 text-slate-500"
                      onClick={() => dropParked(p.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          </div>

          <div className="min-h-[120px] flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Scannez un code ou cliquez sur un article.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-white">
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="w-8 px-3 py-2">#</th>
                    <th className="px-1 py-2">Produit</th>
                    <th className="w-28 px-1 py-2 text-right">Prix unit.</th>
                    <th className="w-24 px-1 py-2 text-right">Remise</th>
                    <th className="w-36 px-1 py-2 text-center">Quantité</th>
                    <th className="w-28 px-1 py-2 text-right">Total</th>
                    <th className="w-10 px-1 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l, index) => (
                    <tr
                      key={l.product.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-3 py-2.5 text-slate-400">
                        {index + 1}
                      </td>
                      <td className="px-1 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {l.product.image ? (
                            <img
                              src={l.product.image}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-lg bg-slate-50 object-contain"
                            />
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
                              <ImageIcon size={16} />
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">
                              {l.product.name}
                            </p>
                            <p className="truncate text-xs text-slate-400">
                              {categoryName(l.product.category_id)} · Stock :{" "}
                              {l.product.quantity}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-2.5 text-right">
                        {canChangePrice ? (
                          <input
                            className="w-24 rounded-lg border border-slate-200 px-1.5 py-1 text-right text-sm text-slate-700"
                            value={l.price ?? unitPrice(l.product, priceMode)}
                            onChange={(e) =>
                              setLinePrice(l.product.id, e.target.value)
                            }
                            title="Prix de vente pour cette ligne"
                            aria-label={`Prix de ${l.product.name}`}
                          />
                        ) : (
                          <span className="text-slate-600">
                            {formatXOF(linePrice(l, priceMode))}
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-2.5 text-right">
                        {canChangePrice ? (
                          <input
                            className="w-20 rounded-lg border border-slate-200 px-1.5 py-1 text-right text-sm text-slate-700"
                            value={l.discount ?? ""}
                            placeholder="0"
                            onChange={(e) =>
                              setLineDiscount(l.product.id, e.target.value)
                            }
                            title="Remise pour cette ligne"
                            aria-label={`Remise de ${l.product.name}`}
                          />
                        ) : (
                          <span className="text-slate-600">
                            {l.discount ? formatXOF(l.discount) : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200"
                            onClick={() =>
                              setQuantity(l.product.id, l.quantity - 1)
                            }
                            title="Diminuer la quantité"
                            aria-label={`Diminuer la quantité de ${l.product.name}`}
                          >
                            <Minus size={14} />
                          </button>
                          <input
                            className="w-12 rounded-lg border border-slate-200 py-1 text-center text-sm"
                            value={l.quantity}
                            onChange={(e) =>
                              setQuantity(
                                l.product.id,
                                Number(e.target.value) || 0
                              )
                            }
                            aria-label={`Quantité de ${l.product.name}`}
                          />
                          <button
                            className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200"
                            onClick={() =>
                              setQuantity(l.product.id, l.quantity + 1)
                            }
                            title="Augmenter la quantité"
                            aria-label={`Augmenter la quantité de ${l.product.name}`}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-1 py-2.5 text-right font-bold text-slate-900">
                        {formatXOF(lineNet(l, priceMode))}
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <button
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => setQuantity(l.product.id, 0)}
                          title="Retirer l'article"
                          aria-label={`Retirer ${l.product.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {cart.length > 0 && (
            <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-brand-50 px-4 py-2.5">
              <span className="text-sm font-bold text-slate-600">
                Articles : {itemCount}
              </span>
              <span className="text-sm font-semibold text-slate-500">
                Sous-total{" "}
                <span className="text-lg font-extrabold text-brand-700">
                  {formatXOF(subtotal)}
                </span>
              </span>
            </div>
          )}

          {error && (
            <p className="bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <div className="space-y-1.5 border-t border-slate-100 px-4 py-2.5">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
                      title="Retirer le client"
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
                <div className="grid grid-cols-3 gap-1.5">
                  {PAYMENTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPayment(p)}
                      className={`rounded-lg px-1 py-1.5 text-[11px] font-semibold transition ${
                        payment === p
                          ? "bg-brand-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {p === "Crédit (à régler plus tard)" ? "Crédit" : p}
                    </button>
                  ))}
                </div>
              </div>
              {payment === "Mixte" && (
                <div className="sm:col-span-2 xl:col-span-3">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    {MIXABLE.map((method) => (
                      <div key={method}>
                        <label className="label">{method}</label>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          value={legs[method] || ""}
                          onChange={(e) =>
                            setLegs((prev) => ({
                              ...prev,
                              [method]: Math.max(
                                Number(e.target.value) || 0,
                                0
                              ),
                            }))
                          }
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const legTotal = Object.values(legs).reduce(
                      (s, a) => s + a,
                      0
                    );
                    return Math.abs(legTotal - total) > 0.01 ? (
                      <p className="mt-1 text-xs font-semibold text-red-600">
                        La somme des montants ({formatXOF(legTotal)}) doit
                        égaler le total ({formatXOF(total)}).
                      </p>
                    ) : null;
                  })()}
                </div>
              )}
              <div>
                <label className="label">Remise globale</label>
                <input
                  ref={discountRef}
                  className="input"
                  type="number"
                  min={0}
                  value={discount || ""}
                  onChange={(e) =>
                    setDiscount(Math.max(Number(e.target.value) || 0, 0))
                  }
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="label">Montant reçu</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={paidAmount || ""}
                  onChange={(e) =>
                    setPaidAmount(Math.max(Number(e.target.value) || 0, 0))
                  }
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">Note sur le reçu</label>
                <input
                  className="input"
                  placeholder="Facultatif"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div>
                <label className="label">
                  {change > 0 ? "Monnaie à rendre" : "Reste à payer"}
                </label>
                <div
                  className={`input flex items-center justify-end font-bold ${
                    change > 0
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-red-200 bg-red-50 text-red-600"
                  }`}
                >
                  {formatXOF(change > 0 ? change : total - paidAmount)}
                </div>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 z-10 bg-white">
          <div className="bg-slate-800 px-4 py-2.5 text-white">
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
            {discount > 0 && (
              <div className="mt-1 flex items-center justify-between text-sm text-slate-300">
                <span>Remise</span>
                <span>- {formatXOF(discount)}</span>
              </div>
            )}
            {change > 0 && (
              <div className="mt-1 flex items-center justify-between text-sm text-emerald-300">
                <span>Monnaie à rendre</span>
                <span>{formatXOF(change)}</span>
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

          <div className="flex gap-2 p-2.5">
            <button
              className="btn-ghost flex-1 justify-center py-3"
              onClick={parkCart}
              disabled={cart.length === 0}
            >
              Attente
            </button>
            <button
              className="btn-ghost flex-1 justify-center py-3"
              onClick={clearCart}
              disabled={cart.length === 0}
            >
              Vider
            </button>
            {canQuote && (
              <button
                className="btn-ghost flex-1 justify-center py-3"
                onClick={() => saveQuote("devis")}
                disabled={saving || cart.length === 0}
              >
                Devis
              </button>
            )}
            <button
              className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-base font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={checkout}
              disabled={saving || cart.length === 0}
            >
              {saving ? "Encaissement..." : `Payer ${formatXOF(total)}`}
            </button>
          </div>
          </div>
        </div>

        {/* Article picker */}
        <div
          className={`card min-h-0 min-w-0 flex-1 flex-col p-4 md:order-1 md:flex ${
            mobileView === "catalog" ? "flex" : "hidden"
          }`}
        >
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <input
              ref={searchRef}
              autoFocus
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Rechercher un article, un code ou une catégorie..."
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
                className="shrink-0 text-slate-400 hover:text-slate-600"
                onClick={() => setQuery("")}
                title="Effacer la recherche"
                aria-label="Effacer la recherche"
              >
                <X size={16} />
              </button>
            )}
            <button
              className="shrink-0 rounded-lg border border-brand-200 p-2 text-brand-600 transition hover:bg-brand-50"
              onClick={submitSearch}
              title="Scanner un code-barres ou ajouter l'article trouvé"
              aria-label="Scanner un code-barres ou ajouter l'article trouvé"
            >
              <Barcode size={16} />
            </button>
          </div>
          {!query && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveCategory("all")}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  activeCategory === "all"
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Tous
              </button>
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
          <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto sm:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-brand-400 hover:shadow"
              >
                {p.image ? (
                  <img
                    src={p.image}
                    alt=""
                    className="mb-2 h-20 w-full rounded-xl object-contain"
                  />
                ) : (
                  <span className="mb-2 flex h-20 w-full items-center justify-center rounded-xl bg-slate-100 text-slate-300">
                    <ImageIcon size={22} />
                  </span>
                )}
                <p className="line-clamp-2 min-h-[2.5rem] text-sm font-bold text-slate-800">
                  {p.name}
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  {categoryName(p.category_id)}
                </p>
                <p className="mt-0.5 text-sm font-extrabold text-brand-700">
                  {formatXOF(unitPrice(p, priceMode))}
                </p>
                <div className="mt-1.5 flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      p.quantity <= p.min_stock
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    Stock : {p.quantity}
                  </span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
                    <Plus size={15} />
                  </span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-slate-400">
                Aucun article disponible.
              </p>
            )}
          </div>
          {!query && recents.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Articles récemment ajoutés
                </h3>
                <Link
                  to="/produits"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  Voir tout
                </Link>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {recents.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="flex w-28 shrink-0 flex-col items-center rounded-xl border border-slate-200 bg-white p-2 text-center hover:border-brand-400"
                  >
                    {p.image ? (
                      <img
                        src={p.image}
                        alt=""
                        className="mb-1 h-10 w-full object-contain"
                      />
                    ) : (
                      <span className="mb-1 flex h-10 items-center justify-center text-slate-300">
                        <ImageIcon size={18} />
                      </span>
                    )}
                    <p className="w-full truncate text-[11px] font-semibold text-slate-700">
                      {p.name}
                    </p>
                    <p className="text-[11px] font-bold text-brand-700">
                      {formatXOF(unitPrice(p, priceMode))}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bascule catalogue / panier — mobile */}
      <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2 md:hidden">
        <button
          className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${
            mobileView === "catalog"
              ? "bg-brand-50 text-brand-700"
              : "text-slate-500"
          }`}
          onClick={() => setMobileView("catalog")}
        >
          <LayoutGrid size={16} /> Catalogue
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-bold text-white"
          onClick={() => setMobileView("cart")}
        >
          <ShoppingCart size={16} /> Panier ({itemCount}) · {formatXOF(total)}
        </button>
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
                onChange={(e) => setFormat(e.target.value as ReceiptFormat)}
              >
                <option value="A4">Feuille A4</option>
                <option value="80mm">Ticket 80 mm</option>
                <option value="58mm">Ticket 58 mm</option>
              </select>
              <button className="btn-ghost" onClick={() => setLastSale(null)}>
                Nouvelle vente
              </button>
              <PrinterHint />
              <button
                className="btn-primary"
                onClick={() => printReceipt(format, printing.receipt)}
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
