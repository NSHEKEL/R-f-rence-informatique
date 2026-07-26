---
name: testing-ventes-stock
description: End-to-end test the sales/inventory (Ventes & Stock) flow of the Référence Informatique app. Use when verifying product creation, sale creation, stock decrement, stock-guard validation, or dashboard metrics.
---

# Testing — Référence Informatique (Ventes & Stock)

Full-stack app: FastAPI backend (`backend/`, port 8000, SQLite auto-seeded) + React/Vite frontend (`frontend/`, port 5173, proxies `/api`).

## Devin Secrets Needed
None. Login is a seeded demo account: `admin@reference.ci` / `admin123`.

## Start the services
Both are killed on any VM/process restart — always re-check and restart before testing:
```bash
# backend
cd backend && nohup ./venv/bin/uvicorn app.main:app --port 8000 > /tmp/backend.log 2>&1 &
# frontend
cd frontend && nohup npm run dev > /tmp/frontend.log 2>&1 &
# verify
curl -s http://localhost:8000/api/health   # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173   # 200
```
Auth token lives in `localStorage` (`ri_token`), so a browser reload usually stays logged in after a restart.

## Golden-path test (T1–T5)
Use a **fresh, uniquely-named product** each run (e.g. `Adaptateur USB-C TEST`, SKU `TEST-...`) so reruns don't collide with prior test data and stock math stays predictable.

1. **T1 Create product**: Produits & Stock → Nouveau produit. Set name, SKU, prix de vente, quantité (e.g. 12), seuil. Save. Search the SKU → verify Stock = quantité, badge "En stock".
2. **T2 Create sale**: Ventes → Nouvelle vente. Pick a client, click **Ajouter** (adds a line; product defaults to the alphabetically-first item — reselect if needed). Set quantity (e.g. 4). Verify modal Total = prix × qty. Valider → new `VNT-...` row on top, statut "Payée".
3. **T3 Stock decrement**: back to Produits, search SKU → Stock = original − qty (the key behavior; must NOT stay at original).
4. **T4 Stock guard (adversarial)**: Nouvelle vente → same product, quantity 999 → Valider. Expect inline red error `Stock insuffisant pour <produit> (disponible : N)`, modal stays open, NO sale created.
5. **T5 Dashboard**: Tableau de bord → CA increased by sale total, Ventes count +1 (only the valid sale, not the rejected 999 one), new sale at top of "Ventes récentes". Capture a baseline dashboard screenshot BEFORE T1 so you can prove the deltas.

## Multi-user / roles test (Admin vs Vendeur)
Verifies the role-based access layer. Roles: `admin` (full) and `vendeur` (sales + read-only catalog).
1. **Admin creates a Vendeur**: Utilisateurs → Nouvel utilisateur → name/email/password, rôle Vendeur → Save. Verify the row shows badges "Vendeur" + "Actif".
2. **Vendeur restricted UI**: logout, login as the vendeur. Sidebar must contain ONLY Tableau de bord, Produits & Stock, Ventes, Clients (NOT Utilisateurs/Fournisseurs/Catégories/Paramètres). Produits page: no "Nouveau produit" button, no per-row edit/delete. Ventes: can create, no delete icon.
3. **Vendeur creates a sale**: confirm it succeeds and gets a new `VNT-...` ref.
4. **Traceability**: logout, login admin, open that sale's detail (eye icon) → field "Créée par" shows the vendeur's name.
5. **Deactivation gate**: admin → Utilisateurs → toggle the vendeur to Désactivé (badge turns red). Logout, attempt vendeur login → rejected with inline "Compte désactivé", stays on /login. Reactivate afterwards to leave a clean state.

Gotchas:
- On an already-seeded DB the demo `vendeur@reference.ci` may or may not exist (only auto-seeded on an empty DB). Create a test vendeur via the UI rather than assuming it exists.
- The deactivate/activate action is the eye-style icon next to the pencil (Modifier) in the Utilisateurs row; title toggles between "Désactiver"/"Activer".
- Admin can't deactivate/demote/delete the last active admin or their own account (buttons hidden/blocked) — expected, not a bug.

## Receipt + company-config test (Reçu de caisse & Paramètres)
Verifies the printable/editable receipt and the persisted company configuration that feeds the receipt header/footer.
1. **Company config persists**: /parametres (admin-only) → "Configuration de l'entreprise". Change distinctive values (adresse, téléphone, "Message de pied de reçu") → **Enregistrer** → green "Enregistré" chip. Reload (F5) → fields must still show the new values (proves `GET`+`PUT /api/settings/company`). If they revert, persistence is broken.
2. **Receipt reflects config + sale**: /ventes → click the receipt icon (middle of the 3 row actions, between eye and trash) → modal shows a receipt whose header carries the configured adresse/téléphone (not blank/hardcoded), plus the sale's réf, articles, total, and "Vendeur".
3. **Editable receipt persists**: in the modal click **Modifier** → change Note + "Message de pied de reçu"; the receipt preview below updates **live**. **Enregistrer** → panel closes. To prove DB persistence, reload the page (F5) then reopen the same receipt — the edited note/footer must remain (proves `PUT /api/sales/{id}`). A reopen without reload only proves in-memory state.
4. **Print scope**: click **Imprimer** → Chrome print preview shows ONLY the receipt (app sidebar/nav/modal buttons excluded via `@media print` + `#receipt-print`). The top/bottom text in the preview is Chrome's own page header/footer, not app UI. Cancel to exit.

Gotchas:
- A sale's own `receipt_footer` overrides the company-wide footer — expected priority, not a bug.
- Editing a receipt must NOT change items/total/stock (backend `PUT /api/sales/{id}` only touches customer/payment/note/footer).
- The `type` action drops special chars like the em-dash "—"; use plain hyphens in test values to keep assertions exact.

## Tips / gotchas
- Native `<select>` dropdowns: click to open, click the option; the annotated DOM lists options with `stock : N` so you can confirm the current stock inline.
- Numeric inputs: click the field, `ctrl+a`, then type — avoids leftover leading zeros.
- The record for the current year auto-seeds ~58 sales; new sales get the next `VNT-<year>-NNNN` ref.
- Maximize the window before recording: `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.
- If a process restart interrupts an active recording, annotations start failing with "no active recording" — restart services and re-run the whole flow in a fresh recording rather than stitching partial ones.
