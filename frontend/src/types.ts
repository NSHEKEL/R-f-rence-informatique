export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  photo?: string;
  is_active: boolean;
}

export type ReceiptFormat = "A4" | "80mm" | "58mm";

/** A printer installed on this computer, as Windows reports it. */
export interface PrinterDevice {
  name: string;
  port: string;
  is_default: boolean;
  available: boolean;
  status: string;
}

/** Receipt printer: hardware, layout and contents of the ticket. */
export interface ReceiptPrinterConfig {
  printer_name: string;
  width: ReceiptFormat;
  copies: number;
  auto_print: boolean;
  cut_paper: boolean;
  open_drawer: boolean;
  font_family: string;
  font_size: number;
  line_height: number;
  align: "left" | "center";
  margin_mm: number;
  logo_size_mm: number;
  logo_align: "left" | "center";
  show_logo: boolean;
  show_company: boolean;
  show_address: boolean;
  show_phone: boolean;
  show_email: boolean;
  show_website: boolean;
  show_tax_id: boolean;
  show_header: boolean;
  show_footer: boolean;
  show_number: boolean;
  show_datetime: boolean;
  show_seller: boolean;
  show_customer: boolean;
  show_qty: boolean;
  show_unit_price: boolean;
  show_discount: boolean;
  show_vat: boolean;
  show_total_ht: boolean;
  show_total_ttc: boolean;
  show_paid: boolean;
  show_change: boolean;
  show_payment: boolean;
  show_barcode: boolean;
}

/** Price labels: a separate printer with its own settings. */
export interface LabelPrinterConfig {
  printer_name: string;
  width_mm: number;
  height_mm: number;
  columns: number;
  font_size: number;
  show_logo: boolean;
  show_shop: boolean;
  show_name: boolean;
  show_price: boolean;
  show_wholesale: boolean;
  show_code: boolean;
  show_barcode: boolean;
}

/** A4/A5 commercial documents: purchase orders and delivery notes. */
export interface DocumentConfig {
  format: "A4" | "A5";
  order_prefix: string;
  delivery_prefix: string;
  show_logo: boolean;
  show_address: boolean;
  show_phone: boolean;
  show_whatsapp: boolean;
  show_email: boolean;
  show_website: boolean;
  show_vat: boolean;
  show_discount: boolean;
  show_prices_on_delivery: boolean;
  show_customer_signature: boolean;
  show_company_signature: boolean;
}

export interface PrintingConfig {
  receipt: ReceiptPrinterConfig;
  label: LabelPrinterConfig;
  documents: DocumentConfig;
}

export const DEFAULT_PRINTING: PrintingConfig = {
  receipt: {
    printer_name: "",
    width: "80mm",
    copies: 1,
    auto_print: true,
    cut_paper: true,
    open_drawer: true,
    font_family: "Arial",
    font_size: 11,
    line_height: 1.35,
    align: "left",
    margin_mm: 3,
    logo_size_mm: 18,
    logo_align: "center",
    show_logo: true,
    show_company: true,
    show_address: true,
    show_phone: true,
    show_email: true,
    show_website: true,
    show_tax_id: true,
    show_header: true,
    show_footer: true,
    show_number: true,
    show_datetime: true,
    show_seller: true,
    show_customer: true,
    show_qty: true,
    show_unit_price: true,
    show_discount: true,
    show_vat: true,
    show_total_ht: true,
    show_total_ttc: true,
    show_paid: true,
    show_change: true,
    show_payment: true,
    show_barcode: true,
  },
  label: {
    printer_name: "",
    width_mm: 60,
    height_mm: 40,
    columns: 3,
    font_size: 12,
    show_logo: true,
    show_shop: true,
    show_name: true,
    show_price: true,
    show_wholesale: false,
    show_code: true,
    show_barcode: true,
  },
  documents: {
    format: "A4",
    order_prefix: "BC",
    delivery_prefix: "BL",
    show_logo: true,
    show_address: true,
    show_phone: true,
    show_whatsapp: true,
    show_email: true,
    show_website: true,
    show_vat: true,
    show_discount: true,
    show_prices_on_delivery: false,
    show_customer_signature: true,
    show_company_signature: true,
  },
};

export interface CompanySettings {
  id: number;
  name: string;
  slogan: string;
  logo: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  tax_id: string;
  currency: string;
  /** VAT rate shown on receipts, in percent (0 = none). */
  vat_rate: number;
  about: string;
  receipt_header: string;
  receipt_footer: string;
  receipt_format: ReceiptFormat;
  printer_name: string;
  auto_print_cash: boolean;
  /** Electronic cash drawer plugged into the receipt printer. */
  drawer_enabled: boolean;
  drawer_port: string;
  drawer_code: string;
  drawer_open_after_sale: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from: string;
  smtp_tls: boolean;
  smtp_configured: boolean;
  backup_dir: string;
  backup_auto: boolean;
  backup_keep: number;
  backup_on_sale: boolean;
  last_backup_at: string | null;
}

export interface BackupFile {
  name: string;
  size: number;
  created_at: string;
}

/** Workstation or phone using the shared server. */
export interface Workstation {
  address: string;
  user: string | null;
  last_seen: string;
  active: boolean;
}

export interface ActionLog {
  id: number;
  label: string;
  at: string;
  user?: User | null;
}

export interface HistoryState {
  undo: ActionLog | null;
  redo: ActionLog | null;
}

export interface OrderItem {
  id: number;
  product_id: number | null;
  product_name: string;
  reference: string;
  unit: string;
  quantity: number;
  delivered_quantity: number;
  remaining_quantity: number;
  unit_price: number;
  discount: number;
  subtotal: number;
}

export interface DeliveryItem {
  id: number;
  product_id: number | null;
  product_name: string;
  reference: string;
  unit: string;
  ordered_quantity: number;
  previously_delivered: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
  observation: string;
}

export interface Delivery {
  id: number;
  reference: string;
  order_id: number | null;
  order_reference: string;
  customer_id: number | null;
  customer_name: string;
  status: string;
  validated_at: string | null;
  sale_id: number | null;
  date: string;
  address: string;
  carrier: string;
  recipient: string;
  note: string;
  items: DeliveryItem[];
  created_by?: User | null;
}

export interface Order {
  id: number;
  reference: string;
  customer_id: number | null;
  customer_name: string;
  date: string;
  expected_date: string | null;
  status: string;
  total: number;
  discount: number;
  deposit: number;
  /** Money really received: deposit plus the settlements booked. */
  paid: number;
  balance: number;
  delivery_status: string;
  payment_status: string;
  price_mode: string;
  delivery_address: string;
  payment_terms: string;
  delivery_terms: string;
  note: string;
  items: OrderItem[];
  deliveries: Delivery[];
  created_by?: User | null;
}

export interface UpdateStatus {
  current_version: string;
  latest_version: string;
  available: boolean;
  packaged: boolean;
  notes: string;
  published_at: string;
  error: string;
}

export interface Category {
  id: number;
  name: string;
  description: string;
}

export interface Supplier {
  id: number;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  logo?: string;
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  description: string;
  category_id: number | null;
  supplier_id: number | null;
  purchase_price: number;
  sale_price: number;
  wholesale_price: number;
  quantity: number;
  min_stock: number;
  qr_code: string;
  barcode: string;
  image: string;
  created_at: string;
  category?: Category | null;
  supplier?: Supplier | null;
  /** Filled by the "jamais vendu / plus vendus" filters. */
  sold_quantity: number;
  last_sold_at: string | null;
}

export interface SaleItem {
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  returned_quantity: number;
}

export interface Sale {
  id: number;
  reference: string;
  customer_id: number | null;
  customer?: Customer | null;
  date: string;
  total: number;
  status: string;
  payment_method: string;
  note: string;
  receipt_footer: string;
  price_mode: string;
  created_by?: User | null;
  items: SaleItem[];
  print_count: number;
  returned_total: number;
  /** Cash handed over, used to print the change given back. */
  paid_amount: number;
  /** Discount granted on the whole ticket, already deducted. */
  discount: number;
  /** Set on tickets queued offline and not yet pushed to the server. */
  pending_sync?: boolean;
}

export interface ReturnItem {
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface SaleReturn {
  id: number;
  reference: string;
  sale_id: number;
  sale_reference: string;
  date: string;
  total: number;
  reason: string;
  created_by?: User | null;
  items: ReturnItem[];
}

export interface ProformaItem {
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface Proforma {
  id: number;
  reference: string;
  customer_id: number | null;
  customer?: Customer | null;
  customer_name: string;
  date: string;
  valid_until: string | null;
  total: number;
  note: string;
  created_by?: User | null;
  items: ProformaItem[];
}

export interface ReportRow {
  label: string;
  quantity: number;
  amount: number;
}

export interface SalesReport {
  period_start: string;
  period_end: string;
  sales_count: number;
  revenue: number;
  returns_total: number;
  net_revenue: number;
  average_ticket: number;
  by_day: ReportRow[];
  by_payment: ReportRow[];
  by_seller: ReportRow[];
  by_category: ReportRow[];
  by_product: ReportRow[];
}

export interface MonthlyRevenue {
  month: string;
  revenue: number;
}

export interface TopProduct {
  name: string;
  quantity: number;
  revenue: number;
}

export interface TopSeller {
  name: string;
  sales_count: number;
  revenue: number;
}

export interface DashboardStats {
  total_products: number;
  total_stock_value: number;
  low_stock_count: number;
  total_customers: number;
  total_sales: number;
  total_revenue: number;
  revenue_change: number;
  sales_change: number;
  monthly_revenue: MonthlyRevenue[];
  recent_sales: Sale[];
  top_products: TopProduct[];
  top_sellers: TopSeller[];
  low_stock_products: Product[];
  period_start: string | null;
  period_end: string | null;
}

export interface Notification {
  id: number;
  kind: string;
  title: string;
  message: string;
  link: string;
  sale_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface CashSession {
  id: number;
  opened_at: string;
  business_day: string;
  opened_by?: User | null;
  opening_balance: number;
  closed_at: string | null;
  closed_by?: User | null;
  closing_balance: number | null;
  expected_balance: number | null;
  difference: number | null;
  note: string;
}

export interface CashSessionDetail extends CashSession {
  cash_sales: number;
  other_sales: number;
  sales_count: number;
  expected_cash: number;
}

export interface Expense {
  id: number;
  label: string;
  category: string;
  amount: number;
  date: string;
  note: string;
  created_by?: User | null;
}

export interface StockMovement {
  id: number;
  product_id: number | null;
  product_name: string;
  kind: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  reason: string;
  date: string;
  created_by?: User | null;
}

export interface AccountingCategory {
  name: string;
  amount: number;
}

export interface AccountingSummary {
  period_start: string;
  period_end: string;
  revenue: number;
  cost_of_goods: number;
  gross_margin: number;
  expenses_total: number;
  net_profit: number;
  sales_count: number;
  returns_total: number;
  revenue_by_payment: AccountingCategory[];
  expenses_by_category: AccountingCategory[];
  daily_revenue: AccountingCategory[];
}

export interface PurchaseItem {
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  subtotal: number;
}

export interface Purchase {
  id: number;
  reference: string;
  supplier_id: number | null;
  supplier_name: string;
  date: string;
  expected_date: string | null;
  received_at: string | null;
  status: string;
  total: number;
  paid: number;
  balance: number;
  invoice_number: string;
  note: string;
  items: PurchaseItem[];
  created_by?: User | null;
}

export interface PurchaseSummary {
  count: number;
  pending: number;
  total: number;
  unpaid: number;
}
