import type { CompanySettings } from "../types";

export interface PosteSettings {
  scanner_suffix: "Enter" | "Tab";
  scanner_prefix: string;
  scanner_auto_add: boolean;
  scanner_min_length: number;
  display_scale: number;
  drawer_port?: string;
  drawer_code?: string;
}
export const DEFAULT_POSTE: PosteSettings = { scanner_suffix: "Enter", scanner_prefix: "", scanner_auto_add: true, scanner_min_length: 1, display_scale: 100 };
const KEY = "easygest_poste";
const FILE = "easygest-poste.json";
function valid(value: unknown): Partial<PosteSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const p = value as Partial<PosteSettings>;
  const result: Partial<PosteSettings> = {};
  if (p.scanner_suffix === "Enter" || p.scanner_suffix === "Tab") result.scanner_suffix = p.scanner_suffix;
  if (typeof p.scanner_prefix === "string" && p.scanner_prefix.length <= 128) result.scanner_prefix = p.scanner_prefix;
  if (typeof p.scanner_auto_add === "boolean") result.scanner_auto_add = p.scanner_auto_add;
  if (Number.isInteger(p.scanner_min_length) && p.scanner_min_length! >= 1 && p.scanner_min_length! <= 200) result.scanner_min_length = p.scanner_min_length;
  if (Number.isInteger(p.display_scale) && p.display_scale! >= 70 && p.display_scale! <= 130) result.display_scale = p.display_scale;
  if (typeof p.drawer_port === "string") result.drawer_port = p.drawer_port;
  if (typeof p.drawer_code === "string" && /^\d+(\s*,\s*\d+)*$/.test(p.drawer_code) && p.drawer_code.split(",").every((v) => Number(v) <= 255)) result.drawer_code = p.drawer_code;
  return result;
}
function stored(): Partial<PosteSettings> {
  try { return valid(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return {}; }
}
function bridge() {
  return (window as unknown as { pywebview?: { api?: { read_pref_file?: (name: string) => Promise<string>; write_pref_file?: (name: string, value: string) => Promise<string> } } }).pywebview?.api;
}
export function readPosteSettings(): PosteSettings { return { ...DEFAULT_POSTE, ...valid({ display_scale: Math.round(Number(localStorage.getItem("ri_ui_scale")) * 100) }), ...stored() }; }
export function writePosteSettings(value: PosteSettings) {
  const data = valid(value);
  localStorage.setItem(KEY, JSON.stringify(data));
  if (data.display_scale !== undefined) {
    localStorage.setItem("ri_ui_scale", String(data.display_scale / 100));
    window.dispatchEvent(new Event("ri_ui_scale_change"));
  }
  void bridge()?.write_pref_file?.(FILE, JSON.stringify(data)).catch(() => {});
  window.dispatchEvent(new Event("easygest-poste-changed"));
}
export async function restorePosteSettings() {
  try {
    const raw = await bridge()?.read_pref_file?.(FILE);
    if (raw) writePosteSettings({ ...DEFAULT_POSTE, ...valid(JSON.parse(raw)), ...stored() });
  } catch { /* keep the valid local choices */ }
}
export function scanValue(raw: string, settings = readPosteSettings()) {
  const value = raw.trim();
  const stripped = settings.scanner_prefix && value.startsWith(settings.scanner_prefix) ? value.slice(settings.scanner_prefix.length) : value;
  return stripped.length >= settings.scanner_min_length ? stripped : "";
}
export function applyPosteDrawer(company: CompanySettings): CompanySettings {
  const local = readPosteSettings();
  return { ...company, drawer_port: local.drawer_port ?? company.drawer_port, drawer_code: local.drawer_code ?? company.drawer_code };
}
