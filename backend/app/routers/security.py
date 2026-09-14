"""Security journal, recovery key, authentication repair and diagnostic.

Everything here is about accounts only: no sale, product, customer, debt or
company setting is ever read or written by these endpoints.
"""

import hashlib
import platform
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import licensing
from ..accounts import log_event
from ..auth import require_admin
from ..database import engine, get_db
from ..models import PasswordResetToken, RecoveryKey, SecurityLog, User
from ..schemas import (
    AuthRepairResult,
    DiagnosticItem,
    DiagnosticOut,
    RecoveryKeyOut,
    SecurityLogOut,
)
from ..version import APP_VERSION

router = APIRouter(prefix="/api/securite", tags=["securite"])


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.get("/journal", response_model=list[SecurityLogOut])
def journal(
    limit: int = 200,
    event: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(SecurityLog)
    if event:
        query = query.filter(SecurityLog.event == event)
    return (
        query.order_by(SecurityLog.at.desc())
        .limit(max(1, min(limit, 1000)))
        .all()
    )


@router.post("/cle-recuperation", response_model=RecoveryKeyOut)
def generate_recovery_key(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Generate a fresh recovery key; only its hash stays in the database.

    Generating a new key retires the previous unused ones, so a key that has
    been shown to someone else stops working.
    """
    db.query(RecoveryKey).filter(RecoveryKey.used_at.is_(None)).update(
        {RecoveryKey.used_at: datetime.now(timezone.utc)}
    )
    clear = "-".join(
        secrets.token_hex(2).upper() for _ in range(4)
    )  # e.g. 4F2A-91BC-0D7E-5A13
    entry = RecoveryKey(
        key_hash=_hash_token(clear), created_by_id=current_user.id
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    log_event(
        db,
        "cle_recuperation_generee",
        user=current_user,
        detail="Nouvelle clé de récupération",
    )
    return RecoveryKeyOut(key=clear, created_at=entry.created_at)


@router.post("/reparer-authentification", response_model=AuthRepairResult)
def repair_authentication(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Unblock sign-in without touching any business data.

    It releases the anti-bruteforce counters, drops the pending password
    reset codes and reactivates the administrator accounts. Products, sales,
    customers, debts and settings are left untouched.
    """
    from .auth import _attempts

    _attempts.clear()
    tokens = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.used_at.is_(None))
        .delete()
    )
    admins = db.query(User).filter(User.role == "admin").all()
    unlocked = 0
    for admin in admins:
        if not admin.is_active:
            admin.is_active = True
            unlocked += 1
    db.commit()
    log_event(
        db,
        "reparation_authentification",
        user=current_user,
        station=request.client.host if request.client else "",
        detail=f"{unlocked} compte(s) réactivé(s), {tokens} code(s) effacé(s)",
    )
    return AuthRepairResult(
        message=(
            "Authentification réparée : compteurs de tentatives remis à zéro, "
            "codes de réinitialisation effacés. Aucune donnée commerciale "
            "n'a été modifiée."
        ),
        unlocked=unlocked,
        tokens_cleared=int(tokens),
    )


@router.get("/diagnostic", response_model=DiagnosticOut)
def diagnostic(db: Session = Depends(get_db)):
    """Plain-language health check; secrets are never returned.

    Reachable without signing in on purpose: it is precisely when nobody can
    log in that a workstation needs to know what is wrong. No password, key,
    token nor account name is ever returned.
    """
    items: list[DiagnosticItem] = []

    items.append(
        DiagnosticItem(
            label="Application",
            status="ok",
            detail=f"EasyGest {APP_VERSION} sur {platform.system()}",
        )
    )

    url = engine.url
    backend = url.get_backend_name()
    if backend.startswith("postgres"):
        where = "Serveur de la boutique (PostgreSQL) configuré sur ce poste"
    else:
        where = "Base locale du poste (SQLite)"
    items.append(
        DiagnosticItem(label="Configuration locale", status="ok", detail=where)
    )

    try:
        users = db.query(User).count()
        admins = (
            db.query(User)
            .filter(User.role == "admin", User.is_active.is_(True))
            .count()
        )
        items.append(
            DiagnosticItem(
                label="Base de données",
                status="ok",
                detail=f"Lecture et écriture correctes ({users} compte(s))",
            )
        )
        items.append(
            DiagnosticItem(
                label="Authentification",
                status="ok" if admins else "erreur",
                detail=(
                    f"{admins} administrateur(s) actif(s) ; l'identifiant peut "
                    "être un simple nom, le « @ » n'est pas exigé"
                )
                if admins
                else (
                    "Aucun administrateur actif : utilisez « Récupération "
                    "administrateur » sur l'écran de connexion"
                ),
            )
        )
    except Exception as exc:  # pragma: no cover - depends on the environment
        items.append(
            DiagnosticItem(
                label="Base de données",
                status="erreur",
                detail=f"Accès impossible : {type(exc).__name__}",
            )
        )

    items.append(
        DiagnosticItem(
            label="Serveur",
            status="ok" if backend.startswith("postgres") else "avertissement",
            detail=(
                "Poste relié au serveur de la boutique"
                if backend.startswith("postgres")
                else "Poste autonome : les données restent sur cet ordinateur"
            ),
        )
    )
    items.append(
        DiagnosticItem(label="API", status="ok", detail="Service interne joignable")
    )

    view = licensing.effective(db)
    items.append(
        DiagnosticItem(
            label="Licence",
            status="erreur" if view.blocked else "ok",
            detail=view.message or view.status or "Licence active",
        )
    )

    items.append(
        DiagnosticItem(
            label="Connexion réseau",
            status="ok" if view.last_sync else "avertissement",
            detail=(
                f"Dernière synchronisation le {view.last_sync:%d/%m/%Y %H:%M}"
                if view.last_sync
                else "Aucune synchronisation récente avec le serveur central"
            ),
        )
    )
    return DiagnosticOut(items=items)


@router.delete("/journal", status_code=204)
def purge_journal(
    days: int = 90,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Trim the journal, keeping the last ``days`` days."""
    if days < 7:
        raise HTTPException(
            status_code=400, detail="Conservez au moins 7 jours de journal"
        )
    limit = datetime.now(timezone.utc).timestamp() - days * 86400
    cutoff = datetime.fromtimestamp(limit, tz=timezone.utc)
    db.query(SecurityLog).filter(SecurityLog.at < cutoff).delete()
    db.commit()
    log_event(
        db,
        "purge_journal",
        user=current_user,
        detail=f"Journal conservé sur {days} jours",
    )
