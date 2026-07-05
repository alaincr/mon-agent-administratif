// Précalcule les vecteurs sémantiques des fiches (Transformers.js, Node) pour la PWA.
// Modèle : multilingual-e5-small (384 dim). Sortie : web/data/embeddings.bin (+ .meta.json).
// Le navigateur n'encodera QUE la requête avec le même modèle (WASM, sans GPU).
import { pipeline } from '@huggingface/transformers';
import fs from 'node:fs';

const MODEL = 'Xenova/multilingual-e5-small';
const DIM = 384, BATCH = 32;

const fiches = fs.readFileSync('index/fiches.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
console.log(`${fiches.length} fiches · chargement du modèle ${MODEL}…`);
const extract = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });  // q8 = même modèle que le navigateur

const buf = Buffer.alloc(fiches.length * DIM * 4);
const ids = [];
let off = 0;
for (let i = 0; i < fiches.length; i += BATCH) {
  const batch = fiches.slice(i, i + BATCH);
  const texts = batch.map(f => 'passage: ' + (f.title || '') + '. ' + (f.summary || ''));
  const out = await extract(texts, { pooling: 'mean', normalize: true });
  const data = out.data;
  for (let j = 0; j < batch.length; j++) {
    ids.push(batch[j].id);
    for (let k = 0; k < DIM; k++) { buf.writeFloatLE(data[j * DIM + k], off); off += 4; }
  }
  if (i % (BATCH * 10) === 0) console.log(`  ${i}/${fiches.length}`);
}

fs.writeFileSync('web/data/embeddings.bin', buf);
fs.writeFileSync('web/data/embeddings.meta.json',
  JSON.stringify({ model: MODEL, dim: DIM, count: ids.length, ids }));
console.log(`OK : ${ids.length} vecteurs × ${DIM} -> web/data/embeddings.bin (${(buf.length/1e6).toFixed(1)} Mo)`);
