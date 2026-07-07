// ORACLE OPENFISCA — 2e étage du simulateur « Mes aides » : montants EXACTS calculés par l'API
// Web officielle d'OpenFisca-France, hébergée par nous (Space HF docker, sans état, AGPL).
//
// Contrat de confidentialité, affiché et tenu :
// - le premier tri d'éligibilité reste 100 % LOCAL (simu.js) ;
// - l'oracle ne reçoit un CAS-TYPE ANONYME (situation chiffrée : composition du foyer, tranche
//   d'âge, revenus, loyer/commune si locataire) qu'après CONSENTEMENT EXPLICITE — jamais
//   d'identité, jamais de données du coffre ; refus = rien ne part, le tri local reste ;
// - hypothèse simplificatrice affichée : revenus d'activité salariée (pension si retraité),
//   constants sur 36 mois — c'est une ESTIMATION sur cas-type, pas une décision.
const ORACLE_URL = 'https://alcrawfo-openfisca-oracle.hf.space';

// réponses du questionnaire local (simuNorm) → cas-type OpenFisca anonyme
function oracleCase(a, extra){
  const Y = new Date().getFullYear();
  const PER = Y + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  const years = [Y-2, Y-1, Y];
  const mm = [];
  years.forEach(y => { for(let m=1; m<=12; m++) mm.push(y + '-' + String(m).padStart(2,'0')); });
  const senior = a.age === 'senior';
  const birth = { u18:'2010-01-01', u25:'2003-01-01', adult:'1985-01-01', senior:'1955-01-01' }[a.age] || '1985-01-01';
  const nPar = a.couple ? 2 : 1;
  // mode CHÔMAGE (extra.chomage = ARE mensuelle) : le demandeur perçoit l'ARE (chomage_brut),
  // l'éventuel conjoint garde un salaire. Hypothèse « régime établi » : ARE sur toute la période.
  const chom = extra && extra.chomage > 0;
  const incomeVar = senior ? 'retraite_brute' : 'salaire_de_base';
  // en mode chômage, a.revenus = salaire de l'ÉVENTUEL conjoint (entier) ; sinon revenu du foyer réparti
  const perAdult = chom ? (a.revenus || 0) : (a.revenus || 0) / nPar;
  const individus = {}, parents = [];
  for(let p=0; p<nPar; p++){
    const id = 'p' + p; parents.push(id);
    const inc = {};
    const v = (chom && p === 0) ? 'chomage_brut' : incomeVar;
    const amount = (chom && p === 0) ? extra.chomage : perAdult;
    mm.forEach(m => inc[m] = amount);
    individus[id] = { [v]: inc, date_naissance: { ETERNITY: birth } };
    if(p === 0 && a.handicap && a.handicap !== 'non'){
      individus[id].aah = { [PER]: null };
      individus[id].taux_incapacite = { [PER]: a.handicap === '80' ? 0.85 : 0.65 };
    }
  }
  const enfants = [];
  for(let k=0; k<(a.enfants||0); k++){
    const id = 'e' + k; enfants.push(id);
    individus[id] = { date_naissance: { ETERNITY: (Y-8-k) + '-01-01' } };
  }
  const famille = { parents, enfants,
    rsa: { [PER]: null }, ppa: { [PER]: null }, af: { [PER]: null },
    css_participation_forfaitaire: { [PER]: null } };
  if(a.enfants > 0) famille.ars = { [(Y-1) + '-08']: null };      // dernière rentrée révolue
  if(senior) famille.aspa = { [PER]: null };
  const menage = { personne_de_reference: [parents[0]] };
  if(a.couple) menage.conjoint = [parents[1]];
  if(enfants.length) menage.enfants = enfants;
  if(a.logement === 'locataire' && extra && extra.loyer > 0){
    const loyer = {}, statut = {};
    mm.forEach(m => { if(!m.startsWith(String(Y-2))){ loyer[m] = extra.loyer; statut[m] = 'locataire_vide'; } });
    menage.loyer = loyer; menage.statut_occupation_logement = statut;
    if(extra.depcom) menage.depcom = { [PER]: extra.depcom };
    famille.aide_logement_montant = { [PER]: null };
  }
  return { periode: PER, annee: Y,
    payload: { individus, foyers_fiscaux: { ff: { declarants: parents, personnes_a_charge: enfants } },
               familles: { fa: famille }, menages: { me: menage } } };
}

async function oracleCompute(a, extra){
  const c = oracleCase(a, extra);
  const r = await fetch(ORACLE_URL + '/calculate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c.payload),
  });
  if(!r.ok) throw new Error('oracle HTTP ' + r.status + ' — ' + (await r.text()).slice(0, 180));
  const out = await r.json();
  const fa = out.familles.fa, p0 = out.individus.p0;
  const g = (o, k, per) => { const v = o && o[k] && o[k][per]; return typeof v === 'number' ? v : null; };
  return {
    periode: c.periode,
    rsa: g(fa, 'rsa', c.periode), ppa: g(fa, 'ppa', c.periode), af: g(fa, 'af', c.periode),
    logement: g(fa, 'aide_logement_montant', c.periode),
    ars: g(fa, 'ars', (c.annee-1) + '-08'),
    aspa: g(fa, 'aspa', c.periode), aah: g(p0, 'aah', c.periode),
    css_part: g(fa, 'css_participation_forfaitaire', c.periode),
  };
}

// ----- UI : panneau « Montants précis » sous les résultats du tri local -----
function attachOracle(host, a, opts){
  if(!host || host.querySelector('.orc')) return;
  const chomage = opts && opts.chomage > 0 ? Math.round(opts.chomage) : 0;   // ARE mensuelle estimée
  const locataire = a.logement === 'locataire';
  // BRANCHEMENT DU COFFRE (opt-in, case par case) : seules des VALEURS chiffrées certifiées
  // peuvent partir (salaire brut d'un bulletin, commune d'un justificatif) — jamais nom/adresse.
  const cSal = window.coffreSalaire ? coffreSalaire() : null;
  const cCom = (locataire && window.coffreCommune) ? coffreCommune() : null;
  const el = document.createElement('div');
  el.className = 'orc';
  el.innerHTML = `
    <h3 class="sim-rt">${chomage ? 'Mes aides pendant le chômage (calcul officiel)' : 'Montants précis (calcul officiel)'}</h3>
    <p class="orc-note">${chomage
      ? `Le <b>moteur officiel OpenFisca</b> peut calculer vos aides <b>une fois au chômage</b>, avec
         votre ARE estimée (<b>${chomage.toLocaleString('fr-FR')} €/mois</b>) comme revenu${a.couple ? ' et le salaire de votre conjoint' : ''}.
         Votre <b>situation chiffrée</b>${locataire ? ' (dont loyer et commune)' : ''} sera envoyée <b>anonymement</b>
         à notre serveur de calcul — <b>jamais votre identité</b>, rien n'est conservé. Hypothèse :
         chômage « installé » (régime établi), montants susceptibles d'évoluer les premiers mois.`
      : `Pour aller au-delà de l'estimation : le <b>moteur officiel OpenFisca</b> peut
      calculer les <b>montants exacts</b> de vos aides. Votre <b>situation chiffrée</b> (composition du
      foyer, tranche d'âge, revenus${locataire ? ', loyer et commune' : ''}${(cSal||cCom) ? ', et les valeurs de votre coffre si vous les cochez' : ''})
      sera envoyée <b>anonymement</b> à notre serveur de calcul — <b>jamais votre identité</b>, et rien
      n'est conservé. Hypothèse : revenus d'activité salariée${a.age==='senior' ? ' (pension de retraite)' : ''}, stables sur 3 ans.`}</p>
    ${(cSal || cCom) ? `<div class="orc-coffre">
      <p class="orc-clab">📦 Depuis votre coffre (certifié) :</p>
      ${cSal ? `<label class="orc-ck"><input type="checkbox" class="orc-usesal" checked>
        Utiliser mon <b>salaire brut : ${cSal.brut.toLocaleString('fr-FR')} €/mois</b>
        <span class="muted">(moyenne de ${cSal.n} bulletin${cSal.n>1?'s':''} scanné${cSal.n>1?'s':''})</span></label>` : ''}
      ${cCom ? `<label class="orc-ck"><input type="checkbox" class="orc-usecom" checked>
        Utiliser ma <b>commune : ${esc(cCom.commune)}</b>
        <span class="muted">(${esc(cCom.label)})</span></label>` : ''}
    </div>` : ''}
    ${locataire ? `
    <div class="pform">
      <label class="pfield"><span>Votre loyer mensuel hors charges, en €</span>
        <input class="orc-loyer" type="number" inputmode="decimal" min="0" placeholder="ex. 600"></label>
      <label class="pfield"><span>Votre commune (pour la zone d'aide au logement)</span>
        <input class="orc-commune" type="text" autocomplete="off" placeholder="ex. Saint-Étienne">
        <span class="orc-cstatus muted"></span></label>
    </div>` : ''}
    <button class="btn orc-go" type="button">Calculer les montants — j'accepte l'envoi anonyme</button>
    <p class="orc-refus muted">Sans accord, rien n'est envoyé : l'estimation locale ci-dessus reste disponible.</p>
    <div class="orc-out" aria-live="polite"></div>`;
  host.appendChild(el);
  let depcom = null;
  const cIn = el.querySelector('.orc-commune'), cSt = el.querySelector('.orc-cstatus');
  if(cIn){
    let t = null;
    cIn.addEventListener('input', () => {
      clearTimeout(t); depcom = null; cSt.textContent = '';
      const q = cIn.value.trim(); if(q.length < 2) return;
      t = setTimeout(async () => {
        try{
          const r = await fetch('https://geo.api.gouv.fr/communes?nom=' + encodeURIComponent(q) + '&fields=code,nom,codesPostaux&limit=1');
          const l = await r.json();
          if(l[0]){ depcom = l[0].code; cSt.textContent = '✓ ' + l[0].nom + ' (' + (l[0].codesPostaux||[])[0] + ')'; }
          else cSt.textContent = 'Commune introuvable';
        }catch(e){ cSt.textContent = ''; }
      }, 350);
    });
  }
  // commune certifiée du coffre : pré-remplit le champ (l'autocomplete résout le code commune)
  if(cCom && cIn){
    cIn.value = cCom.commune;
    cIn.dispatchEvent(new Event('input'));
    const ck = el.querySelector('.orc-usecom');
    if(ck) ck.onchange = () => { if(!ck.checked){ cIn.value = ''; depcom = null; cSt.textContent = ''; } else { cIn.value = cCom.commune; cIn.dispatchEvent(new Event('input')); } };
  }
  const btn = el.querySelector('.orc-go'), out = el.querySelector('.orc-out');
  btn.onclick = async () => {
    const extra = {};
    if(locataire){
      extra.loyer = parseFloat((el.querySelector('.orc-loyer').value || '').replace(',', '.')) || 0;
      extra.depcom = depcom;
      if(!extra.loyer){ out.innerHTML = '<span class="muted">Indiquez votre loyer pour calculer l\'aide au logement (ou laissez 0 pour les autres aides).</span>'; }
    }
    if(chomage) extra.chomage = chomage;                          // ARE comme revenu du demandeur
    // salaire brut certifié coché → remplace le revenu déclaré (plus fiable : c'est du brut)
    const useSal = el.querySelector('.orc-usesal');
    const a2 = (useSal && useSal.checked && cSal) ? Object.assign({}, a, { revenus: cSal.brut }) : a;
    btn.disabled = true; out.textContent = 'Calcul par le moteur officiel… (quelques secondes ; réveil du serveur possible au premier appel)';
    try{
      const m = await oracleCompute(a2, extra);
      const rows = [];
      const add = (label, v, unit) => { if(v !== null && v > 0.5) rows.push([label, Math.round(v) + ' ' + unit]); };
      add('Revenu de solidarité active (RSA)', m.rsa, '€/mois');
      add('Prime d\'activité', m.ppa, '€/mois');
      add('Allocations familiales', m.af, '€/mois');
      add('Aide au logement (APL/ALS/ALF)', m.logement, '€/mois');
      add('ASPA (minimum vieillesse)', m.aspa, '€/mois');
      add('AAH', m.aah, '€/mois');
      add('Allocation de rentrée scolaire', m.ars, '€ (rentrée)');
      if(m.css_part !== null) rows.push(['Complémentaire santé solidaire',
        m.css_part > 0.5 ? 'avec participation (~' + Math.round(m.css_part) + ' €/mois)' : 'vraisemblablement gratuite']);
      out.innerHTML = rows.length
        ? '<table class="orc-t">' + rows.map(r => `<tr><td>${r[0]}</td><td class="orc-v">${r[1]}</td></tr>`).join('') + '</table>'
          + `<p class="orc-src">Calculé par <b>OpenFisca-France</b> (moteur officiel des règles socio-fiscales), période ${m.periode} —
             estimation sur cas-type simplifié, ne vaut pas décision. Vérifiez sur
             <a class="lien" href="https://www.mesdroitssociaux.gouv.fr/" target="_blank" rel="noopener noreferrer">mesdroitssociaux.gouv.fr ↗</a>.</p>`
        : '<p class="muted">Aucun montant positif calculé pour ce cas-type — les verdicts locaux ci-dessus restent votre repère.</p>';
    }catch(e){
      out.innerHTML = '<span class="muted">Le serveur de calcul n\'a pas répondu (' + esc(String(e.message||e)) + '). Réessayez dans une minute — l\'estimation locale reste valable.</span>';
    }finally{ btn.disabled = false; }
  };
}
