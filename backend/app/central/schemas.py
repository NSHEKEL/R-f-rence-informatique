"""Payloads of the central API."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AdminLogin(BaseModel):
    email: str
    password: str


class AdminSetup(BaseModel):
    name: str = ""
    email: str
    password: str


class SetupState(BaseModel):
    needed: bool


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    last_login: Optional[datetime] = None


class FeatureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    description: str = ""
    section: str = ""


class PlanRight(BaseModel):
    code: str
    name: str
    section: str = ""
    allowed: bool


class PlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    description: str = ""
    price: float = 0
    currency: str = "FCFA"
    duration_days: int = 365
    grace_days: int = 7
    is_active: bool = True
    is_public: bool = True
    clients_count: int = 0
    rights: list[PlanRight] = []


class PlanCreate(BaseModel):
    code: str
    name: str
    description: str = ""
    price: float = 0
    currency: str = "FCFA"
    duration_days: int = 365
    grace_days: int = 7
    is_public: bool = True


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    duration_days: Optional[int] = None
    grace_days: Optional[int] = None
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None
    position: Optional[int] = None


class PlanRightUpdate(BaseModel):
    """One ON/OFF switch of the "Formules & Droits" screen."""

    feature_code: str
    allowed: bool


class PublicPlan(BaseModel):
    """What a fresh installation shows on "Choisissez votre formule"."""

    code: str
    name: str
    description: str = ""
    price: float = 0
    currency: str = "FCFA"
    duration_days: int = 365
    features: list[str] = []


class InstallationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    uid: str
    hostname: str = ""
    version: str = ""
    users_count: int = 0
    last_seen: Optional[datetime] = None
    last_sync: Optional[datetime] = None
    last_ip: str = ""
    is_revoked: bool = False
    online: bool = False


class LicenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    key: str
    plan_code: str
    plan_name: str
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    grace_days: int = 7
    status: str
    status_label: str = ""
    suspended_reason: str = ""
    days_left: Optional[int] = None


class ClientRow(BaseModel):
    """One line of "Mes clients"."""

    id: int
    company: str
    manager: str = ""
    phone: str = ""
    email: str = ""
    city: str = ""
    installation_uid: str = ""
    plan_code: str = ""
    plan_name: str = ""
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    status: str = ""
    status_label: str = ""
    last_seen: Optional[datetime] = None
    last_sync: Optional[datetime] = None
    version: str = ""
    users_count: int = 0
    online: bool = False


class ClientPage(BaseModel):
    total: int
    page: int
    pages: int
    rows: list[ClientRow]


class ClientDetail(BaseModel):
    id: int
    company: str
    manager: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    note: str = ""
    created_at: Optional[datetime] = None
    license: Optional[LicenseOut] = None
    installations: list[InstallationOut] = []
    features: list[str] = []


class ClientCreate(BaseModel):
    company: str
    manager: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    note: str = ""
    plan_code: str
    duration_days: Optional[int] = None


class ClientUpdate(BaseModel):
    company: Optional[str] = None
    manager: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    note: Optional[str] = None


class PlanChange(BaseModel):
    plan_code: str


class LicenseAction(BaseModel):
    """ACTIVER / SUSPENDRE / RÉACTIVER / EXPIRER."""

    action: str
    reason: str = ""


class LicenseRenew(BaseModel):
    ends_at: Optional[datetime] = None
    duration_days: Optional[int] = None
    grace_days: Optional[int] = None


class LogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    admin_name: str = ""
    client_name: str = ""
    action: str
    old_value: str = ""
    new_value: str = ""
    created_at: datetime


class DashboardStats(BaseModel):
    clients: int = 0
    per_plan: dict[str, int] = {}
    active: int = 0
    expired: int = 0
    suspended: int = 0
    revoked: int = 0
    expiring_soon: int = 0
    online: int = 0
    offline: int = 0
    signups: list[dict] = []


class RegisterRequest(BaseModel):
    """First configuration of a new installation."""

    company: str
    manager: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    plan_code: str
    installation_uid: str
    hostname: str = ""
    version: str = ""
    users_count: int = 1


class SyncRequest(BaseModel):
    installation_uid: str
    token: str
    version: str = ""
    users_count: int = 0


class LicenseAnswer(BaseModel):
    """Signed statement handed back to an installation."""

    license: str
    public_key: str = ""
    token: str = ""
