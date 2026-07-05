#!/usr/bin/env python3
"""Convertit les fiches service-public.fr d'un thème en SKILLS exécutables.

Pour chaque fiche :
  skills/<slug>/<id>.json      — skill structurée (procédure + plan d'agent)
  skills/<slug>/<id>.SKILL.md  — version lisible que le LLM suit pas à pas

La skill sépare ce qui est INFORMATIF (éligibilité, pièces, procédure) de ce qui est
ACTIONNABLE par un agent (ouvrir un téléservice, localiser un guichet). Chaque action
du plan est marquée `auto` (lecture, sûr) ou `confirmation` (action → validation humaine).

Réutilise data/extract/ (arborescence + fiches), schéma 3.5.
Usage : python3 scripts/build_skills.py [THEME_ID]
"""
import xml.etree.ElementTree as ET
import os, re, json, sys
from urllib.parse import urlparse, parse_qs

SRC = 'data/extract'
DC = '{http://purl.org/dc/elements/1.1/}'
LIVE = 'https://www.service-public.gouv.fr/particuliers/vosdroits/'
THEME_ID = sys.argv[1] if len(sys.argv) > 1 else 'N19810'
MAXTXT = 600
DOCKW = ('piece', 'document', 'justificatif', 'fournir', 'joindre', 'munir',
         'presenter', 'présenter', 'apporter')
# bruit fréquent dans les listes : délais, durées, renvois « où s'adresser »
_NOISE = re.compile(r'(?i)(à compter de|durée de conservation|au plus tard|\bdélai\b|'
                    r'à la mairie|^\s*ou,|^\s*auprès\b|^\s*\d+\s*(?:an|ans|mois)\b)')
def _looks_piece(tx):
    t = tx.strip()
    return 3 <= len(t) <= 240 and not _NOISE.search(t)

def tag(e): return e.tag.split('}')[-1]
def clip(s):
    s = re.sub(r'\s+', ' ', s or '').strip()
    return s[:MAXTXT] + ('…' if len(s) > MAXTXT else '')
def slugify(s):
    for a, b in zip("àâäéèêëîïôöûüç'œ", ['a','a','a','e','e','e','e','i','i','o','o','u','u','c','-','oe']):
        s = s.lower().replace(a, b)
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-') or 'theme'

def text_of(e):
    parts = [e.text or '']
    for c in e:
        parts.append(text_of(c)); parts.append(c.tail or '')
    return re.sub(r'\s+', ' ', ''.join(parts)).strip()

def title_text(e):
    t = e.find('Titre')
    return text_of(t) if t is not None else ''

# ----------------------------------------------------------- périmètre du thème
arbo = ET.parse(f'{SRC}/arborescence.xml').getroot()
def at_titre(it):
    e = it.find('Titre'); return (e.text or '').strip() if e is not None and e.text else ''
theme = next((it for it in arbo.findall('ItemArbo') if it.get('ID') == THEME_ID), None)
if theme is None: sys.exit(f'thème {THEME_ID} introuvable')
THEME_TITLE = at_titre(theme)
STRUCT = {'Theme', 'Sous-theme', 'Dossier', 'Sous-dossier'}
members = {}
def walk(it, path):
    here = at_titre(it)
    for k in it.findall('ItemArbo'):
        ktyp, kid = k.get('type') or '', k.get('ID') or ''
        if kid.startswith('F') and ktyp.startswith('Fiche') and it.get('type') in STRUCT:
            members.setdefault(kid, path + [here])
        if k.get('type') in STRUCT: walk(k, path + [here])
walk(theme, [])

# ----------------------------------------------------------- procédure (arbre)
def children_nodes(el):
    out, lastp = [], ''
    for c in el:
        t = tag(c)
        if t == 'Titre':
            continue
        if t == 'Paragraphe':
            lastp = text_of(c).lower()
        out += node_of(c, lastp)
    return out

def node_of(c, lastp=''):
    t = tag(c)
    if t in ('Texte', 'Introduction', 'Contenu'):
        return children_nodes(c)
    if t in ('Chapitre', 'SousChapitre'):
        return [{'type': 'etape', 'titre': clip(title_text(c)) or None, 'contenu': children_nodes(c)}]
    if t in ('BlocCas', 'ListeSituations'):
        br = [{'si': clip(title_text(cas)), 'procedure': children_nodes(cas)}
              for cas in c if tag(cas) in ('Cas', 'Situation')]
        return [{'type': 'decision', 'branches': br}] if br else []
    if t == 'Liste':
        items = [clip(text_of(i)) for i in c.findall('Item') if text_of(i).strip()]
        is_pieces = any(k in lastp for k in DOCKW)   # liste de pièces ? (contexte du paragraphe)
        if is_pieces:
            items = [x for x in items if _looks_piece(x)]
        return [{'type': 'liste', 'pieces': is_pieces, 'items': items[:25]}] if items else []
    if t == 'Paragraphe':
        tx = clip(text_of(c)); return [{'type': 'info', 'texte': tx}] if tx else []
    if t in ('ASavoir', 'Attention', 'ANoter', 'Rappel', 'Important', 'Complement'):
        tx = clip(text_of(c)); return [{'type': 'note', 'texte': tx}] if tx else []
    if t in ('OuSAdresser', 'ServiceEnLigne'):
        return []                      # collectés globalement
    return children_nodes(c)           # défaut : on descend

# ----------------------------------------------------------- une skill
def build_skill(fid):
    root = ET.parse(f'{SRC}/{fid}.xml').getroot()
    def dc(n):
        e = root.find(DC + n); return (e.text or '').strip() if e is not None and e.text else ''

    # procédure
    procedure = []
    for child in root:
        if tag(child) in ('Introduction', 'Texte', 'ListeSituations'):
            procedure += node_of(child)

    # services en ligne (actionnables)
    services, seen = [], set()
    for e in root.iter():
        if tag(e) == 'ServiceEnLigne' and e.get('URL') and e.get('URL') not in seen:
            seen.add(e.get('URL'))
            q = parse_qs(urlparse(e.get('URL')).query)
            services.append({'label': clip(title_text(e)) or (e.get('type') or 'Service'),
                             'url': e.get('URL'), 'type': e.get('type') or 'Téléservice',
                             'cerfa': e.get('numerocerfa'),
                             'action': (q.get('action') or [None])[0]})

    # où s'adresser
    where, seenw = [], set()
    for e in root.iter():
        if tag(e) == 'OuSAdresser':
            piv = e.find('PivotLocal')
            ann = next((r.get('URL') for r in e.iter() if tag(r) == 'RessourceWeb' and r.get('URL')), None)
            w = {'label': clip(title_text(e)) or "Où s'adresser",
                 'pivot': (piv.text or '').strip() if piv is not None else '', 'annuaire': ann}
            key = (w['label'], w['pivot'], w['annuaire'])
            if key not in seenw: seenw.add(key); where.append(w)

    # pièces (heuristique : liste précédée d'un paragraphe « fournir/justificatif… »)
    pieces, lastp = [], ''
    for e in root.iter():
        if tag(e) == 'Paragraphe': lastp = text_of(e).lower()
        elif tag(e) == 'Liste' and any(k in lastp for k in DOCKW):
            for i in e.findall('Item'):
                tx = clip(text_of(i))
                if tx and _looks_piece(tx) and tx not in pieces:
                    pieces.append(tx)
    pieces = pieces[:40]

    # références
    refs = [{'label': clip(title_text(c)) or (c.get('type') or 'Référence'), 'url': c.get('URL')}
            for c in root if tag(c) == 'Reference' and c.get('URL')]

    # plan d'agent : auto (lecture/prépa) vs confirmation (action)
    plan, n = [], 0
    has_decision = any(_has_decision(x) for x in procedure)
    if has_decision:
        n += 1; plan.append({'n': n, 'mode': 'auto', 'outil': 'evaluer_cas',
                             'description': "Déterminer la situation de l'usager (cas applicables)"})
    if pieces:
        n += 1; plan.append({'n': n, 'mode': 'auto', 'outil': 'rassembler_pieces',
                             'description': f'Lister et rassembler les pièces ({len(pieces)})'})
    for w in where:
        n += 1; plan.append({'n': n, 'mode': 'auto', 'outil': 'trouver_guichet',
                             'args': {'pivot': w['pivot'], 'annuaire': w['annuaire']},
                             'description': f"Localiser : {w['label']}"})
    for s in services:
        n += 1; plan.append({'n': n, 'mode': 'confirmation', 'outil': 'ouvrir_teleservice',
                             'args': {'url': s['url'], 'action': s['action'], 'cerfa': s['cerfa']},
                             'description': f"Ouvrir : {s['label']}"})
    if services:
        n += 1; plan.append({'n': n, 'mode': 'confirmation', 'outil': 'soumettre',
                             'description': "Vérifier puis soumettre la démarche — validation explicite de l'usager"})

    return {
        'id': fid, 'titre': dc('title'), 'type': root.get('type', dc('type')),
        'audience': 'Particuliers', 'theme': members.get(fid, [])[1:],
        'maj': dc('date').replace('modified', '').strip(),
        'url_officielle': root.get('spUrl') or (LIVE + fid),
        'resume': dc('description'),
        'pieces': pieces, 'services_en_ligne': services, 'ou_sadresser': where,
        'references': refs, 'procedure': procedure, 'plan_agent': plan,
    }

def _has_decision(node):
    if node.get('type') == 'decision': return True
    for k in ('contenu',):
        if any(_has_decision(c) for c in node.get(k, [])): return True
    return False

# ----------------------------------------------------------- rendu SKILL.md
def md_proc(nodes, depth=2, out=None):
    out = out if out is not None else []
    for nd in nodes:
        t = nd['type']
        if t == 'etape':
            if nd.get('titre'):
                out.append('#' * min(depth, 6) + ' ' + nd['titre'])
            md_proc(nd.get('contenu', []), depth + 1, out)
        elif t == 'decision':
            out.append('_Selon votre situation :_')
            for b in nd['branches']:
                out.append(f'- **{b["si"] or "cas"}**')
                tmp = md_proc(b['procedure'], depth + 1, [])
                out += ['  ' + l for l in tmp if l.strip()]
        elif t == 'liste':
            out += [f'- {it}' for it in nd['items']]
        elif t == 'info':
            out.append(nd['texte'])
        elif t == 'note':
            out.append(f'> {nd["texte"]}')
        out.append('')
    return out

def to_md(sk):
    L = [f'# Skill — {sk["titre"]}', '']
    meta = f'*{sk["type"]}*'
    if sk['theme']: meta += ' · ' + ' › '.join(sk['theme'])
    if sk['maj']: meta += ' · mis à jour le ' + sk['maj']
    L += [meta, '', f'[Fiche officielle ↗]({sk["url_officielle"]})', '']
    if sk['resume']: L += [f'> {sk["resume"]}', '']
    if sk['pieces']:
        L += ['## Pièces à fournir', ''] + [f'- {p}' for p in sk['pieces']] + ['']
    L += ['## Procédure', ''] + md_proc(sk['procedure'])
    if sk['services_en_ligne']:
        L += ['## Démarche en ligne', '']
        for s in sk['services_en_ligne']:
            extra = f' · cerfa {s["cerfa"]}' if s['cerfa'] else ''
            L.append(f'- **{s["type"]}** — [{s["label"]}]({s["url"]}){extra}')
        L.append('')
    if sk['ou_sadresser']:
        L += ['## Où s\'adresser', '']
        for w in sk['ou_sadresser']:
            a = f' — [annuaire]({w["annuaire"]})' if w['annuaire'] else ''
            L.append(f'- {w["label"]}' + (f' ({w["pivot"]})' if w['pivot'] else '') + a)
        L.append('')
    L += ['## Plan pour l\'agent', '',
          '_`auto` = lecture/préparation (sûr) · `confirmation` = action soumise à validation humaine._', '']
    for p in sk['plan_agent']:
        L.append(f'{p["n"]}. `[{p["mode"]}]` **{p["outil"]}** — {p["description"]}')
    L.append('')
    if sk['references']:
        L += ['## Références', ''] + [f'- [{r["label"]}]({r["url"]})' for r in sk['references']] + ['']
    L += ['---', '', f'*Source : Service-Public.gouv.fr / DILA — {sk["url_officielle"]} — '
          f'fichier {sk["id"]}.xml — Licence Ouverte v2.0.*', '']
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(L))

# ----------------------------------------------------------- exécution
slug = slugify(THEME_TITLE)
out_dir = f'skills/{slug}'
os.makedirs(out_dir, exist_ok=True)
ok = withsvc = withact = 0
for fid in sorted(members):
    if not os.path.exists(f'{SRC}/{fid}.xml'): continue
    sk = build_skill(fid)
    json.dump(sk, open(f'{out_dir}/{fid}.json', 'w'), ensure_ascii=False, indent=1)
    open(f'{out_dir}/{fid}.SKILL.md', 'w').write(to_md(sk))
    ok += 1
    if sk['services_en_ligne']: withsvc += 1
    if any(p['mode'] == 'confirmation' for p in sk['plan_agent']): withact += 1
print(f'{ok} skills -> {out_dir}/')
print(f'  dont {withsvc} avec service(s) en ligne, {withact} avec au moins une action à confirmer')
