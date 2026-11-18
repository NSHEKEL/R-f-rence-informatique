import { useEffect, useState } from "react";
import api from "../api/client";

export default function AccountingPayment({ method, bank, methods = [], onChange }: { method: string; bank: string; methods?: string[]; onChange: (method: string, bank: string) => void }) {
  const [banks, setBanks] = useState<{ id: number; label: string; bank_name: string }[]>([]);
  useEffect(() => { void api.get("/bank/accounts").then(({ data }) => setBanks(data)).catch(() => setBanks([])); }, []);
  return <div className="flex flex-wrap gap-2"><label className="label">Mode de paiement (facultatif)<select className="input" value={method} onChange={(e) => onChange(e.target.value, "")}><option value="">Non renseigné</option>{[...new Set([...methods, "Espèces", "Virement", "Chèque", "Carte bancaire", "Mobile Money"])].map((value) => <option key={value}>{value}</option>)}</select></label>{method && method !== "Espèces" && <label className="label">Compte bancaire (facultatif)<select className="input" value={bank} onChange={(e) => onChange(method, e.target.value)}><option value="">Non renseigné</option>{banks.map((b) => <option value={b.id} key={b.id}>{b.label || b.bank_name}</option>)}</select></label>}</div>;
}
