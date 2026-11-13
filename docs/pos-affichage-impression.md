# Affichage POS et impression après vente

- Les réglages sont conservés dans `company_settings.pos_display` (JSON), via
  `/api/settings/pos-display`. Lecture authentifiée ; modification administrateur.
- Par défaut : nom centré uniquement, sans images ni stock. Le mode et les
  interrupteurs images/stock doivent tous deux autoriser chaque information.
  Le stock exige en plus le droit `produits` ou `inventaire`.
- La largeur est un minimum en grille automatique. Les colonnes fixes répartissent
  la largeur disponible. Aucun changement des couleurs globales.
- La grille pagine par 60 articles ; la recherche et les catégories ne tronquent
  plus arbitrairement le catalogue. Les images désactivées ne sont ni demandées
  par le POS ni chargées depuis la colonne image du catalogue POS.
- Le catalogue POS et les lectures générales masquent quantité, seuil et
  équivalence aux utilisateurs sans droit de stock. Les contrôles définitifs de
  disponibilité restent dans la transaction de vente sur le serveur.
- La restauration des valeurs par défaut modifie l'aperçu ; Enregistrer les
  conserve sur le serveur.

## Après encaissement

La vente serveur est enregistrée avant ouverture de la modale d'impression.
Un ticket hors ligne est explicitement présenté comme en attente de synchronisation.
Fermer, Échap et Nouvelle vente ferment seulement l'aperçu : aucun appel de vente,
annulation ou suppression. Réimprimer réutilise le reçu enregistré.

Le travail d'impression possède sa propre copie DOM et continue indépendamment
de la modale. Le verrou d'impression du poste empêche les doubles clics et reste
actif jusqu'au résultat réel, même après le délai d'affichage de 30 secondes.
Après une fermeture, les notifications du travail détaché n'affectent plus la modale.
WebView2 utilise toujours PrintAsync hors du thread UI ; une tâche native toujours
active après expiration bloque aussi un nouvel envoi natif.

« Réussi » signifie accepté par le système d'impression, pas confirmation de la
sortie papier. Un poste sans pont d'impression silencieuse affiche une erreur
explicite dans cette modale, sans ouvrir automatiquement un dialogue bloquant.
Les autres commandes d'impression conservent leurs comportements existants.
