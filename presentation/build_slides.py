#!/usr/bin/env python3
"""Génère presentation/slides.html (autonome, images embarquées en base64) — 6 diapositives
1600×900 qui reflètent l'état ACTUEL du démonstrateur. Portable : lit les captures dans
presentation/images/ (relatif au script). Convertir en PDF ensuite (voir presentation/README).
"""
import base64, io, pathlib
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
IMG = HERE / "images"

def b64(name):
    return "data:image/png;base64," + base64.b64encode((IMG / name).read_bytes()).decode()

def b64_crop(name, box):
    im = Image.open(IMG / name).convert("RGB").crop(box)
    buf = io.BytesIO(); im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

home      = b64("simulateur-iphone.png")
refo      = b64_crop("image-1.png", (0, 0, 430, 900))
aides     = b64("screen-aides.png")
coffre    = b64("screen-coffre.png")
parcours  = b64("screen-parcours.png")
fiche     = b64("image-2.png")

phone = lambda src, alt: f'<div class="phone"><div class="island"></div><div class="screen"><img src="{src}" alt="{alt}"></div></div>'

CSS = """
*{margin:0;padding:0;box-sizing:border-box}
:root{--teal:#0F6E5E;--teal-d:#0A4A40;--teal-l:#E7F1EE;--ink:#15211E;--muted:#5C6B67;--paper:#F5F8F7;--line:#DCE6E3;--amber-b:#FFF4E5;--amber-f:#A24700}
html,body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;color:var(--ink)}
.slide{position:relative;width:1600px;height:900px;background:var(--paper);overflow:hidden;display:flex;align-items:center}
.slide::before{content:"";position:absolute;top:0;left:0;width:100%;height:10px;background:linear-gradient(90deg,var(--teal),var(--teal-d))}
.blob{position:absolute;border-radius:50%;filter:blur(10px);opacity:.10;background:var(--teal)}
.brand{position:absolute;top:44px;left:90px;display:flex;align-items:center;gap:14px;z-index:5}
.brand .mark{width:40px;height:40px;border-radius:11px;background:var(--teal);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;box-shadow:0 6px 16px rgba(15,110,94,.35)}
.brand .wm{font-weight:700;font-size:20px;letter-spacing:.2px}
.brand .wm small{display:block;font-weight:500;font-size:12.5px;color:var(--muted);letter-spacing:.3px}
.pageno{position:absolute;top:50px;right:90px;font-size:15px;color:var(--muted);font-variant-numeric:tabular-nums;z-index:5}
.pageno b{color:var(--teal);font-weight:700}
.col-text{flex:1;padding:0 40px 0 90px;max-width:980px}
.col-phone{width:500px;height:900px;position:relative;display:flex;align-items:center;justify-content:center}
.eyebrow{display:inline-block;font-size:15px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:var(--teal);margin-bottom:18px}
h1{font-size:62px;line-height:1.03;font-weight:800;letter-spacing:-1.2px}
h2{font-size:44px;line-height:1.08;font-weight:800;letter-spacing:-.6px}
.sub{font-size:24px;line-height:1.4;color:var(--muted);margin-top:20px;max-width:740px;font-weight:450}
.chips{display:flex;gap:15px;margin-top:38px;flex-wrap:wrap}
.chip{background:#fff;border:1px solid var(--line);border-radius:16px;padding:15px 20px;box-shadow:0 4px 14px rgba(20,40,35,.05)}
.chip b{display:block;font-size:28px;font-weight:800;color:var(--teal);line-height:1;font-variant-numeric:tabular-nums}
.chip span{display:block;font-size:13.5px;color:var(--muted);margin-top:6px;letter-spacing:.2px}
.feats{margin-top:30px;display:flex;flex-direction:column;gap:19px}
.feat{display:flex;gap:18px;align-items:flex-start}
.feat .ic{flex:none;width:44px;height:44px;border-radius:12px;background:var(--teal-l);display:flex;align-items:center;justify-content:center;font-size:22px}
.feat .tx h3{font-size:21px;font-weight:750;letter-spacing:-.2px}
.feat .tx p{font-size:17.5px;line-height:1.42;color:var(--muted);margin-top:3px;max-width:660px}
.feat .tx p b{color:var(--ink);font-weight:650}
.footnote{position:absolute;bottom:44px;left:90px;font-size:15px;color:var(--muted);z-index:5;max-width:900px}
.footnote b{color:var(--ink);font-weight:650}
.demo{margin-top:32px;display:inline-flex;align-items:center;gap:12px;background:var(--teal);color:#fff;padding:15px 24px;border-radius:14px;font-size:19px;font-weight:650;box-shadow:0 12px 26px rgba(15,110,94,.32)}
.demo .dot{width:9px;height:9px;border-radius:50%;background:#7EE0C6}
.phone{height:770px;aspect-ratio:9/19.5;background:#0b0b0c;border-radius:52px;padding:13px;box-shadow:0 46px 90px rgba(10,45,38,.30),0 10px 26px rgba(0,0,0,.16),inset 0 0 0 2px #2a2a2c}
.phone .screen{width:100%;height:100%;border-radius:40px;overflow:hidden;background:#fff;position:relative}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
.phone .island{position:absolute;top:26px;left:50%;transform:translateX(-50%);width:104px;height:29px;background:#0b0b0c;border-radius:16px;z-index:3}
"""

TOTAL = 6
def slide(n, body, phone_html, blobs=""):
    return f'''<section class="slide" id="s{n}">
  {blobs}
  <div class="brand"><div class="mark">◆</div>
    <div class="wm">Agent administratif<small>Démonstrateur indépendant · non officiel · données DILA</small></div></div>
  <div class="pageno"><b>{n}</b> / {TOTAL}</div>
  <div class="col-text">{body}</div>
  <div class="col-phone">{phone_html}</div>
</section>'''

def feat(ic, h, p):
    return f'<div class="feat"><div class="ic">{ic}</div><div class="tx"><h3>{h}</h3><p>{p}</p></div></div>'

s1 = slide(1, '''
  <span class="eyebrow">Hackathon Assemblée nationale · 2026</span>
  <h1>Vos droits et vos démarches,<br>compris et préparés<br>sur votre smartphone.</h1>
  <p class="sub">Trouver, comprendre, <b>estimer ses droits</b> et préparer ses démarches à partir des
  fiches « Vos droits » de service-public.fr — <b>entièrement sur l'appareil</b>, hors-ligne, sans
  collecte de données. Web (PWA) et application iOS native.</p>
  <div class="chips">
    <div class="chip"><b>2&nbsp;908</b><span>fiches embarquées</span></div>
    <div class="chip"><b>8</b><span>prestations simulées</span></div>
    <div class="chip"><b>100&nbsp;%</b><span>local &amp; hors-ligne</span></div>
    <div class="chip"><b>0</b><span>donnée collectée</span></div>
  </div>
''', phone(home, "Écran d'accueil de l'app sur iPhone"),
 '<div class="blob" style="width:560px;height:560px;top:-160px;right:-120px"></div>'
 '<div class="blob" style="width:380px;height:380px;bottom:-140px;left:-120px;opacity:.07"></div>')

s2 = slide(2, '''
  <span class="eyebrow">Trouver &amp; comprendre</span>
  <h2>Comprendre l'intention,<br>expliquer sans inventer.</h2>
  <div class="feats">'''
  + feat("🔎", "Recherche hybride", "BM25 (lexical) + embeddings sémantiques e5 multilingues, fusionnés par RRF : « je vais avoir un bébé » trouve la bonne démarche.")
  + feat("💬", "Reformulation active", "Quand la demande est floue ou hors-domaine, l'app ne devine pas : elle propose des démarches précises à <b>valider</b>.")
  + feat("🤖", "Assistant local (Gemma, WebGPU / IA Apple en natif)", "Explique une fiche en s'appuyant <b>uniquement sur son contenu</b> — réponse citée, vérifiée, avec conversation de suivi.")
  + feat("🎙️", "Voix &amp; accessibilité", "Dictée locale (Whisper) et lecture à voix haute par la synthèse du système.")
  + '''</div>
''', phone(refo, "Recherche et reformulation sur iPhone"),
 '<div class="blob" style="width:480px;height:480px;top:-150px;right:-120px;opacity:.08"></div>')

s3 = slide(3, '''
  <span class="eyebrow">Simuler ses droits · nouveau</span>
  <h2>« Ai-je droit à des aides ? »<br>Un tri sûr, des montants exacts.</h2>
  <div class="feats">'''
  + feat("🎯", "Questionnaire adaptatif", "Une question à la fois, <b>posée seulement si elle sert</b> : un propriétaire n'a pas à donner ses revenus pour écarter l'aide au logement.")
  + feat("⚖️", "Seuils officiels OpenFisca", "RSA, prime d'activité, ASPA, AAH, CSS, ARS… : les barèmes viennent du <b>moteur officiel des règles socio-fiscales</b>, datés.")
  + feat("🔢", "Montants exacts, sur consentement", "Un 2ᵉ étage envoie un <b>cas-type anonyme</b> à un oracle OpenFisca hébergé pour le montant au juste euro — jamais l'identité.")
  + feat("💼", "Simulateur ciblé chômage (ARE)", "Allocation, durée, cumul avec une activité réduite, et « mes aides pendant le chômage ».")
  + '''</div>
''', phone(aides, "Résultat du simulateur Mes aides"),
 '<div class="blob" style="width:500px;height:500px;bottom:-170px;right:-140px;opacity:.08"></div>')

s4 = slide(4, '''
  <span class="eyebrow">Le coffre · nouveau</span>
  <h2>« Dites-le-nous une fois »,<br>mais côté citoyen.</h2>
  <p class="sub">L'usager scanne le <b>code 2D-Doc</b> imprimé sur ses documents officiels (avis
  d'imposition, justificatif de domicile, bulletin de salaire). L'app <b>vérifie la signature</b>
  et réutilise les données certifiées pour pré-remplir « Mes aides » et les démarches.</p>
  <div class="feats">'''
  + feat("🔏", "Authenticité vérifiée", "Signature ECDSA contrôlée hors-ligne contre les clés publiques des émetteurs (liste ANTS).")
  + feat("↩️", "Zéro double saisie", "Revenu fiscal, salaire brut, commune… injectés dans les simulateurs, <b>case par case</b>, avec le contrôle de l'usager.")
  + feat("📴", "Rien ne quitte l'appareil", "Décodage, vérification et stockage : tout est local.")
  + '''</div>
''', phone(coffre, "Le coffre : document certifié scanné"))

s5 = slide(5, '''
  <span class="eyebrow">Parcours de vie · nouveau</span>
  <h2>Un événement,<br>toutes les démarches dans l'ordre.</h2>
  <p class="sub">« Je perds mon emploi », « J'attends un enfant » : à partir d'une <b>date pivot</b>,
  l'app calcule les <b>échéances</b> et enchaîne les bonnes étapes — chacune reliée à la fiche, au
  simulateur ou à l'oracle correspondant.</p>
  <div class="feats">'''
  + feat("🗓️", "Échéances calculées", "Inscription, prime, déclaration sous 5 jours… avec badges d'urgence (dès maintenant / avant le… / dépassée).")
  + feat("✅", "Check-list persistée", "La progression reste sur l'appareil ; chaque étape cochée se replie.")
  + feat("📲", "Rappels dans l'agenda", "Export <b>.ics</b> par échéance ou global — ouvert par l'agenda du système, sans permission ni serveur.")
  + '''</div>
''', phone(parcours, "Parcours « j'attends un enfant » avec échéances"),
 '<div class="blob" style="width:460px;height:460px;top:-150px;right:-120px;opacity:.08"></div>')

s6 = slide(6, '''
  <span class="eyebrow">Architecture de confiance</span>
  <h2>Puissant parce que local,<br>fiable parce que sourcé.</h2>
  <div class="feats">'''
  + feat("🔒", "Confidentialité par conception", "CSP stricte, exécution 100 % locale, « aucune donnée collectée ». Les seuls appels réseau (annuaire, oracle) sont <b>explicites et consentis</b>.")
  + feat("📦", "Auto-hébergement complet", "Corpus, recherche sémantique, dictée et <b>modèles d'IA</b> servis par notre origine — 0 requête ML tierce au runtime.")
  + feat("🧮", "L'IA n'invente, ne calcule jamais", "Le LLM explique (ancré + vérifié) ; les montants viennent d'<b>OpenFisca</b>, déterministe et reproductible.")
  + feat("📱", "Web + iOS natif", "Même code ; en natif, l'IA passe par Apple Intelligence, corpus et modèles embarqués pour un hors-ligne garanti.")
  + '''</div>
  <div class="demo"><span class="dot"></span>alcrawfo-agent-administratif.static.hf.space</div>
''', phone(fiche, "Fiche avec l'assistant local, sur iPhone"),
 '<div class="blob" style="width:520px;height:520px;bottom:-180px;right:-140px;opacity:.08"></div>')

html = f'''<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Agent administratif — présentation</title><style>{CSS}</style></head>
<body>{s1}{s2}{s3}{s4}{s5}{s6}</body></html>'''

(HERE / "slides.html").write_text(html, encoding="utf-8")
print("wrote", HERE / "slides.html", len(html), "bytes")
