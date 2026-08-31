"""Everything the global administrator does from the console."""

from datetime import datetime, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    STATUS_ACTIVE,
    STATUS_EXPIRED,
    STATUS_REVOKED,
    STATUS_SUSPENDED,
    AdminLog,
    Client,
    Feature,
    GlobalAdmin,
    Installation,
    License,
    Plan,
    PlanFeature,
)
from ..schemas import (
    ClientCreate,
    ClientDetail,
    ClientPage,
    ClientRow,
    ClientUpdate,
    DashboardStats,
    FeatureOut,
    InstallationOut,
    LicenseAction,
    LicenseOut,
    LicenseRenew,
    LogOut,
    PlanChange,
    PlanCreate,
    PlanOut,
    PlanRight,
    PlanRightUpdate,
    PlanUpdate,
)
from ..security import current_admin
from ..service import (
    aware,
    create_license,
    current_license,
    days_left,
    effective_status,
    is_online,
    log,
    plan_feature_codes,
    status_label,
    utcnow,
)

router = APIRouter(prefix="/api/central", tags=["central-console"])

EXPIRING_SOON_DAYS = 30


# --------------------------------------------------------------- dashboard


@router.get("/dashboard", response_model=DashboardStats)
def dashboard(
    db: Session = Depends(get_db), _: GlobalAdmin = Depends(current_admin)
):
    clients = db.query(Client).all()
    stats = DashboardStats(clients=len(clients), per_plan={})
    for client in clients:
        license_ = current_license(db, client)
        if license_ is None:
            continue
        plan_name = license_.plan.name if license_.plan else "—"
        stats.per_plan[plan_name] = stats.per_plan.get(plan_name, 0) + 1
        status = effective_status(license_)
        if status == STATUS_ACTIVE:
            stats.active += 1
            left = days_left(license_)
            if left is not None and 0 <= left <= EXPIRING_SOON_DAYS:
                stats.expiring_soon += 1
        elif status == STATUS_SUSPENDED:
            stats.suspended += 1
        elif status == STATUS_EXPIRED:
            stats.expired += 1
        elif status == STATUS_REVOKED:
            stats.revoked += 1
    installations = db.query(Installation).all()
    seen_clients = set()
    for installation in installations:
        if is_online(installation):
            seen_clients.add(installation.client_id)
    stats.online = len(seen_clients)
    stats.offline = max(stats.clients - stats.online, 0)
    stats.signups = _signups(clients)
    return stats


def _signups(clients: list[Client]) -> list[dict]:
    """New clients per month, for the console chart."""
    buckets: dict[str, int] = {}
    for client in clients:
        created = aware(client.created_at)
        if created is None:
            continue
        key = created.strftime("%Y-%m")
        buckets[key] = buckets.get(key, 0) + 1
    return [
        {"month": key, "clients": buckets[key]} for key in sorted(buckets)[-12:]
    ]


# ------------------------------------------------------------------- plans


def _plan_out(db: Session, plan: Plan) -> PlanOut:
    switches = {row.feature_id: row.allowed for row in plan.rights}
    features = db.query(Feature).order_by(Feature.position).all()
    clients_count = (
        db.query(func.count(func.distinct(License.client_id)))
        .filter(License.plan_id == plan.id)
        .scalar()
        or 0
    )
    return PlanOut(
        id=plan.id,
        code=plan.code,
        name=plan.name,
        description=plan.description or "",
        price=plan.price or 0,
        currency=plan.currency or "FCFA",
        duration_days=plan.duration_days or 0,
        grace_days=plan.grace_days or 0,
        is_active=plan.is_active,
        is_public=plan.is_public,
        clients_count=clients_count,
        rights=[
            PlanRight(
                code=feature.code,
                name=feature.name,
                section=feature.section or "",
                allowed=bool(switches.get(feature.id, False)),
            )
            for feature in features
        ],
    )


@router.get("/features", response_model=list[FeatureOut])
def list_features(
    db: Session = Depends(get_db), _: GlobalAdmin = Depends(current_admin)
):
    return db.query(Feature).order_by(Feature.position).all()


@router.get("/plans", response_model=list[PlanOut])
def list_plans(
    db: Session = Depends(get_db), _: GlobalAdmin = Depends(current_admin)
):
    plans = db.query(Plan).order_by(Plan.position, Plan.id).all()
    return [_plan_out(db, plan) for plan in plans]


@router.post("/plans", response_model=PlanOut, status_code=201)
def create_plan(
    payload: PlanCreate,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    code = payload.code.strip().lower()
    if not code:
        raise HTTPException(status_code=400, detail="Code de formule obligatoire")
    if db.query(Plan).filter(Plan.code == code).first():
        raise HTTPException(status_code=400, detail="Cette formule existe déjà")
    position = (db.query(func.max(Plan.position)).scalar() or 0) + 1
    plan = Plan(
        code=code,
        name=payload.name.strip() or code.title(),
        description=payload.description,
        price=payload.price,
        currency=payload.currency,
        duration_days=payload.duration_days,
        grace_days=payload.grace_days,
        is_public=payload.is_public,
        position=position,
    )
    db.add(plan)
    db.flush()
    for feature in db.query(Feature).all():
        db.add(PlanFeature(plan_id=plan.id, feature_id=feature.id, allowed=False))
    db.commit()
    db.refresh(plan)
    log(db, admin, None, "Création formule", "", plan.name)
    return _plan_out(db, plan)


@router.put("/plans/{plan_id}", response_model=PlanOut)
def update_plan(
    plan_id: int,
    payload: PlanUpdate,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if plan is None:
        raise HTTPException(status_code=404, detail="Formule introuvable")
    before = f"{plan.name} · {plan.duration_days} j · grâce {plan.grace_days} j"
    if payload.name is not None:
        plan.name = payload.name
    if payload.description is not None:
        plan.description = payload.description
    if payload.price is not None:
        plan.price = payload.price
    if payload.currency is not None:
        plan.currency = payload.currency
    if payload.duration_days is not None:
        plan.duration_days = payload.duration_days
    if payload.grace_days is not None:
        plan.grace_days = payload.grace_days
    if payload.is_active is not None:
        plan.is_active = payload.is_active
    if payload.is_public is not None:
        plan.is_public = payload.is_public
    if payload.position is not None:
        plan.position = payload.position
    db.commit()
    db.refresh(plan)
    after = f"{plan.name} · {plan.duration_days} j · grâce {plan.grace_days} j"
    log(db, admin, None, "Modification formule", before, after)
    return _plan_out(db, plan)


@router.put("/plans/{plan_id}/rights", response_model=PlanOut)
def set_plan_right(
    plan_id: int,
    payload: PlanRightUpdate,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    """The ON/OFF switch of "Formules & Droits"."""
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if plan is None:
        raise HTTPException(status_code=404, detail="Formule introuvable")
    feature = (
        db.query(Feature).filter(Feature.code == payload.feature_code).first()
    )
    if feature is None:
        raise HTTPException(status_code=404, detail="Fonctionnalité introuvable")
    row = (
        db.query(PlanFeature)
        .filter(
            PlanFeature.plan_id == plan.id,
            PlanFeature.feature_id == feature.id,
        )
        .first()
    )
    was = bool(row.allowed) if row else False
    if row is None:
        db.add(
            PlanFeature(
                plan_id=plan.id, feature_id=feature.id, allowed=payload.allowed
            )
        )
    else:
        row.allowed = payload.allowed
    db.commit()
    db.refresh(plan)
    log(
        db,
        admin,
        None,
        "Activation fonctionnalité" if payload.allowed else "Désactivation fonctionnalité",
        f"{plan.name} · {feature.name} : {'ON' if was else 'OFF'}",
        f"{plan.name} · {feature.name} : {'ON' if payload.allowed else 'OFF'}",
    )
    return _plan_out(db, plan)


# ----------------------------------------------------------------- clients


def _moment(value: Optional[datetime]) -> tuple[int, float | str]:
    """Sort key placing the rows without a date at the end."""
    return (1, 0.0) if value is None else (0, value.timestamp())


def _client_row(db: Session, client: Client) -> ClientRow:
    license_ = current_license(db, client)
    installation = (
        db.query(Installation)
        .filter(Installation.client_id == client.id)
        .order_by(Installation.last_seen.desc().nullslast())
        .first()
    )
    status = effective_status(license_) if license_ else ""
    return ClientRow(
        id=client.id,
        company=client.company,
        manager=client.manager or "",
        phone=client.phone or "",
        email=client.email or "",
        city=client.city or "",
        installation_uid=installation.uid if installation else "",
        plan_code=license_.plan.code if license_ and license_.plan else "",
        plan_name=license_.plan.name if license_ and license_.plan else "",
        starts_at=aware(license_.starts_at) if license_ else None,
        ends_at=aware(license_.ends_at) if license_ else None,
        status=status,
        status_label=status_label(status) if status else "",
        last_seen=aware(installation.last_seen) if installation else None,
        last_sync=aware(installation.last_sync) if installation else None,
        version=installation.version if installation else "",
        users_count=installation.users_count if installation else 0,
        online=is_online(installation) if installation else False,
    )


@router.get("/clients", response_model=ClientPage)
def list_clients(
    db: Session = Depends(get_db),
    _: GlobalAdmin = Depends(current_admin),
    search: str = "",
    status: str = "",
    plan: str = "",
    sort: str = "company",
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
):
    query = db.query(Client)
    needle = search.strip()
    if needle:
        like = f"%{needle}%"
        query = query.filter(
            or_(
                Client.company.ilike(like),
                Client.manager.ilike(like),
                Client.email.ilike(like),
                Client.phone.ilike(like),
                Client.city.ilike(like),
            )
        )
    rows = [_client_row(db, client) for client in query.all()]
    if status:
        rows = [row for row in rows if row.status == status]
    if plan:
        rows = [row for row in rows if row.plan_code == plan]
    reverse = sort.startswith("-")
    key = sort.lstrip("-") or "company"

    # Only the columns of the table can be sorted on.
    sorters: dict[str, Callable[[ClientRow], tuple[int, float | str]]] = {
        "company": lambda row: (0, row.company.lower()),
        "manager": lambda row: (0, row.manager.lower()),
        "city": lambda row: (0, row.city.lower()),
        "plan": lambda row: (0, row.plan_name.lower()),
        "status": lambda row: (0, row.status),
        "version": lambda row: (0, row.version),
        "users": lambda row: (0, float(row.users_count)),
        "ends_at": lambda row: _moment(row.ends_at),
        "starts_at": lambda row: _moment(row.starts_at),
        "last_seen": lambda row: _moment(row.last_seen),
        "last_sync": lambda row: _moment(row.last_sync),
    }
    sort_key = sorters.get(key, sorters["company"])

    rows.sort(key=sort_key, reverse=reverse)
    total = len(rows)
    pages = max((total + size - 1) // size, 1)
    start = (page - 1) * size
    return ClientPage(
        total=total, page=page, pages=pages, rows=rows[start : start + size]
    )


def _license_out(db: Session, license_: Optional[License]) -> Optional[LicenseOut]:
    if license_ is None:
        return None
    status = effective_status(license_)
    return LicenseOut(
        id=license_.id,
        key=license_.key,
        plan_code=license_.plan.code if license_.plan else "",
        plan_name=license_.plan.name if license_.plan else "",
        starts_at=aware(license_.starts_at),
        ends_at=aware(license_.ends_at),
        grace_days=license_.grace_days or 0,
        status=status,
        status_label=status_label(status),
        suspended_reason=license_.suspended_reason or "",
        days_left=days_left(license_),
    )


def _client_detail(db: Session, client: Client) -> ClientDetail:
    license_ = current_license(db, client)
    installations = (
        db.query(Installation).filter(Installation.client_id == client.id).all()
    )
    return ClientDetail(
        id=client.id,
        company=client.company,
        manager=client.manager or "",
        phone=client.phone or "",
        email=client.email or "",
        address=client.address or "",
        city=client.city or "",
        note=client.note or "",
        created_at=aware(client.created_at),
        license=_license_out(db, license_),
        installations=[
            InstallationOut(
                id=row.id,
                uid=row.uid,
                hostname=row.hostname or "",
                version=row.version or "",
                users_count=row.users_count or 0,
                last_seen=aware(row.last_seen),
                last_sync=aware(row.last_sync),
                last_ip=row.last_ip or "",
                is_revoked=row.is_revoked,
                online=is_online(row),
            )
            for row in installations
        ],
        features=plan_feature_codes(db, license_.plan)
        if license_ and license_.plan
        else [],
    )


def _client_or_404(db: Session, client_id: int) -> Client:
    client = db.query(Client).filter(Client.id == client_id).first()
    if client is None:
        raise HTTPException(status_code=404, detail="Client introuvable")
    return client


@router.get("/clients/{client_id}", response_model=ClientDetail)
def client_detail(
    client_id: int,
    db: Session = Depends(get_db),
    _: GlobalAdmin = Depends(current_admin),
):
    return _client_detail(db, _client_or_404(db, client_id))


@router.post("/clients", response_model=ClientDetail, status_code=201)
def create_client(
    payload: ClientCreate,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    plan = db.query(Plan).filter(Plan.code == payload.plan_code).first()
    if plan is None:
        raise HTTPException(status_code=404, detail="Formule introuvable")
    client = Client(
        company=payload.company.strip(),
        manager=payload.manager,
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        city=payload.city,
        note=payload.note,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    create_license(db, client, plan, payload.duration_days)
    log(db, admin, client, "Création client", "", f"{client.company} · {plan.name}")
    return _client_detail(db, client)


@router.put("/clients/{client_id}", response_model=ClientDetail)
def update_client(
    client_id: int,
    payload: ClientUpdate,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    client = _client_or_404(db, client_id)
    before = f"{client.company} · {client.manager} · {client.phone}"
    if payload.company is not None:
        client.company = payload.company
    if payload.manager is not None:
        client.manager = payload.manager
    if payload.phone is not None:
        client.phone = payload.phone
    if payload.email is not None:
        client.email = payload.email
    if payload.address is not None:
        client.address = payload.address
    if payload.city is not None:
        client.city = payload.city
    if payload.note is not None:
        client.note = payload.note
    db.commit()
    db.refresh(client)
    log(
        db,
        admin,
        client,
        "Modification client",
        before,
        f"{client.company} · {client.manager} · {client.phone}",
    )
    return _client_detail(db, client)


@router.put("/clients/{client_id}/plan", response_model=ClientDetail)
def change_plan(
    client_id: int,
    payload: PlanChange,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    """Business → Entreprise and back; the client keeps every row of data."""
    client = _client_or_404(db, client_id)
    plan = db.query(Plan).filter(Plan.code == payload.plan_code).first()
    if plan is None:
        raise HTTPException(status_code=404, detail="Formule introuvable")
    license_ = current_license(db, client)
    if license_ is None:
        create_license(db, client, plan)
        log(db, admin, client, "Modification formule", "—", plan.name)
        return _client_detail(db, client)
    before = license_.plan.name if license_.plan else "—"
    license_.plan_id = plan.id
    license_.grace_days = plan.grace_days
    db.commit()
    log(db, admin, client, "Modification formule", before, plan.name)
    return _client_detail(db, client)


ACTIONS = {
    "activer": STATUS_ACTIVE,
    "activate": STATUS_ACTIVE,
    "suspendre": STATUS_SUSPENDED,
    "suspend": STATUS_SUSPENDED,
    "reactiver": STATUS_ACTIVE,
    "reactivate": STATUS_ACTIVE,
    "expirer": STATUS_EXPIRED,
    "expire": STATUS_EXPIRED,
    "revoquer": STATUS_REVOKED,
    "revoke": STATUS_REVOKED,
}

ACTION_LABELS = {
    STATUS_ACTIVE: "Activation licence",
    STATUS_SUSPENDED: "Suspension",
    STATUS_EXPIRED: "Expiration",
    STATUS_REVOKED: "Révocation",
}


@router.post("/clients/{client_id}/license", response_model=ClientDetail)
def license_action(
    client_id: int,
    payload: LicenseAction,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    client = _client_or_404(db, client_id)
    license_ = current_license(db, client)
    if license_ is None:
        raise HTTPException(status_code=404, detail="Aucune licence")
    action = payload.action.strip().lower()
    target = ACTIONS.get(action)
    if target is None:
        raise HTTPException(status_code=400, detail="Action inconnue")
    before = status_label(effective_status(license_))
    if target == STATUS_ACTIVE:
        # Reactivating an expired licence would flip straight back: push the
        # end date away by the plan duration so the client really works again.
        ends = aware(license_.ends_at)
        if ends is not None and ends < utcnow():
            days = (license_.plan.duration_days if license_.plan else 365) or 365
            license_.ends_at = utcnow() + timedelta(days=days)
        license_.suspended_reason = ""
    if target == STATUS_SUSPENDED:
        license_.suspended_reason = payload.reason
    license_.status = target
    db.commit()
    log(
        db,
        admin,
        client,
        "Réactivation"
        if action in ("reactiver", "reactivate")
        else ACTION_LABELS[target],
        before,
        status_label(target) + (f" ({payload.reason})" if payload.reason else ""),
    )
    return _client_detail(db, client)


@router.post("/clients/{client_id}/renew", response_model=ClientDetail)
def renew_license(
    client_id: int,
    payload: LicenseRenew,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    client = _client_or_404(db, client_id)
    license_ = current_license(db, client)
    if license_ is None:
        raise HTTPException(status_code=404, detail="Aucune licence")
    before = (
        aware(license_.ends_at).strftime("%d/%m/%Y") if license_.ends_at else "illimitée"
    )
    if payload.ends_at is not None:
        license_.ends_at = payload.ends_at
    elif payload.duration_days:
        start = max(aware(license_.ends_at) or utcnow(), utcnow())
        license_.ends_at = start + timedelta(days=payload.duration_days)
    if payload.grace_days is not None:
        license_.grace_days = payload.grace_days
    license_.status = STATUS_ACTIVE
    db.commit()
    after = (
        aware(license_.ends_at).strftime("%d/%m/%Y") if license_.ends_at else "illimitée"
    )
    log(db, admin, client, "Renouvellement", before, after)
    return _client_detail(db, client)


@router.post("/installations/{installation_id}/revoke", response_model=ClientDetail)
def revoke_installation(
    installation_id: int,
    db: Session = Depends(get_db),
    admin: GlobalAdmin = Depends(current_admin),
):
    installation = (
        db.query(Installation).filter(Installation.id == installation_id).first()
    )
    if installation is None:
        raise HTTPException(status_code=404, detail="Installation introuvable")
    installation.is_revoked = not installation.is_revoked
    db.commit()
    client = installation.client
    log(
        db,
        admin,
        client,
        "Révocation installation" if installation.is_revoked else "Réautorisation installation",
        installation.uid,
        "révoquée" if installation.is_revoked else "autorisée",
    )
    return _client_detail(db, client)


# ------------------------------------------------------------------ journal


@router.get("/logs", response_model=list[LogOut])
def logs(
    db: Session = Depends(get_db),
    _: GlobalAdmin = Depends(current_admin),
    client_id: Optional[int] = None,
    limit: int = Query(200, ge=1, le=1000),
):
    query = db.query(AdminLog).order_by(AdminLog.id.desc())
    if client_id:
        query = query.filter(AdminLog.client_id == client_id)
    return query.limit(limit).all()
