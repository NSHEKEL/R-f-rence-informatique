import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useLicense } from "../context/LicenseContext";

/**
 * Warns the shop before the licence expires, and once it is blocked.
 * Escalating reminders: J-7 avertissement, J-3 rappel renforcé, J-1
 * expiration imminente.
 */
export default function LicenseBanner() {
  const { license } = useLicense();
  const navigate = useNavigate();
  if (!license || license.mode === "local") return null;

  const days = license.days_left;
  const soon = !license.blocked && days !== null && days >= 0 && days <= 7;
  if (!license.blocked && !soon) return null;

  let text: string;
  let tone: string;
  if (license.blocked) {
    text = license.message;
    tone = "bg-red-50 text-red-700";
  } else if (days !== null && days <= 1) {
    text =
      "Expiration imminente : votre licence EasyGest expire " +
      (days === 0 ? "aujourd'hui." : "demain.");
    tone = "bg-red-50 text-red-700";
  } else if (days !== null && days <= 3) {
    text = `Rappel : votre licence EasyGest expire dans ${days} jour(s). Pensez à renouveler.`;
    tone = "bg-orange-50 text-orange-800";
  } else {
    text = `Votre licence EasyGest expire dans ${days} jour(s).`;
    tone = "bg-amber-50 text-amber-800";
  }

  return (
    <button
      type="button"
      onClick={() => navigate("/mon-abonnement")}
      className={`flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm font-medium ${tone}`}
    >
      <AlertTriangle size={16} />
      {text}
      <span className="ml-auto underline">Mon abonnement</span>
    </button>
  );
}
