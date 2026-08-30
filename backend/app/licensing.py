"""Licence of this installation: registration, synchronisation, enforcement.

The shop never decides what it is allowed to do. It replays a statement signed
by the central server with a key it does not hold, so changing the local
database, the files or the frontend cannot turn Business into Entreprise.

When no central server is configured (``EASYGEST_CENTRAL_URL`` empty and no
registration yet) the software keeps working exactly as before, in local mode:
that is what every existing shop runs today.
"""

import json
import os
import socket
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .auth import get_current_user
from .database import get_db
from .features import FEATURE_CODES, FEATURE_LABELS
from .models import LicenseState, User
from .paths import data_dir
from .version import APP_VERSION

LICENSE_ALGORITHM = "RS256"
UID_FILE = "installation.uid"
HTTP_TIMEOUT = 15

# Modes the rest of the application reacts to.
MODE_LOCAL = "local"  # no central server: historical behaviour
MODE_ACTIVE = "active"
MODE_GRACE = "grace"  # expired, still inside the grace period
MODE_EXPIRED = "expired"
MODE_SUSPENDED = "suspended"
MODE_REVOKED = "revoked"
MODE_STALE = "stale"  # offline for longer than allowed

BLOCKING_MODES = {MODE_EXPIRED, MODE_SUSPENDED, MODE_REVOKED, MODE_STALE}

MESSAGES = {
    MODE_SUSPENDED: (
        "Votre licence EasyGest est actuellement suspendue. "
        "Veuillez contacter l'administrateur."
    ),
    MODE_EXPIRED: (
        "Votre licence EasyGest a expiré. Vos données restent intactes ; "
        "contactez l'administrateur pour la renouveler."
    ),
    MODE_REVOKED: (
        "Cette installation d'EasyGest a été révoquée. "
        "Veuillez contacter l'administrateur."
    ),
    MODE_STALE: (
        "EasyGest n'a pas pu vérifier votre licence depuis trop longtemps. "
        "Connectez ce poste à Internet pour continuer."
    ),
}


def central_url() -> str:
    """Address of the central server, empty when the shop runs on its own."""
    return os.getenv("EASYGEST_CENTRAL_URL", "").strip().rstrip("/")


def installation_uid() -> str:
    """Identifier of this computer, kept beside the database."""
    path = data_dir() / UID_FILE
    if path.exists():
        existing = path.read_text(encoding="utf-8").strip()
        if len(existing) >= 16:
            return existing
    generated = uuid.uuid4().hex
    path.write_text(generated, encoding="utf-8")
    return generated


def _aware(moment: Optional[datetime]) -> Optional[datetime]:
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _parse(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return _aware(datetime.fromisoformat(value))
    except ValueError:
        return None


@dataclass
class LicenseView:
    """What the application (and the client's own screen) needs to know."""

    mode: str
    plan_code: str = ""
    plan_name: str = ""
    status: str = ""
    message: str = ""
    features: set[str] = field(default_factory=set)
    client_name: str = ""
    license_key: str = ""
    ends_at: Optional[datetime] = None
    days_left: Optional[int] = None
    grace_days: int = 0
    last_sync: Optional[datetime] = None
    last_error: str = ""
    central_url: str = ""
    installation_uid: str = ""

    @property
    def blocked(self) -> bool:
        return self.mode in BLOCKING_MODES

    def allows(self, code: str) -> bool:
        if self.mode == MODE_LOCAL:
            return True
        if self.blocked:
            return False
        return code in self.features


def state(db: Session) -> Optional[LicenseState]:
    return db.query(LicenseState).order_by(LicenseState.id).first()


def _verified_payload(row: LicenseState) -> Optional[dict]:
    """Read the signed licence; None when it was tampered with."""
    if not row.license_token or not row.public_key:
        return None
    try:
        return jwt.decode(
            row.license_token,
            row.public_key,
            algorithms=[LICENSE_ALGORITHM],
            options={"verify_aud": False, "verify_exp": False},
        )
    except JWTError:
        return None


def current(db: Session) -> LicenseView:
    """Effective licence, signature and dates included."""
    row = state(db)
    if row is None or not row.license_token:
        if central_url():
            return LicenseView(
                mode=MODE_EXPIRED if row else MODE_LOCAL,
                message="Cette installation n'est pas encore enregistrée."
                if row is None
                else MESSAGES[MODE_EXPIRED],
                central_url=central_url(),
                installation_uid=installation_uid(),
            )
        return LicenseView(
            mode=MODE_LOCAL,
            plan_name="Mode local",
            features=set(FEATURE_CODES),
            installation_uid=installation_uid(),
        )

    payload = _verified_payload(row)
    if payload is None:
        return LicenseView(
            mode=MODE_REVOKED,
            message=(
                "La licence enregistrée sur ce poste est illisible ou a été "
                "modifiée. Synchronisez à nouveau avec le serveur central."
            ),
            central_url=row.central_url or central_url(),
            installation_uid=row.installation_uid,
        )

    now = datetime.now(timezone.utc)
    status = str(payload.get("status", ""))
    ends_at = _parse(payload.get("ends_at"))
    grace_days = int(payload.get("grace_days", 0) or 0)
    offline_days = int(payload.get("offline_days", 7) or 7)
    features = {
        code for code in payload.get("features", []) if isinstance(code, str)
    }
    last_sync = _aware(row.last_sync)

    if status == "revoked":
        mode = MODE_REVOKED
    elif status == "suspended":
        mode = MODE_SUSPENDED
    elif ends_at is not None and ends_at < now:
        mode = MODE_GRACE if now <= ends_at + timedelta(days=grace_days) else MODE_EXPIRED
    elif status == "expired":
        mode = MODE_EXPIRED
    else:
        mode = MODE_ACTIVE

    # A shop that stops talking to the server cannot keep its rights forever.
    if mode in (MODE_ACTIVE, MODE_GRACE) and last_sync is not None:
        if now - last_sync > timedelta(days=offline_days):
            mode = MODE_STALE

    view = LicenseView(
        mode=mode,
        plan_code=str(payload.get("plan_code", "")),
        plan_name=str(payload.get("plan_name", "")),
        status=status,
        message=MESSAGES.get(mode, ""),
        features=features,
        client_name=str(payload.get("client", "")),
        license_key=str(payload.get("license_key", "")),
        ends_at=ends_at,
        days_left=(ends_at - now).days if ends_at else None,
        grace_days=grace_days,
        last_sync=last_sync,
        last_error=row.last_error or "",
        central_url=row.central_url or central_url(),
        installation_uid=row.installation_uid or installation_uid(),
    )
    if mode == MODE_GRACE:
        view.message = (
            "Votre licence EasyGest a expiré. Période de grâce en cours "
            f"({grace_days} jours) : pensez à la renouveler."
        )
    return view


# ------------------------------------------------------------- server calls


class CentralError(RuntimeError):
    """The central server refused the call or could not be reached."""


def _post(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as answer:
            return json.loads(answer.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("detail", "")
        except (ValueError, OSError):
            pass
        raise CentralError(detail or f"Serveur central : erreur {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise CentralError(f"Serveur central injoignable : {exc}") from exc


def _get(url: str) -> object:
    try:
        with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT) as answer:
            return json.loads(answer.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise CentralError(f"Serveur central : erreur {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise CentralError(f"Serveur central injoignable : {exc}") from exc


def offered_plans(url: str) -> list[dict]:
    """Formulas the owner offers on "Choisissez votre formule"."""
    plans = _get(f"{url.rstrip('/')}/api/central/public/plans")
    return plans if isinstance(plans, list) else []


def _store(
    db: Session,
    *,
    url: str,
    answer: dict,
    token: Optional[str] = None,
    public_key: Optional[str] = None,
) -> LicenseView:
    row = state(db)
    if row is None:
        row = LicenseState(installation_uid=installation_uid())
        db.add(row)
    row.central_url = url
    if token:
        row.token = token
    if public_key:
        row.public_key = public_key
    row.license_token = answer.get("license", "")
    row.last_sync = datetime.now(timezone.utc)
    row.last_error = ""
    payload = _verified_payload(row)
    if payload is None:
        db.rollback()
        raise CentralError(
            "Licence refusée : la signature du serveur central est invalide."
        )
    if payload.get("installation") != row.installation_uid:
        db.rollback()
        raise CentralError("Licence refusée : elle vise une autre installation.")
    row.client_name = str(payload.get("client", ""))
    row.license_key = str(payload.get("license_key", ""))
    row.plan_code = str(payload.get("plan_code", ""))
    row.plan_name = str(payload.get("plan_name", ""))
    row.status = str(payload.get("status", ""))
    row.features = ",".join(sorted(str(c) for c in payload.get("features", [])))
    row.starts_at = _parse(payload.get("starts_at"))
    row.ends_at = _parse(payload.get("ends_at"))
    row.grace_days = int(payload.get("grace_days", 0) or 0)
    row.offline_days = int(payload.get("offline_days", 7) or 7)
    db.commit()
    return current(db)


def register(
    db: Session,
    *,
    url: str,
    plan_code: str,
    company: str,
    manager: str = "",
    phone: str = "",
    email: str = "",
    address: str = "",
    city: str = "",
    users_count: int = 1,
) -> LicenseView:
    """First configuration: create the client and receive its licence."""
    base = url.strip().rstrip("/")
    if not base:
        raise CentralError("Adresse du serveur central manquante")
    answer = _post(
        f"{base}/api/central/public/register",
        {
            "company": company,
            "manager": manager,
            "phone": phone,
            "email": email,
            "address": address,
            "city": city,
            "plan_code": plan_code,
            "installation_uid": installation_uid(),
            "hostname": socket.gethostname(),
            "version": APP_VERSION,
            "users_count": users_count,
        },
    )
    return _store(
        db,
        url=base,
        answer=answer,
        token=answer.get("token", ""),
        public_key=answer.get("public_key", ""),
    )


def synchronise(db: Session, quiet: bool = False) -> LicenseView:
    """Ask the central server what this installation may do."""
    row = state(db)
    if row is None or not row.token:
        if quiet:
            return current(db)
        raise CentralError("Cette installation n'est pas enregistrée.")
    base = (row.central_url or central_url()).rstrip("/")
    if not base:
        if quiet:
            return current(db)
        raise CentralError("Adresse du serveur central manquante")
    users_count = db.query(User).filter(User.is_active.is_(True)).count()
    try:
        answer = _post(
            f"{base}/api/central/public/sync",
            {
                "installation_uid": row.installation_uid,
                "token": row.token,
                "version": APP_VERSION,
                "users_count": users_count,
            },
        )
    except CentralError as exc:
        # A short outage must not stop the shop: keep the signed copy.
        row.last_error = str(exc)
        db.commit()
        if quiet:
            return current(db)
        raise
    return _store(db, url=base, answer=answer)


# -------------------------------------------------------------- enforcement


def has_feature(db: Session, code: str) -> bool:
    return current(db).allows(code)


def require_feature(code: str, even_when_blocked: bool = False):
    """Dependency refusing an endpoint the client's plan does not include.

    ``even_when_blocked`` keeps a module usable with a suspended or expired
    licence — backups stay available so a shop never loses its data.
    """

    def guard(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        view = current(db)
        if view.blocked and not even_when_blocked:
            raise HTTPException(status_code=403, detail=view.message)
        if not (view.allows(code) or (view.blocked and even_when_blocked)):
            label = FEATURE_LABELS.get(code, code)
            raise HTTPException(
                status_code=403,
                detail=(
                    f"🔒 {label} n'est pas incluse dans votre formule "
                    f"{view.plan_name or ''}".strip()
                ),
            )
        return current_user

    return guard
