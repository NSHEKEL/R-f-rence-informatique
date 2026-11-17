import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Documents with many lines open on the whole screen. */
  fullscreen?: boolean;
  size?: "form" | "compact";
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  fullscreen,
  size = "form",
  closeOnBackdrop = true,
  closeOnEscape = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (document.querySelector("[data-easygest-print-preview]")) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (closeOnEscape) onClose(); }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [open, onClose, closeOnEscape]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-3">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 flex w-full flex-col overflow-hidden bg-white shadow-soft ${
          fullscreen || size === "form"
            ? "h-[calc(100vh-1rem)] max-h-[calc(100vh-1rem)] md:h-[calc(100vh-1.5rem)] md:max-h-[calc(100vh-1.5rem)] rounded-2xl"
            : `${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] rounded-2xl`
        }`}
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-3 md:px-6">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            title="Fermer"
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">{children}</div>
        {footer && (
          <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-100 bg-white px-4 py-3 md:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
