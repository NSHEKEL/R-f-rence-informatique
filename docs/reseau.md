# Ordinateur principal et postes secondaires

Un seul serveur EasyGest gère une base SQLite. Ne pas partager directement le
fichier SQLite entre plusieurs serveurs : les postes utilisent l'URL HTTP du
principal, configurée dans Configuration → Réseau (`ri_server_url`). Les ports
restent configurables par `EASYGEST_HOST` et `EASYGEST_PORT` ; défaut :
`0.0.0.0:8000`. Réserver une adresse DHCP au principal et, si la restriction est
utilisée, aux postes clients.

## Autoriser les postes

La restriction est **désactivée par défaut** : une mise à jour ne coupe aucun
poste existant. Chaque IP distante vue est enregistrée en attente, avec ses
dates, son dernier utilisateur connu et un indice navigateur/nom de machine.
Le nom de machine déclaré n'est qu'un indice, pas une identité authentifiée.
Les dates d'activité sont rafraîchies au plus toutes les 30 secondes ; le nombre
de postes connectés compte ceux vus depuis dix minutes, y compris les demandes
en attente. L'ancien `/api/network/clients` reste disponible.

Sur le principal, ouvrir Configuration → Réseau comme administrateur : nommer,
autoriser ou bloquer chaque IP, puis activer/enregistrer la restriction. Depuis
un poste distant, **autoriser d'abord sa propre IP**. Les accès via 127.0.0.1 et
::1 sur le principal restent toujours permis (authentification utilisateur et
droits habituels toujours requis). Cela permet de réparer une mauvaise liste.
Supprimer un poste ne le bannit pas : sa prochaine visite recrée une demande.
Pour un bannissement, choisir Bloquer.

L'IP n'est pas une preuve cryptographique d'identité : NAT, changement d'adresse
DHCP, proxy et compte Windows partagé peuvent rendre cette protection moins
précise. Ne pas exposer ce serveur directement sur Internet.

Android conserve le test HTTP 200 sur `/api/health`, même pour une IP en attente
ou bloquée. Cette réponse contient alors `workstation_status`. Le frontend Web
affiche la procédure d'approbation avant connexion et dans le bandeau réseau.
Après approbation, les API redeviennent disponibles sans modification de l'APK.
Les tickets hors ligne restent en attente lors d'un refus d'autorisation du poste.
Le « dernier contact » indique une réponse de santé réussie, pas une réplication
de base ni une garantie que tous les tickets ont déjà été synchronisés.

## Démarrage Windows optionnel

L'installateur propose une tâche **décochée par défaut** : « Ordinateur principal :
démarrer le serveur EasyGest au démarrage de Windows ». Elle crée `EasyGest Server`
avec `schtasks /SC ONSTART /RU SYSTEM /RL HIGHEST` et lance l'exécutable installé
avec `--server`, sans interface, au **prochain démarrage Windows**. Pas de service
Windows ni de connexion interactive requise. La tâche est supprimée à la
désinstallation ; aucune donnée n'est supprimée. Une installation ne sélectionnant
pas cette option ne supprime pas une tâche déjà configurée.

Le compte SYSTEM utilise normalement `%PROGRAMDATA%\EasyGest` pour les données.
Son profil n'est pas celui du commerçant : ses journaux vont dans le sous-dossier
`Logs` du dossier de données (normalement `%PROGRAMDATA%\EasyGest\Logs`), pas
dans un profil system32. Le mode bureau conserve `%LOCALAPPDATA%\EasyGest\Logs`,
avec repli dans le dossier de données si nécessaire. Les réglages placés dans le
`.env` du dossier partagé sont lus ; les variables propres au compte commerçant
ne sont pas héritées par SYSTEM. Vérifier notamment un éventuel
`EASYGEST_DATA_DIR`, les dossiers réseau et les identifiants Google OAuth.
Un lecteur réseau monté dans une session utilisateur n'est pas accessible sous
SYSTEM : utiliser une destination adaptée à ce compte. Protéger le poste et les
comptes Windows autorisés à modifier les données/configurations partagées.

Un lancement bureau sonde d'abord le port préféré : si un EasyGest de même version
y répond, il le réutilise au lieu d'ouvrir un second backend. Le test d'exécutable
`--selftest` conserve son propre serveur. Une autre application/version sur le port
préféré conserve le mécanisme historique de recherche d'un autre port : vérifier
et arrêter l'ancien serveur lors d'une mise à jour, plutôt que garder deux versions.
Le chargement de la base et la permutation d'une restauration sont différés : un
simple lancement qui réutilise le serveur ne doit pas permuter sa base ouverte.
Avec le démarrage automatique actif, fermer seulement la fenêtre bureau n'arrête
pas le serveur. Pour appliquer une restauration ou redémarrer le backend après
mise à jour : fermer les postes, puis dans le Planificateur de tâches Windows,
terminer et relancer `EasyGest Server` (droits administrateur). Le processus
Python empaqueté surveille le handle de son parent Windows : arrêter la tâche
arrête aussi son enfant et libère son port. Vérifier que `/api/health` ne répond
plus avant toute restauration. Un ancien exécutable sans cette surveillance
peut laisser un enfant : le fermer une fois dans le Gestionnaire des tâches
avant la mise à jour ; le lanceur refuse de démarrer tant que cet ancien
serveur répond, plutôt que de réutiliser un orphelin ou de restaurer à côté.
`/api/health` reste public ; `/api/network` exige une session authentifiée.
Android et la configuration d'un poste secondaire testent uniquement la santé
publique avant connexion. La restauration
en attente sera appliquée au nouveau démarrage effectif du serveur.

Le pare-feu conserve TCP 8000, profil **privé**, et limite désormais les adresses
distantes à **LocalSubnet**. L'ancienne règle EasyGest est remplacée pour ne pas
laisser une autorisation plus large active. Un port personnalisé ou un réseau
routé/VPN exige une règle adaptée par l'administrateur. Aucun port public ouvert.

## Ventes et modifications simultanées

Le `client_id` est généré avant le premier POST puis conservé dans la file hors
ligne et ses rejeux. Après une collision d'intégrité, le serveur recherche à
nouveau ce `client_id` : deux encaissements concurrents d'une même opération
retournent la même vente, sans double décrément de stock. Une vente simplement
conservée localement porte le titre « Vente en attente de synchronisation ».

Produits, clients et fournisseurs n'ont pas de colonne `updated_at` dans le modèle
actuel. Le contrôle conditionnel `expected_updated_at` n'a donc pas été ajouté,
ni aucune colonne métier : leurs modifications restent sans verrou optimiste.
