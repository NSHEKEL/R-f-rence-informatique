const fields: Record<string, string> = {
  name: "Nom", sku: "Référence", base_unit: "Unité de base", packaging_unit: "Conditionnement principal",
  units_per_packaging: "Facteur", packagings: "Conditionnements", factor: "Facteur",
  barcodes: "Code-barres", barcode: "Code-barres", code: "Code", label: "Libellé",
  rayon: "Rayon", emplacement: "Emplacement", quantity: "Quantité", items: "Articles",
  purchase_price: "Prix d'achat", sale_price: "Prix de vente", wholesale_price: "Prix de gros",
  price_detail: "Prix détail", price_semi_gros: "Prix semi-gros", price_gros: "Prix gros",
  category_id: "Catégorie", supplier_id: "Fournisseur", product_id: "Produit",
};

function fieldPath(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const parts = value.filter((part) => typeof part === "string" || typeof part === "number");
  if (["body", "query", "path"].includes(String(parts[0]))) parts.shift();
  if (parts[0] === "barcodes" && parts[2] === "code") parts.splice(2, 1);
  return parts.reduce<string>((path, part) => typeof part === "number"
    ? `${path} ${part + 1}`
    : [path, fields[part] || part].filter(Boolean).join(" · "), "");
}

function validationMessage(error: Record<string, unknown>): string {
  const ctx = error.ctx && typeof error.ctx === "object" ? error.ctx as Record<string, unknown> : {};
  const limit = (key: string) => typeof ctx[key] === "number" ? String(ctx[key]) : "?";
  switch (error.type) {
    case "missing": return "champ requis";
    case "string_too_short": return `au moins ${limit("min_length")} caractère${ctx.min_length === 1 ? "" : "s"} requis`;
    case "string_too_long": return `${limit("max_length")} caractères maximum`;
    case "int_parsing": case "int_type": case "int_from_float": return "nombre entier requis";
    case "float_parsing": case "float_type": case "finite_number": return "nombre valide requis";
    case "greater_than_equal": return `valeur supérieure ou égale à ${limit("ge")} requise`;
    case "greater_than": return `valeur supérieure à ${limit("gt")} requise`;
    case "less_than_equal": return `valeur inférieure ou égale à ${limit("le")} requise`;
    case "less_than": return `valeur inférieure à ${limit("lt")} requise`;
    case "string_type": return "texte requis";
    default: return typeof error.msg === "string" ? error.msg : "valeur invalide";
  }
}

export function apiErrorMessage(detail: unknown, fallback = "Une erreur est survenue."): string {
  function read(value: unknown, depth: number): string {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object" || depth > 5) return "";
    if (Array.isArray(value)) return value.map((item) => read(item, depth + 1)).filter(Boolean).join(" ; ");
    const error = value as Record<string, unknown>;
    if ("loc" in error || "msg" in error) {
      const path = fieldPath(error.loc);
      return [path, validationMessage(error)].filter(Boolean).join(" : ");
    }
    for (const key of ["detail", "message", "error"]) {
      if (key in error) return read(error[key], depth + 1);
    }
    return Object.entries(error).map(([key, item]) => {
      const message = read(item, depth + 1);
      return message ? `${fields[key] || key} : ${message}` : "";
    }).filter(Boolean).join(" ; ");
  }
  return read(detail, 0) || fallback;
}
