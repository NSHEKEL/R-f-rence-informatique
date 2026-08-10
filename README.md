# Référence Informatique — Gestion des ventes & du stock

Application web de gestion des ventes et du suivi de stock pour l'entreprise
**Référence Informatique**.

- **Frontend** : React + TypeScript + Vite + Tailwind CSS
- **Backend** : FastAPI + SQLAlchemy + SQLite
- **Authentification** : JWT

## Fonctionnalités

- Tableau de bord (chiffre d'affaires, ventes, alertes de stock, top produits, ventes récentes)
- Produits & Stock (CRUD, seuils d'alerte, états de stock)
- Caisse (écran de vente rapide, panier, encaissement, reçu imprimable A4 ou ticket 80 mm)
- Ouverture / fermeture de caisse avec fonds initial, solde attendu et écart
- Ventes (historique, reçus modifiables, traçabilité de l'auteur)
- Inventaire physique (comptage, écarts, ajustements et historique des mouvements)
- Comptabilité (chiffre d'affaires, coût des marchandises, marge, dépenses, bénéfice net)
- Notifications administrateur (vente d'un vendeur, stock faible, ouverture/fermeture de caisse)
- Articles : photo, code-barres saisi ou généré (EAN-13), prix détail et prix de gros
- POS : catégories horizontales, meilleures ventes par défaut, scan code-barres/QR/SKU,
  bascule détail / gros (les photos n'apparaissent jamais sur le reçu)
- Rapports (CA, ventes, retours, revenu net, ticket moyen, par jour/paiement/vendeuse/catégorie/article)
- Factures proforma imprimables (aucun mouvement de stock)
- Fiches d'inventaire imprimables (feuille de comptage et relevé d'écarts)
- Mot de passe oublié par e-mail (SMTP configurable) avec repli « réinitialisation admin »
- Clients, Fournisseurs, Catégories (CRUD)
- Menu latéral pliable/dépliable (l'état est mémorisé par poste)
- Page « À propos de nous » alimentée par la configuration de l'entreprise
- Mise à jour à distance de l'application installée chez les clients
- Rôles : Administrateur (tout) et Vendeur (**Ma caisse** et **Nouvelle vente** uniquement)

## Démarrage

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

L'API démarre sur http://localhost:8000 et initialise une base de démonstration.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

L'application démarre sur http://localhost:5173 (proxy `/api` → backend).

> **Node.js** : utiliser la version 20.19+ ou 22.12+.

### Connexion de démonstration

- Email : `admin@reference.ci`
- Mot de passe : `admin123`

## Plusieurs ordinateurs sur la même base de données

L'application fonctionne en mode « un serveur, plusieurs postes » : un seul PC
héberge l'application **et** la base de données, les autres s'y connectent avec
leur navigateur.

1. Sur le **PC serveur**, lancer `ReferenceInformatique.exe` (ou
   `python backend/run.py`). La fenêtre affiche deux adresses :

   ```text
   Ce poste (serveur)     : http://127.0.0.1:8000
   Autres postes (réseau) : http://192.168.1.20:8000
   ```

2. Autoriser le port 8000 dans le pare-feu Windows du PC serveur
   (PowerShell **en administrateur**, une seule fois) :

   ```powershell
   New-NetFirewallRule -DisplayName "Reference Informatique" -Direction Inbound `
     -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
   ```

3. Sur les **autres postes** (même réseau / même Wi-Fi), deux possibilités :

   - **Le plus simple** : ouvrir dans le navigateur l'adresse réseau affichée
     par le serveur, par exemple `http://192.168.1.20:8000`. Aucune
     installation n'est nécessaire.
   - **Avec l'exe installé sur le poste** : sur l'écran de connexion, cliquer
     sur **Poste serveur**, saisir `192.168.1.20` (le port `8000` est ajouté
     automatiquement), cliquer sur **Tester** puis **Enregistrer**. Le poste
     utilise immédiatement le serveur, sans redémarrage.

   Si le test échoue, vérifier dans l'ordre : l'application est lancée sur le
   serveur, les deux PC sont sur le même réseau (`ping 192.168.1.20`), la
   règle de pare-feu de l'étape 2 existe, et l'adresse IP du serveur n'a pas
   changé (lui réserver une IP fixe dans la box évite ce problème).

À savoir :

- le fichier `reference.db` reste **uniquement** sur le PC serveur : ne pas le
  copier sur les autres postes et ne pas le partager via un dossier réseau ;
- la fenêtre de l'application doit rester ouverte sur le PC serveur ;
- chaque poste se connecte avec son propre compte (les ventes sont tracées par
  utilisateur) ;
- SQLite est configuré en mode WAL avec attente de verrou, et les ventes
  simultanées sont gérées (références uniques, stock décrémenté de façon
  atomique).

### Base de données centralisée PostgreSQL (recommandé en entreprise)

Pour un déploiement multi-postes durable, la base SQLite est remplacée par une
base **PostgreSQL** hébergée sur le poste serveur ou chez un hébergeur (Neon,
Supabase, VPS…). Seul le backend parle à la base : les postes clients passent
toujours par l'API, jamais directement par la base.

1. Créer la base et son utilisateur :

   ```sql
   CREATE USER vente WITH PASSWORD 'motdepasse';
   CREATE DATABASE reference_informatique OWNER vente;
   ```

2. Sur le poste serveur, créer un fichier `.env` à côté de l'exécutable (ou
   dans `backend/`) :

   ```env
   DATABASE_URL=postgresql://vente:motdepasse@192.168.1.20:5432/reference_informatique
   SECRET_KEY=une-longue-chaine-aleatoire
   ```

   Variables facultatives : `ACCESS_TOKEN_EXPIRE_MINUTES`, `DB_POOL_SIZE`,
   `DB_MAX_OVERFLOW`, `DB_POOL_RECYCLE`.

3. Relancer l'application : les tables sont créées et migrées automatiquement.
   Sans `DATABASE_URL`, l'application retombe sur SQLite (mono-poste).

Les postes indiquent l'adresse du serveur sur l'écran de connexion
(**Poste serveur**) ou dans *Paramètres → Serveur central*. Les écrans se
rafraîchissent automatiquement quand un autre poste enregistre une vente, un
retour ou une ouverture de caisse.

## Mise à jour à distance des postes clients

Chaque installation interroge les *releases* GitHub du dépôt et peut se mettre
à jour toute seule, sans intervention sur place.

1. Publier une nouvelle version : incrémenter `APP_VERSION` dans
   `backend/app/version.py`, committer, puis pousser un tag identique
   (`git tag v1.3.1 && git push origin v1.3.1`). GitHub Actions compile le
   `.exe` et crée la release.
2. Sur le poste serveur du client : **Paramètres → Mise à jour de
   l'application → Rechercher une mise à jour**, puis **Installer**.
   L'application télécharge le nouvel exécutable, se ferme, se remplace et
   redémarre ; la base de données et la configuration sont conservées.

Le dépôt consulté est celui de `UPDATE_REPO` ; les variables d'environnement
`UPDATE_REPO` et `UPDATE_ASSET` permettent de le changer sans recompiler.
La vérification et l'installation sont réservées à un administrateur.

## Envoi d'e-mails (mot de passe oublié)

Dans **Paramètres → Envoi d'e-mails**, renseigner le compte SMTP. Avec Gmail,
utiliser un **mot de passe d'application**
(https://myaccount.google.com/apppasswords) et non le mot de passe du compte :

| Champ | Valeur |
| --- | --- |
| Serveur SMTP | `smtp.gmail.com` |
| Port | `587` |
| Identifiant | l'adresse Gmail complète |
| Mot de passe | le mot de passe d'application (16 caractères) |
| Adresse d'expédition | l'adresse Gmail complète |
| Connexion sécurisée (TLS) | cochée |

Le bouton **Envoyer un test** envoie un message à l'administrateur connecté.
Le mot de passe SMTP n'est jamais renvoyé par l'API : l'interface indique
seulement si l'envoi est configuré. Sans SMTP, la réinitialisation reste
possible depuis **Utilisateurs**.

## Sécurité

- Mots de passe hachés (bcrypt), jamais stockés en clair.
- Clé de signature JWT via `SECRET_KEY` ; à défaut, une clé aléatoire est
  générée et conservée sur le poste serveur.
- Tentatives de connexion limitées (8 essais par 5 minutes et par compte).
- Jetons de réinitialisation hachés en base, à usage unique et expirant en
  60 minutes ; la réponse ne révèle jamais si une adresse existe.
- Mot de passe SMTP jamais renvoyé par l'API.
- CORS limité aux adresses du réseau local ; en production, restreindre avec
  `ALLOWED_ORIGINS=https://mon-domaine` dans le `.env`.
- PostgreSQL n'est joignable que par le serveur : les postes passent par l'API.
- Permissions appliquées côté API (source de vérité), pas seulement dans le menu :
  un vendeur reçoit `403` sur les ventes, retours, clients, rapports et proformas.
- Ne jamais versionner le fichier `.env` ni la base de données.

## Package Windows (application installable)

Un exécutable Windows autonome (`.exe`) regroupe le backend et le frontend :
le double-clic lance l'application et ouvre le navigateur sur
http://127.0.0.1:8000. La base SQLite est créée dans le dossier
`ReferenceInformatique` du profil utilisateur.

Le `.exe` est compilé automatiquement par GitHub Actions
(`.github/workflows/build-windows.yml`) :

- **Manuellement** : onglet *Actions* → *Build Windows package* → *Run
  workflow*. L'exécutable est disponible dans les *Artifacts* du run.
- **Publication** : pousser un tag `v*` (ex. `v1.0.0`) crée une *Release*
  GitHub avec le `.exe` en pièce jointe téléchargeable.

Compilation locale sur une machine Windows (frontend déjà buildé) :

```bash
cd frontend && npm ci && npm run build && cd ..
pip install -r backend/requirements.txt pyinstaller
pyinstaller packaging/ReferenceInformatique.spec
# -> dist/ReferenceInformatique.exe
```
