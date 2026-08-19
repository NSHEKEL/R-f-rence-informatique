# EasyGest mobile (Android)

Application Android qui affiche EasyGest hébergé par l'ordinateur du magasin.
Le téléphone et l'ordinateur doivent être sur le même réseau Wi-Fi, et
EasyGest doit tourner sur l'ordinateur en mode « poste serveur »
(`EASYGEST_HOST=0.0.0.0`, port 8000 autorisé dans le pare-feu).

Au premier lancement, l'application demande l'adresse du serveur
(ex. `192.168.1.20:8000`), la teste puis la mémorise.

## Compilation

```bash
cd mobile
ANDROID_HOME=<sdk> ./gradlew assembleRelease
# mobile/app/build/outputs/apk/release/app-release.apk
```
