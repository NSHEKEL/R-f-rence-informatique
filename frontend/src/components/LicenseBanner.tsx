import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useLicense } from "../context/LicenseContext";

/** Warns the shop before the licence expires, and once it is blocked. */
export default function LicenseBanner() {
  const { license } = useLicense();
  const navigate = useNavigate();
  if (!license || license.mode === "local") return null;

  const soon =
    !license.blocked &&
    license.days_left !== null &&
    license.days_left >= 0 &&
    license.days_left <= 15;
  if (!license.blocked && !soon) return null;

  const text = license.blocked
    ? license.message
    : `Votre licence EasyGest expire dans ${license.days_left} jour(s).`;

  return (
    <button
      type="button"
      onClick={() => navigate("/mon-abonnement")}
      className={`flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm font-medium ${
        license.blocked
          ? "bg-red-50 text-red-700"
          : "bg-amber-50 text-amber-800"
      }`}
    >
      <AlertTriangle size={16} />
      {text}
      <span className="ml-auto underline">Mon abonnement</span>
    </button>
  );
}
