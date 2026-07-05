#!/usr/bin/env python3
"""Génère un wiki Markdown + une carte/index à partir des fiches service-public.fr
pour un thème de l'arborescence (défaut N19810 = Papiers-Citoyenneté-Élections).

Source : jeu de données DILA « Fiches pratiques et ressources Particuliers »,
Licence Ouverte v2.0, schéma 3.5. Données extraites dans data/extract/.

Usage : python3 scripts/build_wiki.py [THEME_ID]
"""
import xml.etree.ElementTree as ET
import os, re, json, sys

SRC = 'data/extract'
DC = '{http://purl.org/dc/elements/1.1/}'
LIVE = 'https://www.service-public.gouv.fr/particuliers/vosdroits/'
THEME_ID = sys.argv[1] if len(sys.argv) > 1 else 'N19810'

def tg(e): return e.tag.split('}')[-1]

def slugify(s):
    repl = "àâäéèêëîïôöûüç'œ"
    into = ['a','a','a','e','e','e','e','i','i','o','o','u','u','c','-','oe']
    s = s.lower()
    for a, b in zip(repl, into): s = s.replace(a, b)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'theme'

# ---------------------------------------------------------------- arborescence
arbo = ET.parse(f'{SRC}/arborescence.xml').getroot()
def titre_of(it):
    e = it.find('Titre')
    return (e.text or '').strip() if e is not None and e.text else ''

theme_node = next((it for it in arbo.findall('ItemArbo') if it.get('ID') == THEME_ID), None)
if theme_node is None:
    sys.exit(f'Thème {THEME_ID} introuvable dans arborescence.xml')
THEME_TITLE = titre_of(theme_node)
STRUCT = {'Theme', 'Sous-theme', 'Dossier', 'Sous-dossier'}

members = {}   # fid -> {'path': [...titres...], 'parent': titre, 'parent_id': id}
def build_tree(it, path):
    here = titre_of(it)
    node = {'id': it.get('ID'), 'type': it.get('type'), 'title': here,
            'children': [], 'fiches': []}
    for k in it.findall('ItemArbo'):
        ktyp, kid = k.get('type') or '', k.get('ID') or ''
        if kid.startswith('F') and ktyp.startswith('Fiche') and it.get('type') in STRUCT:
            members.setdefault(kid, {'path': path + [here], 'parent': here,
                                     'parent_id': it.get('ID'), 'type': ktyp})
            # une fiche n'est listée que sous son dossier canonique (1re occurrence)
            if members[kid]['parent_id'] == it.get('ID') and kid not in node['fiches']:
                node['fiches'].append(kid)
        if k.get('type') in STRUCT:
            node['children'].append(build_tree(k, path + [here]))
    return node

tree = build_tree(theme_node, [])
INSET = set(members)
print(f'Thème {THEME_ID} « {THEME_TITLE} » : {len(INSET)} fiches canoniques')

# titres de toutes les fiches du périmètre (pour les liens « Voir aussi »)
TITLES = {}
for fid in INSET:
    p = f'{SRC}/{fid}.xml'
    if os.path.exists(p):
        e = ET.parse(p).getroot().find(DC + 'title')
        TITLES[fid] = (e.text or '').strip() if e is not None and e.text else fid

# ---------------------------------------------------------------- rendu inline
def link_for(target, text):
    text = (text or target or '').strip()
    if not target:
        return text
    if target in INSET:
        return f'[{text}]({target}.md)'
    if target[0] in 'FRN':
        return f'[{text}]({LIVE}{target})'
    return text

def inline_children(e):
    out = [e.text or '']
    for c in e:
        out.append(inline_el(c))
        out.append(c.tail or '')
    return ''.join(out)

def inline_el(c):
    t = tg(c)
    inner = inline_children(c).strip()
    if t == 'MiseEnEvidence':
        return f'**{inner}**' if inner else ''
    if t == 'Exposant':
        return f'^{inner}^' if inner else ''
    if t == 'LienInterne':
        tgt = c.get('LienPublication') or c.get('LienID') or ''
        return link_for(tgt, inner or c.get('commentaireLien'))
    if t in ('LienExterne', 'LienWeb', 'LienExterneCommente'):
        url = c.get('URL') or ''
        return f'[{inner or url}]({url})' if url else inner
    if t == 'LienIntra':          # renvoi glossaire / intra-page : on garde le terme
        return inner
    if t == 'Expression':         # condition d'affichage d'un fragment
        return f' _(si : {inner})_' if inner else ''
    return inner

# ---------------------------------------------------------------- rendu bloc
CALLOUTS = {'ASavoir': 'À savoir', 'Attention': 'Attention', 'ANoter': 'À noter',
            'Rappel': 'Rappel', 'Important': 'Important', 'AReteni': 'À retenir',
            'Citation': 'Citation', 'Complement': 'Complément'}
emitted = set()   # URLs/IDs déjà rendus en ligne (pour dédoublonner les sections finales)

def H(lvl, txt): return ('#' * min(lvl, 6)) + ' ' + txt

def render_item(it):
    """Un <Item> -> texte markdown (gère paragraphes et sous-listes)."""
    parts = []
    if it.text and it.text.strip():
        parts.append(it.text.strip())
    sub_lines = []
    for c in it:
        t = tg(c)
        if t == 'Paragraphe':
            parts.append(inline_children(c).strip())
        elif t == 'Liste':
            tmp = []
            render_block(c, 0, tmp)
            sub_lines += ['  ' + l for l in tmp if l.strip()]
        else:
            parts.append(inline_children(c).strip())
    line = ' '.join(p for p in parts if p).strip()
    if sub_lines:
        line += '\n' + '\n'.join(sub_lines)
    return line

def render_table(e, out):
    rows = [r for r in e if tg(r) == 'Rangée'] or [r for r in e.iter() if tg(r) == 'Rangée']
    if not rows:
        return
    grid = []
    for r in rows:
        grid.append([' '.join(inline_children(c).split()).replace('|', '\\|')
                     for c in r if tg(c) == 'Cellule'])
    if not grid or not grid[0]:
        return
    width = max(len(r) for r in grid)
    grid = [r + [''] * (width - len(r)) for r in grid]
    out.append('')
    out.append('| ' + ' | '.join(grid[0]) + ' |')
    out.append('| ' + ' | '.join(['---'] * width) + ' |')
    for r in grid[1:]:
        out.append('| ' + ' | '.join(r) + ' |')
    out.append('')

def render_service(e, out):
    ti = e.find('Titre')
    name = inline_children(ti).strip() if ti is not None else 'Service en ligne'
    url = e.get('URL') or ''
    typ = e.get('type') or 'Service en ligne'
    cerfa = f" (cerfa {e.get('numerocerfa')})" if e.get('numerocerfa') else ''
    if url and url not in emitted:
        emitted.add(url)
        out += ['', f'**{typ} :** [{name}]({url}){cerfa}', '']

def render_ousadresser(e, out):
    ti = e.find('Titre')
    name = inline_children(ti).strip() if ti is not None else "Où s'adresser"
    web = next((r.get('URL') for r in e.iter() if tg(r) == 'RessourceWeb' and r.get('URL')), None)
    line = f"**Où s'adresser :** {name}"
    if web:
        line += f' — [Annuaire]({web})'
    out += ['', line, '']

SKIP = {'Titre', 'FilDAriane', 'SurTitre', 'Audience', 'Canal', 'Theme',
        'SousThemePere', 'DossierPere', 'RechercheGuideePere', 'VoirAussi',
        'Definition'}

def render_block(e, lvl, out):
    t = tg(e)
    if t in ('Chapitre', 'SousChapitre', 'Cas', 'Situation'):
        ti = e.find('Titre')
        titxt = inline_children(ti).strip() if ti is not None else ''
        if titxt:
            out += ['', H(lvl, titxt)]
        for c in e:
            if c is ti:
                continue
            render_block(c, lvl + 1 if titxt else lvl, out)
        return
    if t in ('Texte', 'Introduction', 'BlocCas', 'ListeSituations', 'Contenu'):
        for c in e:
            render_block(c, lvl, out)
        return
    if t == 'Paragraphe':
        s = inline_children(e).strip()
        if s:
            out += [s, '']
        return
    if t == 'Liste':
        ordered = (e.get('type') or '').startswith(('ordo', 'num'))
        for i, it in enumerate(e.findall('Item'), 1):
            txt = render_item(it)
            if txt:
                out.append((f'{i}. ' if ordered else '- ') + txt)
        out.append('')
        return
    if t == 'Tableau':
        render_table(e, out); return
    if t in CALLOUTS:
        inner = []
        for c in e:
            if tg(c) == 'Titre':
                continue
            render_block(c, lvl, inner)
        out.append('')
        out.append(f'> **{CALLOUTS[t]}**')
        out.append('>')
        for line in '\n'.join(inner).strip().split('\n'):
            out.append('> ' + line if line.strip() else '>')
        out.append('')
        return
    if t == 'OuSAdresser':
        render_ousadresser(e, out); return
    if t == 'ServiceEnLigne':
        render_service(e, out); return
    if t in SKIP or t.startswith('{'):
        return
    for c in e:               # défaut : on descend (rien n'est perdu)
        render_block(c, lvl, out)

# ---------------------------------------------------------------- une fiche
STOP = set('de la le les des du un une et en au aux pour par sur dans avec ou '
           'vos votre vous quel quelle quels quelles est sont a à ce cette son '
           'sa ses qui que quoi comment quand sans plus est-ce d l n s'.split())

def keywords(title, path):
    words = re.findall(r"[a-zàâäéèêëîïôöûüç]+", (title + ' ' + ' '.join(path)).lower())
    seen, kw = set(), []
    for w in words:
        if len(w) > 3 and w not in STOP and w not in seen:
            seen.add(w); kw.append(w)
    return kw[:12]

def fiche_to_md(fid):
    root = ET.parse(f'{SRC}/{fid}.xml').getroot()
    def dc(name):
        e = root.find(DC + name)
        return (e.text or '').strip() if e is not None and e.text else ''
    title = dc('title')
    desc = dc('description')
    typ = dc('type') or root.get('type', '')
    spurl = root.get('spUrl') or (LIVE + fid)
    updated = dc('date').replace('modified', '').strip()
    # fil d'Ariane
    fa = root.find('FilDAriane')
    path = [inline_children(n).strip() for n in fa.findall('Niveau')] if fa is not None else members[fid]['path']
    path_disp = path[1:-1] if len(path) > 2 else path     # sans "Accueil" ni la fiche
    # relations -> fiches liées dans le périmètre
    related = []
    for n in root.iter():
        tt = tg(n)
        if tt == 'LienInterne':
            tgt = n.get('LienPublication')
            if tgt in INSET and tgt != fid:
                related.append(tgt)
        elif tt in ('QuestionReponse', 'Fiche'):
            tgt = n.get('ID')
            if tgt in INSET and tgt != fid:
                related.append(tgt)
    related = list(dict.fromkeys(related))

    global emitted
    emitted = set()
    body = []
    for child in root:
        if tg(child) in ('Introduction', 'Texte', 'ListeSituations'):
            render_block(child, 2, body)

    # sections finales agrégées (dédoublonnées via `emitted`)
    services, savoirplus, refs = [], [], []
    for child in root:
        t = tg(child)
        if t == 'ServiceEnLigne':
            render_service(child, services)
        elif t == 'PourEnSavoirPlus':
            url = child.get('URL') or ''
            ti = child.find('Titre')
            name = inline_children(ti).strip() if ti is not None else url
            if url:
                savoirplus.append(f'- [{name or url}]({url})')
        elif t == 'Reference':
            url = child.get('URL') or ''
            ti = child.find('Titre')
            name = inline_children(ti).strip() if ti is not None else (child.get('type') or 'Référence')
            refs.append(f'- [{name or url}]({url})' if url else f'- {name}')

    # assemblage markdown
    fm = {
        'id': fid, 'title': title, 'type': typ, 'theme': THEME_TITLE,
        'theme_id': THEME_ID, 'path': path_disp, 'updated': updated,
        'source_url': spurl, 'related': related,
        'keywords': keywords(title, path_disp),
    }
    L = ['---']
    for k, v in fm.items():
        if isinstance(v, list):
            L.append(f'{k}:')
            for x in v:
                L.append(f'  - "{x}"')
        else:
            L.append(f'{k}: "{str(v)}"')
    L.append('---')
    L.append('')
    L.append(f'# {title}')
    L.append('')
    bc = ' › '.join(path_disp)
    meta = f'*{typ}*'
    if bc:
        meta += f' · {bc}'
    if updated:
        meta += f' · mis à jour le {updated}'
    L.append(meta)
    L.append('')
    L.append(f'[Consulter la fiche officielle ↗]({spurl})')
    L.append('')
    if desc:
        L.append(f'> {desc}')
        L.append('')
    L += body
    if services:
        L += ['## Services en ligne'] + services
    if savoirplus:
        L += ['## Pour en savoir plus', ''] + savoirplus + ['']
    if refs:
        L += ['## Textes de référence', ''] + refs + ['']
    if related:
        L += ['## Voir aussi', '']
        for r in related:
            L.append(f'- [{TITLES.get(r, r)}]({r}.md)')
        L.append('')
    L += ['---', '',
          f'*Source : Service-Public.gouv.fr / DILA — {spurl} — '
          f'fichier {fid}.xml — Licence Ouverte v2.0.*', '']
    # nettoyage : pas plus d'une ligne vide consécutive
    txt = '\n'.join(L)
    txt = re.sub(r'\n{3,}', '\n\n', txt)
    return txt, fm

# ---------------------------------------------------------------- exécution
slug = slugify(THEME_TITLE)
wiki_dir = f'wiki/{slug}'
os.makedirs(wiki_dir, exist_ok=True)
os.makedirs('index', exist_ok=True)

cards = {}
ok = 0
for fid in sorted(INSET):
    if not os.path.exists(f'{SRC}/{fid}.xml'):
        continue
    md, fm = fiche_to_md(fid)
    with open(f'{wiki_dir}/{fid}.md', 'w') as f:
        f.write(md)
    cards[fid] = {k: fm[k] for k in ('id', 'title', 'type', 'path', 'updated',
                                     'source_url', 'related', 'keywords')}
    # résumé court pour la carte
    root = ET.parse(f'{SRC}/{fid}.xml').getroot()
    d = root.find(DC + 'description')
    cards[fid]['summary'] = (d.text or '').strip() if d is not None and d.text else ''
    ok += 1

# --- carte.json (arbre + fiches) — par thème
carte = {'theme': THEME_TITLE, 'theme_id': THEME_ID, 'audience': 'Particuliers',
         'slug': slug, 'count': ok, 'tree': tree, 'fiches': cards}
with open(f'index/{slug}.carte.json', 'w') as f:
    json.dump(carte, f, ensure_ascii=False, indent=1)

# --- fiches.jsonl (1 fiche/ligne) — par thème ; chaque fiche porte son thème
with open(f'index/{slug}.fiches.jsonl', 'w') as f:
    for fid, c in cards.items():
        c = dict(c, theme=THEME_TITLE, theme_slug=slug)
        f.write(json.dumps(c, ensure_ascii=False) + '\n')

# --- SOMMAIRE.md (la « carte » lisible que le LLM parcourt d'abord) ---------
# Placé dans wiki/ ; les liens pointent vers <slug>/<fiche>.md
def subtree_count(node):
    return len(node['fiches']) + sum(subtree_count(c) for c in node['children'])

S = [f'# Sommaire — {THEME_TITLE}', '',
     f'{ok} fiches. Chaque entrée : titre — résumé — lien vers la page.', '']
def walk_sommaire(node, depth):
    if subtree_count(node) == 0:          # on saute les regroupements vides
        return
    if node['type'] != 'Theme':           # le thème est déjà le titre H1
        S.extend([f'{"#" * min(depth, 6)} {node["title"]}', ''])
    for fid in node['fiches']:
        c = cards.get(fid)
        if not c:
            continue
        summ = (c['summary'][:160] + '…') if len(c['summary']) > 160 else c['summary']
        S.append(f'- [{c["title"]}]({fid}.md) — {summ}')
    if node['fiches']:
        S.append('')
    for ch in node['children']:
        walk_sommaire(ch, depth + 1)
walk_sommaire(tree, 1)
with open(f'{wiki_dir}/SOMMAIRE.md', 'w') as f:
    f.write('\n'.join(S))

print(f'OK : {ok} fiches -> {wiki_dir}/ (+ SOMMAIRE.md, index/{slug}.*)')
