#!/usr/bin/env python3
"""Assistant local sur le wiki service-public.fr (échantillon Papiers-Citoyenneté).

Deux couches :
  1) RECHERCHE sur la carte (index/fiches.jsonl) : BM25 (lexical, pur Python)
     + sémantique (embeddings nomic-embed-text via Ollama), fusionnés par RRF.
  2) RÉPONSE : on charge la/les fiche(s) entières et un petit LLM local (qwen3:0.6b
     via Ollama) répond en restant strictement ancré sur les fiches, et cite la source.

Tout est local. Dépendances : requests, numpy (+ Ollama en service).

Exemples :
  python3 scripts/assistant.py "j'ai perdu mon passeport, que faire ?"
  python3 scripts/assistant.py --search-only "inscription sur les listes électorales"
  python3 scripts/assistant.py --rebuild-embeddings ""        # (re)calcule le cache
  python3 scripts/assistant.py --bm25-only "carte grise changement d'adresse"
"""
import argparse, glob, json, math, os, re, sys, unicodedata
import numpy as np
import requests

OLLAMA = os.environ.get('OLLAMA_HOST', 'http://localhost:11434')
EMBED_MODEL = 'nomic-embed-text:v1.5'
CHAT_MODEL = 'qwen3:0.6b'
FICHES = 'index/fiches.jsonl'
EMB_CACHE = 'index/embeddings.json'
CTX_CHARS = 6500          # budget de contexte (fiches) envoyé au LLM

# --------------------------------------------------------------- texte / tokens
STOP = set("au aux avec ce ces dans de des du elle en et eux il je la le les leur "
           "lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour "
           "qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous "
           "c d j l m n s t y est sont a as ai quel quelle quels quelles comment "
           "quand pourquoi puis-je dois je mon ma fait faire si lorsque".split())

def _strip_accents(s):
    s = unicodedata.normalize('NFD', s.lower())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')

def toks(s):
    return [w for w in re.findall(r'[a-z0-9]+', _strip_accents(s))
            if len(w) > 1 and w not in STOP]

# --------------------------------------------------------------- chargement carte
def load_cards():
    cards = [json.loads(l) for l in open(FICHES) if l.strip()]
    paths = {}
    for p in glob.glob('wiki/*/*.md'):
        paths[os.path.basename(p)[:-3]] = p
    for c in cards:
        c['_path'] = paths.get(c['id'])
    return cards

def doc_text(c):
    return ' '.join([(c.get('title', '') + ' ') * 3,
                     ' '.join(c.get('keywords', [])) * 2,
                     ' '.join(c.get('path', [])),
                     c.get('summary', '')])

# --------------------------------------------------------------- BM25 (pur Python)
class BM25:
    def __init__(self, corpus, k1=1.5, b=0.75):
        self.k1, self.b = k1, b
        self.docs = [toks(t) for t in corpus]
        self.N = len(self.docs)
        self.len = [len(d) for d in self.docs]
        self.avgdl = (sum(self.len) / self.N) if self.N else 0
        self.post = {}                       # terme -> [(doc, tf), ...]
        df = {}
        for i, d in enumerate(self.docs):
            tf = {}
            for w in d:
                tf[w] = tf.get(w, 0) + 1
            for w, f in tf.items():
                self.post.setdefault(w, []).append((i, f))
                df[w] = df.get(w, 0) + 1
        self.idf = {w: math.log(1 + (self.N - n + 0.5) / (n + 0.5)) for w, n in df.items()}

    def scores(self, query):
        sc = np.zeros(self.N)
        for w in set(toks(query)):
            if w not in self.post:
                continue
            idf = self.idf[w]
            for i, tf in self.post[w]:
                denom = tf + self.k1 * (1 - self.b + self.b * self.len[i] / self.avgdl)
                sc[i] += idf * tf * (self.k1 + 1) / denom
        return sc

# --------------------------------------------------------------- Ollama
def ollama_embed(texts):
    out = []
    for i in range(0, len(texts), 64):
        r = requests.post(f'{OLLAMA}/api/embed',
                          json={'model': EMBED_MODEL, 'input': texts[i:i + 64]}, timeout=180)
        r.raise_for_status()
        out.extend(r.json()['embeddings'])
    return np.array(out, dtype=np.float32)

def ollama_up():
    try:
        requests.get(f'{OLLAMA}/api/tags', timeout=3); return True
    except Exception:
        return False

def ollama_chat(messages, model):
    r = requests.post(f'{OLLAMA}/api/chat',
                      json={'model': model, 'stream': False, 'messages': messages,
                            'options': {'temperature': 0}}, timeout=300)
    r.raise_for_status()
    txt = r.json()['message']['content']
    return re.sub(r'<think>.*?</think>', '', txt, flags=re.DOTALL).strip()

# --------------------------------------------------------------- embeddings cache
def normalize(m):
    n = np.linalg.norm(m, axis=1, keepdims=True)
    return m / np.clip(n, 1e-9, None)

def get_embeddings(cards, rebuild=False):
    ids = [c['id'] for c in cards]
    if not rebuild and os.path.exists(EMB_CACHE):
        cache = json.load(open(EMB_CACHE))
        if cache.get('ids') == ids and cache.get('model') == EMBED_MODEL:
            return normalize(np.array(cache['vectors'], dtype=np.float32))
    print('… calcul des embeddings (nomic-embed-text, local) …', file=sys.stderr)
    texts = [f"search_document: {c.get('title','')}. {c.get('summary','')}" for c in cards]
    vecs = ollama_embed(texts)
    json.dump({'model': EMBED_MODEL, 'ids': ids, 'vectors': vecs.tolist()},
              open(EMB_CACHE, 'w'))
    return normalize(vecs)

# --------------------------------------------------------------- recherche hybride
def rrf(rank_lists, k=60):
    agg = {}
    for rl in rank_lists:
        for pos, i in enumerate(rl):
            agg[i] = agg.get(i, 0.0) + 1.0 / (k + pos + 1)
    return sorted(agg, key=lambda i: -agg[i])

class Retriever:
    def __init__(self, use_embed=True, rebuild=False):
        self.cards = load_cards()
        self.bm25 = BM25([doc_text(c) for c in self.cards])
        self.emb = None
        if use_embed and ollama_up():
            try:
                self.emb = get_embeddings(self.cards, rebuild)
            except Exception as e:
                print(f'(embeddings indisponibles : {e} — recherche lexicale seule)', file=sys.stderr)

    def search(self, query, k=5):
        bm = self.bm25.scores(query)
        bm_rank = list(np.argsort(-bm))
        if self.emb is not None:
            qv = normalize(ollama_embed([f'search_query: {query}']))[0]
            sim = self.emb @ qv
            sem_rank = list(np.argsort(-sim))
            order = rrf([bm_rank, sem_rank])
        else:
            order = bm_rank
        return [self.cards[i] for i in order[:k]]

# --------------------------------------------------------------- lecture fiche
def read_fiche(card):
    txt = open(card['_path']).read()
    txt = re.sub(r'^---\n.*?\n---\n', '', txt, flags=re.DOTALL)   # enlève le front-matter
    return txt.strip()

SYSTEM = (
    "Tu es un assistant qui explique les démarches administratives françaises, "
    "en t'appuyant UNIQUEMENT sur les fiches officielles service-public.fr fournies. "
    "Règles strictes :\n"
    "- N'utilise QUE les informations des fiches fournies ci-dessous ; n'invente rien.\n"
    "- Si l'information n'y figure pas, dis-le et renvoie vers le lien officiel.\n"
    "- Si la démarche dépend de la situation (cas, onglets), présente les différentes branches.\n"
    "- Sois concret : étapes, pièces à fournir, où s'adresser, délais.\n"
    "- Termine par une ligne « Source : » avec le titre, l'identifiant (F….) et l'URL officielle.\n"
    "- Réponds en français."
)

def build_context(cards):
    blocks, used, total = [], [], 0
    for c in cards:
        body = read_fiche(c)
        block = f"### Fiche {c['id']} — {c['title']}\nURL : {c['source_url']}\n\n{body}"
        if total and total + len(block) > CTX_CHARS:
            break
        if total + len(block) > CTX_CHARS:           # 1re fiche trop longue -> on tronque
            block = block[:CTX_CHARS] + "\n…[fiche tronquée]"
        blocks.append(block); used.append(c); total += len(block)
    return "\n\n---\n\n".join(blocks), used

def answer(query, retriever, k=5, model=CHAT_MODEL):
    cands = retriever.search(query, k=k)
    if not cands:
        print("Aucune fiche trouvée."); return
    context, used = build_context(cands)
    msgs = [{'role': 'system', 'content': SYSTEM},
            {'role': 'user',
             'content': f"Question : {query}\n\nFiches officielles :\n\n{context}\n\n/no_think"}]
    print(f"\n\033[1mQuestion :\033[0m {query}\n")
    if not ollama_up():
        print("(Ollama non joignable — voici les fiches candidates seulement.)")
    else:
        try:
            print("\033[1mRéponse (qwen3:0.6b, ancrée sur les fiches) :\033[0m\n")
            print(ollama_chat(msgs, model))
        except Exception as e:
            print(f"(génération impossible : {e})")
    print("\n\033[1mFiches consultées :\033[0m")
    for c in used:
        print(f"  • [{c['id']}] {c['title']} — {c['source_url']}")
    others = [c for c in cands if c not in used]
    if others:
        print("\033[1mAutres pistes :\033[0m")
        for c in others:
            print(f"  • [{c['id']}] {c['title']}")

# --------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('query', nargs='*', help='la question / requête')
    ap.add_argument('--search-only', action='store_true', help='montrer les fiches trouvées, sans LLM')
    ap.add_argument('--bm25-only', action='store_true', help='désactiver la recherche sémantique')
    ap.add_argument('--rebuild-embeddings', action='store_true', help='recalculer le cache d\'embeddings')
    ap.add_argument('-k', type=int, default=5, help='nombre de fiches candidates (défaut 5)')
    ap.add_argument('--model', default=CHAT_MODEL)
    args = ap.parse_args()
    q = ' '.join(args.query).strip()

    r = Retriever(use_embed=not args.bm25_only, rebuild=args.rebuild_embeddings)
    mode = 'hybride (BM25 + sémantique)' if r.emb is not None else 'lexicale (BM25)'
    print(f"Index : {len(r.cards)} fiches · recherche {mode}", file=sys.stderr)
    if not q:
        print("Cache d'embeddings prêt." if args.rebuild_embeddings else "Donne une question.")
        return
    if args.search_only:
        print(f"\nRequête : {q}\n")
        for i, c in enumerate(r.search(q, k=args.k), 1):
            print(f"{i}. [{c['id']}] {c['title']}")
            print(f"   {' › '.join(c.get('path', []))}")
            print(f"   {c.get('summary','')[:140]}")
    else:
        answer(q, r, k=args.k, model=args.model)

if __name__ == '__main__':
    main()
