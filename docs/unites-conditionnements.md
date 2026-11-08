# Unités et conditionnements

Chaque produit reste unique et son stock reste un **entier en unités de base**.
Exemples d'unités : pièce, kg, litre. Pour compter des fractions, choisir une
unité entière plus petite (g, ml) ; aucun changement de type du stock n'est fait.
Le conditionnement est facultatif : carton, paquet, boîte, sac, etc.

La fiche produit propose unité de base, conditionnement, facteur entier positif,
prix unitaire, prix du conditionnement et stock initial. Un prix de conditionnement
vide signifie facteur × prix unitaire ; zéro est un prix explicite, pas un défaut.
Sans conditionnement, le fonctionnement historique est conservé.

## Vente

Le panier propose unité de base, conditionnement ou mixte, uniquement pour les
produits conditionnés. Exemple : 2 cartons + 3 pièces, facteur 12 → **27 unités**.
Les deux quantités restent distinctes : 1 carton + 15 pièces n'est pas remplacé
par 2 cartons + 3 pièces au tarif carton. La grille de produits n'est pas restylée.

`quantity` reste toujours la quantité de base dans l'API et les miroirs existants.
Les champs optionnels `packaging_quantity` et `piece_quantity` remplacent ce nombre
pour le calcul de conversion ; ils ne s'y ajoutent jamais. Le serveur calcule
quantité et prix, applique les droits de modification de prix, puis effectue
une seule décrémentation conditionnelle. Le rejeu du `client_id` ne la répète pas.
Le contrôle optionnel `expected_units_per_packaging` refuse une synchronisation
si le facteur a changé depuis la préparation du ticket.

Une ligne de vente fige unités, facteur, unité vendue, quantités carton/pièce,
quantité de base et prix. `unit_price` conserve un prix effectif par unité de base
(pondéré pour une ligne mixte), compatible avec `quantity` et les anciens clients.
Les prix de base et de conditionnement sont également figés séparément.

## Autres opérations

- Approvisionnement : conversion à la commande ; coût historique par unité de
  base. `packaging_unit_cost`, facultatif, accepte un coût par conditionnement.
  Les réceptions partielles utilisent le facteur figé de la commande.
- Retour : conversion avec le facteur du ticket d'origine, jamais celui de la
  fiche actuelle. Le remboursement est limité au montant de ligne non encore
  remboursé. Le choix avoir/espèces et les droits de caisse restent applicables.
- Inventaire : cartons + pièces dans chaque zone, puis comptage entier de base.
- Transfert et mouvements : stock entier de base, avec unités/facteur figés pour
  afficher l'équivalence sans la modifier lors d'une modification de fiche.
- Documents commerciaux, reçus et rapports : quantité de base et équivalence.
  Les regroupements de ventes ayant des facteurs différents sont signalés comme
  « conditionnements variables », sans conversion trompeuse au facteur actuel.
  Les champs libres d'unité des anciens documents restent compatibles.

## Migration et compatibilité

Migration additive et idempotente : aucune quantité ni valeur historique n'est
convertie rétroactivement. Les anciens produits deviennent unité de base « pièce »,
conditionnement vide et facteur 1. Les champs de prix/quantité supplémentaires
restent nullables. Une mise à jour de produit depuis un ancien client ne supprime
pas les paramètres de conditionnement absents de son payload.

Les champs existants des ventes Android/mobile et du miroir central restent
inchangés. Leurs quantités restent en unités de base ; les nouveaux champs de
réponse locaux sont optionnels et les payloads du miroir ne sont pas modifiés.
