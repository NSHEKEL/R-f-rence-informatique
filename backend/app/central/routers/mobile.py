"""Remote consultation of the sales from a phone, through the central server.

A shop pushes a read-only copy of its accounts and of its recent sales
(``/api/central/public/mirror``); the phone signs in here with the very same
password as at the counter and reads that copy. The shop computer therefore
never has to be reachable from the internet, and the phone never reaches a
shop database.
"""

import json
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Client, Installation, MirrorSale, MirrorUser, utcnow
from ..security import ALGORITHM, session_key, verify_password

router = APIRouter(prefix="/api/central/mobile", tags=["central-mobile"])

SESSION_HOURS = 12
# Roles seeing every ticket; anybody else only reads their own sales.
FULL_VIEW_ROLES = {"admin", "administrateur", "gestionnaire", "manager"}


def mobile_code(db: Session, client: Client) -> str:
    """Short code identifying the shop on the phone, created on demand."""
    if client.mobile_code:
        return client.mobile_code
    while True:
        code = "".join(secrets.choice("ACDEFGHJKLMNPQRTUVWXY3479") for _ in range(6))
        if not db.query(Client).filter(Client.mobile_code == code).first():
            break
    client.mobile_code = code
    db.commit()
    return code


class MobileLogin(BaseModel):
    code: str
    email: str
    password: str


class MobileSession(BaseModel):
    token: str
    company: str
    name: str
    role: str
    full_view: bool


def _token(user: MirrorUser, client: Client) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
    return jwt.encode(
        {
            "sub": str(user.id),
            "cid": client.id,
            "scope": "mobile",
            "exp": expire,
        },
        session_key(),
        algorithm=ALGORITHM,
    )


def current_mobile(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> tuple[MirrorUser, Client]:
    invalid = HTTPException(status_code=401, detail="Session expirée")
    token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    if not token:
        raise invalid
    try:
        payload = jwt.decode(token, session_key(), algorithms=[ALGORITHM])
    except JWTError:
        raise invalid
    if payload.get("scope") != "mobile":
        raise invalid
    user = (
        db.query(MirrorUser).filter(MirrorUser.id == int(payload.get("sub", 0))).first()
    )
    client = db.query(Client).filter(Client.id == payload.get("cid")).first()
    if user is None or client is None or not user.is_active:
        raise invalid
    if user.client_id != client.id:
        raise invalid
    return user, client


@router.post("/login", response_model=MobileSession)
def login(payload: MobileLogin, db: Session = Depends(get_db)):
    code = payload.code.strip().upper()
    client = db.query(Client).filter(Client.mobile_code == code).first()
    email = payload.email.strip().lower()
    user = (
        db.query(MirrorUser)
        .filter(MirrorUser.client_id == client.id, MirrorUser.email == email)
        .first()
        if client
        else None
    )
    if (
        client is None
        or user is None
        or not user.is_active
        or not user.hashed_password
        or not verify_password(payload.password, user.hashed_password)
    ):
        raise HTTPException(status_code=401, detail="Code, e-mail ou mot de passe incorrect")
    return MobileSession(
        token=_token(user, client),
        company=client.company,
        name=user.name or user.email,
        role=user.role or "",
        full_view=(user.role or "").lower() in FULL_VIEW_ROLES,
    )


def _visible(db: Session, user: MirrorUser, client: Client):
    query = db.query(MirrorSale).filter(MirrorSale.client_id == client.id)
    if (user.role or "").lower() not in FULL_VIEW_ROLES:
        query = query.filter(MirrorSale.seller_email == user.email)
    return query


@router.get("/sales")
def sales(
    search: str = "",
    limit: int = 100,
    session: tuple[MirrorUser, Client] = Depends(current_mobile),
    db: Session = Depends(get_db),
):
    user, client = session
    query = _visible(db, user, client)
    text = search.strip().lower()
    if text:
        like = f"%{text}%"
        query = query.filter(
            MirrorSale.reference.ilike(like) | MirrorSale.customer.ilike(like)
        )
    rows = query.order_by(MirrorSale.date.desc()).limit(max(1, min(limit, 500))).all()
    return [
        {
            "reference": row.reference,
            "date": row.date.isoformat() if row.date else "",
            "total": row.total,
            "status": row.status,
            "payment_method": row.payment_method,
            "customer": row.customer,
            "seller": row.seller,
            "items": json.loads(row.items or "[]"),
        }
        for row in rows
    ]


@router.get("/team")
def team(
    session: tuple[MirrorUser, Client] = Depends(current_mobile),
    db: Session = Depends(get_db),
):
    """Accounts of the shop, with what each of them sold."""
    user, client = session
    if (user.role or "").lower() not in FULL_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Accès réservé à la direction")
    sales = db.query(MirrorSale).filter(MirrorSale.client_id == client.id).all()
    rows = (
        db.query(MirrorUser)
        .filter(MirrorUser.client_id == client.id)
        .order_by(MirrorUser.name)
        .all()
    )
    return [
        {
            "email": row.email,
            "name": row.name or row.email,
            "role": row.role or "",
            "is_active": bool(row.is_active),
            "sales_count": sum(1 for s in sales if s.seller_email == row.email),
            "sales_total": sum(
                s.total or 0 for s in sales if s.seller_email == row.email
            ),
        }
        for row in rows
    ]


@router.get("/accounting")
def accounting(
    days: int = 7,
    session: tuple[MirrorUser, Client] = Depends(current_mobile),
    db: Session = Depends(get_db),
):
    """Figures of the shop for the phone: days, payments, best sellers."""
    user, client = session
    rows = _visible(db, user, client).all()
    span = max(1, min(days, 60))
    start = (utcnow() - timedelta(days=span - 1)).date()

    per_day: dict[str, dict[str, float]] = {}
    per_payment: dict[str, dict[str, float]] = {}
    per_product: dict[str, dict[str, float]] = {}
    for row in rows:
        if not row.date or row.date.date() < start:
            continue
        day = per_day.setdefault(
            row.date.date().isoformat(), {"total": 0.0, "count": 0.0}
        )
        day["total"] += row.total or 0
        day["count"] += 1
        payment = per_payment.setdefault(
            row.payment_method or "Non précisé", {"total": 0.0, "count": 0.0}
        )
        payment["total"] += row.total or 0
        payment["count"] += 1
        for item in json.loads(row.items or "[]"):
            product = per_product.setdefault(
                str(item.get("name", "")), {"quantity": 0.0, "total": 0.0}
            )
            product["quantity"] += float(item.get("quantity") or 0)
            product["total"] += float(item.get("subtotal") or 0)

    best = sorted(per_product.items(), key=lambda pair: -pair[1]["total"])[:10]
    return {
        "days": [
            {"day": key, "total": value["total"], "count": int(value["count"])}
            for key, value in sorted(per_day.items())
        ],
        "payments": [
            {"method": key, "total": value["total"], "count": int(value["count"])}
            for key, value in sorted(per_payment.items(), key=lambda p: -p[1]["total"])
        ],
        "products": [
            {"name": name, "quantity": value["quantity"], "total": value["total"]}
            for name, value in best
        ],
        "period_total": sum(value["total"] for value in per_day.values()),
        "period_count": int(sum(value["count"] for value in per_day.values())),
    }


@router.get("/about")
def about(
    session: tuple[MirrorUser, Client] = Depends(current_mobile),
    db: Session = Depends(get_db),
):
    """Shop identity and the text the owner writes from his console."""
    _, client = session
    installation = (
        db.query(Installation)
        .filter(Installation.client_id == client.id)
        .order_by(Installation.last_seen.desc().nullslast())
        .first()
    )
    return {
        "company": client.company,
        "manager": client.manager or "",
        "phone": client.phone or "",
        "email": client.email or "",
        "address": client.address or "",
        "city": client.city or "",
        "about": client.about or "",
        "version": installation.version if installation else "",
    }


@router.get("/summary")
def summary(
    session: tuple[MirrorUser, Client] = Depends(current_mobile),
    db: Session = Depends(get_db),
):
    user, client = session
    rows = _visible(db, user, client).all()
    now = utcnow()
    today = now.date()
    def _day(row):
        return row.date.date() if row.date else None

    day_rows = [row for row in rows if _day(row) == today]
    month_rows = [
        row
        for row in rows
        if row.date and row.date.year == now.year and row.date.month == now.month
    ]
    installation = (
        db.query(Installation)
        .filter(Installation.client_id == client.id)
        .order_by(Installation.last_seen.desc().nullslast())
        .first()
    )
    return {
        "company": client.company,
        "today_total": sum(row.total or 0 for row in day_rows),
        "today_count": len(day_rows),
        "month_total": sum(row.total or 0 for row in month_rows),
        "month_count": len(month_rows),
        "sales_count": len(rows),
        "last_sync": installation.last_sync.isoformat()
        if installation and installation.last_sync
        else "",
    }
