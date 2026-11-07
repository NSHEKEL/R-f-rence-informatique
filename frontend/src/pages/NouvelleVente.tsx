import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import {
  type LucideIcon,
  Apple,
  Banknote,
  Barcode,
  ChevronDown,
  CreditCard,
  CupSoda,
  FileCheck2,
  FilePenLine,
  Flame,
  Gift,
  HandCoins,
  Home,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  List,
  Minus,
  Monitor,
  Pause,
  Percent,
  Play,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Send,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Trash2,
  Truck,
  UserPlus,
  WifiOff,
  X,
} from "lucide-react";
import api, { formatXOF, localApi } from "../api/client";
import type {
  CashSessionDetail,
  Category,
  Customer,
  Product,
  ReceiptFormat,
  Sale,
  Supplier,
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
  legs?: { method: string; amount: number }[],
  isGift = false
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
    is_gift: isGift,
    payments: legs?.map((leg, index) => ({ id: index, ...leg })),
    pending_sync: true,
  };
}

export default function NouvelleVente() {
  const { user, can } = useAuth();
  const canChangePrice = can("prix_modifier");
  const canGift = can("ventes_cadeau");
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
  /** Discount input mode: percent of the subtotal (default) or fixed FCFA. */
  const [discountPercent, setDiscountPercent] = useState(true);
  /** Gift sale: items offerted, excluded from revenue. */
  const [gift, setGift] = useState(false);
  const [paidAmount, setPaidAmount] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileView, setMobileView] = useState<"catalog" | "cart">("catalog");
  const [showParked, setShowParked] = useState(true);
  const [cartW, setCartW] = useState(
    () => Number(localStorage.getItem("ri_cart_w")) || 0
  );
  const cartRef = useRef<HTMLDivElement>(null);
  const [uiScale, setUiScale] = useState(
    () => Number(localStorage.getItem("ri_ui_scale")) || 1
  );
  const setScale = (v: number) => {
    const s = Math.min(1.3, Math.max(0.7, Math.round(v * 10) / 10));
    setUiScale(s);
    localStorage.setItem("ri_ui_scale", String(s));
    window.dispatchEvent(new Event("ri_ui_scale_change"));
  };
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierFilter, setSupplierFilter] = useState<number | "all">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [cartCollapsed, setCartCollapsed] = useState(false);
  const [validMenu, setValidMenu] = useState(false);
  const discountRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);
  const validateRef = useRef<HTMLButtonElement>(null);

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
      const sup = await api.get<Supplier[]>("/suppliers");
      setSuppliers(sup.data);
    } catch {
      /* filtre fournisseur optionnel */
    }
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

  function categoryIcon(name: string): LucideIcon {
    const n = name.toLowerCase();
    if (/(aliment|épicerie|epicerie|denrée|riz|food)/.test(n)) return Apple;
    if (/(boisson|eau|jus|coca|drink)/.test(n)) return CupSoda;
    if (/(hygiène|hygiene|savon|beauté|beaute|propre)/.test(n)) return Sparkles;
    if (/(maison|ménage|menage|domestique)/.test(n)) return Home;
    if (/(électronique|electronique|informatique|télé|tele|tech|phone)/.test(n))
      return Monitor;
    if (/(vêtement|vetement|textile|habit|mode)/.test(n)) return Shirt;
    return ShoppingBag;
  }

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
    const applySupplier = (list: Product[]) =>
      supplierFilter === "all"
        ? list
        : list.filter((p) => p.supplier_id === supplierFilter);
    if (activeCategory === "all") {
      return applySupplier(available.slice(0, 80));
    }
    if (activeCategory === "top") {
      const ranked = bestSellerIds
        .map((id) => available.find((p) => p.id === id))
        .filter((p): p is Product => Boolean(p));
      return applySupplier(ranked.length > 0 ? ranked : available.slice(0, 40));
    }
    return applySupplier(
      available.filter((p) => p.category_id === activeCategory)
    );
  }, [products, query, activeCategory, bestSellerIds, supplierFilter]);

  const PAYMENT_STYLE: Record<string, { icon: LucideIcon; tint: string }> = {
    Espèces: { icon: Banknote, tint: "bg-emerald-600" },
    "Mobile Money": { icon: Smartphone, tint: "bg-orange-500" },
    "Carte bancaire": { icon: CreditCard, tint: "bg-blue-600" },
    Chèque: { icon: ReceiptText, tint: "bg-slate-500" },
    Virement: { icon: Send, tint: "bg-indigo-500" },
    "Crédit (à régler plus tard)": { icon: HandCoins, tint: "bg-rose-600" },
    Mixte: { icon: Layers, tint: "bg-purple-600" },
  };


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

  /**
   * Enter moves the cashier forward: each field hands the focus to the next
   * step of the ticket, so a full sale is typed and confirmed from the
   * keyboard only — the last Enter presses the « Valider la vente » button,
   * which runs the same guarded checkout as a click.
   */
  function nextOnEnter(target: { current: HTMLElement | null }) {
    return (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        target.current?.focus();
      }
    };
  }

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
    // localApi : le tiroir est branché à ce poste, pas au serveur du magasin.
    localApi.post("/settings/company/open-drawer").catch(() => {
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
    // A double Enter (or a scanner that sends two returns) must never open
    // two sales: while one encaissement is running, the next press is ignored.
    if (saving) return;
    if (cart.length === 0) {
      setError("Le panier est vide.");
      return;
    }
    if (payment === "Mixte" && !gift) {
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
      payment_method: gift ? "Cadeau" : payment,
      status: "Payée",
      price_mode: priceMode,
      note,
      discount,
      is_gift: gift,
      paid_amount: gift ? 0 : paidAmount,
      items: cart.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        unit_price: linePrice(l, priceMode),
        discount: l.discount ?? 0,
      })),
      payments:
        payment === "Mixte" && !gift
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
        payload.payments,
        gift
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
    setGift(false);
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
            tint: "bg-emerald-600",
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
      tint: "bg-cyan-600",
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
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-2">
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
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-1 py-0.5">
          <button
            className="rounded-lg px-2 py-0.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
            onClick={() => setScale(uiScale - 0.1)}
            title="Réduire la taille de l'interface"
          >
            −
          </button>
          <span className="w-10 text-center text-[11px] font-semibold text-slate-500">
            {Math.round(uiScale * 100)}%
          </span>
          <button
            className="rounded-lg px-2 py-0.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
            onClick={() => setScale(uiScale + 0.1)}
            title="Agrandir la taille de l'interface"
          >
            +
          </button>
        </div>
        <Link className="btn-ghost" to="/ventes">
          Historique des ventes
        </Link>
      </div>

      {/* Barre d'actions rapides */}
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-1.5">
        {quickActions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
            className={`flex min-w-[104px] shrink-0 flex-col items-center gap-1 rounded-xl px-2.5 py-2 text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${action.tint}`}
          >
            <action.icon size={18} />
            <span className="text-xs font-bold leading-none">{action.label}</span>
            <span className="text-[10px] font-medium leading-none opacity-80">
              {action.sub}
            </span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* Ticket in progress */}
        <div
          ref={cartRef}
          style={cartW ? { width: cartW } : undefined}
          className={`card min-h-0 w-full flex-col overflow-hidden p-0 md:order-3 md:flex md:w-[380px] md:shrink-0 lg:w-[420px] xl:w-[460px] 2xl:w-[500px] ${
            mobileView === "cart" ? "flex" : "hidden"
          }`}
        >
          <div className="shrink-0 bg-white">
          <div className="flex flex-wrap items-center gap-2 rounded-t-2xl border-b border-slate-200 bg-white px-3 py-1">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <ShoppingCart size={18} className="text-brand-600" />
              Panier ({itemCount} article{itemCount > 1 ? "s" : ""})
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
                onClick={() => searchRef.current?.focus()}
              >
                + Article
              </button>
              <button
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50 disabled:opacity-40"
                onClick={clearCart}
                disabled={cart.length === 0}
              >
                <Trash2 size={13} /> Vider
              </button>
              <button
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100"
                onClick={() => setCartCollapsed((v) => !v)}
                title={cartCollapsed ? "Développer le panier" : "Réduire le panier"}
                aria-label={cartCollapsed ? "Développer le panier" : "Réduire le panier"}
              >
                <ChevronDown
                  size={16}
                  className={`transition ${cartCollapsed ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 px-3 py-1">
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

          <div
            className={`min-h-0 flex-1 overflow-y-auto ${
              cartCollapsed ? "hidden" : ""
            }`}
          >
            {cart.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Scannez un code ou cliquez sur un article.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-white">
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="w-7 px-2 py-1">#</th>
                    <th className="px-1 py-1">Article</th>
                    <th className="w-[86px] px-1 py-1 text-right">
                      Prix unitaire
                    </th>
                    {canChangePrice && (
                      <th className="w-14 px-1 py-1 text-right">Rem.</th>
                    )}
                    <th className="w-[118px] px-1 py-1 text-center">
                      Quantité
                    </th>
                    <th className="w-[84px] px-1 py-1 text-right">Total</th>
                    <th className="w-8 px-1 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l, index) => (
                    <tr
                      key={l.product.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-2 py-1 text-xs text-slate-400">
                        {index + 1}
                      </td>
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-2">
                          {l.product.image ? (
                            <img
                              src={l.product.image}
                              alt=""
                              className="h-8 w-8 shrink-0 rounded-lg bg-slate-50 object-contain"
                            />
                          ) : (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
                              <ImageIcon size={15} />
                            </span>
                          )}
                          <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
                            {l.product.name}
                          </p>
                        </div>
                      </td>
                      <td className="px-1 py-1 text-right">
                        {canChangePrice ? (
                          <input
                            className="w-[76px] rounded-lg border border-slate-200 px-1.5 py-1 text-right text-sm text-slate-700"
                            value={l.price ?? unitPrice(l.product, priceMode)}
                            onChange={(e) =>
                              setLinePrice(l.product.id, e.target.value)
                            }
                            onKeyDown={nextOnEnter(paidRef)}
                            title="Prix de vente pour cette ligne"
                            aria-label={`Prix de ${l.product.name}`}
                          />
                        ) : (
                          <span className="text-slate-600">
                            {formatXOF(linePrice(l, priceMode))}
                          </span>
                        )}
                      </td>
                      {canChangePrice && (
                        <td className="px-1 py-1 text-right">
                          <input
                            className="w-14 rounded-lg border border-slate-200 px-1 py-1 text-right text-xs text-slate-700"
                            value={l.discount ?? ""}
                            placeholder="0"
                            onChange={(e) =>
                              setLineDiscount(l.product.id, e.target.value)
                            }
                            onKeyDown={nextOnEnter(paidRef)}
                            title="Remise pour cette ligne"
                            aria-label={`Remise de ${l.product.name}`}
                          />
                        </td>
                      )}
                      <td className="px-1 py-1">
                        <div className="flex items-center justify-center gap-0.5">
                          <button
                            className="rounded-lg bg-slate-100 p-1 text-slate-600 hover:bg-slate-200"
                            onClick={() =>
                              setQuantity(l.product.id, l.quantity - 1)
                            }
                            title="Diminuer la quantité"
                            aria-label={`Diminuer la quantité de ${l.product.name}`}
                          >
                            <Minus size={14} />
                          </button>
                          <input
                            className="w-11 rounded-lg border border-slate-200 py-1 text-center text-sm"
                            value={l.quantity}
                            onChange={(e) =>
                              setQuantity(
                                l.product.id,
                                Number(e.target.value) || 0
                              )
                            }
                            onKeyDown={nextOnEnter(paidRef)}
                            aria-label={`Quantité de ${l.product.name}`}
                          />
                          <button
                            className="rounded-lg bg-slate-100 p-1 text-slate-600 hover:bg-slate-200"
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
                      <td className="whitespace-nowrap px-1 py-1 text-right text-sm font-bold text-slate-900">
                        {formatXOF(lineNet(l, priceMode))}
                      </td>
                      <td className="px-1 py-1 text-center">
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

          {error && (
            <p className="bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <div
            className={`shrink-0 bg-white ${
              cartCollapsed ? "hidden" : ""
            }`}
          >
          <div className="max-h-[24vh] space-y-1.5 overflow-y-auto border-t border-slate-100 px-3 py-1.5">
            <div className="grid gap-2 grid-cols-1">
              <div className="flex items-center gap-2">
                <label className="mb-0 w-14 shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500">Client</label>
                {customer ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 py-1 text-sm">
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
                  <div className="relative min-w-0 flex-1">
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
                <button
                  className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                  onClick={() => setNewCustomer(true)}
                >
                  <UserPlus size={13} /> Nouveau
                </button>
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
                          onKeyDown={nextOnEnter(validateRef)}
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
            </div>
            <div className="flex gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-500">
                    Sous-total
                  </span>
                  <span className="text-sm font-extrabold text-slate-800">
                    {formatXOF(vat ? vat.excluded : subtotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-500">
                    Remise
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      ref={discountRef}
                      className="input w-20 px-2 py-1 text-right"
                      type="number"
                      min={0}
                      max={discountPercent ? 100 : undefined}
                      step={discountPercent ? 0.5 : 1}
                      onKeyDown={nextOnEnter(paidRef)}
                      value={
                        discountPercent
                          ? (subtotal > 0
                              ? Math.round((discount / subtotal) * 1000) / 10
                              : 0) || ""
                          : discount || ""
                      }
                      onChange={(e) => {
                        const v = Math.max(Number(e.target.value) || 0, 0);
                        setDiscount(
                          discountPercent
                            ? (Math.min(v, 100) * subtotal) / 100
                            : v
                        );
                      }}
                      placeholder="0"
                    />
                    <button
                      type="button"
                      className="rounded-md bg-slate-100 px-1.5 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-200"
                      title="Basculer remise en % ou en FCFA"
                      onClick={() => setDiscountPercent((v) => !v)}
                    >
                      {discountPercent ? "%" : "F"}
                    </button>
                  </span>
                </div>
                {vat && (
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>TVA ({vat.rate} %)</span>
                    <span>{formatXOF(vat.vat)}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label">Montant reçu</label>
                <input
                  ref={paidRef}
                  className="input"
                  type="number"
                  min={0}
                  disabled={gift}
                  value={gift ? "" : paidAmount || ""}
                  onChange={(e) =>
                    setPaidAmount(Math.max(Number(e.target.value) || 0, 0))
                  }
                  onKeyDown={nextOnEnter(validateRef)}
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
                  onKeyDown={nextOnEnter(validateRef)}
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

          <div className="relative flex items-stretch gap-2 p-1.5">
            <div className="w-[46%] shrink-0 rounded-xl bg-[#1d4ed8] px-2.5 py-1 text-white">
              {vat && (
                <div className="flex items-center justify-between text-[11px] text-slate-300">
                  <span>Total HT</span>
                  <span>{formatXOF(vat.excluded)}</span>
                </div>
              )}
              {vat && (
                <div className="flex items-center justify-between text-[11px] text-slate-300">
                  <span>TVA ({vat.rate} %)</span>
                  <span>{formatXOF(vat.vat)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex items-center justify-between text-[11px] text-slate-300">
                  <span>Remise</span>
                  <span>- {formatXOF(discount)}</span>
                </div>
              )}
              {change > 0 && (
                <div className="flex items-center justify-between text-[11px] text-emerald-300">
                  <span>Monnaie à rendre</span>
                  <span>{formatXOF(change)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase">
                  {vat ? "Total TTC" : "Total"}
                </span>
                <span className="text-base font-extrabold">
                  {formatXOF(total)}
                </span>
              </div>
            </div>
            <button
              ref={validateRef}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={checkout}
              disabled={saving || cart.length === 0}
              title="Valider la vente (Entrée)"
            >
              <ReceiptText size={18} />
              {saving
                ? "Encaissement..."
                : `Valider la vente · ${formatXOF(total)}`}
            </button>
            <button
              className="flex w-11 items-center justify-center rounded-xl bg-emerald-700 text-white transition hover:bg-emerald-800 disabled:opacity-50"
              onClick={() => setValidMenu((v) => !v)}
              title="Actions du ticket"
              aria-label="Actions du ticket"
            >
              <ChevronDown
                size={18}
                className={`transition ${validMenu ? "rotate-180" : ""}`}
              />
            </button>
            {validMenu && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setValidMenu(false)}
                />
                <div className="absolute bottom-full right-2 z-30 mb-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => {
                      setValidMenu(false);
                      parkCart();
                    }}
                    disabled={cart.length === 0}
                  >
                    <Pause size={15} /> Mettre en attente
                  </button>
                  {canQuote && (
                    <>
                      <button
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        onClick={() => {
                          setValidMenu(false);
                          void saveQuote("devis");
                        }}
                        disabled={saving || cart.length === 0}
                      >
                        <FilePenLine size={15} /> Enregistrer un devis
                      </button>
                      <button
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        onClick={() => {
                          setValidMenu(false);
                          void saveQuote("proforma");
                        }}
                        disabled={saving || cart.length === 0}
                      >
                        <FileCheck2 size={15} /> Enregistrer une pro forma
                      </button>
                    </>
                  )}
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                    onClick={() => {
                      setValidMenu(false);
                      clearCart();
                    }}
                    disabled={cart.length === 0}
                  >
                    <Trash2 size={15} /> Vider le panier
                  </button>
                </div>
              </>
            )}
          </div>
          </div>
        </div>

        {/* Poignée de redimensionnement catalogue / panier */}
        <div
          role="separator"
          aria-orientation="vertical"
          title="Glisser pour redimensionner le panier"
          className="hidden w-1.5 shrink-0 cursor-col-resize rounded-full bg-slate-200 transition hover:bg-brand-400 md:order-2 md:block"
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW =
              cartRef.current?.getBoundingClientRect().width ?? 420;
            const maxW = Math.min(760, Math.round(window.innerWidth * 0.6));
            const onMove = (ev: PointerEvent) => {
              const w = Math.round(startW + (startX - ev.clientX));
              setCartW(Math.max(300, Math.min(maxW, w)));
            };
            const onUp = () => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
              setCartW((w) => {
                if (w) localStorage.setItem("ri_cart_w", String(w));
                return w;
              });
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          }}
        />

        {/* Article picker */}
        <div
          className={`card min-h-0 min-w-0 flex-1 flex-col p-4 md:order-1 md:flex ${
            mobileView === "catalog" ? "flex" : "hidden"
          }`}
        >
          {!query && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1 sm:hidden">
              {[
                {
                  id: "all" as number | "top" | "all",
                  label: "Tous",
                  icon: LayoutGrid,
                },
                {
                  id: "top" as number | "top" | "all",
                  label: "Meilleures ventes",
                  icon: Flame,
                },
                ...categories.map((c) => ({
                  id: c.id as number | "top" | "all",
                  label: c.name,
                  icon: categoryIcon(c.name),
                })),
              ].map((chip) => {
                const Icon = chip.icon;
                const active = activeCategory === chip.id;
                return (
                  <button
                    key={chip.id}
                    onClick={() => setActiveCategory(chip.id)}
                    className={`flex min-w-[74px] shrink-0 flex-col items-center gap-1 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
                      active
                        ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-slate-900"
                    }`}
                  >
                    <Icon size={17} />
                    <span className="max-w-[88px] truncate">{chip.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex min-h-0 flex-1 gap-3">
            {/* Colonne des catégories — défilement indépendant */}
            {!query && (
              <div className="hidden w-[124px] shrink-0 flex-col gap-1 overflow-y-auto sm:flex">
                {[
                  {
                    id: "all" as number | "top" | "all",
                    label: "Tous",
                    icon: LayoutGrid,
                  },
                  {
                    id: "top" as number | "top" | "all",
                    label: "Meilleures ventes",
                    icon: Flame,
                  },
                  ...categories.map((c) => ({
                    id: c.id as number | "top" | "all",
                    label: c.name,
                    icon: categoryIcon(c.name),
                  })),
                ].map((chip) => {
                  const Icon = chip.icon;
                  const active = activeCategory === chip.id;
                  return (
                    <button
                      key={chip.id}
                      onClick={() => setActiveCategory(chip.id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition ${
                        active
                          ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-slate-900"
                      }`}
                    >
                      <Icon size={15} className="shrink-0" />
                      <span className="truncate">{chip.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
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
            </div>
            {suppliers.length > 0 && (
              <select
                className="hidden w-32 shrink-0 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-xs font-semibold text-slate-600 sm:block"
                value={supplierFilter}
                onChange={(e) =>
                  setSupplierFilter(
                    e.target.value === "all" ? "all" : Number(e.target.value)
                  )
                }
                aria-label="Filtrer par fournisseur"
              >
                <option value="all">Tous les fournisseurs</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="shrink-0 rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:border-blue-300"
              onClick={() =>
                setViewMode((v) => (v === "grid" ? "list" : "grid"))
              }
              title={viewMode === "grid" ? "Affichage liste" : "Affichage grille"}
              aria-label={viewMode === "grid" ? "Affichage liste" : "Affichage grille"}
            >
              {viewMode === "grid" ? <List size={16} /> : <LayoutGrid size={16} />}
            </button>
            <button
              className="shrink-0 rounded-xl border border-brand-200 bg-white p-2.5 text-brand-600 transition hover:bg-brand-50"
              onClick={submitSearch}
              title="Scanner un code-barres ou ajouter l'article trouvé"
              aria-label="Scanner un code-barres ou ajouter l'article trouvé"
            >
              <Barcode size={16} />
            </button>
          </div>
          {viewMode === "list" ? (
            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-brand-50"
                >
                  {p.image ? (
                    <img
                      src={p.image}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-lg bg-slate-50 object-contain"
                    />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
                      <ImageIcon size={15} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">
                      {p.name}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {categoryName(p.category_id)} · Stock : {p.quantity}
                    </span>
                  </span>
                  <span className="text-sm font-extrabold text-brand-700">
                    {formatXOF(unitPrice(p, priceMode))}
                  </span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
                    <Plus size={15} />
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="py-10 text-center text-sm text-slate-400">
                  Aucun article disponible.
                </p>
              )}
            </div>
          ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
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
                    className="mb-2 h-[88px] w-full rounded-xl object-contain"
                  />
                ) : (
                  <span className="mb-2 flex h-[88px] w-full items-center justify-center rounded-xl bg-slate-100 text-slate-300">
                    <ImageIcon size={22} />
                  </span>
                )}
                <p className="line-clamp-2 min-h-[2.5rem] text-sm font-bold text-slate-800">
                  {p.name}
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  Réf : {p.sku || categoryName(p.category_id)}
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
          )}
            {/* Modes de paiement — sous la liste des articles */}
            <div className="border-t border-slate-100 pt-2">
              <label className="label">Mode de paiement</label>
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
                {PAYMENTS.map((p) => {
                  const meta = PAYMENT_STYLE[p];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        setPayment(p);
                        setGift(false);
                      }}
                      className={`flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-bold leading-tight text-white shadow-sm transition hover:opacity-90 ${
                        meta.tint
                      } ${
                        !gift && payment === p
                          ? "ring-2 ring-slate-900 ring-offset-1"
                          : "opacity-85"
                      }`}
                    >
                      <Icon size={13} />
                      <span className="text-center">
                        {p === "Crédit (à régler plus tard)" ? "Crédit" : p}
                      </span>
                    </button>
                  );
                })}
                {canGift && (
                  <button
                    onClick={() => setGift((g) => !g)}
                    title="Vente cadeau : articles offerts, hors chiffre d'affaires"
                    className={`flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-bold leading-tight text-white shadow-sm transition hover:opacity-90 bg-amber-500 ${
                      gift ? "ring-2 ring-slate-900 ring-offset-1" : "opacity-85"
                    }`}
                  >
                    <Gift size={13} />
                    <span className="text-center">CADEAU</span>
                  </button>
                )}
              </div>
            </div>
            </div>
          </div>
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
        title={lastSale ? `${lastSale.pending_sync ? "Vente en attente de synchronisation" : "Vente enregistrée"} — ${lastSale.reference}` : ""}
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
                Ticket en attente, conservé localement : il partira au serveur dès le
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
