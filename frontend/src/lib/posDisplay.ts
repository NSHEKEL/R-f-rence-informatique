export interface PosDisplay {
  mode: "nom" | "nom+prix" | "nom+prix+stock" | "image+nom+prix" | "image+nom+prix+stock";
  width: number; height: number; font_size: number; font_family: string;
  columns: number; gap_x: number; gap_y: number;
  align: "left" | "center" | "right";
  background: string; text: string; border: string; radius: number;
  images: boolean; stock: boolean;
}

export const DEFAULT_POS: PosDisplay = {
  mode: "nom", width: 160, height: 110, font_size: 16, font_family: "Arial",
  columns: 0, gap_x: 12, gap_y: 12, align: "center",
  background: "#ffffff", text: "#1e293b", border: "#e2e8f0", radius: 10,
  images: false, stock: false,
};

export function mergePos(raw?: Partial<PosDisplay> | null): PosDisplay {
  const result = { ...DEFAULT_POS };
  if (!raw || typeof raw !== "object") return result;
  for (const key of Object.keys(DEFAULT_POS) as (keyof PosDisplay)[]) {
    const value = raw[key];
    if (typeof value === typeof DEFAULT_POS[key]) Object.assign(result, { [key]: value });
  }
  for (const [key, min, max] of [["width",100,400],["height",70,400],["font_size",10,36],["columns",0,12],["gap_x",0,40],["gap_y",0,40],["radius",0,40]] as const) {
    result[key] = Number.isFinite(result[key]) ? Math.min(max, Math.max(min, Math.round(result[key]))) : DEFAULT_POS[key];
  }
  if (!["nom", "nom+prix", "nom+prix+stock", "image+nom+prix", "image+nom+prix+stock"].includes(result.mode)) result.mode = "nom";
  if (!["Arial", "Verdana", "Tahoma", "Georgia", "sans-serif"].includes(result.font_family)) result.font_family = "Arial";
  if (!["left", "center", "right"].includes(result.align)) result.align = "center";
  for (const key of ["background", "text", "border"] as const) if (!/^#[0-9a-f]{6}$/i.test(result[key])) result[key] = DEFAULT_POS[key];
  return result;
}

export function tileVisibility(config: PosDisplay, stockRight: boolean) {
  return { image: config.images && config.mode.startsWith("image+"), price: config.mode.includes("prix"), stock: config.stock && config.mode.includes("stock") && stockRight };
}

export function stockLimit(product: { quantity?: number | null }) {
  return typeof product.quantity === "number" ? product.quantity : Infinity;
}
