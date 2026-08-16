import { useEffect, useState } from "react";
import {
  Building2,
  Globe,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
} from "lucide-react";
import api from "../api/client";
import { useCompany } from "../context/CompanyContext";

interface HealthInfo {
  version: string;
}

/**
 * Fixed presentation of the publisher. This page is deliberately read-only:
 * nothing here can be edited from the application.
 */
const PUBLISHER = {
  address: "Bondoukou, Côte d'Ivoire — quartier Église Sainte Odile",
  phone: "07 10 06 90 59",
  email: "ankouame022@gmail.com",
  about:
    "EasyGest est un logiciel ivoirien de gestion des ventes et des " +
    "stocks : caisse, articles, clients, commandes, livraisons, " +
    "comptabilité, inventaire et rapports.\n\n" +
    "Il accompagne les commerces, les entreprises et les administrations " +
    "avec un suivi fiable au quotidien et un conseil de proximité.",
};

export default function APropos() {
  const { company, brandName, logoSrc } = useCompany();
  const [version, setVersion] = useState("");

  useEffect(() => {
    api
      .get<HealthInfo>("/health")
      .then(({ data }) => setVersion(data.version ?? ""))
      .catch(() => setVersion(""));
  }, []);

  const contacts = [
    { icon: MapPin, label: "Adresse", value: PUBLISHER.address },
    { icon: Phone, label: "Téléphone", value: PUBLISHER.phone },
    { icon: Mail, label: "E-mail", value: PUBLISHER.email },
    { icon: Globe, label: "Site web", value: company?.website || "—" },
    { icon: ShieldCheck, label: "RCCM / NCC", value: company?.tax_id || "—" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="card flex flex-wrap items-center gap-5 p-6">
        <img
          src={logoSrc}
          alt={brandName}
          className="h-20 w-20 rounded-2xl object-contain ring-1 ring-slate-100"
        />
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900">EasyGest</h2>
          <p className="text-sm text-slate-500">Vente &amp; suivi de stock</p>
          {version && (
            <p className="mt-1 text-xs font-semibold text-brand-700">
              Version {version}
            </p>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
          <Building2 size={18} /> Qui sommes-nous ?
        </h3>
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">
          {PUBLISHER.about}
        </p>
        {company?.name && (
          <p className="mt-4 text-xs text-slate-400">
            Licence utilisée par : {company.name}
          </p>
        )}
      </div>

      <div className="card p-6">
        <h3 className="mb-4 text-base font-bold text-slate-900">
          Nous contacter
        </h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {contacts.map((c) => (
            <div key={c.label} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <c.icon size={18} />
              </span>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-slate-500">
                  {c.label}
                </dt>
                <dd className="break-words text-sm font-semibold text-slate-900">
                  {c.value}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
