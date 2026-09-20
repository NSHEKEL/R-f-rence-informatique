"""Payroll engine: turns a worker and a month into payslip lines.

The rules themselves live in the database (Paie → Paramètres), never in this
code: no rate, no ceiling and no social contribution is hard-coded, so each
shop configures what its country requires. A computed payslip keeps its own
lines, which is what makes an old payslip stay true after a rule changes.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .models import Employee, PayrollElement

# Working days used to price a day of absence when the shop set none.
DEFAULT_MONTH_DAYS = 30.0
GAIN = "gain"
DEDUCTION = "retenue"


@dataclass
class Computed:
    """One line of the payslip, with the numbers that produced it."""

    kind: str
    label: str
    quantity: float = 0.0
    rate: float = 0.0
    base: float = 0.0
    amount: float = 0.0
    element_id: int | None = None


@dataclass
class Draft:
    """A whole payslip before it is saved."""

    base_salary: float = 0.0
    gross: float = 0.0
    deductions: float = 0.0
    net: float = 0.0
    lines: list[Computed] = field(default_factory=list)


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def applies_on(element: PayrollElement, period_end: datetime) -> bool:
    """True when the rule was in force during the paid month."""
    if not element.is_active:
        return False
    if element.starts_on and _aware(element.starts_on) > period_end:
        return False
    if element.ends_on and _aware(element.ends_on) < period_end:
        return False
    return True


def period_end(year: int, month: int) -> datetime:
    """Last instant of the paid month, used to date the rules."""
    if month >= 12:
        return datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    return datetime(year, month + 1, 1, tzinfo=timezone.utc)


def _capped(amount: float, ceiling: float) -> float:
    return min(amount, ceiling) if ceiling > 0 else amount


def compute(
    employee: Employee,
    elements: list[PayrollElement],
    *,
    absence_days: float = 0.0,
    overtime_hours: float = 0.0,
    overtime_rate: float = 0.0,
    month_days: float = DEFAULT_MONTH_DAYS,
    extra: list[Computed] | None = None,
) -> Draft:
    """Gains first, then the deductions they are based on, then the net.

    ``extra`` carries the exceptional lines typed by hand for this month
    (a bonus, an advance, a fine): they are added to the configured ones.
    """
    draft = Draft(base_salary=round(employee.base_salary or 0.0, 2))
    draft.lines.append(
        Computed(
            kind=GAIN,
            label="Salaire de base",
            quantity=1,
            rate=draft.base_salary,
            base=draft.base_salary,
            amount=draft.base_salary,
        )
    )
    if overtime_hours > 0 and overtime_rate > 0:
        draft.lines.append(
            Computed(
                kind=GAIN,
                label="Heures supplémentaires",
                quantity=overtime_hours,
                rate=overtime_rate,
                base=draft.base_salary,
                amount=round(overtime_hours * overtime_rate, 2),
            )
        )
    manual = list(extra or [])
    for line in manual:
        if line.kind == GAIN:
            draft.lines.append(line)

    for element in [e for e in elements if e.kind == GAIN]:
        amount = (
            element.value
            if element.mode == "fixe"
            else draft.base_salary * element.value / 100
        )
        amount = round(_capped(amount, element.ceiling), 2)
        if amount <= 0:
            continue
        draft.lines.append(
            Computed(
                kind=GAIN,
                label=element.name,
                quantity=1,
                rate=element.value,
                base=draft.base_salary,
                amount=amount,
                element_id=element.id,
            )
        )

    draft.gross = round(sum(line.amount for line in draft.lines), 2)

    if absence_days > 0 and month_days > 0:
        daily = draft.base_salary / month_days
        draft.lines.append(
            Computed(
                kind=DEDUCTION,
                label="Absences",
                quantity=absence_days,
                rate=round(daily, 2),
                base=draft.base_salary,
                amount=round(daily * absence_days, 2),
            )
        )
    for line in manual:
        if line.kind == DEDUCTION:
            draft.lines.append(line)

    for element in [e for e in elements if e.kind == DEDUCTION]:
        basis = draft.gross if element.base == "brut" else draft.base_salary
        amount = (
            element.value
            if element.mode == "fixe"
            else _capped(basis, element.ceiling) * element.value / 100
        )
        amount = round(amount, 2)
        if amount <= 0:
            continue
        draft.lines.append(
            Computed(
                kind=DEDUCTION,
                label=element.name,
                quantity=1,
                rate=element.value,
                base=round(basis, 2),
                amount=amount,
                element_id=element.id,
            )
        )

    draft.deductions = round(
        sum(line.amount for line in draft.lines if line.kind == DEDUCTION), 2
    )
    draft.net = round(draft.gross - draft.deductions, 2)
    return draft


UNITS = (
    "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit",
    "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
    "dix-sept", "dix-huit", "dix-neuf",
)
TENS = (
    "", "", "vingt", "trente", "quarante", "cinquante", "soixante",
    "soixante", "quatre-vingt", "quatre-vingt",
)


def _below_hundred(number: int) -> str:
    if number < 20:
        return UNITS[number]
    ten, unit = divmod(number, 10)
    if ten in (7, 9):
        ten, unit = ten - 1, unit + 10
    word = TENS[ten]
    if unit == 0:
        return word + ("s" if ten in (8,) else "")
    if unit == 1 and ten in (2, 3, 4, 5, 6):
        return f"{word} et un"
    if unit == 11 and ten in (6, 8):
        return f"{word} et onze" if ten == 6 else f"{word}-onze"
    return f"{word}-{UNITS[unit]}"


def _below_thousand(number: int) -> str:
    hundred, rest = divmod(number, 100)
    if hundred == 0:
        return _below_hundred(rest)
    head = "cent" if hundred == 1 else f"{UNITS[hundred]} cent"
    if rest == 0:
        return head + ("s" if hundred > 1 else "")
    return f"{head} {_below_hundred(rest)}"


def in_words(amount: float) -> str:
    """French wording of a whole amount, printed on the payslip."""
    number = int(round(amount))
    if number == 0:
        return "zéro"
    scales = ((1_000_000_000, "milliard"), (1_000_000, "million"), (1_000, "mille"))
    parts: list[str] = []
    for value, name in scales:
        count, number = divmod(number, value)
        if not count:
            continue
        if name == "mille":
            head = "" if count == 1 else f"{_below_thousand(count)} "
            parts.append(f"{head}mille".strip())
        else:
            plural = "s" if count > 1 else ""
            parts.append(f"{_below_thousand(count)} {name}{plural}")
    if number:
        parts.append(_below_thousand(number))
    return " ".join(parts)
