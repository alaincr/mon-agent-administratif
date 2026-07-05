#!/usr/bin/env python3
"""Agent piloté par une SKILL, sur une démarche concrète.

Le CODE pilote la boucle (déterministe) ; le modèle ne sert qu'à remplir des cases.
L'agent enchaîne les étapes `auto` (lecture/préparation) puis S'ARRÊTE à chaque étape
`confirmation` (action) : il n'ouvre rien et ne soumet jamais sans validation humaine.

Exemples :
  python3 scripts/agent.py --skill F1427 --reponses "France,propre,Sur place,Copie intégrale" --commune Lyon
  python3 scripts/agent.py --skill F1427 --reponses "France,propre,Sur place,Copie intégrale" --commune Lyon --confirmer
"""
import argparse, glob, json, os, sys
import annuaire

B, D, G, Y, R, X = '\033[1m', '\033[2m', '\033[32m', '\033[33m', '\033[31m', '\033[0m'

def load_skill(fid):
    hits = glob.glob(f'skills/*/{fid}.json')
    if not hits:
        sys.exit(f'skill {fid} introuvable (corpus généré ?)')
    return json.load(open(hits[0]))

# --- évaluer le cas : descendre l'arbre de décision le long d'un seul chemin ----
def first_decision(nodes):
    for n in nodes:
        if n['type'] == 'decision':
            return n
        if n['type'] == 'etape':
            d = first_decision(n.get('contenu', []))
            if d:
                return d
    return None

def _match_preset(presets, opts):
    """Consomme une réponse pré-remplie qui correspond à une option (ordre libre)."""
    for i, p in enumerate(presets):
        for j, o in enumerate(opts):
            if p.strip().lower() in (o or '').lower():
                presets.pop(i)
                return j
    return None

def ask_choice(qn, opts):
    print(f"\n   {B}Question {qn}{X} — précisez votre situation :")
    for i, o in enumerate(opts, 1):
        print(f"     {i}) {o}")
    while True:
        try:
            raw = input(f"     votre choix [1-{len(opts)}] : ").strip()
        except EOFError:
            print(f"     {D}(pas de réponse → 1re option par défaut){X}")
            return 0
        if raw.isdigit() and 1 <= int(raw) <= len(opts):
            return int(raw) - 1
        for i, o in enumerate(opts):
            if raw and raw.lower() in (o or '').lower():
                return i
        print("     (réponse non reconnue — entrez un numéro)")

def collect_pieces(nodes):
    """Pièces des listes marquées le long du chemin (sans entrer dans les sous-décisions)."""
    out = []
    for n in nodes:
        if n.get('type') == 'liste' and n.get('pieces'):
            out += n.get('items', [])
        elif n.get('type') == 'etape':
            out += collect_pieces(n.get('contenu', []))
    return out

def choose_path(proc, presets):
    """Parcourt la procédure dans l'ordre : pose chaque décision rencontrée le long du
    chemin retenu et collecte les pièces (listes marquées) de ce seul chemin.
    Retourne (profil, pièces du cas)."""
    profil, pieces, presets, qn = [], [], list(presets), [0]

    def resolve(nodes):
        for n in nodes:
            t = n.get('type')
            if t == 'liste' and n.get('pieces'):
                pieces.extend(n.get('items', []))
            elif t == 'etape':
                resolve(n.get('contenu', []))
            elif t == 'decision':
                opts = [b['si'] for b in n['branches']]
                qn[0] += 1
                idx = _match_preset(presets, opts)
                if idx is not None:
                    print(f"   {D}Question {qn[0]} (pré-remplie) → {opts[idx]}{X}")
                else:
                    idx = ask_choice(qn[0], opts)
                profil.append((n['branches'][idx]['si'], ''))
                resolve(n['branches'][idx]['procedure'])
    resolve(proc)

    seen, scoped = set(), []
    for p in pieces:
        if p.lower() not in seen:
            seen.add(p.lower()); scoped.append(p)
    return profil, scoped

# --- outils -------------------------------------------------------------------
def recommend_service(profil, services):
    etranger = any('étranger' in t.lower() for t, _ in profil)
    teles = [s for s in services if s['type'] == 'Téléservice'] or services
    for s in teles:
        if etranger and ('delivrance' in s['url'] or 'étranger' in s['label'].lower()):
            return s
        if not etranger and ('EtatCivil' in s['url'] or 'France' in s['label']):
            return s
    return teles[0] if teles else None

# --- boucle d'exécution -------------------------------------------------------
def run(skill, presets, commune, confirmer):
    services = skill['services_en_ligne']
    profil, scoped, reco = [], [], recommend_service([], services)
    print(f"\n{B}Démarche : {skill['titre']}{X}")
    print(f"{D}{skill['url_officielle']}{X}")
    if skill['resume']:
        print(f"\n{skill['resume']}")
    com_nom, com_insee = annuaire.resolve_commune(commune)

    for p in skill['plan_agent']:
        outil, desc = p['outil'], p['description']
        if p['mode'] == 'auto':
            if outil == 'evaluer_cas':
                print(f"\n{G}✓ [auto] evaluer_cas{X} — quelques questions pour cibler votre cas :")
                profil, scoped = choose_path(skill['procedure'], presets)
                reco = recommend_service(profil, services)
                print(f"   {B}→ situation retenue :{X} " + ' · '.join(t for t, _ in profil))
            elif outil == 'rassembler_pieces':
                pcs = scoped or skill['pieces']
                scope = f" {Y}(selon votre cas){X}" if scoped else ''
                print(f"\n{G}✓ [auto] rassembler_pieces{X}{scope} {D}(extraction auto — à vérifier){X}")
                for pc in pcs or ['(aucune pièce listée)']:
                    print(f"     • {pc}")
            elif outil == 'trouver_guichet':
                args = p.get('args') or {}
                piv, ann = args.get('pivot', ''), args.get('annuaire')
                lieu = desc.replace('Localiser :', '').strip()
                loc = f" à {com_nom} ({com_insee})" if com_nom else ''
                print(f"\n{G}✓ [auto] trouver_guichet{X} — {lieu}{loc}")
                svcs = annuaire.find_service(com_insee, piv) if (piv and com_insee) else []
                if svcs:
                    s = svcs[0]
                    print(f"     {B}{s['nom']}{X}")
                    if s['adresse']:  print(f"     {s['adresse']}")
                    if s['tel']:      print(f"     tél. {s['tel']}")
                    if s['courriel']: print(f"     {s['courriel']}")
                    for h in s['horaires'][:4]:
                        print(f"     {D}{h}{X}")
                    if len(svcs) > 1:
                        print(f"     {D}(+{len(svcs) - 1} autre(s) guichet(s) dans la commune){X}")
                    if s.get('url_sp'):
                        print(f"     {D}{s['url_sp']}{X}")
                elif ann:
                    print(f"     annuaire : {ann}  {D}(pas de fiche locale ; saisir la commune){X}")
            else:
                print(f"\n{G}✓ [auto] {outil}{X} — {desc}")
        else:  # confirmation
            if outil == 'ouvrir_teleservice':
                url = (p.get('args') or {}).get('url', '')
                star = f"  {Y}◀ recommandé pour votre cas{X}" if reco and url == reco['url'] else ''
                if not confirmer:
                    print(f"\n{R}{B}⏸  VALIDATION HUMAINE REQUISE{X}")
                    print(f"   Action : {desc}{star}")
                    print(f"   Lien officiel : {url}")
                    print(f"   {D}L'agent n'ouvre rien et ne soumet rien. "
                          f"Relancez avec --confirmer pour simuler l'accord de l'usager.{X}")
                    return
                print(f"\n{Y}✓ [confirmation] validé par l'usager{X} — ouvrir : {url}{star}")
            elif outil == 'soumettre':
                if not confirmer:
                    return
                print(f"\n{R}{B}⏸  {desc}{X}")
                print(f"   {D}L'agent ne soumet jamais à la place de l'usager.{X}")

    print(f"\n{B}Récap{X} : {skill['titre']} — "
          f"{'service recommandé : ' + reco['label'] if reco else 'pas de téléservice'}")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--skill', help='identifiant de fiche, ex. F1427')
    ap.add_argument('query', nargs='*', help='ou une question (recherche la skill)')
    ap.add_argument('--reponses', default='', help='réponses aux questions (séparées par des virgules)')
    ap.add_argument('--commune', help='commune pour localiser le guichet')
    ap.add_argument('--confirmer', action='store_true', help="simuler l'accord de l'usager aux actions")
    args = ap.parse_args()

    fid = args.skill
    if not fid and args.query:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from assistant import Retriever
        fid = Retriever().search(' '.join(args.query), k=1)[0]['id']
        print(f"{D}skill retenue : {fid}{X}")
    if not fid:
        sys.exit("préciser --skill F#### ou une question")

    skill = load_skill(fid)
    presets = [r for r in args.reponses.split(',') if r.strip()]
    run(skill, presets, args.commune, args.confirmer)

if __name__ == '__main__':
    main()
