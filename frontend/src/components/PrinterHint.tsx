import { Printer } from "lucide-react";
import { useCompany } from "../context/CompanyContext";

/** Reminds which printer was configured, since the browser picks the target. */
export default function PrinterHint() {
  const { company } = useCompany();
  const name = company?.printer_name?.trim();
  if (!name) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <Printer size={14} /> Imprimante : {name}
    </span>
  );
}
