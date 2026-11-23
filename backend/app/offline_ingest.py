import json
import math
import threading
import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from . import licensing, remote_sales
from .models import CashClosure, CashMovement, CashSession, OfflineCatalogue, OfflineDevice, OfflineEvent, OfflineSession, Sale, SecurityLog, User
from .offline_auth import current_account, read_grant
from .offline_crypto import canonical, digest, fingerprint, verify
from .permissions import has_permission
from .schemas import CashMovementCreate, CashSessionClose, CashSessionOpen, ExpenseCreate, SaleCreate

LOCK = threading.RLock()


def _ack(row):
    return {"id": row.id, "hash": row.hash, "state": row.state, **json.loads(row.result)}


def _validate(db, envelope):
    try:
        event = envelope["event"]
        uuid.UUID(event["id"])
        uuid.UUID(event["session_id"])
        if event["v"] != 1 or not isinstance(event["sequence"], int) or isinstance(event["sequence"], bool) or not 1 <= event["sequence"] <= 2147483647:
            raise ValueError("Séquence invalide")
        device = db.get(OfflineDevice, event["device_id"])
        if device is None:
            raise ValueError("Poste inconnu")
        verify(device.public_key, event, envelope["signature"])
        claims = read_grant(db, event["grant"], expired=True)
        occurred = float(event["occurred_at"])
        if (claims["device_id"] != device.id or claims["cnf"] != fingerprint(device.public_key)
                or str(event["user_id"]) != claims["sub"] or event["scope"] != claims["iss"]
                or not math.isfinite(occurred) or not claims["auth_at"] - 60 <= occurred <= claims["exp"]
                or occurred > time.time() + 120):
            raise ValueError("Origine ou date hors autorisation")
        if event["kind"] not in {"open", "sale", "movement", "expense", "close"}:
            raise ValueError("Opération non prise en charge")
        return event, claims
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(403, "Événement hors ligne invalide ou non signé")


def ingest(db, envelope):
    with LOCK:
        event, claims = _validate(db, envelope)
        row = db.query(OfflineEvent).filter_by(id=event["id"]).with_for_update().first()
        if row is not None:
            if row.device_id != event["device_id"] or row.user_id != event["user_id"] or row.hash != digest(event):
                raise HTTPException(409, "UUID déjà utilisé avec un autre contenu ou propriétaire")
            if row.state == "applied":
                db.commit()
                return _ack(row)
        else:
            row = OfflineEvent(id=event["id"], device_id=event["device_id"], user_id=event["user_id"],
                               session_id=event["session_id"], sequence=event["sequence"], kind=event["kind"],
                               occurred_at=event["occurred_at"], hash=digest(event), envelope=canonical(envelope).decode())
            db.add(row)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                existing = db.get(OfflineEvent, event["id"])
                if existing and existing.hash == digest(event) and existing.device_id == event["device_id"]:
                    return _ack(existing)
                raise HTTPException(409, "UUID ou séquence déjà utilisés")
        return _attempt(db, row.id, claims)


def _permission(db, user, claims, permission):
    if permission not in claims["permissions"] or not has_permission(db, user, permission):
        raise HTTPException(403, "Droit retiré ou absent de l'autorisation : " + permission)


def _attempt(db, event_id, claims, admin=None, regularize=False):
    from .routers import cash, sales

    row = db.query(OfflineEvent).filter_by(id=event_id).with_for_update().one()
    if row.state == "applied":
        return _ack(row)
    conflict = {}
    try:
        event = json.loads(row.envelope)["event"]
        if admin is None:
            user, _ = current_account(db, claims, occurred_at=row.occurred_at)
        else:
            user = db.get(User, row.user_id)
            if user is None or licensing.effective(db).blocked:
                raise HTTPException(409, "Compte supprimé ou licence inactive : régularisation impossible")
        payload = event["payload"]
        mapping = db.query(OfflineSession).filter_by(id=row.session_id).with_for_update().first()
        if mapping and (mapping.device_id != row.device_id or mapping.user_id != row.user_id):
            raise HTTPException(409, "UUID de caisse utilisé par un autre poste ou vendeur")
        occurred = datetime.fromtimestamp(row.occurred_at, timezone.utc)
        if row.kind == "open":
            _permission(db, user, claims, "caisse")
            if row.sequence != 1:
                raise HTTPException(409, "L'ouverture doit être le premier événement")
            if mapping is None:
                data = CashSessionOpen.model_validate(payload)
                if not math.isfinite(data.opening_balance) or data.opening_balance < 0:
                    raise HTTPException(400, "Fonds initial invalide")
                day = occurred.strftime("%Y-%m-%d")
                already_closed = db.query(CashClosure.id).filter(CashClosure.date_from <= day, CashClosure.date_to >= day).first()
                if already_closed and not regularize:
                    raise HTTPException(409, "Période consolidée : une régularisation administrateur est nécessaire ; aucun ancien Z ne sera modifié")
                current = cash.lock_current_session(db, user)
                source = payload.get("source_session_id")
                if source and not regularize:
                    if current is None or current.id != source or current.workstation != row.device_id or current.global_closure_id is not None:
                        raise HTTPException(409, "Caisse d'origine fermée, consolidée ou ouverte sur un autre poste")
                    session = current
                    if session.offline_mobile_money_to_cash is not None and session.offline_mobile_money_to_cash != claims["mobile_money_to_cash"]:
                        raise HTTPException(409, "Règle Mobile Money différente : rapprochement administrateur nécessaire")
                    session.offline_mobile_money_to_cash = claims["mobile_money_to_cash"]
                else:
                    if current is not None:
                        conflict = {"conflict_code": "separate_open_session", "blocking_session_id": current.id}
                        raise HTTPException(409, "Une autre caisse est ouverte pour ce vendeur ; ne pas fusionner automatiquement")
                    session = CashSession(opened_by_id=user.id, workstation=row.device_id, opening_balance=data.opening_balance,
                                          opened_at=datetime.now(timezone.utc) if regularize else occurred,
                                          business_day=cash.business_day() if regularize else day,
                                          offline_mobile_money_to_cash=claims["mobile_money_to_cash"], note=data.note)
                    db.add(session)
                    db.flush()
                mapping = OfflineSession(id=row.session_id, device_id=row.device_id, user_id=row.user_id,
                                         cash_session_id=session.id, status="regularization" if regularize else "open", opening_event_id=row.id)
                db.add(mapping)
                db.flush()
            result = {"cash_session_id": mapping.cash_session_id, "session_id": mapping.id}
        else:
            if mapping is None or mapping.cash_session_id is None:
                conflict = {"conflict_code": "opening_pending"}
                raise HTTPException(409, "Ouverture provisoire pas encore rapprochée")
            session = db.query(CashSession).filter_by(id=mapping.cash_session_id).with_for_update().one()
            if session.closed_at is not None or session.global_closure_id is not None:
                raise HTTPException(409, "Caisse rapprochée déjà clôturée ; événement conservé sans modifier le Z")
            if session.opened_by_id != user.id:
                raise HTTPException(409, "Caissier d'origine incompatible")
            regularized = mapping.status == "regularization"
            if row.kind == "sale":
                _permission(db, user, claims, "vente_nouvelle")
                snapshot = db.get(OfflineCatalogue, payload["catalogue_id"])
                if snapshot is None or snapshot.user_id != user.id:
                    raise HTTPException(409, "Catalogue signé d'origine introuvable")
                receipt = payload["snapshot"]
                data = SaleCreate.model_validate({**payload["sale"], "client_id": row.id, "cash_session_id": session.id})
                if data.status != "Payée" or not data.items:
                    raise HTTPException(400, "Ticket hors ligne invalide")
                edited = data.discount > 0 or any(line.price_edited or (line.discount or 0) > 0 for line in data.items)
                if edited:
                    _permission(db, user, claims, "prix_modifier")
                if data.is_gift:
                    _permission(db, user, claims, "ventes_cadeau")
                existing = db.query(Sale).filter_by(client_id=row.id).first()
                catalogue = json.loads(snapshot.payload)
                products = {product["id"]: product for product in catalogue["products"]}
                if existing is not None:
                    legs = sorted((leg.method, round(leg.amount, 6)) for leg in existing.payments)
                    expected_legs = sorted((leg.method.strip(), round(leg.amount, 6)) for leg in data.payments or [])
                    comparable = (existing.created_by_id == row.user_id and existing.cash_session_id == session.id
                        and existing.customer_id == data.customer_id and existing.status == data.status
                        and existing.is_gift == data.is_gift and abs(existing.discount - data.discount) < 0.000001
                        and legs == expected_legs and (bool(legs) or existing.payment_method == data.payment_method)
                        and len(existing.items) == len(data.items))
                    if comparable:
                        for stored, line in zip(existing.items, data.items):
                            if (stored.product_id != line.product_id or stored.packaging_id != line.packaging_id
                                    or abs(stored.quantity - line.quantity) > 0.000001
                                    or line.unit_price is None or abs(stored.unit_price - line.unit_price) > 0.000001
                                    or abs(stored.discount - (line.discount or 0)) > 0.000001):
                                comparable = False
                                break
                    if not comparable:
                        raise HTTPException(409, "Cet UUID existe déjà avec un autre propriétaire, caisse ou ticket ; original conservé")
                    sale = existing
                else:
                    sale = sales._persist_sale(db, data, user, offline={"session": session, "products": products}, commit=False)
                if not math.isfinite(float(receipt["total"])) or abs(sale.total - float(receipt["total"])) > 0.01:
                    raise HTTPException(409, "Total du reçu d'origine différent : ticket conservé sans recalcul silencieux")
                if existing is None:
                    sale.date = datetime.now(timezone.utc) if regularized else occurred
                result = {"sale_id": sale.id, "cash_session_id": session.id, "original_reference": str(receipt["reference"]), "server_reference": sale.reference}
            elif row.kind == "movement":
                data = CashMovementCreate.model_validate(payload)
                permission = "caisse_operations" if data.type == "out" or "recette_enregistrer" not in claims["permissions"] else "recette_enregistrer"
                _permission(db, user, claims, permission)
                if data.return_id is not None:
                    raise HTTPException(409, "Le remboursement lié nécessite un rapprochement en ligne")
                movement = CashMovement(session_id=session.id, type=data.type, amount=data.amount, reason=data.reason.strip(),
                                        client_id=row.id, user_id=user.id, workstation=row.device_id,
                                        created_at=datetime.now(timezone.utc) if regularized else occurred)
                db.add(movement)
                db.flush()
                result = {"movement_id": movement.id, "cash_session_id": session.id}
            elif row.kind == "expense":
                _permission(db, user, claims, "depenses_gerer")
                from .routers.accounting import _new_expense
                data = ExpenseCreate.model_validate({**payload, "date": datetime.now(timezone.utc) if regularized else occurred})
                expense = _new_expense(db, data, user)
                db.flush()
                result = {"expense_id": expense.id, "cash_session_id": session.id}
            elif row.kind == "close":
                _permission(db, user, claims, "caisse_fermer")
                prior = db.query(OfflineEvent).filter_by(device_id=row.device_id, session_id=row.session_id).filter(OfflineEvent.sequence < row.sequence).all()
                if len(prior) != row.sequence - 1 or any(item.state != "applied" for item in prior):
                    raise HTTPException(409, "Des événements précédents restent en attente : clôture non appliquée")
                data = CashSessionClose.model_validate(payload)
                if not math.isfinite(data.closing_balance) or data.closing_balance < 0:
                    raise HTTPException(400, "Montant compté invalide")
                cash._close_session(db, session, data, user)
                mapping.status = "closed"
                result = {"cash_session_id": session.id, "session_id": mapping.id}
            else:
                raise HTTPException(400, "Type d'événement inconnu")
        row.state = "applied"
        row.result = json.dumps(result, ensure_ascii=False)
        db.commit()
        remote_sales.schedule()
        return _ack(row)
    except (HTTPException, ValidationError, KeyError, TypeError, ValueError) as error:
        db.rollback()
        row = db.get(OfflineEvent, event_id)
        if row.state == "applied":
            return _ack(row)
        reason = error.detail if isinstance(error, HTTPException) else "Données de l'événement invalides : vérification administrateur nécessaire"
        row.state = "conflict"
        row.result = json.dumps({"reason": reason, **conflict}, ensure_ascii=False)
        db.commit()
        return _ack(row)
    except IntegrityError:
        db.rollback()
        row = db.get(OfflineEvent, event_id)
        if row.state == "applied":
            return _ack(row)
        row.state = "conflict"
        row.result = json.dumps({"reason": "Concurrence ou lien métier incompatible : ticket conservé pour vérification"})
        db.commit()
        return _ack(row)


def retry_event(db, event_id, admin, reason, regularize=False):
    with LOCK:
        row = db.get(OfflineEvent, event_id)
        if row is None:
            raise HTTPException(404, "Événement introuvable")
        if row.state == "applied":
            return _ack(row)
        _, claims = _validate(db, json.loads(row.envelope))
        history = json.loads(row.resolution) if row.resolution else []
        history.append({"actor_id": admin.id, "reason": reason, "regularize": regularize, "at": time.time()})
        row.resolution = json.dumps(history, ensure_ascii=False)
        db.add(SecurityLog(event="offline_resolution", user_id=admin.id, identifier=admin.email,
                           detail=f"Événement {row.id} : {reason}", success=True))
        db.commit()
        return _attempt(db, row.id, claims, admin=admin, regularize=regularize)
