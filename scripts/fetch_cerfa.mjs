// Auto-hébergement (D-03) du pré-remplissage CERFA : vendorise pdf-lib sous web/vendor/ et
// télécharge les PDF vierges des CERFA bundlés sous web/cerfa/ — pour que le remplissage soit
// 100 % local/hors-ligne (aucun CDN au runtime). Le TÉLÉCHARGEMENT (build) vient de
// service-public.gouv.fr ; l'EXÉCUTION est servie par notre origine / bundlée dans l'app native.
//
// Prérequis : npm i pdf-lib
// Usage     : node scripts/fetch_cerfa.mjs
//
// Étendre le pré-remplissage = ajouter le numéro ici (PDF téléchargé) ET l'entrée `CERFA` dans
// web/app.js (préfixe + mapping des champs, à inspecter avec pdf-lib getFields()). Seuls les
// « formulaireNG » ont des champs AcroForm remplissables ; les « Formulaire » plats sont ignorés.
import fs from 'node:fs';
import path from 'node:path';

const CERFAS = ['12669', '10431', '13753'];        // numéros de base bundlés (cf. registre app.js)
const SRC = 'node_modules/pdf-lib/dist/pdf-lib.esm.min.js';
const VENDOR = 'web/vendor/pdf-lib.esm.min.js';
const CERFA_DIR = 'web/cerfa';

fs.mkdirSync('web/vendor', { recursive: true });
fs.copyFileSync(SRC, VENDOR);
console.log('lib   pdf-lib.esm.min.js', (fs.statSync(VENDOR).size / 1e3).toFixed(0), 'Ko');

fs.mkdirSync(CERFA_DIR, { recursive: true });
for (const n of CERFAS) {
  const url = `https://www.formulaires.service-public.gouv.fr/gf/cerfa_${n}.do`;
  const r = await fetch(url);
  if (!r.ok) { console.log('ERR  ', n, r.status); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  const dest = path.join(CERFA_DIR, `${n}.pdf`);
  fs.writeFileSync(dest, buf);
  console.log('cerfa ', `${n}.pdf`, (buf.length / 1e3).toFixed(0), 'Ko');
}
console.log('OK — pdf-lib vendorisé + CERFA téléchargés sous', CERFA_DIR + '/');
