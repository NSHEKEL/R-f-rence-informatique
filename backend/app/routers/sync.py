from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import event, func, inspect, or_
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models import ChangeLog, User
from ..schemas import SyncVersion

router = APIRouter(prefix="/api/sync", tags=["sync"])

KEEP_ROWS = 500
CATALOGUE_ENTITIES = {"products", "product_packagings", "product_barcodes", "stock_lots",
                      "stock_movements", "price_history", "depot_stocks", "categories", "suppliers", "catalogue_settings"}


@event.listens_for(SessionLocal, "before_flush")
def _record_changes(session, _flush_context, _instances) -> None:
    """Append one change row per flush touching business data."""
    touched = {
        obj.__tablename__
        for obj in (*session.new, *session.dirty, *session.deleted)
        if hasattr(obj, "__tablename__")
    }
    touched.discard(ChangeLog.__tablename__)
    touched.discard("workstations")
    if any(getattr(obj, "__tablename__", "") == "company_settings"
           and inspect(obj).attrs.allow_negative_stock_sale.history.has_changes() for obj in session.dirty):
        touched.add("catalogue_settings")
    if touched:
        session.add(ChangeLog(entities=",".join(sorted(touched))))


def trim_change_log() -> None:
    """Keep the feed short; clients only need the most recent revisions."""
    db = SessionLocal()
    try:
        latest = db.query(func.max(ChangeLog.id)).scalar() or 0
        if latest > KEEP_ROWS:
            db.query(ChangeLog).filter(
                ChangeLog.id <= latest - KEEP_ROWS
            ).delete(synchronize_session=False)
            db.commit()
    finally:
        db.close()


@router.get("/version", response_model=SyncVersion)
def get_version(
    db: Session = Depends(get_db), _: User = Depends(get_current_user),
    scope: Literal["all", "catalogue"] = "all",
):
    """Revision of the shared database, polled by every workstation."""
    query = db.query(ChangeLog)
    if scope == "catalogue":
        entities = "," + ChangeLog.entities + ","
        query = query.filter(or_(*(entities.like(f"%,{name},%") for name in CATALOGUE_ENTITIES)))
    row = query.order_by(ChangeLog.id.desc()).first()
    return SyncVersion(
        version=row.id if row else 0,
        entities=row.entities if row else "",
    )
