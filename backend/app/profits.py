def line_revenue(sale, item):
    total = sum(line.subtotal for line in sale.items)
    return item.subtotal * sale.total / total if total else 0.0


def unit_cost(item, purchase_prices):
    return item.unit_cost if item.unit_cost is not None else purchase_prices.get(item.product_id, 0)


def line_returns(sale, item):
    return [line for credit in sale.returns for line in credit.items
            if line.sale_item_id == item.id or (line.sale_item_id is None and line.product_id == item.product_id)]


def financials(sale, item, purchase_prices):
    returned = line_returns(sale, item)
    revenue = line_revenue(sale, item) - sum(line.subtotal for line in returned)
    cost = unit_cost(item, purchase_prices) * item.quantity - sum(unit_cost(line, purchase_prices) * line.quantity for line in returned)
    profit = revenue - cost
    return dict(revenue=revenue, cost=cost, profit=profit, margin=profit / revenue * 100 if revenue else 0.0)
