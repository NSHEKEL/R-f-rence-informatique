import json
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
        row = ChangeLog(entities=",".join(sorted(touched)))
        session.add(row)
        objects = [obj for obj in (*session.new, *session.dirty, *session.deleted)
                   if getattr(obj, "__tablename__", "") in CATALOGUE_ENTITIES]
        session.info.setdefault("catalogue_changes", []).append((row, objects, touched & CATALOGUE_ENTITIES))


@event.listens_for(SessionLocal, "after_flush_postexec")
def _record_product_ids(session, _flush_context):
    for row, objects, touched in session.info.pop("catalogue_changes", []):
        if not touched or touched & {"categories", "suppliers", "catalogue_settings"}:
            continue
        ids = {getattr(obj, "id" if obj.__tablename__ == "products" else "product_id", None) for obj in objects}
        if ids and None not in ids:
            row.product_ids = json.dumps(sorted(ids))


@event.listens_for(SessionLocal, "after_soft_rollback")
def _discard_product_ids(session, _previous_transaction):
    session.info.pop("catalogue_changes", None)


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
    since: int = 0,
):
    """Revision of the shared database, polled by every workstation."""
    query = db.query(ChangeLog)
    if scope == "catalogue":
        entities = "," + ChangeLog.entities + ","
        query = query.filter(or_(*(entities.like(f"%,{name},%") for name in CATALOGUE_ENTITIES)))
    row = query.order_by(ChangeLog.id.desc()).first()
    product_ids = None
    version = row.id if row else 0
    if scope == "catalogue":
        oldest, latest = db.query(func.min(ChangeLog.id), func.max(ChangeLog.id)).one()
        if latest is not None and since <= latest:
            version = max(version, since)
        changes = query.filter(ChangeLog.id > max(since, 0), ChangeLog.id <= version).all()
        if since > 0 and oldest is not None and since >= oldest - 1:
            try:
                values = [json.loads(change.product_ids) if change.product_ids is not None else None for change in changes]
                if all(isinstance(value, list) and all(type(item) is int and item > 0 for item in value) for value in values):
                    product_ids = sorted({item for value in values for item in value})
            except (ValueError, TypeError):
                pass
    return SyncVersion(
        version=version,
        entities=row.entities if row else "",
        product_ids=product_ids,
    )
