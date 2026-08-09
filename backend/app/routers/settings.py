from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
from ..mailer import is_configured, send_mail
from ..models import CompanySettings, User
from ..schemas import CompanySettingsOut, CompanySettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_create(db: Session) -> CompanySettings:
    settings = db.query(CompanySettings).first()
    if settings is None:
        settings = CompanySettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _to_out(settings: CompanySettings) -> CompanySettingsOut:
    """Never expose the SMTP password, only whether mail is usable."""
    out = CompanySettingsOut.model_validate(settings)
    out.smtp_configured = is_configured(settings)
    return out


@router.get("/company", response_model=CompanySettingsOut)
def get_company(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _to_out(_get_or_create(db))


@router.put("/company", response_model=CompanySettingsOut)
def update_company(
    payload: CompanySettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    settings = _get_or_create(db)
    data = payload.model_dump(exclude_unset=True)
    # An empty password means "keep the stored one".
    if data.get("smtp_password") == "":
        data.pop("smtp_password")
    for key, value in data.items():
        setattr(settings, key, value)
    db.commit()
    db.refresh(settings)
    return _to_out(settings)


@router.post("/company/test-mail")
def test_mail(
    db: Session = Depends(get_db), current_user: User = Depends(require_admin)
):
    """Send a test message to the administrator running the check."""
    settings = _get_or_create(db)
    if not is_configured(settings):
        raise HTTPException(
            status_code=400, detail="Configurez d'abord le serveur d'e-mail"
        )
    if not current_user.email:
        raise HTTPException(
            status_code=400, detail="Votre compte n'a pas d'adresse e-mail"
        )
    try:
        send_mail(
            settings,
            current_user.email,
            f"{settings.name} — test d'envoi",
            "Ce message confirme que l'envoi d'e-mails fonctionne.",
        )
    except Exception as exc:  # smtplib raises many different errors
        raise HTTPException(status_code=400, detail=f"Échec de l'envoi : {exc}")
    return {"sent": True, "to": current_user.email}
