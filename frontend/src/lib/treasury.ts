type Can = (key: string) => boolean;

export function canOpenTreasury(path: string, can: Can): boolean {
  const reports = can("rapports_financiers") && can("soldes_consulter");
  switch (path.replace(/\/+$/, "").toLowerCase()) {
    case "/banque":
      return can("tresorerie_consulter") && (can("versements_gerer") || can("versements_valider"));
    case "/comptabilite":
      return can("tresorerie_consulter") && can("comptabilite");
    case "/dettes":
      return can("tresorerie_consulter") && can("dettes") && reports;
    case "/rapports":
      return can("rapports") && reports;
    case "/tableau-de-bord":
      return can("tableau_bord") && reports;
    default:
      return true;
  }
}

export function allowedLandingPath(pages: ReadonlyArray<readonly [string, string]>, can: Can): string {
  return pages.find(([right, path]) => can(right) && canOpenTreasury(path, can))?.[1] ?? "/";
}
