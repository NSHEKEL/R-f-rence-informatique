import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import api from "../api/client";
import type { Supplier } from "../types";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";

const empty = { name: "", contact: "", email: "", phone: "", address: "" };

export default function Suppliers() {
  const { isAdmin } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await api.get<Supplier[]>("/suppliers");
    setSuppliers(res.data);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.contact.toLowerCase().includes(q)
    );
  }, [suppliers, query]);

  function openCreate() {
    setEditing(null);
    setForm({ ...empty });
    setOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      contact: s.contact,
      email: s.email,
      phone: s.phone,
      address: s.address,
    });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (editing) await api.put(`/suppliers/${editing.id}`, form);
      else await api.post("/suppliers", form);
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(s: Supplier) {
    if (!confirm(`Supprimer le fournisseur "${s.name}" ?`)) return;
    await api.delete(`/suppliers/${s.id}`);
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
            placeholder="Rechercher un fournisseur..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={18} /> Nouveau fournisseur
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Fournisseur</th>
                <th className="px-5 py-3">Contact</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Téléphone</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-slate-800">{s.name}</p>
                    <p className="text-xs text-slate-400">{s.address || "—"}</p>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">{s.contact || "—"}</td>
                  <td className="px-5 py-3.5 text-slate-600">{s.email || "—"}</td>
                  <td className="px-5 py-3.5 text-slate-600">{s.phone || "—"}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1">
                      {isAdmin ? (
                        <>
                          <button
                            onClick={() => openEdit(s)}
                            aria-label="Modifier le fournisseur"
                            className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => remove(s)}
                            aria-label="Supprimer le fournisseur"
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                    Aucun fournisseur trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Modifier le fournisseur" : "Nouveau fournisseur"}
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
            <label className="label">Nom de l'entreprise</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Personne de contact</label>
            <input
              className="input"
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
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
