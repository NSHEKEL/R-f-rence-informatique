"""Database of the central service, separate from any shop database."""

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker


def _normalize(url: str) -> str:
    """Accept the `postgres://` form handed out by hosting providers."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _default_url() -> str:
    """Local SQLite file, so the console can be run without any hosting."""
    directory = Path(
        os.getenv("CENTRAL_DATA_DIR", "").strip()
        or Path(__file__).resolve().parent.parent.parent
    )
    directory.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{directory / 'central.db'}"


CENTRAL_DATABASE_URL = _normalize(
    os.getenv("CENTRAL_DATABASE_URL", "").strip() or _default_url()
)

IS_SQLITE = make_url(CENTRAL_DATABASE_URL).get_backend_name() == "sqlite"

engine = create_engine(
    CENTRAL_DATABASE_URL,
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
    pool_pre_ping=not IS_SQLITE,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
