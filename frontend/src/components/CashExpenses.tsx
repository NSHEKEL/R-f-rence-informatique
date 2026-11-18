import { formatXOF } from "../api/client";
import type { CashSessionExpense } from "../types";

export default function CashExpenses({ items }: { items: CashSessionExpense[] }) {
  return <div className="space-y-2">{items.length === 0 ? <p className="text-sm text-slate-500">Aucune dépense sur la session.</p> : items.map((expense, index) => <div key={expense.id ?? index} className="rounded-xl border border-slate-200 p-3">
    <div className="flex justify-between gap-3"><span className="font-semibold text-slate-900">{expense.label}</span><span className="shrink-0 font-semibold text-red-700">−{formatXOF(expense.amount)}</span></div>
    <p className="text-xs text-slate-500">{[expense.date ? new Date(expense.date).toLocaleString("fr-FR") : "", expense.category, expense.user, expense.payment_method].filter(Boolean).join(" · ")}</p>
    {expense.note && <p className="mt-1 text-sm text-slate-700">{expense.note}</p>}
    {!expense.payment_method && <p className="text-xs text-amber-700">Mode de paiement non renseigné : non déduit du solde espèces.</p>}
  </div>)}</div>;
}
