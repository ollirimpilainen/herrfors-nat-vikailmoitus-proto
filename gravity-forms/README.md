# Gravity Forms port

The location section of prototype v0.3, ported to a Gravity Forms form. No plugin,
no PHP, no build step on the site — the whole thing travels inside one importable
form definition.

## Files

| File | What it is |
|---|---|
| `herrfors-vikailmoitus-sijainti.json` | **The deliverable.** Import this into Gravity Forms. |
| `hn-location.css` | Source of the field's CSS, scoped so nothing touches the theme |
| `hn-location.js` | Source of the field's logic, ported from `../index.html` |
| `build.py` | Assembles the two above into the form JSON |
| `make-harness.py` | Renders the form JSON into `harness.html` |
| `harness.html` | Generated. Mimics GF's DOM so the port can be tested without WordPress |

`build.py` is a packaging step for *this* artefact only. The prototype itself stays a
single self-contained `index.html` with no build step — that constraint is untouched.

```bash
python3 gravity-forms/build.py && python3 gravity-forms/make-harness.py
```

## Import

Forms → Import/Export → Import Forms → upload the JSON.

It arrives as **"Vikailmoitus — sijaintiosio (demo v0.3)"**, active but not embedded
on any page. Test it through GF's own Preview. Nothing is public until someone adds
the shortcode to a page.

**It has no notifications on purpose.** A test submission emails nobody.

## How it is wired

Gravity Forms owns the parts GF is good at; the HTML fields own the map.

| Field | Type | Role |
|---|---|---|
| 1 | Select | Fault type. Choice values are the enum (`outage`, `damaged`, …) |
| 2 | HTML | The 112 warning. Shown by **GF's own conditional logic** on field 1 = `damaged` |
| 3 | Radio | "Oletko juuri nyt vian luona?" — values `yes` / `no` |
| 4 | HTML | Leaflet map: gate, crosshair, commit bar, fullscreen |
| 5 | Textarea | **The address. A real, required GF field** — it is the authoritative answer |
| 6 | HTML | Provenance line, geocode suggestion, confidence strip, and the script |
| 7 | HTML | Demo: what the duty officer sees. **Delete for production** |
| 8 | HTML | Demo: accuracy simulation. **Delete for production** |
| 10–21 | Hidden | The data model, written by JS on every state change |

`locationAddress` is field 5 itself, not a hidden field — the reporter's own words stay
in a normal GF field that validates, is required, and shows up in the entry like any
other answer. The hidden fields carry everything that describes *how much to trust it*.

Nothing in the JS depends on the form id, only on those field ids, so the import can
land on any form number.

Booleans are written as the strings `"true"` / `"false"`, and empty is `""` rather
than `null`. That is a Gravity Forms constraint — hidden inputs only carry strings.
Whoever consumes the entry casts them.

## What was tested, and how

`harness.html` reproduces what matters about GF's DOM — a real `<form>`, `input_N`
names, GF field wrappers, jQuery, `gform_post_render`, and a shim for GF's conditional
logic. Verified in it:

- every confidence tier, the rejection path, the conflict path, and the
  suggestion path, each checked against the hidden field values rather than the UI
- the 112 warning appearing and disappearing through GF's conditional logic
- **the validation round-trip.** This found a real bug: GF hands back the submitted
  hidden values after a failed validation, and the first `render()` pushed an empty
  state straight over them. A reporter who tripped a required-field error somewhere
  else in the form would have silently lost the location they had already given.
  The port now rehydrates from the hidden fields on boot, puts the marker back on
  the map, and restores the strip.
- re-initialisation on `gform_post_render` without duplicate maps or leaked handlers

## Live on herrforsnat.fi

Imported and verified on the client's own site as **form 35**, "Vikailmoitus -
sijaintiosio (demo v0.3)". Not embedded anywhere; reachable only through Gravity
Forms' preview, and it sends no notifications. Two things about that site broke the
port on the first try, and both matter for production.

### 1. Inline scripts that arrive with the page do not execute

The `<script>` was served intact — confirmed in the raw HTML response — and never
ran. No console error, no CSP violation, no `type` rewrite, nothing stripped. But
re-creating the very same code as a script element at runtime ran it perfectly.

The cause is the site's CSP, and it took a detour to establish. The first guess was
Genero CMP, the consent layer — the page carries one `type="text/plain"` script, the
classic fingerprint of a consent-based script blocker. That was wrong. Reading the
enforced policy verbatim off a `securitypolicyviolation` event settled it: `script-src`
carries a per-request **nonce** and **`'strict-dynamic'`**. Under that policy an inline
script without the nonce is refused, while a script created at runtime by already
trusted code is allowed — exactly the behaviour observed. The policy is doing its job
correctly; nothing is misconfigured.

That also explains why Leaflet loads from cdnjs even though cdnjs appears nowhere in
`script-src`: `'strict-dynamic'` makes the host allowlist irrelevant for scripts our
own trusted code injects.

So the port no longer relies on an inline script executing. The code is parked in
`<script id="hn-src" type="text/hn-source">` — a type no browser executes — and an
`<img src="data:," onerror="…">` promotes it to a real script, because inline event
handlers fire regardless of how the element reached the DOM. Parking it deliberately
means there is exactly **one** code path on every site rather than one that sometimes
runs twice.

That is a workaround, not an answer. The clean fix is to give the field's script the
CSP nonce that the theme already generates per request — a Gravity Forms HTML field
cannot do that on its own, so it needs a filter on the theme side, or the script moved
into a properly enqueued asset where Spatie's nonce handling applies. Either belongs in
the production build rather than in this demo.

### 2. The site forbids cross-origin fetch and XHR

`fetch()` to Nominatim fails with `TypeError: Failed to fetch` and never reaches the
network. Not a Nominatim problem: `fetch()` to cdnjs fails the same way, on a page
that has just loaded a script *from cdnjs*. Tiles, scripts and stylesheets load;
`fetch`/`XHR` do not. That is a `Content-Security-Policy: connect-src` restriction —
element loads answer to other directives.

Reverse geocoding therefore cannot work from the browser on this site. The port falls
back to Nominatim's `json_callback`, which returns JSONP and arrives as a script load.
Verified live, ~200–700 ms per lookup. `fetch` stays the first choice on sites without
the policy.

**For production this settles an open question: the server-side proxy is required,
not optional.** One small REST route that calls Nominatim from PHP fixes three things
at once — the policy, the User-Agent identification a browser cannot set, and the rate
limit. Until then, JSONP keeps the demo honest.

### 3. A page embed rewrites every "&" in the field content

The form worked in Gravity Forms' preview and broke the moment it was placed on a
real page. WordPress' text filters run over an HTML field rendered inside page
content and rewrite `&` to `&#038;`. Ten of the script's `&&` operators became
`&#038;&#038;` — `#` is not a valid token, so the whole script threw a `SyntaxError`
on load — and three query-string separators in the Nominatim URL were corrupted the
same way. The CSS survived only because it happens to contain no ampersands.

The logic is therefore parked as **base64** and decoded by the loader. Base64 uses
none of the characters those filters touch, so the blob arrives byte for byte. It
also makes the field unreadable in the form editor, which is the trade: the source of
truth is `hn-location.js` in this repo, and `build.py` is what puts it in the form.

### 5. The same CSP also blocked Leaflet's stylesheet — and that was the half-grey map

Adding OpenStreetMap to `img-src` was necessary and not sufficient. The tiles then
arrived, and the map still rendered half grey, because `style-src` does not list cdnjs
either: the `<link>` to `leaflet.min.css` is refused with `style-src-elem`. Without
Leaflet's stylesheet, `.leaflet-tile` never gets `position: absolute`, so tiles load
and then flow as static inline images. Computed `position` on a tile was `static` —
that one word was the whole answer.

Leaflet's own maths was right the entire time: the inline `translate3d` values were
contiguous at 256px. What was wrong was the layout they were applied to.

Two casualties of the same allowlist, both fixed inside the field:

- **Leaflet's stylesheet is vendored** into the field's `<style>` block
  (`vendor-leaflet.css`, 10.9KB). Inline CSS is allowed by the policy, so nothing needs
  changing on the site. Its three `url(images/…)` references are stripped — the layers
  control is never added and the marker no longer needs an image.
- **The marker is an inline SVG.** Leaflet's default icon is a PNG on the CDN, which
  `img-src` does not permit either, so the pin would have silently never appeared.

Plus a guard worth having anywhere: `#hn-map img{max-width:none!important}`. Leaflet
1.9.4 exempts only image layers from `max-width`, not tiles, and a tile's `max-width`
resolves against a tile container with no width — so a theme's `img{max-width:100%}`
can clamp tiles to nothing.

Verified on herrforsnat.fi's Gravity Forms preview after the change: tile `position`
`absolute`, `max-width` `none`, rendered stride exactly 256px, 22 of 22 tiles carrying
pixels, **100% coverage**.

#### How long this took, and why

Longer than it should have. Three wrong turns worth recording, because each one has a
lesson that generalises:

- **I counted loaded tiles instead of measuring coverage,** and reported the map as
  working on that basis. Eight tiles can all be "loaded" while covering a third of the
  map. Measure the thing the user sees, not a proxy for it.
- **I shipped a `tileerror` retry as a defensive guess.** It was worse than useless:
  Leaflet recycles tile elements, so a delayed `img.src` write lands on an element that
  now belongs to a different coordinate. Reverted. Do not ship speculative fixes into
  the thing being diagnosed.
- **Half my measurements came from a background tab,** where `requestAnimationFrame` is
  paused, so Leaflet's fade never completed and every tile read `opacity: 0`. Check
  `document.hidden` before trusting anything about rendering.

The measurement that ended it was asking the browser instead of inferring: dump the
inline `translate3d` values, read computed `position`, and listen for
`securitypolicyviolation`. All three were available from the first minute.

### 4. The site's CSP blocked the map tiles — resolved 21.8.2026

**Closed.** Oskar merged [generoi/herrfors#159](https://github.com/generoi/herrfors/pull/159)
(squashed as `ba6f2809`) and it is deployed. Verified on the live demo page afterwards:
zero `securitypolicyviolation` events, all eight tiles loaded with real pixels at zoom
17, and reverse geocoding now travels over `fetch` in ~400 ms instead of the JSONP
fallback — so the `connect-src` line did its job and the workaround is dormant on this
site. It stays in the code for environments that need it.

The account below is kept because the diagnosis is the reusable part.

---

This one the form could not fix. `herrforsnat.fi` sends an enforcing
`Content-Security-Policy` whose `img-src` is an allowlist — Hotjar, Clarity, Google
Tag Manager, DoubleClick, Facebook, YouTube — and **OpenStreetMap is not on it**. The
browser says so directly: a `securitypolicyviolation` event fires with
`violatedDirective: "img-src"` and `disposition: "enforce"` for every tile. Twelve
tile elements exist in the DOM, none loads, and no request reaches the network.

Everything else on the page works: the script loads, the map initialises, the address
auto-fills, every confidence state behaves, and all twelve hidden fields track the
state. Only the tile images are blocked, so the map reads as a blank grey box.

**What fixed it** — a new `OpenStreetMap` preset in the theme's Spatie CSP config:

```
img-src      ... *.tile.openstreetmap.org
connect-src  ... nominatim.openstreetmap.org     (lets the port drop the JSONP hack)
script-src   ... nominatim.openstreetmap.org     (currently permitted - confirm, do not assume)
```

The allowlist is full of analytics and tag-manager hosts, which suggests the policy is
generated by the consent or tag layer rather than the theme. **Genero CMP is our own
plugin, so this is quick to find out and quick to change** — but it is a site-wide
security setting, so it belongs to whoever owns that configuration, not to this form.

#### Decided: the map is necessary functionality

Olli's call, 21.8.2026. A reporter must be able to point at a fault without first
accepting cookies, so the map does not go behind the consent banner. That settles what
has to change, and it rules out the easy non-answer of leaving the tiles consent-gated.

**Where the policy comes from.** WordPress, not the host. Static files served straight
from disk carry no CSP at all, while every PHP-rendered response — a themed page, a
404, even `robots.txt` — carries the same 2012-byte, 15-directive header. It is not in
Genero CMP's settings screen either; that plugin only handles GTM, the dataLayer and
the banner. So it lives in a `send_headers` hook in the theme or an mu-plugin, which
needs filesystem access to find.

**Two ways to satisfy the decision.** They are not exclusive, and the second one was
already needed for other reasons.

1. **Add the hosts to the allowlist.** One line, works today, keeps tiles coming
   straight from OpenStreetMap. The consequence to state plainly: the reporter's IP
   address goes to OSM's servers with no consent step, because the functionality is
   classified as necessary. That is defensible for a map that *is* the reporting
   mechanism, but it belongs in the privacy notice, naming OpenStreetMap as a
   recipient. Not a blocker — a sentence someone has to write.
2. **Proxy through the site's own domain.** `'self'` is already allowed, so no policy
   change at all, and the third-party transfer disappears — which removes the privacy
   question rather than documenting it. This is the same small plugin that already has
   to exist for reverse geocoding: one PHP route for Nominatim (fixing the User-Agent
   identification and the rate limit) and one for tiles, with caching. Attribution
   stays on the map either way; the OSM licence requires it regardless of who serves
   the bytes.

The pragmatic path is both: the allowlist entry now so the demo and the client
conversation can proceed, the proxy plugin as the production shape. What must not
happen is the decision quietly reverting to "the map needs consent" because the
allowlist was never touched.

## What the live site revealed about the real form

Form **32 "Vikailmoitus"** already exists and is active: Etunimi, Sukunimi, Puhelin
(required), Sähköposti, Liitteet, "Mitä vika koskee?", **Osoite**, a "Varoitus" HTML
field, and Tarkentavat tiedot. Three things follow.

- **The existing address field is a Gravity Forms `address` field** — a composite of
  street, city, postcode, country. It cannot hold *"metsätie n. 2 km Ähtävän
  risteyksestä pohjoiseen"*, which is the exact case this whole section exists for.
  Replacing it with free text, or keeping both, is a decision for Nät — and it should
  be made before the developer builds anything.
- **The address is not currently required.** The prototype makes it required. Also a
  decision, not a detail.
- **Form 32 has no notifications configured**, and a **Gravityforms Frends** add-on is
  active. That suggests submissions leave through Frends rather than email, which
  would answer README open question 2, "where do submitted reports actually land".
  Worth confirming with Oskari rather than assuming.

## Other risks on a real site

1. **`<script>` and `<style>` inside an HTML field need the `unfiltered_html`
   capability.** herrforsnat.fi is a multisite, where only super admins have it — the
   account used for the import does, so nothing was stripped. An editor without it
   would import a field that renders and does nothing. If that happens, enqueue the
   CSS and JS from a small mu-plugin and keep only markup in the HTML fields.
2. **A theme that transforms an ancestor** would trap `position:fixed`. Handled: the
   map stage is moved to `<body>` while fullscreen and put back on exit.
3. **The theme's own button and form styles** may still win where specificity is
   equal. Everything is prefixed `hn-` and the custom properties are scoped to the
   two containers, but a theme with `!important` on buttons will need a look.
4. **Nominatim** cannot be identified by User-Agent from a browser and falls back to
   Referer. Fine at demo volume; production needs a server-side proxy.
5. The port was verified in the harness and in a mobile viewport on a desktop engine.
   iOS Safari — fullscreen `100dvh`, safe-area insets — still needs a real phone.

## Production, later

For production the right shape is a **custom GF field type** in a small plugin: one
field the editor can drop in, server-side validation of the coordinates, and the
values stored as proper entry meta instead of hidden inputs. That is a separate
deliverable and needs no procurement either — it is our own code, not a purchased
add-on. This port exists to settle the interaction in a real form first.
