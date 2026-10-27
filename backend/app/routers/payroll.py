"""Payroll: workers, pay rules and monthly payslips.

A payslip is computed by :mod:`app.payroll` from the rules in force during
the paid month, then stored with its own lines. Validated, paid or cancelled,
it is never rewritten: the history stays exactly as it was signed.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import payroll
from ..database import get_db
from ..models import (
    Employee,
    PayrollElement,
    Payslip,
    PayslipLine,
    SecurityLog,
    User,
    utcnow,
)
from ..permissions import require_permission
from ..schemas import (
    EmployeeBase,
    EmployeeOut,
    PayrollElementBase,
    PayrollElementOut,
    PayrollSummary,
    PayrollSummaryRow,
    PayslipCancel,
    PayslipCreate,
    PayslipDraft,
    PayslipLineIn,
    PayslipOut,
)
from ..sequences import next_reference

router = APIRouter(prefix="/api/payroll", tags=["payroll"])

DRAFT = "Brouillon"
VALIDATED = "Validée"
PAID = "Payée"
CANCELLED = "Annulée"


def _trace(db: Session, user: User, event: str, detail: str) -> None:
    """Payroll touches sensitive money: every decision is written down."""
    db.add(
        SecurityLog(
            event=event,
            identifier=user.email,
            detail=detail,
            user_id=user.id,
            success=True,
        )
    )


def _matricule(db: Session) -> str:
    return next_reference(db, Employee.matricule, "MAT-", 4)


def _employee(db: Session, employee_id: int) -> Employee:
    row = db.query(Employee).get(employee_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Travailleur introuvable")
    return row


def _payslip(db: Session, payslip_id: int) -> Payslip:
    row = db.query(Payslip).get(payslip_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Bulletin introuvable")
    return row


def _check_period(year: int, month: int) -> None:
    if not 1 <= month <= 12:
        raise HTTPException(status_code=400, detail="Mois invalide")
    if not 2000 <= year <= 2100:
        raise HTTPException(status_code=400, detail="Année invalide")


def _rules(db: Session, year: int, month: int) -> list[PayrollElement]:
    end = payroll.period_end(year, month)
    rows = db.query(PayrollElement).order_by(PayrollElement.position).all()
    return [row for row in rows if row.automatic and payroll.applies_on(row, end)]


def _as_computed(lines: list[PayslipLineIn]) -> list[payroll.Computed]:
    return [
        payroll.Computed(
            kind=line.kind,
            label=line.label,
            quantity=line.quantity,
            rate=line.rate,
            base=line.base,
            amount=round(line.amount, 2),
            element_id=line.element_id,
        )
        for line in lines
        if line.label.strip() and line.amount
    ]


def _draft(db: Session, payload: PayslipCreate) -> payroll.Draft:
    employee = _employee(db, payload.employee_id)
    return payroll.compute(
        employee,
        _rules(db, payload.year, payload.month),
        absence_days=payload.absence_days,
        overtime_hours=payload.overtime_hours,
        overtime_rate=payload.overtime_rate,
        extra=_as_computed(payload.extra_lines),
    )


def _totals(lines: list[payroll.Computed]) -> tuple[float, float, float]:
    gross = round(sum(li.amount for li in lines if li.kind == payroll.GAIN), 2)
    kept = round(
        sum(li.amount for li in lines if li.kind == payroll.DEDUCTION), 2
    )
    return gross, kept, round(gross - kept, 2)


def _shown(db: Session, payload: PayslipCreate) -> list[payroll.Computed]:
    """Lines to store: the ones typed on screen, or the computed ones."""
    if payload.lines is not None:
        return _as_computed(payload.lines)
    return _draft(db, payload).lines


def _out(row: Payslip) -> PayslipOut:
    answer = PayslipOut.model_validate(row)
    answer.net_in_words = payroll.in_words(row.net)
    return answer


# ---------- Travailleurs ----------
@router.get("/employees", response_model=list[EmployeeOut])
def list_employees(
    search: str = "",
    active: str = "",
    department: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("paie")),
):
    query = db.query(Employee)
    term = search.strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            Employee.last_name.ilike(like)
            | Employee.first_name.ilike(like)
            | Employee.matricule.ilike(like)
        )
    if department.strip():
        query = query.filter(Employee.department == department.strip())
    if active == "oui":
        query = query.filter(Employee.is_active.is_(True))
    elif active == "non":
        query = query.filter(Employee.is_active.is_(False))
    return query.order_by(Employee.last_name, Employee.first_name).all()


@router.post("/employees", response_model=EmployeeOut, status_code=201)
def create_employee(
    payload: EmployeeBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_travailleurs")),
):
    if not payload.last_name.strip():
        raise HTTPException(status_code=400, detail="Le nom est obligatoire")
    if payload.base_salary < 0:
        raise HTTPException(status_code=400, detail="Salaire de base invalide")
    matricule = payload.matricule.strip() or _matricule(db)
    if db.query(Employee).filter(Employee.matricule == matricule).first():
        raise HTTPException(status_code=400, detail="Matricule déjà utilisé")
    employee = Employee(
        **payload.model_dump(exclude={"matricule"}), matricule=matricule
    )
    db.add(employee)
    _trace(db, current_user, "paie_travailleur_cree", employee.matricule)
    db.commit()
    db.refresh(employee)
    return employee


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    payload: EmployeeBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_travailleurs")),
):
    employee = _employee(db, employee_id)
    if not payload.last_name.strip():
        raise HTTPException(status_code=400, detail="Le nom est obligatoire")
    matricule = payload.matricule.strip() or employee.matricule
    twin = db.query(Employee).filter(Employee.matricule == matricule).first()
    if twin is not None and twin.id != employee.id:
        raise HTTPException(status_code=400, detail="Matricule déjà utilisé")
    for field, value in payload.model_dump(exclude={"matricule"}).items():
        setattr(employee, field, value)
    employee.matricule = matricule
    _trace(db, current_user, "paie_travailleur_modifie", employee.matricule)
    db.commit()
    db.refresh(employee)
    return employee


@router.delete("/employees/{employee_id}", status_code=204)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_travailleurs")),
):
    """A worker who was already paid is archived, never erased."""
    employee = _employee(db, employee_id)
    if employee.payslips:
        raise HTTPException(
            status_code=400,
            detail=(
                "Des bulletins existent pour ce travailleur : "
                "désactivez-le pour conserver l'historique"
            ),
        )
    _trace(db, current_user, "paie_travailleur_supprime", employee.matricule)
    db.delete(employee)
    db.commit()


# ---------- Éléments de paie ----------
@router.get("/elements", response_model=list[PayrollElementOut])
def list_elements(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("paie")),
):
    return (
        db.query(PayrollElement)
        .order_by(PayrollElement.kind, PayrollElement.position, PayrollElement.id)
        .all()
    )


@router.post("/elements", response_model=PayrollElementOut, status_code=201)
def create_element(
    payload: PayrollElementBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_parametres")),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Le libellé est obligatoire")
    element = PayrollElement(**payload.model_dump())
    db.add(element)
    _trace(db, current_user, "paie_parametre_ajoute", element.name)
    db.commit()
    db.refresh(element)
    return element


@router.put("/elements/{element_id}", response_model=PayrollElementOut)
def update_element(
    element_id: int,
    payload: PayrollElementBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_parametres")),
):
    element = db.query(PayrollElement).get(element_id)
    if element is None:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    for field, value in payload.model_dump().items():
        setattr(element, field, value)
    _trace(db, current_user, "paie_parametre_modifie", element.name)
    db.commit()
    db.refresh(element)
    return element


@router.delete("/elements/{element_id}", status_code=204)
def delete_element(
    element_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_parametres")),
):
    element = db.query(PayrollElement).get(element_id)
    if element is None:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    _trace(db, current_user, "paie_parametre_supprime", element.name)
    db.delete(element)
    db.commit()


# ---------- Bulletins ----------
@router.post("/payslips/preparer", response_model=PayslipDraft)
def prepare(
    payload: PayslipCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("paie_gerer")),
):
    """Computed payslip shown on screen; nothing is written down."""
    _check_period(payload.year, payload.month)
    draft = _draft(db, payload)
    return PayslipDraft(
        employee_id=payload.employee_id,
        year=payload.year,
        month=payload.month,
        base_salary=draft.base_salary,
        gross=draft.gross,
        deductions=draft.deductions,
        net=draft.net,
        net_in_words=payroll.in_words(draft.net),
        lines=[PayslipLineIn(**line.__dict__) for line in draft.lines],
    )


@router.get("/payslips", response_model=list[PayslipOut])
def list_payslips(
    year: int = 0,
    month: int = 0,
    employee_id: int = 0,
    department: str = "",
    status: str = "",
    search: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("paie")),
):
    query = db.query(Payslip)
    if year:
        query = query.filter(Payslip.year == year)
    if month:
        query = query.filter(Payslip.month == month)
    if employee_id:
        query = query.filter(Payslip.employee_id == employee_id)
    if status:
        query = query.filter(Payslip.status == status)
    rows = query.order_by(
        Payslip.year.desc(), Payslip.month.desc(), Payslip.id.desc()
    ).all()
    needle = search.strip().lower()
    if needle:
        rows = [
            row
            for row in rows
            if row.employee is not None
            and (
                needle in row.employee.full_name.lower()
                or needle in row.employee.matricule.lower()
            )
        ]
    if department.strip():
        rows = [
            row
            for row in rows
            if row.employee is not None
            and row.employee.department == department.strip()
        ]
    return [_out(row) for row in rows]


@router.get("/payslips/{payslip_id}", response_model=PayslipOut)
def read_payslip(
    payslip_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("paie")),
):
    return _out(_payslip(db, payslip_id))


@router.post("/payslips", response_model=PayslipOut, status_code=201)
def create_payslip(
    payload: PayslipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_gerer")),
):
    _check_period(payload.year, payload.month)
    employee = _employee(db, payload.employee_id)
    if not employee.is_active:
        raise HTTPException(
            status_code=400, detail="Ce travailleur est désactivé"
        )
    twin = (
        db.query(Payslip)
        .filter(
            Payslip.employee_id == employee.id,
            Payslip.year == payload.year,
            Payslip.month == payload.month,
            Payslip.status != CANCELLED,
        )
        .first()
    )
    if twin is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Une paie existe déjà pour {employee.full_name} en "
                f"{payload.month:02d}/{payload.year}"
            ),
        )
    lines = _shown(db, payload)
    gross, kept, net = _totals(lines)
    payslip = Payslip(
        reference=next_reference(
            db, Payslip.reference, f"BP-{payload.year}-", 5
        ),
        employee_id=employee.id,
        year=payload.year,
        month=payload.month,
        base_salary=employee.base_salary,
        gross=gross,
        deductions=kept,
        net=net,
        absence_days=payload.absence_days,
        overtime_hours=payload.overtime_hours,
        overtime_rate=payload.overtime_rate,
        payment_method=payload.payment_method or employee.payment_method,
        note=payload.note,
        created_by_id=current_user.id,
    )
    for index, line in enumerate(lines):
        payslip.lines.append(
            PayslipLine(
                element_id=line.element_id,
                kind=line.kind,
                label=line.label,
                quantity=line.quantity,
                rate=line.rate,
                base=line.base,
                amount=line.amount,
                position=index,
            )
        )
    db.add(payslip)
    _trace(
        db,
        current_user,
        "paie_creee",
        f"{employee.matricule} {payload.month:02d}/{payload.year}",
    )
    db.commit()
    db.refresh(payslip)
    return _out(payslip)


@router.put("/payslips/{payslip_id}", response_model=PayslipOut)
def update_payslip(
    payslip_id: int,
    payload: PayslipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_gerer")),
):
    payslip = _payslip(db, payslip_id)
    if payslip.status != DRAFT:
        raise HTTPException(
            status_code=400,
            detail="Seule une paie en brouillon se modifie",
        )
    lines = _shown(db, payload)
    gross, kept, net = _totals(lines)
    payslip.absence_days = payload.absence_days
    payslip.overtime_hours = payload.overtime_hours
    payslip.overtime_rate = payload.overtime_rate
    payslip.payment_method = payload.payment_method
    payslip.note = payload.note
    payslip.gross, payslip.deductions, payslip.net = gross, kept, net
    payslip.lines.clear()
    for index, line in enumerate(lines):
        payslip.lines.append(
            PayslipLine(
                element_id=line.element_id,
                kind=line.kind,
                label=line.label,
                quantity=line.quantity,
                rate=line.rate,
                base=line.base,
                amount=line.amount,
                position=index,
            )
        )
    _trace(db, current_user, "paie_modifiee", payslip.reference)
    db.commit()
    db.refresh(payslip)
    return _out(payslip)


@router.post("/payslips/{payslip_id}/valider", response_model=PayslipOut)
def validate_payslip(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_valider")),
):
    payslip = _payslip(db, payslip_id)
    if payslip.status != DRAFT:
        raise HTTPException(status_code=400, detail="Paie déjà validée")
    payslip.status = VALIDATED
    payslip.validated_at = utcnow()
    _trace(db, current_user, "paie_validee", payslip.reference)
    db.commit()
    db.refresh(payslip)
    return _out(payslip)


@router.post("/payslips/{payslip_id}/payer", response_model=PayslipOut)
def pay_payslip(
    payslip_id: int,
    payload: PayslipCreate | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_payer")),
):
    payslip = _payslip(db, payslip_id)
    if payslip.status == CANCELLED:
        raise HTTPException(status_code=400, detail="Paie annulée")
    if payslip.status == PAID:
        raise HTTPException(status_code=400, detail="Paie déjà réglée")
    if payslip.status == DRAFT:
        payslip.status = VALIDATED
        payslip.validated_at = utcnow()
    payslip.status = PAID
    payslip.paid_at = utcnow()
    if payload is not None and payload.payment_method:
        payslip.payment_method = payload.payment_method
    _trace(db, current_user, "paie_payee", payslip.reference)
    db.commit()
    db.refresh(payslip)
    return _out(payslip)


@router.post("/payslips/{payslip_id}/annuler", response_model=PayslipOut)
def cancel_payslip(
    payslip_id: int,
    payload: PayslipCancel,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_annuler")),
):
    payslip = _payslip(db, payslip_id)
    if payslip.status == CANCELLED:
        raise HTTPException(status_code=400, detail="Paie déjà annulée")
    if not payload.reason.strip():
        raise HTTPException(
            status_code=400, detail="Indiquez le motif de l'annulation"
        )
    payslip.status = CANCELLED
    payslip.cancel_reason = payload.reason.strip()
    _trace(
        db,
        current_user,
        "paie_annulee",
        f"{payslip.reference} — {payslip.cancel_reason}",
    )
    db.commit()
    db.refresh(payslip)
    return _out(payslip)


@router.delete("/payslips/{payslip_id}", status_code=204)
def delete_payslip(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("paie_annuler")),
):
    """Only a draft disappears; a validated payslip stays in the history."""
    payslip = _payslip(db, payslip_id)
    if payslip.status != DRAFT:
        raise HTTPException(
            status_code=400,
            detail="Une paie validée se conserve : annulez-la avec un motif",
        )
    _trace(db, current_user, "paie_supprimee", payslip.reference)
    db.delete(payslip)
    db.commit()


@router.get("/recap", response_model=PayrollSummary)
def summary(
    year: int = 0,
    month: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("paie")),
):
    """State of a month: one line per worker and the totals of the shop."""
    now = datetime.now()
    year = year or now.year
    month = month or now.month
    answer = PayrollSummary(year=year, month=month)
    rows = (
        db.query(Payslip)
        .filter(
            Payslip.year == year,
            Payslip.month == month,
            Payslip.status != CANCELLED,
        )
        .all()
    )
    for row in rows:
        employee = row.employee
        answer.employees += 1
        answer.base_total += row.base_salary
        answer.gross_total += row.gross
        answer.deductions_total += row.deductions
        answer.net_total += row.net
        answer.rows.append(
            PayrollSummaryRow(
                matricule=employee.matricule if employee else "",
                employee=employee.full_name if employee else "",
                job=employee.job if employee else "",
                gross=row.gross,
                deductions=row.deductions,
                net=row.net,
                status=row.status,
            )
        )
    answer.gains_total = round(answer.gross_total - answer.base_total, 2)
    answer.rows.sort(key=lambda line: line.employee)
    return answer
