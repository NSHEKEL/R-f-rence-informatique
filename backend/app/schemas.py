from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


# ---------- Auth ----------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    role: str
    is_active: bool = True


class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: str = "vendeur"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


# ---------- Category ----------
class CategoryBase(BaseModel):
    name: str
    description: str = ""


class CategoryCreate(CategoryBase):
    pass


class CategoryOut(CategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Supplier ----------
class SupplierBase(BaseModel):
    name: str
    contact: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""


class SupplierCreate(SupplierBase):
    pass


class SupplierOut(SupplierBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Customer ----------
class CustomerBase(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    address: str = ""


class CustomerCreate(CustomerBase):
    pass


class CustomerOut(CustomerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Product ----------
class ProductBase(BaseModel):
    name: str
    sku: str
    description: str = ""
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    purchase_price: float = 0
    sale_price: float = 0
    quantity: int = 0
    min_stock: int = 5


class ProductCreate(ProductBase):
    pass


class ProductUpdate(ProductBase):
    pass


class ProductOut(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    category: Optional[CategoryOut] = None
    supplier: Optional[SupplierOut] = None


# ---------- Sales ----------
class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    payment_method: str = "Espèces"
    status: str = "Payée"
    items: List[SaleItemCreate]


class SaleItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int]
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class SaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    customer_id: Optional[int]
    customer: Optional[CustomerOut] = None
    date: datetime
    total: float
    status: str
    payment_method: str
    created_by: Optional[UserOut] = None
    items: List[SaleItemOut] = []


# ---------- Dashboard ----------
class MonthlyRevenue(BaseModel):
    month: str
    revenue: float


class TopProduct(BaseModel):
    name: str
    quantity: int
    revenue: float


class DashboardStats(BaseModel):
    total_products: int
    total_stock_value: float
    low_stock_count: int
    total_customers: int
    total_sales: int
    total_revenue: float
    revenue_change: float
    sales_change: float
    monthly_revenue: List[MonthlyRevenue]
    recent_sales: List[SaleOut]
    top_products: List[TopProduct]
    low_stock_products: List[ProductOut]
