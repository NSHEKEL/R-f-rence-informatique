from types import SimpleNamespace
import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import drawer, printing
from ..auth import get_current_user
from ..permissions import has_permission, require_permission, require_any_permission
from ..settings_access import check_company_update
from ..database import get_db
from ..licensing import has_feature
from ..mailer import is_configured, send_mail
from ..models import CompanySettings, User, Product, PriceHistory
from ..pos_display import PosDisplay, read_display
from ..schemas import (
    CompanySettingsOut,
    CompanySettingsUpdate,
    PrinterDevice,
    PrinterList,
    PrintingConfig,
    ProductOut,
)
from .products import _product_out, _stock_allowed

router = APIRouter(prefix="/api/settings", tags=["settings"])

CATALOG_PRICES = {"purchase_price", "sale_price", "wholesale_price", "packaging_sale_price", "wholesale_packaging_price", "semi_wholesale_price", "supplier_purchase_price", "semi_wholesale_min_qty", "wholesale_min_qty"}


@router.get("/catalog", response_model=list[ProductOut])
def catalog_settings(db: Session = Depends(get_db), _: User = Depends(require_any_permission("articles_consulter", "tarifs_consulter"))):
    stock_visible = _stock_allowed(db, _)
    return [_product_out(product, stock_visible) for product in db.query(Product).order_by(Product.name).all()]


@router.put("/catalog/{product_id}", response_model=ProductOut)
def update_catalog_prices(product_id: int, payload: dict[str, float | None], db: Session = Depends(get_db), user: User = Depends(require_permission("tarifs_modifier"))):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Article introuvable")
    for key, value in payload.items():
        nullable = key not in {"purchase_price", "sale_price", "wholesale_price"}
        if key not in CATALOG_PRICES or (value is None and not nullable) or (value is not None and (not math.isfinite(value) or value < 0 or (key.endswith("min_qty") and (value < 1 or not value.is_integer())))):
            raise HTTPException(status_code=400, detail="Tarif ou seuil invalide")
    for key, value in payload.items():
        if getattr(product, key) != value:
            if not key.endswith("min_qty"):
                db.add(PriceHistory(product_id=product.id, field=key, old_value=getattr(product, key), new_value=value, changed_by_id=user.id))
            setattr(product, key, int(value) if value is not None and key.endswith("min_qty") else value)
    db.commit()
    db.refresh(product)
    return _product_out(product, _stock_allowed(db, user))


@router.get('/pos-display', response_model=PosDisplay)
def get_pos_display(db: Session = Depends(get_db), _: User = Depends(require_any_permission("articles_consulter", "vente_nouvelle"))):
    return read_display(_get_or_create(db))


@router.put('/pos-display', response_model=PosDisplay)
def put_pos_display(payload: PosDisplay, db: Session = Depends(get_db), _: User = Depends(require_permission("articles_modifier"))):
    settings = _get_or_create(db)
    settings.pos_display = payload.model_dump_json()
    db.commit()
    return read_display(settings)


def _get_or_create(db: Session) -> CompanySettings:
    settings = db.query(CompanySettings).first()
    if settings is None:
        settings = CompanySettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _to_out(settings: CompanySettings, db=None, user=None) -> CompanySettingsOut:
    """Never expose the SMTP password, only whether mail is usable."""
    out = CompanySettingsOut.model_validate(settings)
    out.smtp_configured = is_configured(settings)
    if db is not None and user is not None:
        mail_visible = has_permission(db, user, "generaux_consulter")
        backup_visible = has_permission(db, user, "sauvegarde_consulter")
        for key, field in CompanySettingsOut.model_fields.items():
            if key.startswith("smtp_") and not mail_visible:
                setattr(out, key, field.default)
            if key.startswith(("backup_", "drive_", "last_backup_")) and not backup_visible:
                setattr(out, key, field.default)
    return out


@router.get("/company", response_model=CompanySettingsOut)
def get_company(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _to_out(_get_or_create(db), db, _)


@router.put("/company", response_model=CompanySettingsOut)
def update_company(
    payload: CompanySettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    settings = _get_or_create(db)
    data = payload.model_dump(exclude_unset=True)
    check_company_update(db, _, data)
    if data.get("receipt_format") in ("80mm", "58mm", "custom") and not has_feature(
        db, "impression_thermique"
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "🔒 L'impression thermique n'est pas incluse dans votre "
                "formule."
            ),
        )
    # An empty password means "keep the stored one".
    if data.get("smtp_password") == "":
        data.pop("smtp_password")
    if settings.printing_config and "printer_name" in data:
        data['printer_name'] = printing.read_config(settings).receipt.printer_name
    for key, value in data.items():
        setattr(settings, key, value)
    if settings.printing_config and any(key in data for key in ("auto_print_cash", "drawer_open_after_sale")):
        config = printing.read_config(settings)
        config.receipt.auto_print = settings.auto_print_cash
        config.receipt.open_drawer = settings.drawer_open_after_sale
        settings.printing_config = config.model_dump_json()
    db.commit()
    db.refresh(settings)
    return _to_out(settings, db, _)


@router.get("/printing", response_model=PrintingConfig)
def get_printing(db: Session = Depends(get_db), _: User = Depends(require_any_permission("imprimantes_consulter", "vente_nouvelle"))):
    """Receipt and label printer settings, with the defaults filled in."""
    return printing.read_config(_get_or_create(db))


@router.put("/printing", response_model=PrintingConfig)
def update_printing(
    payload: PrintingConfig,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("imprimantes_modifier")),
):
    settings = _get_or_create(db)
    previous = printing.read_config(settings)
    if (payload.receipt.auto_print != previous.receipt.auto_print or payload.receipt.open_drawer != previous.receipt.open_drawer) and not has_permission(db, _, "caisse_modifier"):
        raise HTTPException(status_code=403, detail="Modification des réglages de caisse refusée")
    if payload.receipt.width in ("80mm", "58mm", "custom") and not has_feature(
        db, "impression_thermique"
    ):
        raise HTTPException(
            status_code=403,
            detail="🔒 L'impression thermique n'est pas incluse dans votre formule.",
        )
    printing.write_config(settings, payload)
    db.commit()
    db.refresh(settings)
    return printing.read_config(settings)


@router.get("/printers", response_model=PrinterList)
def list_printers(_: User = Depends(require_any_permission("poste_consulter", "imprimantes_consulter", "peripheriques_consulter", "vente_nouvelle"))):
    """Printers installed on this computer, for the selection lists."""
    try:
        devices = printing.printer_devices()
    except Exception as exc:
        # Technical reason, not a silent empty list: a failed enumeration
        # looks the same as "no printers" otherwise.
        raise HTTPException(
            status_code=502,
            detail=(
                "Lecture des imprimantes impossible : "
                f"{type(exc).__name__}: {exc}"
            ),
        )
    return PrinterList(
        devices=devices,
        printers=[device.name for device in devices],
        default=printing.default_printer(),
    )


@router.get("/printers/diagnose")
def diagnose_printers(_: User = Depends(require_any_permission("poste_consulter", "imprimantes_consulter", "vente_nouvelle"))):
    """Per-stage detection report (Windows calls, per-queue details)."""
    return printing.diagnose()


class _PrinterName(BaseModel):
    name: str


@router.get("/printers/status", response_model=PrinterDevice)
def printer_status(name: str, _: User = Depends(require_any_permission("poste_consulter", "imprimantes_consulter", "vente_nouvelle"))):
    """Live state of one queue: jobs waiting, paused, offline, no paper."""
    device = printing.queue_status(name)
    if device is None:
        raise HTTPException(
            status_code=404, detail=f"Imprimante « {name} » introuvable."
        )
    return device


@router.post("/printers/default")
def set_default_printer(
    payload: _PrinterName, _: User = Depends(require_permission("imprimantes_modifier"))
):
    """Make a queue the Windows default printer of this computer."""
    if not printing.set_default_printer(payload.name):
        raise HTTPException(
            status_code=400,
            detail=f"Impossible de définir « {payload.name} » par défaut.",
        )
    return {"default": payload.name}


@router.post("/printers/preferences")
def printer_preferences(
    payload: _PrinterName, _: User = Depends(require_any_permission("poste_modifier", "imprimantes_modifier", "vente_nouvelle"))
):
    """Open the driver's own preferences dialog for a queue."""
    if printing.queue_status(payload.name) is None:
        raise HTTPException(
            status_code=404,
            detail=f"Imprimante « {payload.name} » introuvable.",
        )
    try:
        printing.open_preferences(payload.name)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"opened": payload.name}


class _PrintTest(BaseModel):
    printer_name: str = ""
    document: str = "ticket"  # ticket, a4, labels


@router.post("/printers/test")
def test_printer(
    payload: _PrintTest, _: User = Depends(require_any_permission("poste_modifier", "imprimantes_modifier", "vente_nouvelle"))
):
    """Really send a small document through the spooler, then report the
    queue's state — « envoyé » alone does not mean « imprimé »."""
    target = payload.printer_name.strip() or printing.default_printer()
    if not target:
        raise HTTPException(
            status_code=400, detail="Aucune imprimante n'est configurée."
        )
    device = printing.queue_status(target)
    if device is not None and not device.available:
        raise HTTPException(
            status_code=400,
            detail=f"« {target} » signale : {device.status}.",
        )
    try:
        from .. import escpos

        escpos.send(
            escpos.build(
                [
                    escpos.Line(text="TEST EASYGEST", align="center", big=True),
                    escpos.Line(text="Imprimante : " + target, align="center"),
                    escpos.Line(
                        text="Document de test " + payload.document,
                        align="center",
                    ),
                ],
                cut=True,
            ),
            target,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    device = printing.queue_status(target)
    note = f"{device.jobs} travail/travaux en file" if device else ""
    return {"sent": True, "printer": target, "queue": note,
            "status": device.status if device else ""}


@router.post("/company/open-drawer")
def open_cash_drawer(
    payload: dict[str, str] | None = None,
    db: Session = Depends(get_db), _: User = Depends(require_any_permission("caisse_operations", "peripheriques_modifier"))
):
    """Open the electronic cash drawer wired to this counter."""
    settings = _get_or_create(db)
    settings = SimpleNamespace(**{column.name: getattr(settings, column.name) for column in CompanySettings.__table__.columns})
    for key in ("drawer_port", "drawer_code"):
        if payload and key in payload:
            setattr(settings, key, payload[key])
    config = printing.read_config(settings)
    if payload and "printer_name" in payload:
        config.receipt.printer_name = payload["printer_name"]
    try:
        target = drawer.open_drawer(settings, config)
    except drawer.DrawerError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"opened": True, "port": target}


@router.post("/company/test-mail")
def test_mail(
    db: Session = Depends(get_db), current_user: User = Depends(require_permission("generaux_modifier"))
):
    """Send a test message to the administrator running the check."""
    settings = _get_or_create(db)
    if not is_configured(settings):
        raise HTTPException(
            status_code=400, detail="Configurez d'abord le serveur d'e-mail"
        )
    if not current_user.email:
        raise HTTPException(
            status_code=400, detail="Votre compte n'a pas d'adresse e-mail"
        )
    try:
        send_mail(
            settings,
            current_user.email,
            f"{settings.name} — test d'envoi",
            "Ce message confirme que l'envoi d'e-mails fonctionne.",
        )
    except Exception as exc:  # smtplib raises many different errors
        raise HTTPException(status_code=400, detail=f"Échec de l'envoi : {exc}")
    return {"sent": True, "to": current_user.email}
