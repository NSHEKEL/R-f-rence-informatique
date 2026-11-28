import axios from "axios";
import { apiErrorMessage } from "./apiErrors";

export function localPrinterError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response) return apiErrorMessage(error.response.data?.detail, error.message);
    return `Service d'impression de ce poste inaccessible (${error.message}). Lancez EasyGest sur cet ordinateur et autorisez l'accès au réseau local dans le navigateur. Vérifiez aussi le port du service local ; aucune liste du serveur n'est utilisée en remplacement.`;
  }
  return String(error);
}
