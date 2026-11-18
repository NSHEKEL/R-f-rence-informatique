import { useRef } from "react";
import { clampPanel } from "../lib/panelSize";

export default function ResizeHandle({ axis, label, value, min, max, onChange, onReset, className = "" }: {
  axis: "x" | "y"; label: string; value: number; min: number; max: number;
  onChange: (value: number) => void; onReset: () => void; className?: string;
}) {
  const drag = useRef<{ position: number; value: number } | null>(null);
  const coordinate = (event: { clientX: number; clientY: number }) => axis === "x" ? event.clientX : event.clientY;
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={axis === "x" ? "vertical" : "horizontal"}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} title={`${label} — double-clic pour réinitialiser`}
    className={`hidden touch-none select-none shrink-0 rounded-full bg-slate-200 hover:bg-brand-400 focus:bg-brand-400 md:block ${axis === "x" ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize"} ${className}`}
    onDoubleClick={onReset}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { position: coordinate(event), value };
    }}
    onPointerMove={(event) => { if (drag.current) onChange(clampPanel(drag.current.value + drag.current.position - coordinate(event), min, max)); }}
    onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={(event) => {
      if (event.key === "Home") { event.preventDefault(); onReset(); return; }
      const change = axis === "x" ? { ArrowLeft: 20, ArrowRight: -20 } : { ArrowUp: 20, ArrowDown: -20 };
      const delta = change[event.key as keyof typeof change];
      if (delta) { event.preventDefault(); onChange(clampPanel(value + delta, min, max)); }
    }} />;
}
