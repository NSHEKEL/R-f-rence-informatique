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

## Destination Google Drive (API)

### Préparer Google Cloud

1. Créer un projet dans Google Cloud Console et **activer Google Drive API**.
2. Configurer l'écran de consentement OAuth (nom de l'application, coordonnées).
   Demander uniquement `https://www.googleapis.com/auth/drive.file` : accès aux
   fichiers créés/ouverts par l'application, pas à l'ensemble du Drive. Ce scope
   est **non sensible** ; aucune lecture Gmail/contacts ni scope d'identité n'est
   demandé. L'adresse du compte vient de Drive `about`, pas d'OpenID Connect.
3. Créer un client OAuth de type **Application de bureau**, pas Application Web.
   Le retour utilise `http://127.0.0.1:<port réel>/api/backups/drive/callback`.
   Les clients de bureau acceptent les ports variables de retour en boucle locale.
4. Tant que l'application est en statut **Testing / Test**, ajouter le compte
   Google utilisé dans la liste des utilisateurs de test. Pour ce scope Drive,
   les autorisations hors connexion des applications externes en statut Test
   expirent généralement après **7 jours** : une reconnexion sera nécessaire.
   Pour les sauvegardes récurrentes, publier l'application OAuth en statut
   **Production** ; respecter les exigences de Google (consentement, identité,
   restrictions éventuelles de l'organisation Workspace).
5. Définir `EASYGEST_GDRIVE_CLIENT_ID` et `EASYGEST_GDRIVE_CLIENT_SECRET` dans
   l'environnement du serveur, ou saisir ces valeurs comme administrateur dans
   Configuration → Sauvegarde → Google Drive. Ne pas les ajouter au dépôt.
   Les variables d'environnement sont prioritaires. Sinon le serveur enregistre
   `data_dir()/gdrive_client.json`. Le secret et l'identifiant complet ne sont
   jamais renvoyés par l'API de configuration/statut (uniquement un suffixe masqué).
6. Depuis **le poste serveur**, cliquer sur Connecter Google Drive, autoriser
   l'application dans le navigateur, puis fermer l'onglet de confirmation.
   Un navigateur sur un autre poste LAN ne peut pas utiliser ce retour local.
   PKCE S256 et un état aléatoire à usage unique (10 minutes) protègent le retour ;
   seuls les clients de boucle locale sont acceptés. Sans bridge externe existant,
   l'interface utilise `window.open` ; autoriser les fenêtres surgissantes.
7. Choisir le dossier et la rétention, activer l'envoi automatique, puis enregistrer
   les paramètres Drive. Utiliser Tester la connexion : un petit fichier est
   envoyé, vérifié, puis supprimé.

Le jeton de renouvellement reste dans `data_dir()/gdrive_token.json`. Aucun de ces
fichiers ni les copies temporaires d'envoi ne sont inclus dans une archive métier.
Ils ne sont pas chiffrés sur disque : protéger l'accès au dossier de données.
Déconnecter révoque l'autorisation auprès de Google et efface le jeton local même
si la révocation réseau échoue. Un `invalid_grant` ou HTTP 401 efface également
le jeton et impose une reconnexion. Ne pas copier ces fichiers entre boutiques.

### Transferts et restauration

L'option automatique envoie les sauvegardes manuelles, planifiées et du démarrage
dans un thread, **jamais celles après vente ni avant restauration**. La réussite
locale reste distincte de l'état Drive. Une copie temporaire sous `data_dir` évite
qu'une purge locale supprime une archive pendant son transfert ; elle est effacée
à la fin. Les transferts en mémoire/processus ne survivent pas à un arrêt forcé :
les copies locales restent disponibles pour un nouvel envoi explicite.

« Sauvegarder maintenant sur Drive » utilise `POST /api/backups?drive=true` :
création locale sans double envoi, puis résultat Drive synchrone. Un échec Drive
est renvoyé dans `drive.status=erreur`, sans prétendre que la copie locale a échoué.
Les transferts ont un budget de 180 secondes et des délais réseau de 30 secondes,
avec jusqu'à cinq tentatives, temporisation exponentielle et reprise selon `Range`.
Les blocs font 8 Mio. La taille et le MD5 renvoyés par Google sont vérifiés avant
la réussite ; SHA-256/version/date sont également placés dans `appProperties`.
La rétention supprime uniquement les fichiers marqués `easygest=1` dans le dossier
choisi, du plus ancien au plus récent au-delà du nombre conservé. Un dossier renommé
dans l'interface est recherché/créé ; un identifiant en cache devenu introuvable
est remplacé. Les anciens dossiers et leurs fichiers ne sont pas purgés.

Les routes `/api/backups/drive/{status,client,connect,disconnect,test,files}` et
`/upload/{name}`, `/download/{file_id}` sont réservées à l'administrateur ; seul
`/callback` est sans JWT et utilise les protections OAuth ci-dessus. Le téléchargement
Drive vérifie taille, MD5, puis l'intégrité de l'archive avant de la placer dans
le dossier local de sauvegardes. Le bouton Restaurer ouvre ensuite l'inspection
et la confirmation **RESTAURER**, avec sauvegarde de sécurité habituelle.

Pas de Google Drive réel testé sans identifiants OAuth : les tests automatisés
simulent les réponses Google, y compris reprise après 503 et échecs d'intégrité.
