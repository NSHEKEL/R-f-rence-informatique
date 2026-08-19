export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export type ReceiptFormat = "A4" | "80mm";

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
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface Delivery {
  id: number;
  reference: string;
  order_id: number;
  order_reference: string;
  sale_id: number | null;
  date: string;
  address: string;
  carrier: string;
  recipient: string;
  note: string;
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
  deposit: number;
  balance: number;
  price_mode: string;
  delivery_address: string;
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
