interface MobileDocument {
  reference: string;
  date: string;
  total: number;
}

export function mobileNotifications(sales: MobileDocument[], returns: (MobileDocument & { sale_reference: string })[]) {
  return [
    ...sales.map((sale) => ({ key: `vente:${sale.reference}`, title: sale.reference, date: sale.date,
      amount: sale.total, secondary: "", isReturn: false })),
    ...returns.map((credit) => ({ key: `retour:${credit.reference}`, title: `Retour ${credit.reference}`, date: credit.date,
      amount: -Math.abs(credit.total), secondary: credit.sale_reference ? `Ticket ${credit.sale_reference}` : "", isReturn: true })),
  ].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
