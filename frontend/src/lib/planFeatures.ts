/**
 * Which capability of the subscribed plan each screen needs.
 *
 * The key is the access right the administrator grants role by role, the
 * value the feature code the Global Administrator switches ON or OFF for the
 * plan. The administration screens share the same "admin" right, so they name
 * their feature on the menu entry itself (see ADMIN_FEATURE). Only "Mon
 * abonnement" stays out: it is the screen that shows the plan.
 */
export const PLAN_FEATURE: Record<string, string> = {
  tableau_bord: "tableau_bord",
  caisse: "versements",
  ventes: "ventes",
  vente_nouvelle: "ventes",
  retours: "retours",
  clients: "clients",
  commandes: "commandes",
  livraisons: "livraisons",
  produits: "produits",
  inventaire: "inventaire",
  rapports: "rapports",
  proformas: "proformas",
  comptabilite: "comptabilite",
  paie: "paie",
  dettes: "dettes",
  fournisseurs: "fournisseurs",
  approvisionnements: "achats",
  categories: "categories",
  apropos: "apropos",
};

/** Feature of the pages the administrator alone reaches, keyed by path. */
export const ADMIN_FEATURE: Record<string, string> = {
  "/utilisateurs": "gestion_utilisateurs",
  "/droits": "droits_acces",
  "/parametres": "parametres",
};
