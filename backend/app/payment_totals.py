import unicodedata


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
