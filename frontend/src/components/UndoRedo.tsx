import { useCallback, useEffect, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import api, { formatDateTime } from "../api/client";
import type { HistoryState } from "../types";

const POLL_MS = 20000;

/**
 * "Revenir à la dernière action" / "Rétablir" for administrators.
 *
 * Only catalogue-style edits are undoable (articles, categories, suppliers,
 * customers, expenses, orders, proformas); sales, credit notes and deliveries
 * keep their own reversal flows.
 */
export default function UndoRedo() {
  const [state, setState] = useState<HistoryState>({ undo: null, redo: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<HistoryState>("/history");
      setState(res.data);
    } catch {
      /* offline or session expired: keep the buttons as they are */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function run(action: "undo" | "redo") {
    const label = (action === "undo" ? state.undo : state.redo)?.label ?? "";
    setBusy(true);
    try {
      const res = await api.post<HistoryState>(`/history/${action}`);
      setState(res.data);
      setMessage(`${action === "undo" ? "Annulé" : "Rétabli"} : ${label}`);
      // The pages read their data once: reload so the change is visible.
      window.setTimeout(() => window.location.reload(), 600);
    } catch {
      setMessage("Action impossible");
      setBusy(false);
    }
  }

  const buttonClass =
    "rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex items-center gap-2">
      {message && (
        <span className="hidden text-xs font-medium text-slate-500 sm:inline">
          {message}
        </span>
      )}
      <button
        type="button"
        onClick={() => run("undo")}
        disabled={busy || !state.undo}
        aria-label={
          state.undo
            ? `Annuler : ${state.undo.label} (${formatDateTime(state.undo.at)})`
            : "Aucune action à annuler"
        }
        className={buttonClass}
      >
        <Undo2 size={18} />
      </button>
      <button
        type="button"
        onClick={() => run("redo")}
        disabled={busy || !state.redo}
        aria-label={
          state.redo
            ? `Rétablir : ${state.redo.label}`
            : "Aucune action à rétablir"
        }
        className={buttonClass}
      >
        <Redo2 size={18} />
      </button>
    </div>
  );
}
