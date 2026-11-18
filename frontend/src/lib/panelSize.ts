export function clampPanel(value: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(Math.max(min, max), Number.isFinite(value) ? value : min)));
}

export function readPanel(key: string, fallback: number, min: number, max: number) {
  try {
    const value = Number(localStorage.getItem(key));
    return value > 0 && Number.isFinite(value) ? clampPanel(value, min, max) : fallback;
  } catch { return fallback; }
}

export function savePanel(key: string, value: number | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* session-only preference */ }
}
