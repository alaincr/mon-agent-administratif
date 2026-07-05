#!/usr/bin/env python3
"""Exporte le corpus en assets statiques pour la PWA (web/data/).

- web/data/fiches.json        : index de recherche (allégé, avec date_verification)
- web/data/themes.json        : méta des thèmes
- web/data/skills/<id>.json   : 1 parcours par fiche (chargé à la demande)
- web/data/data-manifest.json : pivot de fraîcheur/invalidation (PRD §8.3, R1.1/R1.3)

Usage : python3 scripts/build_web.py
"""
import json, glob, os, shutil, hashlib
from datetime import datetime, timezone

DATA = 'web/data'
os.makedirs(f'{DATA}/skills', exist_ok=True)

# ---- index de recherche (léger) + date de vérification (R1.2) ---------------
fiches, dates = [], []
for line in open('index/fiches.jsonl'):
    if not line.strip():
        continue
    c = json.loads(line)
    d = c.get('updated') or ''
    if d:
        dates.append(d)
    fiches.append({
        'id': c.get('id'), 'title': c.get('title'), 'theme': c.get('theme'),
        'theme_slug': c.get('theme_slug'), 'path': c.get('path'),
        'summary': c.get('summary'), 'keywords': c.get('keywords'),
        'source_url': c.get('source_url'),
        'date_verification': d,            # date DILA de dernière mise à jour de la fiche
    })
fiches_doc = {'schema': 1, 'count': len(fiches), 'fiches': fiches}
json.dump(fiches_doc, open(f'{DATA}/fiches.json', 'w'), ensure_ascii=False)

if os.path.exists('index/themes.json'):
    shutil.copy('index/themes.json', f'{DATA}/themes.json')

# ---- parcours (1 fichier/id, dédoublonné) -----------------------------------
n = 0
for p in sorted(glob.glob('skills/*/*.json')):
    dst = f'{DATA}/skills/{os.path.basename(p)}'
    if not os.path.exists(dst):
        shutil.copy(p, dst); n += 1

# ---- data-manifest.json : hash + taille de chaque fichier (R1.1/R1.3) -------
def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()

files = {}
for p in sorted(glob.glob(f'{DATA}/**/*', recursive=True)):
    if not os.path.isfile(p) or p.endswith('data-manifest.json'):
        continue
    rel = os.path.relpath(p, DATA)
    files[rel] = {'hash': sha256(p), 'bytes': os.path.getsize(p)}

manifest = {
    'schema': 2,
    'corpus_version': max(dates) if dates else '',   # date de la fiche la plus récente
    'built_at': datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    'count': len(fiches),
    'files': files,
}
json.dump(manifest, open(f'{DATA}/data-manifest.json', 'w'), ensure_ascii=False, indent=1)

size = sum(v['bytes'] for v in files.values())
print(f'web/data : {len(fiches)} fiches, {n} parcours copiés, {len(files)} fichiers '
      f'· {size/1e6:.1f} Mo · corpus {manifest["corpus_version"]}')
