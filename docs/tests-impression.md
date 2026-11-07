# Tests physiques d'impression — procédure

À exécuter sur un poste Windows réel avec le matériel branché. Ce qui est
déjà vérifié sans matériel : détection, états, files, séquences ESC/POS,
affectations, sauvegarde des préférences — sur poste simulé.

## 1. Imprimante thermique 80 mm

1. Brancher l'imprimante, installer son pilote Windows.
2. Configuration → Imprimantes → Actualiser : elle apparaît avec son nom réel.
3. Affecter « Imprimante de reçus » = cette imprimante, format 80 mm, Enregistrer.
4. Bouton **T80** sur sa ligne : un ticket de test sort réellement.
5. Faire une vente réelle : le ticket sort seul si « impression après une vente »
   est activée, sans boîte de dialogue.
6. Vérifier : hauteur ajustée au contenu, pas de page blanche, découpe si le
   modèle la gère, code-barres lisible, QR code présent si l'option est active.

## 2. Imprimante thermique 58 mm

Même procédure avec le format 58 mm et le bouton **T58**. Vérifier que le
texte tient dans la largeur et que le QR est plus petit (module 4 points).

## 3. Imprimante A4

1. Affecter « Imprimante des documents commerciaux ».
2. Bouton **Tester** : une page A4 de test sort.
3. Imprimer une facture et un bon de livraison réels : marges et mise en page
   conformes à l'aperçu.

## 4. Découpe automatique

Le cut part à la fin du ticket ESC/POS quand « Découpe » est activée dans les
réglages du reçu. Vérifier physiquement que la lame coupe ; si le modèle n'a
pas de lame, désactiver l'option (aucune erreur ne remonte : l'imprimante
ignore la commande).

## 5. Tiroir-caisse

1. Tiroir branché sur le port RJ11 de l'imprimante de reçus.
2. Configuration → Imprimantes → carte Tiroir-caisse : activer, **Tester**.
   Le tiroir s'ouvre réellement.
3. Vendre en espèces : le tiroir s'ouvre après validation si l'option est
   activée ; il ne s'ouvre pas pour un devis.

## 6. Scanner de codes-barres

1. Brancher la douchette USB (mode clavier HID).
2. Nouvelle vente → scanner un code article : l'article s'ajoute au panier.
3. Scanner un code inconnu : message « article introuvable », aucun crash.
4. Vérifier qu'il n'y a pas de double ajout sur un scan unique.

## Cas de résistance à rejouer sur le poste

- Imprimante configurée puis débranchée : état « Hors ligne »/indisponible
  affiché, impression refusée avec motif lisible.
- Imprimante supprimée de Windows : l'affectation reste enregistrée, l'impression
  signale l'absence au lieu de crasher.
- Imprimante réseau éteinte : même comportement « hors ligne ».
- Imprimante Windows par défaut différente de celle d'EasyGest : les
  documents partent sur la file EasyGest, pas sur le défaut Windows.
- Deux postes sur la même base : chacun garde ses propres affectations.
- Reinstallation : si le fichier `easygest-imprimantes-poste.json` existe
  encore à côté de l'exe, les affectations reviennent seules au premier lancement.
