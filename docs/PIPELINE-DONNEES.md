# Wiki service-public.fr pour assistant LLM local

Transforme le jeu de données **Fiches pratiques service-public.fr (Particuliers, DILA)**
en deux artefacts complémentaires destinés à un **petit LLM local** :

1. un **wiki Markdown** (1 page propre par fiche, liens croisés, métadonnées) — le « territoire » ;
2. une **carte / index** (arbre thématique + résumés) — la « carte » que le modèle parcourt d'abord.

Le modèle filtre via la carte → ouvre la ou les bonnes fiches → répond en citant l'ID + le lien officiel.

## Décisions arbitrées (PRD §11)

- **D-01 — Positionnement : démonstrateur indépendant (non officiel).** DSFR/Marianne interdits ;
  bandeau permanent « ce n'est pas le site officiel » + charte volontairement distincte (accent teal,
  pas de bleu France) pour écarter toute confusion avec service-public.fr. *(Implémenté.)*
- **D-03 — Chaîne d'approvisionnement : auto-hébergement intégral.** *(En cours — couche
  Transformers.js FAITE.)* La **recherche sémantique (e5)** et la **dictée (Whisper)** sont
  auto-hébergées (`scripts/fetch_vendor.mjs` place lib + runtime ORT + poids sous `web/vendor/` et
  `web/models/`) : **0 requête ML tierce au runtime**, vérifié en navigateur ; CSP posée (`<meta>` +
  `web/_headers`). **Reste** : WebLLM (assistant IA optionnel, GPU) encore via CDN → à auto-héberger.
- **D-05 — Licence du code : la plus ouverte possible → MIT** (permissive ; 0BSD/CC0 possibles si
  attribution non souhaitée). Le corpus de données reste sous Licence Ouverte 2.0 (attribution DILA). *(Implémenté — voir [LICENSE](LICENSE).)*

## Source & licence

- Jeu de données : `vosdroits-latest.zip` (audience Particuliers), schéma **3.5**, mis à jour quotidiennement.
  - Données : <https://lecomarquage.service-public.gouv.fr/vdd/3.5/part/zip/vosdroits-latest.zip>
  - Schéma : <https://echanges.dila.gouv.fr/OPENDATA/SERVICE-PUBLIC_DTD/schema_3.5.zip>
  - Fiche data.gouv.fr : <https://www.data.gouv.fr/datasets/fiches-pratiques-et-ressources-de-service-public-gouv-fr-particuliers>
- **Licence Ouverte v2.0** — attribution obligatoire « Service-Public.gouv.fr / DILA » + URL + fichier + date
  (intégrée en pied de chaque page wiki).

## Structure de la source (constatée)

L'archive contient 5 536 fichiers (~140 Mo décompressés) :

| Préfixe | Nombre | Contenu |
|---|---|---|
| `F####.xml` | ~2 999 | fiches (information, question-réponse, comment faire si…) |
| `R####.xml` | ~2 285 | ressources (téléservices, formulaires Cerfa, modèles, glossaire…) |
| `N####.xml` | ~243 | nœuds de navigation (thèmes, sous-thèmes, dossiers) |
| index | — | `arborescence.xml` (arbre complet), `idxDateModifImp.xml` (dates de modif), `menu.xml`, `servicesEnLigne.xml`, `redirections.xml`… |

**11 thèmes de premier niveau** (attribut `ID` du nœud) :

| ID | Thème |
|---|---|
| `N19810` | Papiers - Citoyenneté - Élections |
| `N19805` | Famille - Scolarité |
| `N19811` | Social - Santé |
| `N19806` | Travail - Formation |
| `N19808` | Logement |
| `N19812` | Transports - Mobilité |
| `N19803` | Argent - Impôts - Consommation |
| `N19807` | Justice |
| `N19804` | Étranger - Europe |
| `N19809` | Loisirs - Sports - Culture |
| `N31931` | Associations, fondations et fonds de dotation |

Chaque fiche est un `<Publication>` : métadonnées Dublin Core (`dc:title`, `dc:description` = résumé,
`spUrl` = URL officielle…), un `FilDAriane` (fil d'Ariane), du contenu structuré
(`Introduction`, `Texte`, `Chapitre`, `ListeSituations`/`Situation` pour les variantes,
`BlocCas`/`Cas` pour les branches conditionnelles), et des agrégats
(`ServiceEnLigne`, `Reference`, `PourEnSavoirPlus`, `OuSAdresser`). Les liens entre fiches sont
des `LienInterne LienPublication="F####"`.

## Régénérer

```sh
# 1. Télécharger (déjà fait ; à refaire pour rafraîchir — MAJ quotidienne)
curl -L -o data/vosdroits-latest.zip https://lecomarquage.service-public.gouv.fr/vdd/3.5/part/zip/vosdroits-latest.zip
unzip -q -o data/vosdroits-latest.zip -d data/extract

# 2. Construire TOUT le corpus Particuliers (11 thèmes) : wiki + skills + index global
python3 scripts/build_all.py

#    …ou un seul thème (défaut = N19810 Papiers-Citoyenneté)
python3 scripts/build_wiki.py N19808     # Logement, etc.
```

## Sortie

```
wiki/
  INDEX.md                         # accueil : 11 thèmes -> SOMMAIRE de chacun
  <theme>/
    SOMMAIRE.md                    # la « carte » lisible du thème : arbre + résumés + liens
    F1372.md, F21091.md, …         # 1 page Markdown par fiche (front-matter + liens [..](F####.md))
index/
  fiches.jsonl                     # TOUTES les fiches (1/ligne, dédoublonnées) — recherche / RAG
  themes.json                      # méta des 11 thèmes (id, titre, slug, nombre de fiches)
  <theme>.carte.json               # arbre + fiches d'un thème
```

Corpus actuel — **Particuliers, 11 thèmes, 2 908 fiches uniques** (Travail 628, Argent 387,
Famille 380, Logement 339, Social-Santé 267, Justice 232, Transports 206, Papiers 194,
Étranger-Europe 170, Associations 90, Loisirs 68). Les fiches transversales (« Comment faire si »,
inter-thèmes) sont dédoublonnées dans l'index global.

## Stratégie de mise à jour

Les données changent **chaque jour**. Re-télécharger `vosdroits-latest.zip` et relancer.
Pour de l'incrémental, comparer `idxDateModifImp.xml` (ou l'attribut `dateDeModification` de
l'arborescence) entre deux exécutions et ne régénérer que les fiches modifiées.

## Assistant (couche LLM) — `scripts/assistant.py`

100 % local, dépendances `requests` + `numpy` + **Ollama** (modèles `qwen3:0.6b` pour la
génération, `nomic-embed-text:v1.5` pour les embeddings).

1. **Localiser** : recherche **hybride** sur la carte — BM25 (lexical, pur Python) + sémantique
   (embeddings locaux), fusionnés par RRF → fiches candidates.
2. **Lire** : on charge la/les page(s) `wiki/.../F####.md` **entières** (jamais des fragments).
3. **Répondre** : le LLM répond ancré sur les fiches, montre les **branches** (`Cas`/`Situation`),
   dit « non couvert » sinon, et la **citation (ID + URL officielle) est générée par le code**
   (fiable même si un petit modèle bavarde).

```sh
python3 scripts/assistant.py --rebuild-embeddings ""          # 1re fois : cache d'embeddings
python3 scripts/assistant.py "j'ai perdu mon passeport, que faire ?"
python3 scripts/assistant.py --search-only "voter après un déménagement"   # recherche seule
python3 scripts/assistant.py --bm25-only "carte d'identité périmée"        # sans embeddings
```

### Limites constatées & pistes

- **Recherche** : très bonne sur des intentions claires (passeport perdu, vote/déménagement).
  Pour les cas ambigus, ajouter une étape de **re-rank par le LLM** (choisir parmi les candidats)
  améliorerait la précision.
- **Modèle** : `qwen3:0.6b` structure bien mais déforme parfois des détails de surface
  (nom de la source, URL inventée dans un refus). Passer à un **petit modèle un cran au-dessus**
  (`qwen3:1.7b`/`4b`, `llama3.2:3b`) fiabilise nettement, en restant local. L'architecture ne change pas.
- **Dossiers inter-thèmes** : « Carte grise », « Permis de conduire » apparaissent sous Papiers mais
  leurs fiches sont rattachées à *Transports-Mobilité*. Elles seront générées avec ce thème — sur le
  corpus complet, chaque fiche existe une fois. Pour un silo mono-thème auto-suffisant, ajouter une
  option d'**expansion des dossiers inter-thèmes**.
- **Coordonnées locales** : les blocs « Où s'adresser » pointent vers l'annuaire ; pour des adresses
  réelles, brancher l'[API Annuaire de l'administration](https://www.data.gouv.fr/dataservices/api-annuaire-de-ladministration-et-des-services-publics).

## Skills — procédures exécutables (`scripts/build_skills.py`)

Chaque fiche est aussi convertie en **skill** : une procédure structurée que le LLM suit, plus un
**plan d'agent** dont chaque étape est `auto` (lecture/préparation, sûr) ou `confirmation`
(action → validation humaine obligatoire).

```
skills/<slug>/
  F1427.json       # canonique : resume, pieces, services_en_ligne (URL + action), ou_sadresser,
                   #             references, procedure (arbre des cas/étapes), plan_agent
  F1427.SKILL.md   # version lisible suivie pas à pas par le LLM
```

194 skills (thème Papiers), dont 142 avec démarche en ligne. Le plan d'agent enchaîne :
`auto` → `evaluer_cas`, `rassembler_pieces`, `trouver_guichet` (annuaire) ; puis
`confirmation` → `ouvrir_teleservice` (deep-link officiel, ex. `?action=NAISSANCE`), `soumettre`.

**Limites honnêtes :**
- L'extraction des **pièces** est heuristique, désormais **filtrée** (on écarte délais, durées,
  prix, renvois « à la mairie ») *et* **scopée au cas choisi** : au build, chaque liste de pièces est
  marquée (`pieces:true`) dans l'arbre de décision ; à l'exécution l'agent ne collecte que les pièces
  des branches retenues (ex. passeport *France* = 5 pièces vs 18 agrégées ; passeport *à l'étranger*
  = pièces consulaires : Numic, Registre des Français…). Upgrade LLM optionnel via
  [scripts/enrich_pieces.py](scripts/enrich_pieces.py) (ré-extraction en **sortie JSON contrainte**),
  efficace avec un « professeur » costaud — mais en local **qwen3:4b est trop lent pour un batch**
  (~4 min/fiche, timeouts) ; à réserver à une machine rapide, au cloud, ou à un run de nuit.
- Les fiches donnent l'URL officielle (souvent deep-linkée) mais **pas le schéma des champs** de
  chaque téléservice → l'agent *ouvre et prépare*, l'usager *remplit et soumet*. L'auto-remplissage
  complet exigerait une intégration par démarche (FranceConnect + API/schéma de chaque téléservice),
  hors périmètre du dataset. C'est aussi le bon choix de sûreté (voir le garde-fou « validation humaine »).

### Agent sur une démarche — `scripts/agent.py`

Boucle **pilotée par la skill** : le code enchaîne les étapes `auto` et **s'arrête à chaque étape
`confirmation`** — l'agent n'ouvre rien et ne soumet jamais sans accord explicite.

```sh
python3 scripts/agent.py --skill F1427 --commune Pantin                       # pose les questions du cas
python3 scripts/agent.py --skill F1427 --reponses "France,propre" --commune Lyon   # réponses pré-remplies
python3 scripts/agent.py --skill F1427 --reponses "étranger,propre" --confirmer    # autre cas, actions validées
python3 scripts/agent.py "j'ai besoin d'un acte de naissance"                  # skill trouvée par la recherche
```

Sur la démarche acte de naissance (F1427) :
- `evaluer_cas` **pose les questions du cas** une par une (Né en France/étranger → propre/autrui → sur place/courrier…), retient la situation ; `--reponses` pré-remplit ou script (réponses aussi acceptées sur l'entrée standard) ;
- `trouver_guichet` interroge **en direct l'API Annuaire de l'administration** ([scripts/annuaire.py](scripts/annuaire.py)) : commune → INSEE (`geo.api.gouv.fr`) → mairie réelle avec **adresse, téléphone, horaires** (ex. *Mairie - Pantin, 84-88 av. du Général-Leclerc, 01 49 15 40 00*). Nuance Paris/Lyon/Marseille : les mairies d'arrondissement ont leur propre code INSEE ;
- `ouvrir_teleservice` propose le **deep-link officiel adapté au cas** (`?action=NAISSANCE`, France vs étranger) ;
- `soumettre` reste toujours à la main de l'usager.

Réel aujourd'hui : **questionnaire du cas posé à l'usager** (`evaluer_cas`), **pièces scopées au cas
choisi**, résolution de commune + **fiche mairie réelle via l'API Annuaire** (adresse, téléphone,
horaires), deep-links officiels, mapping cas→téléservice, garde-fou humain.
Encore à venir : option « déduction du cas par le LLM » (pré-répondre les questions évidentes depuis
la demande initiale) ; upgrade LLM des pièces sur machine rapide/cloud ; pas d'intégration
FranceConnect (authentification et soumission restent à la main de l'usager).

## PWA navigateur (prototype) — `web/`

Application **100 % statique, tout côté client** :
- **recherche** BM25 (JS) + **sémantique** optionnelle (`multilingual-e5-small` en WASM, sans GPU,
  vecteurs précalculés au build, fusion RRF) ;
- **déroulé guidé** d'une démarche (questionnaire → **pièces scopées au cas** → téléservices à
  **garde-fou** → guichet réel via l'API Annuaire, CORS OK) — la logique de `scripts/agent.py` en JS ;
- **génération** optionnelle via **WebLLM** (petit LLM en WebGPU, réponse ancrée sur la fiche +
  citation code) — dégradation propre sans GPU ;
- **voix** : dictée hors-ligne de la recherche (Whisper local `Xenova/whisper-base` en WASM via
  Transformers.js, texte transcrit déposé dans le champ de recherche pour relecture/correction,
  jamais lancé automatiquement) et lecture à voix haute des résumés/réponses IA (`speechSynthesis`
  natif du navigateur, voix française) ;
- installable et **hors-ligne** (manifest + service worker).

```sh
python3 scripts/build_web.py                    # exporte web/data/ (index + skills)
npm i && node scripts/build_embeddings.mjs      # (optionnel) vecteurs sémantiques
python3 -m http.server 8765 --directory web     # puis ouvrir http://localhost:8765
```

Reste : **déduction du cas** par le LLM. Détails et limites (WebLLM à vérifier sur navigateur GPU)
dans [web/README.md](web/README.md).
