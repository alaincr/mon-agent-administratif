# Politique de sécurité

## Signaler une vulnérabilité

Merci de signaler tout problème de sécurité de façon **responsable et privée**,
avant toute divulgation publique. (Renseigner ici le canal retenu : adresse
e-mail de sécurité, formulaire, ou « security advisory » privé du dépôt.)

Délai de première réponse visé : **5 jours ouvrés**.

## Périmètre

Application **100 % côté client**, sans back-end applicatif ni compte usager.
La surface d'attaque est donc particulière :

- **Contenu piloté par les données** (`web/data/`) : les fiches et parcours sont
  injectés dans le DOM. Bien qu'issus d'une source officielle (DILA), ils sont
  traités comme **non fiables par défaut** (défense en profondeur, réf. PRD R3.4) :
  échappement systématique, pas d'`innerHTML` non assaini, URLs de téléservices
  validées contre une **allowlist** de domaines (`*.gouv.fr` + exceptions
  explicites, réf. R8.3) avant toute ouverture — laquelle exige de plus une
  confirmation explicite de l'usager (garde-fou, non négociable).
- **Chaîne d'approvisionnement** : les modèles et bibliothèques ML (Transformers.js,
  WebLLM, poids e5/Whisper/LLM) doivent à terme être **auto-hébergés** sur notre
  origine (réf. R8.1). L'état actuel du prototype charge encore certaines
  ressources depuis un CDN tiers (`esm.run`) avec **version épinglée**
  (`@huggingface/transformers@3.8.1`) — voir la dette suivie ci-dessous.
- **Vie privée** : aucune donnée vocale ou textuelle de l'usager ne doit quitter
  le terminal, hormis les appels explicites et minimaux à `geo.api.gouv.fr`
  (autocomplétion de commune) et à l'API Annuaire (DILA). Vérifié en CI
  (réf. R10.4, objectif O6).

## Dette de sécurité connue (suivie)

| Sujet | État | Réf. PRD |
|---|---|---|
| Ressources ML tierces (CDN) | **Couche Transformers.js (recherche sémantique + dictée Whisper) AUTO-HÉBERGÉE** (lib + runtime ORT WASM + poids e5/Whisper servis par notre origine ; vérifié : 0 requête tierce au runtime). **Reste** : WebLLM (assistant IA optionnel, GPU) encore chargé via esm.run/HF → à auto-héberger pour finir D-03 | R8.1 / D-03 |
| En-têtes | **CSP posée** (`<meta>` + `web/_headers`) : `default-src 'self'`, ML en local, seules exceptions = geo.api/annuaire (gouv) et le CDN WebLLM (temporaire). **Reste** : COOP/COEP (multi-thread WASM, gain à mesurer ; réserve : bloque les fetch cross-origin non-CORP → valider geo/annuaire) + HSTS (hébergement) | R8.2 |
| Allowlist des domaines de téléservices | à implémenter | R8.3 |
| Épinglage `@huggingface/transformers@3.8.1` (régression 4.x « Missing required scale ») | épinglé + retry ; **issue upstream à déposer** | R10.3 |

## Bonnes pratiques appliquées

- Liens externes en `rel="noopener noreferrer"` + confirmation avant ouverture.
- Échappement HTML (`esc()`) de tout texte inséré, y compris nos propres données.
- Validation du schéma des URL (`https:` uniquement) avant insertion dans un `href`.
