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
