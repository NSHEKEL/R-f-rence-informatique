import json
import sqlite3
from datetime import date, datetime, time, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import and_, or_, update
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError

from ..auth import get_current_user, require_admin
from .. import offline_store, remote_sales
from ..offline_ingest import LOCK
from ..database import get_db
from ..models import (
    BankDeposit,
    CashSession,
    CashClosure,
    CashMovement,
    CompanySettings,
    DebtPayment,
    Depot,
    Expense,
    Notification,
    Order,
    OfflineEvent,
    OfflineSession,
    Sale,
    SaleReturn,
    StockMovement,
    User,
)
from ..permissions import has_permission, require_permission
from ..payment_totals import group_payments, physical_expected
from ..schemas import (
    CashSessionClose,
    CashGlobalClose,
    CashSessionDetail,
    CashSessionOpen,
    CashSessionOut,
    CashSessionZ,
    CashMovementCreate,
    CashMovementOut,
)

router = APIRouter(prefix="/api/cash-sessions", tags=["cash"])

CASH_PAYMENT = "Espèces"


def business_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def current_session(db: Session, user: User) -> CashSession | None:
    """The till this cashier currently has open (one per cashier)."""
    return (
        db.query(CashSession)
        .filter(
            CashSession.closed_at.is_(None),
            CashSession.opened_by_id == user.id,
        )
        .order_by(CashSession.opened_at.desc())
        .first()
    )


def lock_current_session(db: Session, user: User) -> CashSession | None:
    session = current_session(db, user)
    if session is None:
        return None
    locked = db.execute(update(CashSession).where(
        CashSession.id == session.id, CashSession.closed_at.is_(None),
    ).values(note=CashSession.note))
    if not locked.rowcount:
        return None
    db.refresh(session)
    return session


def day_session(db: Session, user: User) -> CashSession | None:
    """This cashier's session for today, open or already closed."""
    return (
        db.query(CashSession)
        .filter(
            CashSession.opened_by_id == user.id,
            CashSession.business_day == business_day(),
        )
        .order_by(CashSession.opened_at.desc())
        .first()
    )


def require_open_till(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """A seller sells nothing — and sees no article — with a closed till.

    The rule is enforced here and not only in the pages: a direct call to the
    API would otherwise still hand over the catalogue. The administrator and
    the stock manager keep their screens, the counter is not their job.
    """
    if current_user.role != "vendeur" or current_session(db, current_user):
        return current_user
    raise HTTPException(
        status_code=403,
        detail="Ouvrez votre caisse pour accéder aux articles et aux ventes",
    )


def _detail(db: Session, session: CashSession, user: User) -> CashSessionDetail:
    can_closure = has_permission(db, user, "clotures_consulter") or has_permission(db, user, "caisse_z")
    if not has_permission(db, user, "soldes_consulter") or (session.closed_at is not None and not can_closure):
        out = CashSessionDetail(**CashSessionOut.model_validate(session).model_dump())
        for field in ("opening_balance", "closing_balance", "expected_balance", "difference"):
            setattr(out, field, None)
        return out
    return CashSessionDetail(
        **CashSessionOut.model_validate(session).model_dump(),
        **session_amounts(db, session).model_dump(include={
            "cash_sales", "other_sales", "sales_count", "deposits_total", "expected_cash",
            "sales", "entries_total", "exits_total", "cash_refunds", "cash_settlements",
            "total_sales", "refunds_total", "net_sales", "expenses_total", "cash_expenses", "expenses",
            "payments", "payment_groups", "mobile_money_to_cash", "mobile_money_sales",
            "mobile_money_refunds", "kept_balance", "remitted_amount", "mobile_cash_adjustment",
        }),
    )


@router.get("/current", response_model=CashSessionDetail | None)
def get_current(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = current_session(db, current_user)
    return _detail(db, session, current_user) if session else None


@router.get("/today", response_model=CashSessionDetail | None)
def get_today(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The active session, or today's closure when none remains open."""
    session = current_session(db, current_user) or day_session(db, current_user)
    return _detail(db, session, current_user) if session else None


@router.get("", response_model=list[CashSessionOut])
def list_sessions(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("clotures_consulter")),
):
    query = db.query(CashSession)
    return [CashSessionOut(**_detail(db, session, current_user).model_dump())
            for session in query.order_by(CashSession.opened_at.desc()).limit(limit).all()]


def _global_sessions(db, date_from, date_to):
    if date_from > date_to:
        raise HTTPException(400, "Période inversée")
    return db.query(CashSession).filter(
        CashSession.global_closure_id.is_(None),
        or_(CashSession.business_day.between(date_from.isoformat(), date_to.isoformat()), and_(
            or_(CashSession.business_day == "", CashSession.business_day.is_(None)),
            CashSession.opened_at >= datetime.combine(date_from, time.min),
            CashSession.opened_at <= datetime.combine(date_to, time.max),
        )),
    ).order_by(CashSession.opened_at, CashSession.id).all()


def _flow_groups(report, settlements=None):
    if report.inflow_groups and report.outflow_groups:
        return report.inflow_groups, report.outflow_groups
    inflows = group_payments(report.payments)
    inflows["cash"] = report.cash_sales
    inflows["credit"] = 0
    inflows["cash"] += report.entries_total
    outflows = group_payments({})
    outflows["cash"] = report.exits_total + report.deposits_total + report.cash_expenses + report.cash_refunds
    legs = report.settlements.items() if settlements is None else (
        (p.method or CASH_PAYMENT, (p.amount or 0) * (-1 if p.debt.kind == "dette" else 1)) for p in settlements
    )
    for method, amount in legs:
        target = inflows if amount >= 0 else outflows
        for key, value in group_payments({method: abs(amount)}).items():
            target[key] += value
    for records, total, cash, amount_key, method_key in (
        (report.expenses, report.expenses_total, report.cash_expenses, "amount", "payment_method"),
        (report.refunds, report.refunds_total, report.cash_refunds, "total", "refund_method"),
    ):
        known = 0
        for row in records:
            method = "Banque" if row.get("bank_account_id") else row.get(method_key)
            if not method:
                continue
            groups = group_payments({method: row.get(amount_key) or 0})
            for key, value in groups.items():
                if key != "cash":
                    outflows[key] += value
                    known += value
        outflows["other"] += max(0, total - cash - known)
    return inflows, outflows


def _global_totals(db, sessions, user):
    fields = ("total_sales", "net_sales", "sales_count", "opening_balance", "entries_total", "exits_total",
              "refunds_total", "cash_refunds", "cash_expenses", "expenses_total", "cash_settlements",
              "settlements_total", "deposits_total", "expected_cash", "advances_total",
              "mobile_money_sales", "mobile_money_refunds", "kept_balance", "remitted_amount", "mobile_cash_adjustment")
    totals = {field: 0 for field in fields}
    payments, rows = {}, []
    inflows, outflows = group_payments({}), group_payments({})
    for session in sessions:
        report = session_amounts(db, session)
        session_in, session_out = _flow_groups(report)
        for key in inflows:
            inflows[key] += session_in[key]
            outflows[key] += session_out[key]
        for field in fields:
            totals[field] += getattr(report, field) or 0
        for method, amount in report.payments.items():
            payments[method] = payments.get(method, 0) + amount
        rows.append({
            "session_id": session.id, "user_id": session.opened_by_id,
            "cashier": report.cashier, "workstation": session.workstation,
            "business_day": session.business_day, "opened_at": session.opened_at.isoformat(),
            "closed_at": session.closed_at.isoformat() if session.closed_at else None,
            "total_sales": report.total_sales, "sales_count": report.sales_count,
            "payments": report.payments, "payment_groups": group_payments(report.payments),
            "expected_cash": report.expected_cash, "counted_cash": report.counted_cash,
            "mobile_money_to_cash": report.mobile_money_to_cash,
            "kept_balance": report.kept_balance, "remitted_amount": report.remitted_amount,
            "difference": report.difference,
        })
    by_cashier = {}
    for row in rows:
        cashier = by_cashier.setdefault(row["user_id"], {"user_id": row["user_id"], "name": row["cashier"], "own": row["user_id"] == user.id,
                                                       "payments": {}, "total_sales": 0, "sales_count": 0})
        cashier["total_sales"] += row["total_sales"]
        cashier["sales_count"] += row["sales_count"]
        for method, amount in row["payments"].items():
            cashier["payments"][method] = cashier["payments"].get(method, 0) + amount
    for cashier in by_cashier.values():
        cashier["payment_groups"] = group_payments(cashier["payments"])
    counted = sum(row["counted_cash"] or 0 for row in rows) if all(row["closed_at"] for row in rows) else None
    for field in ("kept_balance", "remitted_amount"):
        if any(row[field] is None for row in rows):
            totals[field] = None
    return {**totals, "payments": payments, "payment_groups": group_payments(payments),
            "inflow_groups": inflows, "outflow_groups": outflows,
            "sessions": rows, "cashiers": list(by_cashier.values()), "counted_cash": counted,
            "difference": counted - totals["expected_cash"] if counted is not None else None,
            "open_sessions": sum(row["closed_at"] is None for row in rows)}


@router.get("/global")
def global_cash(date_from: date | None = None, date_to: date | None = None,
                db: Session = Depends(get_db), user: User = Depends(require_admin)):
    start, end = date_from or date.today(), date_to or date.today()
    return {"date_from": start.isoformat(), "date_to": end.isoformat(),
            **_global_totals(db, _global_sessions(db, start, end), user)}


@router.get("/global/closures")
def global_closures(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    reports = []
    for row in db.query(CashClosure).order_by(CashClosure.id.desc()).limit(100):
        report = json.loads(row.report)
        for cashier in report.get("cashiers", []):
            cashier["own"] = cashier["user_id"] == user.id
        reports.append({"id": row.id, "closed_at": row.closed_at.isoformat(), "closed_by_id": row.closed_by_id, **report})
    return reports


@router.post("/global/close", status_code=201)
def close_global(payload: CashGlobalClose, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    with LOCK:
        pending = db.query(OfflineEvent.id).filter(OfflineEvent.state != "applied").first()
        provisional = db.query(OfflineSession.id).filter(or_(OfflineSession.status == "pending", OfflineSession.cash_session_id.is_(None))).first()
        try:
            local = offline_store.local_events_pending()
        except (OSError, sqlite3.Error):
            raise HTTPException(503, "Journal local illisible : vérifiez la récupération avant la clôture globale") from None
        if pending or provisional or local:
            raise HTTPException(409, "Opérations hors ligne en attente ou en conflit : récupérez tous les journaux avant la clôture globale")
        return _close_global(payload, db, user)


def _close_global(payload, db, user):
    ids = set(payload.session_ids)
    sessions = _global_sessions(db, payload.date_from, payload.date_to)
    if not sessions or ids != {s.id for s in sessions} or len(ids) != len(payload.session_ids):
        raise HTTPException(409, "Les sessions ont changé ou sont déjà consolidées. Actualisez le récapitulatif.")
    if any(s.closed_at is None for s in sessions):
        raise HTTPException(409, "Clôturez individuellement toutes les caisses de cette période et synchronisez les tickets avant la clôture globale.")
    closure = CashClosure(closed_by_id=user.id, date_from=payload.date_from.isoformat(), date_to=payload.date_to.isoformat(), report="")
    db.add(closure)
    try:
        db.flush()
        result = db.execute(update(CashSession).where(
            CashSession.id.in_(sorted(ids)), CashSession.global_closure_id.is_(None), CashSession.closed_at.isnot(None),
        ).values(global_closure_id=closure.id))
        if result.rowcount != len(ids):
            db.rollback()
            raise HTTPException(409, "Une session est déjà consolidée. Actualisez le récapitulatif.")
        report = _global_totals(db, sessions, user)
        report.update(date_from=closure.date_from, date_to=closure.date_to, counted_cash=payload.closing_balance,
                      difference=payload.closing_balance - report["expected_cash"], note=payload.note)
        if abs(report["difference"]) >= 1 and not payload.note.strip():
            db.rollback()
            raise HTTPException(400, "Un écart de caisse exige une justification (note obligatoire)")
        closure.report = json.dumps(report, ensure_ascii=False)
        db.commit()
        return {"id": closure.id, "closed_at": closure.closed_at.isoformat(), "closed_by_id": user.id, **report}
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Clôture concurrente : actualisez le récapitulatif")


@router.get("/{session_id}/movements", response_model=list[CashMovementOut])
def list_movements(session_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    session = _session_or_404(db, session_id)
    if session.opened_by_id != user.id and not has_permission(db, user, "clotures_consulter"):
        raise HTTPException(status_code=403, detail="Session d'un autre caissier")
    rows = db.query(CashMovement).filter(CashMovement.session_id == session_id).order_by(CashMovement.created_at.desc()).all()
    result = [CashMovementOut.model_validate(row) for row in rows]
    if not has_permission(db, user, "soldes_consulter"):
        for row in result:
            row.amount = None
    return result


@router.get("/{session_id}/product-movements")
def product_movements(
    session_id: int,
    period: Literal["session", "today", "custom"] = "session",
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not (has_permission(db, user, "caisse") or has_permission(db, user, "inventaire")):
        raise HTTPException(403, "Accès refusé : mouvements de produits")
    session = _session_or_404(db, session_id)
    if session.opened_by_id != user.id and not has_permission(db, user, "clotures_consulter"):
        raise HTTPException(403, "Session d'un autre caissier")
    now = datetime.now(timezone.utc)
    if period == "today":
        date_from = date_to = now.date()
    if period == "custom" and not (date_from or date_to):
        raise HTTPException(400, "Choisissez au moins une date")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(400, "Période inversée")
    start = session.opened_at.replace(tzinfo=None)
    end = (session.closed_at or now).replace(tzinfo=None)
    if date_from:
        start = max(start, datetime.combine(date_from, time.min))
    if date_to:
        end = min(end, datetime.combine(date_to, time.max))
    depot = db.query(Depot).filter(Depot.is_default.is_(True)).first()
    query = db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.created_by),
    ).filter(StockMovement.date >= start, StockMovement.date <= end)
    if depot:
        query = query.filter(or_(StockMovement.depot_id == depot.id, StockMovement.depot_id.is_(None)))
    else:
        query = query.filter(StockMovement.depot_id.is_(None))
    items, products = [], {}
    for movement in query.order_by(StockMovement.date.desc(), StockMovement.id.desc()).all():
        product = movement.product
        name = movement.product_name or (product.name if product else "")
        sku = product.sku if product else ""
        unit = movement.base_unit or (product.base_unit if product else "") or "pièce"
        quantity = movement.quantity or 0
        items.append({
            "id": movement.id, "type": movement.kind, "product_id": movement.product_id,
            "product_name": name, "sku": sku, "quantity": quantity, "base_unit": unit,
            "direction": "entree" if quantity > 0 else "sortie" if quantity < 0 else "neutre",
            "date": movement.date, "user": movement.created_by.name if movement.created_by else "",
            "reason": movement.reason or "",
        })
        key = movement.product_id if movement.product_id is not None else (None, name)
        total = products.setdefault(key, {"product_id": movement.product_id, "product_name": name,
                                          "sku": sku, "base_unit": unit, "entries": 0, "exits": 0, "net": 0})
        total["entries"] += max(quantity, 0)
        total["exits"] += max(-quantity, 0)
        total["net"] += quantity
    totals = {key: sum(product[key] for product in products.values()) for key in ("entries", "exits", "net")}
    return {"session_id": session.id, "depot_id": depot.id if depot else None,
            "depot_name": depot.name if depot else "Principal (historique)",
            "date_from": start, "date_to": end, "items": items,
            "products": sorted(products.values(), key=lambda product: product["product_name"].casefold()),
            "totals": totals}


@router.post("/movements", response_model=CashMovementOut)
def create_movement(payload: CashMovementCreate, request: Request,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    allowed = has_permission(db, user, "caisse_operations") or (
        payload.type == "in" and has_permission(db, user, "recette_enregistrer")
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Accès refusé : opérations de caisse")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Le motif est obligatoire")
    session = lock_current_session(db, user)
    if session is None:
        raise HTTPException(status_code=400, detail="Ouvrez votre caisse avant une opération")
    if payload.return_id is not None:
        refund = db.get(SaleReturn, payload.return_id)
        if (refund is None or refund.cash_session_id != session.id or payload.type != "out"
                or refund.refund_method != CASH_PAYMENT or abs(refund.total - payload.amount) > 0.009):
            raise HTTPException(400, "Le mouvement doit correspondre au remboursement espèces de cette caisse")
        if db.query(CashMovement.id).filter_by(return_id=refund.id).first():
            raise HTTPException(409, "Ce remboursement possède déjà son mouvement de caisse")
    row = CashMovement(session_id=session.id, type=payload.type, amount=payload.amount,
                       return_id=payload.return_id,
                       reason=payload.reason.strip(), user_id=user.id,
                       workstation=request.client.host if request.client else "")
    db.add(row)
    db.commit()
    db.refresh(row)
    remote_sales.schedule()
    out = CashMovementOut.model_validate(row)
    if not has_permission(db, user, "soldes_consulter"):
        out.amount = None
    return out


@router.post("/open", response_model=CashSessionDetail, status_code=201)
def open_session(
    payload: CashSessionOpen,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("caisse")),
    request: Request = None,
):
    existing = current_session(db, current_user)
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Votre caisse est déjà ouverte",
        )
    session = CashSession(
        opening_balance=payload.opening_balance,
        note=payload.note,
        opened_by_id=current_user.id,
        business_day=business_day(),
        workstation=(request.headers.get("x-workstation-name") or (request.client.host if request.client else ""))[:255] if request else None,
    )
    db.add(session)
    db.add(
        Notification(
            kind="caisse",
            title="Ouverture de caisse",
            message=(
                f"{current_user.name} a ouvert sa caisse"
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    remote_sales.schedule()
    return _detail(db, session, current_user)


@router.post("/close", response_model=CashSessionDetail)
def close_session(
    payload: CashSessionClose,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("caisse_fermer")),
):
    session = lock_current_session(db, current_user)
    if not session:
        raise HTTPException(
            status_code=400, detail="Aucune caisse ouverte à votre nom"
        )
    if payload.cash_session_id is None:
        raise HTTPException(422, "Identifiant de la caisse confirmée obligatoire")
    if payload.cash_session_id != session.id:
        raise HTTPException(409, "La caisse a changé depuis votre confirmation. Actualisez puis recomptez la caisse courante.")
    _close_session(db, session, payload, current_user)
    db.commit()
    db.refresh(session)
    remote_sales.schedule()
    return _detail(db, session, current_user)


def _close_session(db, session, payload, current_user):
    totals = session_amounts(db, session)
    if payload.kept_balance is not None and payload.kept_balance > payload.closing_balance:
        raise HTTPException(400, "Le montant laissé en caisse ne peut pas dépasser le montant compté")
    if not has_permission(db, current_user, "soldes_consulter") and not payload.note.strip():
        raise HTTPException(status_code=400, detail="Une note est obligatoire pour clôturer sans accès aux soldes")
    gap = payload.closing_balance - totals.expected_cash
    if abs(gap) >= 1 and not payload.note.strip():
        raise HTTPException(
            status_code=400,
            detail="Un écart de caisse exige une justification (note obligatoire)",
        )
    session.closed_at = datetime.now(timezone.utc)
    session.closed_by_id = current_user.id
    session.closing_balance = payload.closing_balance
    session.kept_balance = payload.kept_balance
    session.remitted_amount = payload.closing_balance - payload.kept_balance if payload.kept_balance is not None else None
    session.expected_balance = totals.expected_cash
    session.difference = gap
    if payload.note:
        session.note = payload.note
    # Freeze the Z snapshot at closing: it can never be edited afterwards.
    session.z_report = totals.model_copy(update={
        "closed_at": session.closed_at, "counted_cash": session.closing_balance,
        "difference": gap, "note": session.note, "kept_balance": session.kept_balance,
        "remitted_amount": session.remitted_amount,
    }).model_dump_json()
    db.add(
        Notification(
            kind="caisse",
            title="Fermeture de caisse",
            message=(
                f"{current_user.name} a fermé sa caisse"
            ),
            link="/caisse",
        )
    )


def _session_or_404(db: Session, session_id: int) -> CashSession:
    session = db.query(CashSession).filter(CashSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session de caisse introuvable")
    return session


def session_amounts(db: Session, session: CashSession) -> CashSessionZ:
    """Build the definitive recap of a till session (État Z)."""
    if session.closed_at is not None and session.z_report:
        try:
            stored = json.loads(session.z_report)
            payments = stored.get("payments", {})
            stored.setdefault("cash_sales", payments.get(CASH_PAYMENT, 0))
            stored.setdefault("other_sales", sum(v for k, v in payments.items() if k != CASH_PAYMENT))
            stored.setdefault("net_sales", stored.get("total_sales", 0) - stored.get("refunds_total", 0))
            stored["payment_groups"] = group_payments(payments)
            return CashSessionZ(**stored)
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(status_code=409, detail="Clôture historique illisible : restauration nécessaire")
    sales = (
        db.query(Sale).filter(Sale.cash_session_id == session.id).all()
    )
    payments: dict[str, float] = {}
    total_sales = 0.0
    cancelled_total = 0.0
    cancelled_count = 0
    gift_total = 0.0
    sales_count = 0
    for s in sales:
        if s.status == "Annulée":
            cancelled_total += s.total or 0
            cancelled_count += 1
            continue
        if s.is_gift:
            gift_total += s.total or 0
            continue
        sales_count += 1
        total_sales += s.total or 0
        if s.payments:
            for leg in s.payments:
                payments[leg.method] = payments.get(leg.method, 0.0) + (
                    leg.amount or 0
                )
        else:
            method = s.payment_method or CASH_PAYMENT
            payments[method] = payments.get(method, 0.0) + (s.total or 0)

    opened_at = session.opened_at
    closed_at = session.closed_at or datetime.now(timezone.utc)
    expenses = (
        db.query(Expense)
        .filter(
            Expense.date >= opened_at,
            Expense.date <= closed_at,
            Expense.created_by_id == session.opened_by_id,
        )
        .all()
    )
    deposits = (
        db.query(BankDeposit)
        .filter(
            BankDeposit.cash_session_id == session.id,
            BankDeposit.status != "annulé",
        )
        .all()
    )
    validated_deposits = sum(
        d.amount or 0 for d in deposits if d.status == "validé" and d.method == CASH_PAYMENT
    )
    company = db.query(CompanySettings).first()

    # Credit notes (remboursements / retours) issued inside the session window.
    returns = (
        db.query(SaleReturn)
        .filter(
            SaleReturn.cash_session_id == session.id,
        )
        .all()
    )
    # Client settlements received during the session: cash legs sit in the
    # drawer, the other methods only show up in the breakdown.
    settlements = (
        db.query(DebtPayment)
        .filter(
            DebtPayment.cancelled.is_(False),
            or_(DebtPayment.cash_session_id == session.id, and_(
                DebtPayment.cash_session_id.is_(None),
                DebtPayment.created_by_id == session.opened_by_id,
                DebtPayment.date >= opened_at, DebtPayment.date <= closed_at,
            )),
        )
        .all()
    )
    settlement_payments: dict[str, float] = {}
    cash_settlements = 0.0
    for p in settlements:
        signed_amount = (p.amount or 0) * (-1 if p.debt.kind == "dette" else 1)
        method = p.method or CASH_PAYMENT
        settlement_payments[method] = (
            settlement_payments.get(method, 0.0) + signed_amount
        )
        if method == CASH_PAYMENT:
            cash_settlements += signed_amount
    # Order deposits (acomptes) booked during the session.
    advances = (
        db.query(Order)
        .filter(
            Order.date >= opened_at,
            Order.date <= closed_at,
            Order.deposit > 0,
            Order.created_by_id == session.opened_by_id,
        )
        .all()
    )

    movements = db.query(CashMovement).filter(CashMovement.session_id == session.id).all()
    entries = sum(m.amount for m in movements if m.type == "in")
    exits = sum(m.amount for m in movements if m.type == "out" and m.return_id is None)
    cash_refunds = sum(r.total or 0 for r in returns if r.refund_method == CASH_PAYMENT)
    refunds_total = sum(r.total or 0 for r in returns)
    cash_expenses = sum(e.amount or 0 for e in expenses if e.payment_method == CASH_PAYMENT and not e.bank_account_id)
    convert_mobile = bool(session.offline_mobile_money_to_cash if session.offline_mobile_money_to_cash is not None else (company is None or company.mobile_money_to_cash)) and session.closed_at is None
    mobile_sales = group_payments(payments)["mobile_money"]
    mobile_refunds = sum(r.total or 0 for r in returns if group_payments({r.refund_method: 1})["mobile_money"])
    mobile_expenses = sum(e.amount or 0 for e in expenses if not e.bank_account_id and group_payments({e.payment_method or "": 1})["mobile_money"])
    mobile_settlements = group_payments(settlement_payments)["mobile_money"]
    mobile_deposits = sum(d.amount or 0 for d in deposits if d.status == "validé" and group_payments({d.method or "": 1})["mobile_money"])
    mobile_adjustment = mobile_sales + mobile_settlements - mobile_refunds - mobile_expenses - mobile_deposits if convert_mobile else 0
    expected = physical_expected(session.opening_balance, payments.get(CASH_PAYMENT, 0.0),
        cash_settlements=cash_settlements, validated_deposits=validated_deposits,
        entries=entries, exits=exits, cash_refunds=cash_refunds,
        cash_expenses=cash_expenses, mobile_adjustment=mobile_adjustment)
    if session.closed_at is not None and session.expected_balance is not None:
        expected = session.expected_balance
    report = CashSessionZ(
        cash_sales=payments.get(CASH_PAYMENT, 0.0),
        other_sales=sum(value for method, value in payments.items() if method != CASH_PAYMENT),
        entries_total=entries, exits_total=exits,
        cash_refunds=cash_refunds, cash_settlements=cash_settlements,
        mobile_money_to_cash=convert_mobile, mobile_money_sales=mobile_sales,
        mobile_cash_adjustment=mobile_adjustment,
        mobile_money_refunds=mobile_refunds, kept_balance=session.kept_balance,
        remitted_amount=session.remitted_amount,
        net_sales=total_sales - refunds_total, cash_expenses=cash_expenses,
        sales=[{
            "id": s.id, "reference": s.reference, "total": s.total or 0,
            "paid_amount": s.paid_amount or 0, "payment_method": s.payment_method or "",
            "status": s.status or "", "date": s.date,
        } for s in sales if s.status != "Annulée" and not s.is_gift],
        session_id=session.id,
        company=company.name if company else "",
        company_address=company.address if company else "",
        company_phone=(company.phone or company.phone2) if company else "",
        company_logo=company.logo if company else "",
        cashier=session.opened_by.name if session.opened_by else "",
        opened_at=opened_at,
        closed_at=session.closed_at,
        business_day=session.business_day or "",
        opening_balance=session.opening_balance or 0,
        total_sales=total_sales,
        sales_count=sales_count,
        cancelled_total=cancelled_total,
        cancelled_count=cancelled_count,
        gift_total=gift_total,
        payments=payments,
        payment_groups=group_payments(payments),
        refunds_total=refunds_total,
        refunds=[
            {
                "reference": r.reference,
                "sale_reference": r.sale_reference,
                "total": r.total,
                "refund_method": r.refund_method,
            }
            for r in returns
        ],
        advances_total=sum(o.deposit or 0 for o in advances),
        advances=[
            {"reference": o.reference, "customer": o.customer_name, "amount": o.deposit}
            for o in advances
        ],
        settlements_total=sum(settlement_payments.values()),
        settlements=settlement_payments,
        expenses_total=sum(e.amount or 0 for e in expenses),
        expenses=[
            {"id": e.id, "label": e.label, "category": e.category, "amount": e.amount,
             "date": e.date, "note": e.note or "", "user": e.created_by.name if e.created_by else "",
             "payment_method": e.payment_method, "bank_account_id": e.bank_account_id}
            for e in expenses
        ],
        deposits_total=validated_deposits,
        deposits=[
            {
                "id": d.id,
                "amount": d.amount,
                "bank": d.account.bank_name if d.account else "",
                "reference": d.reference,
                "status": d.status,
            }
            for d in deposits
        ],
        expected_cash=expected,
        counted_cash=session.closing_balance,
        difference=session.difference,
        note=session.note or "",
        generated_at=datetime.now(timezone.utc),
    )
    report.inflow_groups, report.outflow_groups = _flow_groups(report, settlements)
    return report


@router.get("/{session_id}/z", response_model=CashSessionZ)
def z_report(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("soldes_consulter")),
):
    """État Z: the definitive recap. Once the session is closed the snapshot
    stored on it is served, so a validated Z can never change."""
    session = _session_or_404(db, session_id)
    can_close_read = has_permission(db, current_user, "clotures_consulter")
    can_own_ticket = session.opened_by_id == current_user.id and has_permission(db, current_user, "caisse_z")
    if not (can_close_read or can_own_ticket):
        raise HTTPException(status_code=403, detail="Accès refusé : clôtures de caisse")
    if session.z_report:
        try:
            return JSONResponse(content=json.loads(session.z_report))
        except (ValueError, TypeError):
            raise HTTPException(status_code=409, detail="Clôture historique illisible : restauration nécessaire")
    return session_amounts(db, session)


@router.post("/{session_id}/reopen", response_model=CashSessionDetail)
def reopen_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Exceptional re-opening of a closed till — administrator only, traced."""
    session = _session_or_404(db, session_id)
    if session.closed_at is None:
        raise HTTPException(status_code=400, detail="Cette caisse est déjà ouverte")
    if current_session(db, session.opened_by):
        raise HTTPException(
            status_code=400,
            detail="Le caissier a déjà une caisse ouverte",
        )
    previous = session
    session = CashSession(
        opened_by_id=previous.opened_by_id,
        opening_balance=(previous.kept_balance if previous.kept_balance is not None else previous.closing_balance) or 0,
        business_day=business_day(),
        note=f"Nouvelle ouverture après clôture #{previous.id}, par {current_user.name}",
    )
    db.add(session)
    db.add(
        Notification(
            kind="caisse",
            title="Réouverture de caisse",
            message=(
                f"{current_user.name} a ouvert une nouvelle caisse après la clôture #{previous.id}"
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    remote_sales.schedule()
    return _detail(db, session, current_user)
