"""Catalogue of the capabilities a plan can allow.

The list is shared: the central service seeds its ``features`` table from it,
the shop application uses the same codes to gate its endpoints and its menu.
Plans never appear here — which feature belongs to Business or to Entreprise
is decided in the console, at runtime.
"""

from typing import NamedTuple


class FeatureSpec(NamedTuple):
    code: str
    name: str
    section: str
    description: str


FEATURES: tuple[FeatureSpec, ...] = (
    FeatureSpec(
        "produits", "Gestion des produits", "Catalogue",
        "Fiches produits, prix, stock minimum, codes-barres",
    ),
    FeatureSpec("categories", "Catégories", "Catalogue", "Familles de produits"),
    FeatureSpec("clients", "Clients", "Catalogue", "Fichier clients"),
    FeatureSpec("fournisseurs", "Fournisseurs", "Catalogue", "Fichier fournisseurs"),
    FeatureSpec("ventes", "Ventes", "Exploitation", "Encaissement et historique"),
    FeatureSpec(
        "achats", "Achats / Approvisionnement", "Exploitation",
        "Commandes fournisseurs et réceptions",
    ),
    FeatureSpec(
        "stock", "Stock & inventaire", "Exploitation",
        "Mouvements de stock et fiches d'inventaire",
    ),
    FeatureSpec(
        "versements", "Versements", "Exploitation",
        "Caisse : ouverture, fermeture et versements",
    ),
    FeatureSpec(
        "dettes", "Dettes & créances", "Exploitation",
        "Commandes à crédit, reste à payer, comptabilité",
    ),
    FeatureSpec("recus", "Reçus", "Documents", "Reçus de vente A4 et duplicata"),
    FeatureSpec(
        "impression_thermique", "Impression thermique", "Documents",
        "Ticket 80 mm sur imprimante thermique",
    ),
    FeatureSpec("rapports", "Rapports", "Pilotage", "Rapports de ventes détaillés"),
    FeatureSpec("statistiques", "Statistiques", "Pilotage", "Graphiques et tendances"),
    FeatureSpec("tableau_bord", "Tableau de bord", "Pilotage", "Chiffres du jour"),
    FeatureSpec("export_excel", "Export Excel", "Pilotage", "Export CSV/Excel"),
    FeatureSpec("export_pdf", "Export PDF", "Pilotage", "Impression et export PDF"),
    FeatureSpec(
        "gestion_utilisateurs", "Gestion des utilisateurs", "Administration",
        "Créer et désactiver des comptes",
    ),
    FeatureSpec(
        "multi_utilisateurs", "Multi-utilisateurs", "Administration",
        "Plusieurs comptes actifs en même temps",
    ),
    FeatureSpec("sauvegarde", "Sauvegarde", "Administration", "Sauvegardes de la base"),
    FeatureSpec(
        "restauration", "Restauration", "Administration",
        "Restaurer une sauvegarde",
    ),
    FeatureSpec(
        "synchronisation", "Synchronisation", "Administration",
        "Plusieurs postes sur un serveur central",
    ),
    FeatureSpec(
        "fonctions_avancees", "Fonctionnalités avancées", "Administration",
        "Retours & avoirs, factures proforma",
    ),
)

FEATURE_CODES: tuple[str, ...] = tuple(spec.code for spec in FEATURES)
FEATURE_LABELS: dict[str, str] = {spec.code: spec.name for spec in FEATURES}

# What a shop gets before the console says otherwise (offline first start, or
# a plan created without touching its switches).
BASE_FEATURES: frozenset[str] = frozenset(
    {
        "produits",
        "categories",
        "clients",
        "ventes",
        "stock",
        "recus",
        "tableau_bord",
        "sauvegarde",
    }
)
