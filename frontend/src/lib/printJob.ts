export type PrintStatus = { state: "idle" | "printing" | "success" | "error"; message: string };

export function createPrintRunner(timeout = 30_000, debounce = 750) {
  let busy = false;
  let lastStarted = -Infinity;
  const now = () => typeof performance === "undefined" ? Date.now() : performance.now();
  const listeners = new Set<() => void>();
  return {
    isBusy: () => busy,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async run(job: () => Promise<unknown>, report: (status: PrintStatus) => void) {
      if (busy) { report({ state: "error", message: "Une impression est encore en cours sur ce poste. Attendez sa fin avant de réimprimer." }); return; }
      if (now() - lastStarted < debounce) { report({ state: "idle", message: "Réimpression rapprochée ignorée pour éviter un doublon. Patientez un instant avant de réessayer." }); return; }
      lastStarted = now();
      busy = true; listeners.forEach((listener) => listener());
      report({ state: "printing", message: "Impression en cours… La vente est conservée." });
      const timer = setTimeout(() => report({ state: "error", message: "Délai de 30 secondes dépassé. Résultat inconnu : vérifiez l'imprimante avant toute réimpression. Vous pouvez fermer cette fenêtre." }), timeout);
      try {
        await Promise.resolve().then(job);
        report({ state: "success", message: "Réussi : demande acceptée par le système d'impression. Vérifiez la sortie papier." });
      } catch (error) {
        report({ state: "error", message: `Échec de l'impression : ${error instanceof Error ? error.message : String(error)}. Vérifiez la connexion, le papier et l'imprimante sélectionnée. La vente reste enregistrée.` });
      } finally {
        clearTimeout(timer); busy = false; listeners.forEach((listener) => listener());
      }
    },
  };
}

export const receiptPrintRunner = createPrintRunner();
