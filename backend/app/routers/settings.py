from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
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


@router.get("/company", response_model=CompanySettingsOut)
def get_company(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _get_or_create(db)


@router.put("/company", response_model=CompanySettingsOut)
def update_company(
    payload: CompanySettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    settings = _get_or_create(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(settings, key, value)
    db.commit()
    db.refresh(settings)
    return settings
