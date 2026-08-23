import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import api from "../api/client";

interface Definition {
  key: string;
  label: string;
  section: string;
}

interface Matrix {
  definitions: Definition[];
  roles: string[];
  matrix: Record<string, Record<string, boolean>>;
}

const roleLabels: Record<string, string> = {
  vendeur: "Vendeur / Caissier",
  gestionnaire: "Gestionnaire de stock",
};

export default function Droits() {
  const [data, setData] = useState<Matrix | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<Matrix>("/permissions").then((res) => setData(res.data));
  }, []);

  function toggle(role: string, key: string) {
    setSaved(false);
    setData((prev) =>
      prev
        ? {
            ...prev,
            matrix: {
              ...prev.matrix,
              [role]: { ...prev.matrix[role], [key]: !prev.matrix[role][key] },
            },
          }
        : prev
    );
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await api.put<Matrix>("/permissions", {
        matrix: data.matrix,
      });
      setData(res.data);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="text-slate-500">Chargement...</p>;

  const sections = [...new Set(data.definitions.map((d) => d.section))];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <p className="text-sm text-slate-600">
          Cochez ce que chaque rôle peut ouvrir et faire. L'administrateur garde
          tous les droits ; Utilisateurs, Paramètres et cette page lui restent
          réservés. Les droits s'appliquent immédiatement côté serveur et au
          plus tard en une minute sur les postes déjà connectés.
        </p>
      </div>

      {sections.map((section) => (
        <div
          key={section}
          className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200"
        >
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{section}</th>
                {data.roles.map((role) => (
                  <th key={role} className="px-4 py-3 text-center">
                    {roleLabels[role] ?? role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.definitions
                .filter((d) => d.section === section)
                .map((def) => (
                  <tr key={def.key}>
                    <td className="px-4 py-2.5 text-slate-700">{def.label}</td>
                    {data.roles.map((role) => (
                      <td key={role} className="px-4 py-2.5 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          checked={data.matrix[role][def.key] ?? false}
                          onChange={() => toggle(role, def.key)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Enregistrement..." : "Enregistrer les droits"}
        </button>
        {saved && (
          <span className="text-sm font-medium text-emerald-600">
            Droits enregistrés.
          </span>
        )}
      </div>
    </div>
  );
}
