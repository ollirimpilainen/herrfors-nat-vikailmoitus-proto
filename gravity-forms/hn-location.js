/* Herrfors Nät — fault report location section, Gravity Forms port of prototype v0.3.
   Field ids are fixed by the form JSON, so nothing here depends on the form id:
     1  select   fault type
     3  radio    at the site? (yes/no)
     5  textarea address or description  -> locationAddress
     10 locationAddressSource      16 locationZoomAtDrop
     11 locationNearestAddress     17 locationCapturedAt
     12 locationLat                18 locationAtSite
     13 locationLng                19 locationConfidence
     14 locationSource             20 locationOverrodeGps
     15 locationAccuracyM          21 locationGpsRejectedAccuracyM */
(function(){
  "use strict";

  var HOME = [63.6745, 22.7031];
  var LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';

  function ensureLeaflet(cb){
    if(window.L) return cb();
    var existing = document.getElementById('hn-leaflet-js');
    if(existing){ existing.addEventListener('load', cb); return; }
    var s = document.createElement('script');
    s.id = 'hn-leaflet-js'; s.src = LEAFLET; s.onload = cb;
    document.head.appendChild(s);
  }

  function boot(){
    var el = document.getElementById('hn-map');
    if(!el || el.hnDone) return;          // GF re-renders on ajax validation; init once per DOM
    el.hnDone = true;
    ensureLeaflet(function(){ init(el); });
  }

  function init(mapEl){
    var $ = function(id){ return document.getElementById(id); };
    var root = $('hn-loc');
    var form = root ? root.closest('form') : null;
    var stage = $('hn-stage');

    /* ---------- state: the emitted contract ---------- */
    var state = {
      atSite:null, address:"", addressSource:null,
      lat:null, lng:null, accuracyM:null, locationSource:null,
      zoomAtDrop:null, capturedAt:null, confidence:"empty", overrodeGps:false,
      nearestAddress:null, gpsRejectedAccuracyM:null
    };
    var coordTier = null, flash = null, pending = null;
    var map, marker, meCircle, mapActive = false, isFull = false;
    var stageHome = null, stageNext = null;

    /* ---------- gravity forms plumbing ---------- */
    function fld(id){ return form ? form.querySelector('[name="input_'+id+'"]') : null; }
    function set(id,v){
      var el = fld(id);
      if(el) el.value = (v === null || v === undefined) ? '' : String(v);
    }
    var addressEl = fld(5);

    function push(){
      set(10, state.addressSource);
      set(11, state.nearestAddress);
      set(12, state.lat);
      set(13, state.lng);
      set(14, state.locationSource);
      set(15, state.accuracyM);
      set(16, state.zoomAtDrop);
      set(17, state.capturedAt);
      set(18, state.atSite === null ? null : (state.atSite ? 'true' : 'false'));
      set(19, state.confidence);
      set(20, state.overrodeGps ? 'true' : 'false');
      set(21, state.gpsRejectedAccuracyM);
    }

    /* ---------- map: inert until asked ---------- */
    /* fadeAnimation:false — the fade-in sets opacity per frame from a
       requestAnimationFrame loop, and rAF does not run in a background tab, which
       leaves loaded tiles stuck at opacity 0. A fault report form has no use for the
       fade and every use for tiles that appear the moment they arrive. */
    map = L.map('hn-map', {
      zoomControl:true, scrollWheelZoom:false, dragging:false,
      touchZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, tap:false,
      fadeAnimation:false
    }).setView(HOME, 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19, attribution:'&copy; OpenStreetMap'
    }).addTo(map);

    /* Leaflet caches the container size it measured at init and derives the tile
       range from it. On a themed page that size is not final at init — web fonts, lazy
       images and the form's own layout settle later — and a stale size makes Leaflet
       request too small a range, which shows up as holes in the map. A single timeout
       is a guess; observing the element is not. */
    var lastW = 0, lastH = 0;
    function syncSize(){
      var r = mapEl.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
      lastW = r.width; lastH = r.height;
      map.invalidateSize({animate:false, pan:false});
    }
    if (window.ResizeObserver){
      new ResizeObserver(syncSize).observe(mapEl);
    } else {
      window.addEventListener('resize', syncSize);
    }
    window.addEventListener('load', syncSize);
    setTimeout(syncSize, 200);
    setTimeout(syncSize, 1200);

    function setMapActive(on){
      mapActive = on;
      stage.classList.toggle('hn-active', on);
      ['dragging','touchZoom','doubleClickZoom','scrollWheelZoom','keyboard'].forEach(function(f){
        if(!map[f]) return;
        if(f === 'scrollWheelZoom'){ map[f].disable(); return; }  // hijacks page scroll
        on ? map[f].enable() : map[f].disable();
      });
      $('hn-note').textContent = on
        ? 'Siirrä karttaa niin että tähtäin osuu vikapaikkaan, ja paina “Aseta merkki tähän”.'
        : 'Kartta on lukittu, jotta sivun selaaminen sujuu. Napauta karttaa ottaaksesi sen käyttöön.';
      if(!on && isFull) exitFull();
      if(on) syncSize();
      updateCommitLabel();
    }

    $('hn-gate').addEventListener('click', function(){ setMapActive(true); });
    $('hn-gate').addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        setMapActive(true);
        var mc = map.getContainer();
        if(mc.tabIndex >= 0) mc.focus(); else $('hn-btn-lock').focus();
      }
    });
    $('hn-btn-lock').addEventListener('click', function(){
      setMapActive(false);
      $('hn-gate').focus();
    });

    /* ---------- fullscreen ----------
       The stage is moved to <body> for the duration: a WP theme with a transformed
       ancestor would otherwise trap position:fixed inside it. */
    function enterFull(){
      isFull = true;
      stageHome = stage.parentNode; stageNext = stage.nextSibling;
      document.body.appendChild(stage);
      stage.classList.add('hn-full');
      document.body.classList.add('hn-map-locked');
      $('hn-btn-full').textContent = '⤡';
      $('hn-btn-full').setAttribute('aria-label','Pienennä kartta');
      setTimeout(function(){ map.invalidateSize(); }, 60);
    }
    function exitFull(){
      isFull = false;
      stage.classList.remove('hn-full');
      document.body.classList.remove('hn-map-locked');
      if(stageHome) stageHome.insertBefore(stage, stageNext);
      $('hn-btn-full').textContent = '⛶';
      $('hn-btn-full').setAttribute('aria-label','Suurenna kartta');
      setTimeout(function(){ map.invalidateSize(); }, 60);
    }
    $('hn-btn-full').addEventListener('click', function(){ isFull ? exitFull() : enterFull(); });
    document.addEventListener('keydown', function(e){
      if(e.key !== 'Escape') return;
      if(isFull) exitFull();
      else if(mapActive) setMapActive(false);
    });

    /* ---------- crosshair commit ---------- */
    $('hn-btn-commit').addEventListener('click', function(){
      var c = map.getCenter();
      setFromPin(c.lat, c.lng);
      if(isFull) exitFull();
    });
    map.on('moveend', updateCommitLabel);

    function updateCommitLabel(){
      var b = $('hn-btn-commit');
      b.classList.remove('hn-btn-done');
      if(!marker){ b.textContent = 'Aseta merkki tähän'; b.disabled = false; return; }
      var d = map.distance(map.getCenter(), marker.getLatLng());
      if(d < 8){
        b.textContent = 'Merkki on tässä'; b.disabled = true; b.classList.add('hn-btn-done');
      } else {
        b.textContent = 'Siirrä merkki tähän'; b.disabled = false;
      }
    }

    /* ---------- recentre: orientation only, never sets the pin ---------- */
    $('hn-btn-recenter').addEventListener('click', function(){
      if(!('geolocation' in navigator)) return;
      var b = this; b.textContent = '…';
      navigator.geolocation.getCurrentPosition(function(pos){
        b.textContent = '◎';
        var ll = [pos.coords.latitude, pos.coords.longitude];
        if(meCircle) map.removeLayer(meCircle);
        meCircle = L.circle(ll, {
          radius: Math.max(pos.coords.accuracy, 12),
          color:'#1e64c8', fillColor:'#1e64c8', fillOpacity:.14, weight:2
        }).addTo(map);
        map.setView(ll, 16);
      }, function(){ b.textContent = '◎'; }, { enableHighAccuracy:true, timeout:10000 });
    });

    /* ---------- coordinates ---------- */
    function placeMarker(lat,lng){
      if(marker) marker.setLatLng([lat,lng]);
      else marker = L.marker([lat,lng]).addTo(map);
    }

    /* Coordinates and marker always leave together — a pin the data does not
       contain is exactly the false precision this section exists to avoid. */
    function clearCoords(){
      state.lat = null; state.lng = null; state.accuracyM = null;
      state.locationSource = null; state.zoomAtDrop = null; state.capturedAt = null;
      state.overrodeGps = false; state.nearestAddress = null;
      state.gpsRejectedAccuracyM = null;
      coordTier = null; pending = null;
      if(marker){ map.removeLayer(marker); marker = null; }
      if(!state.address) state.addressSource = null;
      updateCommitLabel();
    }

    function setFromPin(lat,lng){
      var correctedGps = state.locationSource === 'gps' || state.gpsRejectedAccuracyM !== null;
      flash = null; pending = null;
      state.lat = round6(lat); state.lng = round6(lng);
      state.locationSource = 'map-pin';
      state.accuracyM = null;
      state.zoomAtDrop = map.getZoom();
      state.capturedAt = new Date().toISOString();
      coordTier = 'reliable';
      state.confidence = 'reliable';
      state.overrodeGps = correctedGps;
      placeMarker(lat,lng);
      reverseGeocode(lat,lng,'derived-from-pin');
      updateCommitLabel();
      render();
    }

    function setFromGps(lat,lng,accuracy){
      flash = null;
      var tier = tierFor(accuracy);
      if(tier === 'rejected'){
        clearCoords();
        state.gpsRejectedAccuracyM = Math.round(accuracy);
        state.confidence = 'rejected';
        render(); return;
      }
      state.lat = round6(lat); state.lng = round6(lng);
      state.locationSource = 'gps';
      state.accuracyM = Math.round(accuracy);
      state.zoomAtDrop = null;
      state.capturedAt = new Date().toISOString();
      state.overrodeGps = false;
      state.gpsRejectedAccuracyM = null;
      coordTier = tier;
      state.confidence = tier;
      placeMarker(lat,lng);
      map.setView([lat,lng], accuracy < 60 ? 17 : accuracy < 250 ? 15 : 13);
      reverseGeocode(lat,lng,'reverse-geocoded');
      updateCommitLabel();
      render();
    }

    function tierFor(a){
      if(a <= 50) return 'reliable';
      if(a <= 200) return 'moderate';
      if(a <= 1000) return 'poor';
      return 'rejected';
    }
    function round6(n){ return Math.round(n*1e6)/1e6; }
    function setFlash(kind,msg){ flash = {kind:kind, msg:msg}; }

    /* ---------- reverse geocoding ----------
       herrforsnat.fi sends a Content-Security-Policy that forbids cross-origin
       fetch/XHR, so the plain request never leaves the browser there while tiles and
       scripts load fine. Nominatim's json_callback gives the same answer as a script
       load, which script-src governs instead. fetch stays the first choice for sites
       without that policy; JSONP is the fallback. Neither fixes the real problem:
       production wants a server-side proxy, both to identify the client properly and
       to guard the rate limit. */
    var geoTimer = null, jsonpSeq = 0;

    function reverseGeocode(lat,lng,tag){
      clearTimeout(geoTimer);
      geoTimer = setTimeout(function(){
        var base = 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=18' +
                   '&addressdetails=1&accept-language=fi&lat='+lat+'&lon='+lng;
        fetch(base)
          .then(function(r){ return r.json(); })
          .then(function(d){ if(d) applyGeocode(shortAddress(d), tag); })
          .catch(function(){ jsonp(base, tag); });
      }, 600);
    }

    function jsonp(base, tag){
      var name = 'hnGeo' + (++jsonpSeq) + '_' + String(base.length);
      var s = document.createElement('script');
      var done = false;
      function cleanup(){
        try { delete window[name]; } catch(e){ window[name] = undefined; }
        if(s.parentNode) s.parentNode.removeChild(s);
      }
      window[name] = function(d){
        done = true;
        try { if(d) applyGeocode(shortAddress(d), tag); } finally { cleanup(); }
      };
      s.onerror = cleanup;
      setTimeout(function(){ if(!done) cleanup(); }, 10000);
      s.src = base + '&json_callback=' + name;
      document.head.appendChild(s);
    }

    function shortAddress(d){
      var a = d.address || {};
      var street = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
      var near = street || a.hamlet || a.neighbourhood || a.suburb || a.isolated_dwelling;
      var place = a.city || a.town || a.village || a.municipality || a.county;
      var parts = [near, place].filter(Boolean);
      return parts.length ? parts.join(', ') : (d.display_name || '');
    }

    /* The address field is authoritative. Words the reporter typed are never
       overwritten — the geocode is offered beside them and they decide. */
    function applyGeocode(text, tag){
      if(!text) return;
      state.nearestAddress = text;
      var ownWords = state.addressSource === 'typed' || state.addressSource === 'edited-after-geocode';
      if(state.address && ownWords){
        pending = {text:text, tag:tag};
      } else {
        state.address = text;
        if(addressEl) addressEl.value = text;
        state.addressSource = tag;
        if(state.confidence === 'conflict' && coordTier) state.confidence = coordTier;
      }
      render();
    }

    $('hn-suggest-use').addEventListener('click', function(){
      if(!pending) return;
      state.address = pending.text;
      if(addressEl) addressEl.value = pending.text;
      state.addressSource = pending.tag;
      if(coordTier) state.confidence = coordTier;
      pending = null;
      render();
    });
    $('hn-suggest-keep').addEventListener('click', function(){
      if(!pending) return;
      state.addressSource = 'typed';
      if(coordTier) state.confidence = coordTier;
      pending = null;
      render();
    });

    /* ---------- at-site gate ----------
       Split in two: `reconcile` runs only on a real answer from the reporter, so
       restoring the UI after a Gravity Forms validation re-render cannot re-trigger
       the clearing rule on state that was already reconciled before submit. */
    function applyAtSite(isAtSite, reconcile){
      state.atSite = isAtSite;

      /* A phone fix is the reporter's own position by definition. Once they say
         they are not at the fault, neither it nor the address derived from it can
         describe the fault site. */
      if(reconcile && !isAtSite && state.locationSource === 'gps'){
        var autoAddr = state.addressSource === 'reverse-geocoded';
        clearCoords();
        if(autoAddr){
          state.address = '';
          if(addressEl) addressEl.value = '';
          state.addressSource = null;
        }
        state.confidence = 'empty';
        setFlash('warn', autoAddr
          ? 'Poistimme puhelimen paikannuksen ja siitä haetun osoitteen, koska et ole vian luona. Merkitse vikapaikka kartalle tai kirjoita osoite.'
          : 'Poistimme puhelimen paikannuksella saadut koordinaatit, koska et ole vian luona. Merkitse vikapaikka kartalle tai kirjoita osoite.');
      }
      if(!isAtSite && meCircle){ map.removeLayer(meCircle); meCircle = null; }

      $('hn-gps-block').classList.toggle('hn-hidden', !isAtSite);
      $('hn-btn-recenter').style.display = isAtSite ? '' : 'none';
      $('hn-gate-text').textContent = isAtSite
        ? 'Napauta karttaa merkitäksesi sijainnin'
        : 'Napauta karttaa ja merkitse vikapaikka';
      $('hn-head-hint').textContent = isAtSite
        ? 'Voit käyttää puhelimen paikannusta, karttaa tai kirjoittaa osoitteen.'
        : 'Merkitse kohta kartalle tai kirjoita osoite. Puhelimen paikannus ei auta, koska et ole kohteessa.';
      render();
    }

    if(form) form.querySelectorAll('input[name="input_3"]').forEach(function(r){
      r.addEventListener('change', function(){
        if(!r.checked) return;
        applyAtSite(r.value === 'yes' || /kyll/i.test(r.value), true);
      });
    });

    /* ---------- address ---------- */
    if(addressEl) addressEl.addEventListener('input', function(){
      state.address = this.value;
      if(state.lat !== null){
        if(!state.address){
          state.addressSource = null;
          state.confidence = coordTier || state.confidence;
        } else if(state.addressSource && state.addressSource !== 'typed'){
          state.addressSource = 'edited-after-geocode';
          state.confidence = 'conflict';
        } else {
          state.addressSource = 'typed';
        }
      } else {
        state.addressSource = state.address ? 'typed' : null;
        if(state.address && state.confidence === 'rejected') state.confidence = 'empty';
      }
      render();
    });

    $('hn-btn-clear').addEventListener('click', function(){
      clearCoords();
      state.confidence = 'empty';
      flash = null;
      render();
    });

    $('hn-btn-remark').addEventListener('click', function(){
      setMapActive(true);
      stage.scrollIntoView({block:'center'});
      $('hn-btn-commit').focus();
    });

    /* ---------- gps ---------- */
    $('hn-btn-gps').addEventListener('click', function(){
      var b = this;
      flash = null;
      if(!('geolocation' in navigator)){
        setFlash('error','Selaimesi ei tue paikannusta. Merkitse kohta kartalle tai kirjoita osoite.');
        render(); return;
      }
      b.disabled = true; b.textContent = 'Haetaan sijaintia…';
      render();
      navigator.geolocation.getCurrentPosition(
        function(pos){ resetBtn(b); setFromGps(pos.coords.latitude,pos.coords.longitude,pos.coords.accuracy); },
        function(err){
          resetBtn(b);
          var m = {
            1:'Paikannus estettiin. Merkitse kohta kartalle tai kirjoita osoite.',
            2:'Sijaintia ei voitu määrittää. Merkitse kohta kartalle.',
            3:'Paikannus kesti liian kauan. Merkitse kohta kartalle.'
          };
          setFlash('error', m[err.code] || 'Paikannus epäonnistui. Merkitse kohta kartalle.');
          render();
        },
        { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
      );
    });
    function resetBtn(b){ b.disabled=false; b.textContent='Käytä nykyistä sijaintiani'; }

    /* ---------- copy ---------- */
    var COPY = {
      empty:{badge:'Ei sijaintia',title:'Sijaintia ei ole vielä annettu',msg:'Käytä paikannusta, merkitse kohta kartalle tai kirjoita osoite.'},
      reliable:{badge:'Luotettava',title:'Sijainti on tarkka',msg:'Tämä riittää vian paikantamiseen.'},
      moderate:{badge:'Kohtalainen',title:'Sijainti on suunnilleen oikein',msg:'Tarkenna merkkiä kartalla tai kirjoita osoite, jos tiedät tarkemman paikan.'},
      poor:{badge:'Epätarkka',title:'Sijainti on epätarkka',msg:'Puhelin ei saanut tarkkaa paikannusta. Merkitse kohta kartalle mahdollisimman tarkasti.'},
      rejected:{badge:'Hylätty',title:'Sijainti oli liian epätarkka',msg:'Emme tallentaneet koordinaatteja, koska ne olisivat olleet harhaanjohtavia. Merkitse kohta kartalle tai kirjoita osoite.'},
      conflict:{badge:'Tarkista',title:'Osoite ja merkki eivät ehkä täsmää',msg:'Muokkasit osoitetta sen jälkeen, kun sijainti haettiin. Kartan merkki osoittaa edelleen alkuperäiseen kohtaan.'}
    };
    var SRC_LBL = {
      'typed':'ilmoittajan kirjoittama',
      'reverse-geocoded':'haettu paikannuksesta, ei vahvistettu',
      'derived-from-pin':'johdettu kartan merkistä, ei vahvistettu',
      'edited-after-geocode':'ilmoittaja muokkasi haun jälkeen'
    };

    function stripCopy(){
      var s = state.confidence, t = COPY[s] || COPY.empty;
      var o = {style:s, badge:t.badge, title:t.title, msg:t.msg};
      if(s === 'empty' && state.address){
        o.style = 'address';
        o.badge = 'Osoite annettu';
        o.title = 'Osoite on annettu, koordinaatteja ei';
        o.msg = 'Tämä riittää, jos osoite on yksiselitteinen. Merkitse kohta kartalle, jos haluat tarkentaa.';
      }
      if(s === 'rejected' && state.gpsRejectedAccuracyM){
        o.msg = 'Puhelin arvioi tarkkuudeksi vain noin ' + state.gpsRejectedAccuracyM + ' m. ' + t.msg;
      }
      if((s === 'moderate' || s === 'poor') && state.accuracyM){
        o.msg = 'Puhelimen paikannus osui noin ' + state.accuracyM + ' m tarkkuudella. ' + t.msg;
      }
      return o;
    }

    function esc(s){
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function render(){
      var c = $('hn-conf'), v = stripCopy();
      c.dataset.state = v.style;
      $('hn-badge').textContent = v.badge;
      $('hn-conf-title').textContent = v.title;
      $('hn-conf-msg').textContent = v.msg;

      var meta = $('hn-conf-meta');
      if(state.lat !== null){
        var bits = [state.locationSource === 'gps' ? 'puhelimen paikannus' : 'merkitty kartalle'];
        if(state.accuracyM !== null) bits.push('n. '+state.accuracyM+' m');
        if(state.zoomAtDrop !== null) bits.push('zoom '+state.zoomAtDrop);
        meta.innerHTML = '<span class="hn-coords">'+state.lat.toFixed(6)+', '+state.lng.toFixed(6)+'</span>'+
                         '<span class="hn-desc">'+esc(bits.join(' · '))+'</span>';
        meta.classList.remove('hn-hidden');
        $('hn-conf-actions').classList.remove('hn-hidden');
      } else {
        meta.classList.add('hn-hidden');
        $('hn-conf-actions').classList.add('hn-hidden');
      }

      var f = $('hn-fail');
      if(flash){
        f.textContent = flash.msg; f.dataset.kind = flash.kind; f.classList.remove('hn-hidden');
      } else {
        f.classList.add('hn-hidden');
      }

      var sg = $('hn-suggest');
      if(pending){
        $('hn-suggest-val').textContent = pending.text;
        sg.classList.remove('hn-hidden');
      } else {
        sg.classList.add('hn-hidden');
      }

      var as = $('hn-addr-src');
      if(state.address && (state.addressSource === 'reverse-geocoded' || state.addressSource === 'derived-from-pin')){
        as.innerHTML = 'Täytetty automaattisesti ' +
          (state.addressSource === 'derived-from-pin' ? 'kartan merkistä' : 'puhelimen paikannuksesta') +
          '. <b>Korjaa vapaasti</b>, jos tunnet paikan paremmin.';
        as.classList.add('hn-on');
      } else {
        as.classList.remove('hn-on');
        as.innerHTML = '';
      }

      push();
      renderOps();
    }

    /* ---------- demo panel (delete field 7 to remove) ---------- */
    function renderOps(){
      var card = $('hn-ops-card');
      if(!card) return;
      var rows = [], flags = [];

      if(!state.address && state.lat === null && !state.gpsRejectedAccuracyM && state.atSite === null){
        card.innerHTML = '<p class="hn-ops-empty">Sijaintia ei ole annettu.</p>';
        dumpJson(); return;
      }

      rows.push(['Osoite', esc(state.address || '—') +
        (state.addressSource ? '<span class="hn-ops-sub2">'+esc(SRC_LBL[state.addressSource])+'</span>' : '')]);

      if(state.nearestAddress && state.nearestAddress !== state.address){
        rows.push(['Lähin osoite', '<span class="hn-ops-ref">'+esc(state.nearestAddress)+
          '</span><span class="hn-ops-sub2">kartan mukaan, ei ilmoittajan sanoin</span>']);
      }

      if(state.lat !== null){
        var conf = state.confidence === 'reliable'
          ? '<span class="hn-ops-ok">luotettava</span>'
          : '<span class="hn-ops-flag">'+(COPY[state.confidence]||COPY.empty).badge.toLowerCase()+'</span>';
        var ex = [];
        if(state.locationSource === 'gps') ex.push('puhelimen paikannus');
        if(state.locationSource === 'map-pin') ex.push('merkitty käsin kartalle');
        if(state.accuracyM !== null) ex.push('n. '+state.accuracyM+' m');
        if(state.zoomAtDrop !== null) ex.push(zoomWord(state.zoomAtDrop));
        rows.push(['Koordinaatit', state.lat.toFixed(6)+', '+state.lng.toFixed(6)+' — '+conf+
          '<span class="hn-ops-sub2">'+esc(ex.join(', '))+'</span>']);
      } else {
        rows.push(['Koordinaatit', '<span class="hn-ops-flag">ei saatavilla</span>']);
      }

      rows.push(['Ilmoittaja', state.atSite === null ? '—'
        : state.atSite ? 'paikalla kohteessa'
        : '<span class="hn-ops-flag">EI paikalla kohteessa</span>']);

      if(state.overrodeGps) flags.push('Ilmoittaja korjasi automaattisen paikannuksen kartalle.');
      if(state.gpsRejectedAccuracyM) flags.push('Puhelimen paikannus hylättiin: tarkkuus vain n. '+state.gpsRejectedAccuracyM+' m.');
      if(state.confidence === 'conflict') flags.push('Osoitetta muokattu haun jälkeen — varmista kumpi pätee.');
      if(state.atSite === false && state.lat === null) flags.push('Ei koordinaatteja eikä ilmoittaja ole paikalla — soita ilmoittajalle.');
      if(state.lat !== null && state.zoomAtDrop !== null && state.zoomAtDrop < 14) flags.push('Merkki asetettu yleiskuvasta — tarkoitti todennäköisesti aluetta, ei pistettä.');

      var html = '<div class="hn-ops-row">' + rows.map(function(r){
        return '<div class="hn-ops-k">'+r[0]+'</div><div class="hn-ops-v">'+r[1]+'</div>';
      }).join('') + '</div>';

      if(flags.length){
        html += '<div class="hn-ops-flags">' + flags.map(function(x){
          return '<div class="hn-ops-warn">'+esc(x)+'</div>';
        }).join('') + '</div>';
      }

      if(state.lat !== null){
        var u = 'https://www.openstreetmap.org/?mlat='+state.lat+'&mlon='+state.lng+'#map=17/'+state.lat+'/'+state.lng;
        html += '<p class="hn-ops-link"><a href="'+u+'" target="_blank" rel="noopener">Avaa sijainti kartalla ↗</a></p>';
      }

      card.innerHTML = html;
      dumpJson();
    }

    function zoomWord(z){
      if(z>=17) return 'katutaso';
      if(z>=14) return 'kylä-/kaupunginosataso';
      return 'yleiskuva — tarkoitti todennäköisesti aluetta';
    }

    function dumpJson(){
      var out = $('hn-json');
      if(!out) return;
      out.textContent = JSON.stringify({
        locationAddress:state.address||null, locationAddressSource:state.addressSource,
        locationNearestAddress:state.nearestAddress,
        locationLat:state.lat, locationLng:state.lng, locationSource:state.locationSource,
        locationAccuracyM:state.accuracyM, locationZoomAtDrop:state.zoomAtDrop,
        locationCapturedAt:state.capturedAt, locationAtSite:state.atSite,
        locationConfidence:state.confidence, locationOverrodeGps:state.overrodeGps,
        locationGpsRejectedAccuracyM:state.gpsRejectedAccuracyM
      }, null, 2);
    }

    /* ---------- simulation (delete field 8 to remove) ---------- */
    document.querySelectorAll('[data-hn-sim]').forEach(function(b){
      b.addEventListener('click', function(){
        var v = b.getAttribute('data-hn-sim');
        if(v === 'denied'){
          setFlash('error','Paikannus estettiin. Merkitse kohta kartalle tai kirjoita osoite.');
          render(); return;
        }
        var acc = parseInt(v,10);
        setFromGps(HOME[0]+(Math.random()-0.5)*0.02, HOME[1]+(Math.random()-0.5)*0.04, acc);
      });
    });

    /* ---------- rehydrate after a Gravity Forms validation re-render ----------
       GF returns the submitted values of its own fields, hidden ones included. Without
       this, the first render() would push an empty state over them and a reporter who
       tripped a validation error on some other field would silently lose the location
       they had already given. */
    function hydrate(){
      if(!form) return;
      var g = function(id){ var e = fld(id); return (e && e.value !== '') ? e.value : null; };
      var num = function(v){ return v === null ? null : parseInt(v, 10); };

      state.addressSource        = g(10);
      state.nearestAddress       = g(11);
      state.locationSource       = g(14);
      state.accuracyM            = num(g(15));
      state.zoomAtDrop           = num(g(16));
      state.capturedAt           = g(17);
      state.confidence           = g(19) || 'empty';
      state.overrodeGps          = g(20) === 'true';
      state.gpsRejectedAccuracyM = num(g(21));

      if(addressEl && addressEl.value){
        state.address = addressEl.value;
        if(!state.addressSource) state.addressSource = 'typed';
      }

      var lat = g(12), lng = g(13);
      if(lat !== null && lng !== null){
        state.lat = parseFloat(lat);
        state.lng = parseFloat(lng);
        coordTier = state.locationSource === 'map-pin' ? 'reliable'
                  : (state.accuracyM !== null ? tierFor(state.accuracyM) : null);
        placeMarker(state.lat, state.lng);
        map.setView([state.lat, state.lng], state.zoomAtDrop || 16);
      }
    }

    $('hn-btn-recenter').style.display = 'none';
    hydrate();

    var checked = form ? form.querySelector('input[name="input_3"]:checked') : null;
    if(checked) applyAtSite(checked.value === 'yes' || /kyll/i.test(checked.value), false);
    else render();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  if(window.jQuery) jQuery(document).on('gform_post_render', boot);
})();
