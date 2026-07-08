'use strict';
// ----- état -----
let FICHES = [], BM = null;
let DOCVEC = null, DOCDIM = 384, ROWOF = null, encoder = null, semanticOn = false;
let THEMES = [], MANIFEST = null;
const $ = s => document.querySelector(s);
const status = m => $('#status').textContent = m;

const STOP = new Set(("au aux avec ce ces cet cette dans de des du elle en et eux il je la le les leur lui ma mais me mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous est sont a y d j l m n s t quel quelle quels quelles comment quand si "
  + "suis es sommes etes ete etre avoir ai as avons avez ont avais eu vais vas va allons allez vont aller fais fait faites font faire veux veut voulons voulez veulent vouloir dois doit devons devez peux peut pouvons pouvez peuvent pouvoir c ca cela ceci plus tres bien alors donc car comme aussi mon mes "
  + "combien prend prends prendre faut faudra").split(' '));
const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const toks = s => (norm(s).match(/[a-z0-9]+/g)||[]).filter(w=>w.length>1 && !STOP.has(w));

// ----- utilitaires : sûreté & dates -----
function safeUrl(u){                        // n'autorise que http(s) (défense en profondeur, R3.4)
  try{ const p = new URL(u, location.href); return (p.protocol==='https:'||p.protocol==='http:') ? p.href : '#'; }
  catch(e){ return '#'; }
}
function fmtDate(d){                         // "2026-02-02" -> "02/02/2026"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d||''); return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
function daysSince(d){ const t = Date.parse(d); return isNaN(t) ? null : Math.floor((Date.now()-t)/86400000); }
async function checkFreshness(){            // bandeau si le corpus local est ancien (R1.2/R7.5)
  const bar = $('#freshness'); if(!bar) return;
  try{
    MANIFEST = await (await fetch('data/data-manifest.json')).json();
    const age = daysSince(MANIFEST.built_at);
    if(age != null && age > 30){
      bar.textContent = `⚠ Données locales du ${fmtDate(MANIFEST.corpus_version)||'?'} (mises en cache il y a ${age} jours). Reconnectez-vous pour les actualiser.`;
      bar.hidden = false;
    } else bar.hidden = true;
  }catch(e){ bar.hidden = true; }
}

// ----- routage par permalien : #/fiche/<id> · #/theme/<slug> · #/q/<texte> (R3.1) -----
function go(kind, val){ location.hash = '#/'+kind+'/'+encodeURIComponent(val); }

const VIEWS = { home:'#view-home', themes:'#view-themes', aide:'#view-aide', detail:'#detail' };
function setView(name, tabHash){              // bascule la vue affichée + l'onglet actif
  for(const k in VIEWS){ const el = $(VIEWS[k]); if(el) el.hidden = (k !== name); }
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.h === tabHash;
    b.classList.toggle('on', on);
    if(on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');   // lecteurs d'écran
  });
  // Sur une fiche : on masque l'en-tête global (recherche) — la barre « Retour » du détail sert
  // d'en-tête plein écran (plus d'espace pour la réponse IA ; évite le chevauchement avec l'encoche).
  const onDetail = (name === 'detail');
  const hdr = document.querySelector('header'); if(hdr) hdr.hidden = onDetail;
  document.body.classList.toggle('detailing', onDetail);
  window.scrollTo(0, 0);
}
function showEmpty(){                          // état vide de l'accueil (invite à chercher)
  $('#results').innerHTML = '<div class="empty">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>'
    + '<h2>Cherchez une démarche</h2>'
    + '<p>Décrivez votre besoin en langage courant, ou parcourez les thèmes.</p>'
    + '<button class="btn sec" id="browse-themes" type="button">Parcourir les thèmes</button></div>';
  const b = $('#browse-themes'); if(b) b.onclick = () => { location.hash = '#/themes'; };
}
function browseTheme(slug){
  const t = THEMES.find(x=>x.slug===slug);
  showList(FICHES.filter(f=>f.theme_slug===slug).slice(0,60), t ? t.title : slug);
}
function render(){                           // applique l'état décrit par l'URL
  const h = location.hash || '#';
  if(h === '#/aide'){ setView('aide', '#/aide'); return; }
  if(h === '#/themes'){ setView('themes', '#/themes'); return; }
  if(h === '#/profil'){ setView('detail', '#/aide'); renderProfil(); return; }
  if(h === '#/aides'){ setView('detail', '#/aides'); if(window.renderSimu) renderSimu(); return; }   // simulateur « Mes aides » (simu.js)
  if(h === '#/chomage'){ setView('detail', '#/aides'); if(window.renderChomage) renderChomage(); return; }   // simulateur ciblé ARE (chomage.js)
  if(h.startsWith('#/parcours/')){ setView('detail', '#/aides'); if(window.renderParcours) renderParcours(decodeURIComponent(h.slice(11))); return; }   // événements de vie (parcours.js)
  if(h === '#/coffre'){ setView('detail', '#/aide'); if(window.renderCoffre) renderCoffre(); return; } // coffre 2D-Doc (coffre.js)
  const m = /^#\/(fiche|theme|q)\/(.+)$/.exec(h);
  if(!m){ if($('#q').value) $('#q').value=''; setView('home', '#'); showEmpty(); return; }
  const kind = m[1], val = decodeURIComponent(m[2]);
  if(kind === 'fiche'){ setView('detail', '#'); openFiche(val); }
  else if(kind === 'theme'){ setView('home', '#/themes'); browseTheme(val); }
  else if(kind === 'q'){ setView('home', '#'); if($('#q').value !== val) $('#q').value = val; search(val); }
}
window.addEventListener('hashchange', render);
document.querySelector('.tabbar').addEventListener('click', e => { const b = e.target.closest('.tab'); if(b) location.hash = b.dataset.h; });

// partage d'un permalien : Share natif (Capacitor) -> Web Share API -> copie du lien
async function shareFiche(sk){
  const url = location.origin + location.pathname + '#/fiche/' + encodeURIComponent(sk.id);
  const data = { title: sk.titre || 'Démarche', text: sk.titre || '', url };
  const Share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
  try{
    if(Share){ await Share.share(data); return; }
    if(navigator.share){ await navigator.share(data); return; }
    if(navigator.clipboard){ await navigator.clipboard.writeText(url); alert('Lien copié :\n' + url); return; }
    prompt('Copiez le lien de la fiche :', url);
  }catch(e){ /* annulation par l'usager : silencieux */ }
}

// ----- BM25 (pur JS) -----
function buildBM(docsText){
  const docs = docsText.map(toks), N = docs.length;
  const len = docs.map(d=>d.length), avg = len.reduce((a,b)=>a+b,0)/N;
  const df = new Map(), post = new Map();
  docs.forEach((d,i)=>{
    const tf = new Map();
    d.forEach(w=>tf.set(w,(tf.get(w)||0)+1));
    tf.forEach((f,w)=>{ if(!post.has(w))post.set(w,[]); post.get(w).push([i,f]); df.set(w,(df.get(w)||0)+1); });
  });
  const idf = new Map();
  df.forEach((n,w)=>idf.set(w, Math.log(1+(N-n+0.5)/(n+0.5))));
  const k1=1.5,b=0.75;
  return function(query){
    const sc = new Float64Array(N);
    new Set(toks(query)).forEach(w=>{
      if(!post.has(w))return; const id=idf.get(w);
      post.get(w).forEach(([i,f])=>{ sc[i]+= id*f*(k1+1)/(f+k1*(1-b+b*len[i]/avg)); });
    });
    return Array.from(sc.keys()).sort((a,c)=>sc[c]-sc[a]).filter(i=>sc[i]>0);
  };
}

// ----- chargement -----
async function boot(){
  try{
    const doc = await (await fetch('data/fiches.json')).json();
    FICHES = Array.isArray(doc) ? doc : (doc.fiches || []);   // rétrocompat ancien format
    BM = buildBM(FICHES.map(f => (f.title+' ').repeat(3) + (f.keywords||[]).join(' ').repeat(2) + ' ' + (f.path||[]).join(' ') + ' ' + (f.summary||'')));
    status(FICHES.length + ' fiches · hors-ligne');
    await renderThemes();
    checkFreshness();
    if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
    render();                          // applique la route initiale (permalien éventuel)
    // Chargements lourds EN TÂCHE DE FOND : la recherche de base (BM25) est utilisable
    // immédiatement (on ne bloque JAMAIS la saisie). On charge d'abord l'encodeur sémantique
    // (recherche avancée), PUIS l'assistant IA — search prêt plus tôt, moins de contention réseau.
    autoEnableSemantic().finally(maybePreloadLLM);
    probeNativeLLM();                   // iOS 26+ : assistant natif (FoundationModels) ?
  }catch(e){ status('erreur de chargement'); }
}
// Assistant IA NATIF (iOS 26+, FoundationModels) via plugin Capacitor. Remplace WebLLM (WebGPU),
// absent du WKWebView. On sonde la disponibilité au démarrage (l'appareil doit avoir Apple
// Intelligence activé + le modèle prêt). En natif seulement.
let NATIVE_LLM = null, NATIVE_LLM_OK = false;
function nativeLLMPlugin(){
  const C = window.Capacitor; if(!C) return null;
  if(C.Plugins && C.Plugins.NativeLLM) return C.Plugins.NativeLLM;
  if(typeof C.registerPlugin === 'function'){ try{ return C.registerPlugin('NativeLLM'); }catch(e){} }  // proxy vers le plugin natif
  return null;
}
async function probeNativeLLM(){
  if(!NATIVE) return;
  const C = window.Capacitor || {};
  const keys = Object.keys(C.Plugins || {}).join(',');
  const NL = nativeLLMPlugin();
  if(!NL){ assist('DIAG reg=' + (typeof C.registerPlugin) + ' plugins=[' + keys + ']'); return; }
  try{
    const r = await NL.available();
    if(r && r.available){
      NATIVE_LLM = NL; NATIVE_LLM_OK = true;
      assist('Assistant IA sur l\'appareil : prêt — ouvrez une démarche et demandez une explication.');
    }
    else assist('');   // pas d'IA native (Apple Intelligence requis) : on n'insiste pas
  }catch(e){ assist('DIAG call err=' + (e && e.message || e) + ' | plugins=[' + keys + ']'); }
}

async function renderThemes(){
  try{
    const t = await (await fetch('data/themes.json')).json();
    THEMES = t.themes || [];
    const cv = '<svg class="cv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
    $('#themes').innerHTML = THEMES.map(x=>`<button class="themerow" data-slug="${esc(x.slug)}"><span class="nm">${esc(x.title)}</span><span class="ct">${x.count|0}</span>${cv}</button>`).join('');
    $('#themes').onclick = e => { const b = e.target.closest('.themerow'); if(b) go('theme', b.dataset.slug); };
  }catch(e){}
}

// ----- recherche (BM25 + sémantique optionnelle) -----
let timer;
$('#q').addEventListener('input', e=>{ clearTimeout(timer); timer=setTimeout(()=>{
  const v = e.target.value;
  try{ history.replaceState(null, '', v.trim() ? ('#/q/'+encodeURIComponent(v.trim())) : '#'); }catch(_){}
  search(v);
}, 140); });
// Recherche sémantique par DÉFAUT (plus d'option) : on charge l'encodeur en tâche de fond au
// démarrage. Repli propre sur BM25 si le chargement échoue (la recherche marche quand même).
// EXCEPTION native (iOS/Android) : le WKWebView a des limites mémoire strictes ; charger l'encodeur
// e5 (~118 Mo ONNX) fait déborder le process de rendu (écran blanc/gel) dès qu'on lance une
// démarche → on reste sur BM25 (léger). La reformulation et les intentions curées marchent quand même.
async function autoEnableSemantic(){
  if(NATIVE){ semanticOn = false; status(FICHES.length + ' fiches · hors-ligne'); return; }
  try{
    await ensureEncoder(m => status(m + ' — vous pouvez déjà chercher'));   // BM25 dispo pendant le chargement
    semanticOn = true;
    status(FICHES.length + ' fiches · recherche avancée');
    if($('#q').value.trim()) search($('#q').value);           // ré-applique la recherche en cours
  }catch(e){
    semanticOn = false;
    status(FICHES.length + ' fiches · hors-ligne');            // repli BM25, sans bloquer
  }
}
// Assistant IA (WebLLM/WebGPU) : préchargé IMMÉDIATEMENT au démarrage s'il peut se lancer (navigateur
// avec WebGPU + adaptateur). Absent en app native (pas de WebGPU) → rien. But : réponses instantanées.
let LLM_OK = false;
function assist(msg){ const el = $('#assist'); if(!el) return; el.textContent = msg || ''; el.hidden = !msg; }
// bandeau assistant IA avec, si on n'est pas déjà sur le modèle léger, un lien « modèle plus léger »
// (utile dès le préchargement au démarrage : si Gemma est lent, on bascule et on recharge proprement).
function assistLLM(text){
  const el = $('#assist'); if(!el) return;
  el.hidden = !text;
  el.innerHTML = esc(text || '') + (getLLMPref() !== 'light' ? ' <a href="#" class="lien assist-sw">modèle plus léger</a>' : '');
  const sw = el.querySelector('.assist-sw');
  if(sw) sw.onclick = e => { e.preventDefault(); setLLMPref('light'); location.reload(); };  // recharge = annule le chargement en cours de Gemma
}
// Progression du chargement de l'assistant IA, EN FRANÇAIS (la lib renvoie de l'anglais dans p.text)
// + repère de temps pour rassurer. Le modèle (~290 Mo) se télécharge une fois puis reste en cache.
function frLLMProgress(p){
  const pct = (p && typeof p.progress === 'number') ? Math.max(0, Math.min(100, Math.round(p.progress * 100))) : 0;
  if(pct >= 100) return 'Assistant IA : finalisation…';
  return `Assistant IA : chargement du modèle… ${pct}% — comptez ~1 à 3 min au premier lancement (selon votre connexion), puis c'est quasi instantané. La recherche fonctionne déjà.`;
}
async function maybePreloadLLM(){
  if(NATIVE || !('gpu' in navigator)) return;                 // pas de WebGPU en WebView native
  let adapter = null; try{ adapter = await navigator.gpu.requestAdapter(); }catch(e){}
  if(!adapter) return;                                         // WebGPU présent mais pas d'accélération → on n'insiste pas
  LLM_OK = true;
  assistLLM(frLLMProgress());
  try{
    await ensureLLM(p => assistLLM(frLLMProgress(p)));
    const label = getLLMPref() === 'light' ? 'modèle léger' : 'Gemma';
    assistLLM('Assistant IA prêt (' + label + ') — demandez des explications sur une démarche.');
  }catch(e){ LLM_OK = false; assist(''); }
}

async function loadDocVectors(){
  if(DOCVEC) return;
  const meta = await (await fetch('data/embeddings.meta.json')).json();
  DOCDIM = meta.dim;
  DOCVEC = new Float32Array(await (await fetch('data/embeddings.bin')).arrayBuffer());
  const idToRow = new Map(meta.ids.map((id,r)=>[id,r]));
  ROWOF = FICHES.map(f => idToRow.has(f.id) ? idToRow.get(f.id) : -1);
}
// Transformers.js AUTO-HÉBERGÉ (D-03) : lib, runtime ORT (wasm) et poids servis par NOTRE
// origine — aucune requête vers un CDN tiers au runtime. Vendorisé par scripts/fetch_vendor.mjs.
// Version 3.8.1 (la "latest" 4.x casse la création du pipeline ASR seq2seq — cf. QA).
let _tf = null;
async function ensureTransformers(){
  if(_tf) return _tf;
  _tf = await import('./vendor/transformers/transformers.min.js');   // bundle auto-suffisant (ORT inclus)
  const { env } = _tf;
  env.allowLocalModels = true;                              // poids lus depuis notre origine
  env.allowRemoteModels = false;                            // interdit tout appel Hugging Face
  env.localModelPath = 'models/';                           // poids servis en local
  env.backends.onnx.wasm.wasmPaths = new URL('vendor/transformers/', location.href).href; // runtime ORT (wasm) local, chemin absolu
  env.backends.onnx.wasm.numThreads = 1;                     // pas de SharedArrayBuffer (pas de COEP)
  return _tf;
}
async function ensureEncoder(onStatus){
  if(encoder) return encoder;
  onStatus && onStatus('chargement de la recherche avancée… (~30 s au premier usage, puis instantané)');
  const { pipeline } = await ensureTransformers();
  encoder = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype:'q8', device:'wasm' });
  onStatus && onStatus('indexation… (presque prêt)'); await loadDocVectors();
  return encoder;
}
async function semanticRank(query){
  const out = await encoder('query: '+query, { pooling:'mean', normalize:true });
  const q = out.data, N = FICHES.length, sc = new Float64Array(N);
  let top = -1;
  for(let i=0;i<N;i++){
    const row = ROWOF[i]; if(row<0){ sc[i]=-1; continue; }
    let s=0, b=row*DOCDIM; for(let k=0;k<DOCDIM;k++) s += DOCVEC[b+k]*q[k]; sc[i]=s;
    if(s>top) top=s;
  }
  // top = meilleur cosinus (vecteurs normalisés) : sert de signal de confiance (cf. search)
  return { order: Array.from(sc.keys()).sort((a,b)=>sc[b]-sc[a]), top };
}
function rrf(rankings, k=60){
  const agg = new Map();
  for(const r of rankings) r.forEach((idx,pos)=> agg.set(idx,(agg.get(idx)||0)+1/(k+pos+1)));
  return [...agg.keys()].sort((a,b)=>agg.get(b)-agg.get(a));
}

// Seuils de confiance sémantique (cosinus e5, calibrés sur le corpus : demandes couvertes
// ~0,86-0,91 ; hors-domaine médical/charabia ~0,80-0,84). En-dessous, on ne DEVINE pas une
// réponse : on demande de reformuler (évite « appendicite » → fiche retraite/IVG affichée avec
// aplomb). SEM_STRONG = fort voisin, suffit seul. SEM_ANCHOR = plancher requis même quand un mot
// du corpus est présent (BM25≥1), pour écarter les faux ancrages lexicaux (« cassé »→« casse »).
const SEM_STRONG = 0.845, SEM_ANCHOR = 0.83;

async function search(q){
  if(TTS_OK) stopSpeaking();
  setView('home', '#');
  if(!q.trim()){ showEmpty(); return; }
  const bm = BM(q);                                   // indices avec au moins un mot du corpus
  let order = bm.slice(0,50), topSem = null;
  if(semanticOn && encoder){
    try{ const sem = await semanticRank(q); topSem = sem.top; order = rrf([bm.slice(0,50), sem.order.slice(0,50)]); }catch(e){}
  }
  // Trois paliers de confiance :
  //  · FORT    : fort voisin sémantique (ou, sans sémantique, un mot du corpus) → résultats seuls.
  //  · À PRÉCISER : ancrage lexical mais sémantique tiède → on CONJUGUE reformulation + résultats.
  //  · HORS-SUJET : aucun signal → reformulation en tête, résultats « approchés » en dessous.
  const qt = q.trim();
  const strong = (topSem !== null) ? (topSem >= SEM_STRONG) : (bm.length >= 1);
  const medium = !strong && (topSem !== null) && bm.length >= 1 && topSem >= SEM_ANCHOR;
  const results = order.slice(0,30).map(i=>FICHES[i]).filter(Boolean);
  if(strong){ showList(results, null, qt); return; }          // franc : la recherche suffit
  // Pas franc → CONJUGUER : pistes de reformulation EN TÊTE, recherche EN DESSOUS (toujours visible,
  // étiquetée « approchés » au palier hors-sujet). Si vraiment rien à montrer → carte de clarification.
  const curated = matchIntent(qt);
  if(!results.length && !curated.length){ renderClarify(qt, []); return; }
  renderConjugate(qt, curated, medium ? 'medium' : 'weak', results);
}
// Table d'intentions curée : pour des termes hors-domaine fréquents (santé, décès, naissance,
// emploi), proposer des démarches ADMINISTRATIVES à valider plutôt qu'un résultat au hasard.
// Chaque piste rouvre une recherche REFORMULÉE (#/q/…) qui, elle, tombe juste (vérifié).
// `stems` = radicaux repérés par SOUS-CHAÎNE (ex. « appendic » ⊂ « appendicite », « malad » ⊂
// « maladie ») ; `words` = mots courts/ambigus repérés en MOT ENTIER (ex. « mal », « soin »).
const INTENTS = [
  { stems: ['malad','douleur','souffr','hopital','hospitalis','clinique','medecin','docteur','dentiste','symptom','chirurg','fractur','appendic','cancer','grippe','angine','ordonnance','infection','migraine'],
    words: ['mal','maux','casse','cassee','soin','soins','covid','sante','malaise','fievre'],
    label: 'Une question de santé ? Vous cherchez peut-être à :',
    note: 'Pour un problème médical lui-même, adressez-vous à un professionnel de santé ou à l’Assurance maladie.',
    tips: [
      ['Être remboursé de soins ou de médicaments', 'remboursement frais de sante feuille de soins'],
      ['Obtenir ou transmettre un arrêt de travail', 'arret de travail maladie salarie'],
      ['Faire reconnaître une affection de longue durée (ALD)', 'affection longue duree ALD prise en charge'],
      ['Obtenir la complémentaire santé solidaire', 'complementaire sante solidaire'],
    ] },
  { stems: ['deces','decede','obseque','funerail','enterrement','defunt'],
    words: ['mort','morte','veuf','veuve','deuil'],
    label: 'À la suite d’un décès ? Vous cherchez peut-être à :',
    tips: [
      ['Connaître les démarches après un décès', 'que faire en cas de deces demarches'],
      ['Régler une succession / un héritage', 'regler une succession'],
      ['Demander une pension de réversion', 'pension de reversion'],
    ] },
  { stems: ['enceinte','grossesse','accouch','naissance','nourrisson','maternite','paternite'],
    words: ['bebe'],
    label: 'Une naissance à venir ? Vous cherchez peut-être à :',
    tips: [
      ['Connaître les démarches quand on devient parent', 'je deviens parent'],
      ['Demander les allocations (Paje, prime de naissance)', 'prestation accueil jeune enfant Paje prime naissance'],
      ['Prendre un congé maternité ou paternité', 'conge maternite paternite'],
    ] },
  { stems: ['chomage','chomeur','licenci'],
    words: ['emploi','vire','viree'],
    label: 'Une perte d’emploi ? Vous cherchez peut-être à :',
    tips: [
      ['Demander l’allocation chômage (ARE)', 'allocation chomage ARE'],
      ['Vous inscrire à France Travail', 'inscription france travail demandeur emploi'],
      ['Comprendre une rupture conventionnelle', 'rupture conventionnelle'],
    ] },
];
function matchIntent(q){
  const n = norm(q);
  const toks = new Set(n.match(/[a-z0-9]+/g) || []);
  const hit = INTENTS.find(it =>
    (it.stems||[]).some(s => n.includes(s)) || (it.words||[]).some(w => toks.has(w)));
  return hit ? [hit] : [];                     // au plus une catégorie (la plus pertinente)
}
// CONJUGUER recherche + reformulation : pistes de reformulation EN TÊTE (intentions curées à valider
// d'un tap), puis la RECHERCHE en dessous (étiquetée « approchés » au palier hors-sujet). L'usager
// voit toujours les deux. Bonus LLM (reformulation générée) ajouté si WebGPU présent (navigateur).
function renderConjugate(q, curated, tier, results){
  const intent = curated && curated[0];
  const cv = '<svg class="vcv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
  const tipBtn = (label, qq) => `<button class="vopt" type="button" data-q="${esc(qq)}"><span class="vl">${esc(label)}</span>${cv}</button>`;
  const reform = intent
    ? `<p class="vq">${esc(intent.label)}</p>${intent.note?`<p class="vnote">${esc(intent.note)}</p>`:''}<div class="vlist">${intent.tips.map(t=>tipBtn(t[0],t[1])).join('')}</div>`
    : `<p class="vq">${tier==='weak' ? `Je ne suis pas sûr d’avoir bien compris « ${esc(q)} ».` : 'Ce n’est pas la bonne démarche ?'} Reformulez votre demande dans la barre ci-dessus, ou :</p>`;
  const scv = '<svg class="subj-cv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
  const hitHtml = f => `<button class="subj" type="button" data-id="${esc(f.id)}"><span class="subj-tx"><span class="subj-t">${esc(f.title)}</span>${f.summary?`<span class="subj-s">${esc(f.summary)}</span>`:''}</span>${scv}</button>`;
  const list = tier==='weak' ? results.slice(0,6) : results;
  const resultsHtml = list.length
    ? `<div class="resblk ${tier==='weak'?'approx':''}"><p class="reslab">${tier==='weak'?'Résultats approchés (à vérifier) :':'Ou parmi ces résultats :'}</p><div class="subjlist">${list.map(hitHtml).join('')}</div></div>`
    : '';
  $('#results').innerHTML = `<div class="reformul">
      <h2>Précisons votre demande</h2>
      ${reform}
      <div class="rlinks"><button class="btn sec" id="v-themes" type="button">Parcourir les thèmes</button></div>
    </div>${resultsHtml}
    <p class="reassure">Reformulez votre demande dans la barre de recherche à tout moment.</p>`;
  $('#results').querySelectorAll('.vopt[data-q]').forEach(b=> b.onclick=()=>{ location.hash = '#/q/'+encodeURIComponent(b.dataset.q); });
  $('#results').querySelectorAll('.subj').forEach(el=> el.onclick=()=>go('fiche', el.dataset.id));
  const th = $('#v-themes'); if(th) th.onclick = () => { location.hash = '#/themes'; };
  maybeAddLLMReformulate(q);                   // bonus navigateur (WebGPU) ; inerte en natif
}
// Bonus : reformulation GÉNÉRÉE par le LLM local (Qwen via WebLLM/WebGPU). Absent en app native
// (pas de WebGPU) → bouton non ajouté. Propose des démarches que l'usager valide d'un tap.
async function maybeAddLLMReformulate(q){
  if(NATIVE || !('gpu' in navigator)) return;
  const host = $('#results .reformul, #results .clarify'); if(!host) return;
  const wrap = document.createElement('div'); wrap.className = 'vllm';
  wrap.innerHTML = `<button class="btn sec vllm-btn" type="button">Proposer des reformulations (assistant local)</button><div class="vllm-out"></div>`;
  const foot = host.querySelector('.rlinks'); (foot || host).appendChild(wrap);
  const btn = wrap.querySelector('.vllm-btn'), out = wrap.querySelector('.vllm-out');
  btn.onclick = async () => {
    btn.disabled = true;
    let adapter = null; try{ adapter = await navigator.gpu.requestAdapter(); }catch(e){}
    if(!adapter){ out.textContent = 'Assistant indisponible : aucun GPU compatible ici.'; return; }
    out.textContent = 'Préparation de l\'assistant IA… (~1 à 3 min au premier lancement, puis quasi instantané)';
    try{
      const eng = await ensureLLM(p => { out.textContent = frLLMProgress(p); });
      out.textContent = 'Reformulation…';
      const sys = "Tu aides à trouver la bonne démarche administrative française. À partir de la demande, propose de 2 à 4 démarches administratives précises que la personne pourrait vouloir accomplir. Une par ligne, courte (max 7 mots), sans numéro. Si la demande est médicale, propose les démarches liées (remboursement de soins, arrêt de travail, ALD…).";
      const r = await eng.chat.completions.create({ ...GEN_OPTS, max_tokens:160, messages:[{role:'system',content:sys},{role:'user',content:'Demande : '+q}] });
      const lines = (r.choices[0]?.message?.content || '').split('\n').map(s=>s.replace(/^[-*\d.\)\s]+/,'').trim()).filter(s=>s.length>2).slice(0,4);
      if(!lines.length){ out.textContent = 'Aucune suggestion.'; return; }
      out.innerHTML = `<p class="vq">L’assistant propose (à valider) :</p><div class="vlist">${lines.map(l=>`<button class="vopt" type="button" data-q="${esc(l)}"><span class="vl">${esc(l)}</span></button>`).join('')}</div>`;
      out.querySelectorAll('.vopt[data-q]').forEach(b=> b.onclick=()=>{ location.hash = '#/q/'+encodeURIComponent(b.dataset.q); });
    }catch(e){ out.textContent = 'Échec de la reformulation par l’assistant.'; }
  };
}
// « Je ne suis pas sûr de comprendre » : on nomme le doute, on recadre (administratif vs médical),
// on invite à reformuler / parcourir, et on cache les résultats approchés derrière un dépliant.
function renderClarify(q, guesses){
  const items = (guesses||[]).filter(Boolean).slice(0,5).map(f=>`
      <article class="hit" data-id="${esc(f.id)}">
        <div class="path">${esc((f.path||[]).join(' › '))}</div>
        <h3>${esc(f.title)}</h3>
      </article>`).join('');
  const approx = items ? `<details class="approx"><summary>Voir quand même des résultats approchés (peu fiables)</summary>${items}</details>` : '';
  $('#results').innerHTML = `<div class="clarify">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.2 9.3a2.8 2.8 0 1 1 4 2.5c-.9.5-1.4 1-1.4 2"/><circle cx="12" cy="16.4" r=".6" fill="currentColor" stroke="none"/></svg>
    <h2>Je ne suis pas sûr de comprendre « ${esc(q)} »</h2>
    <p>Cette application aide pour des <b>démarches administratives</b> (papiers, famille, travail, logement, santé…). Pour une question <b>médicale</b>, adressez-vous à un professionnel de santé ou à l'Assurance maladie.</p>
    <p class="hint">Reformulez plutôt avec ce que vous voulez <b>faire</b> — par exemple « remboursement de soins », « arrêt de travail » ou « aide à domicile ».</p>
    <button class="btn sec" id="clar-themes" type="button">Parcourir les thèmes</button>
    ${approx}
  </div>`;
  const bt = $('#clar-themes'); if(bt) bt.onclick = () => { location.hash = '#/themes'; };
  $('#results').querySelectorAll('.hit').forEach(el=> el.onclick=()=>go('fiche', el.dataset.id));
  maybeAddLLMReformulate(q);                   // bonus navigateur (WebGPU) ; inerte en natif
}
function showList(list, title, query){
  currentResults = list;
  // panneau IA seulement hors app native ET si l'API WebGPU existe. NB : le WKWebView iOS 26
  // EXPOSE navigator.gpu mais sans adaptateur exploitable → on masque en natif (NATIVE) plutôt
  // que sur ('gpu' in navigator). En natif, l'IA passerait de toute façon par un LLM natif (D-02).
  const ai = (query && !title && !NATIVE && ('gpu' in navigator)) ? `<div class="ai">
      <button class="ai-btn">Répondre avec l'assistant IA <span class="muted">· modèle local en WebGPU (~400 Mo au 1er lancement)</span></button>
      <div class="ai-out"></div><div class="ai-src"></div>
    </div>` : '';
  // Liste COMPACTE de sujets (titre + résumé sur 1 ligne) : on en voit 6-8 au lieu de 3, l'usager
  // choisit sa démarche. En-tête « quel sujet ? » pour une recherche (désambiguïsation).
  const cv = '<svg class="subj-cv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
  const head = title
    ? `<h2 class="listtitle">${esc(title)}</h2>`
    : (query && list.length ? `<p class="disambig">Quel sujet vous concerne ? Touchez la démarche qui correspond :</p>` : '');
  const rows = list.length
    ? `<div class="subjlist">${list.map(f=>`
        <button class="subj" type="button" data-id="${esc(f.id)}">
          <span class="subj-tx"><span class="subj-t">${esc(f.title)}</span>${f.summary?`<span class="subj-s">${esc(f.summary)}</span>`:''}</span>${cv}
        </button>`).join('')}</div>`
    : '<p class="muted">Aucune fiche trouvée.</p>';
  const foot = (query && !title && list.length) ? `<p class="reassure">Ce n'est pas ce que vous cherchez ? Reformulez votre demande dans la barre ci-dessus.</p>` : '';
  // détection d'ÉVÉNEMENT DE VIE : une recherche qui raconte l'événement propose le parcours
  // guidé (checklist + échéances) au-dessus des fiches, sans les remplacer.
  const EVENEMENTS = [
    { id:'chomage', re:/perd(re|s|u)?\s+(mon|son)\s+(emploi|travail|boulot|job|cdd|poste)|licenci|fin de (cdd|contrat|mission)|rupture conventionnelle|ch[ôo]mage/i,
      t:'Parcours guidé : je perds mon emploi', s:'Les démarches dans l\'ordre, avec vos échéances — inscription, allocation, mutuelle, aides.' },
    { id:'naissance', re:/enceinte|grossesse|b[ée]b[ée]|attend(s|ons)? un enfant|accouch|naissance|futur(e)? (papa|maman|parent)/i,
      t:'Parcours guidé : j\'attends un enfant', s:'De la déclaration de grossesse aux 5 jours pour déclarer la naissance — avec vos échéances.' },
    { id:'deces', re:/d[ée]c[èe]s|d[ée]c[ée]d[ée]|est morte?\b|obs[èe]ques|succession|veuf|veuve|perdu (ma|mon) (m[èe]re|p[èe]re|mari|femme|[ée]pou(x|se)|conjoint(e)?|fils|fille|fr[èe]re|s[oœ]ur|grand)/i,
      t:'Parcours guidé : un proche est décédé', s:'Les démarches dans l\'ordre, à votre rythme — déclaration, obsèques, banques, réversion, succession.' },
  ];
  const ev = (query && !title) ? EVENEMENTS.find(e => e.re.test(query)) : null;
  const evt = ev ? `<a class="evtcard" href="#/parcours/${ev.id}"><b>${ev.t}</b><span>${ev.s}</span></a>` : '';
  // DÉDUCTION DU CAS : si la phrase décrit une situation (« seule avec 2 enfants, je perds mon
  // CDD »), on la comprend localement et on propose les simulateurs PRÉ-REMPLIS — corrigible.
  let ded = '';
  const dd = (query && !title && window.deduceFacts) ? deduceFacts(query) : null;
  if(dd){
    deduceStash(query, dd);
    const links = [`<a class="lien" href="#/aides">Mes aides (pré-rempli)</a>`]
      .concat(dd.facts.motif ? [`<a class="lien" href="#/chomage">Allocation chômage (pré-rempli)</a>`] : []);
    ded = `<div class="dedcard"><b>D'après votre demande :</b> ${esc(dd.labels.join(' · '))}
      <span class="ded-links">${links.join(' · ')}</span></div>`;
  }
  $('#results').innerHTML = evt + ded + ai + head + rows + foot;
  const panel = $('#results .ai');
  if(panel) panel.querySelector('.ai-btn').onclick = () => askAI(query, panel);
  $('#results').querySelectorAll('.subj').forEach(el=> el.onclick=()=>go('fiche', el.dataset.id));
}

// ----- fiche / skill -----
async function openFiche(id){
  let sk;
  try{ sk = await (await fetch('data/skills/'+id+'.json')).json(); }
  catch(e){ alert('Fiche indisponible hors-ligne.'); return; }
  const d = $('#detail');
  const url = safeUrl(sk.url_officielle);
  const canAsk = NATIVE_LLM_OK || (!NATIVE && ('gpu' in navigator));   // IA native (FoundationModels) OU navigateur WebGPU
  const backIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  d.innerHTML = `
    <div class="dnav">
      <button class="back" type="button">${backIcon}<span>Retour</span></button>
      <span class="dt">${esc(sk.titre)}</span>
    </div>
    <div class="dbody">
      <div class="path">${esc((sk.theme||[]).join(' › '))}</div>
      <h2>${esc(sk.titre)}</h2>
      ${sk.maj?`<div class="verif">${checkIcon} Vérifié le ${esc(fmtDate(sk.maj))}</div>`:''}
      ${sk.resume?`<div class="resume">${esc(sk.resume)}</div><div id="resume-spk"></div>`:''}
      <p class="links"><a class="lien" href="${url}" target="_blank" rel="noopener noreferrer">Consulter la fiche officielle ↗</a>
         <button class="btn sec" id="share" type="button">Partager</button></p>
      ${canAsk ? `<div id="ai-explain" class="aiask">
        <p class="askhint">Besoin de comprendre ? <b>Demandez à l’assistant</b> une explication de cette démarche — étapes, pièces, où s’adresser. Modèle local, sur votre appareil.</p>
        <button class="btn sec" type="button">Demander des explications à l’assistant</button>
        <div class="ai-out"></div></div>` : '' }
      ${ (sk.plan_agent&&sk.plan_agent.length) ? `<button class="btn" id="start" type="button">Suivre la démarche pas à pas</button>` :
         `<p class="muted">Fiche d'information (pas de démarche guidée).</p>` }
      <div id="flow"></div>
    </div>`;
  d.querySelector('.back').onclick = ()=>{ if(TTS_OK) stopSpeaking(); if(history.length>1) history.back(); else { location.hash='#'; } };
  const start = d.querySelector('#start');
  if(start) start.onclick = ()=>{ start.disabled = true; start.hidden = true; runSkill(sk); };  // 1 seule fois : évite de relancer/ré-poser les questions
  const sh = d.querySelector('#share'); if(sh) sh.onclick = () => shareFiche(sk);
  const ax = d.querySelector('#ai-explain'); if(ax) ax.querySelector('button').onclick = () => explainFiche(sk, ax);
  if(sk.resume && TTS_OK) d.querySelector('#resume-spk').appendChild(makeSpeakBtn(()=>sk.resume));
}
// Explication d'une démarche par l'assistant local (natif iOS FoundationModels OU WebLLM), ancrée
// UNIQUEMENT sur la fiche. VERROU DE RÉENTRANCE : un 2e clic pendant une génération est ignoré
// (l'inférence sur l'appareil bloque le thread ; deux appels concurrents figeaient l'app).
// `finally` = l'état (bouton, verrou) est TOUJOURS réinitialisé, même en cas d'erreur/blocage géré.
let explaining = false;
async function explainFiche(sk, box){
  if(explaining) return;                          // déjà une génération en cours → on ignore
  explaining = true;
  const btn = box.querySelector('button'), out = box.querySelector('.ai-out');
  if(btn) btn.disabled = true;
  box.querySelectorAll('.ground, .spk, .llmswitch, .followup').forEach(el=>el.remove());   // nettoie l'exécution précédente
  const askPrompt = `Explique simplement cette démarche : à quoi elle sert, les étapes, les pièces à fournir et où s'adresser.\n\nFiche officielle :\n${skillToText(sk)}`;
  try{
    if(NATIVE_LLM_OK && NATIVE_LLM){              // assistant NATIF (iOS 26+, FoundationModels)
      out.textContent = 'L\'assistant réfléchit… (sur votre appareil)';
      const g = await NATIVE_LLM.generate({ system: SYS_AI, prompt: askPrompt });
      const answer = String((g && g.text) || '').trim();
      out.textContent = answer || 'Aucune réponse.';
      if(answer){
        await groundAnswer(box, answer, sk);
        if(TTS_OK) box.appendChild(makeSpeakBtn(()=>answer));
        attachFollowup(box, sk, [{role:'system',content:SYS_AI},{role:'user',content:askPrompt},{role:'assistant',content:answer}]);
      }
    } else {                                       // assistant WebLLM (navigateur, WebGPU)
      out.textContent = 'Vérification du GPU…';
      let adapter = null; try{ adapter = await navigator.gpu.requestAdapter(); }catch(e){}
      if(!adapter){ out.innerHTML = '<span class="muted">Assistant indisponible : aucun GPU compatible ici.</span>'; return; }
      out.textContent = 'Préparation de l\'assistant IA… (~1 à 3 min au premier lancement, puis quasi instantané)';
      const eng = await ensureLLM(p => { out.textContent = frLLMProgress(p); });
      out.textContent = '';
      const stream = await eng.chat.completions.create({ ...GEN_OPTS, stream:true,
        messages:[{role:'system',content:SYS_AI},{role:'user',content:askPrompt}] });
      for await (const ch of stream){ out.textContent += ch.choices[0]?.delta?.content || ''; }
      const answer = out.textContent;
      await groundAnswer(box, answer, sk);          // citation du passage + vérification de cohérence
      if(TTS_OK) box.appendChild(makeSpeakBtn(()=>answer));
      appendLLMSwitch(box, sk);                     // proposer un modèle plus léger si c'est lent
      attachFollowup(box, sk, [{role:'system',content:SYS_AI},{role:'user',content:askPrompt},{role:'assistant',content:answer}]);
    }
  }catch(e){
    out.innerHTML = '<span class="muted">Échec de l\'assistant : ' + esc(''+(e && e.message || e)) + '</span>';
    if(!(NATIVE_LLM_OK && NATIVE_LLM)) appendLLMSwitch(box, sk);
  }finally{
    explaining = false;
    if(btn){ btn.disabled = false; btn.textContent = 'Régénérer l\'explication'; }
    setTimeout(()=>{ const g = box.querySelector('.ground') || box.querySelector('.ai-out'); if(g) g.scrollIntoView({ block:'nearest', behavior:'smooth' }); }, 60);
  }
}
// Choix du modèle WebLLM (Gemma ↔ léger) offert dans le panneau IA : utile si Gemma est lent/lourd.
// Absent en natif (l'IA native = FoundationModels, pas de choix WebLLM).
function appendLLMSwitch(box, sk){
  if(NATIVE_LLM_OK) return;
  const light = getLLMPref() === 'light';
  const el = document.createElement('p'); el.className = 'llmswitch';
  el.innerHTML = light
    ? 'Modèle léger actif (plus rapide). <a href="#" class="lien sw">Revenir à Gemma</a>'
    : 'Réponse lente ? <a href="#" class="lien sw">Essayer un modèle plus léger</a>';
  el.querySelector('.sw').onclick = async e => {
    e.preventDefault();
    setLLMPref(light ? 'gemma' : 'light');
    if(engine){ try{ await engine.unload(); }catch(_){} engine = null; engineModel = null; }
    explainFiche(sk, box);                         // relance avec le modèle choisi
  };
  box.appendChild(el);
}
// CONVERSATION DE SUIVI : après la 1re réponse, l'usager peut demander des précisions. On conserve
// l'historique (la fiche est dans le 1er message → réponses toujours ancrées) et chaque tour est
// vérifié comme la 1re réponse (citation + badge de cohérence). Verrou partagé `explaining`
// (inférence sur l'appareil = mono-thread : jamais deux générations simultanées).
function attachFollowup(box, sk, history){
  if(!box || box.querySelector('.followup')) return;              // une seule zone de suivi par réponse
  const wrap = document.createElement('div');
  wrap.className = 'followup';
  wrap.innerHTML =
    '<div class="fu-thread"></div>' +
    '<div class="fu-row">' +
      '<input class="fu-in" type="text" enterkeyhint="send" autocomplete="off" ' +
        'placeholder="Poser une question complémentaire…" aria-label="Question complémentaire à l’assistant">' +
      '<button class="btn act fu-send" type="button">Envoyer</button>' +
    '</div>';
  box.appendChild(wrap);
  const thread = wrap.querySelector('.fu-thread');
  const input = wrap.querySelector('.fu-in');
  const send = wrap.querySelector('.fu-send');
  const submit = async () => {
    const q = input.value.trim();
    if(!q || explaining) return;                                 // vide, ou une génération déjà en cours
    explaining = true;
    input.value = ''; input.disabled = true; send.disabled = true;
    const turn = document.createElement('div'); turn.className = 'fu-turn';
    const qEl = document.createElement('div'); qEl.className = 'fu-q'; qEl.textContent = q;
    const aEl = document.createElement('div'); aEl.className = 'fu-a'; aEl.textContent = '…';
    turn.appendChild(qEl); turn.appendChild(aEl); thread.appendChild(turn);
    aEl.scrollIntoView({ block:'nearest' });
    const msgs = trimHistory(history).concat([{ role:'user', content:q }]);
    try{
      await generateChat(msgs, t => { aEl.textContent = t; });
      const ans = (aEl.textContent || '').trim();
      aEl.textContent = ans || 'Aucune réponse.';
      if(ans){
        history.push({ role:'user', content:q }, { role:'assistant', content:ans });
        await groundAnswer(turn, ans, sk);                       // même ancrage/vérif que la 1re réponse
        if(TTS_OK) turn.appendChild(makeSpeakBtn(()=>ans));
      }
    }catch(e){
      aEl.innerHTML = '<span class="muted">Échec : ' + esc(''+(e && e.message || e)) + '</span>';
    }finally{
      explaining = false; input.disabled = false; send.disabled = false; input.focus();
      setTimeout(()=>{ turn.scrollIntoView({ block:'nearest', behavior:'smooth' }); }, 60);
    }
  };
  send.onclick = submit;
  input.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); submit(); } });
}

// ----- déroulé de la démarche (mirroir de l'agent) -----
// Signature d'une option de décision, insensible à la FORMULATION : les fiches DILA reposent la
// même question plusieurs fois avec des libellés qui varient (« Vous dépendez du régime général
// (Caf) » puis « Vous relevez du régime général (Caf) »). On retire les mots de tournure pour ne
// garder que le contenu (→ « regime general caf »), et on trie les mots.
const DEC_TOURNURE = new Set(['vous','votre','vos','etes','dependez','relevez','releve','depend',
  'du','de','des','le','la','les','un','une','au','aux','ou','et','si','en','sur','par','pour','avec']);
function optSig(si){
  return (norm(si).match(/[a-z0-9]+/g)||[]).filter(w=>!DEC_TOURNURE.has(w)).sort().join(' ');
}
// Signature d'une décision = l'ensemble (trié) des signatures de ses options : deux décisions qui
// proposent les mêmes choix sont LA MÊME question, on ne la repose pas.
function decSig(dec){ return dec.branches.map(b=>optSig(b.si)).sort().join(' || '); }
function runSkill(sk){
  const flow = $('#flow'); flow.innerHTML='';
  const queue = [...(sk.procedure||[])];
  const profil = [], pieces = [];
  const answered = new Map();               // decSig → optSig choisie (mémoire des réponses du parcours)
  function finish(){
    // dédoublonnage des pièces
    const seen=new Set(), scoped=[];
    pieces.forEach(p=>{ const k=p.toLowerCase(); if(!seen.has(k)){seen.add(k);scoped.push(p);} });
    renderResult(sk, profil, scoped, flow);
  }
  function step(){
    while(queue.length){
      const n = queue.shift();
      if(n.type==='liste' && n.pieces) pieces.push(...(n.items||[]));
      else if(n.type==='etape') queue.unshift(...(n.contenu||[]));
      else if(n.type==='decision'){
        // question ÉQUIVALENTE déjà répondue plus haut ? → on suit la même branche sans la reposer
        const prev = answered.get(decSig(n));
        const same = prev !== undefined ? n.branches.find(b=>optSig(b.si)===prev) : null;
        if(same){
          const p=document.createElement('p'); p.className='qauto';
          p.textContent = '✓ ' + (same.si||'') + ' (déjà indiqué)';
          flow.appendChild(p);
          queue.unshift(...(same.procedure||[]));
          continue;
        }
        ask(n); return;
      }
    }
    finish();
  }
  function ask(dec){
    const box = document.createElement('div'); box.className='q';
    box.innerHTML = `<h4>${esc(decTitle(dec))}</h4><div class="opts"></div>`;
    const opts = box.querySelector('.opts');
    dec.branches.forEach((b,i)=>{
      const btn=document.createElement('button'); btn.className='opt'; btn.textContent=b.si||('Option '+(i+1));
      btn.onclick=()=>{
        if(btn.disabled) return;                                   // garde : pas de double déclenchement
        opts.querySelectorAll('.opt').forEach(o=>{ o.disabled=true; });   // TOUTES (dont celle cliquée)
        btn.classList.add('sel');
        profil.push(b.si);
        answered.set(decSig(dec), optSig(b.si));                   // mémorise pour les répétitions
        queue.unshift(...(b.procedure||[]));
        step();
      };
      opts.appendChild(btn);
    });
    flow.appendChild(box);
    setTimeout(()=>box.scrollIntoView({ block:'center', behavior:'smooth' }), 60);  // amène la nouvelle question à l'écran
  }
  step();
}
function decTitle(dec){
  // pas de question explicite dans la donnée : on formule à partir des options
  return 'Votre situation : ' + dec.branches.map(b=>b.si).filter(Boolean).slice(0,3).join(' / ') + (dec.branches.length>3?' …':'');
}

function recommend(sk, profil){
  const etr = profil.some(p=>norm(p).includes('etranger'));
  const tele = (sk.services_en_ligne||[]).filter(s=>s.type==='Téléservice');
  for(const s of (tele.length?tele:sk.services_en_ligne||[]))
    if(etr ? (s.url.includes('delivrance')||norm(s.label).includes('etranger')) : (s.url.includes('EtatCivil')||/France/.test(s.label))) return s;
  return tele[0]||(sk.services_en_ligne||[])[0]||null;
}

function renderResult(sk, profil, pieces, flow){
  const reco = recommend(sk, profil);
  let h = '';
  if(profil.length) h += `<div class="profil">${profil.map(p=>`<span>${esc(p)}</span>`).join('')}</div>`;
  if(pieces.length){
    h += `<div class="section"><h3>Pièces à fournir <span class="tag case">selon votre cas</span></h3><ul class="pieces">${pieces.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div>`;
  }
  const svcs = sk.services_en_ligne||[];
  if(svcs.length){
    h += `<div class="section"><h3>Démarche en ligne</h3>
      <div class="gate">⚠️ L'application n'effectue aucune démarche à votre place. En cliquant, <b>vous</b> ouvrez le téléservice officiel et le réalisez vous-même.</div>
      ${svcs.map((s,i)=>`<div class="svc"><span class="lbl">${esc(s.label)}${s.type?` <span class="muted">(${s.type})</span>`:''}${reco&&s.url===reco.url?' <span class="tag case">recommandé</span>':''}</span>
        <button class="btn act" data-url="${encodeURIComponent(s.url)}" data-lbl="${encodeURIComponent(s.label)}">Ouvrir ↗</button></div>`).join('')}
    </div>`;
  }
  const where = sk.ou_sadresser||[];
  if(where.length){
    h += `<div class="section"><h3>Où s'adresser</h3>
      ${where.map((w,i)=>`<div class="guichet" data-pivot="${esc(w.pivot||'')}" data-ann="${esc(w.annuaire||'')}" data-lbl="${esc(w.label||'')}">
        <b>${esc(w.label||'Guichet')}</b>
        ${w.pivot?`<div class="commune"><input placeholder="Votre commune (ex. Pantin)" /><button class="btn sec">Trouver</button></div><div class="out muted"></div>`
                 : (w.annuaire?`<a class="lien" href="${w.annuaire}" target="_blank" rel="noopener">Annuaire ↗</a>`:'')}
      </div>`).join('')}
    </div>`;
  }
  h += `<div class="section"><h3>Préparer mon dossier</h3>
    <p class="muted">Rassemblez situation, pièces et vos informations (pré-remplies depuis votre profil) à copier ou apporter. Rien n'est envoyé : vous soumettez vous-même sur le téléservice officiel.</p>
    <button class="btn" id="prep-dossier" type="button">Préparer mon dossier</button>
    <div id="dossier"></div></div>`;
  flow.insertAdjacentHTML('beforeend', h);
  // actions à garde-fou
  flow.querySelectorAll('.btn.act').forEach(b=> b.onclick=()=>{
    const url=decodeURIComponent(b.dataset.url), lbl=decodeURIComponent(b.dataset.lbl);
    if(confirm(`Ouvrir le téléservice officiel ?\n\n${lbl}\n${url}\n\nVous réaliserez la démarche vous-même.`)) window.open(url,'_blank','noopener');
  });
  // recherche de guichet (API Annuaire)
  flow.querySelectorAll('.guichet').forEach(g=>{
    const btn=g.querySelector('.btn.sec'); if(!btn)return;
    btn.onclick=()=> findGuichet(g);
  });
  // préparateur de dossier (récap pré-rempli + relais officiel)
  const pd = flow.querySelector('#prep-dossier');
  if(pd) pd.onclick = ()=> renderDossier(sk, profil, pieces, reco, flow.querySelector('#dossier'));
}

// ----- API Annuaire (geo.api + lannuaire) -----
async function findGuichet(g){
  const out=g.querySelector('.out'), nom=g.querySelector('input').value.trim();
  const pivot=g.dataset.pivot, ann=g.dataset.ann;
  if(!nom){ out.textContent='Indiquez une commune.'; return; }
  out.textContent='Recherche…';
  try{
    const geo = await (await fetch(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&fields=code,nom&limit=1`)).json();
    if(!geo.length){ out.textContent='Commune introuvable.'; return; }
    const insee=geo[0].code;
    const where=`code_insee_commune="${insee}" and pivot like "${pivot}"`;
    const url=`https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records?where=${encodeURIComponent(where)}&limit=1`;
    const r = await (await fetch(url)).json();
    const rec=(r.results||[])[0];
    if(!rec){ out.innerHTML = ann?`Pas de fiche locale. <a class="lien" href="${ann}" target="_blank" rel="noopener">Annuaire ↗</a>`:'Pas de résultat.'; return; }
    const P = v => { try{ return (typeof v==='string'&&/^[\[{]/.test(v))?JSON.parse(v):v; }catch(e){ return v; } };
    const ad=(P(rec.adresse)||[{}])[0]||{};
    const adr=[ad.numero_voie,ad.code_postal,ad.nom_commune].filter(Boolean).join(' ');
    const tel=(P(rec.telephone)||[]).map(x=>x.valeur).filter(Boolean).join(', ');
    const pl=(P(rec.plage_ouverture)||[]).map(p=>{
      const j=p.nom_jour_debut===p.nom_jour_fin||!p.nom_jour_fin?p.nom_jour_debut:`${p.nom_jour_debut}–${p.nom_jour_fin}`;
      const s=[[p.valeur_heure_debut_1,p.valeur_heure_fin_1],[p.valeur_heure_debut_2,p.valeur_heure_fin_2]]
        .filter(x=>x[0]&&x[1]).map(x=>`${x[0].slice(0,5)}-${x[1].slice(0,5)}`).join(' / ');
      return j&&s?`${j} ${s}`:'';
    }).filter(Boolean);
    out.innerHTML = `<b>${esc(rec.nom||'')}</b>${adr?'<br>'+esc(adr):''}${tel?'<br>tél. '+esc(tel):''}`+
      (pl.length?'<br>'+pl.map(esc).join('<br>'):'');
  }catch(e){
    out.innerHTML = ann?`Réseau indisponible. <a class="lien" href="${ann}" target="_blank" rel="noopener">Annuaire ↗</a>`:'Réseau indisponible.';
  }
}

// ===== Profil local (autofill privé) + Préparateur de dossier =====
// Le profil est saisi par l'usager et stocké UNIQUEMENT sur l'appareil (localStorage), JAMAIS
// transmis. Il pré-remplit un récapitulatif de dossier que l'usager copie/apporte au téléservice
// officiel, où IL s'authentifie (FranceConnect) et soumet. L'app n'agit jamais à sa place.
const PROFIL_KEY = 'sp_profil';
const PROFIL_FIELDS = [
  ['civilite','Civilité','Mme, M.'], ['prenom','Prénom(s)',''], ['nom','Nom',''],
  ['nom_naissance','Nom de naissance','si différent'], ['date_naissance','Date de naissance','JJ/MM/AAAA'],
  ['lieu_naissance','Lieu de naissance','commune, pays'], ['nationalite','Nationalité',''],
  ['adresse','Adresse','n° et voie'], ['code_postal','Code postal',''], ['commune','Commune',''],
  ['email','Courriel',''], ['telephone','Téléphone',''],
];
function getProfil(){ try{ return JSON.parse(localStorage.getItem(PROFIL_KEY)||'{}'); }catch(e){ return {}; } }
function setProfil(p){ try{ localStorage.setItem(PROFIL_KEY, JSON.stringify(p)); }catch(e){} }
function profilFormHtml(p){
  return `<div class="pform">${PROFIL_FIELDS.map(([k,label,ph])=>`
    <label class="pfield"><span>${esc(label)}</span>
      <input data-k="${k}" value="${esc(p[k]||'')}" placeholder="${esc(ph)}" autocomplete="off"></label>`).join('')}</div>`;
}
function readProfilForm(root){
  const p = {};
  root.querySelectorAll('.pform input[data-k]').forEach(i=>{ const v=i.value.trim(); if(v) p[i.dataset.k]=v; });
  return p;
}
// écran « Mon profil » (#/profil)
function renderProfil(){
  const p = getProfil(), d = $('#detail');
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  d.innerHTML = `
    <div class="dnav"><button class="back" type="button">${back}<span>Retour</span></button><span class="dt">Mon profil</span></div>
    <div class="dbody">
      <h2>Mon profil</h2>
      <p class="pnote">Ces informations sont enregistrées <b>uniquement sur cet appareil</b> et ne sont <b>jamais transmises</b>. Elles servent à pré-remplir vos dossiers pour aller plus vite.</p>
      ${profilFormHtml(p)}
      <button class="btn" id="psave" type="button">Enregistrer</button>
      <p id="pmsg" class="pmsg" aria-live="polite"></p>
    </div>`;
  d.querySelector('.back').onclick = ()=>{ if(history.length>1) history.back(); else location.hash='#/aide'; };
  d.querySelector('#psave').onclick = ()=>{ setProfil(readProfilForm(d)); const m=$('#pmsg'); if(m) m.textContent='Profil enregistré sur cet appareil.'; };
}
// presse-papier / partage d'un texte (natif Capacitor -> Web Share -> copie)
async function copyText(t){
  try{ if(navigator.clipboard){ await navigator.clipboard.writeText(t); return true; } }catch(e){}
  try{ prompt('Copiez le récapitulatif :', t); }catch(e){}
  return false;
}
async function shareText(title, text){
  const Share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
  try{
    if(Share){ await Share.share({ title, text }); return; }
    if(navigator.share){ await navigator.share({ title, text }); return; }
    await copyText(text); alert('Récapitulatif copié.');
  }catch(e){ /* annulation : silencieux */ }
}
// récapitulatif de dossier en texte brut (copiable / partageable)
function buildDossierText(sk, profil, pieces, svc, info){
  const L = [];
  L.push('DÉMARCHE : ' + (sk.titre||''));
  if(sk.url_officielle) L.push("D'après service-public.fr — " + safeUrl(sk.url_officielle));
  L.push('');
  if(profil.length){ L.push('VOTRE SITUATION'); profil.forEach(x=>L.push('- '+x)); L.push(''); }
  if(pieces.length){ L.push('PIÈCES À FOURNIR'); pieces.forEach(x=>L.push('- '+x)); L.push(''); }
  const infoLines = PROFIL_FIELDS.filter(([k])=>info[k]).map(([k,label])=>label+' : '+info[k]);
  if(infoLines.length){ L.push('VOS INFORMATIONS'); infoLines.forEach(x=>L.push(x)); L.push(''); }
  if(svc){ L.push('TÉLÉSERVICE OFFICIEL'); L.push((svc.label||'') + ' : ' + safeUrl(svc.url)); L.push(''); }
  L.push('— Récapitulatif préparé localement. L\'application n\'effectue aucune démarche à votre place.');
  return L.join('\n');
}
// préparateur de dossier : assemble situation + pièces + informations (pré-remplies depuis le
// profil), à copier/partager, puis relais vers le téléservice officiel (garde-fou conservé).
function renderDossier(sk, profil, pieces, svc, host){
  const p = getProfil();
  const cerfa = cerfaForFiche(sk);                 // CERFA remplissable pour cette fiche ?
  const cerfaHtml = cerfa ? `<div class="drow"><h4>Formulaire CERFA</h4>
      <p class="muted">Cerfa n° ${esc(cerfa.full)} — ${esc(cerfa.label||'')}. Pré-rempli avec vos informations ci-dessus ; à <b>vérifier, compléter et signer</b> avant dépôt.</p>
      <button class="btn" id="dcerfa" type="button">Pré-remplir le CERFA (PDF)</button>
      <p id="dcerfa-msg" class="pmsg" aria-live="polite"></p></div>` : '';
  host.innerHTML = `<div class="dossier">
    <div class="drow"><h4>Votre situation</h4>${profil.length?`<ul>${profil.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="muted">—</p>'}</div>
    <div class="drow"><h4>Pièces à fournir</h4>${pieces.length?`<ul>${pieces.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="muted">Voir la fiche officielle.</p>'}</div>
    <div class="drow"><h4>Vos informations <span class="muted">(sur cet appareil)</span></h4>
      ${profilFormHtml(p)}
      <button class="btn sec" id="dsave" type="button">Enregistrer mes informations</button></div>
    ${cerfaHtml}
    ${svc?`<div class="drow"><h4>Téléservice officiel</h4><p class="muted">${esc(svc.label||'')}</p>
      <button class="btn act" id="dopen" data-url="${encodeURIComponent(svc.url)}" data-lbl="${encodeURIComponent(svc.label||'')}">Ouvrir le téléservice ↗</button></div>`:''}
    <div class="dactions">
      <button class="btn" id="dcopy" type="button">Copier le récapitulatif</button>
      <button class="btn sec" id="dshare" type="button">Partager</button></div>
    <p class="gate">L'application ne soumet rien à votre place : vous ouvrez le téléservice officiel, vous vous authentifiez (par ex. FranceConnect) et vous validez vous-même.</p>
  </div>`;
  const text = () => buildDossierText(sk, profil, pieces, svc, readProfilForm(host));
  const save = host.querySelector('#dsave'); if(save) save.onclick = ()=>{ setProfil(readProfilForm(host)); save.textContent='Informations enregistrées ✓'; };
  const cp = host.querySelector('#dcopy'); if(cp) cp.onclick = async ()=>{ await copyText(text()); cp.textContent='Récapitulatif copié ✓'; };
  const shb = host.querySelector('#dshare'); if(shb) shb.onclick = ()=> shareText(sk.titre||'Dossier', text());
  const op = host.querySelector('#dopen'); if(op) op.onclick = ()=>{
    const url=decodeURIComponent(op.dataset.url), lbl=decodeURIComponent(op.dataset.lbl);
    if(confirm(`Ouvrir le téléservice officiel ?\n\n${lbl}\n${url}\n\nVous vous authentifiez et validez vous-même.`)) window.open(url,'_blank','noopener');
  };
  const cf = host.querySelector('#dcerfa'); if(cf) cf.onclick = async ()=>{
    cf.disabled = true; const st = host.querySelector('#dcerfa-msg'); st.textContent = 'Préparation du CERFA…';
    try{
      setProfil(readProfilForm(host));             // le pré-remplissage reflète le formulaire à l'écran
      deliverBlob(await fillCerfa(cerfa.num), 'cerfa_'+cerfa.num+'_prerempli.pdf');
      st.textContent = 'CERFA pré-rempli prêt. Vérifiez, complétez et signez avant de le déposer.';
    }catch(e){ st.textContent = 'Impossible de préparer le CERFA ici.'; }
    cf.disabled = false;
  };
  host.scrollIntoView({ behavior:'smooth', block:'start' });
}

// ===== CERFA pré-remplis (pdf-lib, hors-ligne, auto-hébergé) =====
// Registre des CERFA remplissables. Clé = numéro de base (avant le *). Seuls les « formulaireNG »
// ont des champs AcroForm remplissables ; les « Formulaire » classiques sont plats → pas d'entrée.
// Étendre = télécharger le PDF vierge, inspecter les champs (pdf-lib getFields), ajouter le mapping.
let _pdflib = null;
async function ensurePdfLib(){ if(!_pdflib) _pdflib = await import('./vendor/pdf-lib.esm.min.js'); return _pdflib; }
// Chaque champ est relatif au `prefix`. Types : text (profil→champ), combined (concatène des clés
// profil dans un champ), adresse (éclate « n° voie »), lieu (éclate « commune, pays »), date (éclate
// JJ/MM/AAAA en 3 champs), sexe (radio H/F depuis la civilité).
const CERFA = {
  '12669': {                                       // inscription sur les listes électorales
    file: 'cerfa/12669.pdf', prefix: 'topmostSubform[0].Page1[0].',
    text: {
      nom: 'infosPerso-identite-info-nomUsage[0]',
      nom_naissance: 'infosPerso-identite-info-nomNaissance[0]',
      prenom: 'infosPerso-identite-info-prenoms-concat[0]',
      code_postal: 'infosPerso-adresseDomicile-CodePostal[0]',
      commune: 'infosPerso-adresseDomicile-Commune[0]',
      email: 'infosPerso-contactPerso-info-mail1[0]',
      telephone: 'infosPerso-contact-tel-total[0]',
    },
    adresse: { num:'infosPerso-adresseDomicile-NumDom[0]', voie:'infosPerso-adresseDomicile-LibVoie[0]' },
    lieu: { commune:'infosPerso-identite-info-communeNaissance[0]', pays:'infosPerso-identite-info-paysNaissance[0]' },
    date: { j:'infosPerso-identite-info-dateNaissanceTriple-jourNaissance[0]', m:'infosPerso-identite-info-dateNaissanceTriple-moisNaissance[0]', a:'infosPerso-identite-info-dateNaissanceTriple-anneeNaissance[0]' },
    sexe: { field:'infosPerso-identite-info-sexe[0]', map:{ mme:'F', madame:'F', mlle:'F', m:'H', mr:'H', monsieur:'H' } },
  },
  '10431': {                                       // demande de capital décès (Assurance maladie)
    file: 'cerfa/10431.pdf', prefix: '',
    text: { adresse:'Votre adresse', code_postal:'code postal', commune:'Commune' },
    combined: [ { field:'Vos nom et prénoms', keys:['prenom','nom'] } ],
  },
  '13753': {                                       // déclaration de perte/vol d'un certificat d'immatriculation
    file: 'cerfa/13753.pdf', prefix: 'topmostSubform[0].Page1[0].',
    combined: [ { field:'txtNoms[0]', keys:['prenom','nom'] } ],
    date: { j:'numJourNaissance[0]', m:'numMoisNaissance[0]', a:'numAnneeNaissance[0]' },
  },
};
// un CERFA remplissable pour cette fiche ? (via services_en_ligne[].cerfa présent au registre)
function cerfaForFiche(sk){
  for(const s of (sk.services_en_ligne||[])){
    const num = s.cerfa && String(s.cerfa).split('*')[0];
    if(num && CERFA[num]) return { num, label: s.label || '', full: s.cerfa };
  }
  return null;
}
// remplit le PDF vierge à partir du profil local ; renvoie un Blob PDF (rien n'est envoyé)
async function fillCerfa(num){
  const spec = CERFA[num]; if(!spec) throw new Error('cerfa inconnu');
  const { PDFDocument } = await ensurePdfLib();
  const bytes = await (await fetch(spec.file)).arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption:true });
  const form = doc.getForm(), p = getProfil(), pre = spec.prefix || '';
  const setT = (name, val) => { if(val==null||val==='') return; try{ form.getTextField(pre+name).setText(String(val)); }catch(e){} };
  for(const [k, field] of Object.entries(spec.text||{})) setT(field, p[k]);
  for(const c of (spec.combined||[])){ setT(c.field, c.keys.map(k=>p[k]).filter(Boolean).join(c.sep||' ')); }
  if(spec.adresse && p.adresse){
    const m = /^\s*(\d+\s*(?:bis|ter|quater)?)\s+(.+)$/i.exec(p.adresse);
    if(m){ setT(spec.adresse.num, m[1].trim()); setT(spec.adresse.voie, m[2].trim()); }
    else setT(spec.adresse.voie, p.adresse);
  }
  if(spec.lieu && p.lieu_naissance){
    const parts = p.lieu_naissance.split(',').map(x=>x.trim()).filter(Boolean);
    if(parts[0]) setT(spec.lieu.commune, parts[0]); if(parts[1]) setT(spec.lieu.pays, parts[1]);
  }
  if(spec.date && p.date_naissance){
    const m = /(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/.exec(p.date_naissance);
    if(m){ setT(spec.date.j, m[1]); setT(spec.date.m, m[2]); setT(spec.date.a, m[3]); }
  }
  if(spec.sexe && p.civilite){
    const opt = spec.sexe.map[norm(p.civilite).replace(/[^a-z]/g,'')];
    if(opt){ try{ form.getRadioGroup(pre+spec.sexe.field).select(opt); }catch(e){} }
  }
  return new Blob([await doc.save()], { type:'application/pdf' });
}
// livraison du PDF : téléchargement (web) ou ouverture dans le WebView (natif → partage/enregistrement iOS)
function deliverBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  if(NATIVE){ window.open(url, '_blank'); }
  else { const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(()=>URL.revokeObjectURL(url), 8000);
}

// ----- génération locale (WebLLM / WebGPU) -----
let engine=null, currentResults=[];
// Modèles WebLLM auto-hébergés (id → lib WASM WebGPU + libellé). Téléchargés par fetch_webllm.mjs.
// `hub` (optionnel) : servir ce modèle depuis un repo Hugging Face À NOUS plutôt que par notre
// origine — nécessaire sur le Space (stockage limité à 1 Go : Gemma, 574 Mo, n'y tient pas avec le
// reste). La CSP autorise déjà huggingface.co/*.hf.co. En local/natif sans `hub`, tout reste servi
// par notre origine (D-03). Le repo est le nôtre : contenu contrôlé, pas de dépendance tierce.
const WEBLLM_MODELS = {
  'gemma3-1b-it-q4f16_1-MLC':          { wasm:'gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm',        label:'Gemma 3',        // ~600 Mo, préféré
                                         hub:'https://huggingface.co/alcrawfo/gemma3-1b-it-q4f16_1-MLC-web' },
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': { wasm:'Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm', label:'modèle léger' }, // ~290 Mo, repli rapide
};
const LLM_DEFAULT = 'gemma3-1b-it-q4f16_1-MLC';           // Gemma dès que possible
const LLM_LIGHT   = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';  // repli léger/rapide si l'appareil rame
// Préférence de modèle (localStorage) : 'gemma' (défaut) ou 'light'. Bascule auto si Gemma échoue.
function getLLMPref(){ try{ return localStorage.getItem('sp_llm') === 'light' ? 'light' : 'gemma'; }catch(e){ return 'gemma'; } }
function setLLMPref(v){ try{ localStorage.setItem('sp_llm', v === 'light' ? 'light' : 'gemma'); }catch(e){} }
function activeModelId(){ return getLLMPref() === 'light' ? LLM_LIGHT : LLM_DEFAULT; }
const SYS_AI = "Tu es un assistant qui explique les démarches administratives françaises en t'appuyant UNIQUEMENT sur la fiche officielle ci-dessous. N'utilise que ses informations, n'invente rien. Si l'information n'y figure pas, dis-le clairement. Si la démarche dépend de la situation, présente les cas. Sois concret et bref (étapes, pièces, où s'adresser). Réponds en français.";
// Paramètres de génération ANTI-BOUCLE. Un petit modèle (Qwen 0,5 Md) en décodage glouton
// (temperature 0) sans pénalité de répétition part en boucle : il répète la même phrase à l'infini
// (cas « passeport perdu »). frequency/presence_penalty pénalisent les tokens déjà émis et cassent
// la boucle ; une température basse mais NON nulle évite le point fixe glouton ; max_tokens borne
// la sortie même si une boucle s'amorce. Appliqués à toute génération de prose libre.
const GEN_OPTS = { temperature:0.3, top_p:0.9, frequency_penalty:0.6, presence_penalty:0.4, max_tokens:800 };

// WebLLM AUTO-HÉBERGÉ (D-03) : lib vendorée + lib WASM du modèle + poids servis par NOTRE origine
// (aucun CDN au runtime). Vendorisé/téléchargé par scripts/fetch_webllm.mjs. WebGPU (navigateur)
// seulement ; en natif le bouton IA est masqué (pas de WebGPU).
let _webllm = null, engineModel = null;
async function ensureWebLLM(){ if(!_webllm) _webllm = await import('./vendor/web-llm/index.js'); return _webllm; }
// Sonde de présence locale des poids (HEAD sur mlc-chat-config.json). Sur le Space, Gemma
// répond 404 (stockage 1 Go) → on bascule sur notre repo HF ; en local, tout est à nous.
const WEBLLM_LOCAL = {};
async function probeLocalModel(id){
  if(WEBLLM_LOCAL[id] !== undefined) return;
  try{
    const u = new URL('models/webllm/' + id + '/resolve/main/mlc-chat-config.json', location.href);
    WEBLLM_LOCAL[id] = (await fetch(u, { method:'HEAD' })).ok;
  }catch(e){ WEBLLM_LOCAL[id] = false; }
}
function webllmAppConfig(){
  const base = new URL('models/webllm/', location.href).href;   // poids servis par notre origine (D-03)
  // Un modèle local est-il réellement présent ici ? (HEAD sur sa config — sur le Space, Gemma n'y
  // est pas : on passe alors par notre repo HF via `hub`). Décision faite par appel, pas au boot.
  return { useIndexedDBCache: true,
    model_list: Object.entries(WEBLLM_MODELS).map(([id, m]) => ({
      model: (m.hub && !WEBLLM_LOCAL[id]) ? m.hub : base + id,  // web-llm y ajoute /resolve/main/
      model_id: id,
      model_lib: (m.hub && !WEBLLM_LOCAL[id]) ? m.hub + '/resolve/main/' + m.wasm : base + 'lib/' + m.wasm,
      overrides: { context_window_size: 4096 },
    })) };
}
async function ensureLLM(onProgress){
  const want = activeModelId();
  if(engine && engineModel === want) return engine;
  if(engine){ try{ await engine.unload(); }catch(e){} engine = null; engineModel = null; }   // changement de modèle
  const { CreateMLCEngine } = await ensureWebLLM();
  await Promise.all(Object.keys(WEBLLM_MODELS).map(probeLocalModel));   // local ou repo HF ? (2 HEAD, une fois)
  const appConfig = webllmAppConfig();
  try{
    engine = await CreateMLCEngine(want, { appConfig, initProgressCallback: onProgress });
    engineModel = want;
  }catch(e){
    // Repli AUTOMATIQUE vers le modèle léger si Gemma ne tient pas sur l'appareil (mémoire GPU, etc.)
    if(want !== LLM_LIGHT){
      setLLMPref('light');
      onProgress && onProgress({ progress:0, text:'Modèle trop lourd pour cet appareil — passage à un modèle plus léger…' });
      engine = await CreateMLCEngine(LLM_LIGHT, { appConfig, initProgressCallback: onProgress });
      engineModel = LLM_LIGHT;
    } else throw e;
  }
  return engine;
}
// Génère une réponse de chat à partir d'un historique [{role,content}].
// WebLLM : streaming, onTok(texteCumulé) appelé au fil de l'eau (mêmes GEN_OPTS anti-boucle).
// Natif iOS (FoundationModels = system+prompt, pas de rôles) : historique APLATI dans le prompt,
// un seul appel → onTok reçoit le texte final. Sert la 1re réponse ET les questions de suivi.
async function generateChat(messages, onTok){
  if(NATIVE_LLM_OK && NATIVE_LLM){
    const system = (messages.find(m=>m.role==='system')||{}).content || '';
    const prompt = messages.filter(m=>m.role!=='system')
      .map(m => (m.role==='user' ? 'Question : ' : 'Réponse : ') + m.content).join('\n\n');
    const g = await NATIVE_LLM.generate({ system, prompt });
    const txt = String((g && g.text) || '').trim();
    if(onTok) onTok(txt);
    return txt;
  }
  const eng = await ensureLLM();
  const stream = await eng.chat.completions.create({ ...GEN_OPTS, stream:true, messages });
  let acc = '';
  for await (const ch of stream){ acc += ch.choices[0]?.delta?.content || ''; if(onTok) onTok(acc); }
  return acc;
}
// Borne l'historique pour ne pas dépasser le contexte d'un petit modèle : on garde TOUJOURS le
// message système + le 1er message usager (qui contient la fiche = l'ancrage) + la 1re réponse,
// puis seulement les 3 derniers échanges. La fiche reste donc toujours en contexte.
function trimHistory(history){
  if(history.length <= 9) return history;
  return history.slice(0, 3).concat(history.slice(-6));
}
function skillToText(sk){
  let t = sk.titre + '\n' + (sk.resume||'') + '\n';
  (function walk(nodes){
    for(const n of nodes){
      if(t.length>4200) return;
      if(n.type==='info') t += n.texte + '\n';
      else if(n.type==='note') t += 'À noter : ' + n.texte + '\n';
      else if(n.type==='liste') t += n.items.map(i=>'- '+i).join('\n') + '\n';
      else if(n.type==='etape'){ if(n.titre) t += '\n# ' + n.titre + '\n'; walk(n.contenu||[]); }
      else if(n.type==='decision'){ for(const b of n.branches){ t += '\nSituation : ' + b.si + '\n'; walk(b.procedure||[]); } }
    }
  })(sk.procedure||[]);
  if((sk.pieces||[]).length) t += '\nPièces à fournir : ' + sk.pieces.join(' ; ') + '\n';
  if((sk.services_en_ligne||[]).length) t += '\nServices en ligne : ' + sk.services_en_ligne.map(s=>s.label).join(' ; ') + '\n';
  return t.slice(0,4500);
}

// ----- ancrage & vérification de la réponse IA sur la fiche -----
// On extrait les passages VERBATIM de la fiche (résumé, infos, notes, listes, pièces), on les
// compare à la réponse avec l'encodeur e5 DÉJÀ chargé, et on affiche le(s) passage(s) réel(s) le(s)
// plus proche(s) (citation non inventée) + un badge de cohérence selon le meilleur cosinus.
const GROUND_THRESH = 0.85;   // cosinus e5 réponse↔passage (calibré) au-dessus = « cohérent »
function fichePassages(sk){
  const out = [];
  const add = t => {
    t = (t||'').replace(/\s+/g,' ').trim();
    if(!t) return;
    if(t.length > 170){ splitSentences(t).forEach(s=>{ if(s.trim().length>=25) out.push(s.trim()); }); }
    else if(t.length >= 20) out.push(t);
  };
  add(sk.resume);
  (function walk(nodes){
    for(const n of nodes||[]){
      if(n.type==='info' || n.type==='note') add(n.texte);
      else if(n.type==='liste') (n.items||[]).forEach(add);
      else if(n.type==='etape'){ add(n.titre); walk(n.contenu); }
      else if(n.type==='decision'){ for(const b of n.branches||[]) walk(b.procedure); }
    }
  })(sk.procedure);
  (sk.pieces||[]).forEach(add);
  const seen = new Set(), uniq = [];
  for(const p of out){ const k = norm(p); if(!seen.has(k)){ seen.add(k); uniq.push(p); } }
  return uniq.slice(0, 48);
}
async function groundAnswer(host, answer, sk){
  if(!host || !answer || answer.trim().length < 20) return;
  const passages = fichePassages(sk);
  // 1) CITATION via e5 : le(s) passage(s) réel(s) de la fiche le(s) plus proche(s) (jamais inventé).
  let citeHtml = '';
  if(encoder && passages.length){
    try{
      const qv = (await encoder('query: ' + answer, { pooling:'mean', normalize:true })).data;
      const pe = await encoder(passages.map(p => 'passage: ' + p), { pooling:'mean', normalize:true });
      const dim = qv.length, N = passages.length, D = pe.data, sc = [];
      for(let i=0;i<N;i++){ let s=0, b=i*dim; for(let k=0;k<dim;k++) s += D[b+k]*qv[k]; sc.push([s,i]); }
      sc.sort((a,b)=>b[0]-a[0]);
      const cites = sc.slice(0,2).filter(x=>x[0] >= sc[0][0] - 0.06).map(x=>passages[x[1]]);
      citeHtml = `<p class="glab">Passage${cites.length>1?'s':''} de la fiche officielle :</p>`
        + cites.map(c=>`<blockquote class="gquote">${esc(c)}</blockquote>`).join('');
    }catch(e){}
  }
  const block = document.createElement('div'); block.className = 'ground';
  block.innerHTML = `<div class="gverdict"><span class="gbadge muted">Vérification de cohérence par l’assistant…</span></div>${citeHtml}`;
  host.appendChild(block);
  // 2) VÉRIFICATION de cohérence : 2e passe du LLM (juge) — la réponse est-elle fidèle à la fiche ?
  const vel = block.querySelector('.gverdict');
  if(!engine){ vel.remove(); return; }
  try{
    const sys = "Tu es un vérificateur. On te donne une FICHE officielle et une RÉPONSE. Vérifie si la réponse est FIDÈLE à la fiche : aucune information inventée, aucune contradiction. Réponds en UNE ligne commençant par un seul mot en MAJUSCULES — FIDELE ou ECART — puis ' - ' et une raison très courte en français.";
    const r = await engine.chat.completions.create({ temperature:0, max_tokens:90, frequency_penalty:0.3,
      messages:[{ role:'system', content:sys },
                { role:'user', content:`FICHE :\n${skillToText(sk)}\n\nRÉPONSE :\n${answer}\n\nVerdict :` }] });
    const txt = (r.choices[0]?.message?.content || '').trim();
    const first = norm((txt.match(/[A-Za-zÀ-ÿ]+/) || [''])[0]).toUpperCase();   // accents retirés
    // Le verdict repose d'abord sur le 1er mot (FIDELE/ECART, format demandé). En repli, on ne
    // signale un ÉCART que sur des MARQUEURS multi-mots (peu sensibles à la négation : « rien
    // n'est inventé » ne doit PAS déclencher). Par défaut : FIDÈLE (réponses déjà ancrées).
    const nt = norm(txt);
    const ecart = first.startsWith('ECART')
      || (!first.startsWith('FIDELE') && /(ne figure pas|apparait pas|contredit|en contradiction|absent[e]? de la fiche|hors de la fiche|non conforme|pas dans la fiche)/.test(nt));
    const reason = txt.replace(/^[^-–—:\n]*[-–—:]\s*/, '').replace(/^(fid[eè]le|[eé]cart)\b[\s:.\-–—]*/i, '').trim().slice(0, 200);
    vel.innerHTML = `<span class="gbadge ${ecart?'warn':'ok'}">${ecart ? '⚠ Écart possible avec la fiche' : '✓ Vérifié cohérent avec la fiche'}</span>`
      + (reason ? `<span class="greason">${esc(reason)}</span>` : '');
  }catch(e){ vel.remove(); }
}
async function askAI(query, panel){
  const out = panel.querySelector('.ai-out'), src = panel.querySelector('.ai-src'), btn = panel.querySelector('.ai-btn');
  btn.disabled = true; src.textContent = '';
  panel.querySelectorAll('.ground, .spk, .followup').forEach(el=>el.remove());   // nettoie une réponse précédente
  if(!('gpu' in navigator)){
    out.innerHTML = '<span class="muted">Réponse IA indisponible : ce navigateur n\'a pas WebGPU. La recherche et le déroulé des démarches fonctionnent sans modèle (Chrome/Edge récents activent WebGPU).</span>';
    btn.disabled = false; return;
  }
  out.textContent = 'Vérification du GPU…';
  let adapter = null; try{ adapter = await navigator.gpu.requestAdapter(); }catch(e){}
  if(!adapter){
    out.innerHTML = '<span class="muted">WebGPU est présent mais aucun GPU compatible n\'a été trouvé ici (cas fréquent en navigateur sans accélération). La recherche et le déroulé des démarches fonctionnent sans modèle ; la réponse IA s\'activera sur un navigateur avec GPU (Chrome/Edge récents).</span>';
    btn.disabled = false; return;
  }
  const top = currentResults[0]; if(!top){ btn.disabled=false; return; }
  let sk;
  try{ sk = await (await fetch('data/skills/'+top.id+'.json')).json(); }
  catch(e){ out.textContent='Fiche indisponible.'; btn.disabled=false; return; }
  out.textContent = 'Préparation de l\'assistant IA… (~1 à 3 min au premier lancement, puis quasi instantané)';
  try{
    const eng = await ensureLLM(p => { out.textContent = frLLMProgress(p); });
    out.textContent = '';
    const stream = await eng.chat.completions.create({ ...GEN_OPTS, stream:true,
      messages:[{role:'system',content:SYS_AI},
                {role:'user',content:`Question : ${query}\n\nFiche officielle :\n${skillToText(sk)}`}] });
    for await (const ch of stream){ out.textContent += ch.choices[0]?.delta?.content || ''; }
    const answer = out.textContent;
    src.innerHTML = `Source : <a class="lien" href="${sk.url_officielle}" target="_blank" rel="noopener">${esc(sk.titre)} (${sk.id}) ↗</a> · <a class="lien ai-open" href="#" data-id="${sk.id}">suivre la démarche pas à pas</a>`;
    const op = src.querySelector('.ai-open'); if(op) op.onclick = e => { e.preventDefault(); go('fiche', sk.id); };
    await groundAnswer(panel, answer, sk);        // citation du passage + vérification de cohérence
    if(TTS_OK) panel.appendChild(makeSpeakBtn(()=>answer));
    attachFollowup(panel, sk, [{role:'system',content:SYS_AI},
      {role:'user',content:`Question : ${query}\n\nFiche officielle :\n${skillToText(sk)}`},
      {role:'assistant',content:answer}]);
  }catch(e){
    out.innerHTML = '<span class="muted">Échec de la génération locale : '+esc(''+e)+'</span>';
  }
  btn.disabled = false;
}

function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ----- voix : lecture à voix haute (Web Speech API, natif) -----
const TTS_OK = ('speechSynthesis' in window) && window.SpeechSynthesisUtterance;
let frVoice, voicesReady = false;
function pickFrVoice(){
  const vs = speechSynthesis.getVoices();
  if(!vs.length) return undefined;
  voicesReady = true;
  const fr = vs.filter(v=>v.lang && v.lang.toLowerCase().startsWith('fr'));
  const local = fr.find(v=>v.localService && v.lang.toLowerCase()==='fr-fr') || fr.find(v=>v.localService) ||
                fr.find(v=>v.lang.toLowerCase()==='fr-fr') || fr[0];
  frVoice = local; // undefined si aucune voix française : on parlera quand même avec la voix par défaut
  return frVoice;
}
function ensureVoices(){
  return new Promise(resolve=>{
    if(!TTS_OK){ resolve(); return; }
    pickFrVoice();
    if(voicesReady){ resolve(); return; }
    let done=false;
    const fin=()=>{ if(done)return; done=true; pickFrVoice(); resolve(); };
    speechSynthesis.addEventListener('voiceschanged', fin, { once:true });
    setTimeout(fin, 1200); // repli : certains navigateurs ne déclenchent jamais l'évènement
  });
}
function splitSentences(text){
  return (text||'').replace(/\s+/g,' ').trim()
    .split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
}
let speakState = null; // { btn } de l'utterance en cours, ou null si silence
function stopSpeaking(){
  if(!TTS_OK) return;
  speechSynthesis.cancel();
  if(speakState){ resetSpkBtn(speakState.btn); ttsStatus('Lecture arrêtée.'); }
  speakState = null;
}
function resetSpkBtn(btn){
  btn.textContent = '🔊 Écouter';
  btn.setAttribute('aria-label','Écouter');
  btn.classList.remove('speaking');
}
function ttsStatus(msg){
  const live = $('#micstatus'); if(live) live.textContent = msg;
}
async function speakText(text, btn){
  if(!TTS_OK) return;
  await ensureVoices();
  const sentences = splitSentences(text);
  if(!sentences.length) return;
  const state = { btn };
  speakState = state;
  btn.textContent = '⏸ Arrêter';
  btn.setAttribute('aria-label','Arrêter la lecture');
  btn.classList.add('speaking');
  ttsStatus('Lecture démarrée.');
  let i = 0;
  function speakNext(){
    if(speakState !== state || i >= sentences.length){
      if(speakState === state){ resetSpkBtn(btn); speakState = null; ttsStatus('Lecture terminée.'); }
      return;
    }
    const u = new SpeechSynthesisUtterance(sentences[i++]);
    if(frVoice) u.voice = frVoice;
    u.lang = (frVoice && frVoice.lang) || 'fr-FR';
    u.onend = speakNext;
    u.onerror = ev => {
      if(ev.error === 'interrupted' || ev.error === 'canceled') return; // annulation volontaire : rien à signaler
      resetSpkBtn(btn); speakState = null; ttsStatus('La lecture a rencontré une erreur.');
    };
    speechSynthesis.speak(u);
  }
  speakNext();
}
function makeSpeakBtn(getText){
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'spk'; btn.textContent = '🔊 Écouter'; btn.setAttribute('aria-label','Écouter');
  btn.onclick = () => {
    if(speakState && speakState.btn === btn){ stopSpeaking(); return; }
    stopSpeaking();
    speakText(getText(), btn);
  };
  return btn;
}
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) stopSpeaking(); });
window.addEventListener('pagehide', stopSpeaking);

// ----- voix : dictée (Whisper local via Transformers.js, hors-ligne après 1er usage) -----
// Dictée : le WebView iOS (WKWebView, iOS 14.3+) expose getUserMedia + MediaRecorder — VÉRIFIÉ
// sur simulateur iOS 26 (gUM=true, MR=true, sec=true). On les utilise donc directement sur iOS.
// Sur Android (WebView souvent sans MediaRecorder), on passe par le plugin natif s'il est présent
// (`capacitor-voice-recorder`, inclus dans le build Android). Même transcription Whisper des 2 côtés.
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const voiceRecorder = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VoiceRecorder;
const ASR_OK = (window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
            || (NATIVE && !!voiceRecorder());
let asr = null, mediaRecorder = null, micStream = null, recChunks = [], recording = false;
function micUiIdle(){
  const btn = $('#mic'); if(!btn) return;
  btn.textContent = '🎤 Dicter ma question'; btn.setAttribute('aria-label','Dicter ma question');
  btn.classList.remove('rec'); btn.disabled = false;
}
function micStatus(msg, isErr){
  const live = $('#micstatus'); if(!live) return;
  live.textContent = msg; live.classList.toggle('err', !!isErr);
}
async function ensureASR(onStatus){
  if(asr) return asr;
  onStatus && onStatus('Chargement de la dictée… (~80 Mo, ~20 s au premier usage, puis instantané)');
  const { pipeline } = await ensureTransformers();   // lib + poids auto-hébergés (D-03)
  // une nouvelle tentative après un court délai absorbe l'échec transitoire observé lors
  // d'un rechargement à froid du modèle (session onnxruntime créée pendant que des shards
  // finissent d'être mis en cache) ; l'échec initial est silencieux, seul l'échec final l'est.
  for(let attempt=1; attempt<=2; attempt++){
    try{
      asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { dtype:'q8', device:'wasm' });
      return asr;
    }catch(e){
      asr = null;
      if(attempt===2) throw e;
      onStatus && onStatus('nouvelle tentative de chargement du modèle de dictée…');
      await new Promise(r=>setTimeout(r,800));
    }
  }
}
function stopMicTracks(){
  if(micStream){ micStream.getTracks().forEach(t=>t.stop()); micStream = null; }
}
async function toggleMic(){
  const btn = $('#mic'); if(!btn) return;
  if(NATIVE && voiceRecorder()) return nativeToggleMic();   // app native → plugin d'enregistrement
  if(recording){ if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); return; }
  recording = true; // verrou pris avant l'await pour empêcher un second appel concurrent
  recChunks = [];
  let stream;
  try{
    stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  }catch(e){
    recording = false;
    let msg = 'Micro indisponible : erreur inconnue.';
    if(e && e.name === 'NotAllowedError') msg = "Micro refusé : autorisez l'accès au microphone dans les réglages du navigateur pour dicter votre question.";
    else if(e && e.name === 'NotFoundError') msg = 'Aucun microphone détecté sur cet appareil.';
    micStatus(msg, true);
    return;
  }
  micStream = stream;
  try{
    mediaRecorder = new MediaRecorder(stream);
  }catch(e){
    recording = false;
    micStatus("Enregistrement audio non pris en charge par ce navigateur.", true);
    stopMicTracks();
    return;
  }
  mediaRecorder.ondataavailable = ev => { if(ev.data && ev.data.size) recChunks.push(ev.data); };
  mediaRecorder.onstop = () => onRecordingStop();
  mediaRecorder.start();
  recording = true;
  btn.textContent = '🔴 Enregistrement… (cliquer pour arrêter)';
  btn.setAttribute('aria-label','Arrêter l\'enregistrement');
  btn.classList.add('rec');
  micStatus('Enregistrement démarré.');
}
async function onRecordingStop(){
  recording = false;
  stopMicTracks(); // libère le micro au plus tôt
  const btn = $('#mic');
  if(btn){ btn.disabled = true; }
  micStatus('Transcription en cours…');
  try{
    const blob = new Blob(recChunks, { type: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' });
    recChunks = [];
    await transcribeBlob(blob);
  }catch(e){
    micStatus('Échec de la dictée : ' + (e && e.message ? e.message : 'erreur du modèle local') + '.', true);
  }finally{
    micUiIdle();
  }
}
// transcription commune (web ET natif) : blob audio -> PCM 16k mono -> Whisper -> champ de recherche
async function transcribeBlob(blob){
  if(!blob || !blob.size){ micStatus('Aucun son enregistré.', true); return; }
  const float32 = await decodeToMono16k(blob);
  await ensureASR(m=>micStatus(m));
  const out = await asr(float32, { language:'french', task:'transcribe', chunk_length_s:30, stride_length_s:5 });
  const text = (out && out.text || '').trim();
  if(text){ $('#q').value = text; $('#q').focus(); micStatus('Transcription prête : vérifiez le texte avant de lancer la recherche.'); }
  else micStatus('Aucune parole reconnue, réessayez.', true);
}
function base64ToBlob(b64, mime){
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'audio/aac' });
}
// dictée en app native (Capacitor) : enregistrement via plugin, puis même pipeline Whisper
async function nativeToggleMic(){
  const btn = $('#mic'); if(!btn) return;
  const VR = voiceRecorder();
  if(recording){                                   // arrêt + transcription
    recording = false; btn.disabled = true; micStatus('Transcription en cours…');
    try{
      const res = await VR.stopRecording();
      const v = res && res.value;
      if(!v || !v.recordDataBase64){ micStatus('Aucun son enregistré.', true); return; }
      await transcribeBlob(base64ToBlob(v.recordDataBase64, v.mimeType));
    }catch(e){ micStatus('Échec de la dictée : ' + (e && e.message ? e.message : 'erreur') + '.', true); }
    finally{ micUiIdle(); }
    return;
  }
  recording = true;                                // démarrage
  try{
    const perm = await VR.requestAudioRecordingPermission();
    if(perm && perm.value === false){ recording = false; micStatus("Micro refusé : autorisez l'accès au microphone dans les réglages.", true); return; }
    await VR.startRecording();
  }catch(e){ recording = false; micStatus('Micro indisponible : ' + (e && e.message ? e.message : 'erreur') + '.', true); return; }
  btn.textContent = '🔴 Enregistrement… (cliquer pour arrêter)';
  btn.setAttribute('aria-label', 'Arrêter l\'enregistrement');
  btn.classList.add('rec');
  micStatus('Enregistrement démarré.');
}
async function decodeToMono16k(blob){
  const buf = await blob.arrayBuffer();
  const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await tmpCtx.decodeAudioData(buf);
  tmpCtx.close && tmpCtx.close();
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration*16000), 16000);
  const src = offline.createBufferSource();
  src.buffer = decoded; src.connect(offline.destination); src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

function stopRecording(){
  if(!recording) return;
  if(NATIVE && voiceRecorder()){ voiceRecorder().stopRecording().catch(()=>{}); recording = false; micUiIdle(); }
  else if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) stopRecording(); });
window.addEventListener('pagehide', stopRecording);

function initVoiceUI(){
  if(TTS_OK) ensureVoices();
  const mic = $('#mic');
  if(mic){
    if(ASR_OK){ mic.hidden = false; mic.onclick = toggleMic; }
    else mic.hidden = true;
  }
}
initVoiceUI();
boot();
