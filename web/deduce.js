// DÉDUCTION DU CAS depuis la phrase de l'usager — « je suis seule avec deux enfants et je perds
// mon CDD » pré-remplit « Mes aides » et le simulateur chômage. Extraction DÉTERMINISTE et 100 %
// locale (règles lexicales : instantané, testable, aucun modèle à télécharger) ; l'IA locale peut
// s'y ajouter mais n'est jamais requise. Prudence par conception : on ne déduit que ce qui est
// EXPLICITE (jamais le handicap ni les revenus), tout est affiché et corrigible par l'usager,
// et le pré-remplissage est ÉPHÉMÈRE (sessionStorage, consommé une fois).
const dnorm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const DEDUCE_NUM = { un:1, une:1, deux:2, trois:3, quatre:4, cinq:5, six:6 };

function deduceFacts(query){
  const q = ' ' + dnorm(query) + ' ';
  const f = {}, labels = [];

  // --- couple / seul ---
  if(/\b(en couple|marie(e|s|es)?\b|pacse|mon mari|ma femme|mon epoux|mon conjoint|ma conjointe|mon compagnon|ma compagne)/.test(q)){
    f.couple = true; labels.push('en couple');
  } else if(/\b(seul(e)?\b|celibataire|(mere|maman|pere|papa) (solo|isolee?)|toute seule|veuve?\b|divorce(e)?\b)/.test(q)){
    f.couple = false; labels.push('seul·e');
  }

  // --- enfants ---
  let m = q.match(/\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six)\s+enfants?\b/);
  if(m){
    f.enfants = Math.min(DEDUCE_NUM[m[1]] || parseInt(m[1], 10) || 0, 12);
    labels.push(f.enfants + ' enfant' + (f.enfants > 1 ? 's' : ''));
  } else if(/\bsans enfants?\b/.test(q)){
    f.enfants = 0; labels.push('sans enfant');
  } else if(/\bjumeaux|jumelles\b/.test(q)){
    f.enfants = 2; labels.push('2 enfants (jumeaux)');
  } else if(/\b(mon fils|ma fille)\b/.test(q)){
    f.enfants = 1; labels.push('1 enfant');
  }

  // --- âge : exact (« j'ai 34 ans ») ou statut ---
  m = q.match(/\b(\d{1,3})\s*ans\b/);
  if(m){
    const a = parseInt(m[1], 10);
    if(a >= 14 && a <= 110){
      f.ageAns = a;
      f.age = a < 18 ? 'u18' : a < 25 ? 'u25' : a < 65 ? 'adult' : 'senior';
      labels.push(a + ' ans');
    }
  } else if(/\bretraite(e)?\b/.test(q)){
    f.age = 'senior'; labels.push('retraité·e');
  } else if(/\betudiant(e)?\b|apprenti(e)?\b/.test(q)){
    f.age = 'u25'; f.activite = 'etudiant'; labels.push('étudiant·e');
  }

  // --- logement ---
  if(/\blocataire\b|\bje loue\b|\bmon loyer\b/.test(q)){ f.logement = 'locataire'; labels.push('locataire'); }
  else if(/\bproprietaire\b/.test(q)){ f.logement = 'proprietaire'; labels.push('propriétaire'); }
  else if(/\bheberge(e)?\b|\bchez (mes parents|ma mere|mon pere|un ami|des amis)\b/.test(q)){ f.logement = 'heberge'; labels.push('hébergé·e'); }

  // --- perte d'emploi : motif (pour le simulateur chômage) ---
  if(/\blicencie|licenciement\b/.test(q)){ f.motif = 'licenciement'; labels.push('licenciement'); }
  else if(/\bfin de (cdd|mission|contrat)\b|\bmon cdd (se termine|s'arrete|prend fin)\b|\bperd(s|re|u)? mon cdd\b|\binterim\b.*\bfin\b/.test(q)){ f.motif = 'fin_cdd'; labels.push('fin de CDD/mission'); }
  else if(/\brupture conventionnelle\b/.test(q)){ f.motif = 'rupture'; labels.push('rupture conventionnelle'); }
  else if(/\bdemission(ne|ner)?\b/.test(q)){ f.motif = 'demission'; labels.push('démission'); }

  return labels.length ? { facts: f, labels } : null;
}

// Dépose le pré-remplissage (éphémère : session en cours, consommé une seule fois).
function deduceStash(query, d){
  try{ sessionStorage.setItem('sp_prefill', JSON.stringify({ q: query, facts: d.facts, labels: d.labels, ts: Date.now() })); }catch(e){}
}
// Récupère un pré-remplissage frais (< 15 min). `consumeKeys` : liste de clés à retirer du stock
// (chaque écran ne consomme QUE les siennes — « Mes aides » laisse le motif au simulateur chômage).
function deduceTake(consumeKeys){
  try{
    const raw = sessionStorage.getItem('sp_prefill');
    if(!raw) return null;
    const p = JSON.parse(raw);
    if(Date.now() - p.ts > 15*60*1000){ sessionStorage.removeItem('sp_prefill'); return null; }
    if(consumeKeys && consumeKeys.length){
      const rest = Object.assign({}, p.facts);
      consumeKeys.forEach(k => delete rest[k]);
      if(Object.keys(rest).length) sessionStorage.setItem('sp_prefill', JSON.stringify(Object.assign({}, p, { facts: rest })));
      else sessionStorage.removeItem('sp_prefill');
    }
    return p;
  }catch(e){ return null; }
}
