"""Apply the write operations the phone queued on the central server.

The phone never touches this database: it posts an operation on the central
relay, this module pulls it at each sync, applies it through the *same*
functions as the desktop routes (same business rules, same permission
checks), then reports the outcome. The shop database stays the single source
of truth.
"""

import urllib.parse

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import licensing
from .models import MobileOpApplied, User
from .permissions import has_permission
from .schemas import (
    BankDepositIn,
    ExpenseCreate,
    PayslipCreate,
    ReturnCreate,
)

# kind -> (route function, permission required). Same rights as the desktop.
KIND_PERMISSION = {
    "return_create": "retours",
    "expense_create": "depenses_gerer",
    "expense_delete": "depenses_gerer",
    "deposit_create": "versements_gerer",
    "payslip_create": "paie_gerer",
}


def _apply(db: Session, kind: str, payload: dict, user: User) -> str:
    """Run one operation; returns a detail message or raises HTTPException."""
    from .routers.accounting import create_expense, delete_expense
    from .routers.bank import create_deposit
    from .routers.payroll import create_payslip
    from .routers.returns import create_return

    if kind == "return_create":
        result = create_return(ReturnCreate(**payload), db, user)
        return f"Avoir {result.reference} enregistré"
    if kind == "expense_create":
        result = create_expense(ExpenseCreate(**payload), db, user)
        return f"Dépense #{result.id} enregistrée"
    if kind == "expense_delete":
        delete_expense(int(payload.get("expense_id") or 0), db, user)
        return "Dépense supprimée"
    if kind == "deposit_create":
        result = create_deposit(BankDepositIn(**payload), db, user)
        return f"Versement #{result.id} enregistré"
    if kind == "payslip_create":
        result = create_payslip(PayslipCreate(**payload), db, user)
        return f"Bulletin {result.reference} enregistré"
    raise HTTPException(status_code=400, detail="Opération inconnue")


def process_pending(db: Session) -> int:
    """Pull the phone's queued operations, apply them, report back.

    Returns the number of operations processed (applied or rejected).
    """
    row = licensing.state(db)
    if row is None or not row.token:
        return 0
    base = (row.central_url or licensing.central_url()).rstrip("/")
    if not base:
        return 0
    query = urllib.parse.urlencode(
        {"installation_uid": row.installation_uid, "token": row.token}
    )
    try:
        ops = licensing._get(  # noqa: SLF001 - same module family
            f"{base}/api/central/public/mobile-ops?{query}"
        )
    except Exception:
        return 0
    if not isinstance(ops, list) or not ops:
        return 0

    results = []
    for op in ops:
        remote_id = op.get("remote_id") or ""
        status, detail = "applied", ""
        already = (
            db.query(MobileOpApplied)
            .filter(MobileOpApplied.remote_id == remote_id)
            .first()
            if remote_id
            else None
        )
        if already is not None:
            status, detail = "applied", "Déjà appliquée (anti-doublon)"
        else:
            kind = op.get("kind") or ""
            user = (
                db.query(User)
                .filter(User.email == (op.get("created_by_email") or ""))
                .first()
            )
            try:
                if kind not in KIND_PERMISSION:
                    raise HTTPException(400, "Opération inconnue")
                if user is None or not user.is_active:
                    raise HTTPException(403, "Utilisateur introuvable ou inactif")
                if not has_permission(db, user, KIND_PERMISSION[kind]):
                    raise HTTPException(403, "Droit insuffisant")
                detail = _apply(db, kind, op.get("payload") or {}, user)
                if remote_id:
                    db.add(MobileOpApplied(remote_id=remote_id))
                db.commit()
            except HTTPException as exc:
                db.rollback()
                status, detail = "rejected", str(exc.detail)
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                status, detail = "rejected", str(exc)[:500]
        results.append({"id": op.get("id"), "status": status, "detail": detail})

    if results:
        try:
            licensing._post(  # noqa: SLF001 - same module family
                f"{base}/api/central/public/mobile-ops/ack",
                {
                    "installation_uid": row.installation_uid,
                    "token": row.token,
                    "results": results,
                },
            )
        except Exception:
            pass  # kept pending centrally; the next pull just skips them
    return len(results)
