"""Undo / redo endpoints for the administrator."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..database import get_db
from ..history import redo_last, undo_last
from ..models import ActionLog, User
from ..schemas import ActionLogOut, HistoryState

router = APIRouter(prefix="/api/history", tags=["history"])


def _state(db: Session) -> HistoryState:
    undoable = (
        db.query(ActionLog)
        .filter(ActionLog.is_applied.is_(True))
        .order_by(ActionLog.id.desc())
        .first()
    )
    redoable = (
        db.query(ActionLog)
        .filter(ActionLog.is_applied.is_(False))
        .order_by(ActionLog.id.asc())
        .first()
    )
    return HistoryState(
        undo=ActionLogOut.model_validate(undoable) if undoable else None,
        redo=ActionLogOut.model_validate(redoable) if redoable else None,
    )


@router.get("", response_model=HistoryState)
def history_state(
    db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    return _state(db)


@router.post("/undo", response_model=HistoryState)
def undo(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if undo_last(db) is None:
        raise HTTPException(status_code=400, detail="Aucune action à annuler")
    return _state(db)


@router.post("/redo", response_model=HistoryState)
def redo(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if redo_last(db) is None:
        raise HTTPException(status_code=400, detail="Aucune action à rétablir")
    return _state(db)
