"""In-process event broker feeding the console's real-time stream (SSE).

When a shop pushes a new sale or a support request, one event is published
here; every connected console tab receives it within a second. Purely
in-memory: if the central server restarts, consoles simply reconnect.
"""

import json
import queue
import threading

_subscribers: list[queue.Queue] = []
_lock = threading.Lock()


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=100)
    with _lock:
        _subscribers.append(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    with _lock:
        if q in _subscribers:
            _subscribers.remove(q)


def publish(kind: str, data: dict) -> None:
    event = {"kind": kind, **data}
    with _lock:
        targets = list(_subscribers)
    for q in targets:
        try:
            q.put_nowait(event)
        except queue.Full:
            pass  # a stalled tab must not block the shops


def encode(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
