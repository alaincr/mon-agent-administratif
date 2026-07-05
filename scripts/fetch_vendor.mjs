// Auto-hébergement (D-03 / R8.1) : place la lib Transformers.js + le runtime ORT (WASM)
// sous web/vendor/, et les poids des modèles sous web/models/ — pour qu'AUCUNE ressource
// ML ne soit chargée depuis un CDN tiers au runtime. Le TÉLÉCHARGEMENT (build) vient de
// Hugging Face ; l'EXÉCUTION (runtime) est 100 % servie par notre origine.
//
// Prérequis : npm i @huggingface/transformers@3.8.1  (version qui gère Whisper)
// Usage     : node scripts/fetch_vendor.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'node_modules/@huggingface/transformers/dist';
const VENDOR = 'web/vendor/transformers';
const MODELS = 'web/models';
// modèles servis en local (q8 = variante « _quantized ») :
const REPOS = ['Xenova/multilingual-e5-small', 'Xenova/whisper-base'];
// fichiers de la lib à vendoriser (build web + runtime ORT jsep = wasm + glue) :
// transformers.min.js = bundle ESM AUTO-SUFFISANT (ORT inclus) ; le .wasm est chargé au runtime.
const LIB = ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs'];

fs.mkdirSync(VENDOR, { recursive: true });
for (const f of LIB) {
  fs.copyFileSync(path.join(DIST, f), path.join(VENDOR, f));
  console.log('lib  ', f, (fs.statSync(path.join(VENDOR, f)).size / 1e6).toFixed(1), 'Mo');
}

async function dl(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

let total = 0;
for (const repo of REPOS) {
  const tree = await (await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`)).json();
  // tout SAUF les onnx (petits configs/tokenizers) + uniquement les onnx quantifiés (q8)
  const wanted = tree.filter(e => e.type === 'file' &&
    (!e.path.startsWith('onnx/') || /quantized/.test(e.path)) &&
    // décodeurs Whisper non-fusionnés inutiles (le pipeline utilise le décodeur « merged ») :
    !/decoder_with_past|decoder_model_quantized\.onnx$/.test(e.path) &&
    !/\.(md|gitattributes)$/i.test(e.path));
  for (const e of wanted) {
    const dest = path.join(MODELS, repo, e.path);
    if (fs.existsSync(dest) && fs.statSync(dest).size === e.size) { console.log('skip ', repo, e.path); continue; }
    const n = await dl(`https://huggingface.co/${repo}/resolve/main/${e.path}`, dest);
    total += n;
    console.log('dl   ', repo, e.path, (n / 1e6).toFixed(1), 'Mo');
  }
}
console.log(`OK — modèles téléchargés : ${(total / 1e6).toFixed(1)} Mo sous ${MODELS}/`);
