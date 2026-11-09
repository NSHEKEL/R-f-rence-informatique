export const SETTINGS_CATEGORIES = ["generaux", "articles", "tarifs", "fiscaux", "imprimantes", "poste", "peripheriques", "caisse", "utilisateurs", "sauvegarde"] as const;
export type SettingsCategory = typeof SETTINGS_CATEGORIES[number];
export const TAB_CATEGORIES: Record<string, SettingsCategory> = { entreprise: "generaux", emails: "generaux", maj: "generaux", impression: "imprimantes", pos: "articles", articles: "articles", tarifs: "tarifs", fiscalite: "fiscaux", fne: "fiscaux", poste: "poste", peripheriques: "peripheriques", caisse: "caisse", sauvegarde: "sauvegarde" };
type Can = (key: string) => boolean;
export function canOpenSettings(can: Can) {
  return SETTINGS_CATEGORIES.some((category) => can(`${category}_consulter`));
}
export function canOpenSettingsTab(tab: string, admin: boolean, can: Can) {
  if (tab === "reseau" || tab === "securite") return admin;
  if (tab === "compte") return canOpenSettings(can);
  return !!TAB_CATEGORIES[tab] && can(`${TAB_CATEGORIES[tab]}_consulter`);
}
export function settingsCategoryForField(key: string): SettingsCategory {
  if (["tax_id", "rccm", "ncc", "regime_fiscal", "vat_rate", "capital_social"].includes(key)) return "fiscaux";
  if (["document_layouts", "receipt_header", "receipt_footer", "receipt_format", "printer_name"].includes(key)) return "imprimantes";
  if (["auto_print_cash", "drawer_open_after_sale"].includes(key)) return "caisse";
  if (key.startsWith("drawer_")) return "peripheriques";
  if (key.startsWith("expiry_")) return "articles";
  if (key.startsWith("backup_") || key.startsWith("drive_")) return "sauvegarde";
  return "generaux";
}
export function companyUpdatePayload(company: object, can: Can, admin: boolean) {
  return Object.fromEntries(Object.entries(company).filter(([key]) => key === "network_restrict_workstations" ? admin : can(`${settingsCategoryForField(key)}_modifier`)));
}
