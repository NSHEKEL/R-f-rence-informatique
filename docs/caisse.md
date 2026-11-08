# Ma caisse : ouverture, contrôle et clôture

Seul le module **Ma caisse** propose la clôture. Le journal des ventes et le POS
ne comportent ni bouton, ni modale, ni appel de clôture.

Une session appartient au caissier authentifié, pas à l'adresse IP. Tous ses
postes approuvés et les tickets hors ligne rejoués sur le serveur rejoignent
sa session ouverte. Sans session ouverte, une nouvelle vente est refusée ;
le rejeu d'un `client_id` déjà enregistré renvoie toujours la vente existante.

## Recettes et sorties

- `POST /api/cash-sessions/movements` : type `in` ou `out`, montant strictement
  positif et fini, motif obligatoire. La session est déterminée par le serveur.
- Recette : `caisse_operations` ou `recette_enregistrer`.
- Sortie : `caisse_operations`.
- `GET /api/cash-sessions/{id}/movements` : propriétaire ou
  `clotures_consulter`. Les montants sont `null` sans `soldes_consulter`.
- La table additive `cash_movements` conserve session, type, montant, motif,
  utilisateur, date et IP du poste. Aucun mouvement n'est modifiable/supprimable
  par cette API. Les écritures sur une caisse fermée sont refusées.

## Calcul unique

`session_amounts()` produit les montants de Ma caisse, du contexte de caisse
du POS, des tickets, du Z et des écarts par session du tableau de bord.
Les rapports ventes/comptabilité globaux restent des rapports de période,
pas des calculs de solde de session.

Espèces attendues = fonds d'ouverture + ventes espèces + règlements espèces
nets + recettes − sorties − remboursements espèces − versements espèces validés.

Les règlements clients sont positifs, les paiements fournisseurs négatifs.
Les opérations non espèces, annulées et les ventes offertes ne remplissent pas
le tiroir. Les règlements et remboursements nouveaux sont liés explicitement
à la session. Pour les anciens règlements sans lien, seul le même caissier et
la fenêtre de sa session sont retenus. Les dépenses/acomptes affichés à titre
informatif sont aussi limités au caissier et à sa fenêtre ; ils ne sont pas
présumés payés en espèces.

Un retour reste par défaut un **avoir**, sans présumer un décaissement.
Le choix explicite « remboursement en espèces » exige une caisse ouverte et
`caisse_operations`, puis rattache le remboursement à cette caisse. Les retours
historiques restent des avoirs, sans modification des anciennes clôtures.

## Clôtures historiques

Le Z enregistré est renvoyé tel quel, y compris les anciennes valeurs et clés.
Il n'est ni recalculé ni réécrit lors de la migration.
Si un ancien Z est absent, le solde attendu enregistré est conservé et la
consultation ne crée pas rétroactivement un nouveau Z.
L'action administrateur de réouverture crée désormais une **nouvelle session**,
avec le solde compté précédent comme fonds initial. L'ancienne session, ses
montants et son Z restent fermés et inchangés. Une ouverture normale permet
également de reprendre les ventes après clôture.

Les opérations de vente, livraison, règlement et caisse sont sérialisées avec
la clôture par une écriture conditionnelle sur la session ouverte, compatible
SQLite et PostgreSQL. Le miroir central et l'application Android sont inchangés.
