"""Licence of this installation, seen from the shop.

Reading it is open to every signed-in user (the menu needs it); registering or
forcing a synchronisation is reserved to the administrator.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import licensing
from ..auth import get_current_user, require_admin
from ..database import get_db
from ..features import FEATURES
from ..models import User
from ..schemas import (
    LicenseFeature,
    LicenseRegister,
    LicenseStatus,
    OfferedPlan,
)

router = APIRouter(prefix="/api/license", tags=["license"])


def _status(db: Session) -> LicenseStatus:
    view = licensing.current(db)
    row = licensing.state(db)
    return LicenseStatus(
        mode=view.mode,
        plan_code=view.plan_code,
        plan_name=view.plan_name,
        status=view.status,
        message=view.message,
        blocked=view.blocked,
        registered=bool(row and row.license_token),
        client_name=view.client_name,
        license_key=view.license_key,
        ends_at=view.ends_at,
        days_left=view.days_left,
        grace_days=view.grace_days,
        last_sync=view.last_sync,
        last_error=view.last_error,
        central_url=view.central_url,
        installation_uid=view.installation_uid,
        features=sorted(view.features) if view.mode != licensing.MODE_LOCAL
        else [spec.code for spec in FEATURES],
        catalogue=[
            LicenseFeature(
                code=spec.code,
                name=spec.name,
                section=spec.section,
                allowed=view.allows(spec.code),
            )
            for spec in FEATURES
        ],
    )


@router.get("", response_model=LicenseStatus)
def read(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _status(db)


@router.get("/plans", response_model=list[OfferedPlan])
def plans(
    url: str = "",
    _: User = Depends(require_admin),
):
    """Formulas offered by the central server, for the first configuration."""
    target = url.strip() or licensing.central_url()
    if not target:
        raise HTTPException(
            status_code=400,
            detail="Adresse du serveur central manquante",
        )
    try:
        return [OfferedPlan(**plan) for plan in licensing.offered_plans(target)]
    except licensing.CentralError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/register", response_model=LicenseStatus, status_code=201)
def register(
    payload: LicenseRegister,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    target = payload.central_url.strip() or licensing.central_url()
    try:
        licensing.register(
            db,
            url=target,
            plan_code=payload.plan_code,
            company=payload.company,
            manager=payload.manager,
            phone=payload.phone,
            email=payload.email,
            address=payload.address,
            city=payload.city,
            users_count=db.query(User).filter(User.is_active.is_(True)).count(),
        )
    except licensing.CentralError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _status(db)


@router.post("/sync", response_model=LicenseStatus)
def sync(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    try:
        licensing.synchronise(db)
    except licensing.CentralError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _status(db)
