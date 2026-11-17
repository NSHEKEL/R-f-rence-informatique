export default function OfflineBanner({ visible, since }: { visible: boolean; since: string }) {
  return visible ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">Hors ligne — données du {since ? new Date(since).toLocaleString("fr-FR") : "dernier chargement (date inconnue)"}. Consultation seule, sauf les comptages d'inventaire conservés sur ce poste.</p> : null;
}
