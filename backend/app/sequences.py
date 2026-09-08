"""Reference numbering shared by every workstation.

Tills checkout concurrently against the same database, so numbers are handed
out by a counter row: the UPDATE locks it until the transaction commits, which
serialises the allocation instead of letting two sales pick the same number.
"""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .models import Counter


def _seed_from(db: Session, column, prefix: str) -> int:
    """Highest number already stored, so existing databases keep counting up."""
    last = db.query(func.max(column)).filter(column.like(f"{prefix}%")).scalar()
    if not last:
        return 0
    try:
        return int(last[len(prefix):])
    except ValueError:
        return 0


def next_reference(db: Session, column, prefix: str) -> str:
    name = prefix.rstrip("-")
    locked = db.execute(
        update(Counter)
        .where(Counter.name == name)
        .values(value=Counter.value + 1)
    ).rowcount
    if locked:
        number = db.execute(
            select(Counter.value).where(Counter.name == name)
        ).scalar_one()
    else:
        number = _seed_from(db, column, prefix) + 1
        db.add(Counter(name=name, value=number))
        db.flush()
    return f"{prefix}{number:04d}"
