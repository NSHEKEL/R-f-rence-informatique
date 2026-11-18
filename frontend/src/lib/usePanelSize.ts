import { useEffect, useState } from "react";
import { clampPanel, readPanel, savePanel } from "./panelSize";

export function usePanelSize(key: string, fallback: number, min: number, max: number) {
  const [value, setValue] = useState(() => readPanel(key, fallback, min, max));
  return { value, change(next: number) { const size = clampPanel(next, min, max); setValue(size); savePanel(key, size); },
    reset() { setValue(fallback); savePanel(key, null); } };
}

export function usePanelMeasure() {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    const update = () => { const { width, height } = element.getBoundingClientRect(); setSize((old) => old.width === width && old.height === height ? old : { width, height }); };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [element]);
  return { ref, ...size };
}
