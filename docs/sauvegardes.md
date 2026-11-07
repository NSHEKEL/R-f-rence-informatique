# Sauvegardes locales

## Format et périmètre

SQLite : `VACUUM INTO`, puis `integrity_check` et `quick_check`, puis archive
`EasyGest-sauvegarde-YYYYMMDD-HHMMSS-<motif>.zip`. Un suffixe numérique évite
les collisions dans la même seconde. L'archive contient `easygest.db` et
`manifest.json` (format 1, version, date ISO avec fuseau local, motif, SHA-256,
taille, tables utilisateur, nombres de lignes, `extra_files`). Elle est rouverte
et vérifiée après écriture ; une archive dont la vérification échoue est supprimée.

Les logos, photos et images sont des data URLs en base. Les réponses FNE sont
en base ; les justificatifs bancaires ne sont que des noms de fichiers, sans
gestion d'envoi/stockage de pièces jointes sur disque. Aucun répertoire de fichiers
métier géré par l'application n'a été identifié sous `data_dir` ; `extra_files`
est donc vide. Un document externe référencé par son nom n'est pas sauvegardé.
Profils WebView2, caches, journaux, exécutables, `.env`, `secret.key` et identité
d'installation ne sont pas inclus. Les archives contiennent des données sensibles
et ne sont pas chiffrées : protéger les copies et leur dossier de destination.

Les anciens `.db` restent listables, exportables et restaurables. Sans manifeste,
leur version/date et leur empreinte d'origine sont inconnues : l'inspection
contrôle SQLite mais ne prétend pas vérifier une empreinte historique.
PostgreSQL conserve son export JSON et sa restauration côté serveur.

## Planification et rétention

Le mode historique effectue une sauvegarde par jour au démarrage. Il est conservé.
La nouvelle planification SQLite, désactivée par défaut, vérifie toutes les
60 secondes une échéance quotidienne, hebdomadaire (lundi = 0) ou mensuelle
(jours 1 à 28), en heure locale du serveur. Garder l'application ouverte.
Une échéance manquée déclenche une seule sauvegarde au prochain démarrage.
Une sauvegarde réussie manuelle, historique ou après vente depuis cette échéance
la couvre également. Une erreur est conservée et une nouvelle tentative peut avoir
lieu au contrôle suivant. `last_backup_at` reste la dernière réussite complète
(y compris la copie au second dossier) ; l'échec ne l'efface pas.
Un verrou partagé sérialise les sauvegardes et la préparation de restauration
dans le processus serveur. Un seul processus serveur doit gérer une même base.

Les N copies les plus récentes dans `data_dir()/backups` sont conservées, tous
formats SQLite confondus (`.db`, `.zip`, anciennes copies `.before-restore`).
Les archives `avant-restauration` suivent cette même règle, sans purge spéciale.
La copie courante `easygest.db.before-restore` située à côté de la base reste
hors rétention ; avant une nouvelle permutation, l'ancienne copie est déplacée
dans `backups`, jamais écrasée, puis devient éligible à la règle N.
Le second dossier est un miroir par copie, sans purge automatique.

## Inspection et restauration

`POST /api/backups/inspect` (administrateur, multipart `file` ou `name`) vérifie
le format, le CRC ZIP, le SHA-256 et la taille déclarés, les deux contrôles SQLite,
les tables et nombres de lignes. Une version d'archive plus récente que
l'application est signalée incompatible. Les fichiers et bases décompressées
sont limités à 512 Mo ; le manifeste à 1 Mo. Aucun chemin ZIP n'est extrait.

`POST /api/backups/restore` demande le même fichier/nom et le champ
`confirm=RESTAURER`. Le serveur répète l'inspection, refuse une version trop
récente, crée une archive `avant-restauration`, puis prépare atomiquement
`restore-pending.db`. Une sauvegarde de sécurité impossible bloque la restauration.
Redémarrer tous les postes utilisant le serveur après la permutation ; ne pas
lancer plusieurs serveurs sur les mêmes fichiers SQLite.

`GET /api/backups` garde son contrat de liste. `GET /api/backups/status` ajoute
planification, dernière réussite, état/erreur, `next_run_at` et indicateur SQLite.
La configuration se sauvegarde via `PUT /api/settings/company`, comme les anciens
paramètres. Le choix « sauvegarde quotidienne au démarrage » et la planification
sont deux options indépendantes.
