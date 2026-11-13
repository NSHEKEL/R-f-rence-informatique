import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import { replenishmentMessage } from "../lib/depots";

interface Stock { depot_id: number; name: string; is_default: boolean; quantity: number }

export default function DepotStock({ productId, total }: { productId: number; total: number }) {
  const [stocks, setStocks] = useState<Stock[] | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setMessage("");
    try { const { data } = await api.get<Stock[]>(`/depots/stocks/${productId}`); setStocks(data); }
    catch { setMessage("Stock par dépôt indisponible."); }
  }, [productId]);
  useEffect(() => { void load(); }, [load, total]);
  return <>{stocks?.some((stock) => stock.is_default && stock.quantity < 0) && <p className="text-xs font-semibold text-red-700">À réapprovisionner depuis les réserves</p>}<details onToggle={(event) => { if (event.currentTarget.open) void load(); }} className="text-left text-xs font-normal">
    <summary className="cursor-pointer text-primary-600">Par dépôt</summary>
    {stocks?.map((stock) => <p className={stock.quantity < 0 ? "text-red-700" : ""} key={stock.depot_id}>{stock.name} : <strong>{stock.quantity}</strong>{stock.is_default && stock.quantity < 0 && <span className="block">{replenishmentMessage(stock.quantity)}</span>}</p>)}
    {message && <p role="status">{message}</p>}
  </details></>;
}
