import { useCallback, useMemo, useState } from "react";

/** Tick boxes of a list; ids no longer displayed drop out of the selection. */
export function useSelection<T extends { id: number }>(rows: T[]) {
  const [selected, setSelected] = useState<number[]>([]);
  const visible = useMemo(() => rows.map((r) => r.id), [rows]);
  const ids = useMemo(
    () => selected.filter((id) => visible.includes(id)),
    [selected, visible]
  );

  const toggle = useCallback((id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      visible.every((id) => prev.includes(id)) ? [] : visible
    );
  }, [visible]);

  const clear = useCallback(() => setSelected([]), []);
  const isSelected = useCallback((id: number) => ids.includes(id), [ids]);
  const allSelected = visible.length > 0 && ids.length === visible.length;

  return { ids, toggle, toggleAll, clear, isSelected, allSelected };
}
