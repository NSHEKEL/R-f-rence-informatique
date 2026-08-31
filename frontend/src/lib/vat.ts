import type { CompanySettings } from "../types";

/**
 * Prices entered in the catalogue already include tax, so the VAT set in the
 * settings is extracted from the amount instead of being added on top: the
 * customer pays the same total, the receipt just shows the breakdown.
 */
export function vatBreakdown(
  total: number,
  company: CompanySettings | null
): { rate: number; excluded: number; vat: number } | null {
  const rate = company?.vat_rate ?? 0;
  if (!rate || rate <= 0) return null;
  const excluded = total / (1 + rate / 100);
  return { rate, excluded, vat: total - excluded };
}
