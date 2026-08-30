"""Business rules of the central service, shared by the console and the API."""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from .models import (
    STATUS_ACTIVE,
    STATUS_EXPIRED,
    STATUS_LABELS,
    STATUS_REVOKED,
    STATUS_SUSPENDED,
    AdminLog,
    Client,
    Feature,
    GlobalAdmin,
    Installation,
    License,
    Plan,
    PlanFeature,
)
from .security import sign_license

# An installation that has not called in for that long is shown as offline.
ONLINE_MINUTES = 15


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(moment: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands back naive datetimes; compare them as UTC."""
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def new_license_key() -> str:
    raw = secrets.token_hex(10).upper()
    return "EG-" + "-".join(raw[i : i + 5] for i in range(0, 20, 5))


def new_installation_token() -> str:
    return secrets.token_urlsafe(32)


def plan_feature_codes(db: Session, plan: Plan) -> list[str]:
    rows = (
        db.query(Feature.code)
        .join(PlanFeature, PlanFeature.feature_id == Feature.id)
        .filter(
            PlanFeature.plan_id == plan.id,
            PlanFeature.allowed.is_(True),
            Feature.is_active.is_(True),
        )
        .all()
    )
    return sorted(code for (code,) in rows)


def effective_status(license_: License) -> str:
    """Status once the end date is taken into account."""
    if license_.status in (STATUS_SUSPENDED, STATUS_REVOKED):
        return license_.status
    ends = aware(license_.ends_at)
    if ends is not None and ends < utcnow():
        return STATUS_EXPIRED
    return license_.status


def refresh_status(db: Session, license_: License) -> str:
    """Persist an expiry that has just happened, so the console shows it."""
    status = effective_status(license_)
    if status != license_.status:
        license_.status = status
        db.commit()
    return status


def days_left(license_: License) -> Optional[int]:
    ends = aware(license_.ends_at)
    if ends is None:
        return None
    return (ends - utcnow()).days


def status_label(status: str) -> str:
    return STATUS_LABELS.get(status, status)


def is_online(installation: Installation) -> bool:
    seen = aware(installation.last_seen)
    if seen is None:
        return False
    return (utcnow() - seen) < timedelta(minutes=ONLINE_MINUTES)


def current_license(db: Session, client: Client) -> Optional[License]:
    return (
        db.query(License)
        .filter(License.client_id == client.id)
        .order_by(License.id.desc())
        .first()
    )


def create_license(
    db: Session,
    client: Client,
    plan: Plan,
    duration_days: Optional[int] = None,
) -> License:
    days = duration_days if duration_days is not None else plan.duration_days
    starts = utcnow()
    license_ = License(
        client_id=client.id,
        key=new_license_key(),
        plan_id=plan.id,
        starts_at=starts,
        ends_at=starts + timedelta(days=days) if days else None,
        grace_days=plan.grace_days,
        status=STATUS_ACTIVE,
    )
    db.add(license_)
    db.commit()
    db.refresh(license_)
    return license_


def license_answer(
    db: Session, installation: Installation, license_: License
) -> str:
    """Signed licence an installation stores and replays while offline."""
    status = refresh_status(db, license_)
    plan = license_.plan
    ends = aware(license_.ends_at)
    payload = {
        "installation": installation.uid,
        "client": installation.client.company if installation.client else "",
        "client_id": installation.client_id,
        "license_key": license_.key,
        "plan_code": plan.code,
        "plan_name": plan.name,
        "status": STATUS_REVOKED if installation.is_revoked else status,
        "features": plan_feature_codes(db, plan),
        "starts_at": aware(license_.starts_at).isoformat()
        if license_.starts_at
        else None,
        "ends_at": ends.isoformat() if ends else None,
        "grace_days": license_.grace_days,
        # How long the installation may keep running on this copy without
        # reaching the server again.
        "offline_days": max(license_.grace_days, 7),
        "issued_at": utcnow().isoformat(),
    }
    return sign_license(payload)


def log(
    db: Session,
    admin: Optional[GlobalAdmin],
    client: Optional[Client],
    action: str,
    old_value: str = "",
    new_value: str = "",
) -> None:
    db.add(
        AdminLog(
            admin_id=admin.id if admin else None,
            admin_name=admin.name if admin else "système",
            client_id=client.id if client else None,
            client_name=client.company if client else "",
            action=action,
            old_value=old_value,
            new_value=new_value,
        )
    )
    db.commit()
