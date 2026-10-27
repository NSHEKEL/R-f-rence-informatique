import { useEffect, useState } from "react";
import { LifeBuoy, Mail, MessageCircle, Send } from "lucide-react";
import api from "../api/client";
import { useCompany } from "../context/CompanyContext";
import { useAuth } from "../context/AuthContext";

const CATEGORIES = [
  { value: "assistance", label: "Assistance" },
  { value: "bug", label: "Bug" },
  { value: "suggestion", label: "Suggestion" },
  { value: "critique", label: "Critique" },
  { value: "autre", label: "Autre" },
];

interface Contact {
  whatsapp: string;
  email: string;
}

const input =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

export default function Assistance() {
  const { company } = useCompany();
  const { user } = useAuth();
  const [contact, setContact] = useState<Contact>({ whatsapp: "", email: "" });
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("assistance");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    api
      .get<Contact>("/api/support/contact")
      .then(({ data }) => setContact(data))
      .catch(() => setContact({ whatsapp: "0710069059", email: "" }));
  }, []);

  const digits = (contact.whatsapp || "").replace(/\D/g, "");
  const waNumber = digits.startsWith("225") ? digits : `225${digits.replace(/^0+/, "")}`;
  const waText = encodeURIComponent(
    "Bonjour, je vous contacte depuis EasyGest pour obtenir de l'assistance. Voici mon problème :"
  );
  const mailSubject = encodeURIComponent(
    `EasyGest — demande d'assistance (${company?.name || "client"})`
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !subject.trim() || !message.trim()) {
      setFeedback({
        kind: "error",
        text: "Merci de remplir votre nom, le sujet et le message.",
      });
      return;
    }
    setSending(true);
    setFeedback(null);
    try {
      await api.post("/api/support/requests", {
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        category,
        message: message.trim(),
      });
      setFeedback({
        kind: "ok",
        text: "Votre demande a bien été enregistrée. Nous vous répondrons au plus vite.",
      });
      setSubject("");
      setMessage("");
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "L'envoi a échoué. Réessayez ou utilisez WhatsApp.";
      setFeedback({ kind: "error", text: detail });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="card p-6">
        <h2 className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
          <LifeBuoy className="text-brand-600" /> Assistance et support
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Une question, un bug, une idée ? Contactez-nous par WhatsApp, e-mail
          ou via le formulaire ci-dessous.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <a
          href={`https://wa.me/${waNumber}?text=${waText}`}
          target="_blank"
          rel="noreferrer"
          className="card flex items-center gap-4 p-5 transition hover:border-emerald-300 hover:shadow-md"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white">
            <MessageCircle size={22} />
          </span>
          <span>
            <span className="block font-bold text-slate-900">
              Contacter l'assistance sur WhatsApp
            </span>
            <span className="text-sm text-slate-500">
              {contact.whatsapp || "07 10 06 90 59"} — réponse rapide
            </span>
          </span>
        </a>
        <a
          href={`mailto:${contact.email || "ankouame022@gmail.com"}?subject=${mailSubject}`}
          className="card flex items-center gap-4 p-5 transition hover:border-brand-300 hover:shadow-md"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <Mail size={22} />
          </span>
          <span>
            <span className="block font-bold text-slate-900">
              Écrire par e-mail
            </span>
            <span className="text-sm text-slate-500">
              {contact.email || "adresse en cours de confirmation"}
            </span>
          </span>
        </a>
      </div>

      <form className="card space-y-4 p-6" onSubmit={submit}>
        <h3 className="text-base font-bold text-slate-900">
          Envoyer une demande depuis l'application
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            Votre nom *
            <input
              className={`${input} mt-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            E-mail de réponse
            <input
              type="email"
              className={`${input} mt-1`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              placeholder="vous@exemple.com"
            />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            Catégorie
            <select
              className={`${input} mt-1`}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Sujet *
            <input
              className={`${input} mt-1`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
              required
            />
          </label>
        </div>
        <label className="block text-sm font-semibold text-slate-700">
          Votre message *
          <textarea
            className={`${input} mt-1 min-h-[140px]`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={10000}
            required
            placeholder="Décrivez votre problème ou votre demande…"
          />
        </label>
        {feedback && (
          <p
            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
              feedback.kind === "ok"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {feedback.text}
          </p>
        )}
        <button
          type="submit"
          disabled={sending}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <Send size={16} />
          {sending ? "Envoi en cours…" : "Envoyer ma demande"}
        </button>
      </form>
    </div>
  );
}
