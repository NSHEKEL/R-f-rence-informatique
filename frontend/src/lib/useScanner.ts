import { useEffect, useRef } from "react";
import { readPosteSettings } from "./poste";
import { ScanCapture, scanQueue, scanTargetAllowed } from "./scanCapture";

export function useScanner(consume: (codes: string[]) => Promise<void>, onError: (error: unknown) => void, enabled = true) {
  const latest = useRef({ consume, onError, enabled });
  latest.current = { consume, onError, enabled };
  useEffect(() => {
    const capture = new ScanCapture();
    let alive = true;
    const enqueue = scanQueue(async (codes) => { if (alive) await latest.current.consume(codes); }, (error) => { if (alive) latest.current.onError(error); });
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const owned = !!target?.matches("input[data-scan]");
      const editable = target?.closest("input,textarea,select,[contenteditable=true]");
      const blocked = document.querySelector('[role="dialog"],dialog[open]');
      if (!latest.current.enabled || !scanTargetAllowed(owned, !!editable, !!blocked, !!blocked?.contains(target), !!blocked?.querySelector("input[data-scan]"))) { capture.reset(); return; }
      const codes = capture.feed(event, performance.now(), readPosteSettings());
      if (codes !== null) { event.preventDefault(); event.stopPropagation(); if (codes.length) void enqueue(codes); }
    };
    window.addEventListener("keydown", handle, true);
    return () => { alive = false; window.removeEventListener("keydown", handle, true); };
  }, []);
}
