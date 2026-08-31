"""First start of the central service: features, plans and the first owner."""

import os

from sqlalchemy.orm import Session

from ..features import BASE_FEATURES, FEATURES
from .database import Base, SessionLocal, engine
from .models import Feature, GlobalAdmin, Plan, PlanFeature
from .security import hash_password

# Starting formulas. The console can rename them, change their rights, or add
# others: nothing below is enforced afterwards.
STARTER_PLANS = (
    {
        "code": "business",
        "name": "Business",
        "description": "Gestion quotidienne d'un point de vente",
        "price": 0,
        "duration_days": 365,
        "grace_days": 7,
        "position": 1,
        "features": set(BASE_FEATURES),
    },
    {
        "code": "entreprise",
        "name": "Entreprise",
        "description": "Toutes les fonctionnalités, multi-postes et pilotage",
        "price": 0,
        "duration_days": 365,
        "grace_days": 7,
        "position": 2,
        "features": {spec.code for spec in FEATURES},
    },
)


def sync_features(db: Session) -> None:
    """Keep the catalogue aligned with the software's capabilities."""
    known = {row.code: row for row in db.query(Feature).all()}
    for position, spec in enumerate(FEATURES, start=1):
        row = known.get(spec.code)
        if row is None:
            db.add(
                Feature(
                    code=spec.code,
                    name=spec.name,
                    description=spec.description,
                    section=spec.section,
                    position=position,
                )
            )
        else:
            row.name = spec.name
            row.description = spec.description
            row.section = spec.section
            row.position = position
    db.commit()


def _seed_plans(db: Session) -> None:
    features = {row.code: row for row in db.query(Feature).all()}
    for spec in STARTER_PLANS:
        plan = db.query(Plan).filter(Plan.code == spec["code"]).first()
        if plan is None:
            plan = Plan(
                code=spec["code"],
                name=spec["name"],
                description=spec["description"],
                price=spec["price"],
                duration_days=spec["duration_days"],
                grace_days=spec["grace_days"],
                position=spec["position"],
            )
            db.add(plan)
            db.flush()
        existing = {row.feature_id for row in plan.rights}
        for code, feature in features.items():
            if feature.id in existing:
                continue
            db.add(
                PlanFeature(
                    plan_id=plan.id,
                    feature_id=feature.id,
                    allowed=code in spec["features"],
                )
            )
    db.commit()


def _seed_admin(db: Session) -> None:
    if db.query(GlobalAdmin).count():
        return
    email = os.getenv("CENTRAL_ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("CENTRAL_ADMIN_PASSWORD", "").strip()
    if not email or not password:
        return
    db.add(
        GlobalAdmin(
            name=os.getenv("CENTRAL_ADMIN_NAME", "Administrateur Global"),
            email=email,
            hashed_password=hash_password(password),
        )
    )
    db.commit()


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        sync_features(db)
        _seed_plans(db)
        _seed_admin(db)
    finally:
        db.close()
