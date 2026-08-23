"""Copy the local EasyGest database into the online PostgreSQL database.

Run it once, on the computer holding the data, before switching the shop to
the online server:

    python transfer_to_postgres.py "postgresql://user:pass@host/db"

The source is the SQLite file the application uses (or SOURCE_URL). Existing
rows in the destination are kept only if the table is empty; otherwise the
table is emptied first so the copy is exact.
"""

import sys

from sqlalchemy import create_engine, delete, insert, select
from sqlalchemy.engine import make_url

from app.database import DATABASE_URL, Base
from app import models  # noqa: F401  (registers every table on Base)


def transfer(source_url: str, target_url: str) -> None:
    source = create_engine(source_url)
    target = create_engine(target_url)
    Base.metadata.create_all(bind=target)

    with source.connect() as src, target.begin() as dst:
        for table in Base.metadata.sorted_tables:
            rows = [dict(row) for row in src.execute(select(table)).mappings()]
            dst.execute(delete(table))
            if rows:
                dst.execute(insert(table), rows)
            print(f"{table.name}: {len(rows)} ligne(s)")

        # PostgreSQL keeps its own counter for the identity columns.
        if make_url(target_url).get_backend_name() == "postgresql":
            for table in Base.metadata.sorted_tables:
                if "id" in table.c:
                    dst.exec_driver_sql(
                        "SELECT setval(pg_get_serial_sequence(%s, 'id'), "
                        "COALESCE((SELECT MAX(id) FROM " + table.name + "), 1))",
                        (table.name,),
                    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    target_url = sys.argv[1]
    source_url = sys.argv[2] if len(sys.argv) > 2 else DATABASE_URL
    if make_url(source_url).get_backend_name() != "sqlite":
        print("La source doit être la base locale SQLite.")
        return 2
    transfer(source_url, target_url)
    print("Transfert terminé.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
