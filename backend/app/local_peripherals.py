from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .auth import ALGORITHM, SECRET_KEY, get_current_user
from .database import get_db
from .permissions import has_permission

optional_token = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def _local_source(request: Request) -> bool:
    if not request.client or request.client.host not in {"127.0.0.1", "::1"}:
        return False
    if request.headers.get("sec-fetch-site") == "cross-site":
        return False
    sources = [request.headers[name] for name in ("origin", "referer") if name in request.headers]
    if not sources:
        return not any(name in request.headers for name in ("sec-fetch-site", "sec-fetch-mode"))
    for source in sources:
        try:
            parsed = urlsplit(source)
        except ValueError:
            return False
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in LOOPBACK or parsed.netloc != request.url.netloc:
            return False
    return True


def local_peripheral_permission(*keys: str):
    """Read-only printer discovery, with normal rights for known identities."""
    def guard(request: Request, token: str | None = Depends(optional_token), db: Session = Depends(get_db)):
        if token:
            try:
                user = get_current_user(token=token, db=db)
            except HTTPException as exc:
                if exc.status_code != 401:
                    raise
                try:
                    jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_exp": False})
                except JWTError:
                    pass
                else:
                    raise exc
            else:
                if not any(has_permission(db, user, key) for key in keys):
                    raise HTTPException(status_code=403, detail="Accès refusé")
                return user
        if request.method == "GET" and request.url.path in {"/api/settings/printers", "/api/settings/printers/diagnose"} and _local_source(request):
            return None
        raise HTTPException(status_code=401, detail="Service périphérique local : authentification locale requise ou accès depuis la fenêtre EasyGest de ce poste.")
    return guard
