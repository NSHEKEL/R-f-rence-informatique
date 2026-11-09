"""Read-only accounting projections. Source amounts are never rewritten."""

import json
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload

from .models import (AccountingAccount, AccountingSetting, AppMigration, BankAccount, BankDeposit,
    CashMovement, Category, Debt, DebtPayment, Expense, Payslip, PayslipLine, Product, Purchase, Sale, SaleReturn, User)
from .profits import line_revenue, unit_cost


SEED_ACCOUNTS = {
    "101": "Capital social", "121": "Report à nouveau créditeur", "129": "Report à nouveau débiteur",
    "131": "Résultat net : bénéfice", "139": "Résultat net : perte", "31": "Marchandises",
    "401": "Fournisseurs", "4091": "Fournisseurs, avances et acomptes versés", "411": "Clients", "4191": "Clients, avances et avoirs non imputés", "422": "Personnel, rémunérations dues",
    "4431": "TVA facturée sur ventes", "4452": "TVA récupérable sur achats", "4711": "Compte d'attente",
    "521": "Banques locales", "571": "Caisse", "585": "Virements de fonds",
    "601": "Achats de marchandises", "6031": "Variation des stocks de marchandises",
    "605": "Autres achats", "611": "Transports sur achats", "613": "Transports pour le compte de tiers",
    "622": "Locations et charges locatives", "624": "Entretien et réparations", "628": "Frais de télécommunications",
    "631": "Frais bancaires", "632": "Rémunérations d'intermédiaires", "641": "Impôts et taxes directs",
    "658": "Charges diverses", "661": "Rémunérations directes du personnel", "671": "Intérêts des emprunts",
    "701": "Ventes de marchandises", "709": "Rabais, remises et ristournes accordés", "758": "Produits divers",
}
DEFAULT_LINKS = {"ventes": "701", "clients": "411", "caisse": "571", "fournisseurs": "401", "achats": "601",
    "tva_collectee": "4431", "tva_deductible": "4452", "remises": "709", "retours": "709", "avoirs_clients": "4191", "avances_fournisseurs": "4091", "paie": "661", "personnel": "422"}


def seed_accounts(connection):
    for model in (AccountingAccount, AccountingSetting, AppMigration):
        model.__table__.create(bind=connection, checkfirst=True)
    marker = "accounting_syscohada_v1"
    if connection.execute(select(AppMigration.name).where(AppMigration.name == marker)).first():
        return
    existing = set(connection.execute(select(AccountingAccount.number)).scalars())
    for number, label in SEED_ACCOUNTS.items():
        if number not in existing:
            connection.execute(AccountingAccount.__table__.insert().values(number=number, label=label, class_number=int(number[0]),
                type="charge" if number[0] == "6" else "produit" if number[0] == "7" else "bilan", active=True, is_system=True))
    existing_links = set(connection.execute(select(AccountingSetting.key)).scalars())
    for key, value in DEFAULT_LINKS.items():
        if key not in existing_links:
            connection.execute(AccountingSetting.__table__.insert().values(key=key, value=value, changed_by_name="Initialisation SYSCOHADA"))
    connection.execute(AppMigration.__table__.insert().values(name=marker))


def money(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Montant absent ou invalide")
    if not result.is_finite():
        raise ValueError("Montant non fini")
    return result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def configuration(db):
    settings = db.query(AccountingSetting).order_by(AccountingSetting.key).all()
    return {"accounts": [{"number": a.number, "label": a.label, "class_number": a.class_number, "type": a.type, "active": a.active, "is_system": a.is_system} for a in db.query(AccountingAccount).order_by(AccountingAccount.number)],
        "settings": [{"key": s.key, "value": s.value, "changed_by_name": s.changed_by_name, "changed_at": s.changed_at.isoformat()} for s in settings],
        "banks": [{"id": a.id, "name": a.label or a.bank_name} for a in db.query(BankAccount)],
        "expense_categories": sorted({e.category or "Divers" for e in db.query(Expense)} | {"Achat marchandise", "Salaires", "Loyer", "Électricité / Eau", "Transport", "Divers"}),
        "payroll_deductions": sorted({line.label for line in db.query(PayslipLine).filter(PayslipLine.kind == "retenue")}),
        "purchases": [{"id": p.id, "reference": p.reference, "supplier": p.supplier_name} for p in db.query(Purchase).filter(Purchase.status != "Annulé")],
        "debts": [{"id": d.id, "reference": d.reference, "party": d.party, "purchase_id": d.purchase_id, "amount": d.amount} for d in db.query(Debt).filter(Debt.kind == "dette")],
        "users": [{"id": u.id, "name": u.name} for u in db.query(User)]}


def derive(db):
    settings = {s.key: s for s in db.query(AccountingSetting)}
    accounts = {a.number: a for a in db.query(AccountingAccount)}
    users = {u.id: u.name for u in db.query(User)}
    entries, missing = [], []
    historical = settings.get("historical_tax")
    declaration = json.loads(historical.value) if historical else {"rate": None, "start": None}
    footer = "Documents annulés et leurs règlements/retours exclus, y compris des périodes passées ; projection recalculée, sans clôture comptable. Fonds d'ouverture des caisses non comptabilisés sans pièce de contrepartie. Avoirs non imputés en 4191, sans diminution automatique des créances."
    if historical:
        footer += f" Régime TVA antérieur : {declaration.get('rate')} % ; début : {declaration.get('start') or 'sans limite'} ; déclaré par {historical.changed_by_name} le {historical.changed_at.isoformat()}."

    def account(key):
        setting = settings.get(key)
        number = setting.value if setting else None
        if not number or number not in accounts or not accounts[number].active:
            raise ValueError(f"Compte de liaison absent ou inactif : {key}")
        return number

    def payment(method, bank_id=None):
        if not method:
            raise ValueError("Mode de paiement absent")
        if method == "Espèces":
            if bank_id:
                raise ValueError("Mode espèces incompatible avec un compte bancaire source")
            return account("caisse")
        if method in ("Crédit", "À crédit"):
            raise ValueError("Un règlement à crédit n'est pas un paiement effectif")
        if bank_id:
            if method not in ("Virement", "Chèque", "Carte bancaire", "Mobile Money") and f"paiement:{method}" not in settings:
                raise ValueError(f"Mode de paiement inconnu : {method}")
            if db.get(BankAccount, bank_id) is None:
                raise ValueError("Compte bancaire source introuvable")
            return account(f"banque:{bank_id}")
        return account(f"paiement:{method}")

    def tax(document, total):
        rate = document.vat_rate_snapshot
        if rate is None:
            rate = declaration.get("rate")
        if rate is None:
            raise ValueError("TVA historique non justifiée : déclaration administrateur absente")
        rate = Decimal(str(rate))
        if not rate.is_finite() or rate < 0 or rate > 100:
            raise ValueError("Taux de TVA invalide")
        ht = money(total / (1 + rate / 100))
        return ht, total - ht

    def operation(source, obj, date, journal, build, party=None):
        reference = getattr(obj, "reference", None) or getattr(obj, "receipt_reference", None) or f"{source.upper()}-{obj.id}"
        base = dict(source_type=source, source_id=obj.id, reference=reference, date=date.isoformat() if date else "", journal=journal,
            user_id=getattr(obj, "created_by_id", None) or getattr(obj, "user_id", None), label=getattr(obj, "label", None) or getattr(obj, "reason", None) or reference,
            party=party)
        base["user"] = users.get(base["user_id"], "Non renseigné")
        if not date:
            missing.append({**base, "reason": "Date source absente"})
            return
        if declaration.get("start") and date.date().isoformat() < declaration["start"]:
            missing.append({**base, "reason": "Avant la date de début de comptabilisation"})
            return
        try:
            postings = build()
            debit = sum((money(d) for _, d, _ in postings), Decimal(0))
            credit = sum((money(c) for _, _, c in postings), Decimal(0))
            if debit != credit or debit <= 0:
                raise ValueError("Écriture déséquilibrée ou montant nul")
            if any(money(d) < 0 or money(c) < 0 or (money(d) and money(c)) for _, d, c in postings):
                raise ValueError("Débit/crédit invalide")
            entries.append({**base, "lines": [{"account": n, "account_label": accounts[n].label, "debit": float(money(d)), "credit": float(money(c))} for n, d, c in postings if money(d) or money(c)]})
        except ValueError as error:
            missing.append({**base, "reason": str(error)})

    for sale in db.query(Sale).options(selectinload(Sale.items), selectinload(Sale.payments)).filter(Sale.status != "Annulée", Sale.is_gift.is_(False)):
        def build_sale(sale=sale):
            total = money(sale.total)
            ht, vat = tax(sale, total)
            legs = [(p.method, money(p.amount)) for p in sale.payments] or [(sale.payment_method, total)]
            if sum((amount for _, amount in legs), Decimal(0)) != total:
                raise ValueError("Ventilation des paiements différente du total de vente")
            discount = money((sale.discount or 0) + sum(item.discount or 0 for item in sale.items))
            gross_ht, _ = tax(sale, total + discount)
            discount_ht = gross_ht - ht
            return [(account("clients") if method in ("Crédit", "À crédit") else payment(method), amount, 0) for method, amount in legs] + [(account("ventes"), 0, gross_ht)] + ([(account("remises"), discount_ht, 0)] if discount_ht else []) + ([(account("tva_collectee"), 0, vat)] if vat else [])
        operation("sale", sale, sale.date, "VT", build_sale, f"client:{sale.customer_id}" if sale.customer_id else None)

    for purchase in db.query(Purchase).filter(Purchase.status != "Annulé"):
        def build_purchase(p=purchase):
            if p.status != "Reçu":
                raise ValueError("Réception partielle : facture complète non justifiée")
            total = money(p.total)
            ht, vat = tax(p, total)
            return [(account("achats"), ht, 0)] + ([(account("tva_deductible"), vat, 0)] if vat else []) + [(account("fournisseurs"), 0, total)]
        if purchase.status in ("Reçu", "Reçu partiellement") or purchase.invoice_number:
            operation("purchase", purchase, purchase.received_at, "AC", build_purchase, f"supplier:{purchase.supplier_id}" if purchase.supplier_id else None)
        if purchase.paid:
            operation("purchase_payment", purchase, purchase.date, "CA" if purchase.payment_method == "Espèces" else "BQ",
                lambda p=purchase: [(account("avances_fournisseurs"), money(p.paid), 0), (payment(p.payment_method, p.bank_account_id), 0, money(p.paid))], f"supplier:{purchase.supplier_id}" if purchase.supplier_id else None)
            if purchase.status == "Reçu":
                operation("purchase_prepayment_clear", purchase, purchase.received_at, "OD", lambda p=purchase: [(account("fournisseurs"), money(p.paid), 0), (account("avances_fournisseurs"), 0, money(p.paid))], f"supplier:{purchase.supplier_id}" if purchase.supplier_id else None)

    for credit in db.query(SaleReturn).options(joinedload(SaleReturn.sale)):
        if credit.sale and credit.sale.status == "Annulée":
            continue
        def build_return(c=credit):
            total = money(c.total)
            ht, vat = tax(c, total)
            contra = account("avoirs_clients") if c.refund_method == "Avoir" else payment(c.refund_method)
            return [(account("retours"), ht, 0)] + ([(account("tva_collectee"), vat, 0)] if vat else []) + [(contra, 0, total)]
        operation("return", credit, credit.date, "VT", build_return, f"client:{credit.sale.customer_id}" if credit.sale and credit.sale.customer_id else None)

    for settlement in db.query(DebtPayment).options(joinedload(DebtPayment.debt).joinedload(Debt.sale)).filter(DebtPayment.cancelled.is_(False)):
        debt = settlement.debt
        if debt.sale and debt.sale.status == "Annulée":
            continue
        def build_settlement(s=settlement, d=debt):
            if d.kind == "dette" and not d.purchase_id:
                raise ValueError("Dette fournisseur non liée explicitement à un achat")
            if d.kind == "creance" and not d.sale_id:
                raise ValueError("Créance sans vente source liée")
            if d.purchase_id and (not db.get(Purchase, d.purchase_id) or db.get(Purchase, d.purchase_id).status != "Reçu"):
                raise ValueError("Achat lié non reçu ou absent")
            amount = money(s.amount)
            target = payment(s.method, s.bank_account_id)
            return [(target, amount, 0), (account("clients"), 0, amount)] if d.kind == "creance" else [(account("fournisseurs"), amount, 0), (target, 0, amount)]
        operation("settlement", settlement, settlement.date, "CA" if settlement.method == "Espèces" else "BQ", build_settlement,
            f"client:{debt.customer_id}" if debt.kind == "creance" else f"supplier:{debt.supplier_id}")

    for debt in db.query(Debt):
        if debt.sale_id or debt.purchase_id:
            continue
        def missing_principal():
            raise ValueError("Dette ou créance sans pièce d'origine liée : aucun solde initial n'est supposé")
        operation("debt", debt, debt.created_at, "OD", missing_principal)
    for expense in db.query(Expense):
        operation("expense", expense, expense.date, "CA" if expense.payment_method == "Espèces" else "BQ",
            lambda e=expense: [(account(f"depense:{e.category or 'Divers'}"), money(e.amount), 0), (payment(e.payment_method, e.bank_account_id), 0, money(e.amount))])
    for movement in db.query(CashMovement):
        def build_movement(m=movement):
            cash, counterpart, amount = account("caisse"), account(f"mouvement:{m.type}"), money(m.amount)
            return [(cash, amount, 0), (counterpart, 0, amount)] if m.type == "in" else [(counterpart, amount, 0), (cash, 0, amount)]
        operation("cash_movement", movement, movement.created_at, "CA", build_movement)
    for deposit in db.query(BankDeposit).filter(BankDeposit.status == "validé"):
        def build_deposit(d=deposit):
            if d.method != "Espèces":
                raise ValueError("Origine du versement non espèces non documentée")
            return [(account(f"banque:{d.account_id}"), money(d.amount), 0), (account("caisse"), 0, money(d.amount))]
        operation("bank_deposit", deposit, deposit.deposit_date, "BQ", build_deposit)
    for payslip in db.query(Payslip).filter(Payslip.status.in_(["Validée", "Payée"])):
        def build_payroll(p=payslip):
            deductions = [(account(f"paie_retenue:{line.label}"), 0, money(line.amount)) for line in p.lines if line.kind == "retenue" and line.amount]
            if sum((amount for _, _, amount in deductions), Decimal(0)) != money(p.deductions):
                raise ValueError("Retenues de paie différentes du détail source")
            return [(account("paie"), money(p.gross), 0), (account("personnel"), 0, money(p.net))] + deductions
        operation("payroll", payslip, payslip.validated_at, "OD", build_payroll)
        if payslip.status == "Payée":
            operation("payroll_payment", payslip, payslip.paid_at, "CA" if payslip.payment_method == "Espèces" else "BQ", lambda p=payslip: [(account("personnel"), money(p.net), 0), (payment(p.payment_method), 0, money(p.net))])
    return entries, missing, footer


def report(db, kind, start, end, account_filter=None, user_id=None, operation_type=None):
    entries, missing, footer = derive(db)
    def matches(row, period=True):
        day = row["date"][:10]
        return (not period or not day or start <= day <= end) and (not user_id or row["user_id"] == user_id) and (not operation_type or row["source_type"] == operation_type)
    selected = [e for e in entries if matches(e)]
    lines = [{**{k: v for k, v in e.items() if k != "lines"}, **line} for e in selected for line in e["lines"]]
    journals = {"sales": ("sale", "return"), "purchases": ("purchase",), "expenses": ("expense",), "settlements": ("settlement", "purchase_payment", "payroll_payment")}
    if kind in journals:
        lines = [line for line in lines if line["source_type"] in journals[kind]]
    if kind == "cash":
        cash = next((s.value for s in db.query(AccountingSetting).filter_by(key="caisse")), None)
        lines = [line for line in lines if line["account"] == cash]
    if account_filter:
        lines = [line for line in lines if line["account"] == account_filter]
    lines.sort(key=lambda row: ((row["account"],) if kind in ("ledger", "account", "balance") else ()) + (row["date"], row["source_type"], row["source_id"], row["account"]))
    opening = defaultdict(Decimal)
    for entry in entries:
        if matches(entry, False) and entry["date"][:10] < start:
            for line in entry["lines"]:
                opening[line["account"]] += money(line["debit"]) - money(line["credit"])
    balances = dict(opening)
    for line in lines:
        balances[line["account"]] = balances.get(line["account"], Decimal(0)) + money(line["debit"]) - money(line["credit"])
        line["balance"] = float(balances[line["account"]])
    headers = ["Journal", "Date", "Pièce", "Source", "Compte", "Intitulé", "Libellé", "Utilisateur", "Débit", "Crédit", "Solde progressif"]
    rows = [[l["journal"], l["date"][:10], l["reference"], f'{l["source_type"]}:{l["source_id"]}', l["account"], l["account_label"], l["label"], l["user"], l["debit"], l["credit"], l["balance"]] for l in lines]
    if kind == "balance":
        totals = defaultdict(lambda: [Decimal(0), Decimal(0)])
        for line in lines:
            totals[line["account"]][0] += money(line["debit"])
            totals[line["account"]][1] += money(line["credit"])
        names = {a.number: a.label for a in db.query(AccountingAccount)}
        numbers = set(totals) | {n for n in opening if not account_filter or n == account_filter}
        headers = ["Compte", "Intitulé", "Solde ouverture", "Débit", "Crédit", "Solde débiteur", "Solde créditeur"]
        rows = []
        for n in sorted(numbers):
            debit, credit = totals[n]
            balance = opening[n] + debit - credit
            rows.append([n, names[n], float(opening[n]), float(debit), float(credit), float(max(balance, 0)), float(max(-balance, 0))])
    if kind in ("customers", "suppliers", "debts"):
        headers = ["Type", "Tiers", "Pièce", "Source", "Date", "Échéance", "Montant", "Réglé à date", "Reste à date"]
        rows = []
        for debt in db.query(Debt).options(selectinload(Debt.payments), joinedload(Debt.sale)):
            if kind == "customers" and debt.kind != "creance" or kind == "suppliers" and debt.kind != "dette":
                continue
            if debt.created_at.date().isoformat() > end or user_id and debt.created_by_id != user_id:
                continue
            if debt.sale and debt.sale.status == "Annulée":
                continue
            if operation_type and not (operation_type == "sale" and debt.sale_id or operation_type == "purchase" and debt.purchase_id or operation_type == "settlement" and any(start <= p.date.date().isoformat() <= end and not p.cancelled for p in debt.payments)):
                continue
            key = "clients" if debt.kind == "creance" else "fournisseurs"
            mapped = db.get(AccountingSetting, key)
            if account_filter and (not mapped or mapped.value != account_filter):
                continue
            paid = sum((money(p.amount) for p in debt.payments if not p.cancelled and p.date.date().isoformat() <= end), Decimal(0))
            rows.append([debt.kind, debt.party, debt.reference, f"debt:{debt.id}", debt.created_at.date().isoformat(), debt.due_date.date().isoformat() if debt.due_date else "", debt.amount, float(paid), float(money(debt.amount) - paid)])
        footer += " Situations auxiliaires à la date de fin, dettes d'ouverture incluses ; utilisateur = créateur de la dette. Les avoirs non imputés ne réduisent pas ces soldes."
    if kind == "stock":
        headers = ["Référence", "Article", "Catégorie", "Quantité actuelle", "Prix d'achat actuel", "Valeur actuelle"]
        categories = {c.id: c.name for c in db.query(Category)}
        rows = [[p.sku, p.name, categories.get(p.category_id, "Sans catégorie"), p.quantity or 0, p.purchase_price or 0, float(money((p.quantity or 0) * (p.purchase_price or 0)))] for p in db.query(Product).order_by(Product.category_id, Product.name)]
        footer += " Valorisation au stock et coût actuels, non reconstituée à la date de fin ; filtres compte/utilisateur/opération non applicables."
    if kind == "margins":
        headers = ["Date", "Pièce", "Source", "Article", "Utilisateur", "Quantité signée", "CA net", "Coût historique", "Bénéfice"]
        rows = []
        prices = {p.id: p.purchase_price for p in db.query(Product)}
        users = {u.id: u.name for u in db.query(User)}
        for sale in db.query(Sale).options(selectinload(Sale.items), selectinload(Sale.returns).selectinload(SaleReturn.items)).filter(Sale.status != "Annulée", Sale.is_gift.is_(False)):
            if start <= sale.date.date().isoformat() <= end and (not user_id or sale.created_by_id == user_id) and (not operation_type or operation_type == "sale"):
                for item in sale.items:
                    revenue, cost = line_revenue(sale, item), unit_cost(item, prices) * item.quantity
                    rows.append([sale.date.date().isoformat(), sale.reference, f"sale:{sale.id}", item.product_name, users.get(sale.created_by_id, "Non renseigné"), item.quantity, revenue, cost, revenue - cost])
            for credit in sale.returns:
                if start <= credit.date.date().isoformat() <= end and (not user_id or credit.created_by_id == user_id) and (not operation_type or operation_type == "return"):
                    for item in credit.items:
                        revenue, cost = -item.subtotal, -unit_cost(item, prices) * item.quantity
                        rows.append([credit.date.date().isoformat(), credit.reference, f"return:{credit.id}", item.product_name, users.get(credit.created_by_id, "Non renseigné"), -item.quantity, revenue, cost, revenue - cost])
        footer += " Marges commerciales issues de profits.py, CA net commercial (TTC), et non marge comptable HT. Filtre compte non applicable."
    summary = {}
    if kind == "stock":
        category_values = defaultdict(float)
        for row in rows:
            category_values[row[2]] += row[5]
        summary = {"Valeur totale du stock": round(sum(row[5] for row in rows), 2), **{f"Catégorie : {key}": round(value, 2) for key, value in category_values.items()}}
    elif kind == "margins":
        summary = {"CA net": round(sum(row[6] for row in rows), 2), "Coût historique": round(sum(row[7] for row in rows), 2), "Bénéfice commercial": round(sum(row[8] for row in rows), 2)}
    elif kind in ("customers", "suppliers", "debts"):
        summary = {"Reste créances": round(sum(row[8] for row in rows if row[0] == "creance"), 2), "Reste dettes": round(sum(row[8] for row in rows if row[0] == "dette"), 2)}
    older_missing = [m for m in missing if m["date"] and matches(m, False) and m["date"][:10] < start]
    if older_missing:
        footer += f" Attention : {len(older_missing)} opération(s) antérieure(s) non comptabilisée(s) peuvent affecter l'ouverture."
    return {"kind": kind, "headers": headers, "rows": rows, "summary": summary, "entries": selected, "lines": lines, "opening_unposted": older_missing, "opening": {n: float(v) for n, v in opening.items() if not account_filter or n == account_filter},
        "totals": {"debit": round(sum(l["debit"] for l in lines), 2), "credit": round(sum(l["credit"] for l in lines), 2)}, "unposted": [m for m in missing if matches(m)], "footer": footer}
