#!/usr/bin/env python3
"""Construit le corpus complet Particuliers (11 thèmes) : wiki + skills + index global.

Lance build_wiki.py et build_skills.py pour chaque thème, puis agrège :
  index/fiches.jsonl   — toutes les fiches (1/ligne), chacune portant son thème
  index/themes.json    — méta des thèmes (id, titre, slug, nombre de fiches)
  wiki/INDEX.md        — page d'accueil reliant chaque SOMMAIRE de thème

Usage : python3 scripts/build_all.py
"""
import subprocess, glob, json, os, sys

THEMES = ['N19810', 'N19805', 'N19811', 'N19806', 'N19808', 'N19812',
          'N19803', 'N19807', 'N19804', 'N19809', 'N31931']
PY = sys.executable

def run(script, arg):
    r = subprocess.run([PY, f'scripts/{script}', arg], capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    return r.returncode, out.strip().splitlines()[-1] if out.strip() else ''

# nettoyage des anciens fichiers globaux mono-thème
for f in ('index/carte.json', 'index/fiches.jsonl', 'wiki/SOMMAIRE.md'):
    if os.path.exists(f):
        os.remove(f)

for tid in THEMES:
    c1, l1 = run('build_wiki.py', tid)
    print(f'[wiki ] {tid}: {l1}' + ('  ⚠ECHEC' if c1 else ''))
    c2, l2 = run('build_skills.py', tid)
    print(f'[skill] {tid}: {l2}' + ('  ⚠ECHEC' if c2 else ''))

# --- agrégation de l'index global -------------------------------------------
seen, total, dups = set(), 0, 0
with open('index/fiches.jsonl', 'w') as out:
    for jf in sorted(glob.glob('index/*.fiches.jsonl')):
        for line in open(jf):
            if not line.strip():
                continue
            fid = json.loads(line)['id']
            if fid in seen:          # fiche transversale présente dans plusieurs thèmes
                dups += 1; continue
            seen.add(fid); out.write(line); total += 1
print(f'(index global dédoublonné : {total} fiches uniques, {dups} doublons inter-thèmes écartés)')

themes_meta = []
for cf in sorted(glob.glob('index/*.carte.json')):
    c = json.load(open(cf))
    themes_meta.append({'id': c['theme_id'], 'title': c['theme'],
                        'slug': c['slug'], 'count': c['count']})
themes_meta.sort(key=lambda t: -t['count'])
json.dump({'audience': 'Particuliers', 'total': total, 'themes': themes_meta},
          open('index/themes.json', 'w'), ensure_ascii=False, indent=1)

I = ['# Service-Public.fr — Particuliers', '',
     f'{total} fiches réparties en {len(themes_meta)} thèmes.', '']
for t in themes_meta:
    I.append(f'- [{t["title"]}]({t["slug"]}/SOMMAIRE.md) — {t["count"]} fiches')
open('wiki/INDEX.md', 'w').write('\n'.join(I) + '\n')

print(f'\nCORPUS COMPLET : {total} fiches · {len(themes_meta)} thèmes '
      f'-> wiki/INDEX.md, index/fiches.jsonl, index/themes.json')
