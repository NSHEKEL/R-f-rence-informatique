import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker

from .paths import apply_pending_restore, data_dir, database_file


def _load_env() -> None:
    """Read the deployment settings (DATABASE_URL, SECRET_KEY, ...).

    A workstation configures the shared server by editing the `.env` file of
    the data directory (or dropping one next to the executable); in
    development it lives in `backend/`.
    """
    candidates = [Path(__file__).resolve().parent.parent / ".env"]
    if getattr(sys, "frozen", False):
        candidates.insert(0, Path(sys.executable).resolve().parent / ".env")
        candidates.insert(1, data_dir() / ".env")
    for candidate in candidates:
        if candidate.exists():
            load_dotenv(candidate, override=False)


_load_env()


def _sqlite_path() -> Path:
    """Writable location for the single-workstation SQLite database.

    The installed application runs from a read-only directory, so the database
    lives in the per-user data directory (%APPDATA%\\EasyGest on Windows). In
    development it stays next to the backend package.
    """
    if getattr(sys, "frozen", False):
        return database_file()
    development = Path(__file__).resolve().parent.parent / "reference.db"
    apply_pending_restore(development)
    return development


def _normalize(url: str) -> str:
    """Accept the `postgres://` form handed out by hosting providers."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


# Central deployments point DATABASE_URL at a shared PostgreSQL server; without
# it the app keeps its local SQLite file (single workstation / demo).
DATABASE_URL = _normalize(
    os.getenv("DATABASE_URL", "").strip() or f"sqlite:///{_sqlite_path()}"
)

IS_SQLITE = make_url(DATABASE_URL).get_backend_name() == "sqlite"

if IS_SQLITE:
    engine = create_engine(
        DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30}
    )

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _connection_record):
        """Tune SQLite for several workstations hitting the same database."""
        cursor = dbapi_connection.cursor()
        # WAL lets readers work while another post is writing.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        # Wait instead of raising "database is locked" on concurrent writes.
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

else:
    engine = create_engine(
        DATABASE_URL,
        # Sized for a shop: a handful of tills, each with a few parallel calls.
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        # Recycle before managed providers drop idle connections.
        pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "1800")),
        pool_pre_ping=True,
    )


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
