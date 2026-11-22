import ipaddress
import secrets
import sys
import threading

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from ..offline_broker import BrokerError, OfflineBroker
from ..offline_crypto import canonical

router = APIRouter(prefix="/api/local-offline", tags=["local-offline"])
NONCE = secrets.token_urlsafe(32)
_broker = None
_lock = threading.Lock()


def local_only(request):
    try:
        local = ipaddress.ip_address(request.client.host).is_loopback
    except (ValueError, AttributeError):
        local = False
    if (not local or request.url.hostname not in {"localhost", "127.0.0.1", "::1"}
            or request.headers.get("origin") != str(request.base_url).rstrip("/")):
        raise HTTPException(403, "Journal accessible uniquement depuis la fenêtre locale EasyGest")


def broker():
    global _broker
    with _lock:
        if _broker is None:
            _broker = OfflineBroker()

            def worker():
                while True:
                    try:
                        _broker.sync()
                    except Exception:
                        pass
                    threading.Event().wait(10)

            threading.Thread(target=worker, name="offline-sync", daemon=True).start()
        return _broker


class Command(BaseModel):
    action: str = Field(max_length=30)
    params: dict = Field(default_factory=dict)


@router.post("/bootstrap")
def bootstrap(request: Request):
    local_only(request)
    if sys.platform != "win32":
        return {"supported": False}
    try:
        return {"supported": True, "nonce": NONCE, **broker().bootstrap()}
    except (OSError, RuntimeError) as error:
        raise HTTPException(507, "Journal durable indisponible : vérifiez l'espace disque et le profil Windows") from error


@router.post("/command")
def command(payload: Command, request: Request, x_easygest_offline: str = Header(default="")):
    local_only(request)
    if not secrets.compare_digest(x_easygest_offline, NONCE):
        raise HTTPException(403, "Session locale invalide")
    actions = {"login", "logout", "state", "sync", "catalogue", "remember", "request", "sale", "account", "resume", "import_legacy"}
    if payload.action not in actions:
        raise HTTPException(400, "Commande locale inconnue")
    if len(canonical(payload.params)) > 24_000_000:
        raise HTTPException(413, "Commande trop volumineuse")
    try:
        return getattr(broker(), payload.action)(**payload.params)
    except BrokerError as error:
        raise HTTPException(error.status, error.message) from None
    except (ValueError, TypeError, KeyError, ValidationError):
        raise HTTPException(422, "Opération locale invalide ; aucune vente validée sans écriture durable") from None
    except OSError:
        raise HTTPException(507, "Écriture du journal impossible : vente non validée, ne fermez pas le panier") from None
