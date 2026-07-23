export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
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
  quantity: number;
  min_stock: number;
  created_at: string;
  category?: Category | null;
  supplier?: Supplier | null;
}

export interface SaleItem {
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
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
  created_by?: User | null;
  items: SaleItem[];
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
  low_stock_products: Product[];
}
