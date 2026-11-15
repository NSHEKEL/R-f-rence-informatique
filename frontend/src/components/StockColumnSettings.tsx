import { useEffect, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";
import { StockColumnChooser } from "./StockColumns";
import { useStockColumns } from "../lib/useStockColumns";

export default function StockColumnSettings() {
  const { can } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const allowed = can("inventaire") || can("produits");
  const inventory = useStockColumns(products, "inventory");
  const stock = useStockColumns(products, "products");
  useEffect(() => { if (allowed) api.get("/products?state=all").then(({ data }) => setProducts(data)).catch(() => setError("Catalogue indisponible. Ouvrez la caisse puis réessayez.")); }, [allowed]);
  if (!allowed) return null;
  return <section className="card space-y-3 p-6"><h3 className="font-bold">Colonnes locales — utilisateur courant</h3><p>Ces choix sont propres à cet utilisateur sur ce poste. Les colonnes financières nécessitent le droit de consulter les rapports financiers.</p>{error && <p role="alert">{error}</p>}<h4>Inventaire</h4><StockColumnChooser config={inventory} disabled={!can("poste_modifier")} /><h4>Produits en stock</h4><StockColumnChooser config={stock} disabled={!can("poste_modifier")} /></section>;
}
