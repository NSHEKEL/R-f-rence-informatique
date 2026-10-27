import sys
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker


def _db_path() -> Path:
    """Resolve a writable location for the SQLite database.

    When packaged as a standalone executable (PyInstaller), the app runs from a
    read-only temp directory, so the database is stored in the user's home
    directory instead. In development it stays next to the backend package.
    """
    if getattr(sys, "frozen", False):
        data_dir = Path.home() / "ReferenceInformatique"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "reference.db"
    return Path(__file__).resolve().parent.parent / "reference.db"


DATABASE_URL = f"sqlite:///{_db_path()}"

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


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
