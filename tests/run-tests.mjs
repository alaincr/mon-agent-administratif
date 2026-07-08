#!/usr/bin/env node
// Tests de la logique métier du démonstrateur — exécutables sans navigateur (CI).
// Les scripts web (simu, chômage, parcours, déduction) sont chargés dans un sandbox `vm`
// avec des bouchons minimaux (localStorage, document) : seule la LOGIQUE est testée, le DOM
// étant couvert par les vérifications headless de développement.
//   node tests/run-tests.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const mem = () => { const s = {}; return { getItem: k => s[k] ?? null, setItem: (k,v) => s[k] = String(v), removeItem: k => delete s[k] }; };

const sandbox = {
  console, JSON, Math, Date, Number, String, Array, Object, RegExp, parseInt, parseFloat, isNaN,
  localStorage: mem(), sessionStorage: mem(),
  document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style:{}, appendChild(){}, querySelector: () => null }) },
  location: { hash: '', href: 'http://localhost/' },
  fetch: () => Promise.reject(new Error('pas de réseau en test')),
  esc: s => String(s ?? ''),                                   // fourni par app.js dans le navigateur
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['simu-bareme.js', 'simu.js', 'chomage.js', 'parcours.js', 'deduce.js'])
  vm.runInContext(readFileSync(path.join(WEB, f), 'utf8'), sandbox, { filename: f });
// les `const` top-level d'un script vm restent dans la portée lexicale du contexte : on les lit
// par évaluation (les `function`, elles, sont bien des propriétés du sandbox).
const g = expr => vm.runInContext(expr, sandbox);

// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.error('  ✗', name, '—', e.message); }
}
function eq(got, want, what){ if (got !== want) throw new Error(`${what ?? ''} attendu ${want}, obtenu ${got}`); }
function close(got, want, tol, what){ if (Math.abs(got - want) > tol) throw new Error(`${what ?? ''} attendu ≈${want}, obtenu ${got}`); }

// rejoue le questionnaire adaptatif SANS DOM : répond depuis un plan, retourne les verdicts
function runProfile(plan){
  const S = sandbox;
  const answers = {};
  for (let guard = 0; guard < 25; guard++){
    const a = S.simuNorm(answers);
    const evals = S.simuEval(a);
    const needs = [];
    evals.forEach(e => (e.out.need || []).forEach(f => { if (!needs.includes(f)) needs.push(f); }));
    if (!needs.length){
      const v = {};
      evals.forEach(e => { if (e.out.v) v[e.r.id] = e.out.v; });
      return { verdicts: v, questions: Object.keys(answers).length };
    }
    const field = g('SIMU_ORDER').find(f => needs.includes(f));
    if (plan[field] === undefined) throw new Error('plan sans réponse pour ' + field);
    answers[field] = plan[field];
  }
  throw new Error('boucle sans fin');
}

console.log('\n— barème OpenFisca généré —');
t('barème présent et daté', () => {
  const B = g('SIMU_BAREME');
  if (!B || !B.periode || !B.openfisca_france) throw new Error('SIMU_BAREME incomplet');
  if (!(B.rsa_socle.s0 > 500 && B.rsa_socle.s0 < 900)) throw new Error('rsa_socle.s0 hors plage : ' + B.rsa_socle.s0);
  if (!(B.rsa_socle.c3 > B.rsa_socle.s0)) throw new Error('échelle RSA non croissante');
  if (!(B.ppa_seuil.s0 >= 2000)) throw new Error('frontière PPA célibataire suspecte');
});

console.log('\n— « Mes aides » : questionnaire adaptatif (verdicts) —');
t('A. propriétaire aisé, seul : tout écarté en peu de questions', () => {
  // plan complet : selon le barème du mois, la règle PPA peut demander revact/activite/residence
  const r = runProfile({ enfants: 0, logement: 'proprietaire', handicap: 'non', age: 'adult',
                         couple: false, revenus: 3200, revact: 0, activite: 'non', residence: true });
  if (r.questions > 8) throw new Error('trop de questions : ' + r.questions);
  for (const k of ['rsa', 'ppa', 'apl', 'css']) eq(r.verdicts[k], 'non', k);
});
t('B. parent isolé, 2 enfants, 900 € : droits ouverts', () => {
  const r = runProfile({ enfants: 2, scolarises: 1, logement: 'locataire', handicap: 'non', age: 'adult', couple: false, revenus: 900, revact: 0, residence: true });
  eq(r.verdicts.rsa, 'oui', 'rsa'); eq(r.verdicts.af, 'oui', 'af');
  eq(r.verdicts.ars, 'oui', 'ars'); eq(r.verdicts.css, 'oui', 'css');
  eq(r.verdicts.apl, 'peut', 'apl'); eq(r.verdicts.ppa, 'non', 'ppa');
});
t('D. salarié célibataire 2 500 € : prime d\'activité détectée (frontière réelle)', () => {
  const r = runProfile({ enfants: 0, logement: 'locataire', handicap: 'non', age: 'adult', couple: false, revenus: 2500, revact: 2500, activite: 'non', residence: true });
  eq(r.verdicts.ppa, 'oui', 'ppa');
});
t('E. handicap 80 %, 500 € : AAH + RSA + CSS', () => {
  const r = runProfile({ enfants: 0, logement: 'heberge', handicap: '80', age: 'adult', couple: false, revenus: 500, revact: 0, residence: true });
  eq(r.verdicts.aah, 'oui', 'aah'); eq(r.verdicts.rsa, 'oui', 'rsa'); eq(r.verdicts.css, 'oui', 'css');
});

console.log('\n— chômage (ARE, règles Unédic datées) —');
t('t1. 2 200 € brut, 24 mois continus : 42,42 €/j, 13,5 mois', () => {
  const r = sandbox.areCalc({ motif: 'licenciement', age: 'u53', brut: 2200, mois: 24, couverts: 24 });
  close(r.areJour, 42.42, 0.02, 'ARE/j'); close(r.areMois, 1289, 2, 'ARE/mois'); eq(r.dureeMois, 13.5, 'durée');
});
t('t2. 5 500 € : dégressivité au 7ᵉ mois', () => {
  const r = sandbox.areCalc({ motif: 'licenciement', age: 'u53', brut: 5500, mois: 24, couverts: 24 });
  close(r.areJour, 103.13, 0.05, 'ARE/j');
  if (!r.degressif) throw new Error('dégressivité absente');
  close(r.degressif.areMois, 2800, 5, 'ARE dégressive');
});
t('t3. 4 mois travaillés : inéligible', () => eq(sandbox.areCalc({ motif: 'licenciement', age: 'u53', brut: 2200, mois: 4, couverts: 4 }).eligible, false));
t('t4. démission : inéligible (exceptions expliquées)', () => {
  const r = sandbox.areCalc({ motif: 'demission', age: 'u53', brut: 2200, mois: 24 });
  eq(r.eligible, false); if (!/reconversion/.test(r.motifKo)) throw new Error('exceptions non mentionnées');
});
t('t5. 55 ans, 30 mois/36 : durée senior 20,5 mois', () => {
  const r = sandbox.areCalc({ motif: 'fin_cdd', age: 'a55', brut: 1800, mois: 30, couverts: 36 });
  close(r.areJour, 33.11, 0.05, 'ARE/j'); eq(r.dureeMois, 20.5, 'durée');
});
t('cumul activité réduite : règle des 70 % + droits préservés', () => {
  const r = sandbox.areCalc({ motif: 'licenciement', age: 'u53', brut: 2130, mois: 18, couverts: 22 });
  const c = sandbox.areCumul(r, 800);
  close(c.alloc, r.areMois - 0.7 * 800, 1, 'allocation maintenue');
  close(c.total, c.alloc + 800, 0.01, 'total');
  if (!(c.prolongeParMois > 5)) throw new Error('prolongation des droits absente');
});

console.log('\n— parcours « événements de vie » —');
t('chomage, naissance, décès : 8 étapes chacun, échéances clés', () => {
  const P = g('PARCOURS');
  eq(P.chomage.etapes.length, 8, 'étapes chômage'); eq(P.naissance.etapes.length, 8, 'étapes naissance');
  eq(P.deces.etapes.length, 8, 'étapes décès');
  const fin = '2026-06-17';
  const insc = P.chomage.etapes.find(e => e.id === 'inscription').quand(fin);
  eq(insc.due.toISOString().slice(0, 10), '2027-06-17', 'inscription = fin + 12 mois');
  const nais = P.naissance.etapes.find(e => e.id === 'naissance').quand('2026-11-04');
  eq(nais.due.toISOString().slice(0, 10), '2026-11-09', 'déclaration = accouchement + 5 j');
  const dcl = P.deces.etapes.find(e => e.id === 'declaration').quand('2026-07-01');
  eq(dcl.due.toISOString().slice(0, 10), '2026-07-02', 'déclaration décès = 24 h');
  const suc = P.deces.etapes.find(e => e.id === 'succession').quand('2026-07-01');
  eq(suc.due.toISOString().slice(0, 10), '2026-12-28', 'succession = 6 mois');
});
t('export agenda .ics : événement daté avec alarme', () => {
  const ev = sandbox.icsEvent('t', new Date('2026-10-10'), 'Déclarer la naissance', 'Sous 5 jours.');
  for (const frag of ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261010', 'VALARM', 'SUMMARY:Déclarer la naissance'])
    if (!ev.includes(frag)) throw new Error(frag + ' manquant');
});

console.log('\n— déduction du cas depuis la phrase —');
t('« seule avec deux enfants, je perds mon CDD »', () => {
  const d = sandbox.deduceFacts('je suis seule avec deux enfants et je perds mon CDD');
  eq(d.facts.couple, false, 'couple'); eq(d.facts.enfants, 2, 'enfants'); eq(d.facts.motif, 'fin_cdd', 'motif');
});
t('« licencié à 54 ans, marié, 3 enfants, locataire »', () => {
  const d = sandbox.deduceFacts('licencié à 54 ans, marié, 3 enfants, locataire');
  eq(d.facts.motif, 'licenciement'); eq(d.facts.ageAns, 54); eq(d.facts.couple, true);
  eq(d.facts.enfants, 3); eq(d.facts.logement, 'locataire');
});
t('« j\'ai perdu mon passeport » : rien à déduire', () => eq(sandbox.deduceFacts("j'ai perdu mon passeport"), null));
t('« retraitée propriétaire » : statuts', () => {
  const d = sandbox.deduceFacts('je suis retraitée et propriétaire');
  eq(d.facts.age, 'senior'); eq(d.facts.logement, 'proprietaire');
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
