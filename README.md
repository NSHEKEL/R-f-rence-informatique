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
- Clients, Fournisseurs, Catégories (CRUD)
- Rôles : Administrateur (tout) et Vendeur (caisse, ventes, clients uniquement)

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

3. Sur les **autres postes** (même réseau / même Wi-Fi), ouvrir l'adresse
   réseau affichée par le serveur, par exemple `http://192.168.1.20:8000`.
   Aucune installation n'est nécessaire sur ces postes.

À savoir :

- le fichier `reference.db` reste **uniquement** sur le PC serveur : ne pas le
  copier sur les autres postes et ne pas le partager via un dossier réseau ;
- la fenêtre de l'application doit rester ouverte sur le PC serveur ;
- chaque poste se connecte avec son propre compte (les ventes sont tracées par
  utilisateur) ;
- SQLite est configuré en mode WAL avec attente de verrou, et les ventes
  simultanées sont gérées (références uniques, stock décrémenté de façon
  atomique).

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
