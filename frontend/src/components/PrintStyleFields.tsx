import type { DocumentConfig, LabelPrinterConfig, ReceiptPrinterConfig } from "../types";
import { PRINT_FONTS } from "../lib/printStyle";

function Font({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="label">Police<select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{PRINT_FONTS.map((font) => <option key={font}>{font}</option>)}</select></label>;
}
export function TicketStyleFields({ config, onChange, color, raw }: { config: ReceiptPrinterConfig; onChange: (patch: Partial<ReceiptPrinterConfig>) => void; color: boolean; raw: boolean }) {
  return <div className="my-4 grid gap-4 sm:grid-cols-3">
    {config.width === 'custom' && <label className="label">Papier personnalisé (mm)<input className="input" type="number" min={40} max={216} value={config.paper_width_mm} onChange={(e) => onChange({ paper_width_mm: Number(e.target.value) || 80 })} /></label>}
    <label className="label">Couleur du texte<input className="input h-10" type="color" disabled={!color} value={config.text_color} onChange={(e) => onChange({ text_color: e.target.value })} /></label>
    <label className="label">Disposition des articles<select className="input" value={config.item_layout} onChange={(e) => onChange({ item_layout: e.target.value as ReceiptPrinterConfig['item_layout'] })}><option value="table">Article puis quantité / prix / total</option><option value="stacked">Détail empilé</option></select></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={config.bold} onChange={(e) => onChange({ bold: e.target.checked })} />Texte en gras</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={config.show_company_info} onChange={(e) => onChange({ show_company_info: e.target.checked })} />Informations de l'entreprise</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={config.show_line_total} onChange={(e) => onChange({ show_line_total: e.target.checked })} />Total par article</label>
    <label className="label sm:col-span-3">Message de remerciement / pied de page<textarea className="input" value={config.footer_text} placeholder="Message de l'entreprise par défaut" onChange={(e) => onChange({ footer_text: e.target.value })} /></label>
    <p className="text-xs text-slate-500 sm:col-span-3">{raw ? "ESC/POS : monochrome, police matérielle fixe. Taille normale / agrandie, gras, alignement et interligne envoyés à l'imprimante ; les pixels de l'aperçu restent indicatifs." : color ? "Cette file annonce la prise en charge de la couleur." : "Couleur désactivée : capacité couleur non déclarée ou file inconnue."}</p>
  </div>;
}
export function LabelStyleFields({ config, onChange }: { config: LabelPrinterConfig; onChange: (patch: Partial<LabelPrinterConfig>) => void }) {
  return <div className="my-4 grid gap-4 sm:grid-cols-2"><Font value={config.font_family} onChange={(font_family) => onChange({ font_family })} /><label className="label">Type de code<select className="input" value={config.code_type} onChange={(e) => onChange({ code_type: e.target.value as LabelPrinterConfig['code_type'] })}><option value="barcode">Code-barres</option><option value="qr">QR code</option></select></label><p className="text-xs text-slate-500 sm:col-span-2">Valeur encodée : code-barres de l'article, sinon sa référence. Les colonnes sont appliquées à la planche A4.</p>{config.columns * config.width_mm + (config.columns - 1) * 4 > 198 && <p className="text-sm text-amber-700 sm:col-span-2" role="alert">Ces colonnes dépassent la largeur imprimable A4 : réduisez leur nombre ou leur largeur.</p>}</div>;
}
export function DocumentStyleFields({ config, onChange }: { config: DocumentConfig; onChange: (patch: Partial<DocumentConfig>) => void }) {
  const fields: [keyof DocumentConfig, string][] = [['show_company','Entreprise'],['show_customer','Client'],['show_reference','Référence'],['show_date','Date'],['show_qty','Quantités'],['show_unit_price','Prix unitaires'],['show_total','Totaux']];
  return <div className="my-4 grid gap-4 sm:grid-cols-3">
    <Font value={config.font_family} onChange={(font_family) => onChange({ font_family })} />
    <label className="label">Taille (px)<input className="input" type="number" min={8} max={24} value={config.font_size} onChange={(e) => onChange({ font_size: Number(e.target.value) || 12 })} /></label>
    <label className="label">Logo (mm)<input className="input" type="number" min={5} max={60} value={config.logo_size_mm} onChange={(e) => onChange({ logo_size_mm: Number(e.target.value) || 22 })} /></label>
    <label className="label">Couleur du texte<input className="input h-10" type="color" value={config.text_color} onChange={(e) => onChange({ text_color: e.target.value })} /></label>
    <label className="label">Couleur des titres<input className="input h-10" type="color" value={config.accent_color} onChange={(e) => onChange({ accent_color: e.target.value })} /></label>
    <label className="label">Position des informations<select className="input" value={config.info_position} onChange={(e) => onChange({ info_position: e.target.value as DocumentConfig['info_position'] })}><option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option></select></label>
    <label className="label sm:col-span-3">En-tête partagé<textarea className="input" value={config.header_text} onChange={(e) => onChange({ header_text: e.target.value })} /></label>
    <label className="label sm:col-span-3">Pied de page partagé<textarea className="input" value={config.footer_text} onChange={(e) => onChange({ footer_text: e.target.value })} /></label>
    {fields.map(([key,label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(config[key])} onChange={(e) => onChange({ [key]: e.target.checked })} />{label}</label>)}
    <p className="text-xs text-slate-500 sm:col-span-3">Style commun aux factures / reçus A4, devis / proformas, commandes et bons de livraison. Une imprimante monochrome restitue les couleurs en niveaux de gris.</p>
  </div>;
}
