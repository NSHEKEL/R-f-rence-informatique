# Personnaliser les impressions

Les trois sections Tickets, Étiquettes et Documents commerciaux proposent un
aperçu, l'enregistrement, la restauration du style par défaut et une impression
de test. La restauration change le formulaire : enregistrer pour la conserver.
Elle ne remplace jamais les imprimantes affectées à ce poste.

Les styles sont conservés dans le JSON `printing_config` existant, par société.
Les nouvelles clés complètent les configurations anciennes sans remplacer les
valeurs enregistrées ; aucune colonne et aucune table ajoutée.

Tickets 58/80 mm : ESC/POS monochrome à police matérielle fixe. La police et la
couleur sont donc désactivées. La taille comporte deux niveaux matériels ; le
gras, l'alignement et l'interligne sont envoyés au périphérique. Les pixels de
l'aperçu sont indicatifs. Les autres largeurs passent par le pilote Windows.
La couleur n'est proposée que si Windows annonce `DC_COLORDEVICE` ; une file
inconnue reste monochrome. Cette capacité est mémorisée localement et renouvelée
avec Actualiser les imprimantes, jamais partagée comme affectation entre postes.

Les étiquettes utilisent réellement les colonnes configurées sur la planche A4.
Réduire leur nombre ou leur largeur si l'avertissement de débordement apparaît.
Le QR encode le code-barres de l'article, sinon sa référence, avec l'encodeur QR
déjà présent ; désactiver l'option code masque aussi le QR.

Le style commercial est commun aux factures et reçus A4, devis/proformas,
commandes et bons de livraison. Il utilise les gabarits existants et conserve
les anciennes dispositions `document_layouts`. Les réglages partagés de position
et d'apparence s'appliquent au-dessus des dispositions locales. Une imprimante
monochrome restitue les couleurs commerciales en niveaux de gris.
