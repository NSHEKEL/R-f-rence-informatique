from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import MirrorOperationLock


def lock_operations(db, client_id, installation_uid, operation_ids):
    identities = [{"client_id": client_id, "installation_uid": installation_uid, "operation_id": operation_id}
                  for operation_id in sorted({str(value) for value in operation_ids if value})]
    if not identities:
        return
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else postgresql_insert
    statement = insert(MirrorOperationLock)
    db.execute(statement.on_conflict_do_update(
        index_elements=["client_id", "installation_uid", "operation_id"],
        set_={"operation_id": statement.excluded.operation_id},
    ), identities)
