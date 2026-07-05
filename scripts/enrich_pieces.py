#!/usr/bin/env python3
"""Fiabilise les `pieces` des skills par extraction LLM, en SORTIE JSON CONTRAINTE.

Remplace l'extraction heuristique (bruitée) par une lecture de la fiche : le modèle
ne renvoie QUE les documents que l'usager doit fournir. La sortie est forcée au schéma
JSON (Ollama `format`), donc toujours une liste propre. Étape de *build* (hors-ligne possible).

Usage :
  python3 scripts/enrich_pieces.py F1427 [F1432 ...]   # fiches précises
  python3 scripts/enrich_pieces.py --all               # tout le thème
  PIECES_MODEL=qwen3:4b python3 scripts/enrich_pieces.py --all   # meilleur « professeur »
"""
import json, os, re, sys, glob, urllib.request

OLLAMA = os.environ.get('OLLAMA_HOST', 'http://localhost:11434')
MODEL = os.environ.get('PIECES_MODEL', 'qwen3:0.6b')
SK_DIR = 'skills/papiers-citoyennete-elections'
WIKI_DIR = 'wiki/papiers-citoyennete-elections'

SCHEMA = {"type": "object",
          "properties": {"pieces": {"type": "array", "items": {"type": "string"}}},
          "required": ["pieces"]}
SYS = ("Tu extrais UNIQUEMENT la liste des pièces / documents que l'usager doit FOURNIR "
       "pour réaliser la démarche décrite. "
       "À EXCLURE absolument : les délais, les prix, les durées de conservation, les "
       "conditions d'éligibilité, les étapes, les explications. "
       "Formule chaque pièce de façon courte et concrète (ex. « pièce d'identité », "
       "« justificatif de domicile de moins d'un an »). "
       "Si la fiche n'indique aucune pièce à fournir, renvoie une liste vide. /no_think")

def fiche_text(fid):
    t = open(f'{WIKI_DIR}/{fid}.md').read()
    t = re.sub(r'^---\n.*?\n---\n', '', t, flags=re.DOTALL)
    return t.strip()[:6500]

def extract(fid):
    body = {"model": MODEL, "stream": False, "options": {"temperature": 0},
            "format": SCHEMA,
            "messages": [{"role": "system", "content": SYS},
                         {"role": "user", "content": f"Fiche :\n\n{fiche_text(fid)}"}]}
    req = urllib.request.Request(f'{OLLAMA}/api/chat',
                                 data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    out = json.load(urllib.request.urlopen(req, timeout=240))['message']['content']
    pieces = json.loads(out).get('pieces', [])
    seen, res = set(), []
    for p in pieces:
        p = re.sub(r'\s+', ' ', str(p)).strip()
        if p and p.lower() not in seen:
            seen.add(p.lower()); res.append(p)
    return res[:30]

def patch_md(fid, pieces):
    path = f'{SK_DIR}/{fid}.SKILL.md'
    md = open(path).read()
    md = re.sub(r'## Pièces à fournir\n.*?(?=\n## )', '', md, flags=re.DOTALL)
    if pieces:
        block = '## Pièces à fournir\n\n' + '\n'.join(f'- {x}' for x in pieces) + '\n\n'
        md = md.replace('## Procédure', block + '## Procédure', 1)
    open(path, 'w').write(md)

def update(fid):
    skp = f'{SK_DIR}/{fid}.json'
    sk = json.load(open(skp))
    old, new = sk.get('pieces', []), extract(fid)
    sk['pieces'], sk['pieces_source'] = new, 'llm'
    json.dump(sk, open(skp, 'w'), ensure_ascii=False, indent=1)
    patch_md(fid, new)
    return old, new

def main():
    args = sys.argv[1:]
    if args == ['--all']:
        ids = sorted(os.path.basename(p)[:-5] for p in glob.glob(f'{SK_DIR}/*.json'))
    else:
        ids = args
    if not ids:
        sys.exit("préciser des identifiants (F1427 …) ou --all")
    show = len(ids) <= 5
    for i, fid in enumerate(ids, 1):
        try:
            old, new = update(fid)
        except Exception as e:
            print(f"[{fid}] échec : {e}"); continue
        if show:
            print(f"\n=== {fid} ===")
            print(f"  AVANT (heuristique, {len(old)}) :")
            for p in old: print(f"     - {p}")
            print(f"  APRÈS (LLM, {len(new)}) :")
            for p in new: print(f"     - {p}")
        else:
            print(f"[{i}/{len(ids)}] {fid} : {len(old)} → {len(new)} pièces")
    print("\nFait.")

if __name__ == '__main__':
    main()
