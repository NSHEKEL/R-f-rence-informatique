"""Transactional depot stock; Product.quantity remains the compatibility total."""

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import Depot, DepotStock, DepotTransferItem, InventoryCount, Product, ProductBarcode


def _insert(connection, table, values, keys):
    insert = sqlite_insert if connection.dialect.name == "sqlite" else pg_insert
    connection.execute(insert(table).values(**values).on_conflict_do_nothing(index_elements=keys))


def default_id(connection):
    depot_id = connection.execute(select(Depot.id).where(Depot.is_default.is_(True))).scalar_one_or_none()
    if depot_id is None:
        _insert(connection, Depot.__table__, {"code": "PRINCIPAL", "name": "Magasin principal", "is_default": True, "active": True}, ["code"])
        depot_id = connection.execute(select(Depot.id).where(Depot.is_default.is_(True))).scalar_one()
    return depot_id


def resolve(db, depot_id=None, *, active=True):
    depot_id = depot_id if depot_id is not None else default_id(db.connection())
    depot = db.get(Depot, depot_id)
    if depot is None or (active and not depot.active):
        raise HTTPException(400, "Dépôt introuvable ou désactivé")
    return depot.id


def quantity(db, product_id, depot_id=None):
    depot_id = resolve(db, depot_id, active=False)
    return int(db.execute(select(DepotStock.quantity).where(DepotStock.product_id == product_id, DepotStock.depot_id == depot_id)).scalar_one_or_none() or 0)


def reconcile(connection, product_id, total):
    """Initialize ORM inserts and retain compatibility with old ORM writers."""
    depot_id = default_id(connection)
    stocks = DepotStock.__table__
    current = connection.execute(select(func.coalesce(func.sum(stocks.c.quantity), 0)).where(stocks.c.product_id == product_id)).scalar_one()
    _insert(connection, stocks, {"depot_id": depot_id, "product_id": product_id, "quantity": 0}, ["depot_id", "product_id"])
    delta = int(total) - int(current)
    if delta:
        connection.execute(stocks.update().where(stocks.c.product_id == product_id, stocks.c.depot_id == depot_id).values(quantity=stocks.c.quantity + delta))


def adjust(db, product, delta, depot_id=None, *, allow_negative=True, active=True, check_total=False):
    depot_id = resolve(db, depot_id, active=active)
    db.flush()
    # Lock the compatibility row first, serializing every depot mutation of it.
    changed = db.execute(update(Product).where(Product.id == product.id).values(quantity=Product.quantity))
    if not changed.rowcount:
        raise HTTPException(409, "Article introuvable")
    db.refresh(product, ["quantity"])
    total = product.quantity or 0
    if check_total and total + int(delta) < 0:
        raise HTTPException(400, f"Stock insuffisant pour {product.name}")
    stocks = DepotStock.__table__
    _insert(db.connection(), stocks, {"depot_id": depot_id, "product_id": product.id, "quantity": 0}, ["depot_id", "product_id"])
    statement = stocks.update().where(stocks.c.product_id == product.id, stocks.c.depot_id == depot_id)
    if not allow_negative:
        statement = statement.where(stocks.c.quantity + int(delta) >= 0)
    after = db.execute(statement.values(quantity=stocks.c.quantity + int(delta)).returning(stocks.c.quantity)).scalar_one_or_none()
    if after is None:
        raise HTTPException(400, f"Stock insuffisant dans ce dépôt pour {product.name}")
    product.quantity = total + int(delta)
    db.flush()
    db.refresh(product)
    return after - int(delta), after


def set_total(db, product, total):
    db.flush()
    db.execute(update(Product).where(Product.id == product.id).values(quantity=Product.quantity))
    db.refresh(product, ["quantity"])
    return adjust(db, product, int(total) - (product.quantity or 0))


def create_product(db, **values):
    total = values.pop("quantity", 0)
    product = Product(**values)
    product.quantity = int(total)
    db.add(product)
    db.flush()
    return product


def replay_product(connection, target, other):
    if target is None:
        if connection.execute(select(ProductBarcode.id).where(ProductBarcode.product_id == other["id"]).limit(1)).first():
            raise HTTPException(409, "Conservez cet article pour préserver l'historique des codes")
        if connection.execute(select(DepotTransferItem.id).where(DepotTransferItem.product_id == other["id"]).limit(1)).first() or connection.execute(select(InventoryCount.id).where(InventoryCount.product_id == other["id"]).limit(1)).first():
            raise HTTPException(409, "Conservez cet article pour préserver l'historique des dépôts et inventaires")
        connection.execute(DepotStock.__table__.delete().where(DepotStock.product_id == other["id"]))
        connection.execute(Product.__table__.delete().where(Product.id == other["id"]))
        return
    with Session(bind=connection) as db:
        product = db.get(Product, target["id"])
        values = dict(target)
        total = values.pop("quantity", 0)
        if product is None:
            create_product(db, quantity=total, **values)
        else:
            for key, value in values.items():
                setattr(product, key, value)
            set_total(db, product, total)
        db.flush()


def delete_product(db, product):
    if db.query(DepotTransferItem.id).filter_by(product_id=product.id).first():
        raise HTTPException(400, "Conservez cet article pour préserver l'historique des dépôts")
    db.query(DepotStock).filter_by(product_id=product.id).delete(synchronize_session=False)
    db.delete(product)


def inconsistencies(db):
    totals = select(DepotStock.product_id, func.sum(DepotStock.quantity).label("total")).group_by(DepotStock.product_id).subquery()
    return [{"product_id": row.id, "quantity": row.quantity, "depot_total": int(row.total or 0)} for row in db.execute(select(Product.id, Product.quantity, totals.c.total).outerjoin(totals, totals.c.product_id == Product.id).where(Product.quantity != func.coalesce(totals.c.total, 0)))]
