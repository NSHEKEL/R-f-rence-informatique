/**
 * Which capability of the subscribed plan each screen needs.
 *
 * The key is the access right the administrator grants role by role, the
 * value the feature code the Global Administrator switches ON or OFF for the
 * plan. Screens missing from this map (settings, access rights, about) never
 * depend on the plan.
 */
export const PLAN_FEATURE: Record<string, string> = {
  tableau_bord: "tableau_bord",
  caisse: "versements",
  ventes: "ventes",
  vente_nouvelle: "ventes",
  retours: "fonctions_avancees",
  clients: "clients",
  commandes: "dettes",
  livraisons: "dettes",
  produits: "produits",
  inventaire: "stock",
  rapports: "rapports",
  proformas: "fonctions_avancees",
  comptabilite: "dettes",
  fournisseurs: "fournisseurs",
  approvisionnements: "achats",
  categories: "categories",
};
