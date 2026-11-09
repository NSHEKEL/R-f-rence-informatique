export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  photo?: string;
  is_active: boolean;
  notification_kinds?: string;
}

export type ReceiptFormat = "A4" | "80mm" | "58mm" | "custom";

/** A printer installed on this computer, as Windows reports it. */
export interface PrinterDevice {
  name: string;
  port: string;
  driver: string;
  kind: string;
  jobs: number;
  is_default: boolean;
  available: boolean;
  status: string;
  supports_color?: boolean;
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
  /** QR code at the foot of the ticket (opt-in per poste). */
  show_qr: boolean;
  paper_width_mm: number;
  bold: boolean;
  show_company_info: boolean;
  text_color: string;
  footer_text: string;
  item_layout: "table" | "stacked";
  show_line_total: boolean;
}

/** Price labels: a separate printer with its own settings. */
export interface LabelPrinterConfig {
  font_family: string;
  code_type: "barcode" | "qr";
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
  font_family: string;
  font_size: number;
  text_color: string;
  accent_color: string;
  logo_size_mm: number;
  header_text: string;
  footer_text: string;
  info_position: "left" | "center" | "right";
  show_company: boolean;
  show_customer: boolean;
  show_reference: boolean;
  show_date: boolean;
  show_qty: boolean;
  show_unit_price: boolean;
  show_total: boolean;
  format: "A4" | "A5";
  /** Printer assigned to commercial documents on this workstation. */
  printer_name: string;
  /** Optional dedicated queues; empty falls back on printer_name. */
  delivery_printer_name: string;
  quote_printer_name: string;
  reports_printer_name: string;
  settlement_printer_name: string;
  /** True: print straight to the queue; False: preview first. */
  direct_print: boolean;
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
    paper_width_mm: 80, bold: false, show_company_info: true, text_color: "#000000", footer_text: "", item_layout: "table", show_line_total: true,
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
    show_qr: false,
  },
  label: {
    font_family: "Arial", code_type: "barcode",
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
    font_family: "Arial", font_size: 12, text_color: "#0f172a", accent_color: "#0f172a", logo_size_mm: 22,
    header_text: "", footer_text: "", info_position: "left", show_company: true, show_customer: true,
    show_reference: true, show_date: true, show_qty: true, show_unit_price: true, show_total: true,
    format: "A4",
    printer_name: "",
    delivery_printer_name: "",
    quote_printer_name: "",
    reports_printer_name: "",
    settlement_printer_name: "",
    direct_print: true,
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
  /** Secondary phone number shown under the main one. */
  phone2: string;
  email: string;
  website: string;
  tax_id: string;
  /** Country printed with the city in the letterhead. */
  country: string;
  /** Trade register number. */
  rccm: string;
  /** Tax identification number. */
  ncc: string;
  capital_social: string;
  regime_fiscal: string;
  /** Per-document-type layout overrides, stored as JSON. */
  document_layouts: string;
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
  backup_auto_enabled: boolean;
  backup_frequency: "daily" | "weekly" | "monthly";
  backup_time: string;
  backup_weekday: number;
  backup_monthday: number;
  last_backup_status: string;
  last_backup_error: string;
  drive_enabled: boolean;
  drive_folder_name: string;
  drive_folder_id: string;
  drive_keep: number;
  drive_last_upload_at: string | null;
  drive_last_status: string;
  drive_last_error: string;
  drive_last_file_id: string;
  drive_account_email: string;
  network_restrict_workstations: boolean;
  /** Magasin's city (multi-magasins supervision). */
  city: string;
  /** Contact shown on "Assistance et support". */
  support_whatsapp: string;
  support_email: string;
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

export interface OrderItem extends UnitSpec {
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

export interface DeliveryItem extends UnitSpec {
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
  /** Ceiling on the customer's unpaid receivables; 0 = no limit. */
  credit_limit: number;
}

export interface UnitSpec {
  semi_wholesale_price?: number | null;
  semi_wholesale_min_qty?: number | null;
  wholesale_min_qty?: number | null;
  semi_packaging_price?: number | null;
  additional_packaging?: boolean;
  wholesale_packaging_price?: number | null;
  base_unit?: string | null;
  packaging_unit?: string | null;
  units_per_packaging?: number | null;
  packaging_sale_price?: number | null;
  quantity_label?: string | null;
}

export interface ProductPackaging {
  id?: number;
  name: string;
  factor: number;
  barcode?: string | null;
  price_detail?: number | null;
  price_semi_gros?: number | null;
  price_gros?: number | null;
  purchase_price?: number | null;
  active: boolean;
  sort_order: number;
}

export interface Product extends UnitSpec {
  rayon?: string | null;
  emplacement?: string | null;
  packagings?: ProductPackaging[];
  supplier_purchase_price?: number | null;
  packaging_id?: number | null;
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

export interface SaleItem extends UnitSpec {
  packaging_id?: number | null;
  price_tier?: "detail" | "semi_gros" | "gros" | null;
  catalog_unit_price?: number | null;
  unit_cost?: number | null;
  cost?: number | null;
  revenue?: number | null;
  profit?: number | null;
  margin?: number | null;
  sold_unit?: string | null;
  packaging_quantity?: number | null;
  piece_quantity?: number | null;
  base_quantity?: number | null;
  base_unit_price?: number | null;
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  /** Discount granted on this line only, already deducted from subtotal. */
  discount: number;
  subtotal: number;
  returned_quantity: number;
}

export interface SalePayment {
  id: number;
  method: string;
  amount: number;
}

export interface Sale {
  discount_by_id?: number | null;
  cost?: number | null;
  profit?: number | null;
  margin?: number | null;
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
  /** Gift sale: items left the stock, revenue excluded, ticket marked OFFERT. */
  is_gift?: boolean;
  /** Tender legs for a « Mixte » payment; empty for single-method sales. */
  payments?: SalePayment[];
  /** Set on tickets queued offline and not yet pushed to the server. */
  pending_sync?: boolean;
}

export interface ReturnItem extends UnitSpec {
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

export interface ProformaItem extends UnitSpec {
  id: number;
  product_id: number | null;
  product_name: string;
  reference: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount: number;
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
  discount: number;
  /** "devis" (commercial offer) or "proforma" (forecast invoice). */
  kind: string;
  status: string;
  converted_from_id: number | null;
  order_id: number | null;
  note: string;
  created_by?: User | null;
  items: ProformaItem[];
}

export interface ReportRow {
  quantity_label?: string | null;
  label: string;
  quantity: number;
  amount: number;
}

export interface ProfitRow {
  label: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

export interface SalesReport {
  profit_by_product?: ProfitRow[];
  profit_by_sale?: ProfitRow[];
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
  /** Tills closed in the window with a non-zero cash gap. */
  cash_gap_count: number;
  /** Absolute sum of those gaps. */
  cash_gap_total: number;
  period_start: string | null;
  period_end: string | null;
}

export interface StockLot {
  id: number;
  product_id: number;
  lot_number: string;
  expiry_date: string | null;
  quantity: number;
  created_at: string;
  product_name: string;
  days_left: number | null;
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
  opening_balance: number | null;
  closed_at: string | null;
  closed_by?: User | null;
  closing_balance: number | null;
  expected_balance: number | null;
  difference: number | null;
  note: string;
}

export interface CashSessionSaleLine {
  id: number;
  reference: string;
  total: number;
  paid_amount: number;
  payment_method: string;
  status: string;
  date?: string | null;
}

export interface CashSessionDetail extends CashSession {
  entries_total: number | null;
  exits_total: number | null;
  cash_refunds: number | null;
  cash_settlements: number | null;
  cash_sales: number | null;
  other_sales: number | null;
  sales_count: number | null;
  expected_cash: number | null;
  sales?: CashSessionSaleLine[];
}

export interface CashMovement {
  id: number;
  session_id: number;
  type: "in" | "out";
  amount: number | null;
  reason: string;
  user_id: number;
  created_at: string;
  workstation: string;
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

export interface StockMovement extends UnitSpec {
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

export interface PurchaseItem extends UnitSpec {
  packaging_id?: number | null;
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

export interface FneSettings {
  enabled: boolean;
  environment: string;
  api_url: string;
  token_url: string;
  client_id: string;
  credentials_configured: boolean;
  configured: boolean;
}

export interface FneInvoice {
  id: number;
  sale_id: number;
  status: string;
  fne_reference: string;
  fne_number: string;
  fne_token: string;
  last_error: string;
  attempts: number;
  submitted_at: string | null;
  certified_at: string | null;
}
