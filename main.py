"""Entry point of the central server deployed on Vercel.

Vercel loads this module and serves the ASGI application it exposes as
``app``. The shop installations then reach the licences over HTTPS instead of
the local network. The database is PostgreSQL (Neon) through
``CENTRAL_DATABASE_URL``.
"""

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.central.seed import seed  # noqa: E402
from app.central.server import app  # noqa: E402

# A serverless invocation does not always run the ASGI lifespan, so the
# formulas and features are seeded at import time instead.
seed()
