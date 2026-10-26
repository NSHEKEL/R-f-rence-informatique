"""FNE : configuration de la connexion officielle et certification des ventes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import fne
from ..auth import require_admin
from ..database import get_db
from ..models import CompanySettings, FneInvoice, Sale, User
from ..permissions import require_permission
from ..schemas import (
    FneInvoiceOut,
    FneSettingsOut,
    FneSettingsUpdate,
)

router = APIRouter(prefix="/api/fne", tags=["fne"])


@router.get("/settings", response_model=FneSettingsOut)
def get_settings(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    s = _get_or_create(db)
    return FneSettingsOut(
        enabled=s.fne_enabled,
        environment=s.fne_environment,
        api_url=s.fne_api_url,
        token_url=s.fne_token_url,
        client_id=s.fne_client_id,
        credentials_configured=bool(s.fne_client_secret or s.fne_api_key),
        configured=fne.configured(s),
    )


@router.put("/settings", response_model=FneSettingsOut)
def put_settings(
    payload: FneSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    s = _get_or_create(db)
    for field in (
        "enabled",
        "environment",
        "api_url",
        "token_url",
        "client_id",
        "client_secret",
        "api_key",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(s, f"fne_{field}", value)
    db.commit()
    return get_settings(db=db, _=_)


@router.get("/invoices", response_model=list[FneInvoiceOut])
def list_invoices(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("ventes")),
):
    return (
        db.query(FneInvoice).order_by(FneInvoice.updated_at.desc()).limit(200).all()
    )


@router.post("/certify/{sale_id}", response_model=FneInvoiceOut)
def certify_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("vente_nouvelle")),
):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    settings = _get_or_create(db)
    try:
        return fne.certify(db, sale, settings, current_user.id)
    except fne.FneError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
