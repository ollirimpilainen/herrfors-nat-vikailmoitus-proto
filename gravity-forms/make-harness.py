#!/usr/bin/env python3
"""Render the generated GF form JSON into a page that mimics Gravity Forms' DOM,
so the port can be tested before it is imported anywhere.

Reproduces what matters: a <form>, input names input_N, GF field wrappers,
jQuery + a gform_post_render trigger, and GF's conditional-logic behaviour
faked with a tiny shim for the 112 field.

    python3 gravity-forms/make-harness.py && open gravity-forms/harness.html
"""
import io, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
form = json.load(io.open(os.path.join(HERE,'herrfors-vikailmoitus-sijainti.json'), encoding='utf-8'))['0']

parts = []
for f in form['fields']:
    t, fid = f['type'], f['id']
    logic = ' data-hn-logic="%s"' % json.dumps(f['conditionalLogic'], ensure_ascii=False).replace('"','&quot;') if f.get('conditionalLogic') else ''
    if t == 'html':
        parts.append('<div class="gfield gfield--type-html" id="field_1_%d"%s>%s</div>' % (fid, logic, f['content']))
    elif t == 'select':
        opts = '<option value="">%s</option>' % f.get('placeholder','')
        opts += ''.join('<option value="%s">%s</option>' % (c['value'], c['text']) for c in f['choices'])
        parts.append('<div class="gfield" id="field_1_%d"><label class="gfield_label" for="input_1_%d">%s</label>'
                     '<div class="ginput_container"><select name="input_%d" id="input_1_%d">%s</select></div></div>'
                     % (fid, fid, f['label'], fid, fid, opts))
    elif t == 'radio':
        ch = ''.join(
            '<div class="gchoice"><input name="input_%d" type="radio" value="%s" id="choice_1_%d_%d">'
            '<label for="choice_1_%d_%d">%s</label></div>' % (fid, c['value'], fid, i, fid, i, c['text'])
            for i, c in enumerate(f['choices']))
        parts.append('<div class="gfield" id="field_1_%d"><legend class="gfield_label">%s</legend>'
                     '<div class="gfield_description">%s</div><div class="ginput_container">%s</div></div>'
                     % (fid, f['label'], f.get('description',''), ch))
    elif t == 'textarea':
        parts.append('<div class="gfield" id="field_1_%d"><label class="gfield_label" for="input_1_%d">%s</label>'
                     '<div class="gfield_description">%s</div>'
                     '<div class="ginput_container"><textarea name="input_%d" id="input_1_%d" rows="4" placeholder="%s"></textarea></div></div>'
                     % (fid, fid, f['label'], f.get('description',''), fid, fid,
                        f.get('placeholder','').replace('"','&quot;')))
    elif t == 'hidden':
        parts.append('<input name="input_%d" type="hidden" id="input_1_%d" data-label="%s">' % (fid, fid, f['label']))

page = '''<!DOCTYPE html>
<html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>GF harness — %s</title>
<style>
body{margin:0;background:#f4f7fa;font-family:system-ui,sans-serif}
.harness{max-width:720px;margin:0 auto;padding:20px 16px 80px}
.harness-bar{background:#0b2545;color:#fff;border-radius:10px;padding:14px 16px;margin-bottom:20px;font-size:13px;line-height:1.5}
.harness-bar b{display:block;font-size:16px;margin-bottom:4px}
.gform_wrapper{background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:22px 18px}
.gfield{margin-bottom:22px}
.gfield_label,legend.gfield_label{display:block;font-weight:700;font-size:15px;margin-bottom:2px;font-family:Mulish,system-ui,sans-serif}
.gfield_description{font-size:13.5px;color:#5a6b85;margin-bottom:8px;font-family:Mulish,system-ui,sans-serif}
select,textarea{width:100%%;min-height:52px;padding:12px 14px;font:inherit;font-size:16px;
  border:1.5px solid #d9e0ea;border-radius:8px;background:#fff;font-family:Mulish,system-ui,sans-serif}
.gchoice{display:flex;align-items:center;gap:10px;min-height:52px;font-family:Mulish,system-ui,sans-serif}
.gchoice input{width:22px;height:22px}
.gform_footer{margin-top:8px}
.gform_button{min-height:52px;padding:12px 24px;background:#0b2545;color:#fff;border:0;border-radius:8px;
  font-weight:700;font-size:16px;cursor:pointer;font-family:Mulish,system-ui,sans-serif}
.hn-logic-hidden{display:none}
.dump{margin-top:16px;background:#0b2545;color:#dbe6f4;border-radius:10px;padding:14px;
  font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;line-height:1.6}
</style>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
</head><body>
<div class="harness">
  <div class="harness-bar">
    <b>Gravity Forms -harness</b>
    Ei WordPressiä — tämä sivu jäljittelee GF:n DOM-rakennetta (input_N-nimet, kenttäkääreet,
    jQuery, gform_post_render) jotta portti voidaan testata ennen importtia.
  </div>
  <div class="gform_wrapper">
    <form id="gform_1" method="post" onsubmit="return false">
      <div class="gform_body"><div class="gform_fields">
%s
      </div></div>
      <div class="gform_footer">
        <button type="button" class="gform_button" id="dumpBtn">Näytä piilokenttien arvot</button>
        <button type="button" class="gform_button" id="revalidateBtn">Simuloi GF:n validointivirhe</button>
      </div>
    </form>
  </div>
  <div class="dump" id="dump">Piilokentät: paina nappia.</div>
</div>
<script>
/* GF conditional logic shim: enough to drive the 112 field from the select */
(function(){
  function applyLogic(){
    document.querySelectorAll('[data-hn-logic]').forEach(function(el){
      var lg = JSON.parse(el.getAttribute('data-hn-logic'));
      var ok = lg.rules.every(function(r){
        var f = document.querySelector('[name="input_'+r.fieldId+'"]');
        var v = f ? f.value : '';
        return r.operator === 'is' ? v === r.value : v !== r.value;
      });
      el.classList.toggle('hn-logic-hidden', lg.actionType === 'show' ? !ok : ok);
    });
  }
  document.addEventListener('change', applyLogic);
  document.addEventListener('DOMContentLoaded', applyLogic);
  /* Faithful re-render: Gravity Forms rebuilds HTML fields from their stored content
     and writes the submitted values back into the markup. It does NOT hand back the
     live DOM, so the map container comes back empty and the port must rehydrate from
     the hidden fields alone. */
  var pristine = null;
  document.addEventListener('DOMContentLoaded', function(){
    pristine = document.querySelector('#gform_1 .gform_body').innerHTML;
  });
  document.getElementById('revalidateBtn').addEventListener('click', function(){
    var snap = {hidden:{}, address:null, radio:null, select:null};
    document.querySelectorAll('input[type=hidden][data-label]').forEach(function(i){ snap.hidden[i.name] = i.value; });
    var a = document.querySelector('[name="input_5"]'); snap.address = a ? a.value : '';
    var r = document.querySelector('input[name="input_3"]:checked'); snap.radio = r ? r.value : null;
    var s = document.querySelector('[name="input_1"]'); snap.select = s ? s.value : '';

    /* Order matters and this is the order the server produces: markup arrives with
       the submitted values already in it, and only then do scripts run. Values are
       therefore set while the nodes are still detached (innerHTML leaves scripts
       inert), and the port script is re-created afterwards to make it execute. */
    var tmp = document.createElement('div');
    tmp.innerHTML = pristine;
    Object.keys(snap.hidden).forEach(function(n){
      var el = tmp.querySelector('[name="'+n+'"]');
      if(el) el.setAttribute('value', snap.hidden[n]);
    });
    var a2 = tmp.querySelector('[name="input_5"]'); if(a2) a2.textContent = snap.address;
    if(snap.select){
      var o = tmp.querySelector('[name="input_1"] option[value="'+snap.select+'"]');
      if(o) o.setAttribute('selected','selected');
    }
    if(snap.radio){
      var r2 = tmp.querySelector('input[name="input_3"][value="'+snap.radio+'"]');
      if(r2) r2.setAttribute('checked','checked');
    }

    var body = document.querySelector('#gform_1 .gform_body');
    body.innerHTML = '';
    while(tmp.firstChild) body.appendChild(tmp.firstChild);

    /* The port's script is parked in a non-executable type and promoted by an
       <img onerror> loader, which fires on its own once the node is in the document. */

    applyLogic();
    jQuery(document).trigger('gform_post_render', [1, 1]);
    document.getElementById('dump').textContent = 'GF-uudelleenrenderöinti simuloitu — tarkista että sijainti säilyi.';
  });

  document.getElementById('dumpBtn').addEventListener('click', function(){
    var out = {};
    document.querySelectorAll('input[type=hidden][data-label]').forEach(function(i){
      out[i.dataset.label] = i.value === '' ? null : i.value;
    });
    out.locationAddress = (document.querySelector('[name="input_5"]')||{}).value || null;
    document.getElementById('dump').textContent = JSON.stringify(out, null, 2);
  });
})();
</script>
</body></html>''' % (form['title'], '\n'.join(parts))

path = os.path.join(HERE,'harness.html')
io.open(path,'w',encoding='utf-8').write(page)
print('wrote harness.html (%.1f KB)' % (os.path.getsize(path)/1024.0))
