"""Access rights the administrator grants to sellers and stock managers.

Administrators always hold every right; the other roles start from the
historical defaults below and the administrator turns each right on or off
from Paramètres → Droits d'accès.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .auth import get_current_user
from .database import get_db
from .models import RolePermission, SecurityLog, User

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
    "dettes": ("Dettes & créances", "Pages"),
    "fournisseurs": ("Fournisseurs", "Pages"),
    "approvisionnements": ("Approvisionnement", "Pages"),
    "categories": ("Catégories", "Pages"),
    "apropos": ("À propos de nous", "Pages"),
    "assistance": ("Assistance et support", "Pages"),
    "paie": ("Paie & bulletins de salaire", "Pages"),
    "produits_gerer": ("Créer, modifier et supprimer des produits", "Actions"),
    "categories_gerer": ("Créer, modifier et supprimer des catégories", "Actions"),
    "fournisseurs_gerer": (
        "Créer, modifier et supprimer des fournisseurs",
        "Actions",
    ),
    "clients_gerer": ("Créer, modifier et supprimer des clients", "Actions"),
    "commandes_gerer": ("Créer, livrer et supprimer des commandes", "Actions"),
    "ventes_supprimer": ("Supprimer ou corriger une vente", "Actions"),
    "ventes_cadeau": (
        "Enregistrer une vente cadeau (articles offerts)",
        "Actions",
    ),
    "prix_modifier": ("Modifier le prix pendant une vente", "Actions"),
    "inventaire_appliquer": ("Appliquer un inventaire (ajuster le stock)", "Actions"),
    "dettes_gerer": ("Créer et modifier une dette ou une créance", "Actions"),
    "dettes_regler": ("Enregistrer un règlement de dette ou de créance", "Actions"),
    "dettes_annuler": ("Annuler un règlement (avec motif)", "Actions"),
    "dettes_recu": ("Imprimer un reçu de paiement", "Actions"),
    "rapports_financiers": ("Consulter les rapports financiers", "Trésorerie"),
    "rapports_exporter": ("Exporter ou imprimer les rapports", "Actions"),
    "approvisionnements_gerer": (
        "Créer, réceptionner et supprimer un approvisionnement",
        "Actions",
    ),
    "commandes_annuler": ("Annuler un bon de commande", "Actions"),
    "commandes_imprimer": ("Imprimer un bon de commande", "Actions"),
    "livraisons_gerer": ("Créer et modifier un bon de livraison", "Actions"),
    "livraisons_valider": ("Valider un bon de livraison (sortie de stock)", "Actions"),
    "livraisons_annuler": ("Annuler un bon de livraison", "Actions"),
    "livraisons_imprimer": ("Imprimer un bon de livraison", "Actions"),
    "livraisons_prix": ("Voir les prix sur un bon de livraison", "Actions"),
    "paie_travailleurs": (
        "Créer, modifier et archiver un travailleur",
        "Actions",
    ),
    "paie_gerer": ("Préparer et modifier une paie", "Actions"),
    "paie_valider": ("Valider une paie", "Actions"),
    "paie_payer": ("Marquer une paie comme payée", "Actions"),
    "paie_annuler": ("Annuler une paie (avec motif)", "Actions"),
    "paie_imprimer": ("Imprimer ou exporter un bulletin", "Actions"),
    "paie_parametres": ("Modifier les paramètres de paie", "Actions"),
    "documents_transformer": (
        "Transformer un bon de commande en livraison ou en facture",
        "Actions",
    ),
    "caisse_fermer": ("Clôturer une session de caisse", "Actions"),
    "caisse_z": ("Imprimer le ticket de clôture de sa caisse", "Trésorerie"),
    "tresorerie_consulter": ("Consulter la trésorerie", "Trésorerie"),
    "recette_enregistrer": ("Enregistrer une recette", "Trésorerie"),
    "soldes_consulter": ("Consulter les soldes", "Trésorerie"),
    "caisse_operations": ("Effectuer les opérations de caisse", "Trésorerie"),
    "clotures_consulter": ("Consulter les clôtures", "Trésorerie"),
    "versements_gerer": ("Enregistrer un versement bancaire", "Trésorerie"),
    "versements_valider": (
        "Valider, rejeter, annuler ou rapprocher un versement",
        "Trésorerie",
    ),
    "depenses_gerer": ("Enregistrer une dépense", "Trésorerie"),
}

SETTINGS_CATEGORIES = {
    "generaux": "Généraux", "articles": "Articles et catalogue", "tarifs": "Tarifs",
    "fiscaux": "Fiscalité et FNE", "imprimantes": "Impression partagée", "poste": "Ce poste",
    "peripheriques": "Périphériques", "caisse": "Réglages de caisse",
    "utilisateurs": "Utilisateurs et droits", "sauvegarde": "Sauvegardes",
}
for category, label in SETTINGS_CATEGORIES.items():
    for action, verb in (("consulter", "Consulter"), ("modifier", "Modifier")):
        PERMISSIONS[f"{category}_{action}"] = (f"{verb} : {label}", "Paramètres")
PERMISSIONS["parametres_sauvegarde_restaurer"] = ("Restaurer une sauvegarde", "Paramètres")

CONFIGURABLE_ROLES = ("vendeur", "gestionnaire")

# Rights each role had before they became configurable.
DEFAULTS: dict[str, set[str]] = {
    "vendeur": {
        "caisse",
        "caisse_fermer",
        "vente_nouvelle",
        "assistance",
    },
    "gestionnaire": {
        "produits",
        "inventaire",
        "fournisseurs",
        "categories",
        "approvisionnements",
        "assistance",
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


def save_matrix(db: Session, matrix: dict[str, dict[str, bool]], actor: User | None = None) -> None:
    rows = {(row.role, row.permission): row for row in db.query(RolePermission).all()}
    for role, rights in matrix.items():
        if role not in CONFIGURABLE_ROLES:
            continue
        for key, allowed in rights.items():
            if key not in PERMISSIONS:
                continue
            row = rows.get((role, key))
            old = row.allowed if row is not None else default_allows(role, key)
            if actor is not None and old != bool(allowed):
                db.add(SecurityLog(event="permission_modifiee", user_id=actor.id, identifier=actor.email,
                    detail=f"role={role}; key={key}; {str(bool(old)).lower()} → {str(bool(allowed)).lower()}", success=True))
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


def require_permission(key: str, *additional: str):
    """Dependency requiring every named right."""

    def guard(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        for required in (key, *additional):
            if not has_permission(db, current_user, required):
                label = PERMISSIONS.get(required, (required, ""))[0]
                raise HTTPException(
                    status_code=403,
                    detail=f"Accès refusé : {label}",
                )
        return current_user

    return guard


def require_any_permission(*keys):
    def guard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
        if not any(has_permission(db, current_user, key) for key in keys):
            raise HTTPException(status_code=403, detail="Accès refusé")
        return current_user
    return guard
