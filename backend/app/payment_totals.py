import unicodedata


def physical_expected(opening_balance, cash_sales, *, cash_settlements=0, validated_deposits=0,
                      entries=0, exits=0, cash_refunds=0, cash_expenses=0, mobile_adjustment=0):
    return (opening_balance + cash_sales + cash_settlements - validated_deposits
            + entries - exits - cash_refunds - cash_expenses + mobile_adjustment)


def group_payments(payments):
    groups = dict(cash=0.0, mobile_money=0.0, bank=0.0, credit=0.0, other=0.0)
    for method, amount in payments.items():
        name = "".join(c for c in unicodedata.normalize("NFKD", method.lower()) if not unicodedata.combining(c))
        if name == "especes":
            key = "cash"
        elif any(word in name for word in ("mobile", "money", "orange", "mtn", "moov", "wave")):
            key = "mobile_money"
        elif any(word in name for word in ("carte", "bancaire", "virement", "cheque", "banque")):
            key = "bank"
        elif "credit" in name:
            key = "credit"
        else:
            key = "other"
        groups[key] += amount or 0
    return groups
