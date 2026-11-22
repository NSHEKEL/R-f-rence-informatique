import json
import math
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from cryptography.exceptions import InvalidSignature
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from ..offline_auth import AUDIENCE
from ..offline_crypto import canonical, digest, fingerprint, verify
from .models import Installation, MirrorSale, OfflineDelegation
from .security import license_private_key, license_public_key

AUD = "easygest-central-offline-upload"
ISS = "easygest-central-offline"


class DelegateRequest(BaseModel):
    installation_uid: str = Field(max_length=200)
    token: str = Field(max_length=1000)
    public_key: str = Field(max_length=4096)
    device_public_key: str = Field(max_length=4096)
    grant: str = Field(max_length=30000)


class UploadRequest(BaseModel):
    token: str = Field(max_length=10000)
    events: list[dict] = Field(default_factory=list, max_length=30)


def delegate(db, payload):
    installation = db.query(Installation).filter_by(uid=payload.installation_uid).with_for_update().first()
    if installation is None or not payload.token or not secrets.compare_digest(installation.token, payload.token):
        raise HTTPException(401, "Installation non autorisée")
    try:
        fingerprint(payload.public_key)
        if installation.offline_public_key and installation.offline_public_key != payload.public_key:
            raise ValueError("La clé boutique a changé")
        claims = jwt.decode(payload.grant, payload.public_key, algorithms=["RS256"], audience=AUDIENCE, issuer=installation.uid)
        if (claims["cnf"] != fingerprint(payload.device_public_key) or not {"caisse", "vente_nouvelle"}.issubset(claims["permissions"])
                or not 0 < claims["exp"] - claims["auth_at"] <= 8760 * 3600):
            raise ValueError("Délégation incompatible")
        uuid.UUID(claims["device_id"])
        uuid.UUID(claims["jti"])
    except (JWTError, ValueError, KeyError, TypeError):
        raise HTTPException(403, "Autorisation poste invalide") from None
    existing = db.get(OfflineDelegation, claims["jti"])
    if existing and (existing.grant != payload.grant or existing.public_key != payload.device_public_key or not existing.active):
        raise HTTPException(409, "Délégation modifiée ou révoquée")
    if existing is None:
        db.add(OfflineDelegation(id=claims["jti"], installation_uid=installation.uid, device_id=claims["device_id"],
            public_key=payload.device_public_key, grant=payload.grant, seller_email=claims["user"]["email"].strip().lower(),
            expires_at=datetime.fromtimestamp(claims["exp"], timezone.utc).replace(tzinfo=None)))
    installation.offline_public_key = payload.public_key
    db.commit()
    token = jwt.encode({"iss": ISS, "aud": AUD, "sub": claims["jti"], "device_id": claims["device_id"],
        "iat": int(datetime.now(timezone.utc).timestamp()), "exp": claims["exp"], "scope": "append-provisional-sales"}, license_private_key(), algorithm="RS256")
    return {"token": token}


def upload(db, payload):
    if len(canonical(payload.model_dump())) > 3_000_000:
        raise HTTPException(413, "Lot de tickets trop volumineux")
    try:
        claims = jwt.decode(payload.token, license_public_key(), algorithms=["RS256"], audience=AUD, issuer=ISS, options={"verify_exp": False})
        delegation = db.get(OfflineDelegation, claims["sub"])
        if delegation is None or not delegation.active or delegation.device_id != claims["device_id"] or claims["scope"] != "append-provisional-sales":
            raise ValueError("Délégation inconnue")
        installation = db.query(Installation).filter_by(uid=delegation.installation_uid).with_for_update().one()
        grant = jwt.decode(delegation.grant, installation.offline_public_key, algorithms=["RS256"], audience=AUDIENCE,
            issuer=installation.uid, options={"verify_exp": False})
        accepted = []
        for envelope in payload.events:
            event = envelope["event"]
            verify(delegation.public_key, event, envelope["signature"])
            uuid.UUID(event["id"])
            if (event["kind"] != "sale" or event["grant"] != delegation.grant or event["device_id"] != delegation.device_id
                    or event["scope"] != installation.uid or str(event["user_id"]) != grant["sub"]
                    or not grant["auth_at"] - 60 <= float(event["occurred_at"]) <= grant["exp"]
                    or event["occurred_at"] > datetime.now(timezone.utc).timestamp() + 120):
                raise ValueError("Origine du ticket invalide")
            receipt = event["payload"]["snapshot"]
            sale = event["payload"]["sale"]
            total = float(receipt["total"])
            if sale.get("client_id") != event["id"] or not math.isfinite(total) or total < 0 or not sale.get("items"):
                raise ValueError("Ticket invalide")
            row = db.query(MirrorSale).filter_by(client_id=installation.client_id, installation_uid=installation.uid, operation_id=event["id"]).first()
            original = canonical(envelope).decode()
            if row and row.offline_original and row.offline_original != original:
                raise HTTPException(409, "UUID reçu avec un autre contenu ; original conservé")
            if row is None:
                row = MirrorSale(client_id=installation.client_id, installation_uid=installation.uid, operation_id=event["id"],
                    reference="HL-" + event["id"], date=datetime.fromtimestamp(event["occurred_at"], timezone.utc).replace(tzinfo=None),
                    total=total, status="Payée", payment_method=sale.get("payment_method") or "",
                    seller=grant["user"]["name"], seller_email=delegation.seller_email, customer=str(receipt.get("customer_name") or ""),
                    items=json.dumps(receipt.get("items") or [], ensure_ascii=False), provisional=True)
                db.add(row)
            if not row.offline_original:
                row.offline_original = original
            accepted.append({"id": event["id"], "hash": digest(event)})
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except (JWTError, ValueError, KeyError, TypeError, InvalidSignature):
        db.rollback()
        raise HTTPException(403, "Tickets hors ligne non authentifiés") from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Copie concurrente : renvoyez les mêmes identifiants") from None
    proof = jwt.encode({"iss": ISS, "aud": "easygest-central-offline-ack", "hash": digest(accepted),
        "iat": int(datetime.now(timezone.utc).timestamp())}, license_private_key(), algorithm="RS256")
    return {"accepted": accepted, "proof": proof}
