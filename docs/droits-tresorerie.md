# Droits de trésorerie

Les droits sont cumulés, jamais déduits du seul accès au menu. L'administrateur
garde tous les droits. Les contrôles de licence restent indépendants.

## Rôles et mise à niveau

- Nouveau vendeur : `caisse`, `caisse_fermer`, `vente_nouvelle`, `assistance`.
- Gestionnaire : `produits`, `inventaire`, `fournisseurs`, `categories`,
  `approvisionnements`, `assistance` (inchangé).
- Les cinq nouveaux droits sont désactivés pour les rôles non administrateurs :
  `tresorerie_consulter`, `soldes_consulter`, `recette_enregistrer`,
  `caisse_operations`, `clotures_consulter`.
- `recette_enregistrer` et `caisse_operations` sont réservés aux futures
  opérations de caisse ; ils n'accordent aucun accès supplémentaire à cette étape.
- La migration additive `app_migrations / treasury_permissions_v1` fige les
  droits historiques explicites ou implicites des deux rôles dans
  `role_permissions`. Elle conserve notamment l'ancien `caisse_z` implicite
  sur les installations existantes, mais ce droit seul ne permet plus de lire
  les montants : `soldes_consulter` est indispensable.
- Sur une base neuve sans utilisateurs ni droits enregistrés, les nouveaux
  défauts s'appliquent, sans `caisse_z` vendeur.
- L'ancienne révocation des droits financiers vendeur ne s'exécute qu'une fois :
  les lignes concernées sont conservées et passées à faux, sans suppression.
  Une attribution ultérieure par l'administrateur survit aux redémarrages.
- Aucun droit nouveau n'est accordé pendant la migration. Les droits
  non financiers déjà enregistrés et les refus explicites sont conservés.

## Contrôles serveur

`+` signifie que tous les droits sont nécessaires.

| API | Droits |
| --- | --- |
| Banque : lecture comptes et versements | `tresorerie_consulter` + (`versements_gerer` ou `versements_valider`) |
| Solde des comptes bancaires | Même accès + `soldes_consulter`, sinon solde `null` |
| Création/modification compte bancaire | Administrateur |
| Enregistrement versement | `tresorerie_consulter` + `versements_gerer` |
| Décision/rapprochement versement | `tresorerie_consulter` + `versements_valider` |
| Comptabilité : liste dépenses | `tresorerie_consulter` + `comptabilite` |
| Création/suppression dépense | `tresorerie_consulter` + `depenses_gerer` |
| Synthèse comptable | `tresorerie_consulter` + `comptabilite` + `rapports_financiers` + `soldes_consulter` |
| Rapport ventes | `rapports` + `rapports_financiers` + `soldes_consulter` |
| Tableau de bord | `tableau_bord` + `rapports_financiers` + `soldes_consulter` |
| Dettes : lectures et règlements consultés | `tresorerie_consulter` + `dettes` + `soldes_consulter` |
| Dettes : synthèse, soldes, échéancier, alertes | Même accès + `rapports_financiers` |
| Dettes : actions retournant les soldes | `tresorerie_consulter` + `soldes_consulter` + droit spécifique existant (`dettes_gerer`, `dettes_regler`, `dettes_annuler`) |
| Caisse courante/du jour | Authentification ; état visible, montants `null` sans `soldes_consulter` |
| Historique des caisses | `clotures_consulter` ; montants `null` sans `soldes_consulter` |
| Ouverture/clôture de sa caisse | `caisse` / `caisse_fermer` ; ne nécessitent pas de consulter les soldes |
| Z / ticket de clôture propre | `soldes_consulter` + (`caisse_z` ou `clotures_consulter`) |
| Z d'un autre caissier | `soldes_consulter` + `clotures_consulter` |
| Réouverture exceptionnelle | Administrateur |

Sans accès aux soldes, l'ouverture et la clôture renvoient l'état sans montants,
sans liste détaillée des ventes, ni faux total à zéro. Une note est obligatoire
pour une clôture à l'aveugle : l'erreur de validation ne permet pas de deviner
le solde attendu. Les nouvelles notifications d'ouverture/clôture ne diffusent
plus de fonds ni d'écart. Le ticket financier n'est pas imprimé sans les droits.
Un état de caisse clôturée masque aussi les montants sans droit de clôture.

Les gardes des routes, du menu « Trésorerie » et de l'accueil reprennent les
contrôles serveur. Le vendeur peut toujours ouvrir sa caisse, vendre et clôturer.
Les payloads de vente, de miroir central et l'application Android sont inchangés.
