"""Access rights the administrator grants to sellers and stock managers.

Administrators always hold every right; the other roles start from the
historical defaults below and the administrator turns each right on or off
from Paramètres → Droits d'accès.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .auth import get_current_user
from .database import get_db
from .models import RolePermission, User

# key -> (label shown to the administrator, section)
PERMISSIONS: dict[str, tuple[str, str]] = {
    "tableau_bord": ("Tableau de bord", "Pages"),
    "caisse": ("Ma caisse", "Pages"),
    "vente_nouvelle": ("Nouvelle vente", "Pages"),
    "ventes": ("Historique des ventes", "Pages"),
    "commandes": ("Commandes", "Pages"),
    "livraisons": ("Livraisons", "Pages"),
    "retours": ("Retours & avoirs", "Pages"),
    "clients": ("Clients", "Pages"),
    "produits": ("Produits & stock", "Pages"),
    "inventaire": ("Inventaire", "Pages"),
    "rapports": ("Rapports", "Pages"),
    "proformas": ("Factures proforma", "Pages"),
    "comptabilite": ("Comptabilité", "Pages"),
    "fournisseurs": ("Fournisseurs", "Pages"),
    "approvisionnements": ("Approvisionnement", "Pages"),
    "categories": ("Catégories", "Pages"),
    "apropos": ("À propos de nous", "Pages"),
    "produits_gerer": ("Créer, modifier et supprimer des produits", "Actions"),
    "categories_gerer": ("Créer, modifier et supprimer des catégories", "Actions"),
    "fournisseurs_gerer": (
        "Créer, modifier et supprimer des fournisseurs",
        "Actions",
    ),
    "clients_gerer": ("Créer, modifier et supprimer des clients", "Actions"),
    "commandes_gerer": ("Créer, livrer et supprimer des commandes", "Actions"),
    "ventes_supprimer": ("Supprimer ou corriger une vente", "Actions"),
    "inventaire_appliquer": ("Appliquer un inventaire (ajuster le stock)", "Actions"),
    "approvisionnements_gerer": (
        "Créer, réceptionner et supprimer un approvisionnement",
        "Actions",
    ),
}

CONFIGURABLE_ROLES = ("vendeur", "gestionnaire")

# Rights each role had before they became configurable.
DEFAULTS: dict[str, set[str]] = {
    "vendeur": {"caisse", "vente_nouvelle"},
    "gestionnaire": {
        "produits",
        "inventaire",
        "fournisseurs",
        "categories",
        "approvisionnements",
    },
}


def default_allows(role: str, key: str) -> bool:
    if role == "admin":
        return True
    return key in DEFAULTS.get(role, set())


def role_matrix(db: Session) -> dict[str, dict[str, bool]]:
    """Every configurable role with its effective rights."""
    stored = {
        (row.role, row.permission): row.allowed
        for row in db.query(RolePermission).all()
    }
    return {
        role: {
            key: stored.get((role, key), default_allows(role, key))
            for key in PERMISSIONS
        }
        for role in CONFIGURABLE_ROLES
    }


def allowed_keys(db: Session, user: User) -> list[str]:
    if user.role == "admin":
        return list(PERMISSIONS)
    rights = role_matrix(db).get(user.role, {})
    return [key for key, ok in rights.items() if ok]


def save_matrix(db: Session, matrix: dict[str, dict[str, bool]]) -> None:
    rows = {(row.role, row.permission): row for row in db.query(RolePermission).all()}
    for role, rights in matrix.items():
        if role not in CONFIGURABLE_ROLES:
            continue
        for key, allowed in rights.items():
            if key not in PERMISSIONS:
                continue
            row = rows.get((role, key))
            if row is None:
                db.add(
                    RolePermission(role=role, permission=key, allowed=bool(allowed))
                )
            else:
                row.allowed = bool(allowed)
    db.commit()


def has_permission(db: Session, user: User, key: str) -> bool:
    if user.role == "admin":
        return True
    row = (
        db.query(RolePermission)
        .filter(
            RolePermission.role == user.role,
            RolePermission.permission == key,
        )
        .first()
    )
    return row.allowed if row is not None else default_allows(user.role, key)


def require_permission(key: str):
    """Dependency guarding an endpoint with one configurable right."""

    def guard(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not has_permission(db, current_user, key):
            label = PERMISSIONS.get(key, (key, ""))[0]
            raise HTTPException(
                status_code=403,
                detail=f"Accès refusé : {label}",
            )
        return current_user

    return guard
