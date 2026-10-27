"""Workstations and phones currently talking to this server.

Kept in memory only: it describes the running session, not business data, and
must not grow the database with one row per request.
"""

from datetime import datetime, timedelta
from threading import Lock
from typing import Dict, List, Optional

# A workstation is considered gone when it stops calling the API.
ACTIVE_FOR = timedelta(minutes=10)

_seen: Dict[str, Dict[str, object]] = {}
_lock = Lock()


def record(address: str, user_id: Optional[int]) -> None:
    if not address:
        return
    with _lock:
        entry = _seen.setdefault(address, {"address": address, "user_id": None})
        entry["last_seen"] = datetime.now()
        if user_id:
            entry["user_id"] = user_id


def connected() -> List[Dict[str, object]]:
    """Addresses seen recently, most recent first."""
    limit = datetime.now() - ACTIVE_FOR
    with _lock:
        for address in [
            address
            for address, entry in _seen.items()
            if entry["last_seen"] < limit - timedelta(hours=12)
        ]:
            del _seen[address]
        return sorted(
            (
                {
                    "address": entry["address"],
                    "user_id": entry["user_id"],
                    "last_seen": entry["last_seen"].isoformat(timespec="seconds"),
                    "active": entry["last_seen"] >= limit,
                }
                for entry in _seen.values()
            ),
            key=lambda entry: entry["last_seen"],
            reverse=True,
        )
