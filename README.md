<p align="center"><img src="brand/banniere.svg" alt="Mon agent administratif — trouver, comprendre et préparer ses démarches, 100 % sur votre appareil" width="900"></p>

# Mon agent administratif — démarches comprises, préparées, 100 % sur l'appareil

**Démonstrateur indépendant (non officiel)** issu du hackathon 2026 : un assistant qui aide à
**trouver, comprendre et préparer** ses démarches administratives à partir des fiches « Vos
droits » de service-public.fr (DILA) — entièrement **hors-ligne**, **sans collecte de données**,
avec **IA locale** (navigateur WebGPU ou Apple Intelligence en natif).

- **Démo en ligne** : <https://alcrawfo-agent-administratif.static.hf.space/index.html>
- **Présentation du défi** : [`presentation/`](presentation/) — [diapositives (PDF)](presentation/diapositives.pdf) · [description du défi](presentation/DEFI.md)
- **Captures des fonctionnalités** : [PDF](https://alcrawfo-agent-administratif.static.hf.space/screenshots/fonctionnalites.pdf)

Principes non négociables : l'app **n'agit jamais à la place de l'usager** (ouverture d'un
téléservice = confirmation explicite), **rien ne quitte l'appareil** (recherche, IA, simulateur
d'aides : tout est local), et l'IA **n'invente pas** (réponses ancrées sur la fiche officielle,
citées et vérifiées).

---

## Les briques logicielles

### 1. Pipeline de données (Python, sans dépendances lourdes) — `scripts/`

Transforme le jeu ouvert **« Fiches pratiques Particuliers » de la DILA** (XML, schéma 3.5,
2 908 fiches, Licence Ouverte 2.0) en artefacts exploitables côté client :

| Script | Produit |
|---|---|
| `build_skills.py` | 1 **parcours structuré** par fiche (`web/data/skills/<id>.json`) : arbre de décisions/étapes, pièces à fournir scopées par cas, téléservices (deep-links officiels), guichets |
| `build_web.py` | `web/data/` : index de recherche `fiches.json`, `themes.json`, manifeste de fraîcheur (hash + date de vérification par fiche) |
| `build_embeddings.mjs` | `embeddings.bin` : vecteurs **multilingual-e5-small** précalculés des 2 908 fiches (4,5 Mo) |
| `build_wiki.py`, `build_all.py` | wiki markdown navigable + orchestration complète |
| `fetch_vendor.mjs`, `fetch_webllm.mjs`, `fetch_cerfa.mjs` | vendoring : Transformers.js + runtime ORT WASM + poids e5/Whisper (~210 Mo), lib WebLLM + poids Gemma/Qwen (~860 Mo), formulaires CERFA |

Détail du format source et du mapping XML → JSON : [`docs/PIPELINE-DONNEES.md`](docs/PIPELINE-DONNEES.md).

```sh
curl -L -o data/vosdroits-latest.zip https://lecomarquage.service-public.gouv.fr/vdd/3.5/part/zip/vosdroits-latest.zip
python3 scripts/build_all.py           # extraction + skills + web/data + wiki
npm i && node scripts/build_embeddings.mjs
node scripts/fetch_vendor.mjs && node scripts/fetch_webllm.mjs   # modèles auto-hébergés
python3 -m http.server 8765 --directory web
```

### 2. Application web PWA (vanilla JS, zéro framework, zéro build) — `web/`

`index.html + app.js + style.css` : aucune dépendance runtime pour le noyau.

- **Recherche hybride** : BM25 en JS pur + **sémantique e5** (Transformers.js en WASM, sans GPU),
  fusion RRF — « je vais avoir un bébé » trouve grossesse/Paje/congé maternité.
- **Reformulation validée** : demande floue ou hors-domaine → l'app propose des démarches précises
  **à valider par l'usager** (jamais de devinette silencieuse).
- **Déroulé pas à pas** : parcours de l'arbre de décisions de la fiche, pièces filtrées selon le
  cas, guichet réel via `geo.api.gouv.fr` + API Annuaire (seuls appels réseau, explicites). Les
  **questions équivalentes ne sont posées qu'une fois** (les fiches DILA répètent p. ex. Caf/MSA
  jusqu'à 6 fois : signature de décision insensible à la formulation, réponse mémorisée).
- **Voix** : dictée **Whisper local** (WASM, texte déposé dans le champ, jamais lancé tout seul) ;
  lecture à voix haute (Web Speech API).
- **PWA hors-ligne** : service worker réseau-d'abord, corpus embarqué, fraîcheur affichée par fiche.
- **Sécurité** : CSP stricte (`connect-src` limité à l'origine + APIs gouv + HF), échappement
  systématique, aucune analytique.

### 3. IA locale (WebLLM / WebGPU) — `web/app.js` + `web/models/`

- **Modèles** : **Gemma 3 1B** (q4f16, ~600 Mo) par défaut, **Qwen 2.5 0.5B** (~290 Mo) en
  « modèle léger » — lien de bascule dès le chargement, retour possible, **repli automatique** si
  la mémoire GPU ne suit pas. Anti-**boucles de répétition** des petits modèles :
  `frequency/presence_penalty`, température non nulle, plafond de tokens (`GEN_OPTS`).
- **Ancrage anti-hallucination** : réponse générée **uniquement** depuis la fiche ; le code (pas le
  modèle) produit la **citation verbatim** du passage le plus proche (cosinus e5) ; une **2ᵉ passe
  juge** la fidélité (badge « ✓ cohérent » / « ⚠ écart possible »).
- **Conversation de suivi** : questions complémentaires avec historique ; la fiche reste dans le
  contexte (troncature qui préserve système + 1ᵉʳ échange) ; chaque tour est re-vérifié.
- **Auto-hébergement (D-03)** : lib, WASM et poids servis par notre origine — 0 requête ML tierce.
  Sur le Space Hugging Face (quota 1 Go), une **sonde** bascule Gemma vers un repo modèle HF à nous
  ([alcrawfo/gemma3-1b-it-q4f16_1-MLC-web](https://huggingface.co/alcrawfo/gemma3-1b-it-q4f16_1-MLC-web)) ; en local/natif, tout reste sur l'origine.

### 4. Simulateur « Mes aides » (moteur de règles local, seuils OpenFisca) — `web/simu.js`

Éligibilité **indicative** à 8 prestations (RSA, prime d'activité, APL/ALS/ALF, AAH, ASPA,
allocations familiales, ARS, CSS), sans réseau. **Minimisation des données** : chaque règle
s'évalue sur des réponses partielles et déclare ce qui lui manque (`{need:[champs]}`) ; le
questionnaire ne pose une question **que si une aide encore indécise en a besoin** (propriétaire →
aides au logement tranchées à la 2ᵉ question, sans les revenus ; âge en tranches ; résidence
demandée seulement si un droit est plausible). Verdicts prudents (probable / à vérifier / peu
probable), renvoi systématique vers les simulateurs officiels.

**Les seuils sont calculés par [OpenFisca-France](https://github.com/openfisca/openfisca-france)**
(le moteur officiel des règles socio-fiscales) via `scripts/build_simu_bareme.py` →
`web/simu-bareme.js`, daté et traçable : montants forfaitaires **RSA exacts** par composition de
foyer (variables `rsa_socle` / `rsa_socle_majore`, majoration parent isolé comprise), **frontières
réelles d'annulation de la prime d'activité** (cas-types **vectorisés** — N foyers répliqués en une
simulation, technique [QuelImpact](https://github.com/theosorus/QuelImpact)), plafonds
ASPA/AAH/CSS/ARS lus dans les paramètres officiels avec leurs échelles de foyer exactes. Le
simulateur reste 100 % local : OpenFisca tourne **au build**, pas chez l'usager. Effet mesuré : la
frontière réelle de la prime d'activité (2 600 €/mois, célibataire) détecte des droits que
l'approximation « 1,5 SMIC » ratait. Un serveur **MCP OpenFisca**
([LexImpact](https://git.leximpact.dev/leximpact/exploration/openfisca-france-python-mcp)) est
référencé dans `.mcp.json` comme oracle de développement (calculs de cas-types, paramètres,
recettes).

**2ᵉ étage — montants exacts (`web/oracle.js`)** : après le tri local, l'usager peut demander les
**montants précis** à un **oracle OpenFisca hébergé** — l'API Web officielle (`openfisca serve`)
dans un Space docker dédié ([alcrawfo/openfisca-oracle](https://huggingface.co/spaces/alcrawfo/openfisca-oracle)),
sans état, AGPL. Contrat de confidentialité tenu par construction : le calcul exact n'a lieu
qu'après **consentement explicite** (« j'accepte l'envoi anonyme »), seul un **cas-type chiffré**
part (composition du foyer, tranche d'âge, revenus — jamais l'identité ni le coffre) ; refus =
rien ne quitte l'appareil et le tri local reste. Pour l'aide au logement, deux entrées ciblées
(loyer + commune, zone résolue via geo.api.gouv.fr) suffisent à obtenir le montant mensuel exact —
le calcul que le tri local ne peut pas faire. L'oracle affine aussi le tri : une CSS « peu
probable » localement peut se révéler accessible avec participation, chiffrée au euro près.

**Coffre → oracle** : les valeurs **certifiées** du coffre 2D-Doc alimentent le calcul exact,
**case par case** (salaire brut d'un bulletin scanné, commune d'un justificatif de domicile —
résolue en code commune) ; seules ces valeurs chiffrées partent, jamais le nom ni l'adresse.

**Simulateur ciblé chômage (ARE) — `web/chomage.js`, 100 % local** : OpenFisca ne modélise pas le
calcul SJR→ARE (l'allocation journalière y est une entrée) ; les règles **Unédic du 01/07/2025**
sont donc codées en clair et datées (SJR réforme 2021 avec plafonnement des jours non travaillés,
40,4 % + partie fixe vs 57 %, plancher/plafond, **dégressivité** hauts revenus, durée avec
coefficient contracyclique ×0,75 et bornes d'âge 53/55 ans). 4 à 6 questions, salaire brut
**pré-remplissable depuis un bulletin certifié du coffre**, verdict + allocation journalière/
mensuelle brute + durée, renvoi France Travail. Accessible via `#/chomage` et depuis les
résultats de « Mes aides ».

### 5. « Mon coffre » : scan 2D-Doc et données certifiées — `web/coffre.js`

Le **« Dites-le-nous une fois » inversé** : l'usager scanne le code **2D-Doc** (DataMatrix signé,
standard ANTS) imprimé sur ses documents officiels — avis d'imposition, justificatifs de domicile,
attestations. L'app décode (ZXing vendorisé), parse le format (en-tête v2/v3/v4, champs GS/RS/US —
dictionnaire de 241 champs généré depuis les spécifications via
[betagouv/2ddoc-parser](https://github.com/betagouv/2ddoc-parser)), et **vérifie la signature
ECDSA hors-ligne** (WebCrypto, format r‖s natif) contre les **clés publiques des émetteurs**
embarquées (~2 700 clés extraites de la TSL ANTS + annuaires d'AC par
`scripts/fetch_2ddoc_keys.py`). Verdicts honnêtes : *authenticité vérifiée / émetteur inconnu /
signature invalide — document suspect*. Les données certifiées (revenu fiscal de référence,
identité, adresse) sont stockées localement et **pré-remplissent « Mes aides »** (« Utiliser mon
avis d'imposition scanné : ≈ 5 267 €/mois, RFR ÷ 12 ») — zéro double saisie, zéro transmission.
Un spécimen officiel est intégré pour essayer sans document réel.

### 6. Applications natives (Capacitor) — `ios/`, `android/`, `CAPACITOR.md`

Même code web empaqueté ; corpus + modèles e5/Whisper **embarqués** (hors-ligne garanti, pas
d'éviction de cache navigateur). En iOS, l'assistant passe par **FoundationModels (Apple
Intelligence, iOS 26+)** via [`NativeLLMPlugin.swift`](ios/App/App/NativeLLMPlugin.swift)
(~60 lignes : `available()` / `generate(system, prompt)`) — les poids WebLLM sont exclus du bundle
(pas de WebGPU exploitable en WKWebView). Le projet Xcode/Gradle se régénère (`npx cap add ios`),
seules nos sources Swift sont versionnées. Vérifié sur simulateur iPhone 17 Pro (iOS 26.5).

### 7. Déploiement

- **Space HF statique** [alcrawfo/agent-administratif](https://huggingface.co/spaces/alcrawfo/agent-administratif) :
  contenu de `web/` à la racine, publié par `huggingface_hub.upload_folder` (pas de CI).
- **Repo modèle HF** pour les poids Gemma (au-delà du quota Space).

---

## Arborescence

```
brand/           identité visuelle : logo (diamant-loupe), logotype, bannière (SVG)
presentation/    diapositives du hackathon (PNG, PDF, HTML autonome) + DEFI.md + images sources
scripts/         pipeline données + vendoring modèles
web/             PWA complète (app.js, simu.js, sw.js, README du Space)
  data/          (généré) index + skills        [gitignoré]
  models/        (téléchargé) e5, Whisper, LLM  [gitignoré]
  vendor/        (téléchargé) libs JS/WASM      [gitignoré]
ios/App/App/     NativeLLMPlugin.swift & co (le reste du projet iOS se régénère)
docs/            PIPELINE-DONNEES.md (format DILA, mapping XML→JSON)
wiki/ skills/ index/   (générés)                [gitignorés]
```

## Licences & attribution

Code sous licence MIT ([LICENSE](LICENSE)). Données : **« Fiches pratiques Particuliers »,
Service-Public.gouv.fr / DILA**, Licence Ouverte 2.0 — attribution obligatoire, jeu téléchargé
depuis data.gouv.fr (voir [`docs/PIPELINE-DONNEES.md`](docs/PIPELINE-DONNEES.md)). Modèles :
Gemma (Google, licence Gemma), Qwen (Alibaba, Apache 2.0), multilingual-e5-small (MIT),
Whisper (OpenAI, MIT), via MLC/WebLLM et Transformers.js. **Ce démonstrateur n'est pas le site
officiel service-public.fr.**
