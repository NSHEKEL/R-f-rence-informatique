import { useState } from "react";
import axios from "axios";
import { Trash2, X } from "lucide-react";
import api from "../api/client";

/** Checkbox drawn in the header and in front of every row. */
export function SelectBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

interface Props {
  ids: number[];
  /** API collection, e.g. "/products": each id is deleted at {path}/{id}. */
  path: string;
  /** Singular/plural wording shown in the confirmation. */
  noun: [string, string];
  onDone: () => void | Promise<void>;
  onClear: () => void;
}

/**
 * Bar offering the grouped deletion: every line is deleted on its own, so a
 * refusal (403) or a protected record only skips that line and is reported.
 */
export default function BulkDelete({
  ids,
  path,
  noun,
  onDone,
  onClear,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("");
  const label = ids.length > 1 ? noun[1] : noun[0];

  async function run() {
    const question =
      `Supprimer ${ids.length} ${label} ? ` +
      "Cette action est définitive.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setReport("");
    const failures: string[] = [];
    let done = 0;
    for (const id of ids) {
      try {
        await api.delete(`${path}/${id}`);
        done += 1;
      } catch (err) {
        const detail = axios.isAxiosError(err)
          ? err.response?.data?.detail ?? err.message
          : "erreur inconnue";
        failures.push(`#${id} : ${detail}`);
      }
    }
    setBusy(false);
    onClear();
    await onDone();
    setReport(
      failures.length === 0
        ? `${done} ${label} supprimé(s).`
        : `${done} supprimé(s), ${failures.length} refusé(s) — ` +
            failures.slice(0, 3).join(" ; ")
    );
  }

  if (ids.length === 0 && !report) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">
      {ids.length > 0 && (
        <>
          <span className="font-semibold">
            {ids.length} {label} sélectionné(s)
          </span>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-3 py-1.5 font-semibold hover:bg-red-600 disabled:opacity-60"
            onClick={run}
            disabled={busy}
          >
            <Trash2 size={15} />
            {busy ? "Suppression..." : "Supprimer la sélection"}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-300 hover:bg-white/10"
            onClick={onClear}
          >
            <X size={15} /> Tout désélectionner
          </button>
        </>
      )}
      {report && <span className="text-slate-200">{report}</span>}
    </div>
  );
}
