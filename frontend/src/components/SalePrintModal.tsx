import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CompanySettings, ReceiptFormat, ReceiptPrinterConfig, Sale } from "../types";
import { printReceipt } from "../lib/print";
import { receiptPrintRunner, type PrintStatus } from "../lib/printJob";
import Modal from "./Modal";
import Receipt from "./Receipt";

export default function SalePrintModal({ sale, company, config, kick, onClose, onPrinted }: {
  sale: Sale; company: CompanySettings | null; config: ReceiptPrinterConfig;
  kick: number[]; onClose: () => void; onPrinted: (drawerOpened: boolean) => void;
}) {
  const [format, setFormat] = useState<ReceiptFormat>(config.width);
  const [status, setStatus] = useState<PrintStatus>({ state: "idle", message: "Vente conservée. Impression automatique désactivée." });
  const busy = useSyncExternalStore(receiptPrintRunner.subscribe, receiptPrintRunner.isBusy);
  const live = useRef(false);
  const started = useRef(false);
  const source = `pos-print-source-${sale.id}`;
  function start(openCashDrawer = false) {
    const node = document.getElementById(source);
    if (!node) { setStatus({ state: "error", message: "Le reçu n'est pas prêt. Réessayez." }); return; }
    void receiptPrintRunner.run(async () => {
      const root = node.cloneNode(true) as HTMLElement;
      root.id = "receipt-print-root";
      root.style.removeProperty("display");
      document.body.appendChild(root);
      try {
        await Promise.allSettled(Array.from(root.querySelectorAll("img")).map((image) => image.decode()));
        const drawer = await printReceipt(format, config, openCashDrawer ? kick : [], { controlled: true });
        if (openCashDrawer) onPrinted(drawer);
      }
      catch (error) { if (openCashDrawer) onPrinted(false); throw error; }
      finally { root.remove(); }
    }, (next) => { if (live.current) setStatus(next); });
  }
  useEffect(() => {
    live.current = true;
    if (!started.current) { started.current = true; if (config.auto_print) start(true); }
    return () => { live.current = false; };
    // The saved sale starts one job only; retries use the current format.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>
    <Modal open onClose={onClose} wide title={`${sale.pending_sync ? "Vente en attente de synchronisation" : "Vente enregistrée"} — ${sale.reference}`} footer={<div className="flex w-full flex-wrap items-center justify-end gap-3">
      <button className="btn-ghost" onClick={onClose}>Quitter / Fermer</button>
      <select aria-label="Format du reçu" className="input w-auto" disabled={busy} value={format} onChange={(e) => setFormat(e.target.value as ReceiptFormat)}><option value="A4">Feuille A4</option><option value="80mm">Ticket 80 mm</option><option value="58mm">Ticket 58 mm</option></select>
      <button className="btn-primary" disabled={busy} onClick={() => start()}>Réimprimer</button>
      <button className="btn-ghost" onClick={onClose}>Nouvelle vente</button>
    </div>}>
      <p role="status" aria-live="polite" className={`mb-3 rounded-lg p-3 text-sm ${status.state === "error" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-700"}`}>{status.message}</p>
      <p className="mb-3 text-xs text-slate-500">Imprimante : {config.printer_name || "par défaut du poste"}</p>
      {sale.pending_sync && <p className="mb-3 text-sm text-amber-700">Ticket conservé localement, en attente de synchronisation.</p>}
      <Receipt sale={sale} company={company} format={format} previewOnly />
    </Modal>
    <Receipt sale={sale} company={company} format={format} printOnly printSourceId={source} />
  </>;
}
