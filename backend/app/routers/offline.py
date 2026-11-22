import json
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from jose import jwt
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.orm import Session

from .. import licensing, printing
from ..auth import create_access_token, get_current_user, require_admin
from ..database import get_db
from ..models import CompanySettings, OfflineCatalogue, OfflineDevice, OfflineEvent, OfflineSession, Product, User
from ..offline_auth import current_account, read_grant, signing_key
from ..offline_crypto import canonical, digest, fingerprint, public_key, verify
from ..offline_ingest import ingest, retry_event
from ..permissions import allowed_keys, has_permission
from ..schemas import UserOut, CustomerOut
from . import cash, products, settings, customers

router = APIRouter(prefix="/api/offline", tags=["offline"])


class CentralDelegationRequest(BaseModel):
    grant: str = Field(max_length=30000)
    signature: str = Field(max_length=4096)


@router.post("/delegation")
def central_delegation(payload: CentralDelegationRequest, db: Session = Depends(get_db)):
    claims = read_grant(db, payload.grant)
    current_account(db, claims)
    device = db.get(OfflineDevice, claims["device_id"])
    try:
        verify(device.public_key, {"grant": payload.grant}, payload.signature)
    except Exception:
        raise HTTPException(403, "Signature de poste invalide") from None
    license_state = licensing.state(db)
    if license_state is None or not license_state.token or not license_state.public_key:
        raise HTTPException(409, "Installation non enregistrée au central : tickets conservés pour l'envoi par le serveur")
    base = (license_state.central_url or licensing.central_url()).rstrip("/")
    address = urlsplit(base)
    if address.scheme != "https" and not (address.scheme == "http" and address.hostname in {"127.0.0.1", "localhost", "::1"}):
        raise HTTPException(403, "La délégation poste vers central nécessite HTTPS")
    try:
        answer = licensing._post(base + "/api/central/public/offline/delegate", {
            "installation_uid": license_state.installation_uid, "token": license_state.token,
            "public_key": public_key(signing_key()), "device_public_key": device.public_key, "grant": payload.grant})
    except licensing.CentralError:
        raise HTTPException(503, "Central indisponible : tickets conservés sans bloquer la caisse") from None
    result = {"url": base, "public_key": license_state.public_key, "token": answer["token"]}
    result["proof"] = jwt.encode({"iss": claims["iss"], "aud": "easygest-offline-delegation", "hash": digest(result)}, signing_key(), algorithm="RS256")
    return result


class SignedProbe(BaseModel):
    device_id: str = Field(max_length=64)
    grant: str = Field(max_length=32768)
    counter: int = Field(gt=0)
    signature: str = Field(max_length=1024)


class EventBatch(BaseModel):
    events: list[dict] = Field(min_length=1, max_length=20)


class Resolution(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)
    regularize: bool = False


@router.get("/identity")
def identity(_: User = Depends(require_admin)):
    public = public_key(signing_key())
    return {"public_key": public, "fingerprint": fingerprint(public), "shop_id": licensing.installation_uid()}


@router.post("/status")
def status(payload: SignedProbe, db: Session = Depends(get_db)):
    device = db.query(OfflineDevice).filter_by(id=payload.device_id).with_for_update().first()
    if device is None:
        raise HTTPException(403, "Poste inconnu")
    proof = payload.model_dump(exclude={"signature"})
    try:
        verify(device.public_key, proof, payload.signature)
    except Exception:
        raise HTTPException(403, "Signature du poste invalide")
    if payload.counter <= device.auth_counter:
        raise HTTPException(409, "Sonde déjà utilisée")
    device.auth_counter = payload.counter
    device.last_seen = datetime.now(timezone.utc)
    db.commit()
    claims = read_grant(db, payload.grant)
    if claims["device_id"] != device.id:
        raise HTTPException(403, "Autorisation d'un autre poste")
    user, rights = current_account(db, claims)
    session = cash.lock_current_session(db, user)
    current = cash._detail(db, session, user).model_dump(mode="json") if session else None
    mappings = db.query(OfflineSession).filter_by(device_id=device.id, user_id=user.id).all()
    covered = [row.id for row in db.query(OfflineEvent).filter_by(device_id=device.id, user_id=user.id, state="applied").all()]
    result = {"access_token": create_access_token(user), "user": UserOut.model_validate(user).model_dump(mode="json"),
              "rights": rights, "server_time": time.time(), "cash_session": current,
              "covered_event_ids": covered, "sessions": [{"id": row.id, "cash_session_id": row.cash_session_id, "status": row.status} for row in mappings]}
    result["proof"] = jwt.encode({"iss": licensing.installation_uid(), "aud": "easygest-offline-status", "counter": payload.counter,
        "hash": digest(result), "iat": int(time.time()), "exp": int(time.time()) + 60}, signing_key(), algorithm="RS256")
    db.commit()
    return result


@router.get("/catalogue")
def catalogue(images: bool = False, device_id: str = "", db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rights = allowed_keys(db, user)
    if not {"caisse", "vente_nouvelle"}.issubset(rights) or not licensing.has_feature(db, "ventes"):
        raise HTTPException(403, "Catalogue hors ligne non autorisé")
    config = settings.get_pos_display(db=db, _=user)
    include_images = bool(images and config.images and config.mode.startswith("image+"))
    query = db.query(Product).options(*products._catalogue_loading()).filter(Product.active.is_(True)).order_by(Product.name)
    all_products = query.all()
    rows = [products._product_out(row, products._stock_allowed(db, user), include_images).model_dump(mode="json", exclude_none=True) for row in all_products]
    covered = [row.id for row in db.query(OfflineEvent).filter_by(device_id=device_id, user_id=user.id, state="applied").all()] if device_id else []
    body = {"user_id": user.id, "products": rows, "company": settings.get_company(db=db, _=user).model_dump(mode="json"), "display": config.model_dump(mode="json"), "covered_event_ids": covered}
    company = db.query(CompanySettings).first()
    body["printing"] = printing.read_config(company).model_dump(mode="json")
    body["categories"] = list({row["category"]["id"]: row["category"] for row in rows if row.get("category")}.values())
    body["customers"] = [CustomerOut.model_validate(row).model_dump(mode="json") for row in customers.list_customers(db=db, _=user)] if has_permission(db, user, "clients") else []
    body["visible_online_ids"] = [row.id for row in all_products if row.quantity > 0 or (company and company.allow_negative_stock_sale)]
    price_fields = {"id", "name", "base_unit", "packaging_unit", "units_per_packaging", "sale_price", "wholesale_price",
                    "semi_wholesale_price", "packaging_sale_price", "wholesale_packaging_price", "semi_packaging_price",
                    "wholesale_min_qty", "semi_wholesale_min_qty", "packagings"}
    price_snapshot = {"user_id": user.id, "products": [{key: value for key, value in row.items() if key in price_fields} for row in rows]}
    snapshot_id = digest(price_snapshot)
    if db.get(OfflineCatalogue, snapshot_id) is None:
        db.add(OfflineCatalogue(id=snapshot_id, user_id=user.id, payload=canonical(price_snapshot).decode()))
        db.commit()
    proof = {"v": 1, "iss": licensing.installation_uid(), "aud": "easygest-offline-catalogue", "sub": str(user.id), "snapshot_id": snapshot_id, "hash": digest(body), "iat": int(time.time())}
    token = jwt.encode(proof, signing_key(), algorithm="RS256", headers={"typ": "easygest-offline-catalogue+jwt"})
    return {"payload": body, "snapshot_id": snapshot_id, "proof": token}


@router.post("/events")
def events(payload: EventBatch, db: Session = Depends(get_db)):
    if len(canonical(payload.model_dump())) > 4_000_000:
        raise HTTPException(413, "Lot hors ligne trop volumineux")
    results = [ingest(db, envelope) for envelope in payload.events]
    proof = jwt.encode({"iss": licensing.installation_uid(), "aud": "easygest-offline-ack", "hash": digest(results),
        "iat": int(time.time())}, signing_key(), algorithm="RS256")
    return {"results": results, "proof": proof}


@router.get("/events")
def list_events(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = db.query(OfflineEvent)
    if user.role != "admin":
        query = query.filter_by(user_id=user.id)
    return [{"id": row.id, "user_id": row.user_id, "session_id": row.session_id, "kind": row.kind, "state": row.state,
             "occurred_at": row.occurred_at, "result": json.loads(row.result), "resolution": json.loads(row.resolution) if row.resolution else None}
            for row in query.order_by(OfflineEvent.received_at.desc()).limit(200).all()]


@router.post("/events/{event_id}/resolve")
def resolve(event_id: str, payload: Resolution, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return retry_event(db, event_id, user, payload.reason, payload.regularize)
