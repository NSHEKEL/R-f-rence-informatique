import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { ReceiptPrinterConfig } from "../types";
import { printAutomaticDocument } from "../lib/print";
import { receiptPrintRunner } from "../lib/printJob";

export default function AutomaticDocumentPrint({ children, config, onDone }: {
  children: ReactNode; config: ReceiptPrinterConfig; onDone: (error: string) => void;
}) {
  const source = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const jobId = useId();
  const busy = useSyncExternalStore(receiptPrintRunner.subscribe, receiptPrintRunner.isBusy);

  useEffect(() => {
    if (busy || receiptPrintRunner.isBusy() || started.current) return;
    started.current = true;
    let error = "";
    let root: HTMLElement | undefined;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; root?.remove(); onDone(error); } };
    void receiptPrintRunner.run(async () => {
      const node = source.current?.firstElementChild;
      if (!node) throw new Error("Document de caisse indisponible");
      root = node.cloneNode(true) as HTMLElement;
      root.id = "receipt-print-root";
      document.body.appendChild(root);
      try {
        await Promise.allSettled(Array.from(root.querySelectorAll("img")).map((image) => image.decode()));
        await printAutomaticDocument(config.width, config);
      } finally { root.remove(); }
    }, (status) => { if (status.state === "error") { error = status.message; finish(); } }, jobId).then(finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return <div ref={source} hidden>{children}</div>;
}
