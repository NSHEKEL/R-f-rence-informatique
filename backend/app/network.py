"""IP-based shop workstation approval, independent of user authentication."""

import ipaddress
import socket
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import require_admin
from .database import SessionLocal, get_db
from .models import CompanySettings, User, Workstation
from .version import APP_VERSION

LOCK = threading.RLock()
MESSAGE = "Poste non autorisé. Demandez à l'administrateur de l'autoriser depuis Configuration → Réseau sur l'ordinateur principal."


def address(value):
    try:
        parsed = ipaddress.ip_address(value)
        return getattr(parsed, "ipv4_mapped", None) or parsed
    except ValueError:
        return None


def observe(ip, user_id=None, user_agent="", hostname=""):
    parsed = address(ip)
    normalized = str(parsed) if parsed else ip
    with LOCK, SessionLocal() as db:
        settings = db.query(CompanySettings).first()
        restricted = bool(settings and settings.network_restrict_workstations)
        if parsed and parsed.is_loopback:
            return restricted, "approved"
        if not parsed:
            return restricted, "pending"
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        poste = db.query(Workstation).filter_by(ip=normalized).first()
        if poste is None:
            poste = Workstation(ip=normalized, status="pending", first_seen=now, last_seen=now)
            db.add(poste)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                poste = db.query(Workstation).filter_by(ip=normalized).one()
        user = db.get(User, user_id) if user_id else None
        name = user.name if user else poste.last_user
        if poste.last_seen is None or now - poste.last_seen >= timedelta(seconds=30) or name != poste.last_user or not poste.user_agent:
            poste.last_seen = now
            poste.last_user = name
            poste.user_agent = user_agent[:512]
            poste.hostname = hostname[:255]
        status = poste.status
        db.commit()
        return restricted, status


def lan_ips():
    try:
        values = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        return sorted({entry[4][0] for entry in values if not ipaddress.ip_address(entry[4][0]).is_loopback})
    except OSError:
        return []


def identity(db, port):
    settings = db.query(CompanySettings).first()
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=10)
    return {"role": "principal", "owns_database": True, "lan_ips": lan_ips(), "port": port,
            "hostname": socket.gethostname(), "version": APP_VERSION,
            "connected_count": db.query(Workstation).filter(Workstation.last_seen >= since).count(),
            "network_restrict_workstations": bool(settings and settings.network_restrict_workstations)}


class WorkstationChange(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, pattern="^(pending|approved|blocked)$")


router = APIRouter(prefix="/api/network/workstations", tags=["network"])


@router.get("")
def listing(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return [{"id": p.id, "ip": p.ip, "name": p.name, "hostname": p.hostname,
             "user_agent": p.user_agent, "status": p.status, "last_user": p.last_user,
             "first_seen": p.first_seen.replace(tzinfo=timezone.utc), "last_seen": p.last_seen.replace(tzinfo=timezone.utc),
             "active": now - p.last_seen <= timedelta(minutes=10)}
            for p in db.query(Workstation).order_by(Workstation.last_seen.desc()).all()]


@router.patch("/{identifier}")
def change(identifier: int, payload: WorkstationChange, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    with LOCK:
        poste = db.get(Workstation, identifier)
        if poste is None:
            raise HTTPException(status_code=404, detail="Poste introuvable")
        if payload.name is not None:
            poste.name = payload.name.strip()
        if payload.status is not None:
            poste.status = payload.status
        db.commit()
    return {"detail": "Poste mis à jour."}


@router.delete("/{identifier}")
def delete(identifier: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    with LOCK:
        poste = db.get(Workstation, identifier)
        if poste is None:
            raise HTTPException(status_code=404, detail="Poste introuvable")
        db.delete(poste)
        db.commit()
    return {"detail": "Poste supprimé. Sa prochaine visite créera une nouvelle demande."}
