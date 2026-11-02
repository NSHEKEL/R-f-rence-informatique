import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LifeBuoy,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
} from "lucide-react";
import api from "../api/client";
import { useLicense } from "../context/LicenseContext";
import { formatDate } from "../api/client";

/** Routes still reachable while the licence is blocked. */
const ALLOWED_PREFIXES = ["/mon-abonnement", "/assistance", "/a-propos"];

/**
 * Full screen replacing the app once the licence is expired, suspended or
 * revoked. The backend already refuses commercial operations (403); this is
 * the visible, professional face of the lock. Data stays untouched.
 */
export default function LicenseLocked({
  children,
}: {
  children: React.ReactNode;
}) {
  const { license, refresh } = useLicense();
  const location = useLocation();
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (!license?.blocked) return <>{children}</>;
  if (ALLOWED_PREFIXES.some((p) => location.pathname.startsWith(p)))
    return <>{children}</>;

  const support = license.support ?? {};
  const trialExpired = license.plan_code === "essai";
  const title = trialExpired
    ? "Votre période d'essai gratuite de 30 jours est arrivée à expiration."
    : "Votre licence EasyGest a expiré.";

  async function recheck() {
    setChecking(true);
    setFeedback("");
    try {
      await api.post("/license/sync");
      await refresh();
      setFeedback("Statut de licence vérifié auprès du serveur central.");
    } catch {
      setFeedback(
        "Vérification impossible : serveur injoignable ou droits administrateur requis."
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-lg">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
          <Lock size={26} />
        </div>
        <h1 className="mt-5 text-xl font-bold text-slate-900">
          Licence EasyGest
          {license.client_name ? ` — ${license.client_name}` : ""}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          {title} Pour continuer à utiliser EasyGest, veuillez contacter notre
          service commercial afin de souscrire à un abonnement et activer votre
          licence.
        </p>
        {license.ends_at && (
          <p className="mt-2 text-sm text-slate-500">
            Expiration : {formatDate(license.ends_at)}
          </p>
        )}

        <div className="mt-6 grid gap-2">
          {support.phone && (
            <a
              href={`tel:${support.phone.replace(/\s/g, "")}`}
              className="btn-primary flex items-center justify-center gap-2"
            >
              <Phone size={16} /> {support.phone}
            </a>
          )}
          {support.whatsapp && (
            <a
              href={`https://wa.me/${support.whatsapp.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost flex items-center justify-center gap-2 border border-emerald-300 text-emerald-700"
            >
              <MessageCircle size={16} /> WhatsApp
            </a>
          )}
          {support.email && (
            <a
              href={`mailto:${support.email}`}
              className="btn-ghost flex items-center justify-center gap-2"
            >
              <Mail size={16} /> {support.email}
            </a>
          )}
          <button
            type="button"
            onClick={recheck}
            disabled={checking}
            className="btn-ghost flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} className={checking ? "animate-spin" : ""} />
            {checking ? "Vérification…" : "Vérifier ma licence"}
          </button>
        </div>
        {feedback && (
          <p className="mt-3 text-xs text-slate-500">{feedback}</p>
        )}

        <div className="mt-6 flex justify-center gap-4 text-sm">
          <Link to="/mon-abonnement" className="text-blue-600 underline">
            Mon abonnement
          </Link>
          <Link
            to="/assistance"
            className="flex items-center gap-1 text-blue-600 underline"
          >
            <LifeBuoy size={14} /> Assistance
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Vos données sont conservées intactes et seront de nouveau accessibles
          après activation.
        </p>
      </div>
    </div>
  );
}
