// SIMULATEUR CIBLÉ « CHÔMAGE (ARE) » — 100 % LOCAL, rien ne quitte l'appareil.
// Pourquoi local : OpenFisca-France ne modélise pas le calcul SJR→ARE (l'allocation journalière y
// est une variable d'ENTRÉE) ; les règles Unédic sont ici codées en clair, DATÉES, avec leurs
// sources. Verdicts prudents + renvoi systématique vers le simulateur officiel France Travail.
// Le salaire brut peut être PRÉ-REMPLI depuis un bulletin de salaire certifié du coffre (2D-Doc).
//
// Barème Unédic au 1er juillet 2025 (décret n°2019-797 consolidé, règlement d'assurance chômage) :
const ARE = {
  date: '1er juillet 2025',
  fixeJ: 13.18,            // partie fixe journalière (€)
  minJ: 32.13,             // allocation minimale journalière (€)
  taux1: 0.404,            // 40,4 % du SJR + partie fixe…
  taux2: 0.57,             // …ou 57 % du SJR (le plus favorable)
  plafondPctSJR: 0.75,     // l'ARE ne peut dépasser 75 % du SJR
  degressSeuilJ: 92.12,    // dégressivité (−30 % dès le 7e mois) si ARE > ce seuil et <57 ans
  affiliationMinJ: 130,    // ≥130 jours travaillés (~6 mois)…
  fenetreMois: 24,         // …sur les 24 derniers mois (36 si ≥53 ans)
  fenetreMois53: 36,
  coefDuree: 0.75,         // coefficient « contracyclique » (02/2023) sur la durée
  dureeMaxJ: { u53: 548, a53_54: 685, a55: 822 },   // plafonds AVANT coefficient
  dureeMinJ: 182,
  nonTravaillePlafond: 1.75, // jours non travaillés retenus ≤ 75 % des jours travaillés
};

// CUMUL ARE + ACTIVITÉ RÉDUITE (règle Unédic) : allocation du mois = ARE mensuelle − 70 % du brut
// repris, sans que salaire + allocation ne dépassent le salaire mensuel de référence (SJR × 30,4).
// Les jours non indemnisés ne sont pas perdus : ils PROLONGENT la durée des droits d'autant.
function areCumul(r, brutRepris){
  const ref = r.sjr * 30.4;                       // salaire mensuel de référence
  let alloc = Math.max(0, r.areMois - 0.7 * brutRepris);
  alloc = Math.min(alloc, Math.max(0, ref - brutRepris));
  const joursVerses = alloc / r.areJour;          // jours d'ARE réellement consommés dans le mois
  return { alloc, total: alloc + brutRepris,
           prolongeParMois: Math.max(0, 30.4 - joursVerses) };   // jours de droits préservés
}

// entrées → résultat. mois = mois travaillés dans la fenêtre ; couverts = étendue calendaire
// (mois du 1er contrat au dernier) si les périodes ne sont pas continues.
function areCalc({ motif, age, brut, mois, couverts }){
  const fenetre = (age === 'u53') ? ARE.fenetreMois : ARE.fenetreMois53;
  const joursTravailles = Math.min(mois, fenetre) * 30.4;
  const out = { date: ARE.date, fenetre };
  if(motif === 'demission'){
    out.eligible = false;
    out.motifKo = 'Une démission n\'ouvre pas droit à l\'ARE, sauf démission « légitime » (suivi de conjoint, violences…) ou projet de reconversion validé (démissionnaire). Un réexamen est aussi possible après 4 mois (121 jours) de chômage.';
    return out;
  }
  if(joursTravailles < ARE.affiliationMinJ){
    out.eligible = false;
    out.motifKo = `Il faut au moins 6 mois travaillés (130 jours) sur les ${fenetre} derniers mois — vous en déclarez ${mois}.`;
    return out;
  }
  out.eligible = true;
  // SJR (réforme 2021) : salaires de la période ÷ jours calendaires couverts, les jours non
  // travaillés retenus étant plafonnés à 75 % des jours travaillés.
  const moisCouverts = Math.max(mois, Math.min(couverts || mois, mois * ARE.nonTravaillePlafond));
  const sjr = (brut * mois) / (moisCouverts * 30.4);
  out.sjr = sjr;
  let j = Math.max(ARE.taux1 * sjr + ARE.fixeJ, ARE.taux2 * sjr);
  j = Math.max(Math.min(j, ARE.plafondPctSJR * sjr), ARE.minJ);
  out.areJour = j;
  out.areMois = j * 30.4;
  // dégressivité : hauts revenus, moins de 57 ans
  if(age !== 'a57' && j > ARE.degressSeuilJ){
    out.degressif = { apres: 6, areJour: Math.max(j * 0.7, ARE.degressSeuilJ) };
    out.degressif.areMois = out.degressif.areJour * 30.4;
  }
  // durée : jours calendaires couverts × coefficient, bornés
  const plafond = age === 'u53' ? ARE.dureeMaxJ.u53 : (age === 'a53_54' ? ARE.dureeMaxJ.a53_54 : ARE.dureeMaxJ.a55);
  const jours = Math.max(ARE.dureeMinJ, Math.min(moisCouverts * 30.4, plafond) * ARE.coefDuree);
  out.dureeJours = Math.round(jours);
  out.dureeMois = Math.round(jours / 30.4 * 2) / 2;
  return out;
}

// ----- écran #/chomage : 4-5 questions, une à la fois (mêmes composants que « Mes aides ») -----
const CHOMAGE_FIELDS = [
  { id:'motif', q:'Comment se termine (ou s\'est terminé) votre emploi ?', opts:[
      ['licenciement','Licenciement (quel qu\'en soit le motif)'],
      ['fin_cdd','Fin de CDD ou de mission d\'intérim'],
      ['rupture','Rupture conventionnelle'],
      ['demission','Démission']]},
  { id:'age', q:'Votre âge ?', opts:[
      ['u53','Moins de 53 ans'], ['a53_54','53 ou 54 ans'], ['a55','55 ou 56 ans'], ['a57','57 ans ou plus']]},
  { id:'brut', q:'Votre salaire BRUT mensuel moyen (dernier emploi), en €', eur:true,
    hint:'Le brut figure sur vos bulletins de salaire. Un ordre de grandeur suffit.' },
  { id:'mois', q:'Combien de mois avez-vous travaillé sur les 24 derniers mois (36 si 53 ans ou plus) ?', eur:true,
    hint:'Tous employeurs confondus. ex. 18' },
  { id:'continu', q:'Ces périodes de travail étaient-elles continues (sans interruption) ?', opts:[
      [true,'Oui, d\'un seul tenant'], [false,'Non, avec des interruptions']]},
  { id:'couverts', q:'Du début du premier contrat à la fin du dernier, cela couvre combien de mois ?', eur:true,
    hint:'ex. 20 (les interruptions comptent, dans la limite des règles Unédic)' },
];

function renderChomage(){
  const d = document.querySelector('#detail');
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  const cSal = window.coffreSalaire ? coffreSalaire() : null;
  d.innerHTML = `
    <div class="dnav"><button class="back" type="button">${back}<span>Retour</span></button><span class="dt">Allocation chômage</span></div>
    <div class="dbody">
      <h2>Estimer mon allocation chômage (ARE)</h2>
      <p class="pnote">Quelques questions, calcul <b>uniquement sur cet appareil</b> — rien n'est
        transmis. Estimation selon les règles Unédic du <b>${ARE.date}</b> (cas général, hors
        annexes intermittents/expatriés) : seule France Travail calcule votre droit réel.</p>
      <p class="sim-links">Vue d'ensemble des démarches ? <a class="lien" href="#/parcours/chomage">Parcours guidé « je perds mon emploi »</a></p>
      <div id="cho-flow"></div>
      <div id="cho-res" aria-live="polite"></div>
      <p class="sim-restart"><a class="lien" href="#">Recommencer</a></p>
    </div>`;
  d.querySelector('.back').onclick = ()=>{ if(history.length>1) history.back(); else location.hash='#'; };
  const answers = {};
  d.querySelector('.sim-restart a').onclick = e => { e.preventDefault(); Object.keys(answers).forEach(k=>delete answers[k]); d.querySelector('#cho-res').innerHTML=''; step(); };
  function next(){
    for(const f of CHOMAGE_FIELDS){
      if(f.id === 'couverts' && answers.continu !== false) continue;   // seulement si périodes espacées
      if(answers[f.id] === undefined) return f;
    }
    return null;
  }
  function step(){
    const f = next();
    const flow = d.querySelector('#cho-flow');
    if(!f){ flow.innerHTML = ''; finish(); return; }
    if(f.eur){
      const coffreHint = (f.id === 'brut' && cSal)
        ? `<p class="sim-hint">📦 Coffre : <a href="#" class="lien cho-coffre">utiliser ${cSal.brut.toLocaleString('fr-FR')} € (bulletin${cSal.n>1?'s':''} certifié${cSal.n>1?'s':''})</a></p>` : '';
      flow.innerHTML = `<div class="q"><h4>${f.q}</h4>${f.hint?`<p class="sim-hint">${f.hint}</p>`:''}${coffreHint}
        <div class="sim-eur"><input type="number" inputmode="decimal" min="0"><button class="btn act" type="button">Continuer</button></div></div>`;
      const inp = flow.querySelector('input');
      const go = () => { const v = parseFloat(String(inp.value).replace(',','.')); if(isNaN(v)||v<0){ inp.focus(); return; } answers[f.id]=v; step(); };
      flow.querySelector('.sim-eur button').onclick = go;
      inp.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); go(); } });
      const cc = flow.querySelector('.cho-coffre');
      if(cc) cc.onclick = e => { e.preventDefault(); inp.value = cSal.brut; go(); };
      inp.focus();
    } else {
      flow.innerHTML = `<div class="q"><h4>${f.q}</h4><div class="opts">${
        f.opts.map((o,i)=>`<button class="opt" type="button" data-i="${i}">${o[1]}</button>`).join('')}</div></div>`;
      flow.querySelectorAll('.opt').forEach(b => b.onclick = () => { answers[f.id] = f.opts[+b.dataset.i][0]; step(); });
    }
  }
  function finish(){
    const r = areCalc(answers);
    const host = d.querySelector('#cho-res');
    const links = `<p class="sim-links">
      <a class="lien" href="#/q/${encodeURIComponent('allocation chômage ARE')}">Voir la fiche</a> ·
      <a class="lien" href="https://www.francetravail.fr/candidat/mes-droits-aux-aides-et-allocations/lallocation-daide-au-retour-a-le.html" target="_blank" rel="noopener noreferrer">France Travail ↗</a>
      <span class="muted">· estimation Unédic ${r.date}</span></p>`;
    if(!r.eligible){
      host.innerHTML = `<div class="sim-card">
        <div class="sim-head"><span class="sim-badge ko">Droit peu probable</span><b>Allocation de retour à l'emploi</b></div>
        <p class="sim-why">${r.motifKo}</p>${links}</div>`;
      return;
    }
    const deg = r.degressif
      ? `<p class="sim-why">⚠ <b>Dégressivité :</b> à partir du 7ᵉ mois, l'allocation serait réduite à
         ≈ <b>${Math.round(r.degressif.areMois).toLocaleString('fr-FR')} €/mois</b> (revenus élevés, moins de 57 ans).</p>` : '';
    host.innerHTML = `<div class="sim-card">
      <div class="sim-head"><span class="sim-badge ok">Droit probable</span><b>Allocation de retour à l'emploi</b></div>
      <p class="sim-why">Salaire journalier de référence estimé : <b>${r.sjr.toFixed(2).replace('.',',')} €</b>.</p>
      <table class="orc-t">
        <tr><td>Allocation journalière brute</td><td class="orc-v">${r.areJour.toFixed(2).replace('.',',')} €</td></tr>
        <tr><td>Soit par mois (brut)</td><td class="orc-v">≈ ${Math.round(r.areMois).toLocaleString('fr-FR')} €</td></tr>
        <tr><td>Durée d'indemnisation</td><td class="orc-v">≈ ${String(r.dureeMois).replace('.',',')} mois (${r.dureeJours} jours)</td></tr>
      </table>
      ${deg}
      <p class="orc-src">Montant <b>brut</b> : des retenues sociales (CSG/CRDS, retraite complémentaire — 0 à ~11 %
        selon le montant) s'appliquent. Hypothèses : cas général, temps plein régulier, jours non travaillés
        plafonnés selon la règle 2021, coefficient de durée « contracyclique » ×0,75. <b>Ne vaut pas décision</b> —
        faites la simulation officielle France Travail avec vos bulletins réels.</p>
      ${links}</div>
      <div class="sim-card">
        <div class="sim-head"><b>Et si je reprends une activité partielle ?</b></div>
        <p class="sim-why">L'ARE se <b>cumule</b> avec un salaire réduit (70 % du brut repris est déduit) et
          les jours non versés <b>prolongent vos droits</b>. Indiquez un salaire brut mensuel envisagé :</p>
        <div class="sim-eur"><input class="cho-cumul" type="number" inputmode="decimal" min="0" placeholder="ex. 800"><button class="btn act" type="button">Voir</button></div>
        <div class="cho-cumul-out" aria-live="polite"></div>
      </div>
      <div class="cho-oracle"></div>`;
    // cumul activité réduite : calcul immédiat, local
    const ci = host.querySelector('.cho-cumul'), co = host.querySelector('.cho-cumul-out');
    const cumul = () => {
      const b = parseFloat(String(ci.value).replace(',', '.'));
      if(isNaN(b) || b < 0){ ci.focus(); return; }
      const c = areCumul(r, b);
      co.innerHTML = c.alloc < 0.5
        ? `<p class="sim-why">À ce salaire, l'allocation du mois serait <b>nulle</b> (le cumul dépasse votre
           salaire de référence) — vos droits restent intégralement préservés pour plus tard.</p>`
        : `<table class="orc-t">
             <tr><td>Salaire repris (brut)</td><td class="orc-v">${Math.round(b).toLocaleString('fr-FR')} €</td></tr>
             <tr><td>+ Allocation maintenue</td><td class="orc-v">${Math.round(c.alloc).toLocaleString('fr-FR')} €</td></tr>
             <tr><td><b>Total mensuel (brut)</b></td><td class="orc-v">${Math.round(c.total).toLocaleString('fr-FR')} €</td></tr>
           </table>
           <p class="sim-why">soit <b>${Math.round(c.total - r.areMois).toLocaleString('fr-FR')} € de plus</b> que l'ARE seule,
           et ≈ ${Math.round(c.prolongeParMois)} jours de droits préservés chaque mois (durée prolongée d'autant).</p>`;
    };
    host.querySelector('.sim-eur button').onclick = cumul;
    ci.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); cumul(); } });
    // pont vers l'oracle : « mes aides pendant le chômage » (ARE = revenu, consentement dans le panneau)
    if(window.attachOracle){
      const saved = (window.getSimu ? getSimu() : {}) || {};
      const a = {
        couple: saved.couple === true, enfants: saved.enfants || 0,
        age: 'adult', handicap: saved.handicap || 'non', residence: saved.residence !== false,
        logement: saved.logement || 'locataire',
        revenus: 0,                                    // mode chômage : salaire du conjoint (0 par défaut)
      };
      const note = (saved.couple !== undefined || saved.enfants !== undefined)
        ? '<p class="sim-hint">Composition du foyer reprise de « Mes aides »' + (a.couple ? ' (en couple — le salaire du conjoint peut être coché depuis le coffre ou laissé à 0)' : '') + '.</p>'
        : '<p class="sim-hint">Foyer supposé : personne seule, sans enfant — faites d\'abord « Mes aides » pour un calcul sur votre vraie situation.</p>';
      host.querySelector('.cho-oracle').innerHTML = note;
      attachOracle(host.querySelector('.cho-oracle'), a, { chomage: r.areMois });
    }
  }
  step();
}
