// Simulateur « Mes aides » : éligibilité INDICATIVE aux principales prestations sociales,
// calculée 100 % EN LOCAL (aucune donnée transmise). MINIMISATION DES DONNÉES : questionnaire
// ADAPTATIF — chaque règle s'évalue sur des réponses partielles et déclare ce qui lui manque
// ({need:[champs]}) ; on ne pose une question QUE si une aide encore indécise en a besoin, et le
// parcours s'arrête dès que tout est tranché (ex. : propriétaire → aides au logement écartées à la
// 2e question, sans demander les revenus ; la résidence en France n'est demandée que si un droit
// est presque ouvert). SEUILS INDICATIFS (barèmes avril 2025, métropole) : verdicts prudents
// (« probable / à vérifier / peu probable »), jamais un montant promis ; chaque carte renvoie vers
// la fiche locale + le simulateur officiel.
// Seuils : calculés par OpenFisca-France (moteur officiel des règles socio-fiscales) via
// scripts/build_simu_bareme.py → web/simu-bareme.js (montants forfaitaires RSA exacts par foyer,
// frontières réelles d'annulation de la prime d'activité, plafonds ASPA/AAH/CSS/ARS datés).
// Repli sur des constantes (avril 2025) si le barème généré est absent.
const BAREME = (typeof SIMU_BAREME !== 'undefined') ? SIMU_BAREME : null;
const SIMU_BAREME_DATE = BAREME
  ? 'OpenFisca-France ' + BAREME.openfisca_france + ', période ' + BAREME.periode
  : 'avril 2025';
// clé de configuration du foyer pour les tables du barème : s0..s3 / c0..c3
function baremeKey(a){ return (a.couple ? 'c' : 's') + Math.min(a.enfants, 3); }
const SIMU_KEY = 'sp_simu_v2';                    // réponses mémorisées sur l'appareil uniquement

function getSimu(){ try{ return JSON.parse(localStorage.getItem(SIMU_KEY)||'{}'); }catch(e){ return {}; } }
function setSimu(a){ try{ localStorage.setItem(SIMU_KEY, JSON.stringify(a)); }catch(e){} }
function fmtEur(n){ return Math.round(n).toLocaleString('fr-FR') + ' €'; }

// Échelle de foyer commune (approximation des unités de consommation des plafonds CAF/CSS).
function foyerScale(a){
  return 1 + (a.couple ? 0.5 : 0) + 0.3*Math.min(a.enfants,2) + 0.4*Math.max(a.enfants-2,0);
}
// Champs manquants parmi ceux listés → {need:[...]} à remonter, sinon null (on peut continuer).
function miss(a){
  const m = Array.prototype.slice.call(arguments,1).filter(k => a[k] === undefined);
  return m.length ? { need:m } : null;
}

// ----- les questions (posées UNE PAR UNE, seulement si nécessaires) -----
// L'âge est demandé en TRANCHES (pas l'âge exact : donnée plus sobre, suffisante pour les règles).
// « activite » est réduit à « êtes-vous étudiant·e ? » (seul cas où la règle en a besoin).
const SIMU_FIELDS = {
  enfants:    { q:'Combien d\'enfants de moins de 20 ans avez-vous à charge ?',
                opts:()=>[[0,'Aucun'],[1,'1 enfant'],[2,'2 enfants'],[3,'3 enfants'],[4,'4 ou plus']] },
  scolarises: { q:'Combien sont scolarisés, de 6 à 18 ans ?',
                opts:a=>Array.from({length:Math.min(a.enfants,4)+1},(_,i)=>[i, i===0?'Aucun':String(i)]) },
  logement:   { q:'Pour votre logement, vous êtes…',
                opts:()=>[['locataire','Locataire'],['proprietaire','Propriétaire'],['heberge','Hébergé·e gratuitement']] },
  handicap:   { q:'Avez-vous un handicap reconnu par la MDPH ?',
                opts:()=>[['non','Non (ou pas de reconnaissance)'],['5079','Oui, taux de 50 à 79 %'],['80','Oui, taux de 80 % ou plus']] },
  age:        { q:'Votre âge ?',
                opts:()=>[['u18','Moins de 18 ans'],['u25','18 à 24 ans'],['adult','25 à 64 ans'],['senior','65 ans ou plus']] },
  couple:     { q:'Vivez-vous en couple ?',
                opts:()=>[[false,'Non, je vis seul·e'],[true,'Oui, en couple']] },
  revenus:    { q:'Revenus nets mensuels de votre foyer, en € ?', eur:true,
                hint:'Salaires, pensions, chômage… avant aides (CAF, etc.). Un ordre de grandeur suffit.' },
  revact:     { q:'Vos revenus d\'activité mensuels (salaire, indépendant), en € ?', eur:true,
                hint:'Indiquez 0 si vous ne travaillez pas actuellement.' },
  activite:   { q:'Êtes-vous étudiant·e ou apprenti·e ?',
                opts:()=>[['non','Non'],['etudiant','Oui']] },
  residence:  { q:'Vivez-vous en France de façon stable (au moins 9 mois par an) ?',
                opts:()=>[[true,'Oui'],[false,'Non']] },
};
// Ordre de préférence : d'abord les questions « filtres » bon marché (qui écartent des aides sans
// donnée sensible), les montants ensuite, la résidence en dernier (rarement nécessaire).
const SIMU_ORDER = ['enfants','scolarises','logement','handicap','age','couple','revenus','revact','activite','residence'];

// ----- les règles : v:'oui'|'peut'|'non' (tranché), v:null (non concerné), ou {need:[champs]} -----
const SIMU_RULES = [
  { id:'rsa', nom:'RSA (revenu de solidarité active)', q:'RSA',
    simu:'https://www.mesdroitssociaux.gouv.fr/', org:'CAF ou MSA',
    test(a){
      let m;
      if(m = miss(a,'age')) return m;
      if(a.age === 'u18') return { v:'non', why:'Le RSA n\'est pas ouvert avant 18 ans.' };
      if(a.age === 'u25'){
        if(m = miss(a,'couple','enfants')) return m;
        if(!(!a.couple && a.enfants > 0))
          return { v:'peut', why:'Avant 25 ans, le RSA n\'est ouvert qu\'aux parents isolés ou sous conditions d\'activité antérieure (« RSA jeune actif »).' };
      }
      if(m = miss(a,'couple','enfants','revenus')) return m;
      const isole = !a.couple && a.enfants > 0;
      const forfait = BAREME && BAREME.rsa_socle
        ? (isole && BAREME.rsa_socle_isole ? BAREME.rsa_socle_isole[baremeKey(a)] : BAREME.rsa_socle[baremeKey(a)])
          || BAREME.rsa_socle[baremeKey(a)]
        : 646.52 * foyerScale(a) * (isole ? 1.28 : 1);               // repli (avril 2025)
      if(a.revenus >= forfait*1.25)
        return { v:'non', why:`Vos ressources dépassent nettement le montant forfaitaire indicatif (≈ ${fmtEur(forfait)}/mois pour votre foyer).` };
      if(m = miss(a,'residence')) return m;                          // demandée seulement si le droit est plausible
      if(!a.residence) return { v:'non', why:'Le RSA demande une résidence stable et régulière en France.' };
      if(a.revenus < forfait)
        return { v:'oui', why:`Vos ressources (${fmtEur(a.revenus)}/mois) semblent inférieures au montant forfaitaire indicatif de votre foyer (≈ ${fmtEur(forfait)}).` };
      return { v:'peut', why:'Vos ressources sont proches du plafond : le calcul exact (forfait logement, nature des ressources) peut faire basculer le droit.' };
    }},
  { id:'ppa', nom:'Prime d\'activité', q:'prime d\'activité',
    simu:'https://www.caf.fr/allocataires/mes-services-en-ligne/faire-une-simulation', org:'CAF ou MSA',
    test(a){
      let m;
      if(m = miss(a,'age')) return m;
      if(a.age === 'u18') return { v:'non', why:'Il faut avoir au moins 18 ans.' };
      if(m = miss(a,'couple','enfants','revenus')) return m;
      // frontière RÉELLE d'annulation de la prime (salaire où ppa→0, calcul OpenFisca complet)
      const plafond = (BAREME && BAREME.ppa_seuil && BAREME.ppa_seuil[baremeKey(a)]) || 2000 * foyerScale(a);
      if(a.revenus >= plafond*1.2)
        return { v:'non', why:'Les ressources du foyer semblent dépasser le plafond indicatif.' };
      if(m = miss(a,'revact')) return m;
      if(a.revact <= 0)
        return { v:'non', why:'La prime d\'activité est réservée aux personnes qui ont des revenus d\'activité (salariés, indépendants).' };
      if(a.revact < 1100){
        if(m = miss(a,'activite')) return m;         // le statut étudiant ne compte que sous ~1 100 €
        if(a.activite === 'etudiant')
          return { v:'peut', why:'Étudiant ou apprenti : il faut environ 1 100 €/mois de revenus d\'activité (ou être parent) pour y avoir droit.' };
      }
      if(m = miss(a,'residence')) return m;
      if(!a.residence) return { v:'non', why:'La prime d\'activité demande une résidence stable en France.' };
      if(a.revenus < plafond)
        return { v:'oui', why:`Vous travaillez et les ressources du foyer (${fmtEur(a.revenus)}/mois) semblent sous le plafond indicatif (≈ ${fmtEur(plafond)}).` };
      return { v:'peut', why:'Ressources proches du plafond : seule la simulation officielle tranchera.' };
    }},
  { id:'apl', nom:'Aides au logement (APL, ALS, ALF)', q:'aide au logement APL',
    simu:'https://www.caf.fr/allocataires/mes-services-en-ligne/faire-une-simulation', org:'CAF ou MSA',
    test(a){
      let m;
      if(m = miss(a,'logement')) return m;
      if(a.logement !== 'locataire')
        return { v:'non', why:'Les aides au logement concernent surtout les locataires (et certains accédants sous ancien prêt conventionné).' };
      if(m = miss(a,'couple','enfants','revenus')) return m;
      if(a.revenus < 2600 * foyerScale(a))
        return { v:'peut', why:'Vous êtes locataire : le droit dépend du loyer, de la commune (zone) et des ressources — la simulation CAF donne le montant en 2 minutes.' };
      return { v:'non', why:'Avec ces ressources, une aide au logement est peu probable (mais la simulation officielle reste gratuite et rapide).' };
    }},
  { id:'aah', nom:'AAH (allocation aux adultes handicapés)', q:'AAH allocation adultes handicapés',
    simu:'https://www.mesdroitssociaux.gouv.fr/', org:'MDPH puis CAF',
    test(a){
      let m;
      if(m = miss(a,'handicap')) return m;
      if(a.handicap === 'non') return { v:null };
      if(m = miss(a,'age')) return m;
      if(a.age === 'u18') return { v:'peut', why:'Avant 18-20 ans, c\'est en principe l\'AEEH (versée aux parents) ; l\'AAH peut s\'ouvrir dès 16 ans dans certains cas.' };
      if(a.handicap !== '80')
        return { v:'peut', why:'Taux entre 50 et 79 % : il faut en plus une restriction substantielle et durable d\'accès à l\'emploi, appréciée par la MDPH.' };
      if(m = miss(a,'revact')) return m;             // AAH déconjugalisée : revenus PERSONNELS
      return a.revact < ((BAREME && BAREME.aah_mois) || 1034)
        ? { v:'oui',  why:'Taux d\'incapacité ≥ 80 % et revenus personnels sous le plafond indicatif : droit probable (décision MDPH requise).' }
        : { v:'peut', why:'Taux ≥ 80 % mais revenus personnels proches ou au-dessus du plafond : l\'AAH peut être réduite ou différentielle.' };
    }},
  { id:'aspa', nom:'ASPA (minimum vieillesse)', q:'ASPA allocation solidarité personnes âgées',
    simu:'https://www.mesdroitssociaux.gouv.fr/', org:'Carsat (ou MSA)',
    test(a){
      let m;
      if(m = miss(a,'age')) return m;
      if(a.age !== 'senior') return { v:null };
      if(m = miss(a,'couple','revenus')) return m;
      const plafond = BAREME
        ? (a.couple ? BAREME.aspa_couple_mois : BAREME.aspa_seul_mois)
        : (a.couple ? 1605.73 : 1034.28);
      if(a.revenus < plafond)
        return { v:'oui', why:`Vos ressources (${fmtEur(a.revenus)}/mois) semblent sous le plafond ASPA (${fmtEur(plafond)} ${a.couple?'pour un couple':'pour une personne seule'}).` };
      if(a.revenus < plafond*1.1)
        return { v:'peut', why:'Ressources très proches du plafond : certaines ressources sont exclues du calcul, la demande vaut la peine.' };
      return { v:'non', why:'Vos ressources dépassent le plafond ASPA.' };
    }},
  { id:'af', nom:'Allocations familiales', q:'allocations familiales',
    simu:'https://www.caf.fr/allocataires/mes-services-en-ligne/faire-une-simulation', org:'CAF ou MSA',
    test(a){
      let m;
      if(m = miss(a,'enfants')) return m;
      if(a.enfants === 0) return { v:null };
      if(a.enfants < 2) return { v:'non', why:'Les allocations familiales sont versées à partir de 2 enfants à charge de moins de 20 ans.' };
      return { v:'oui', why:`${a.enfants >= 4 ? '4 enfants ou plus' : a.enfants + ' enfants'} à charge : droit quasi certain — le montant est simplement modulé selon les revenus du foyer.` };
    }},
  { id:'ars', nom:'ARS (allocation de rentrée scolaire)', q:'allocation rentrée scolaire',
    simu:'https://www.caf.fr/allocataires/mes-services-en-ligne/faire-une-simulation', org:'CAF ou MSA',
    test(a){
      let m;
      if(m = miss(a,'enfants')) return m;
      if(a.enfants === 0) return { v:null };
      if(m = miss(a,'scolarises')) return m;
      if(a.scolarises === 0) return { v:null };
      if(m = miss(a,'revenus')) return m;
      // formule officielle : plafond de base × (1 + majoration × nb d'enfants À CHARGE)
      const plafondAn = BAREME && BAREME.ars_plafond_an
        ? BAREME.ars_plafond_an * (1 + (BAREME.ars_maj_enfant || 0.3) * a.enfants)
        : 27141 + 6264*Math.max(a.scolarises-1,0);                 // repli (2025)
      const revAn = a.revenus*12;
      if(revAn < plafondAn)
        return { v:'oui', why:`Enfant(s) scolarisé(s) de 6 à 18 ans et revenus annuels estimés (${fmtEur(revAn)}) sous le plafond indicatif (${fmtEur(plafondAn)}).` };
      if(revAn < plafondAn*1.1)
        return { v:'peut', why:'Revenus légèrement au-dessus du plafond : une ARS réduite (différentielle) est possible.' };
      return { v:'non', why:'Les revenus du foyer semblent dépasser le plafond de l\'ARS.' };
    }},
  { id:'css', nom:'Complémentaire santé solidaire', q:'complémentaire santé solidaire',
    simu:'https://www.mesdroitssociaux.gouv.fr/', org:'Assurance maladie (CPAM)',
    test(a){
      let m;
      if(m = miss(a,'couple','enfants','revenus')) return m;
      // échelle de foyer OFFICIELLE de la CSS (par personne : 2e +50 %, 3e-4e +30 %, 5e+ +40 %)
      let gratuit, participation;
      if(BAREME && BAREME.css_plafond_an){
        const n = 1 + (a.couple ? 1 : 0) + a.enfants;
        const sc = 1 + (n >= 2 ? BAREME.css_coeff_p2 : 0)
                 + BAREME.css_coeff_p3_p4 * Math.max(Math.min(n, 4) - 2, 0)
                 + BAREME.css_coeff_p5 * Math.max(n - 4, 0);
        gratuit = BAREME.css_plafond_an / 12 * sc;
        participation = gratuit * (BAREME.css_facteur_participation || 1.35);
      } else {
        const sc = foyerScale(a);
        gratuit = 847*sc; participation = 1143*sc;                 // repli (2025)
      }
      if(a.revenus < gratuit)
        return { v:'oui', why:`Ressources (${fmtEur(a.revenus)}/mois) sous le plafond indicatif (${fmtEur(gratuit)}) : CSS probablement gratuite.` };
      if(a.revenus < participation)
        return { v:'oui', why:`Ressources sous ${fmtEur(participation)}/mois : CSS probable avec une petite participation (moins de 1,50 €/jour et par personne).` };
      if(a.revenus < participation*1.1)
        return { v:'peut', why:'Ressources très proches du plafond : le calcul officiel (sur les 12 derniers mois) peut différer.' };
      return { v:'non', why:'Les ressources du foyer semblent dépasser les plafonds de la CSS.' };
    }},
];

const SIMU_BADGE = { oui:['ok','Droit probable'], peut:['warn','À vérifier'], non:['ko','Peu probable'] };

// Réponses normalisées avant évaluation (cohérence scolarisés ≤ enfants).
function simuNorm(s){
  const a = Object.assign({}, s);
  if(a.scolarises !== undefined && a.enfants !== undefined) a.scolarises = Math.min(a.scolarises, a.enfants);
  return a;
}
function simuEval(a){ return SIMU_RULES.map(r => ({ r, out: r.test(a) })); }

function simuCardHtml(r, out){
  const [cls,label] = SIMU_BADGE[out.v];
  return `<div class="sim-card">
    <div class="sim-head"><span class="sim-badge ${cls}">${label}</span><b>${r.nom}</b></div>
    <p class="sim-why">${out.why}</p>
    <p class="sim-links">
      <a class="lien" href="#/q/${encodeURIComponent(r.q)}">Voir la fiche</a> ·
      <a class="lien" href="${r.simu}" target="_blank" rel="noopener noreferrer">Simulateur officiel ↗</a>
      <span class="muted">· ${r.org}</span>
    </p>
  </div>`;
}

// ----- écran « Mes aides » (#/aides) : une question à la fois, arrêt dès que tout est tranché -----
let simAnswers = {};
function renderSimu(){
  const d = document.querySelector('#detail');
  simAnswers = getSimu();
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  d.innerHTML = `
    <div class="dnav"><button class="back" type="button">${back}<span>Retour</span></button><span class="dt">Mes aides</span></div>
    <div class="dbody">
      <h2>Ai-je droit à des aides ?</h2>
      <p class="pnote">Quelques questions, <b>une à la fois — uniquement celles qui servent</b> à trancher les aides. Tout est calculé <b>sur cet appareil</b>, rien n'est transmis. Résultat indicatif : la décision appartient aux organismes (CAF, CPAM, Carsat…).</p>
      <div id="sim-flow"></div>
      <div id="sim-live" class="sim-live" aria-live="polite"></div>
      <div id="sim-res" class="sim-res" aria-live="polite"></div>
      <p class="sim-restart"><a class="lien" href="#">Recommencer (effacer mes réponses)</a></p>
    </div>`;
  d.querySelector('.back').onclick = ()=>{ if(history.length>1) history.back(); else location.hash='#'; };
  d.querySelector('.sim-restart a').onclick = e => {
    e.preventDefault();
    simAnswers = {}; setSimu(simAnswers);
    d.querySelector('#sim-res').innerHTML = ''; d.querySelector('#sim-live').innerHTML = '';
    simuStep(d);
  };
  simuStep(d);
}

function simuStep(d){
  const a = simuNorm(simAnswers);
  const evals = simuEval(a);
  const needs = [];
  evals.forEach(e => (e.out.need||[]).forEach(f => { if(!needs.includes(f)) needs.push(f); }));
  // aides déjà tranchées : affichées au fil de l'eau (l'usager voit l'intérêt de chaque réponse)
  const done = evals.filter(e => e.out.v !== undefined && e.out.v !== null);
  const live = d.querySelector('#sim-live');
  live.innerHTML = done.length && needs.length
    ? '<p class="sim-lt">Déjà estimé :</p>' + done.map(e =>
        `<p class="sim-mini"><span class="sim-badge ${SIMU_BADGE[e.out.v][0]}">${SIMU_BADGE[e.out.v][1]}</span> ${e.r.nom.split(' (')[0]}</p>`).join('')
    : '';
  if(!needs.length){ simuFinish(d, evals); return; }
  const field = SIMU_ORDER.find(f => needs.includes(f));
  simuAsk(d, field, a);
}

function simuAsk(d, field, a){
  const f = SIMU_FIELDS[field];
  const flow = d.querySelector('#sim-flow');
  const undecided = simuEval(a).filter(e => e.out.need).length;
  const prog = `<p class="sim-prog">${Object.keys(simAnswers).length ? Object.keys(simAnswers).length + ' réponse(s) donnée(s) · ' : ''}encore ${undecided} aide${undecided>1?'s':''} à trancher</p>`;
  if(f.eur){
    flow.innerHTML = `${prog}<div class="q"><h4>${f.q}</h4>
      ${f.hint ? `<p class="sim-hint">${f.hint}</p>` : ''}
      <div class="sim-eur"><input type="number" inputmode="decimal" min="0" placeholder="ex. 1500" aria-label="${f.q}"><button class="btn act" type="button">Continuer</button></div>
      <div class="sim-cert"></div></div>`;
    const inp = flow.querySelector('input'), go = flow.querySelector('button');
    // donnée CERTIFIÉE du coffre (avis d'imposition scanné) : proposer le RFR mensualisé pour la
    // question des revenus du foyer — l'usager valide toujours (approximation : RFR annuel ÷ 12).
    if(field === 'revenus' && window.coffreRFR){
      const c = coffreRFR();
      if(c && c.rfr > 0){
        const mens = Math.round(c.rfr / 12);
        const cert = flow.querySelector('.sim-cert');
        cert.innerHTML = `<button class="opt" type="button">Utiliser mon avis d'imposition scanné${c.annee ? ' (revenus ' + esc(String(c.annee)) + ')' : ''} :
          <b>≈ ${mens.toLocaleString('fr-FR')} €/mois</b> <span class="muted">(RFR ${Number(c.rfr).toLocaleString('fr-FR')} € ÷ 12${c.verif === 'valide' ? ', authenticité vérifiée' : ''})</span></button>`;
        cert.querySelector('button').onclick = () => {
          simAnswers[field] = mens; setSimu(simAnswers); simuStep(d);
        };
      }
    }
    const submit = () => {
      const v = parseFloat(String(inp.value).replace(',','.'));
      if(isNaN(v) || v < 0){ inp.focus(); return; }
      simAnswers[field] = Math.min(v, 99999); setSimu(simAnswers); simuStep(d);
    };
    go.onclick = submit;
    inp.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); submit(); } });
    inp.focus();
  } else {
    const opts = f.opts(a);
    flow.innerHTML = `${prog}<div class="q"><h4>${f.q}</h4><div class="opts">${
      opts.map((o,i)=>`<button class="opt" type="button" data-i="${i}">${o[1]}</button>`).join('')}</div></div>`;
    flow.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      simAnswers[field] = opts[+b.dataset.i][0]; setSimu(simAnswers); simuStep(d);
    });
  }
}

function simuFinish(d, evals){
  d.querySelector('#sim-flow').innerHTML = '';
  d.querySelector('#sim-live').innerHTML = '';
  const res = evals.filter(e => e.out.v);                       // v:null = non concerné → masqué
  const order = { oui:0, peut:1, non:2 };
  res.sort((x,y) => order[x.out.v] - order[y.out.v]);
  const host = d.querySelector('#sim-res');
  host.innerHTML =
    `<h3 class="sim-rt">Résultat indicatif</h3>
     <p class="sim-warn">⚠ <b>Estimation locale et indicative</b> (seuils ${SIMU_BAREME_DATE}, hors majorations et cas particuliers) — elle ne vaut pas décision : seul l'organisme compétent (CAF/MSA, CPAM, Carsat, MDPH…) ouvre un droit. Vérifiez sur <a class="lien" href="https://www.mesdroitssociaux.gouv.fr/" target="_blank" rel="noopener noreferrer">mesdroitssociaux.gouv.fr ↗</a> (simulateur officiel, toutes aides).</p>`
    + res.map(e => simuCardHtml(e.r, e.out)).join('');
  host.scrollIntoView({ block:'nearest', behavior:'smooth' });
}
