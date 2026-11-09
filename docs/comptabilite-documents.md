# Documents comptables — 2.18.0

Cette couche relit les pièces commerciales sans stocker un second jeu d'écritures et sans modifier leurs montants. Les journaux ne constituent pas une clôture comptable immuable : changements de liaison, déclaration historique, annulation ou modification d'une pièce source changent la projection. Les modifications de configuration sont journalisées dans SecurityLog.

## Principes

- Comptes SYSCOHADA initialisés une fois (`accounting_syscohada_v1`), sans remplacer les comptes existants. Aucun compte n'est supprimé ; désactivation et changement d'intitulé restent possibles.
- Chaque opération est admise entièrement et équilibrée au centime, ou signalée dans « Opérations non comptabilisées ». Aucun compte d'attente automatique ne masque un défaut de paramétrage.
- Les ventes et retours reprennent leurs montants TTC nets et leur TVA snapshotée ; les remises connues passent en 709. Les coûts/marges commerciaux restent ceux de `profits.py`, sans modifier l'ancienne synthèse.
- Les ventes annulées, leurs retours et leurs règlements sont exclus, même pour une période antérieure. Pas de contrepassation persistante : il n'existe pas de période comptable clôturée dans cette projection.
- Un avoir non remboursé est porté en 4191, sans diminuer automatiquement la créance du module commercial. Il n'est pas assimilé à un règlement de dette. Son utilisation ultérieure doit disposer d'une pièce traçable.
- Les achats reçus entièrement passent en 601/4452 contre 401 à la réception. Une réception partielle n'est pas supposée constituer une facture complète. Les acomptes renseignés passent en 4091 à la date de l'achat puis sont imputés en 401 à réception complète.
- Les nouveaux restes à payer fournisseurs créés par la réception portent `purchase_id`. Les anciennes pièces sont liées manuellement, jamais par rapprochement de texte. Une liaison incompatible ou déjà affectée est refusée.
- Une dépense sans catégorie liée à un compte 6xx, sans mode de paiement, ou avec une banque non liée reste non comptabilisée. Les modes supplémentaires nécessitent une liaison explicite `paiement:<libellé>`.
- La paie utilise le brut, le net et les retenues détaillées. Chaque retenue doit avoir une liaison `paie_retenue:<libellé>` ; une ventilation manquante n'est pas inventée.
- Les fonds d'ouverture de caisse opérationnels ne sont pas assimilés à un apport en capital. Comparer les flux du journal de caisse au mouvement net de la session, puis ajouter son ouverture pour retrouver son attendu. L'ancien calcul des caisses et des dépenses n'est pas modifié.

## TVA et justification

La TVA courante est snapshotée à la création des nouvelles ventes et des nouveaux achats. Un retour reprend le snapshot de sa vente, non le taux courant. Les anciennes lignes restent NULL après migration.

L'administrateur peut déclarer un **Régime TVA des documents antérieurs**, vide par défaut. Un taux explicite, y compris 0 %, justifie les documents dépourvus de snapshot ; un snapshot existant n'est jamais remplacé. L'auteur, la date et le taux sont journalisés et imprimés dans le pied des documents PDF/HTML et dans les exports Excel. Effacer le taux retire cette justification, sans effacer le journal.

La date facultative de début de comptabilisation s'applique à toutes les pièces ; celles qui la précèdent sont signalées, non transformées en solde d'ouverture supposé.

## Documents et limites

Les fiches de compte, grand livre et balance calculent leur ouverture à partir des écritures admissibles antérieures à la période, avec avertissement sur les pièces antérieures exclues. La fiche de compte et le grand livre affichent le solde progressif par compte.

Les situations clients/fournisseurs sont les soldes auxiliaires à la date de fin, avec les dettes d'ouverture, pas une réécriture du module Dettes. Le filtre utilisateur y désigne le créateur de dette. La valorisation de stock est **actuelle**, regroupée par catégorie dans la synthèse : aucune valorisation historique n'est supposée. Les marges commerciales sont TTC comme les rapports existants et distinctes de la marge comptable HT.

Les droits `comptabilite_journaux_consulter`, `comptabilite_journaux_imprimer` et `plan_comptable_modifier` sont refusés par défaut aux rôles existants ; l'admin conserve tous les droits. La déclaration historique reste réservée à l'admin. L'ancien écran de synthèse garde ses gardes et calculs.
