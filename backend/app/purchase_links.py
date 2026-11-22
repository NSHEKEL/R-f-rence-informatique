import json
import logging
import re
from datetime import timezone

from fastapi import HTTPException
from sqlalchemy import update

from . import backup
from .models import Debt, Purchase, SecurityLog


def same_supplier(debt, purchase, allow_name=False):
    if debt.supplier_id is not None and purchase.supplier_id is not None:
        return debt.supplier_id == purchase.supplier_id
    if not allow_name and (debt.supplier_id is not None or purchase.supplier_id is not None):
        return debt.supplier_id is not None and debt.supplier_id == purchase.supplier_id
    return bool((debt.party or "").strip()) and (debt.party or "").strip().casefold() == (purchase.supplier_name or "").strip().casefold()


def compatible(debt, purchase, manual=False):
    statuses = ("En attente", "Reçu partiellement", "Reçu") if manual else ("Reçu",)
    return (not debt.cancelled and debt.kind == "dette" and purchase.status in statuses
            and same_supplier(debt, purchase, allow_name=manual)
            and abs(debt.amount - purchase.balance) <= 0.009)


def reliable(debt, purchase):
    moment = purchase.received_at
    if not moment or not debt.created_at or not purchase.reference:
        return False
    distance = abs((debt.created_at.replace(tzinfo=timezone.utc)
                    - moment.replace(tzinfo=timezone.utc)).total_seconds())
    return compatible(debt, purchase) and mentions_purchase(debt, purchase) and distance <= 7 * 86400


def mentions_purchase(debt, purchase):
    return bool(purchase.reference and re.search(r"(?<![\w-])" + re.escape(purchase.reference) + r"(?![\w-])",
                f"{debt.reference or ''}\n{debt.note or ''}", re.IGNORECASE))


def candidates(db, debt):
    occupied = db.query(Debt.purchase_id).filter(Debt.purchase_id.is_not(None))
    return [p for p in db.query(Purchase).filter(Purchase.status.in_(("En attente", "Reçu partiellement", "Reçu")), ~Purchase.id.in_(occupied)).all()
            if compatible(debt, p, manual=True)]


def assign_new_origin(db, debt, purchase_id=None):
    if purchase_id is None:
        matches = [p for p in db.query(Purchase).filter(Purchase.status == "Reçu") if reliable(debt, p)]
        if len(matches) != 1:
            return
        purchase_id = matches[0].id
    purchase = db.query(Purchase).filter_by(id=purchase_id).with_for_update().first()
    if not purchase or not compatible(debt, purchase, manual=True):
        raise HTTPException(400, "Achat non annulé, fournisseur et montant initial identiques requis")
    if db.query(Debt.id).filter_by(purchase_id=purchase.id).first():
        raise HTTPException(409, "Cet achat possède déjà une dette liée")
    if any(reliable(row, purchase) for row in db.query(Debt).filter_by(kind="dette", purchase_id=None)):
        raise HTTPException(409, "Dette existante sans origine : utilisez Rapprocher, ne créez pas de doublon")
    debt.purchase_id = purchase.id
    debt.purchase = purchase


def automatic_pairs(db):
    orphans = db.query(Debt).filter_by(kind="dette", purchase_id=None).populate_existing().all()
    occupied = {row[0] for row in db.query(Debt.purchase_id).filter(Debt.purchase_id.is_not(None))}
    purchases = db.query(Purchase).filter(Purchase.status == "Reçu").populate_existing().all()
    matches = {d.id: [p.id for p in purchases if p.id not in occupied and reliable(d, p)] for d in orphans}
    counts = {}
    for ids in matches.values():
        for purchase_id in ids:
            counts[purchase_id] = counts.get(purchase_id, 0) + 1
    return [(debt_id, ids[0]) for debt_id, ids in matches.items() if len(ids) == 1 and counts[ids[0]] == 1]


def _lock_pair(db, debt_id, purchase_id):
    locked = db.execute(update(Purchase).where(Purchase.id == purchase_id).values(note=Purchase.note))
    debt = db.query(Debt).filter_by(id=debt_id).populate_existing().with_for_update().first()
    purchase = db.query(Purchase).filter_by(id=purchase_id).populate_existing().first()
    if not locked.rowcount or not debt or not purchase:
        raise HTTPException(404, "Achat ou dette introuvable")
    if debt.purchase_id or db.query(Debt.id).filter_by(purchase_id=purchase_id).first():
        raise HTTPException(409, "Liaison existante conservée")
    if not compatible(debt, purchase, manual=True):
        raise HTTPException(400, "Rapprochement refusé : achat non annulé, fournisseur identique et montant initial restant dû identique requis")
    return debt, purchase


def _attach(db, debt, purchase, snapshot, user=None):
    debt.purchase_id = purchase.id
    debt.purchase = purchase
    db.add(SecurityLog(event="comptabilite_liaison", user_id=user.id if user else None,
        identifier=user.email if user else "démarrage", success=True,
        detail=json.dumps({"mode": "manuel" if user else "automatique", "debt_id": debt.id,
            "purchase_id_before": None, "purchase_id": purchase.id, "reference": purchase.reference,
            "supplier": purchase.supplier_name, "amount": debt.amount, "backup": snapshot.name}, ensure_ascii=False)))


def reconcile(db, debt_id, purchase_id, user):
    debt, purchase = db.get(Debt, debt_id), db.get(Purchase, purchase_id)
    if not debt or not purchase:
        raise HTTPException(404, "Achat ou dette introuvable")
    if debt.purchase_id or db.query(Debt.id).filter_by(purchase_id=purchase_id).first():
        raise HTTPException(409, "Liaison existante conservée")
    if not compatible(debt, purchase, manual=True):
        raise HTTPException(400, "Fournisseur, montant ou état de réception incompatible")
    try:
        snapshot = backup.create(db, reason="rapprochement-dettes", drive_background=False, mirror_required=False)
    except Exception as exc:
        db.rollback()
        raise HTTPException(503, "Sauvegarde préalable impossible : aucun rapprochement effectué") from exc
    debt, purchase = _lock_pair(db, debt_id, purchase_id)
    _attach(db, debt, purchase, snapshot, user)
    db.commit()
    return debt


def repair(db):
    pairs = automatic_pairs(db)
    linked = []
    if pairs:
        snapshot = backup.create(db, reason="rapprochement-dettes", drive_background=False, mirror_required=False)
        try:
            for debt_id, purchase_id in pairs:
                if (debt_id, purchase_id) not in automatic_pairs(db):
                    continue
                debt, purchase = _lock_pair(db, debt_id, purchase_id)
                if (debt_id, purchase_id) not in automatic_pairs(db):
                    continue
                _attach(db, debt, purchase, snapshot)
                db.flush()
                linked.append(debt_id)
            db.commit()
        except Exception:
            db.rollback()
            raise
    remaining = [row[0] for row in db.query(Debt.id).filter_by(kind="dette", purchase_id=None)]
    if linked or remaining:
        logging.getLogger(__name__).warning("Rapprochement dettes : liées=%s ; sans origine (à examiner dans Dettes)=%s", linked, remaining)
    return {"linked": linked, "orphans": remaining}
