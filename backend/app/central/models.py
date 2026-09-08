"""Tables of the central service.

They deliberately live in their own database: a shop database only holds the
licence state its own installation received, never another client's data.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GlobalAdmin(Base):
    """Owner of the software: full access to every client of the console."""

    __tablename__ = "global_admins"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, default="Administrateur Global")
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)


class Feature(Base):
    """One capability of EasyGest that a plan may allow or not."""

    __tablename__ = "features"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    section = Column(String, default="Général")
    is_active = Column(Boolean, default=True, nullable=False)
    position = Column(Integer, default=0)


class Plan(Base):
    """Commercial formula (Business, Entreprise, ...) — never hard coded."""

    __tablename__ = "plans"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    price = Column(Float, default=0)
    currency = Column(String, default="FCFA")
    duration_days = Column(Integer, default=365)
    grace_days = Column(Integer, default=7)
    is_active = Column(Boolean, default=True, nullable=False)
    # Offered on the "Choisissez votre formule" screen of a new installation.
    is_public = Column(Boolean, default=True, nullable=False)
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)

    rights = relationship(
        "PlanFeature", back_populates="plan", cascade="all, delete-orphan"
    )


class PlanFeature(Base):
    """ON/OFF switch of one feature inside one plan."""

    __tablename__ = "plan_features"
    __table_args__ = (UniqueConstraint("plan_id", "feature_id"),)

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("plans.id"), nullable=False)
    feature_id = Column(Integer, ForeignKey("features.id"), nullable=False)
    allowed = Column(Boolean, default=False, nullable=False)

    plan = relationship("Plan", back_populates="rights")
    feature = relationship("Feature")


class Client(Base):
    """Company using EasyGest, as known by the software owner."""

    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    company = Column(String, nullable=False, index=True)
    manager = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="", index=True)
    address = Column(String, default="")
    city = Column(String, default="")
    note = Column(Text, default="")
    # "À propos de nous" pushed to the shop at the next synchronisation.
    about = Column(Text, default="")
    # Short code typed on the phone to reach this shop's sales from anywhere.
    mobile_code = Column(String, unique=True, index=True, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    admins = relationship(
        "ClientAdmin", back_populates="client", cascade="all, delete-orphan"
    )
    licenses = relationship(
        "License", back_populates="client", cascade="all, delete-orphan"
    )
    installations = relationship(
        "Installation", back_populates="client", cascade="all, delete-orphan"
    )


class ClientAdmin(Base):
    """Administrator account of a shop, managed from the owner's console.

    The password never travels in clear: only its hash is stored here and
    handed to the installation, which creates or updates the matching local
    account at the next synchronisation.
    """

    __tablename__ = "client_admins"
    __table_args__ = (UniqueConstraint("client_id", "email", name="uq_client_admin"),)

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    name = Column(String, nullable=False, default="Administrateur")
    email = Column(String, nullable=False, index=True)
    hashed_password = Column(String, default="")
    is_active = Column(Boolean, default=True, nullable=False)
    # Removed from the console: the shop deactivates the account instead of
    # deleting it, so its history of sign-ins and sales stays readable.
    is_removed = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    created_at = Column(DateTime, default=utcnow)

    client = relationship("Client", back_populates="admins")


# Licence states, in the order they appear in the console.
STATUS_ACTIVE = "active"
STATUS_SUSPENDED = "suspended"
STATUS_EXPIRED = "expired"
STATUS_REVOKED = "revoked"
STATUS_LABELS = {
    STATUS_ACTIVE: "Active",
    STATUS_SUSPENDED: "Suspendue",
    STATUS_EXPIRED: "Expirée",
    STATUS_REVOKED: "Révoquée",
}


class License(Base):
    """Right to use EasyGest, for one client and one installation."""

    __tablename__ = "licenses"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    key = Column(String, unique=True, index=True, nullable=False)
    plan_id = Column(Integer, ForeignKey("plans.id"), nullable=False)
    starts_at = Column(DateTime, default=utcnow)
    ends_at = Column(DateTime, nullable=True)
    grace_days = Column(Integer, default=7)
    status = Column(String, default=STATUS_ACTIVE, index=True)
    suspended_reason = Column(String, default="")
    created_at = Column(DateTime, default=utcnow)

    client = relationship("Client", back_populates="licenses")
    plan = relationship("Plan")
    installations = relationship("Installation", back_populates="license")


class Installation(Base):
    """One computer (or one shop server) running EasyGest."""

    __tablename__ = "installations"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    license_id = Column(Integer, ForeignKey("licenses.id"), nullable=True)
    uid = Column(String, unique=True, index=True, nullable=False)
    # Shared secret proving the installation is the one that registered.
    token = Column(String, nullable=False)
    hostname = Column(String, default="")
    version = Column(String, default="")
    users_count = Column(Integer, default=0)
    last_seen = Column(DateTime, nullable=True)
    last_sync = Column(DateTime, nullable=True)
    last_ip = Column(String, default="")
    is_revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    client = relationship("Client", back_populates="installations")
    license = relationship("License", back_populates="installations")


class MirrorUser(Base):
    """Account allowed to consult the shop from the phone.

    The shop pushes the hash of its own accounts, so signing in on the phone
    uses the very same password as at the counter and no password ever
    travels or is stored in clear.
    """

    __tablename__ = "mirror_users"
    __table_args__ = (UniqueConstraint("client_id", "email", name="uq_mirror_user"),)

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    email = Column(String, nullable=False, index=True)
    name = Column(String, default="")
    role = Column(String, default="")
    hashed_password = Column(String, default="")
    is_active = Column(Boolean, default=True, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class MirrorSale(Base):
    """Copy of a shop sale, pushed by the shop for remote consultation.

    Read only: the phone never writes into a shop, and this copy holds no
    other client's data.
    """

    __tablename__ = "mirror_sales"
    __table_args__ = (
        UniqueConstraint("client_id", "reference", name="uq_mirror_sale"),
    )

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    reference = Column(String, nullable=False, index=True)
    date = Column(DateTime, nullable=True, index=True)
    total = Column(Float, default=0)
    status = Column(String, default="")
    payment_method = Column(String, default="")
    customer = Column(String, default="")
    seller = Column(String, default="")
    seller_email = Column(String, default="", index=True)
    items = Column(Text, default="[]")
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class MirrorReturn(Base):
    """Copy of a credit note, so returns show up on the phone as well."""

    __tablename__ = "mirror_returns"
    __table_args__ = (
        UniqueConstraint("client_id", "reference", name="uq_mirror_return"),
    )

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    reference = Column(String, nullable=False, index=True)
    sale_reference = Column(String, default="")
    date = Column(DateTime, nullable=True, index=True)
    total = Column(Float, default=0)
    reason = Column(Text, default="")
    customer = Column(String, default="")
    seller = Column(String, default="")
    seller_email = Column(String, default="", index=True)
    items = Column(Text, default="[]")
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class AdminLog(Base):
    """Every administrative action, with what changed."""

    __tablename__ = "admin_logs"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("global_admins.id"), nullable=True)
    admin_name = Column(String, default="")
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    client_name = Column(String, default="")
    action = Column(String, nullable=False, index=True)
    old_value = Column(Text, default="")
    new_value = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow, index=True)
