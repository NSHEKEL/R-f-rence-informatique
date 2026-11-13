# Stocks par dépôt — 2.18.1

La migration additive `depot_stock_initialization_v1` crée **Magasin principal** et y reprend les quantités existantes, sans changer les totaux ni les documents antérieurs. Elle n'est pas rejouée après initialisation. `products.quantity` reste le total de `depot_stocks.quantity` pour les anciens clients, Android et les modules commerciaux.

## Politique commerciale

- Aucun rattachement poste → dépôt, aucun choix de dépôt au POS ou à la réception et aucun nouveau snapshot dépôt sur les lignes commerciales.
- Ventes, annulations, retours, livraisons, approvisionnements, transferts entre boutiques, import CSV, modifications du stock catalogue et undo/redo affectent automatiquement **le principal uniquement**. La relecture d'un ticket hors ligne utilise le même chemin serveur et reste idempotente.
- Les sorties commerciales conservent le contrôle de disponibilité sur **le total**. Si une réserve contient le disponible, le principal peut devenir négatif ; l'écran article l'affiche avec **« À réapprovisionner depuis les réserves »**. Il faut ensuite effectuer un transfert interne depuis la réserve : aucune réserve n'est débitée implicitement par une vente.
- Modifier directement la quantité catalogue applique l'écart au principal, sans réécrire les réserves.

## Réserves, transferts et inventaires

Les autres dépôts ne sont ajustés que par un transfert interne ou un inventaire de dépôt. Un transfert interne est définitif, transactionnel, conserve un document et deux mouvements signés, et ne change pas le total. La source doit disposer de la quantité ; la destination principale peut rester négative après un réapprovisionnement partiel. L'historique reste consultable, sans endpoint de suppression de dépôt ou de transfert. Les droits `depots_gerer` et `depots_transferer` sont indépendants et non attribués aux rôles existants.

Un dépôt avec un stock non nul et le principal ne peuvent pas être désactivés. Un dépôt vide peut être désactivé puis réactivé. Les mouvements et rapports le conservent.

Un inventaire de périmètre **Dépôt** fige le nom et l'identifiant du dépôt, et prend son stock théorique au démarrage. Catégorie et rayon peuvent être combinés dans le périmètre API. La validation relative ne touche que ce dépôt ; elle refuse une quantité négative dans ce dépôt ou un total négatif. Les inventaires existants, général/catégorie/rayon/emplacement/sélection et l'inventaire rapide, restent des comptages **tous dépôts** : leur écart est appliqué au principal, éventuellement négatif tant que le total reste valide. Le mode aveugle reste imposé côté serveur.

Les lots portent un dépôt nullable (`NULL` = principal pour les anciens lots). Les transferts internes déplacent les étiquettes de lot et leur péremption ; la vente consomme en FEFO uniquement les lots du principal, jamais ceux des réserves. Lors du réapprovisionnement d'un principal négatif, les étiquettes couvrant son déficit correspondent à du stock déjà vendu : seule la partie redevenue disponible reçoit des étiquettes dans le principal. Les retours restent du stock non étiqueté, comme avant. Un retrait de lot en réserve passe par un inventaire de ce dépôt, pas par la sortie commerciale du principal.

## Contrôles

`app.stock.adjust` verrouille d'abord l'article et ajuste les deux représentations dans la transaction de l'appelant, sans commit interne. Les écritures ORM de création sont initialisées par le même module ; les anciens écrivains ORM restent réconciliés par ce module. Une garde AST interdit les écritures directes de quantités dans le code applicatif hors module de stock.

`GET /api/depots/consistency` (droit `depots_gerer`) et le selftest du binaire vérifient l'invariant sans réparer ni modifier les stocks. La valorisation comptable accepte `depot_id` ; sans filtre elle conserve la valorisation totale actuelle. Le filtre figure dans le pied imprimé/PDF/Excel. Les stocks par dépôt suivent les droits de visibilité existants (`produits` ou `inventaire`).
