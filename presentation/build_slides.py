#!/usr/bin/env python3
import base64, pathlib, io
from PIL import Image

IMG = pathlib.Path("/private/tmp/claude-501/-Users-alaincrawford-service-public/6a8ee0f6-6ca2-4f0f-94d8-eb36651688de/scratchpad/CDT_hack/hackathon-an-2026/images")
OUT = pathlib.Path("/private/tmp/claude-501/-Users-alaincrawford-service-public/6a8ee0f6-6ca2-4f0f-94d8-eb36651688de/scratchpad")

def b64(name):
    return "data:image/png;base64," + base64.b64encode((IMG/name).read_bytes()).decode()

def b64_crop(name, box):
    im = Image.open(IMG/name).convert("RGB").crop(box)
    buf = io.BytesIO(); im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

home = b64("simulateur-iphone.png")         # accueil (retina, barre d'état iOS réelle)
refo = b64_crop("image-1.png", (0,0,430,900))  # reformulation : haut de l'écran, propre
fiche = b64("image-2.png")                  # fiche + assistant

phone = lambda src, alt: f'''<div class="phone"><div class="screen"><img src="{src}" alt="{alt}"></div></div>'''

CSS = """
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --teal:#0F6E5E; --teal-d:#0A4A40; --teal-l:#E7F1EE;
  --ink:#15211E; --muted:#5C6B67; --paper:#F5F8F7; --line:#DCE6E3;
}
html,body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;color:var(--ink)}
.slide{position:relative;width:1600px;height:900px;background:var(--paper);overflow:hidden;
  display:flex;align-items:center}
.slide::before{content:"";position:absolute;top:0;left:0;width:100%;height:10px;
  background:linear-gradient(90deg,var(--teal),var(--teal-d))}
.blob{position:absolute;border-radius:50%;filter:blur(10px);opacity:.10;background:var(--teal)}
.brand{position:absolute;top:44px;left:90px;display:flex;align-items:center;gap:14px;z-index:5}
.brand .mark{width:40px;height:40px;border-radius:11px;background:var(--teal);
  display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;
  box-shadow:0 6px 16px rgba(15,110,94,.35)}
.brand .wm{font-weight:700;font-size:20px;letter-spacing:.2px}
.brand .wm small{display:block;font-weight:500;font-size:12.5px;color:var(--muted);letter-spacing:.3px}
.pageno{position:absolute;top:50px;right:90px;font-size:15px;color:var(--muted);
  font-variant-numeric:tabular-nums;z-index:5}
.pageno b{color:var(--teal);font-weight:700}
.col-text{flex:1;padding:0 40px 0 90px;max-width:960px}
.col-phone{width:520px;height:900px;position:relative;display:flex;align-items:center;justify-content:center}
.eyebrow{display:inline-block;font-size:15px;font-weight:700;letter-spacing:1.6px;
  text-transform:uppercase;color:var(--teal);margin-bottom:20px}
h1{font-size:64px;line-height:1.03;font-weight:800;letter-spacing:-1.2px}
h2{font-size:46px;line-height:1.08;font-weight:800;letter-spacing:-.6px}
.sub{font-size:25px;line-height:1.4;color:var(--muted);margin-top:22px;max-width:720px;font-weight:450}
.chips{display:flex;gap:16px;margin-top:40px;flex-wrap:wrap}
.chip{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 22px;
  box-shadow:0 4px 14px rgba(20,40,35,.05)}
.chip b{display:block;font-size:30px;font-weight:800;color:var(--teal);line-height:1;font-variant-numeric:tabular-nums}
.chip span{display:block;font-size:14px;color:var(--muted);margin-top:7px;letter-spacing:.2px}
.feats{margin-top:34px;display:flex;flex-direction:column;gap:22px}
.feat{display:flex;gap:18px;align-items:flex-start}
.feat .ic{flex:none;width:44px;height:44px;border-radius:12px;background:var(--teal-l);
  display:flex;align-items:center;justify-content:center;font-size:22px}
.feat .tx h3{font-size:22px;font-weight:750;letter-spacing:-.2px}
.feat .tx p{font-size:18.5px;line-height:1.45;color:var(--muted);margin-top:4px;max-width:640px}
.footnote{position:absolute;bottom:46px;left:90px;font-size:15px;color:var(--muted);z-index:5}
.footnote b{color:var(--ink);font-weight:650}
.demo{margin-top:36px;display:inline-flex;align-items:center;gap:12px;background:var(--teal);
  color:#fff;padding:15px 24px;border-radius:14px;font-size:19px;font-weight:650;
  box-shadow:0 12px 26px rgba(15,110,94,.32)}
.demo .dot{width:9px;height:9px;border-radius:50%;background:#7EE0C6}
/* iPhone */
.phone{height:756px;aspect-ratio:9/19.5;background:#0b0b0c;border-radius:52px;padding:13px;
  box-shadow:0 46px 90px rgba(10,45,38,.30),0 10px 26px rgba(0,0,0,.16),
             inset 0 0 0 2px #2a2a2c}
.phone .screen{width:100%;height:100%;border-radius:40px;overflow:hidden;background:#fff;position:relative}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
.phone .island{position:absolute;top:12px;left:50%;transform:translateX(-50%);
  width:104px;height:29px;background:#0b0b0c;border-radius:16px;z-index:3}
"""

def slide(n, body, phone_html, blobs):
    return f'''<section class="slide" id="s{n}">
  {blobs}
  <div class="brand"><div class="mark">◆</div>
    <div class="wm">Agent administratif<small>Démonstrateur indépendant · non officiel</small></div></div>
  <div class="pageno"><b>{n}</b> / 3</div>
  <div class="col-text">{body}</div>
  <div class="col-phone">{phone_html}</div>
</section>'''

s1 = slide(1, '''
  <span class="eyebrow">Hackathon Assemblée nationale 2026</span>
  <h1>Vos démarches,<br>comprises et préparées<br>sur votre smartphone.</h1>
  <p class="sub">Un assistant qui aide chaque citoyen à <b>trouver</b>, <b>comprendre</b> et
  <b>préparer</b> ses démarches à partir des fiches « Vos droits » de service-public.fr —
  entièrement sur l'appareil, hors-ligne, sans collecte de données.</p>
  <div class="chips">
    <div class="chip"><b>2&nbsp;908</b><span>fiches embarquées</span></div>
    <div class="chip"><b>11</b><span>thèmes couverts</span></div>
    <div class="chip"><b>100&nbsp;%</b><span>local &amp; hors-ligne</span></div>
    <div class="chip"><b>0</b><span>donnée collectée</span></div>
  </div>
''', phone(home,"Écran d'accueil de l'app sur iPhone"),
 '<div class="blob" style="width:560px;height:560px;top:-160px;right:-120px"></div>'
 '<div class="blob" style="width:380px;height:380px;bottom:-140px;left:-120px;opacity:.07"></div>')

s2 = slide(2, '''
  <span class="eyebrow">Recherche &amp; compréhension</span>
  <h2>Comprendre l'intention,<br>pas seulement les mots.</h2>
  <div class="feats">
    <div class="feat"><div class="ic">🔎</div><div class="tx">
      <h3>Recherche hybride</h3>
      <p>BM25 (lexical) + embeddings sémantiques e5 multilingues, fusionnés par RRF :
      « je vais avoir un bébé » trouve la bonne démarche.</p></div></div>
    <div class="feat"><div class="ic">💬</div><div class="tx">
      <h3>Reformulation active</h3>
      <p>Quand la demande est floue ou hors-domaine (« appendicite »), l'app ne devine pas :
      elle propose des démarches précises à valider.</p></div></div>
    <div class="feat"><div class="ic">🛡️</div><div class="tx">
      <h3>Garde de confiance à deux seuils</h3>
      <p>Voisin sémantique + ancrage lexical : l'app préfère demander une précision
      plutôt que de répondre faux.</p></div></div>
  </div>
''', phone(refo,"Reformulation active sur iPhone"),
 '<div class="blob" style="width:480px;height:480px;top:-150px;right:-120px;opacity:.08"></div>')

s3 = slide(3, '''
  <span class="eyebrow">Préparation &amp; confidentialité</span>
  <h2>Préparer sa démarche —<br>tout reste sur l'appareil.</h2>
  <div class="feats">
    <div class="feat"><div class="ic">🤖</div><div class="tx">
      <h3>Assistant local (LLM WebGPU)</h3>
      <p>Explique une fiche en s'appuyant uniquement sur son contenu, sans rien inventer.</p></div></div>
    <div class="feat"><div class="ic">🗂️</div><div class="tx">
      <h3>Déroulé pas à pas</h3>
      <p>Pièces filtrées selon votre cas, téléservice officiel à ouvrir vous-même.</p></div></div>
    <div class="feat"><div class="ic">🎙️</div><div class="tx">
      <h3>Voix &amp; accessibilité</h3>
      <p>Dictée locale (Whisper) et lecture à voix haute par la synthèse du système.</p></div></div>
    <div class="feat"><div class="ic">✋</div><div class="tx">
      <h3>Garde-fou humain</h3>
      <p>L'application n'agit jamais à votre place : chaque téléservice demande votre confirmation.</p></div></div>
  </div>
  <div class="demo"><span class="dot"></span>alcrawfo-agent-administratif.static.hf.space</div>
''', phone(fiche,"Fiche d'une démarche avec l'assistant local, sur iPhone"),
 '<div class="blob" style="width:520px;height:520px;bottom:-180px;right:-140px;opacity:.08"></div>')

html = f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>{CSS}</style></head>
<body>{s1}{s2}{s3}</body></html>'''

(OUT/"slides.html").write_text(html, encoding="utf-8")
print("wrote slides.html", len(html), "bytes")
