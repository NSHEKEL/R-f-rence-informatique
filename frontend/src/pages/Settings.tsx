import { Building2, Mail, ShieldCheck, User } from "lucide-react";
import logo from "../assets/logo.jpg";
import { useAuth } from "../context/AuthContext";

export default function Settings() {
  const { user } = useAuth();
  return (
    <div className="max-w-3xl space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
            <img src={logo} alt="Logo" className="h-16 w-16 object-contain" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Référence Informatique
            </h2>
            <p className="text-sm text-slate-500">
              Application de gestion des ventes &amp; du stock
            </p>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="mb-4 text-base font-bold text-slate-900">Mon compte</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <User size={18} />
            </div>
            <div>
              <p className="text-xs text-slate-400">Nom</p>
              <p className="font-medium text-slate-800">{user?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Mail size={18} />
            </div>
            <div>
              <p className="text-xs text-slate-400">Email</p>
              <p className="font-medium text-slate-800">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <ShieldCheck size={18} />
            </div>
            <div>
              <p className="text-xs text-slate-400">Rôle</p>
              <p className="font-medium capitalize text-slate-800">{user?.role}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="mb-4 text-base font-bold text-slate-900">
          À propos de l'application
        </h3>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <Building2 size={18} className="text-slate-400" />
          <p>
            Gérez vos produits, votre stock, vos ventes, vos clients et vos
            fournisseurs depuis une interface unique. Version 1.0.
          </p>
        </div>
      </div>
    </div>
  );
}
