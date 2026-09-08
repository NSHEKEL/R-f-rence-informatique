"""Undo / redo of the administrator's edits.

Every write made by an administrator on a tracked table is snapshotted
(row before / row after) while the request runs, then stored as one
:class:`~app.models.ActionLog` entry. Undoing replays the "before" rows,
redoing replays the "after" rows.

Sales, credit notes, deliveries and till sessions are deliberately *not*
tracked: they already have their own reversal flows (cancellation, credit
note, closing) and move the stock, so rewriting them behind the accounting
would be unsafe.
"""

import json
from contextvars import ContextVar
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from .database import SessionLocal, engine
from .models import (
    ActionLog,
    Category,
    Customer,
    Expense,
    Order,
    OrderItem,
    Product,
    Proforma,
    ProformaItem,
    Supplier,
)

TRACKED = (
    Product,
    Category,
    Supplier,
    Customer,
    Expense,
    Order,
    OrderItem,
    Proforma,
    ProformaItem,
)
TRACKED_TABLES = {model.__tablename__: model for model in TRACKED}

# Human readable label per route prefix, used in the "last action" banner.
LABELS = {
    ("POST", "products"): "Ajout d'un article",
    ("PUT", "products"): "Modification d'un article",
    ("DELETE", "products"): "Suppression d'un article",
    ("POST", "categories"): "Ajout d'une catégorie",
    ("PUT", "categories"): "Modification d'une catégorie",
    ("DELETE", "categories"): "Suppression d'une catégorie",
    ("POST", "suppliers"): "Ajout d'un fournisseur",
    ("PUT", "suppliers"): "Modification d'un fournisseur",
    ("DELETE", "suppliers"): "Suppression d'un fournisseur",
    ("POST", "customers"): "Ajout d'un client",
    ("PUT", "customers"): "Modification d'un client",
    ("DELETE", "customers"): "Suppression d'un client",
    ("POST", "accounting"): "Ajout d'une dépense",
    ("PUT", "accounting"): "Modification d'une dépense",
    ("DELETE", "accounting"): "Suppression d'une dépense",
    ("POST", "orders"): "Ajout d'une commande",
    ("PUT", "orders"): "Modification d'une commande",
    ("DELETE", "orders"): "Suppression d'une commande",
    ("POST", "proformas"): "Ajout d'une proforma",
    ("PUT", "proformas"): "Modification d'une proforma",
    ("DELETE", "proformas"): "Suppression d'une proforma",
}


class Recorder:
    """Collects the row snapshots produced by a single request."""

    def __init__(self, label: str, user_id: Optional[int]) -> None:
        self.label = label
        self.user_id = user_id
        self.entries: list[dict[str, Any]] = []


_current: ContextVar[Optional[Recorder]] = ContextVar(
    "easygest_recorder", default=None
)


def start(label: str, user_id: Optional[int]) -> Recorder:
    recorder = Recorder(label, user_id)
    _current.set(recorder)
    return recorder


def stop() -> None:
    _current.set(None)


def label_for(method: str, path: str) -> str:
    """"POST /api/products/12" -> "Ajout d'un article"."""
    parts = [part for part in path.split("/") if part]
    section = parts[1] if len(parts) > 1 and parts[0] == "api" else ""
    # A delivery creates a sale and moves the stock: it is reversed through
    # a credit note, never by rewriting rows.
    if parts[-1] in ("deliver", "deliveries"):
        return ""
    return LABELS.get((method, section), "")


def _encode(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _snapshot(obj: Any) -> dict[str, Any]:
    mapper = inspect(obj).mapper
    return {
        column.key: _encode(getattr(obj, column.key))
        for column in mapper.column_attrs
    }


def _decode(table, values: dict[str, Any]) -> dict[str, Any]:
    """Turn a stored snapshot back into values the database accepts."""
    decoded: dict[str, Any] = {}
    for key, value in values.items():
        column = table.columns.get(key)
        if column is None:
            continue
        if isinstance(value, str) and column.type.python_type in (
            datetime,
            date,
        ):
            try:
                parsed = datetime.fromisoformat(value)
            except ValueError:
                decoded[key] = None
                continue
            decoded[key] = (
                parsed.date() if column.type.python_type is date else parsed
            )
        else:
            decoded[key] = value
    return decoded


@event.listens_for(SessionLocal, "after_flush")
def _capture(session: Session, _flush_context) -> None:
    recorder = _current.get()
    if recorder is None:
        return
    for obj in session.new:
        if isinstance(obj, TRACKED):
            recorder.entries.append(
                {
                    "table": obj.__tablename__,
                    "before": None,
                    "after": _snapshot(obj),
                }
            )
    for obj in session.dirty:
        if not isinstance(obj, TRACKED) or not session.is_modified(obj):
            continue
        state = inspect(obj)
        before = _snapshot(obj)
        for attr in state.mapper.column_attrs:
            history = state.attrs[attr.key].history
            if history.deleted:
                before[attr.key] = _encode(history.deleted[0])
        recorder.entries.append(
            {
                "table": obj.__tablename__,
                "before": before,
                "after": _snapshot(obj),
            }
        )
    for obj in session.deleted:
        if isinstance(obj, TRACKED):
            recorder.entries.append(
                {
                    "table": obj.__tablename__,
                    "before": _snapshot(obj),
                    "after": None,
                }
            )


def persist(recorder: Recorder) -> None:
    """Store the collected snapshots as one undoable action."""
    if not recorder.entries or not recorder.label:
        return
    db = SessionLocal()
    try:
        db.add(
            ActionLog(
                label=recorder.label,
                entries=json.dumps(recorder.entries, ensure_ascii=False),
                user_id=recorder.user_id,
            )
        )
        # A new edit invalidates the actions that were undone: they can no
        # longer be redone on top of a different state.
        db.query(ActionLog).filter(ActionLog.is_applied.is_(False)).delete()
        db.commit()
    finally:
        db.close()


def _apply(entries: list[dict[str, Any]], *, undo: bool) -> None:
    """Write the "before" (undo) or "after" (redo) side of each snapshot."""
    ordered = list(reversed(entries)) if undo else entries
    with engine.begin() as conn:
        for entry in ordered:
            model = TRACKED_TABLES.get(entry["table"])
            if model is None:
                continue
            table = model.__table__
            target = entry["before"] if undo else entry["after"]
            other = entry["after"] if undo else entry["before"]
            pk = table.primary_key.columns.values()[0]
            if target is None:
                key = other.get(pk.key)
                conn.execute(table.delete().where(pk == key))
                continue
            values = _decode(table, target)
            key = values.get(pk.key)
            exists = conn.execute(
                table.select().where(pk == key)
            ).first()
            if exists:
                conn.execute(table.update().where(pk == key).values(**values))
            else:
                conn.execute(table.insert().values(**values))


def undo_last(db: Session) -> Optional[ActionLog]:
    action = (
        db.query(ActionLog)
        .filter(ActionLog.is_applied.is_(True))
        .order_by(ActionLog.id.desc())
        .first()
    )
    if action is None:
        return None
    _apply(json.loads(action.entries), undo=True)
    action.is_applied = False
    db.commit()
    return action


def redo_last(db: Session) -> Optional[ActionLog]:
    action = (
        db.query(ActionLog)
        .filter(ActionLog.is_applied.is_(False))
        .order_by(ActionLog.id.asc())
        .first()
    )
    if action is None:
        return None
    _apply(json.loads(action.entries), undo=False)
    action.is_applied = True
    db.commit()
    return action
