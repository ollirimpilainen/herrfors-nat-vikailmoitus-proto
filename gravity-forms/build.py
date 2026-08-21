#!/usr/bin/env python3
"""Assemble the Gravity Forms import file from the source parts.

Not a build step for the prototype — index.html stays a single self-contained file.
This only packages the GF port so the HTML/CSS/JS stay editable as real files
instead of being hand-escaped inside a JSON blob.

    python3 gravity-forms/build.py
"""
import base64, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
read = lambda n: io.open(os.path.join(HERE, n), encoding='utf-8').read()

CSS = read('hn-location.css')
JS  = read('hn-location.js')

LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
FONTS = ('https://fonts.googleapis.com/css2?family=Mulish:wght@400;600;700;800'
         '&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap')

# ---- field 2: the 112 warning, shown by Gravity Forms' own conditional logic ----
HTML_112 = '''<div class="hn-112" role="alert">
  <strong>Älä lähesty vauriokohtaa</strong>
  <p>Vaurioitunut johto tai pylväs voi olla hengenvaarallinen. Pidä etäisyyttä ja
     varoita muita paikalla olijoita. Voit täyttää ilmoituksen turvallisen matkan päästä.</p>
  <a href="tel:112">Soita 112</a>
</div>'''

# ---- field 4: the map ----
HTML_MAP = '''<link id="hn-fonts" rel="stylesheet" href="%s">
<link id="hn-leaflet-css" rel="stylesheet" href="%s">
<style id="hn-css">
%s
</style>

<div id="hn-loc">
  <div class="hn-head">
    <strong>Sijainnin antaminen</strong>
    <span id="hn-head-hint">Vastaa ensin yllä olevaan kysymykseen.</span>
  </div>
  <div class="hn-body">

    <div id="hn-gps-block" class="hn-hidden">
      <button type="button" class="hn-btn hn-btn-primary" id="hn-btn-gps">Käytä nykyistä sijaintiani</button>
      <div class="hn-divider">tai</div>
    </div>

    <div class="hn-stage" id="hn-stage">
      <div id="hn-map"></div>
      <div class="hn-crosshair" aria-hidden="true"><i></i></div>
      <div class="hn-gate" id="hn-gate" role="button" tabindex="0" aria-label="Ota kartta käyttöön">
        <span id="hn-gate-text">Napauta karttaa merkitäksesi sijainnin</span>
      </div>
      <div class="hn-tools">
        <button type="button" id="hn-btn-full" title="Suurenna kartta" aria-label="Suurenna kartta">⛶</button>
        <button type="button" id="hn-btn-recenter" title="Keskitä sijaintiini" aria-label="Keskitä sijaintiini">◎</button>
      </div>
      <p class="hn-pill"><span>Siirrä karttaa niin että tähtäin osuu vikapaikkaan</span></p>
      <div class="hn-bar">
        <button type="button" class="hn-btn hn-btn-primary" id="hn-btn-commit">Aseta merkki tähän</button>
        <button type="button" class="hn-btn hn-btn-ghost hn-btn-icon" id="hn-btn-lock" title="Lukitse kartta" aria-label="Lukitse kartta">✕</button>
      </div>
    </div>
    <p class="hn-note" id="hn-note">Kartta on lukittu, jotta sivun selaaminen sujuu. Napauta karttaa ottaaksesi sen käyttöön.</p>

  </div>
</div>''' % (FONTS, LEAFLET_CSS, CSS)

# ---- field 6: provenance + suggestion + confidence strip, then the script ----
HTML_CONF = '''<div id="hn-loc2">
  <p class="hn-addr-src" id="hn-addr-src" aria-live="polite"></p>

  <div class="hn-suggest hn-hidden" id="hn-suggest">
    <p class="hn-suggest-lbl">Kartan mukaan lähin osoite</p>
    <p class="hn-suggest-val" id="hn-suggest-val"></p>
    <div class="hn-suggest-actions">
      <button type="button" class="hn-btn hn-btn-ghost hn-btn-accent hn-btn-sm" id="hn-suggest-use">Käytä tätä</button>
      <button type="button" class="hn-btn hn-btn-ghost hn-btn-sm" id="hn-suggest-keep">Pidä oma teksti</button>
    </div>
  </div>

  <div class="hn-conf" id="hn-conf" data-state="empty" aria-live="polite">
    <div class="hn-conf-top">
      <span class="hn-dot" aria-hidden="true"></span>
      <span class="hn-badge" id="hn-badge">Ei sijaintia</span>
      <span class="hn-conf-title" id="hn-conf-title">Sijaintia ei ole vielä annettu</span>
    </div>
    <p class="hn-conf-msg" id="hn-conf-msg">Käytä paikannusta, merkitse kohta kartalle tai kirjoita osoite.</p>
    <div class="hn-conf-meta hn-hidden" id="hn-conf-meta"></div>
    <div class="hn-conf-actions hn-hidden" id="hn-conf-actions">
      <button type="button" class="hn-btn hn-btn-ghost hn-btn-sm" id="hn-btn-clear">Poista koordinaatit</button>
      <button type="button" class="hn-btn hn-btn-ghost hn-btn-sm" id="hn-btn-remark">Tarkenna kartalla</button>
    </div>
    <div class="hn-fail hn-hidden" id="hn-fail" data-kind="error"></div>
  </div>
</div>

<!-- The logic is parked as base64 and promoted to a real script by the loader below.
     Two things on this site force that shape. Herrfors' consent layer neutralises
     inline scripts that arrive with the parsed document, while scripts created at
     runtime run fine. And WordPress' text filters rewrite every "&" in a field
     rendered inside page content to "&#038;", which turns "a && b" into a syntax
     error and corrupts query strings — base64 carries none of the characters those
     filters touch. The source of truth is gravity-forms/hn-location.js in the repo;
     nobody is meant to read this blob. -->
<script id="hn-src" type="text/hn-source">%s</script>
<img src="data:," alt="" aria-hidden="true" style="position:absolute;width:0;height:0;opacity:0"
     onerror="this.onerror=null;(function(s){if(!s)return;var b=atob(s.textContent.replace(/[^A-Za-z0-9+/=]/g,''));var t=new TextDecoder().decode(Uint8Array.from(b,function(c){return c.charCodeAt(0)}));var n=document.createElement('script');n.textContent=t;document.head.appendChild(n);})(document.getElementById('hn-src'))">''' % base64.b64encode(JS.encode('utf-8')).decode('ascii')

# ---- field 7: what the duty officer sees (demo only, delete to remove) ----
HTML_OPS = '''<div id="hn-ops">
  <h3>Mitä päivystäjä näkee</h3>
  <p class="hn-ops-sub">Päivittyy reaaliajassa. Vain demossa — poista tämä kenttä tuotannosta.</p>
  <div class="hn-ops-card" id="hn-ops-card"><p class="hn-ops-empty">Sijaintia ei ole annettu.</p></div>
  <details>
    <summary>Piilokenttiin tallentuva data (kehittäjälle)</summary>
    <pre id="hn-json">{}</pre>
  </details>
</div>'''

# ---- field 8: accuracy simulation (demo only, delete to remove) ----
HTML_SIM = '''<div id="hn-sim">
  <h3>Simulointi — vain demossa</h3>
  <p>Puhelimen paikannusta ei voi pakottaa epätarkaksi, joten näillä pääsee jokaiseen tilaan sisätiloissa.</p>
  <div class="hn-sim-grid">
    <button type="button" class="hn-btn hn-btn-ghost" data-hn-sim="12">Hyvä fix · 12 m</button>
    <button type="button" class="hn-btn hn-btn-ghost" data-hn-sim="140">Kohtalainen · 140 m</button>
    <button type="button" class="hn-btn hn-btn-ghost" data-hn-sim="600">Heikko · 600 m</button>
    <button type="button" class="hn-btn hn-btn-ghost" data-hn-sim="2400">Hylättävä · 2400 m</button>
    <button type="button" class="hn-btn hn-btn-ghost" data-hn-sim="denied">Käyttäjä kielsi</button>
  </div>
</div>'''

def html(fid, label, content, logic=None):
    f = {"type":"html","id":fid,"label":label,"content":content,
         "displayOnly":True,"disableMargins":False}
    if logic: f["conditionalLogic"] = logic
    return f

def hidden(fid, name):
    return {"type":"hidden","id":fid,"label":name,"allowsPrepopulate":False}

FAULTS = [("Sähkökatko","outage"),
          ("Johto tai pylväs vaurioitunut","damaged"),
          ("Jännitehäiriö tai valojen välkkyminen","flicker"),
          ("Vika mittarissa tai liittymässä","meter"),
          ("Katuvalo ei toimi","streetlight"),
          ("Muu vika","other")]

HIDDEN = [(10,"locationAddressSource"),(11,"locationNearestAddress"),
          (12,"locationLat"),(13,"locationLng"),(14,"locationSource"),
          (15,"locationAccuracyM"),(16,"locationZoomAtDrop"),(17,"locationCapturedAt"),
          (18,"locationAtSite"),(19,"locationConfidence"),(20,"locationOverrodeGps"),
          (21,"locationGpsRejectedAccuracyM")]

form = {
  "title": "Vikailmoitus — sijaintiosio (demo v0.3)",
  "description": ("Interaktiodemo vikailmoituksen sijaintiosiosta. Ei upotettu millekään sivulle. "
                  "Kentät 7 ja 8 ovat vain demoa varten — poista ne tuotantoversiosta."),
  "labelPlacement": "top_label",
  "descriptionPlacement": "below",
  "subLabelPlacement": "below",
  "validationSummary": True,
  "requireLogin": False,
  "enableHoneypot": True,
  "button": {"type":"text","text":"Lähetä ilmoitus"},
  "notifications": {},
  "confirmations": {},
  "fields": [
    {"type":"select","id":1,"label":"Mistä on kyse?","isRequired":True,
     "placeholder":"Valitse…","enableChoiceValue":True,
     "choices":[{"text":t,"value":v} for t,v in FAULTS]},

    html(2, "112-varoitus (näkyy vain vauriovalinnalla)", HTML_112,
         {"actionType":"show","logicType":"all",
          "rules":[{"fieldId":1,"operator":"is","value":"damaged"}]}),

    {"type":"radio","id":3,"label":"Oletko juuri nyt vian luona?","isRequired":True,
     "description":"Tämä kertoo meille, voiko puhelimen paikannusta käyttää.",
     "enableChoiceValue":True,
     "choices":[{"text":"Kyllä, olen paikalla","value":"yes"},
                {"text":"En ole paikalla","value":"no"}]},

    html(4, "Sijainti: kartta", HTML_MAP),

    {"type":"textarea","id":5,"label":"Osoite tai paikan kuvaus","isRequired":True,
     "description":("Esim. katuosoite, tienristeys tai maamerkki. "
                    "Täyttyy automaattisesti, jos käytät paikannusta tai karttaa."),
     "placeholder":'Esim. Ähtäväntie 340 tai "metsätie n. 2 km Ähtävän risteyksestä pohjoiseen"'},

    html(6, "Sijainti: luottamusarvio + logiikka", HTML_CONF),
    html(7, "DEMO: mitä päivystäjä näkee", HTML_OPS),
    html(8, "DEMO: tarkkuuden simulointi", HTML_SIM),
  ] + [hidden(i,n) for i,n in HIDDEN]
}

out = {"0": form, "version": "2.5"}
path = os.path.join(HERE, 'herrfors-vikailmoitus-sijainti.json')
io.open(path,'w',encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))

print('wrote %s (%.1f KB)' % (os.path.basename(path), os.path.getsize(path)/1024.0))
print('fields: %d (%d visible, %d hidden)' % (
    len(form['fields']), len(form['fields'])-len(HIDDEN), len(HIDDEN)))
