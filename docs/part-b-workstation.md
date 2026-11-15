# Stock et poste — 2.18.5

## Historique des mouvements

`GET /api/inventory/movements/page` conserve le droit `inventaire` et renvoie
`items`, `total`, `page`, `page_size`. Pagination serveur (50 lignes par défaut,
200 maximum), tri `recent`/`oldest` sur la date puis l'identifiant.
L'ancien endpoint `/movements` et son tableau JSON restent inchangés.

Filtres combinables : `product_id`, `kind`, `user_id`, `depot_id`,
`direction=entree|sortie`, `search` (nom historique), `period` : `all`, `today`,
`7d`, `month`, `previous`, `custom`, et `date_from`/`date_to` (AAAA-MM-JJ).
Les sept derniers jours incluent aujourd'hui et les six jours précédents.
Les bornes incluent les journées entières, selon l'horloge du serveur comme
les écrans stock existants. Les dates stockées ne sont pas réécrites.
Les facettes `/movements/filters` incluent les articles désactivés présents
dans l'historique. Les anciennes lignes sans dépôt restent identifiées comme
principal historique ; les nouvelles affichent le dépôt enregistré.

Migration additive : index `ix_stock_movements_date` sur le vrai champ de date
`stock_movements.date` (pas de colonne `created_at` dans ce modèle).

## Colonnes de stock

Inventaire et Produits partagent les colonnes configurables, sans retirer les
actions, champs de comptage et autres informations existants. Une colonne par
nom de conditionnement (principal et conditionnements supplémentaires actifs),
sans distinction de casse. Les facteurs restent propres à chaque article.
Deux facteurs différents sous le même nom sont explicités dans la cellule.
Les quantités affichent les conditionnements entiers et le reste en unité de
base. Un article sans ce conditionnement a une cellule vide.

Préférences navigateur par utilisateur et tableau :
`easygest_stock_columns:<user_id>:inventory|products`. Paramètres > Ce poste
permet les mêmes choix (`poste_modifier` pour les modifier depuis Paramètres).
Le comptage aveugle masque aussi les quantités dérivées et la valeur.

Les nouveaux champs calculés `stock_purchase_price` et `stock_value` sont
masqués par le serveur sans `rapports_financiers` et le droit de voir le stock.
L'interface ne propose alors pas les colonnes correspondantes. Les champs
catalogue historiques et leurs anciens payloads restent inchangés.
`nearest_expiry` est la première date d'un lot dont la quantité restante est
positive, y compris un lot déjà périmé. Aucun stock n'est modifié pour afficher
ces valeurs.

## Ticket automatique

Préférence locale `receipt_auto_return`, activée par défaut, dans le réglage
de poste existant (navigateur et fichier natif). Modification : `poste_modifier`.
Avec une imprimante configurée, la vente enregistrée libère immédiatement
le panier et lance l'impression sans modale. Les tickets successifs attendent
le même service d'impression ; la détection de double clic ne confond pas deux
ventes différentes, même hors ligne avec un libellé de ticket identique.

Un échec reste visible dans une notice avec Réimprimer. Une réimpression ne
crée pas de vente et ne relance pas le tiroir. En cas de délai dépassé, vérifier
le papier avant de réessayer ; le service conserve le verrou jusqu'à la fin
réelle du travail pour éviter des impressions concurrentes.

Sans imprimante nommée : fenêtre du ticket sans tentative automatique,
impression manuelle via le navigateur ou le périphérique local disponible.
Réglage désactivé : fenêtre après-vente habituelle. Une acceptation par le
spouleur ne certifie pas la sortie physique du papier.

Le contraste est renforcé uniquement à l'écran en thème clair ; les règles
du thème sombre et les styles d'impression ne sont pas modifiés.
