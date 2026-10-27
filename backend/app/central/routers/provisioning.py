"""API used by an installed EasyGest: register once, then synchronise.

These are the only routes a shop can reach: they never expose another
client's data, and everything they answer is signed by the server.
"""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from .. import events, mailer
from ..database import SessionLocal
from ..models import (
    Client,
    GlobalAdmin,
    Installation,
    License,
    MirrorReturn,
    MirrorSale,
    MirrorSupportRequest,
    MirrorUser,
    Plan,
)
from ..schemas import (
    LicenseAnswer,
    MirrorRequest,
    PublicPlan,
    RegisterRequest,
    SyncRequest,
)
from ..security import license_public_key
from ..service import (
    create_license,
    current_license,
    license_answer,
    log,
    new_installation_token,
    plan_feature_codes,
    utcnow,
)

from .mobile import mobile_code

router = APIRouter(prefix="/api/central/public", tags=["central-public"])


def _naive(value: datetime | None) -> datetime | None:
    """Store dates without a zone: PostgreSQL columns here are naive."""
    if value is None:
        return None
    return value.replace(tzinfo=None) if value.tzinfo else value


@router.get("/key")
def public_key():
    """Key an installation pins to check the signature of its licence."""
    return {"public_key": license_public_key()}


@router.get("/plans", response_model=list[PublicPlan])
def offered_plans(db: Session = Depends(get_db)):
    """Formulas shown on "Choisissez votre formule"."""
    plans = (
        db.query(Plan)
        .filter(Plan.is_active.is_(True), Plan.is_public.is_(True))
        .order_by(Plan.position, Plan.id)
        .all()
    )
    return [
        PublicPlan(
            code=plan.code,
            name=plan.name,
            description=plan.description or "",
            price=plan.price or 0,
            currency=plan.currency or "FCFA",
            duration_days=plan.duration_days or 0,
            features=plan_feature_codes(db, plan),
        )
        for plan in plans
    ]


@router.post("/register", response_model=LicenseAnswer, status_code=201)
def register(
    payload: RegisterRequest, request: Request, db: Session = Depends(get_db)
):
    """First configuration of a workstation: create the client and licence."""
    uid = payload.installation_uid.strip()
    if len(uid) < 16:
        raise HTTPException(status_code=400, detail="Identifiant d'installation invalide")
    plan = (
        db.query(Plan)
        .filter(Plan.code == payload.plan_code, Plan.is_active.is_(True))
        .first()
    )
    if plan is None:
        raise HTTPException(status_code=404, detail="Formule introuvable")

    installation = (
        db.query(Installation).filter(Installation.uid == uid).first()
    )
    if installation is not None:
        # Re-installation on the same computer: keep the client and licence.
        license_ = current_license(db, installation.client)
        if license_ is None:
            license_ = create_license(db, installation.client, plan)
            installation.license_id = license_.id
        installation.token = new_installation_token()
        installation.version = payload.version
        installation.hostname = payload.hostname
        installation.last_seen = utcnow()
        db.commit()
        return LicenseAnswer(
            license=license_answer(db, installation, license_),
            public_key=license_public_key(),
            token=installation.token,
        )

    company = payload.company.strip() or "Client EasyGest"
    client = Client(
        company=company,
        manager=payload.manager,
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        city=payload.city,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    license_ = create_license(db, client, plan)
    installation = Installation(
        client_id=client.id,
        license_id=license_.id,
        uid=uid,
        token=new_installation_token(),
        hostname=payload.hostname,
        version=payload.version,
        users_count=payload.users_count,
        last_seen=utcnow(),
        last_sync=utcnow(),
        last_ip=request.client.host if request.client else "",
    )
    db.add(installation)
    db.commit()
    db.refresh(installation)
    log(
        db,
        None,
        client,
        "Enregistrement installation",
        "",
        f"{plan.name} · {uid}",
    )
    return LicenseAnswer(
        license=license_answer(db, installation, license_),
        public_key=license_public_key(),
        token=installation.token,
    )


@router.post("/mirror")
def mirror(payload: MirrorRequest, db: Session = Depends(get_db)):
    """Read-only copy pushed by a shop for consultation from a phone."""
    installation = (
        db.query(Installation)
        .filter(Installation.uid == payload.installation_uid.strip())
        .first()
    )
    if installation is None:
        raise HTTPException(status_code=404, detail="Installation inconnue")
    if not payload.token or payload.token != installation.token:
        raise HTTPException(status_code=401, detail="Installation non autorisée")
    client = installation.client

    known = {
        row.email: row
        for row in db.query(MirrorUser).filter(MirrorUser.client_id == client.id)
    }
    for user in payload.users:
        email = user.email.strip().lower()
        if not email:
            continue
        row = known.pop(email, None)
        if row is None:
            row = MirrorUser(client_id=client.id, email=email)
            db.add(row)
        row.name = user.name
        row.role = user.role
        row.hashed_password = user.hashed_password
        row.is_active = user.is_active
    for row in known.values():
        # An account removed at the counter loses its phone access, but its
        # sales stay readable by the shop.
        row.is_active = False

    stored = {
        row.reference: row
        for row in db.query(MirrorSale).filter(MirrorSale.client_id == client.id)
    }
    new_sales = []
    for sale in payload.sales:
        row = stored.get(sale.reference)
        if row is None:
            row = MirrorSale(client_id=client.id, reference=sale.reference)
            db.add(row)
            new_sales.append(sale)
        row.installation_uid = installation.uid
        row.date = _naive(sale.date)
        row.total = sale.total
        row.status = sale.status
        row.payment_method = sale.payment_method
        row.customer = sale.customer
        row.seller = sale.seller
        row.seller_email = sale.seller_email.strip().lower()
        row.items = json.dumps(sale.items, ensure_ascii=False)

    credits = {
        row.reference: row
        for row in db.query(MirrorReturn).filter(MirrorReturn.client_id == client.id)
    }
    for credit in payload.returns:
        row = credits.get(credit.reference)
        if row is None:
            row = MirrorReturn(client_id=client.id, reference=credit.reference)
            db.add(row)
        row.installation_uid = installation.uid
        row.sale_reference = credit.sale_reference
        row.date = _naive(credit.date)
        row.total = credit.total
        row.reason = credit.reason
        row.customer = credit.customer
        row.seller = credit.seller
        row.seller_email = credit.seller_email.strip().lower()
        row.items = json.dumps(credit.items, ensure_ascii=False)

    # Magasin identity self-declared by the shop (never overwrites a name or
    # city the console set by hand).
    if payload.shop_name and not installation.shop_name:
        installation.shop_name = payload.shop_name.strip()[:200]
    if payload.city and not installation.city:
        installation.city = payload.city.strip()[:200]
    if payload.address and not installation.address:
        installation.address = payload.address.strip()[:300]

    known_requests = {
        row.local_id: row
        for row in db.query(MirrorSupportRequest).filter(
            MirrorSupportRequest.client_id == client.id,
            MirrorSupportRequest.installation_uid == installation.uid,
        )
    }
    new_requests = []
    for req in payload.support_requests:
        if req.local_id in known_requests:
            continue  # never duplicate a demand already received
        db.add(
            MirrorSupportRequest(
                client_id=client.id,
                installation_uid=installation.uid,
                local_id=req.local_id,
                name=req.name[:200],
                email=req.email[:200],
                subject=req.subject[:300],
                category=(req.category or "assistance")[:50],
                message=req.message[:10000],
                created_at=_naive(req.created_at) or utcnow(),
            )
        )
        new_requests.append(req)

    installation.last_seen = utcnow()
    db.commit()

    # Real-time fan-out: consoles watching right now are told within a second.
    for sale in new_sales:
        events.publish(
            "vente",
            {
                "client_id": client.id,
                "client_name": client.company,
                "installation_uid": installation.uid,
                "shop_name": installation.shop_name or installation.hostname,
                "city": installation.city,
                "reference": sale.reference,
                "total": sale.total,
                "seller": sale.seller,
                "date": sale.date.isoformat() if sale.date else None,
            },
        )
    for req in new_requests:
        events.publish(
            "support",
            {
                "client_id": client.id,
                "client_name": client.company,
                "installation_uid": installation.uid,
                "subject": req.subject,
                "category": req.category,
            },
        )
    _alert_support_requests(db, client, installation, new_requests)
    return {"status": "ok", "code": mobile_code(db, client), "sales": len(payload.sales)}


def _alert_support_requests(db, client, installation, requests) -> None:
    """E-mail the global admin for each new demand; failures are recorded on
    the row itself (email_sent stays False) so nothing is ever pretended."""
    import os
    import threading

    if not requests:
        return
    recipient = os.getenv("CENTRAL_ALERT_EMAIL", "").strip()
    if not recipient:
        admin = db.query(GlobalAdmin).filter(GlobalAdmin.is_active.is_(True)).first()
        recipient = admin.email if admin else ""
    if not recipient:
        return

    def _work():
        session = SessionLocal()
        try:
            for req in requests:
                row = (
                    session.query(MirrorSupportRequest)
                    .filter(
                        MirrorSupportRequest.client_id == client.id,
                        MirrorSupportRequest.installation_uid == installation.uid,
                        MirrorSupportRequest.local_id == req.local_id,
                    )
                    .first()
                )
                if row is None:
                    continue
                row.email_attempts = (row.email_attempts or 0) + 1
                try:
                    mailer.send_alert(
                        recipient,
                        f"[EasyGest] Demande {req.category} — {req.subject}",
                        "Nouvelle demande reçue depuis la console EasyGest.\n\n"
                        f"Client : {client.company}\n"
                        f"Magasin : {installation.shop_name or installation.hostname}"
                        f" ({installation.city or '—'})\n"
                        f"Catégorie : {req.category}\n"
                        f"Sujet : {req.subject}\n"
                        f"De : {req.name} <{req.email}>\n\n"
                        "Le contenu complet est consultable dans la console,"
                        " section « Suggestions et critiques ».",
                    )
                    row.email_sent = True
                    row.email_error = ""
                except Exception as exc:  # noqa: BLE001 - recorded, never hidden
                    row.email_sent = False
                    row.email_error = str(exc)[:500]
                session.commit()
        finally:
            session.close()

    threading.Thread(target=_work, daemon=True).start()


@router.post("/sync", response_model=LicenseAnswer)
def sync(payload: SyncRequest, request: Request, db: Session = Depends(get_db)):
    """Periodic check-in: the server decides what the installation may do."""
    installation = (
        db.query(Installation)
        .filter(Installation.uid == payload.installation_uid.strip())
        .first()
    )
    if installation is None:
        raise HTTPException(status_code=404, detail="Installation inconnue")
    # Constant work either way: an installation only proves itself with the
    # token handed out at registration.
    if not payload.token or payload.token != installation.token:
        raise HTTPException(status_code=401, detail="Installation non autorisée")

    installation.last_seen = utcnow()
    installation.last_sync = utcnow()
    installation.last_ip = request.client.host if request.client else ""
    if payload.version:
        installation.version = payload.version
    if payload.users_count:
        installation.users_count = payload.users_count
    db.commit()

    license_ = (
        db.query(License).filter(License.id == installation.license_id).first()
        or current_license(db, installation.client)
    )
    if license_ is None:
        raise HTTPException(status_code=404, detail="Aucune licence")
    return LicenseAnswer(license=license_answer(db, installation, license_))
