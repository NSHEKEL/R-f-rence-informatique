import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";
import { readStockColumns, stockColumnKey, stockColumns } from "./stockColumns";

export function useStockColumns(products: Product[], view: string, blind = false) {
  const { user, can } = useAuth();
  const key = stockColumnKey(user?.id, view);
  const [preferences, setPreferences] = useState(() => readStockColumns(key));
  useEffect(() => {
    const refresh = () => setPreferences(readStockColumns(key));
    refresh(); window.addEventListener("easygest-stock-columns", refresh);
    return () => window.removeEventListener("easygest-stock-columns", refresh);
  }, [key]);
  const columns = stockColumns(products, can("rapports_financiers"), blind);
  const visible = columns.filter((column) => preferences[column.key] !== false);
  return { columns, visible, show: (name: string) => visible.some((column) => column.key === name),
    toggle(name: string, checked: boolean) {
      const next = { ...readStockColumns(key), [name]: checked };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* keep this session's choice */ }
      setPreferences(next); window.dispatchEvent(new Event("easygest-stock-columns"));
    } };
}
