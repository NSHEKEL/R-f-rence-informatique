export const EXPIRY_PERIODS = [
  ["expired", "Périmés"], ["7d", "≤7 j"], ["1m", "≤1 mois"], ["2m", "≤2 mois"],
  ["3m", "≤3 mois"], ["4m", "≤4 mois"], ["9m", "≤9 mois"], ["all", "Toutes"], ["custom", "Période personnalisée"],
] as const;

export function expiryParams(period: string, from: string, to: string) {
  return { period, date_from: period === "custom" ? from : "", date_to: period === "custom" ? to : "" };
}

export function remainingExpiry(days: number, months: number) {
  return days < 0 ? `Périmé depuis ${-days} j` : `${days} j · ≈ ${months} mois`;
}
