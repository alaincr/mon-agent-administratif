// Auto-hébergement (D-03 / R8.1) de l'assistant IA WebLLM : vendorise la lib web-llm sous
// web/vendor/web-llm/, et télécharge la lib WASM + les poids de CHAQUE modèle sous
// web/models/webllm/ — pour qu'AUCUNE ressource (script ni poids) ne vienne d'un CDN au runtime.
// TÉLÉCHARGEMENT (build) depuis HF/GitHub ; EXÉCUTION 100 % servie par notre origine.
//
// WebGPU seulement (navigateur, dont Chrome Android). Inutile dans la WebView native (masqué).
// Exclure web/models/webllm du bundle natif (post cap sync).
//
// Prérequis : npm i @mlc-ai/web-llm
// Usage     : node scripts/fetch_webllm.mjs
import fs from 'node:fs';
import path from 'node:path';

// Modèles auto-hébergés (id = model_id WebLLM ; repo = dépôt HF ; wasm = lib compilée WebGPU).
const MODELS = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', repo: 'mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    wasm: 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm' },
  { id: 'gemma3-1b-it-q4f16_1-MLC', repo: 'mlc-ai/gemma3-1b-it-q4f16_1-MLC',
    wasm: 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm' },
];
const VENDOR = 'web/vendor/web-llm';
const MODELS_DIR = 'web/models/webllm';
const LIBDIR = path.join(MODELS_DIR, 'lib');

// 1) vendoriser la lib (build ESM auto-suffisant)
fs.mkdirSync(VENDOR, { recursive: true });
fs.copyFileSync('node_modules/@mlc-ai/web-llm/lib/index.js', path.join(VENDOR, 'index.js'));
console.log('lib   web-llm/index.js', (fs.statSync(path.join(VENDOR, 'index.js')).size / 1e6).toFixed(1), 'Mo');

async function dl(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { console.log('skip ', path.basename(dest)); return fs.statSync(dest).size; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return fs.statSync(dest).size;
}

fs.mkdirSync(LIBDIR, { recursive: true });
let total = 0;
for (const m of MODELS) {
  // lib WASM du modèle
  console.log('dl    lib', path.basename(m.wasm), ((await dl(m.wasm, path.join(LIBDIR, path.basename(m.wasm)))) / 1e6).toFixed(1), 'Mo');
  // poids + config + tokenizer, servis sous <id>/resolve/main/ (web-llm force /resolve/main/, cf. cleanModelUrl)
  const weights = path.join(MODELS_DIR, m.id, 'resolve', 'main');
  const tree = await (await fetch(`https://huggingface.co/api/models/${m.repo}/tree/main?recursive=true`)).json();
  for (const e of tree.filter(x => x.type === 'file')) {
    const n = await dl(`https://huggingface.co/${m.repo}/resolve/main/${e.path}`, path.join(weights, e.path));
    total += n;
    console.log('dl   ', m.id, e.path, (n / 1e6).toFixed(1), 'Mo');
  }
}
console.log(`OK — WebLLM auto-hébergé : lib + ${(total / 1e6).toFixed(0)} Mo de poids (${MODELS.length} modèles) sous ${MODELS_DIR}/`);
