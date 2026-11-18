import { useEffect, useState } from "react";
import api from "../api/client";

export interface Depot { id: number; code: string; name: string; is_default: boolean; active: boolean }

export function depotScope(value: string) {
  return { depot_id: Number(value) };
}

export function replenishmentMessage(quantity: number) {
  return quantity < 0 ? "À réapprovisionner depuis les réserves" : "";
}

export function useDepots() {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.get<Depot[]>("/depots").then(({ data }) => { if (active) setDepots(data); }).catch(() => { if (active) setError("Liste des dépôts indisponible."); });
    return () => { active = false; };
  }, []);
  return { depots, error };
}
