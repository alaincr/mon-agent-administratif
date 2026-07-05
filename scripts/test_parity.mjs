// Test de parité des embeddings (PRD R2.2).
// Ré-encode un échantillon de fiches avec le MÊME modèle/préfixe que le build
// (multilingual-e5-small, q8, "passage: ") et compare aux vecteurs stockés dans
// web/data/embeddings.bin. Similarité cosinus attendue > 0,99. Détecte : dérive de
// build, désalignement d'ordre, ou oubli du préfixe E5. Sortie non nulle si échec (CI).
//
// Usage : node scripts/test_parity.mjs
import { pipeline } from '@huggingface/transformers';
import fs from 'node:fs';

const DIM = 384, THRESHOLD = 0.99, SAMPLE = 25;

const meta = JSON.parse(fs.readFileSync('web/data/embeddings.meta.json', 'utf8'));
const bin = new Float32Array(fs.readFileSync('web/data/embeddings.bin').buffer);
const fiches = fs.readFileSync('index/fiches.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
const byId = new Map(fiches.map(f => [f.id, f]));

if (meta.dim !== DIM) { console.error(`dim inattendue: ${meta.dim}`); process.exit(1); }
if (bin.length !== meta.ids.length * DIM) {
  console.error(`taille bin (${bin.length}) != ids*dim (${meta.ids.length*DIM})`); process.exit(1);
}

const extract = await pipeline('feature-extraction', meta.model, { dtype: 'q8' });

// échantillon réparti sur tout le corpus
const step = Math.max(1, Math.floor(meta.ids.length / SAMPLE));
let worst = 1, fails = 0, tested = 0;
for (let r = 0; r < meta.ids.length; r += step) {
  const id = meta.ids[r], f = byId.get(id);
  if (!f) { console.error(`id ${id} absent de fiches.jsonl`); fails++; continue; }
  const text = 'passage: ' + (f.title || '') + '. ' + (f.summary || '');
  const out = await extract(text, { pooling: 'mean', normalize: true });
  const q = out.data;
  let dot = 0;
  for (let k = 0; k < DIM; k++) dot += q[k] * bin[r * DIM + k];   // vecteurs déjà normalisés
  tested++;
  if (dot < worst) worst = dot;
  if (dot < THRESHOLD) { fails++; console.error(`FAIL ${id}: cos=${dot.toFixed(4)}`); }
}

console.log(`parité embeddings : ${tested} testées, cosinus min = ${worst.toFixed(4)}, seuil ${THRESHOLD}`);
if (fails) { console.error(`ÉCHEC : ${fails} fiche(s) sous le seuil`); process.exit(1); }
console.log('OK — vecteurs stockés cohérents avec un ré-encodage (préfixe « passage: » confirmé)');
