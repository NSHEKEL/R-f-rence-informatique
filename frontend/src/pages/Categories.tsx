import { useEffect, useState } from "react";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import api from "../api/client";
import type { Category } from "../types";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";

const empty = { name: "", description: "" };

export default function Categories() {
  const { isAdmin } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await api.get<Category[]>("/categories");
    setCategories(res.data);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...empty });
    setOpen(true);
  }

  function openEdit(c: Category) {
    setEditing(c);
    setForm({ name: c.name, description: c.description });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (editing) await api.put(`/categories/${editing.id}`, form);
      else await api.post("/categories", form);
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Category) {
    if (!confirm(`Supprimer la catégorie "${c.name}" ?`)) return;
    await api.delete(`/categories/${c.id}`);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={18} /> Nouvelle catégorie
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((c) => (
          <div key={c.id} className="card p-5">
            <div className="flex items-start justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Tags size={20} />
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(c)}
                    aria-label="Modifier la catégorie"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => remove(c)}
                    aria-label="Supprimer la catégorie"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
            <p className="mt-4 font-semibold text-slate-900">{c.name}</p>
            <p className="mt-1 text-sm text-slate-500">{c.description || "—"}</p>
          </div>
        ))}
        {categories.length === 0 && (
          <p className="col-span-full py-10 text-center text-slate-400">
            Aucune catégorie.
          </p>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Modifier la catégorie" : "Nouvelle catégorie"}
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
            <label className="label">Description</label>
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
