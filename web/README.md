---
title: Démarches (démonstrateur)
emoji: 🗂️
colorFrom: green
colorTo: gray
sdk: static
pinned: false
license: mit
short_description: Démarches administratives hors-ligne (démo non officielle)
---

> **Démonstrateur indépendant — ce n'est pas le site officiel service-public.fr.** Assistant
> pour trouver, comprendre et préparer ses démarches administratives, **100 % dans le
> navigateur** : recherche BM25 + sémantique, dictée Whisper, explications par un **LLM local en
> WebGPU** (Gemma 3, avec **conversation de suivi**) et **simulateur d'aides sociales « Mes
> aides »**. La recherche avancée et l'assistant se chargent au démarrage ; la recherche de base
> est utilisable **immédiatement**. WebGPU (Chrome/Edge récents) requis pour l'assistant IA.
> **Aucune donnée ne quitte l'appareil.**

# PWA — Démarches service-public (prototype, tout côté client)

Application web **100 % statique**, sans serveur applicatif : recherche dans les 2 908 fiches,
lecture, et **déroulé guidé d'une démarche** (questionnaire → pièces du cas → téléservices à
garde-fou → guichet réel via l'API Annuaire). Installable (PWA) et utilisable **hors-ligne**.

## Lancer

```sh
python3 scripts/build_web.py                    # exporte web/data/ (fiches + skills)
npm i && node scripts/build_embeddings.mjs      # (optionnel) vecteurs sémantiques -> web/data/embeddings.bin
python3 -m http.server 8765 --directory web     # sert l'app
# ouvrir http://localhost:8765
```

## Ce qui marche

- **Recherche** : BM25 en JavaScript pur sur `data/fiches.json` (hors-ligne, ~instantané).
- **Recherche sémantique** (optionnelle, case à cocher) : encodeur `multilingual-e5-small` en
  **WASM** dans le navigateur (**sans GPU**), vecteurs des fiches précalculés au build
  (`data/embeddings.bin`, 4,5 Mo), fusionnés au BM25 par RRF. Trouve les reformulations
  (« je vais avoir un bébé » → grossesse, Paje, congé maternité, déclaration de naissance…).
- **Démarche guidée** : reprend la logique de `scripts/agent.py` côté navigateur —
  parcours séquentiel de l'arbre de décision, **pièces scopées au cas choisi**.
- **Garde-fou** : ouvrir un téléservice demande une **confirmation explicite** ; l'app ne soumet
  jamais rien à la place de l'usager.
- **Où s'adresser** : appel **en direct** à `geo.api.gouv.fr` + API Annuaire (DILA) — CORS OK,
  adresse / téléphone / horaires réels de la mairie.
- **PWA** : `manifest.webmanifest` + `sw.js` (réseau d'abord, repli cache → hors-ligne après 1re visite).
- **Voix — écoute (TTS)** : un bouton **« 🔊 Écouter »** apparaît sur le résumé d'une fiche et sur une
  réponse IA générée ; lit le texte à voix haute avec `speechSynthesis` (Web Speech API, **natif au
  navigateur, aucun téléchargement**). Choisit automatiquement une voix française (`fr-*`, de
  préférence locale) ; découpe le texte en phrases pour éviter le bug de coupure des longs énoncés
  sur Chrome ; le bouton devient **« ⏸ Arrêter »** pendant la lecture (clic = stop, fin de lecture =
  retour automatique à l'état initial). Sans API disponible, le bouton n'apparaît simplement pas.
- **Voix — dictée (ASR)** : un bouton **« 🎤 Dicter ma question »** à côté de la recherche démarre
  l'enregistrement du micro, puis transcrit hors-ligne avec **Whisper local** (`Xenova/whisper-base`,
  WASM, via Transformers.js — même mécanisme que la recherche sémantique, chargé à la demande au
  premier usage, ~145 Mo). Le texte reconnu est déposé **dans le champ de recherche, visible et
  modifiable** — aucune recherche n'est lancée automatiquement, l'usager vérifie/corrige avant de
  valider (même logique de garde-fou que la confirmation avant ouverture d'un téléservice).
  Messages clairs si le micro est refusé, absent, ou si le navigateur n'est pas en contexte sécurisé
  (HTTPS/localhost requis) ; le micro est toujours libéré dès la fin de l'enregistrement.
  **Piège découvert en QA :** la version « latest » de `@huggingface/transformers` (4.1.0/4.2.0)
  échoue de façon déterministe à créer un pipeline ASR (Whisper, wasm) — erreur onnxruntime-web sur
  le poids partagé `embed_tokens` du décodeur (« Missing required scale »), reproduite sur
  whisper-tiny et whisper-base, avec ou sans `dtype`. L'app épingle donc `@3.8.1` (dernière 3.x) pour
  les deux imports CDN (ASR et encodeur sémantique), avec une nouvelle tentative automatique en cas
  d'échec transitoire au chargement à froid.

## Fichiers

> **Dépendances & auto-hébergement (F-01 / D-03 — terminé) :** le *noyau* (BM25, fiches,
> démarches, annuaire) n'a **ni framework ni build** et aucune dépendance runtime. La **recherche
> sémantique**, la **dictée Whisper** **et l'assistant WebLLM** sont **auto-hébergés** : libs
> (Transformers.js, WebLLM), runtimes WASM et poids (e5, Whisper, Gemma 3 1B, Qwen 0.5B) servis
> par notre origine (`web/vendor/`, `web/models/`), **0 requête ML tierce au runtime** (vérifié).
> Régénérer le vendoring : `npm i @huggingface/transformers@3.8.1 && node scripts/fetch_vendor.mjs`
> puis `node scripts/fetch_webllm.mjs` (poids sous `web/models/`, gitignoré).

```
web/
  index.html · style.css · app.js     # noyau : aucune dépendance, aucun build
  manifest.webmanifest · sw.js · icon.svg
  data/  (généré par build_web.py)
    fiches.json          # index de recherche {schema,count,fiches[]} avec date_verification
    themes.json
    data-manifest.json   # hash + taille de chaque fichier (fraîcheur / invalidation — R1.1/R1.3)
    embeddings.bin + .meta.json   # vecteurs e5 précalculés (recherche sémantique)
    skills/<id>.json     # 1 parcours/fiche, chargé à la demande (~61 Mo au total)
```

**Fraîcheur (R1.2) :** chaque fiche affiche « Vérifié le JJ/MM/AAAA » ; un bandeau alerte si le
corpus local dépasse 30 jours. **Permaliens (R3.1) :** `#/fiche/<id>`, `#/theme/<slug>`,
`#/q/<texte>` (partageables, bouton retour cohérent).

📄 **Toutes les captures des nouvelles fonctionnalités en un seul document :**
[fonctionnalites.pdf](https://alcrawfo-agent-administratif.static.hf.space/screenshots/fonctionnalites.pdf)

## Assistant IA local (WebLLM) — auto-hébergé, avec conversation de suivi

Sur une recherche (« Répondre avec l'assistant IA ») ou depuis une fiche (« Demander des
explications à l'assistant »), un **LLM tourne en WebGPU dans la page** — **Gemma 3 1B** par
défaut (~600 Mo, une seule fois puis en cache), **entièrement servi par cette origine**
(lib, runtime WASM et poids sous `vendor/` et `models/` : **0 requête tierce au runtime**).
La réponse est **ancrée sur la fiche officielle** : citation verbatim du passage le plus proche
(encodeur e5) + **vérification de cohérence** par une 2ᵉ passe du modèle (badge « ✓ cohérent » /
« ⚠ écart possible »). Les skills déterministes restent la voie d'action.

### Choix du modèle : Gemma 3 ↔ modèle léger

Dès le chargement, un lien **« modèle plus léger »** permet de basculer sur **Qwen 2.5 0.5B**
(~290 Mo, plus rapide) si l'appareil rame — et inversement (« Revenir à Gemma ») depuis le panneau
IA. Bascule **automatique** vers le léger si Gemma ne tient pas en mémoire GPU. Les paramètres de
génération sont durcis contre les **boucles de répétition** des petits modèles
(`frequency/presence_penalty`, température non nulle, plafond de tokens).

<img src="https://alcrawfo-agent-administratif.static.hf.space/screenshots/choix-modele.png" alt="Bandeau de chargement de l'assistant avec lien « modèle plus léger »" width="380">

### Conversation de suivi

Après une première explication, l'usager peut **poser des questions complémentaires** (« et si je
suis mineur ? », « combien de temps ? »…) : l'historique est conservé, la fiche officielle reste
dans le contexte à chaque tour, et **chaque réponse de suivi est vérifiée** (citation + badge)
comme la première.

<img src="https://alcrawfo-agent-administratif.static.hf.space/screenshots/assistant-suivi.png" alt="Explication de l'assistant puis question complémentaire en bulles de conversation" width="380">

- **Dégradation propre** : sans WebGPU (ou sans GPU compatible), un message clair s'affiche
  et l'app continue de fonctionner (recherche + démarches) sans modèle.

## « Mes aides » — simulateur local de prestations sociales

Un onglet dédié estime l'éligibilité **indicative** à 8 prestations (RSA, prime d'activité, aides
au logement, AAH, ASPA, allocations familiales, ARS, Complémentaire santé solidaire), **calculée
sur l'appareil, rien n'est transmis**. Le questionnaire est **adaptatif et minimise les données** :
une question à la fois, posée **uniquement si une aide encore indécise en a besoin** — un
propriétaire voit les aides au logement écartées à la 2ᵉ question sans donner ses revenus ; l'âge
est demandé en tranches ; la résidence en France n'est demandée que si un droit est presque ouvert.
Les aides « déjà estimées » s'affichent au fil de l'eau ; le résultat final classe les aides
(droit probable / à vérifier / peu probable) avec, pour chacune, la **fiche locale**, le
**simulateur officiel** (caf.fr, mesdroitssociaux.gouv.fr) et l'organisme compétent. Seuils
indicatifs datés (avril 2025) et avertissement : l'estimation **ne vaut pas décision**.

<p>
<img src="https://alcrawfo-agent-administratif.static.hf.space/screenshots/mes-aides-question.png" alt="Questionnaire adaptatif Mes aides : une question à la fois, aides déjà estimées au fil de l'eau" width="380">
<img src="https://alcrawfo-agent-administratif.static.hf.space/screenshots/mes-aides-resultat.png" alt="Résultat indicatif Mes aides : cartes par prestation avec badge et liens officiels" width="380">
</p>

## Application native iOS (Capacitor) — IA Apple sur l'appareil

Le même code web est empaqueté en **app iOS** (Capacitor). En natif, l'assistant IA passe par
**FoundationModels (Apple Intelligence, iOS 26+)** via un petit plugin Swift — mêmes explications
et même conversation de suivi, générées **sur l'iPhone** ; les poids WebLLM sont exclus du bundle
(inutiles sans WebGPU en WKWebView). Recherche sémantique et dictée Whisper restent embarquées
(~210 Mo). Vérifié sur simulateur iPhone 17 Pro (iOS 26.5).

<img src="https://alcrawfo-agent-administratif.static.hf.space/screenshots/ios-natif.png" alt="App iOS native : bandeau « Assistant IA sur l'appareil : prêt » et onglet Mes aides" width="380">

Suite : **déduction du cas** par le LLM (pré-remplir le questionnaire depuis la phrase initiale).

Pour un vrai déploiement : sharder/compresser `data/skills/` (ou les servir à la demande comme ici),
ajouter de vraies icônes PNG, et héberger en statique (les API gouv. sont appelées côté client).
