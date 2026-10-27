---
name: testing-ventes-stock
description: End-to-end test the sales/inventory (Ventes & Stock) flow of the Référence Informatique app. Use when verifying product creation, sale creation, stock decrement, stock-guard validation, dashboard metrics, daily till open/close, returns and credit notes, duplicate receipts, printer/logo settings, the FNE (electronic invoicing) skeleton, or the centralised PostgreSQL multi-workstation setup.
---

# Testing — Référence Informatique (Ventes & Stock)

> Suggestion de mise à jour du skill existant (.agents/skills/testing-ventes-stock/SKILL.md) — ajouter les deux notes ci-dessous dans les sections correspondantes.

## Notes à ajouter

Dans « Multi-user / roles test » :
- Sur la base de test PostgreSQL (port 8001), `vendeur.t` existe mais son mot de passe temporaire doit être régénéré : `POST /api/users/{id}/reset-password` avec le token admin renvoie `{"password": "…"}`.

Dans « Start the services » / gotchas :
- `frontend/vite.config.ts` hardcode le proxy `/api` vers `http://localhost:8000`. Pour tester contre un backend sur un autre port (ex. la base PostgreSQL de test sur :8001), lancer vite avec une petite config alternative (copie de vite.config.ts avec `target: 'http://localhost:8001'`) plutôt que d'éditer le fichier tracké : `npm run dev -- --config vite.<nom>.config.ts`.
- La page Ventes charge `/api/sales` **et** `/api/customers` dans le même `Promise.all` : un compte ayant « ventes » mais pas « clients » voit « Impossible de charger les ventes » (accorder les deux droits pour un test UI non-admin).
- Login API : le JSON attend `{"email": "<identifiant>", "password": "…"}` (le champ s'appelle `email` même pour un identifiant court comme `admin` ou `vendeur.t`).
- Hors-ligne : couper uniquement le backend ne suffit pas si vite (proxy) tourne encore — le proxy renvoie **502**, une réponse HTTP existe, donc `checkout()` prend la branche erreur serveur (« Erreur lors de l'encaissement ») au lieu de la file hors-ligne. Pour tester le vrai chemin offline (`ri_pending_sales`), il faut que la connexion échoue **sans réponse HTTP** (tuer vite aussi, ou stopper le backend ET le proxy). `SIGSTOP` sur vite laisse le backlog TCP ouvert → la requête pend ; `SIGKILL` donne un vrai ECONNREFUSED. La resync (`flushPendingSales`) ne se déclenche que sur la **transition** offline→online (ping santé /api/health toutes les 15 s) — un ticket en file est invisible dans la bannière tant qu'on reste en ligne.
- `pkill -f "<motif>"` où le motif apparaît dans la ligne de commande du shell exec tue le shell lui-même (exit -1) — préférer `ss -tlnp | grep <port>` + `kill <pid>`.
- `migrate()` tourne au démarrage uvicorn : après un changement de schéma (ex. colonne `proformas.kind`), un backend déjà lancé sur l'ancienne base ne l'a pas — redémarrer le process avant de tester les nouvelles colonnes.

## Devin Secrets Needed
None.
