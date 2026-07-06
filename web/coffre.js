// « Mon coffre » : scan de codes 2D-Doc (le code-barres SIGNÉ présent sur les documents
// officiels français — avis d'imposition, justificatifs de domicile, attestations…).
// Tout se passe SUR L'APPAREIL : décodage DataMatrix (ZXing vendorisé), lecture du format
// 2D-Doc (spécifications ANTS), vérification de la signature ECDSA (WebCrypto) contre les
// clés publiques des émetteurs embarquées (web/vendor/2ddoc/keys.json, issues de la TSL ANTS).
// Les données certifiées extraites (revenu fiscal de référence, identité, adresse…) sont
// stockées en localStorage et servent à PRÉ-REMPLIR « Mes aides » et « Mon profil » —
// c'est le « Dites-le-nous une fois » inversé : l'usager détient ses attestations.
const COFFRE_KEY = 'sp_coffre_v1';
const DDOC_GS = '\x1d', DDOC_RS = '\x1e', DDOC_US = '\x1f';

function getCoffre(){ try{ return JSON.parse(localStorage.getItem(COFFRE_KEY)||'[]'); }catch(e){ return []; } }
function setCoffre(v){ try{ localStorage.setItem(COFFRE_KEY, JSON.stringify(v)); }catch(e){} }

// ----- parseur 2D-Doc (spécifications ANTS v2/v3/v4) -----
function ddocDate(hex4){                       // jours (hex) depuis le 01/01/2000 ; FFFF = néant
  if(!hex4 || hex4.toUpperCase() === 'FFFF') return null;
  const days = parseInt(hex4, 16);
  if(isNaN(days)) return null;
  const d = new Date(Date.UTC(2000, 0, 1)); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function parse2DDoc(raw){
  const s = String(raw || '');
  if(!s.startsWith('DC') || s.length < 22) throw new Error("Ce code n'est pas un 2D-Doc (marqueur DC absent).");
  const ver = parseInt(s.slice(2, 4), 10);
  if(![2, 3, 4].includes(ver)) throw new Error('Version 2D-Doc non gérée : ' + s.slice(2, 4));
  const headerLen = ver === 2 ? 22 : ver === 3 ? 24 : 26;
  const header = {
    version: ver,
    ca_id: s.slice(4, 8), cert_id: s.slice(8, 12),
    issue_date: ddocDate(s.slice(12, 16)), signature_date: ddocDate(s.slice(16, 20)),
    doc_type: s.slice(20, 22),
    perimeter: ver >= 3 ? s.slice(22, 24) : '',
    country: ver >= 4 ? s.slice(24, 26) : 'FR',
  };
  // séparation données / signature (US), la signature couvre en-tête + message
  const usAt = s.indexOf(DDOC_US);
  const payload = usAt >= 0 ? s.slice(0, usAt) : s;
  const sigB32 = usAt >= 0 ? s.slice(usAt + 1).trim() : '';
  // champs : ID (2 car.) + valeur — fixe (longueur imposée) ou variable (terminée par GS ;
  // RS = valeur tronquée ; un champ variable arrivé à sa borne max enchaîne sans GS)
  const msg = payload.slice(headerLen);
  const fields = {}, truncated = [];
  let i = 0;
  while(i < msg.length){
    if(msg[i] === DDOC_GS){ i++; continue; }
    if(i + 2 > msg.length) break;
    const fid = msg.slice(i, i + 2).toUpperCase();
    const spec = DDOC_FIELDS[fid];
    if(!/^[0-9A-Z]{2}$/.test(fid) || !spec){    // inconnu : on saute au prochain GS
      const g = msg.indexOf(DDOC_GS, i + 1);
      if(g < 0) break;
      i = g + 1; continue;
    }
    i += 2;
    const [mn, mx] = spec;
    if(mx >= 0 && mn === mx){                    // longueur fixe
      fields[fid] = msg.slice(i, i + mx); i += mx;
      if(msg[i] === DDOC_GS) i++;
    } else {                                     // longueur variable
      const limit = mx >= 0 ? Math.min(msg.length, i + mx) : msg.length;
      let j = i;
      while(j < limit && msg[j] !== DDOC_GS && msg[j] !== DDOC_RS) j++;
      fields[fid] = msg.slice(i, j);
      if(msg[j] === DDOC_RS) truncated.push(fid);
      i = (msg[j] === DDOC_GS || msg[j] === DDOC_RS) ? j + 1 : j;
    }
  }
  return { header, fields, truncated, payload, sigB32, raw: s };
}

// ----- vérification de signature (WebCrypto, hors-ligne) -----
function b32decode(str){
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = str.replace(/=+$/,'').replace(/\s+/g,'');
  let bits = 0, val = 0; const out = [];
  for(const c of clean){
    const idx = A.indexOf(c);
    if(idx < 0) throw new Error('Signature Base32 invalide');
    val = (val << 5) | idx; bits += 5;
    if(bits >= 8){ out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}
let DDOC_KEYS = null;                            // index "CA/CERT" -> JWK (chargé à la demande)
async function ddocKeys(){
  if(DDOC_KEYS) return DDOC_KEYS;
  try{ DDOC_KEYS = await (await fetch('vendor/2ddoc/keys.json')).json(); }
  catch(e){ DDOC_KEYS = {}; }
  return DDOC_KEYS;
}
// → { status:'valide'|'cert_inconnu'|'invalide'|'sans_signature'|'crypto_indisponible', issuer }
async function verify2DDoc(doc){
  if(!doc.sigB32) return { status:'sans_signature' };
  const keys = await ddocKeys();
  const jwk = keys[doc.header.ca_id + '/' + doc.header.cert_id];
  if(!jwk) return { status:'cert_inconnu' };
  if(!(window.crypto && crypto.subtle)) return { status:'crypto_indisponible' };
  const hash = jwk.crv === 'P-521' ? 'SHA-512' : jwk.crv === 'P-384' ? 'SHA-384' : 'SHA-256';
  try{
    const key = await crypto.subtle.importKey('jwk', jwk, { name:'ECDSA', namedCurve: jwk.crv }, false, ['verify']);
    // 2D-Doc signe l'ASCII de l'en-tête + message ; signature au format r||s = celui de WebCrypto
    const ok = await crypto.subtle.verify({ name:'ECDSA', hash }, key,
      b32decode(doc.sigB32), new TextEncoder().encode(doc.payload));
    return { status: ok ? 'valide' : 'invalide' };
  }catch(e){ return { status:'invalide' }; }
}

// ----- extraction des données utiles par type de document -----
function num(v){ const n = parseFloat(String(v||'').replace(',', '.')); return isNaN(n) ? null : n; }
function ddocExtract(doc){
  const f = doc.fields, t = doc.header.doc_type, out = {};
  if(t === '28' || t === '04' || t === '18' || t === '24'){       // avis d'imposition / ASDIR
    out.categorie = 'Avis d\'imposition';
    out.rfr = num(f['41']); out.parts = num(f['43']);
    out.annee_revenus = f['45'] || null; out.reference = f['44'] || null;
    out.nom = f['46'] || null; out.nom2 = f['48'] || null;
    out.adresse = f['4Y'] || [f['6U'], f['6W'], f['6X']].filter(Boolean).join(' / ') || null;
  } else if(t === '00' || t === '01' || t === '02' || t === '03'){ // justificatif de domicile
    out.categorie = 'Justificatif de domicile';
    out.prenom = f['12'] || f['16'] || null; out.nom = f['13'] || f['17'] || null;
    out.adresse = [f['20'], f['22'], f['24'], f['25']].filter(Boolean).join(' / ')
               || [f['10'], f['14']].filter(Boolean).join(' / ') || null;
  } else if(t === '06'){                                           // bulletin de salaire
    out.categorie = 'Bulletin de salaire';
    out.nom = f['13'] || f['30'] || null;
  } else if(t === '07'){                                           // pièce d'identité
    out.categorie = 'Pièce d\'identité';
    out.prenom = f['60'] || f['12'] || null; out.nom = f['62'] || f['13'] || null;
  } else {
    out.categorie = DDOC_TYPES[t] || ('Document type ' + t);
  }
  return out;
}

const DDOC_ISSUERS = { FR01:'AriadNEXT', FR03:'Imprimerie Nationale', FR04:'Docaposte / DGFiP',
  FR05:'Docaposte', FR06:'Dhimyotis / Certigna', FR07:'Berger-Levrault', FR00:'Émetteur de test' };
const COFFRE_BADGE = {
  valide:            ['ok',   '✓ Authenticité vérifiée'],
  cert_inconnu:      ['warn', 'Émetteur inconnu — authenticité non vérifiée'],
  invalide:          ['ko',   '✗ Signature invalide — document suspect'],
  sans_signature:    ['warn', 'Sans signature'],
  crypto_indisponible:['warn','Vérification indisponible ici'],
};

// ----- décodage DataMatrix depuis une image (ZXing vendorisé) -----
let zxingReady = null;
function ensureZXing(){
  if(window.ZXing) return Promise.resolve();
  if(zxingReady) return zxingReady;
  zxingReady = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/zxing/zxing.min.js';
    sc.onload = () => res(); sc.onerror = () => rej(new Error('Lecteur de code-barres indisponible.'));
    document.head.appendChild(sc);
  });
  return zxingReady;
}
async function decodeDataMatrixFromImage(fileOrUrl){
  await ensureZXing();
  const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  try{
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => rej(new Error('Image illisible.'));
      im.src = url;
    });
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.DATA_MATRIX]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.BrowserDatamatrixCodeReader(hints);
    const result = await reader.decodeFromImageElement(img);
    return result.getText();
  } finally {
    if(typeof fileOrUrl !== 'string') URL.revokeObjectURL(url);
  }
}

// ----- import complet : image OU texte brut → document du coffre -----
async function coffreImport(input){
  const text = (typeof input === 'string') ? input : await decodeDataMatrixFromImage(input);
  const doc = parse2DDoc(text);
  const verif = await verify2DDoc(doc);
  const entry = {
    id: 'd' + Date.now(),
    scannedAt: new Date().toISOString().slice(0, 10),
    type: doc.header.doc_type,
    label: DDOC_TYPES[doc.header.doc_type] || ('Document type ' + doc.header.doc_type),
    issuer: DDOC_ISSUERS[doc.header.ca_id] || doc.header.ca_id,
    ca: doc.header.ca_id, cert: doc.header.cert_id,
    date: doc.header.issue_date || doc.header.signature_date,
    verif: verif.status,
    data: ddocExtract(doc),
    fields: doc.fields,
    raw: doc.raw,
  };
  const c = getCoffre();
  if(c.some(e => e.raw === entry.raw)) throw new Error('Ce document est déjà dans votre coffre.');
  c.unshift(entry); setCoffre(c);
  return entry;
}

// dernière donnée certifiée utile pour « Mes aides » (RFR le plus récent)
function coffreRFR(){
  for(const e of getCoffre()){
    if(e.data && e.data.rfr != null && (e.verif === 'valide' || e.verif === 'cert_inconnu'))
      return { rfr: e.data.rfr, annee: e.data.annee_revenus, verif: e.verif, label: e.label };
  }
  return null;
}

// ----- écran « Mon coffre » (#/coffre) -----
function renderCoffre(){
  const d = document.querySelector('#detail');
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  d.innerHTML = `
    <div class="dnav"><button class="back" type="button">${back}<span>Retour</span></button><span class="dt">Mon coffre</span></div>
    <div class="dbody">
      <h2>Mon coffre de documents certifiés</h2>
      <p class="pnote">Scannez le <b>code carré « 2D-Doc »</b> imprimé sur vos documents officiels
        (avis d'imposition, justificatif de domicile…). L'app vérifie son <b>authenticité</b> et en
        extrait les informations certifiées pour <b>pré-remplir vos démarches et « Mes aides »</b> —
        le tout <b>uniquement sur cet appareil</b>, rien n'est transmis.</p>
      <label class="btn" for="coffre-file" style="display:block;text-align:center">Scanner un document (photo)</label>
      <input id="coffre-file" type="file" accept="image/*" capture="environment" hidden>
      <p class="coffre-try"><a class="lien" href="#">Pas de document sous la main ? Essayer avec le spécimen officiel</a>
        <span class="muted">(avis d'imposition fictif « RETI Patrick », publié par l'ANTS dans les spécifications)</span></p>
      <p id="coffre-msg" class="pmsg" aria-live="polite"></p>
      <div id="coffre-list"></div>
    </div>`;
  d.querySelector('.back').onclick = ()=>{ if(history.length > 1) history.back(); else location.hash = '#'; };
  d.querySelector('.coffre-try a').onclick = async e => {
    e.preventDefault();
    const msg = d.querySelector('#coffre-msg');
    msg.textContent = 'Lecture du spécimen…';
    try{
      const text = await decodeDataMatrixFromImage('specimen-2ddoc.png');
      await coffreImport(text);
      msg.textContent = ''; coffreList(d);
    }catch(err){ msg.innerHTML = '<span class="muted">' + esc(String(err && err.message || err)) + '</span>'; }
  };
  d.querySelector('#coffre-file').onchange = async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!file) return;
    const msg = d.querySelector('#coffre-msg');
    msg.textContent = 'Lecture du code 2D-Doc…';
    try{
      const entry = await coffreImport(file);
      msg.textContent = '';
      coffreList(d);
      const first = d.querySelector('.coffre-card');
      if(first) first.scrollIntoView({ block:'nearest', behavior:'smooth' });
    }catch(err){
      msg.textContent = '';
      const m = String(err && err.message || err);
      msg.innerHTML = '<span class="muted">' + esc(/NotFound|No MultiFormat|not found/i.test(m)
        ? 'Aucun code 2D-Doc lisible sur cette photo — cadrez le petit carré noir et blanc, net et bien éclairé.'
        : 'Échec : ' + m) + '</span>';
    }
  };
  coffreList(d);
}
function coffreList(d){
  const host = d.querySelector('#coffre-list');
  const c = getCoffre();
  if(!c.length){ host.innerHTML = '<p class="muted" style="margin-top:14px">Aucun document pour l\'instant.</p>'; return; }
  host.innerHTML = c.map(e => {
    const [cls, label] = COFFRE_BADGE[e.verif] || COFFRE_BADGE.sans_signature;
    const rows = [];
    if(e.data.nom) rows.push('Nom : ' + esc(e.data.nom) + (e.data.nom2 ? ' · ' + esc(e.data.nom2) : ''));
    if(e.data.prenom) rows.push('Prénom : ' + esc(e.data.prenom));
    if(e.data.rfr != null) rows.push('<b>Revenu fiscal de référence : ' + Number(e.data.rfr).toLocaleString('fr-FR') + ' €</b>'
      + (e.data.annee_revenus ? ' (revenus ' + esc(e.data.annee_revenus) + ')' : ''));
    if(e.data.parts != null) rows.push('Parts fiscales : ' + String(e.data.parts).replace('.', ','));
    if(e.data.adresse) rows.push('Adresse : ' + esc(e.data.adresse));
    return `<div class="sim-card coffre-card">
      <div class="sim-head"><span class="sim-badge ${cls}">${label}</span><b>${esc(e.label)}</b></div>
      <p class="sim-why">${rows.join('<br>') || 'Données brutes disponibles.'}</p>
      <p class="sim-links"><span class="muted">Émis par ${esc(e.issuer)}${e.date ? ' · ' + esc(e.date) : ''} · scanné le ${esc(e.scannedAt)}</span></p>
      <p class="sim-links">
        ${e.data.rfr != null ? '<a class="lien coffre-aides" href="#/aides">Utiliser dans « Mes aides »</a> · ' : ''}
        <a class="lien coffre-del" data-id="${e.id}" href="#">Retirer du coffre</a></p>
    </div>`;
  }).join('');
  host.querySelectorAll('.coffre-del').forEach(a => a.onclick = ev => {
    ev.preventDefault();
    setCoffre(getCoffre().filter(x => x.id !== a.dataset.id));
    coffreList(d);
  });
}
