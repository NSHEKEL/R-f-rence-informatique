# Tarifs détail / gros

Les prix d'achat, détail pièce, détail carton et gros pièce existants restent inchangés.
Le prix gros carton est facultatif : vide signifie calcul automatique, zéro est un
prix explicite.

| Tarif | Pièce | Carton |
| --- | --- | --- |
| Détail | Prix détail pièce | Prix détail carton, sinon pièces par carton × prix détail pièce |
| Gros | Prix gros pièce positif, sinon détail pièce | Prix gros carton, sinon pièces par carton × prix gros pièce positif, sinon détail carton |

Le sélecteur du ticket définit uniquement le tarif des nouveaux articles. Chaque
ligne garde son propre tarif et son conditionnement. Les modifications et retours
identifient la ligne, pas seulement le produit. Les anciens clients peuvent encore
envoyer uniquement le produit pour un retour lorsque le ticket n'a qu'une ligne
de ce produit.

Le serveur recalcule le prix catalogue. `prix_modifier` est obligatoire pour un
prix libre, une remise de ligne ou une remise globale. `catalog_unit_price` garde
le prix catalogue moyen par unité de base avant modification ; `unit_price`
reste le prix appliqué avant remise de ligne. `discount_by_id` identifie l'auteur
de la remise globale.

Les nouvelles ventes figent `unit_cost` par unité de base. Les anciens tickets
sans coût figé utilisent le prix d'achat courant. Les retours recopient ce coût.
La remise globale est répartie proportionnellement aux sous-totaux après remises
de ligne, y compris pour le remboursement. Le bénéfice est le revenu net moins
le coût net ; la marge affichée est le bénéfice divisé par le revenu net, en %.
Les rapports imputent les retours à leur date, le détail de vente les déduit du
ticket d'origine. Les détails financiers nécessitent `rapports_financiers`.

L'annulation restitue seulement les unités non encore retournées. Comme avant,
elle supprime la vente et ses avoirs, sans conserver une écriture d'annulation.

## Migration

Sept colonnes ajoutées par `COLUMNS`, sans suppression ni reconstruction de table :

- `products.wholesale_packaging_price`, nullable ;
- `sale_items.price_tier`, défaut `detail` ;
- `sale_items.catalog_unit_price`, `sale_items.unit_cost`, nullables ;
- `sales.discount_by_id`, nullable ;
- `sale_return_items.sale_item_id`, `sale_return_items.unit_cost`, nullables.

## Tests

Avec Python 3.12, installer `backend/requirements-test.txt` (HTTPX pour le vrai
`TestClient` FastAPI). Définir `EASYGEST_DATA_DIR`, `DATABASE_URL` et
`LOCALAPPDATA` vers des dossiers de test isolés avant le lancement.

Depuis `backend/` : `python -m unittest discover -s . -p "test_*.py"`.
Le répertoire courant est important pour le test Windows de supervision parent.

Depuis `frontend/`, avec Node 20 : `node --test *.test.cjs`,
`npx oxlint src`, `npm run build`. Sous PowerShell, développer la liste des
tests avec `(Get-ChildItem *.test.cjs).FullName`.
