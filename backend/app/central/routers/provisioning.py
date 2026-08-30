"""API used by an installed EasyGest: register once, then synchronise.

These are the only routes a shop can reach: they never expose another
client's data, and everything they answer is signed by the server.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Client, Installation, License, Plan
from ..schemas import LicenseAnswer, PublicPlan, RegisterRequest, SyncRequest
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

router = APIRouter(prefix="/api/central/public", tags=["central-public"])


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
