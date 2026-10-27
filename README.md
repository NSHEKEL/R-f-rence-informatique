# Référence Informatique — Gestion des ventes & du stock

Application web de gestion des ventes et du suivi de stock pour l'entreprise
**Référence Informatique**.

- **Frontend** : React + TypeScript + Vite + Tailwind CSS
- **Backend** : FastAPI + SQLAlchemy + SQLite
- **Authentification** : JWT

## Fonctionnalités

- Tableau de bord (chiffre d'affaires, ventes, alertes de stock, top produits, ventes récentes)
- Produits & Stock (CRUD, seuils d'alerte, états de stock)
- Ventes (panier multi-articles, décrément automatique du stock, statuts)
- Clients, Fournisseurs, Catégories (CRUD)

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
