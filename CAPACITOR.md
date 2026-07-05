# Apps iOS / Android via Capacitor

Décision (alt. à la PWA) : empaqueter l'application web existante (`web/`) en **apps natives
iOS + Android** avec **Capacitor**, pour la **présence sur les stores**, un **hors-ligne
vraiment garanti** (modèles bundlés, pas d'éviction Safari) et les **fonctions natives**.
Réutilisation ~90 % : tout `web/` (BM25, sémantique e5 + dictée Whisper en WASM, parcours,
garde-fous, permaliens, fraîcheur, UI) tourne tel quel dans le WebView.

`capacitor.config.json` (`webDir: "web"`) est en place ; Capacitor 8.4.1 + plugins installés.

## État vérifié (2026-07-03)

- ✅ **UI iOS-native (HIG, accessibilité-first).** Refonte complète `web/` : design system (mode
  clair + **sombre**), **safe areas** (`env(safe-area-inset-*)` + `viewport-fit=cover`), police
  système, **barre d'onglets** basse (Accueil / Thèmes / Aide), thèmes en **liste**, écran **Aide**
  « À propos », vue fiche à barre de retour sticky. Vérifiée au navigateur (390×844, 0 erreur) puis
  **rebuild + relance simulateur : rend parfaitement, safe areas OK**.
- ✅ **iOS : l'app COMPILE et TOURNE sur simulateur.** `cap add ios` → `cap sync ios` →
  `xcodebuild … -sdk iphonesimulator … CODE_SIGNING_ALLOWED=NO build` → **BUILD SUCCEEDED** ;
  lancée sur iPhone 17 Pro (simulateur), l'UI s'affiche correctement (bandeau non officiel, thèmes,
  « 2908 fiches · hors-ligne », dictée), **entièrement depuis les assets bundlés** (offline garanti).
  Le bouton IA est bien absent (pas de WebGPU en WebView).
- ✅ **Android : projet scaffolé** (`cap add android`). Build à faire une fois Android Studio + JDK
  installés (absents du poste).
- ✅ **Micro — RÉSOLU par plateforme** :
  - **iOS** : le WKWebView (iOS 14.3+) expose `getUserMedia` **et** `MediaRecorder` — **vérifié sur
    simulateur iOS 26** (`gUM=true, MR=true, sec=true`). La dictée iOS passe donc par le **chemin
    WebView** (même pipeline Whisper) ; pas besoin de plugin natif. (`capacitor-voice-recorder` est
    de toute façon exclu du build iOS SPM, faute de `Package.swift` — sans conséquence ici.)
  - **Android** : le WebView est souvent sans `MediaRecorder` → on utilise le **plugin natif**
    `capacitor-voice-recorder` (inclus dans le build Gradle). Même transcription Whisper des 2 côtés.
  - Enregistrement réel non testé sur simulateur (pas de micro forwardé) → à confirmer sur appareil.
- ✅ **Partage natif** : bouton « Partager » sur chaque fiche → `@capacitor/share` (officiel,
  SPM-compatible, inclus iOS+Android) avec repli Web Share / copie du lien (vérifié en web).
- ⚠️ **Taille** : le bundle embarque ~210 Mo de modèles → app ~300 Mo. OK simulateur/AAB ; pour la
  soumission, voir « Hors-ligne garanti » (ODR iOS / Play Asset Delivery).

## Prérequis (à installer)

| Cible | Outils |
|---|---|

## Prérequis (à installer)

| Cible | Outils |
|---|---|
| **iOS** | Xcode (App Store) + `xcode-select --install` + CocoaPods (`sudo gem install cocoapods` ou `brew install cocoapods`). Compte Apple Developer pour la signature/soumission. |
| **Android** | Android Studio (SDK + platform-tools). Compte Google Play Console pour la soumission. |

## Générer et ouvrir les projets natifs

```sh
# ajouter les plateformes (crée ios/ et android/ — gitignorés, régénérables)
npx cap add ios
npx cap add android

# copier web/ (dont data/, models/, vendor/) dans les projets natifs
npx cap sync

# ouvrir dans les IDE natifs pour build / run / signature
npx cap open ios       # Xcode
npx cap open android   # Android Studio
```

À chaque changement de `web/`, relancer `npx cap sync`.

## Hors-ligne garanti (le besoin n°1)

`npx cap sync` copie **tout `web/`** dans le bundle natif → le corpus (`data/`), les **poids
ML** (`models/`, ~210 Mo) et la lib (`vendor/`) sont **embarqués dans l'app** et servis par le
WebView local. Conséquences :
- Fonctionne **dès l'installation, sans réseau** ; aucune purge par le système (contrairement au
  cache PWA sur iOS).
- **Taille de l'app** : ~230 Mo. OK sur les stores (AAB Android, IPA iOS). Pour ne pas buter sur
  la limite de téléchargement cellulaire iOS (~200 Mo) ni gonfler l'install initiale :
  - **iOS** : servir les poids via **On-Demand Resources** (téléchargés au 1er usage de la
    sémantique/dictée, sur wifi) plutôt qu'en in-bundle.
  - **Android** : **Play Asset Delivery** (`install-time` ou `on-demand`).
  - Optimisation ultérieure ; pour un premier build, l'in-bundle suffit.

## Assistant IA (WebLLM) en natif

WebGPU n'est **pas** disponible dans le WebView (WKWebView / Android WebView). Le bouton
« Répondre avec l'assistant IA » est donc **automatiquement masqué** en natif (garde
`!NATIVE && ('gpu' in navigator)` dans `app.js` ; NB iOS 26 expose `navigator.gpu` sans adaptateur,
d'où la garde sur `NATIVE`). **WebLLM est auto-hébergé (D-03)** mais **inutile en natif** → après
`cap sync`, exclure ses ~290 Mo du bundle : `rm -rf ios/App/App/public/models/webllm
ios/App/App/public/vendor/web-llm` (idem Android sous `android/app/src/main/assets/public/`). Si l'IA est activée un jour (dépend de **D-02**),
la remplacer par un moteur **natif** — **MLC-LLM** (SDK iOS/Android) ou **llama.cpp** via
plugin — souvent plus rapide que WebGPU sur mobile.

## Fonctions natives

**Micro / dictée — IMPLÉMENTÉ.** Le vrai point d'intégration WKWebView est résolu : `app.js`
détecte l'app native (`window.Capacitor.isNativePlatform()`) et enregistre alors via le plugin
**`capacitor-voice-recorder`** (déjà installé) au lieu de `getUserMedia`/`MediaRecorder`. Le plugin
renvoie l'audio en base64 → converti en Blob → **même pipeline** (décodage PCM mono 16 kHz + Whisper
local) que le web. Le texte reconnu va dans le champ de recherche, **jamais auto-recherché** (garde-fou
conservé). *Vérifié en simulation (faux plugin renvoyant un WAV) : enregistrement → Whisper → champ, OK.*
- À faire au build : ajouter les permissions — iOS `NSMicrophoneUsageDescription` (Info.plist),
  Android `RECORD_AUDIO` (AndroidManifest, souvent posé par le plugin) — et **revalider la compat**
  du plugin (v7.0.6 installé avec `--legacy-peer-deps` sous Capacitor 8 ; vérifier au `cap sync`).

**Autres (à ajouter selon besoin) :**
```sh
npm i @capacitor/push-notifications @capacitor/share @capacitor/filesystem
```
- **Partage** de permaliens (`#/fiche/<id>`) via `@capacitor/share`.

## Réseau & sécurité

- Appels **geo.api.gouv.fr** et **API Annuaire** : autorisés (https, déjà dans la CSP
  `connect-src`). iOS ATS accepte https par défaut.
- La **CSP `<meta>`** de `index.html` s'applique aussi dans le WebView. Les exceptions CDN
  (esm.run/HF) ne servent qu'à WebLLM (désactivé en natif) — inertes ici.

## Publication — checklist « démonstrateur non officiel » (D-01)

Apple/Google encadrent les apps liées aux services publics :
- **Nom** sans prétention officielle ; **description** explicite « application non officielle,
  données service-public.fr / DILA (Licence Ouverte 2.0) ».
- **Aucun** insigne État (Marianne/DSFR) ni ressemblance avec service-public.fr.
- **Confidentialité** : étiquette **« aucune donnée collectée »** (traitement 100 % local) — à
  déclarer (App Privacy / Data safety). Atout en revue.
- Prévoir un lien visible vers le **site officiel** (déjà dans l'app : bandeau + pied de page).

## Ce qui est réutilisé vs. natif

| Réutilisé tel quel (WebView) | Spécifique natif |
|---|---|
| BM25, sémantique e5 + Whisper (WASM), parcours/arbre, garde-fous, permaliens, fraîcheur, UI, CSP | plugins (push/share/fs), recorder micro, bundling des modèles (ODR/Asset Delivery), signature/soumission, (option) LLM natif |
