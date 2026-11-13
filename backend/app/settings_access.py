from fastapi import HTTPException

from .permissions import has_permission

FISCAL_FIELDS = {"tax_id", "rccm", "ncc", "regime_fiscal", "vat_rate", "capital_social"}
PRINT_FIELDS = {"document_layouts", "receipt_header", "receipt_footer", "receipt_format", "printer_name"}
CASH_FIELDS = {"auto_print_cash", "drawer_open_after_sale"}


def category_for_field(key):
    if key in FISCAL_FIELDS:
        return "fiscaux"
    if key in PRINT_FIELDS:
        return "imprimantes"
    if key in CASH_FIELDS:
        return "caisse"
    if key.startswith("drawer_"):
        return "peripheriques"
    if key.startswith("expiry_"):
        return "articles"
    if key.startswith(("backup_", "drive_")):
        return "sauvegarde"
    return "generaux"


def check_company_update(db, user, data):
    if not data and user.role != "admin":
        raise HTTPException(status_code=403, detail="Aucun paramètre à modifier")
    for key in data:
        allowed = user.role == "admin" if key == "network_restrict_workstations" else has_permission(
            db, user, f"{category_for_field(key)}_modifier")
        if not allowed:
            raise HTTPException(status_code=403, detail=f"Modification refusée : {key}")
