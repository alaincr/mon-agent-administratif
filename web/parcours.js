// PARCOURS « ÉVÉNEMENTS DE VIE » — orchestration narrative des briques existantes (fiches,
// simulateurs, oracle) autour d'un événement : une DATE PIVOT → des ÉCHÉANCES calculées, une
// CHECKLIST persistée sur l'appareil, et à chaque étape le bon outil déjà présent dans l'app.
// Structure DATA-DRIVEN : ajouter un événement = ajouter une entrée à PARCOURS (aucun code).
// 100 % local : la progression (cases cochées, date) reste en localStorage.

const PARCOURS = {
  chomage: {
    titre: 'Je perds mon emploi',
    dateQ: 'Quand votre contrat se termine-t-il (ou s\'est-il terminé) ?',
    intro: 'Perdre son emploi déclenche une série de démarches, certaines avec des délais stricts. ' +
           'Ce parcours les remet dans l\'ordre, avec vos échéances — et les outils de l\'app à chaque étape.',
    etapes: [
      { id:'docs', titre:'Récupérer vos documents de fin de contrat',
        quand: f => ({ txt:'le dernier jour du contrat', due: addD(f, 0) }),
        texte: 'L\'employeur doit vous remettre : certificat de travail, attestation France Travail (indispensable pour vos droits), solde de tout compte.',
        liens: [{ q:'documents fin de contrat attestation employeur', label:'Voir la fiche' }] },
      { id:'inscription', titre:'Vous inscrire à France Travail',
        quand: f => ({ txt:'dès le lendemain — au plus tard 12 mois après', due: addD(f, 365), asap:true }),
        texte: 'L\'inscription ouvre vos droits : chaque jour d\'attente est un jour d\'allocation décalé. Elle se fait en ligne, puis rendez-vous de suivi.',
        liens: [{ q:'inscription France Travail demandeur emploi', label:'Voir la fiche' },
                { href:'https://www.francetravail.fr/candidat/vos-services-en-ligne/minscrire-me-reinscrire.html', label:'S\'inscrire ↗' }] },
      { id:'are', titre:'Estimer votre allocation (ARE)',
        quand: f => ({ txt:'dès maintenant', asap:true }),
        texte: 'Montant journalier, durée, dégressivité éventuelle : une estimation locale en 4 questions (votre bulletin scanné peut pré-remplir le salaire). Le versement démarre après un différé d\'au moins 7 jours.',
        liens: [{ href:'#/chomage', label:'Estimer mon ARE' }] },
      { id:'caf', titre:'Signaler le changement à la CAF (si allocataire)',
        quand: f => ({ txt:'dès la fin du contrat', due: addD(f, 30), asap:true }),
        texte: 'Aide au logement, prime d\'activité, RSA… : déclarer la perte d\'emploi recalcule vos droits, souvent à la hausse (abattement ou neutralisation des anciens revenus).',
        liens: [{ q:'déclarer changement de situation CAF', label:'Voir la fiche' }] },
      { id:'mutuelle', titre:'Garder votre mutuelle d\'entreprise (portabilité)',
        quand: f => ({ txt:'gratuite jusqu\'à 12 mois', due: addD(f, 365) }),
        texte: 'Si vous êtes indemnisé par France Travail, votre complémentaire santé d\'entreprise est maintenue gratuitement (jusqu\'à 12 mois). Vérifiez le courrier de votre employeur — et comparez avec la Complémentaire santé solidaire, parfois plus avantageuse.',
        liens: [{ q:'portabilité mutuelle entreprise chômage', label:'Voir la fiche' }] },
      { id:'aides', titre:'Vérifier tous vos droits pendant le chômage',
        quand: f => ({ txt:'après l\'estimation de l\'ARE' }),
        texte: 'Avec l\'ARE comme revenu, certaines aides s\'ouvrent ou augmentent : aide au logement recalculée, Complémentaire santé solidaire parfois gratuite… Le simulateur enchaîne tri local puis calcul officiel.',
        liens: [{ href:'#/aides', label:'Mes aides' }] },
      { id:'actualisation', titre:'Vous actualiser chaque mois',
        quand: f => ({ txt:'tous les mois (fenêtre du 28 au 15)', recurrent:true }),
        texte: 'L\'actualisation mensuelle conditionne le versement : un oubli suspend l\'allocation et peut mener à la radiation. Mettez un rappel.',
        liens: [{ q:'actualisation mensuelle France Travail', label:'Voir la fiche' }] },
      { id:'rebond', titre:'Préparer la reprise',
        quand: f => ({ txt:'quand vous le souhaitez' }),
        texte: 'Reprendre même une activité partielle est gagnant : l\'ARE se cumule (règle des 70 %) et vos droits se prolongent. Votre compte formation (CPF) reste utilisable.',
        liens: [{ href:'#/chomage', label:'Simuler un cumul' },
                { q:'compte personnel de formation CPF', label:'Fiche CPF' }] },
    ],
  },
};

function addD(iso, days){ const d = new Date(iso); d.setDate(d.getDate() + days); return d; }
function fmtD(d){ return d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }); }
function parcoursKey(id){ return 'sp_parcours_' + id; }
function parcoursState(id){ try{ return JSON.parse(localStorage.getItem(parcoursKey(id))||'{}'); }catch(e){ return {}; } }
function parcoursSave(id, st){ try{ localStorage.setItem(parcoursKey(id), JSON.stringify(st)); }catch(e){} }

function renderParcours(id){
  const P = PARCOURS[id];
  const d = document.querySelector('#detail');
  if(!P){ d.innerHTML = '<div class="dbody"><p class="muted">Parcours inconnu.</p></div>'; return; }
  const st = parcoursState(id);
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  d.innerHTML = `
    <div class="dnav"><button class="back" type="button">${back}<span>Retour</span></button><span class="dt">${P.titre}</span></div>
    <div class="dbody">
      <h2>${P.titre}</h2>
      <p class="pnote">${P.intro} Votre progression est enregistrée <b>sur cet appareil uniquement</b>.</p>
      <label class="pfield" style="margin-bottom:14px"><span>${P.dateQ}</span>
        <input id="pc-date" type="date" value="${st.date || ''}"></label>
      <div id="pc-steps"></div>
    </div>`;
  d.querySelector('.back').onclick = ()=>{ if(history.length>1) history.back(); else location.hash='#'; };
  const dateIn = d.querySelector('#pc-date');
  dateIn.onchange = () => { st.date = dateIn.value; parcoursSave(id, st); steps(); };
  function steps(){
    const now = new Date(); now.setHours(0,0,0,0);
    const fin = st.date || null;
    const done = st.done || {};
    d.querySelector('#pc-steps').innerHTML = P.etapes.map((e, i) => {
      const w = fin ? e.quand(fin) : e.quand(new Date().toISOString().slice(0,10));
      const checked = !!done[e.id];
      // badge d'échéance : fait > en retard > urgent (dès maintenant) > avant le… > libre
      let badge = '';
      if(checked) badge = '<span class="sim-badge ok">✓ Fait</span>';
      else if(fin && w.due && w.due < now && !w.recurrent) badge = '<span class="sim-badge ko">Échéance dépassée</span>';
      else if(w.asap) badge = '<span class="sim-badge warn">Dès maintenant</span>';
      else if(w.recurrent) badge = '<span class="sim-badge warn">Chaque mois</span>';
      const quand = fin && w.due && !checked
        ? `<span class="pc-due">${w.txt}${w.due ? ' — avant le <b>' + fmtD(w.due) + '</b>' : ''}</span>`
        : `<span class="pc-due">${w.txt}</span>`;
      const liens = (e.liens||[]).map(l => l.q
        ? `<a class="lien" href="#/q/${encodeURIComponent(l.q)}">${l.label}</a>`
        : `<a class="lien" href="${l.href}"${l.href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${l.label}</a>`
      ).join(' · ');
      return `<div class="sim-card pc-step${checked ? ' pc-done' : ''}">
        <div class="sim-head">
          <label class="pc-ck"><input type="checkbox" data-id="${e.id}"${checked ? ' checked' : ''}
            aria-label="Étape faite : ${e.titre}"></label>
          <b>${i+1}. ${e.titre}</b>${badge}
        </div>
        <p class="sim-why">${quand}<br>${e.texte}</p>
        <p class="sim-links">${liens}</p>
      </div>`;
    }).join('');
    d.querySelectorAll('.pc-ck input').forEach(ck => ck.onchange = () => {
      st.done = st.done || {}; st.done[ck.dataset.id] = ck.checked; parcoursSave(id, st); steps();
    });
  }
  steps();
}
