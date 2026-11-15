# Réception, péremptions et désactivation — partie A

## Réception et tarifs

La réception affiche une révision des prix catalogue avant confirmation. Les champs
préremplis sont conservés tant qu'ils ne sont pas modifiés. Les coûts des lignes
d'achat commandées restent des snapshots : modifier le catalogue ne les réécrit pas.
Le droit existant `tarifs_modifier` autorise les modifications, indépendamment du
droit `approvisionnements_gerer` nécessaire pour réceptionner. Sans ce droit tarifaire,
la révision reste visible en lecture seule et la réception reste disponible.

`POST /api/purchases/{id}/receive` accepte la liste facultative `price_changes` :
`product_id`, `packaging_id` (null pour la fiche principale), `field`, `old_value`,
`new_value`. Les valeurs sont finies, positives ou nulles ; seuls les prix optionnels
acceptent null. Les articles modifiés doivent être reçus dans cette opération.
Un ancien prix devenu obsolète provoque un 409 ; un champ inconnu, un doublon ou un
conditionnement étranger provoque un 400. Un changement sans droit tarifaire donne
un 403. Stock, réception, catalogue et `price_history` sont validés ensemble.
L'historique existant conserve date/utilisateur/ancien/nouveau et reçoit la colonne
additive `purchase_reference`. Il reste visible dans l'historique des prix article.

Les anciens payloads restent acceptés. Par défaut les prix sont désormais conservés.
Le drapeau historique `update_cost: true` reste pris en charge et audité pour les
utilisateurs autorisés. Sans droit tarifaire ce drapeau historique est ignoré, afin
de ne pas bloquer les anciens écrans de réception ; aucune modification de prix
n'est alors effectuée. Le nouvel écran envoie explicitement `update_cost: false`.

## Péremptions par lot

`GET /api/products/stock/perimes` conserve son défaut historique `period=expired`.
Les valeurs supplémentaires sont `7d`, `1m`, `2m`, `3m`, `4m`, `9m`, `all`, `custom`.
Les horizons futurs incluent aujourd'hui et la date limite, mais pas les lots déjà
périmés. Les mois sont calendaires, ramenés au dernier jour du mois si nécessaire
(31 janvier + 1 mois = 28/29 février). `custom` accepte une ou deux bornes ISO
`date_from`/`date_to`, inclusives. Les lots sans date ou sans quantité sont exclus.
Les filtres article/recherche/catégorie/fournisseur restent disponibles. Les lignes
ne sont pas regroupées, y compris lorsque plusieurs lots portent le même numéro.
`days_left` est exact ; `months_left` est une approximation sur 30,4375 jours/mois.

La colonne additive `stock_lots.unit_cost` fige le coût catalogue lors de la création
du lot. Un transfert interne conserve ce coût. Les lots historiques n'avaient aucun
coût propre enregistré : une migration marquée `stock_lot_cost_snapshot_v1` fige une
fois le coût catalogue disponible lors de l'upgrade, sans prétendre reconstituer
leur coût d'acquisition historique. Les très anciens lots sans coût utilisent le
coût catalogue comme repli. La valeur est quantité restante × coût du lot ; les
anciens champs de réponse `expired_since` et `loss_value` restent présents.

## Articles désactivés

`products.active` est une colonne additive, active par défaut pour les anciennes
fiches comme pour les nouvelles. `PUT /api/products/{id}/activation` avec `active`
exige `produits_gerer`. La désactivation conserve la fiche, ses codes réservés, ses
stocks, lots et documents. L'ancien DELETE conserve ses protections historiques et
désactive les fiches éligibles au lieu de les supprimer. L'écran propose aussi la
désactivation de la sélection. Le filtre catalogue `state` accepte `active` (défaut),
`inactive`, `all` ; consulter les deux derniers exige le droit articles ou inventaire.

POS, codes et catalogue par défaut ne proposent plus l'article. Les nouvelles ventes
(y compris synchronisation hors ligne), achats et commandes sont refusés avec un 400.
Les duplications/conversions en commande et les livraisons qui créent une nouvelle
vente vérifient aussi l'activation. Une réception d'un achat déjà commandé reste
possible. Les anciennes ventes restent consultables et leurs retours/annulations
restockent normalement ; le rejeu d'un ticket déjà accepté reste idempotent.

Le cache hors ligne exclut les fiches explicitement désactivées, y compris lors de
la lecture d'un ancien cache. Une déconnexion ne peut pas révéler une désactivation
effectuée ailleurs depuis la dernière synchronisation : le serveur refuse alors
la nouvelle vente au rejeu et le ticket reste dans les rejets visibles. Les anciens
payloads sans champ `active` sont traités comme actifs côté client ; une modification
ancienne de fiche ne réactive jamais implicitement un article désactivé.
