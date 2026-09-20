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
    FeatureSpec(
        "inventaire", "Inventaire", "Catalogue",
        "Fiches d'inventaire et écarts de stock",
    ),
    FeatureSpec("fournisseurs", "Fournisseurs", "Catalogue", "Fichier fournisseurs"),
    FeatureSpec("ventes", "Ventes", "Exploitation", "Encaissement et historique"),
    FeatureSpec(
        "achats", "Achats / Approvisionnement", "Exploitation",
        "Commandes fournisseurs et réceptions",
    ),
    FeatureSpec(
        "stock", "Mouvements de stock", "Exploitation",
        "Entrées, sorties et historique des mouvements",
    ),
    FeatureSpec(
        "versements", "Ma caisse", "Exploitation",
        "Caisse : ouverture, fermeture et versements",
    ),
    FeatureSpec(
        "commandes", "Commandes", "Exploitation",
        "Bons de commande clients",
    ),
    FeatureSpec(
        "livraisons", "Livraisons", "Exploitation",
        "Bons de livraison et livraisons partielles",
    ),
    FeatureSpec(
        "retours", "Retours & avoirs", "Exploitation",
        "Retours de marchandise et avoirs clients",
    ),
    FeatureSpec(
        "dettes", "Dettes & créances", "Exploitation",
        "Commandes à crédit, reste à payer, comptabilité",
    ),
    FeatureSpec("recus", "Reçus", "Documents", "Reçus de vente A4 et duplicata"),
    FeatureSpec(
        "proformas", "Factures proforma", "Documents",
        "Devis et factures proforma",
    ),
    FeatureSpec(
        "impression_thermique", "Impression thermique", "Documents",
        "Ticket 80 mm sur imprimante thermique",
    ),
    FeatureSpec("rapports", "Rapports", "Pilotage", "Rapports de ventes détaillés"),
    FeatureSpec("statistiques", "Statistiques", "Pilotage", "Graphiques et tendances"),
    FeatureSpec(
        "comptabilite", "Comptabilité", "Pilotage",
        "Journal des encaissements et dépenses",
    ),
    FeatureSpec(
        "paie", "Paie & bulletins de salaire", "Pilotage",
        "Travailleurs, paie mensuelle et bulletins A4",
    ),
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
    FeatureSpec(
        "droits_acces", "Droits d'accès", "Administration",
        "Permissions par rôle et par utilisateur",
    ),
    FeatureSpec(
        "parametres", "Paramètres", "Administration",
        "Entreprise, impression, sécurité, sauvegardes",
    ),
    FeatureSpec(
        "apropos", "À propos de nous", "Administration",
        "Page de présentation de l'éditeur",
    ),
)

# Catalogue of the releases before these menu entries became switchable.
# A workstation still holding such a licence must not lose a screen while it
# waits for its next synchronisation: a code missing from the catalogue that
# signed the licence was never refused, so it stays open.
LEGACY_FEATURE_CODES: frozenset[str] = frozenset(
    {
        "produits",
        "categories",
        "clients",
        "fournisseurs",
        "ventes",
        "achats",
        "stock",
        "versements",
        "dettes",
        "recus",
        "impression_thermique",
        "rapports",
        "statistiques",
        "tableau_bord",
        "export_excel",
        "export_pdf",
        "gestion_utilisateurs",
        "multi_utilisateurs",
        "sauvegarde",
        "restauration",
        "synchronisation",
        "fonctions_avancees",
    }
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
        "inventaire",
        "commandes",
        "livraisons",
        "retours",
        "proformas",
        "comptabilite",
        "droits_acces",
        "parametres",
        "apropos",
    }
)
