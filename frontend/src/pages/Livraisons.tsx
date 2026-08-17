import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { PackageCheck, Printer } from "lucide-react";
import api, { formatDateTime, formatXOF } from "../api/client";
import type { Delivery, Order } from "../types";
import { printSheet } from "../lib/print";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

export default function Livraisons() {
  const version = useSyncVersion();
  const { company } = useCompany();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, o] = await Promise.all([
        api.get<Delivery[]>("/orders/deliveries/all"),
        api.get<Order[]>("/orders"),
      ]);
      setDeliveries(d.data);
      setOrders(o.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur de chargement");
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  function print(delivery: Delivery) {
    const order = orders.find((o) => o.id === delivery.order_id);
    const rows = (order?.items ?? [])
      .map(
        (it) =>
          `<tr><td>${it.product_name}</td>` +
          `<td class="num">${it.quantity}</td>` +
          `<td class="num">${formatXOF(it.subtotal)}</td></tr>`
      )
      .join("");
    printSheet(
      `Bon de livraison ${delivery.reference}`,
      `<h1>${company?.name ?? ""}</h1>` +
        `<p class="meta">${[company?.address, company?.phone, company?.email]
          .filter(Boolean)
          .join(" · ")}</p>` +
        `<h2>Bon de livraison ${delivery.reference}</h2>` +
        `<p class="meta">Date : ${formatDateTime(delivery.date)}` +
        `<br/>Commande : ${delivery.order_reference}` +
        `<br/>Client : ${order?.customer_name ?? ""}` +
        (delivery.address ? `<br/>Adresse : ${delivery.address}` : "") +
        (delivery.carrier ? `<br/>Livreur : ${delivery.carrier}` : "") +
        (delivery.recipient ? `<br/>Reçu par : ${delivery.recipient}` : "") +
        `</p>` +
        `<table><thead><tr><th>Désignation</th><th class="num">Qté</th>` +
        `<th class="num">Total</th></tr></thead><tbody>${rows}` +
        (order
          ? `<tr><th colspan="2">Total</th>` +
            `<th class="num">${formatXOF(order.total)}</th></tr>`
          : "") +
        `</tbody></table>` +
        (delivery.note ? `<p class="meta">${delivery.note}</p>` : "") +
        `<p class="meta">Signature du client :</p>`
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Bons de livraison générés à la remise des commandes. Chaque livraison a
        décrémenté le stock et enregistré la vente correspondante.
      </p>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3">Bon</th>
              <th className="px-5 py-3">Date et heure</th>
              <th className="px-5 py-3">Commande</th>
              <th className="px-5 py-3">Adresse</th>
              <th className="px-5 py-3">Livreur</th>
              <th className="px-5 py-3">Reçu par</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deliveries.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3.5 font-semibold text-slate-800">
                  <span className="flex items-center gap-2">
                    <PackageCheck size={15} className="text-emerald-600" />
                    {d.reference}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-slate-500">
                  {formatDateTime(d.date)}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.order_reference}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.address || "—"}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.carrier || "—"}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.recipient || "—"}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end">
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      onClick={() => print(d)}
                      aria-label="Imprimer le bon de livraison"
                    >
                      <Printer size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {deliveries.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-10 text-center text-slate-400"
                >
                  Aucune livraison.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
