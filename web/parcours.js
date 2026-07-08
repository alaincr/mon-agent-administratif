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

  naissance: {
    titre: 'J\'attends un enfant',
    dateQ: 'Quelle est la date prévue d\'accouchement ?',
    intro: 'De la déclaration de grossesse à l\'arrivée de l\'enfant, les démarches s\'étalent sur des mois — ' +
           'certaines très tôt, une dans les 5 jours après la naissance. Ce parcours les remet dans l\'ordre.',
    etapes: [
      { id:'declaration', titre:'Déclarer la grossesse (CPAM et CAF)',
        quand: f => ({ txt:'avant la fin du 3ᵉ mois de grossesse', due: addD(f, -180), asap:true }),
        texte: 'Le premier examen prénatal donne lieu à la déclaration, transmise à l\'Assurance maladie et à la CAF : elle ouvre la prise en charge à 100 % et les droits PAJE.',
        liens: [{ q:'déclaration de grossesse', label:'Voir la fiche' }] },
      { id:'examens', titre:'Suivre les examens prénataux',
        quand: f => ({ txt:'tout au long de la grossesse', recurrent:true }),
        texte: '7 examens médicaux obligatoires, pris en charge. À partir du 6ᵉ mois, tout est remboursé à 100 % (maternité).',
        liens: [{ q:'examens médicaux grossesse suivi', label:'Voir la fiche' }] },
      { id:'reconnaissance', titre:'Reconnaissance anticipée (couples non mariés)',
        quand: f => ({ txt:'avant la naissance, dès maintenant', asap:true }),
        texte: 'Si vous n\'êtes pas mariés, le père peut reconnaître l\'enfant avant la naissance, en mairie — cela établit la filiation dès le premier jour.',
        liens: [{ q:'reconnaissance anticipée enfant', label:'Voir la fiche' }] },
      { id:'garde', titre:'Chercher un mode de garde (tôt !)',
        quand: f => ({ txt:'dès le début de la grossesse', asap:true }),
        texte: 'Crèche, assistante maternelle, garde à domicile : les listes d\'attente se comptent en mois. Le complément de libre choix du mode de garde (CMG) aide à financer.',
        liens: [{ q:'modes de garde jeune enfant crèche assistante maternelle', label:'Voir la fiche' }] },
      { id:'prime', titre:'Prime à la naissance (PAJE)',
        quand: f => ({ txt:'versée au 7ᵉ mois de grossesse', due: addD(f, -60) }),
        texte: 'Sous conditions de ressources, ~1 000 € versés au 7ᵉ mois — automatique si la grossesse est déclarée. Vérifiez vos droits (allocation de base ensuite, chaque mois).',
        liens: [{ href:'#/aides', label:'Mes aides' }, { q:'prime à la naissance PAJE', label:'Voir la fiche' }] },
      { id:'conges', titre:'Poser vos congés (maternité, paternité)',
        quand: f => ({ txt:'prévenir l\'employeur au moins 1 mois avant', due: addD(f, -30) }),
        texte: 'Congé maternité (16 semaines minimum, obligatoire en partie) ; congé de paternité et d\'accueil de 28 jours, à prendre dans les 6 mois — l\'employeur doit être prévenu 1 mois avant.',
        liens: [{ q:'congé maternité durée', label:'Congé maternité' }, { q:'congé paternité 28 jours', label:'Congé paternité' }] },
      { id:'naissance', titre:'Déclarer la naissance en mairie',
        quand: f => ({ txt:'dans les 5 JOURS après la naissance', due: addD(f, 5), asap:true }),
        texte: 'Obligatoire, à la mairie du lieu de naissance, dans les 5 jours (jour de l\'accouchement non compté). Passé ce délai, il faut un jugement — ne la laissez à personne d\'autre que le papa ou une personne de confiance présente à l\'accouchement.',
        liens: [{ q:'déclaration de naissance délai mairie', label:'Voir la fiche' }] },
      { id:'rattachement', titre:'Rattacher l\'enfant (CPAM, mutuelle, CAF, impôts)',
        quand: f => ({ txt:'dans le mois qui suit', due: addD(f, 30) }),
        texte: 'Rattachement à l\'Assurance maladie des deux parents (possible), à la mutuelle, mise à jour CAF (PAJE, allocations familiales dès le 2ᵉ enfant) — et vos aides changent : refaites l\'estimation.',
        liens: [{ href:'#/aides', label:'Recalculer mes aides' }, { q:'rattacher enfant assurance maladie parents', label:'Voir la fiche' }] },
    ],
  },

  deces: {
    titre: 'Un proche est décédé',
    dateQ: 'Quelle est la date du décès ?',
    intro: 'Dans l\'épreuve, des démarches très encadrées s\'enchaînent — deux dans la première semaine, ' +
           'd\'autres sur plusieurs mois. Ce parcours les remet dans l\'ordre, à votre rythme.',
    etapes: [
      { id:'declaration', titre:'Faire constater et déclarer le décès',
        quand: f => ({ txt:'dans les 24 heures', due: addD(f, 1), asap:true }),
        texte: 'Certificat médical puis déclaration à la mairie du lieu de décès (souvent prise en charge par l\'hôpital, la maison de retraite ou les pompes funèbres). Demandez plusieurs copies de l\'acte de décès : chaque organisme en voudra une.',
        liens: [{ q:'déclaration de décès mairie', label:'Voir la fiche' }] },
      { id:'obseques', titre:'Organiser les obsèques',
        quand: f => ({ txt:'dans les 6 jours ouvrés', due: addD(f, 6), asap:true }),
        texte: 'Vérifiez d\'abord si le défunt avait exprimé ses volontés (contrat obsèques, assurance). Les frais peuvent être prélevés sur son compte bancaire (jusqu\'à ~5 000 €) sur présentation de la facture.',
        liens: [{ q:'organisation des obsèques', label:'Voir la fiche' }] },
      { id:'employeur', titre:'Prévenir l\'employeur (le sien, le vôtre)',
        quand: f => ({ txt:'dès que possible', asap:true }),
        texte: 'L\'employeur du défunt verse les sommes dues (salaire, congés). Si vous êtes salarié·e, vous avez droit à un congé pour décès d\'un proche (3 jours minimum, plus selon le lien et la convention).',
        liens: [{ q:'congé pour décès d\'un proche', label:'Voir la fiche' }] },
      { id:'banque', titre:'Informer les banques et assurances',
        quand: f => ({ txt:'dans la semaine', due: addD(f, 7), asap:true }),
        texte: 'Les comptes personnels du défunt sont bloqués (pas les comptes joints). Recensez les assurances-vie : elles se traitent hors succession, directement auprès de l\'assureur.',
        liens: [{ q:'compte bancaire après un décès', label:'Voir la fiche' }] },
      { id:'capital', titre:'Capital décès et pension de réversion',
        quand: f => ({ txt:'demande prioritaire dans le mois', due: addD(f, 30) }),
        texte: 'Si le défunt était salarié : un capital décès (CPAM) existe — la demande dans le 1ᵉʳ mois donne priorité. Époux·se : la pension de réversion (caisses de retraite) n\'est jamais automatique, il faut la demander. Vos propres droits changent aussi.',
        liens: [{ q:'capital décès sécurité sociale', label:'Capital décès' },
                { q:'pension de réversion', label:'Réversion' },
                { href:'#/aides', label:'Recalculer mes aides' }] },
      { id:'organismes', titre:'Signaler aux organismes (CAF, impôts, complémentaire…)',
        quand: f => ({ txt:'dans le mois', due: addD(f, 30) }),
        texte: 'CAF/MSA (les aides du foyer sont recalculées, l\'allocation de soutien familial peut s\'ouvrir pour les enfants), Assurance maladie, mutuelle, caisses de retraite. Les impôts : la déclaration de revenus du défunt reste due l\'année suivante.',
        liens: [{ q:'décès démarches organismes sociaux', label:'Voir la fiche' }] },
      { id:'succession', titre:'Régler la succession (notaire si nécessaire)',
        quand: f => ({ txt:'déclaration de succession sous 6 mois', due: addD(f, 180) }),
        texte: 'Le notaire est obligatoire s\'il y a un bien immobilier, un testament ou un contrat de mariage. La déclaration de succession doit parvenir aux impôts dans les 6 mois (des intérêts courent au-delà).',
        liens: [{ q:'déclaration de succession délai', label:'Voir la fiche' }] },
      { id:'quotidien', titre:'Contrats du quotidien et véhicule',
        quand: f => ({ txt:'au fil de l\'eau' }),
        texte: 'Résilier ou transférer énergie, téléphone, abonnements, bail. Pour un véhicule : la carte grise doit être mise à jour avant de le vendre ou de le conserver.',
        liens: [{ q:'résilier contrats après décès', label:'Voir la fiche' },
                { q:'carte grise héritage véhicule', label:'Véhicule' }] },
    ],
  },
};

function addD(iso, days){ const d = new Date(iso); d.setDate(d.getDate() + days); return d; }
function fmtD(d){ return d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }); }

// ----- rappels : export AGENDA (.ics) — universel (iPhone/Android/desktop), zéro permission,
// zéro serveur : le fichier est généré sur l'appareil et ouvert par l'app d'agenda du système.
function icsEsc(s){ return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n'); }
function icsDate(d){ return d.toISOString().slice(0,10).replace(/-/g,''); }
function icsEvent(uid, date, titre, desc){
  return ['BEGIN:VEVENT', 'UID:' + uid + '@demarches-demo',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z',
    'DTSTART;VALUE=DATE:' + icsDate(date),
    'SUMMARY:' + icsEsc(titre), 'DESCRIPTION:' + icsEsc(desc),
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(titre), 'END:VALARM',
    'END:VEVENT'].join('\r\n');
}
function icsDownload(filename, events){
  const cal = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Demarches demonstrateur//FR',
               'CALSCALE:GREGORIAN', events.join('\r\n'), 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([cal], { type:'text/calendar;charset=utf-8' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
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
      ).concat(fin && w.due && !checked && w.due >= now
        ? [`<a class="lien pc-ics" data-id="${e.id}" href="#">📅 Rappel agenda</a>`] : []
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
    // rappels agenda : une étape (.ics à 1 événement) ou toutes les échéances d'un coup
    const evFor = e => {
      const w = e.quand(fin);
      return icsEvent(id + '-' + e.id, w.due, P.titre + ' — ' + e.titre,
        e.texte + ' (Démarches, parcours « ' + P.titre + ' »)');
    };
    d.querySelectorAll('.pc-ics').forEach(a => a.onclick = ev => {
      ev.preventDefault();
      const e = P.etapes.find(x => x.id === a.dataset.id);
      if(e) icsDownload('rappel-' + e.id + '.ics', [evFor(e)]);
    });
    if(fin){
      const todo = P.etapes.filter(e => { const w = e.quand(fin); return w.due && w.due >= now && !done[e.id]; });
      if(todo.length > 1){
        d.querySelector('#pc-steps').insertAdjacentHTML('beforeend',
          `<p class="sim-links" style="margin-top:12px"><a class="lien pc-ics-all" href="#">📅 Ajouter les ${todo.length} échéances à mon agenda</a>
           <span class="muted">— fichier créé sur l'appareil, ouvert par votre application d'agenda.</span></p>`);
        d.querySelector('.pc-ics-all').onclick = ev => {
          ev.preventDefault();
          icsDownload('parcours-' + id + '.ics', todo.map(evFor));
        };
      }
    }
  }
  steps();
}
