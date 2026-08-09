---
name: testing-ventes-stock
description: End-to-end test the sales/inventory (Ventes & Stock) flow of the Référence Informatique app. Use when verifying product creation, sale creation, stock decrement, stock-guard validation, dashboard metrics, daily till open/close, returns and credit notes, duplicate receipts, printer/logo settings, or the centralised PostgreSQL multi-workstation setup.
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

## Caisse / notifications / inventaire / comptabilité test
1. **Ouverture de caisse** (vendeur, /caisse): "Ouvrir la caisse" + fonds (50000) → bandeau "Caisse ouverte", Solde attendu = fonds.
2. **Vendeur scope**: sidebar = Caisse/Ventes/Clients only, no bell, no `Stock : N` on the article cards, typing `/produits` redirects to `/caisse`.
3. **Encaissement**: search an article, click the card once per unit, add a second article, **Encaisser** → receipt modal + cart cleared + "Ventes espèces" and "Solde attendu" updated.
4. **Admin notification**: login admin → bell badge ≥1 with "Nouvelle vente — VNT-… / <vendeur> a enregistré une vente de N FCFA"; clicking it opens /ventes and decrements the badge.
5. **Inventaire**: type a counted quantity → Écart column; "Appliquer l'inventaire" → stock updated and a `Inventaire` movement (`before → after`, motif, author) added to "Mouvements de stock".
6. **Comptabilité**: note Marge brute, add an expense → `Bénéfice net = marge − dépenses` must be recomputed and the expense listed by category.
7. **Fermeture**: counted amount ≠ expected → "Écart : …" banner, then the closed session appears in "Historique des caisses" with fonds/attendu/compté/écart.

## Centralised PostgreSQL / multi-workstation test
The app falls back to SQLite when `DATABASE_URL` is unset, so a "central DB" claim is only proven when the backend actually runs on PostgreSQL:
```bash
DATABASE_URL="postgresql://<user>:<pwd>@localhost:5432/reference_informatique" SECRET_KEY=... \
  ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Recreate the DB empty before a campaign so references/counters start clean, and never print the password.

Simulating **two workstations in one browser**: a second tab shares `localStorage`, hence the same JWT and role — it does NOT prove multi-user. Use a **second window in private/incognito mode** for the other account (e.g. caissière in the normal window, admin in incognito). Sync assertion: create a sale in window A and, *without touching window B*, watch the new row + notification counter appear there within the polling interval (~4 s via `GET /api/sync/version`).

## Daily till (caisse) / returns / duplicate-receipt test
Order matters: `/caisse` only opens the till, `/ventes/nouvelle` sells, `/ventes` closes the till, `/retours` issues credit notes.
1. **Open till** (cashier): fonds → the opening ticket auto-prints. Adversarial: no second "Ouvrir ma caisse" the same day.
2. **Sell**: type a product name *or the SKU/QR code* then **Enter** (keyboard/scanner path), create the customer inline, Valider → receipt preview appears immediately.
3. **Duplicate**: the "Reçu" column must go from `—` to `Imprimé ×1` then `×2` after a second print, and the reopened modal is titled "Duplicata — VNT-…" with a DUPLICATA banner. Check the counter *increments* — a frozen counter is the real bug.
4. **Return**: `/retours` → ticket reference → quantity → the credit note `AVR-<year>-NNNN` and restocking. Verify the stock from an **admin** window (a cashier has no access to Produits) and compute it end-to-end (`initial − sold + returned`); capture the intermediate value too if you want a direct proof of the decrement.
5. **Close till** from `/ventes`: the closing ticket auto-prints (fonds, ventes espèces, attendu, compté, écart). Adversarial: the button becomes "Caisse déjà fermée aujourd'hui", `/caisse` offers no reopening, and `/ventes/nouvelle` blocks selling.
6. **Dashboard range**: apply "7 jours" (figures + "Meilleures vendeuses"), then a past range with no sales — revenue must fall to 0 and the ranking empty, otherwise the `start`/`end` filter is ignored.
7. **Printer / logo**: set "Imprimante à utiliser", reload (F5) to prove persistence, and check the reminder "Imprimante : …" in the receipt modal footer; with no logo uploaded the receipt shows the company name only, never a broken image.

Gotchas:
- `<input type="date">` segments **append** typed digits (`2026` after an existing value gives `22026`). Press `Delete` on the focused segment first, or use `Up`/`Down`, and move between segments with `Left`/`Right`.
- The computer-tool action is `type` (not `type_text`) and `scroll` needs `scroll_direction`/`scroll_amount`.
- After the till is closed, `/ventes/nouvelle` may still show an "Ouvrir ma caisse" button; it only routes back to `/caisse` — cosmetic, not a reopening.

## Print-format verification (A4 / 80 mm)
Chrome's print preview remembers the last paper size, so it can silently show A4 even when the app asked for a ticket — never conclude from the preview alone. Verify the real page geometry:
```bash
python3 .agents/skills/testing-ventes-stock/print_formats.py  # connect_over_cdp, stub window.print, click Imprimer, CDP Page.printToPDF(preferCSSPageSize=True)
pdftoppm -png -r 100 receipt-80mm.pdf ticket80   # visual check (apt-get install poppler-utils)
```
Then read `/MediaBox` (pt ÷ 72 × 25,4 = mm): A4 must be ≈210 × 297 mm, ticket ≈80 mm wide. A Letter-sized (215,9 × 279,4 mm) result means the `@page` rule was dropped.
Gotcha: `@page { size: 80mm auto; }` is invalid CSS (`auto` can't be combined with a length) — the whole rule is ignored. Use two lengths, e.g. a measured `size: 80mm 121mm`.

## Tips / gotchas
- Native `<select>` dropdowns: click to open, click the option; the annotated DOM lists options with `stock : N` so you can confirm the current stock inline.
- Numeric inputs: click the field, `ctrl+a`, then type — avoids leftover leading zeros.
- The record for the current year auto-seeds ~58 sales; new sales get the next `VNT-<year>-NNNN` ref.
- Maximize the window before recording: `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.
- If a process restart interrupts an active recording, annotations start failing with "no active recording" — restart services and re-run the whole flow in a fresh recording rather than stitching partial ones.
