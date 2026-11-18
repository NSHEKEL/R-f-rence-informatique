import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CompanySettings, ReceiptPrinterConfig, Sale } from "../types";
import { printReceipt } from "../lib/print";
import { receiptPrintRunner, type PrintStatus } from "../lib/printJob";
import Receipt from "./Receipt";

export default function AutomaticReceipt({ sale, company, config, kick, onPrinted, onDone }: {
  sale: Sale; company: CompanySettings | null; config: ReceiptPrinterConfig; kick: number[];
  onPrinted: (opened: boolean) => void; onDone: () => void;
}) {
  const busy = useSyncExternalStore(receiptPrintRunner.subscribe, receiptPrintRunner.isBusy);
  const started = useRef(false);
  const live = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<PrintStatus>({ state: "idle", message: "Ticket en attente d'impression." });
  const source = `auto-receipt-${sale.id}-${sale.reference}`;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (busy || receiptPrintRunner.isBusy() || started.current) return;
    started.current = true;
    void receiptPrintRunner.run(async () => {
      const node = document.getElementById(source);
      if (!node) throw new Error("Reçu indisponible");
      const root = node.cloneNode(true) as HTMLElement;
      root.id = "receipt-print-root"; root.style.removeProperty("display");
      document.body.appendChild(root);
      try {
        await Promise.allSettled(Array.from(root.querySelectorAll("img")).map((image) => image.decode()));
        const opened = await printReceipt(config.width, config, attempt === 0 ? kick : [], { controlled: true });
        if (attempt === 0) onPrinted(opened);
      } catch (err) { if (attempt === 0) onPrinted(false); throw err; }
      finally { root.remove(); }
    }, (next) => {
      if (!live.current) return;
      setStatus(next);
      if (next.state === "success") onDone();
    }, `${sale.id}:${sale.reference}`);
    // A saved ticket is submitted once; retries use the latest local printer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, attempt]);
  return <>
    <div role={status.state === "error" ? "alert" : "status"} className={`mb-2 flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm ${status.state === "error" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-700"}`}>
      <span>{sale.reference} — {status.message}</span>
      {status.state !== "printing" && <button className="btn-secondary" disabled={busy} onClick={() => { started.current = false; setAttempt((value) => value + 1); }}>Réimprimer</button>}
    </div>
    <Receipt sale={sale} company={company} format={config.width} printOnly printSourceId={source} />
  </>;
}
