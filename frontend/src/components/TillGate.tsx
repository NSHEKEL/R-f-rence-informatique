import { useState } from "react";
import axios from "axios";
import { Wallet } from "lucide-react";
import api from "../api/client";
import type { CashSessionDetail } from "../types";
import { useAuth } from "../context/AuthContext";
import { useTill } from "../context/TillContext";

/**
 * Opening the till is the first gesture of the day: right after signing in the
 * cashier gets this screen and reaches nothing else before the till is open.
 */
export default function TillGate() {
  const { can } = useAuth();
  const { session, dayClosed, loading, refresh } = useTill();
  const [openingBalance, setOpeningBalance] = useState("0");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (loading || session || dayClosed || !can("caisse")) return null;

  async function openTill() {
    setSaving(true);
    setError("");
    try {
      await api.post<CashSessionDetail>("/cash-sessions/open", {
        opening_balance: Number(openingBalance) || 0,
        note: "",
      });
      await refresh();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible d'ouvrir la caisse");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Wallet size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Ouverture de la caisse
            </h2>
            <p className="text-sm text-slate-500">
              Indiquez le fond de caisse pour commencer la journée.
            </p>
          </div>
        </div>
        <label
          className="mt-5 block text-sm font-semibold text-slate-700"
          htmlFor="fond-de-caisse"
        >
          Fond de caisse (FCFA)
        </label>
        <input
          id="fond-de-caisse"
          type="number"
          min="0"
          autoFocus
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !saving) void openTill();
          }}
          className="input mt-1 w-full"
        />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          disabled={saving}
          onClick={() => void openTill()}
          className="btn-primary mt-5 w-full justify-center py-3 text-base"
        >
          {saving ? "Ouverture..." : "Ouvrir ma caisse"}
        </button>
      </div>
    </div>
  );
}
