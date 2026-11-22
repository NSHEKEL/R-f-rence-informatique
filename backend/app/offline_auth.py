import hashlib
import json
import time
import uuid

from fastapi import HTTPException
from jose import JWTError, jwt

from .auth import create_access_token
from .licensing import has_feature, installation_uid
from .models import CompanySettings, OfflineDevice, OfflineGrant, User, Workstation
from .offline_crypto import fingerprint, persistent_secret, private_key, public_key
from .paths import data_dir
from .permissions import allowed_keys
from .schemas import UserOut
from . import licensing

AUDIENCE = "easygest-offline-poste"
TOKEN_TYPE = "easygest-offline-grant+jwt"


def signing_key():
    return persistent_secret(data_dir() / "offline-server" / "signing.key", private_key).decode()


def password_version(user):
    return hashlib.sha256(user.hashed_password.encode()).hexdigest()


def issue(db, user, device_id, device_public_key, approved, workstation_ip="", nonce=None):
    settings = db.query(CompanySettings).first()
    rights = allowed_keys(db, user)
    if not device_id or not device_public_key or not approved or (settings and not settings.offline_enabled):
        return {}
    if not {"caisse", "vente_nouvelle"}.issubset(rights) or not all(has_feature(db, code) for code in ("ventes", "versements")):
        return {}
    try:
        uuid.UUID(device_id)
        key_hash = fingerprint(device_public_key)
    except (ValueError, TypeError):
        raise HTTPException(400, "Identité hors ligne du poste invalide")
    device = db.get(OfflineDevice, device_id)
    if device and (device.public_key != device_public_key or not device.active):
        raise HTTPException(403, "Poste hors ligne révoqué ou clé modifiée")
    if device is None:
        db.add(OfflineDevice(id=device_id, public_key=device_public_key, workstation_ip=workstation_ip))
    now = int(time.time())
    claims = {"v": 1, "jti": str(uuid.uuid4()), "iss": installation_uid(), "aud": AUDIENCE,
              "sub": str(user.id), "device_id": device_id, "cnf": key_hash,
              "auth_at": now, "iat": now, "nbf": now, "exp": now + (settings.offline_authorization_hours if settings else 24) * 3600,
              "permissions": rights, "pwv": password_version(user), "user": {**UserOut.model_validate(user).model_dump(mode="json"), "photo": ""},
              "features": sorted(licensing.effective(db).features), "login_nonce": nonce,
              "mobile_money_to_cash": settings.mobile_money_to_cash if settings else True}
    private = signing_key()
    public = public_key(private)
    token = jwt.encode(claims, private, algorithm="RS256", headers={"typ": TOKEN_TYPE, "kid": fingerprint(public)})
    db.add(OfflineGrant(id=claims["jti"], device_id=device_id, user_id=user.id, token=token, claims=json.dumps(claims)))
    db.commit()
    return {"offline_grant": token, "offline_public_key": public, "server_time": now}


def read_grant(db, token, *, expired=False):
    try:
        public = public_key(signing_key())
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256" or header.get("typ") != TOKEN_TYPE or header.get("kid") != fingerprint(public):
            raise ValueError("En-tête invalide")
        claims = jwt.decode(token, public, algorithms=["RS256"], audience=AUDIENCE, issuer=installation_uid(), options={"verify_exp": not expired})
        stored = db.get(OfflineGrant, claims["jti"])
        if stored is None or stored.token != token or stored.device_id != claims["device_id"]:
            raise ValueError("Autorisation inconnue")
        return claims
    except (JWTError, KeyError, ValueError, TypeError):
        raise HTTPException(401, "Autorisation hors ligne invalide ou expirée")


def current_account(db, claims):
    user = db.get(User, int(claims["sub"]))
    device = db.get(OfflineDevice, claims["device_id"])
    settings = db.query(CompanySettings).first()
    if device is None or not device.active or fingerprint(device.public_key) != claims["cnf"]:
        raise HTTPException(403, "Poste hors ligne révoqué")
    workstation = db.query(Workstation).filter_by(ip=device.workstation_ip).first() if device.workstation_ip else None
    if workstation and workstation.status == "blocked":
        raise HTTPException(403, "Poste réseau désactivé")
    if licensing.effective(db).blocked:
        raise HTTPException(403, "Licence inactive : opérations conservées pour validation")
    if not user or not user.is_active or claims["pwv"] != password_version(user):
        raise HTTPException(403, "Compte désactivé ou authentification révoquée")
    if settings and (not settings.offline_enabled or time.time() > claims["auth_at"] + settings.offline_authorization_hours * 3600):
        raise HTTPException(403, "Autorisation hors ligne désactivée ou réduite")
    rights = allowed_keys(db, user)
    if not {"caisse", "vente_nouvelle"}.issubset(rights) or not all(has_feature(db, code) for code in ("ventes", "versements")):
        raise HTTPException(403, "Droits de vente ou licence retirés")
    return user, rights
