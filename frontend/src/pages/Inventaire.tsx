import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ArrowLeftRight,
  ClipboardCheck,
  History,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import api, { formatDate, formatXOF } from "../api/client";
import type { Product, StockMovement } from "../types";
import { documentHeader, printSheet } from "../lib/print";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

type Counted = Record<number, string>;

const kindLabels: Record<string, string> = {
  vente: "Vente",
  inventaire: "Inventaire",
  ajustement: "Ajustement",
  transfert: "Transfert",
};

/** One line of an inter-store transfer being composed. */
interface TransferLine {
  product_id: number;
  quantity: number;
}

/** Shipment the central service holds for this shop. */
interface PendingTransfer {
  id: number;
  reference: string;
  from_shop: string;
  note: string;
  items: string; // JSON [{product_name, quantity}]
  created_at: string;
}

export default function Inventaire() {
  const version = useSyncVersion();
  const { company } = useCompany();
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [counted, setCounted] = useState<Counted>({});
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [transfer, setTransfer] = useState({
    direction: "sortie" as "sortie" | "entree",
    store_name: "",
    note: "",
  });
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [lineDraft, setLineDraft] = useState({ product_id: "", quantity: "1" });
  const [pending, setPending] = useState<PendingTransfer[]>([]);

  const load = useCallback(async () => {
    const [p, m, r] = await Promise.all([
      api.get<Product[]>("/products"),
      api.get<StockMovement[]>("/inventory/movements", {
        params: { limit: 50 },
      }),
      api.get<PendingTransfer[]>("/transfers/entrantes").catch(() => ({
        data: [] as PendingTransfer[],
      })),
    ]);
    setProducts(p.data);
    setMovements(m.data);
    setPending(r.data);
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [products, query]);

  const differences = useMemo(
    () =>
      products
        .map((p) => {
          const raw = counted[p.id];
          if (raw === undefined || raw === "") return null;
          const delta = Number(raw) - p.quantity;
          return delta === 0 ? null : { product: p, delta };
        })
        .filter((d): d is { product: Product; delta: number } => d !== null),
    [products, counted]
  );

  const impact = useMemo(
    () =>
      differences.reduce(
        (sum, d) => sum + d.delta * d.product.purchase_price,
        0
      ),
    [differences]
  );

  async function apply() {
    if (differences.length === 0) {
      setError("Aucun écart à appliquer.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.post("/inventory/apply", {
        note,
        lines: differences.map((d) => ({
          product_id: d.product.id,
          counted_quantity: d.product.quantity + d.delta,
        })),
      });
      setCounted({});
      setNote("");
      setMessage(`${differences.length} produit(s) ajusté(s).`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'inventaire");
      }
    } finally {
      setSaving(false);
    }
  }

  function addLine() {
    const product_id = Number(lineDraft.product_id);
    const quantity = Number(lineDraft.quantity);
    if (!product_id || quantity <= 0) return;
    setLines((prev) => {
      const rest = prev.filter((l) => l.product_id !== product_id);
      const same = prev.find((l) => l.product_id === product_id);
      return [
        ...rest,
        { product_id, quantity: quantity + (same?.quantity ?? 0) },
      ];
    });
    setLineDraft({ product_id: "", quantity: "1" });
  }

  /** Turns a shipment waiting on the central into a local reception. */
  async function receivePending(t: PendingTransfer) {
    setError("");
    setMessage("");
    let items: { product_name: string; quantity: number }[] = [];
    try {
      items = JSON.parse(t.items || "[]");
    } catch {
      items = [];
    }
    const matched = items
      .map((i) => {
        const product = products.find(
          (p) => p.name.trim().toLowerCase() === i.product_name.trim().toLowerCase()
        );
        return product ? { product_id: product.id, quantity: i.quantity } : null;
      })
      .filter((i): i is TransferLine => i !== null);
    if (matched.length === 0) {
      setError(
        "Aucun article de cet envoi n'existe dans votre catalogue : créez-les d'abord."
      );
      return;
    }
    setSaving(true);
    try {
      await api.post("/transfers/recevoir", {
        central_id: t.id,
        from_shop: t.from_shop,
        note: t.note,
        items: matched,
      });
      const skipped = items.length - matched.length;
      setMessage(
        `Réception ${t.reference} enregistrée.` +
          (skipped > 0 ? ` ${skipped} article(s) ignoré(s) (non trouvés).` : "")
      );
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Réception impossible");
      }
    } finally {
      setSaving(false);
    }
  }

  /** Registers the transfer: the stock moves immediately on this site. */
  async function submitTransfer() {
    setError("");
    setMessage("");
    if (!transfer.store_name.trim()) {
      setError("Indiquez le magasin concerné.");
      return;
    }
    if (lines.length === 0) {
      setError("Ajoutez au moins un article.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post<{ reference: string }>("/transfers", {
        direction: transfer.direction,
        store_name: transfer.store_name,
        note: transfer.note,
        items: lines,
      });
      setMessage(`Transfert ${data.reference} enregistré.`);
      setLines([]);
      setTransfer({ ...transfer, note: "" });
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Transfert impossible");
      }
    } finally {
      setSaving(false);
    }
  }

  /** Blank count sheet the team fills in by hand during the physical count. */
  function printCountSheet() {
    // Only the identity of the article is printed: the counting team must not
    // see the expected quantity, otherwise the count is biased.
    const rows = filtered
      .map(
        (p) =>
          `<tr><td>${p.name}</td><td>${p.sku}</td>` +
          `<td>${p.barcode || ""}</td>` +
          `<td class="blank"></td><td class="blank"></td></tr>`
      )
      .join("");
    printSheet(
      "Fiche d'inventaire",
      documentHeader(company) +
        `<p class="meta">Fiche d'inventaire — ${new Date().toLocaleDateString("fr-FR")}` +
        ` · ${filtered.length} article(s)<br/>Compté par : ______________________` +
        ` · Signature : ______________________</p>` +
        `<table><thead><tr><th>Article</th><th>SKU</th><th>Code-barres</th>` +
        `<th>Quantité comptée</th><th>Observation</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`
    );
  }

  /** Signed record of the differences that are about to be applied. */
  function printDifferences() {
    const rows = differences
      .map(
        (d) =>
          `<tr><td>${d.product.name}</td><td>${d.product.sku}</td>` +
          `<td class="num">${d.product.quantity}</td>` +
          `<td class="num">${d.product.quantity + d.delta}</td>` +
          `<td class="num">${d.delta > 0 ? `+${d.delta}` : d.delta}</td>` +
          `<td class="num">${formatXOF(d.delta * d.product.purchase_price)}</td></tr>`
      )
      .join("");
    printSheet(
      "Écarts d'inventaire",
      documentHeader(company) +
        `<p class="meta">Écarts d'inventaire — ${new Date().toLocaleDateString("fr-FR")}` +
        (note ? `<br/>Motif : ${note}` : "") +
        `</p><table><thead><tr><th>Article</th><th>SKU</th>` +
        `<th class="num">Théorique</th><th class="num">Compté</th>` +
        `<th class="num">Écart</th><th class="num">Valorisation</th>` +
        `</tr></thead><tbody>${rows}` +
        `<tr><th colspan="5">Impact total</th>` +
        `<th class="num">${formatXOF(impact)}</th></tr></tbody></table>`
    );
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <ClipboardCheck size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Inventaire physique
          </h3>
          <p className="text-sm text-slate-500">
            Saisissez la quantité réellement comptée ; seuls les écarts sont
            appliqués.
          </p>
          <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input
              className="w-48 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Rechercher un produit..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {message}
          </div>
        )}

        <div className="max-h-[24rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
                <th className="py-2">Produit</th>
                <th className="py-2">Code</th>
                <th className="py-2 text-center">Stock théorique</th>
                <th className="py-2 text-center">Compté</th>
                <th className="py-2 text-center">Écart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => {
                const raw = counted[p.id] ?? "";
                const delta = raw === "" ? null : Number(raw) - p.quantity;
                return (
                  <tr key={p.id}>
                    <td className="py-2 font-medium text-slate-800">
                      {p.name}
                    </td>
                    <td className="py-2 text-slate-500">{p.sku}</td>
                    <td className="py-2 text-center text-slate-700">
                      {p.quantity}
                    </td>
                    <td className="py-2 text-center">
                      <input
                        className="w-20 rounded-lg border border-slate-200 py-1 text-center"
                        type="number"
                        min="0"
                        value={raw}
                        placeholder="—"
                        onChange={(e) =>
                          setCounted({ ...counted, [p.id]: e.target.value })
                        }
                      />
                    </td>
                    <td
                      className={`py-2 text-center font-semibold ${
                        delta === null || delta === 0
                          ? "text-slate-400"
                          : delta > 0
                            ? "text-emerald-600"
                            : "text-red-600"
                      }`}
                    >
                      {delta === null ? "—" : delta > 0 ? `+${delta}` : delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <input
            className="input max-w-sm"
            placeholder="Motif / commentaire de l'inventaire"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-sm text-slate-500">
            {differences.length} écart(s) · impact valorisé{" "}
            <span
              className={`font-bold ${
                impact < 0 ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {formatXOF(impact)}
            </span>
          </p>
          <button className="btn-ghost" onClick={printCountSheet}>
            <Printer size={16} /> Fiche de comptage
          </button>
          <button
            className="btn-ghost"
            onClick={printDifferences}
            disabled={differences.length === 0}
          >
            <Printer size={16} /> Écarts
          </button>
          <button
            className="btn-ghost"
            onClick={() => setCounted({})}
            disabled={Object.keys(counted).length === 0}
          >
            <RotateCcw size={16} /> Réinitialiser
          </button>
          <button
            className="btn-primary ml-auto"
            onClick={apply}
            disabled={saving || differences.length === 0}
          >
            {saving ? "Application..." : "Appliquer l'inventaire"}
          </button>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <ArrowLeftRight size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Transfert inter-magasins
          </h3>
          <div className="ml-auto flex rounded-lg bg-slate-100 p-1">
            {(
              [
                ["sortie", "Envoi"],
                ["entree", "Réception"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTransfer({ ...transfer, direction: value })}
                className={`rounded-md px-3 py-1 text-sm ${
                  transfer.direction === value
                    ? "bg-white font-semibold shadow"
                    : "text-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input w-56"
            placeholder={
              transfer.direction === "sortie"
                ? "Magasin destinataire"
                : "Magasin d'origine"
            }
            value={transfer.store_name}
            onChange={(e) =>
              setTransfer({ ...transfer, store_name: e.target.value })
            }
          />
          <input
            className="input flex-1"
            placeholder="Note (optionnel)"
            value={transfer.note}
            onChange={(e) =>
              setTransfer({ ...transfer, note: e.target.value })
            }
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className="input w-64"
            value={lineDraft.product_id}
            onChange={(e) =>
              setLineDraft({ ...lineDraft, product_id: e.target.value })
            }
          >
            <option value="">— Produit —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (stock {p.quantity})
              </option>
            ))}
          </select>
          <input
            className="input w-24"
            type="number"
            min="1"
            value={lineDraft.quantity}
            onChange={(e) =>
              setLineDraft({ ...lineDraft, quantity: e.target.value })
            }
          />
          <button className="btn-secondary" onClick={addLine}>
            <Plus size={16} /> Ajouter
          </button>
        </div>

        {lines.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => {
                const p = products.find((x) => x.id === l.product_id);
                return (
                  <tr key={l.product_id}>
                    <td className="py-2 font-medium text-slate-800">
                      {p?.name ?? `#${l.product_id}`}
                    </td>
                    <td className="py-2 text-center font-semibold">
                      {l.quantity}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() =>
                          setLines(
                            lines.filter((x) => x.product_id !== l.product_id)
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="mt-3 flex items-center justify-end">
          <button
            className="btn-primary"
            onClick={() => void submitTransfer()}
            disabled={saving || lines.length === 0}
          >
            {saving
              ? "Enregistrement..."
              : transfer.direction === "sortie"
                ? "Valider l'envoi"
                : "Valider la réception"}
          </button>
        </div>

        {pending.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Envois en attente pour vous
            </p>
            <div className="space-y-2">
              {pending.map((t) => {
                let count = 0;
                try {
                  count = (JSON.parse(t.items || "[]") as unknown[]).length;
                } catch {
                  count = 0;
                }
                return (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950"
                  >
                    <span className="font-semibold text-amber-800 dark:text-amber-200">
                      {t.reference || `Envoi #${t.id}`}
                    </span>
                    <span className="text-amber-700 dark:text-amber-300">
                      de {t.from_shop || "—"} · {count} article(s)
                      {t.note ? ` · ${t.note}` : ""}
                    </span>
                    <button
                      className="btn-secondary ml-auto"
                      onClick={() => void receivePending(t)}
                      disabled={saving}
                    >
                      Réceptionner
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2">
          <History size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Mouvements de stock
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="py-2">Date</th>
              <th className="py-2">Produit</th>
              <th className="py-2">Type</th>
              <th className="py-2 text-center">Mouvement</th>
              <th className="py-2 text-center">Stock</th>
              <th className="py-2">Motif</th>
              <th className="py-2">Par</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="py-2 text-slate-500">{formatDate(m.date)}</td>
                <td className="py-2 font-medium text-slate-800">
                  {m.product_name}
                </td>
                <td className="py-2 text-slate-600">
                  {kindLabels[m.kind] ?? m.kind}
                </td>
                <td
                  className={`py-2 text-center font-semibold ${
                    m.quantity < 0 ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </td>
                <td className="py-2 text-center text-slate-500">
                  {m.stock_before} → {m.stock_after}
                </td>
                <td className="py-2 text-slate-500">{m.reason}</td>
                <td className="py-2 text-slate-500">
                  {m.created_by?.name ?? "—"}
                </td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Aucun mouvement enregistré.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
