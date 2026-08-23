import { useEffect, useMemo, useState } from "react";
import { Mail, Pencil, Phone, Plus, Search, Trash2 } from "lucide-react";
import api from "../api/client";
import type { Customer } from "../types";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { useSyncVersion } from "../context/SyncContext";

const empty = { name: "", email: "", phone: "", address: "" };

export default function Customers() {
  const { can } = useAuth();
  const version = useSyncVersion();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await api.get<Customer[]>("/customers");
    setCustomers(res.data);
  }

  useEffect(() => {
    load();
  }, [version]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [customers, query]);

  function openCreate() {
    setEditing(null);
    setForm({ ...empty });
    setOpen(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setForm({ name: c.name, email: c.email, phone: c.phone, address: c.address });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (editing) await api.put(`/customers/${editing.id}`, form);
      else await api.post("/customers", form);
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Customer) {
    if (!confirm(`Supprimer le client "${c.name}" ?`)) return;
    await api.delete(`/customers/${c.id}`);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <Search
            size={18}
            className="pointer-events-none absolute left-3.5 top-3 text-slate-400"
          />
          <input
            className="input pl-11"
            placeholder="Rechercher un client..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={18} /> Nouveau client
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c) => (
          <div key={c.id} className="card p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                {c.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{c.name}</p>
                <p className="truncate text-xs text-slate-400">{c.address || "—"}</p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => openEdit(c)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                >
                  <Pencil size={15} />
                </button>
                {can("clients_gerer") && (
                  <button
                    onClick={() => remove(c)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 space-y-1.5 text-sm text-slate-600">
              <p className="flex items-center gap-2">
                <Mail size={15} className="text-slate-400" /> {c.email || "—"}
              </p>
              <p className="flex items-center gap-2">
                <Phone size={15} className="text-slate-400" /> {c.phone || "—"}
              </p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-10 text-center text-slate-400">
            Aucun client trouvé.
          </p>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Modifier le client" : "Nouveau client"}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nom</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Téléphone</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Adresse</label>
            <input
              className="input"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
