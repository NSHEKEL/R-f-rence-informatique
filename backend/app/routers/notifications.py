import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Notification, User
from ..schemas import NotificationOut

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# Kinds produced across routers (sales, stock, cash, bank, ...). The admin
# chooses per user which kinds each one receives (Users page). Only the shop
# administrator sees everything by default; a seller, stock manager or any
# other employee only receives the kinds explicitly granted to them — an
# empty ``notification_kinds`` on a non-admin means *no* notification at all,
# and the filter is enforced here, on the server, not just by hiding a menu.
NOTIFICATION_KINDS: dict[str, str] = {
    "vente": "Ventes et commandes",
    "stock": "Stock faible ou rupture",
    "caisse": "Caisse (ouverture, clôture, Z)",
    "banque": "Versements bancaires",
    "livraison": "Livraisons",
    "inventaire": "Inventaires",
    "approvisionnement": "Achats fournisseurs",
    "retour": "Retours et avoirs",
    "creance": "Créances clients",
    "ajustement": "Ajustements de stock",
    "licence": "Licence et abonnement",
    "systeme": "Système",
}


def _allowed_kinds(user: User) -> list[str]:
    if user.role == "admin":
        return list(NOTIFICATION_KINDS)
    if not (user.notification_kinds or "").strip():
        return []
    return [k for k in user.notification_kinds.split(",") if k in NOTIFICATION_KINDS]


def _read_ids(notification: Notification) -> set[int]:
    try:
        return {int(v) for v in json.loads(notification.read_by or "[]")}
    except (ValueError, TypeError):
        return set()


def _serialize(notification: Notification, user: User) -> Notification:
    """Per-user read state: ``read_by`` holds the ids of readers."""
    read = user.id in _read_ids(notification)
    notification.is_read = read
    return notification


def _visible(db: Session, user: User):
    kinds = _allowed_kinds(user)
    if not kinds:
        return db.query(Notification).filter(Notification.id == -1)
    return db.query(Notification).filter(Notification.kind.in_(kinds))


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = (
        _visible(db, current_user)
        .order_by(Notification.created_at.desc())
        .limit(200 if unread_only else limit)
        .all()
    )
    serialized = [_serialize(n, current_user) for n in items]
    if unread_only:
        serialized = [n for n in serialized if not n.is_read][:limit]
    return serialized


@router.get("/kinds")
def notification_kinds(_: User = Depends(get_current_user)):
    return NOTIFICATION_KINDS


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    items = _visible(db, current_user).all()
    count = sum(1 for n in items if current_user.id not in _read_ids(n))
    return {"count": count}


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = (
        _visible(db, current_user).filter(Notification.id == notification_id).first()
    )
    if not notification:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    readers = _read_ids(notification)
    readers.add(current_user.id)
    notification.read_by = json.dumps(sorted(readers))
    # Legacy flag kept for older clients: all admins read it -> global read.
    admins = db.query(User).filter(User.role == "admin", User.is_active.is_(True)).all()
    if admins and all(a.id in readers for a in admins):
        notification.is_read = True
    db.commit()
    db.refresh(notification)
    return _serialize(notification, current_user)


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    for notification in _visible(db, current_user).all():
        readers = _read_ids(notification)
        if current_user.id not in readers:
            readers.add(current_user.id)
            notification.read_by = json.dumps(sorted(readers))
    db.commit()
    return {"status": "ok"}
