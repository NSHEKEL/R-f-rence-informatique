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
    created_at = Column(DateTime, default=utcnow)

    licenses = relationship(
        "License", back_populates="client", cascade="all, delete-orphan"
    )
    installations = relationship(
        "Installation", back_populates="client", cascade="all, delete-orphan"
    )


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
