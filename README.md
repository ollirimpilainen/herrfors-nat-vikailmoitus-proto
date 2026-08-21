# Herrfors Nät — Vikailmoituslomake, sijaintiosio (prototyyppi)

Interaction prototype for the location section of the Herrfors Nät fault reporting
form (vikailmoituslomake). Standalone HTML — no build step, no backend, no API keys.

**Live:** https://ollirimpilainen.github.io/herrfors-nat-vikailmoitus-proto/

---

## What this is for

The rest of the fault form (name, phone, email, attachments) is standard Gravity
Forms. The location section is not, and it is the part that decides whether the
operations centre can find the fault without phoning the reporter back.

This prototype exists to settle the interaction design before anything is built
in WordPress.

## The core premise

**Where the reporter is standing is not necessarily where the fault is.**

Sometimes it is — a contractor at a dig site, a resident looking at a fallen pole.
Often it isn't — someone who saw a problem while driving and reports it from home,
a property manager reporting from the office.

So automatic geolocation is a *helper, not the answer*. The address field is what
actually matters. Coordinates are a bonus when they're trustworthy.

## Three ways to give a location

All peers, none buried:

1. **Use my current location** — only offered when the reporter says they're at the site
2. **Place a pin on a map** — crosshair at map centre, pan underneath, commit
3. **Type an address or description** — always available, always editable

Whichever is used, they all write to the same state.

## Confidence, not just coordinates

A fix accurate to 15 m and one accurate to 900 m look identical if you only store
lat/lng. The prototype tiers them and says so in plain language:

| Accuracy | State | Behaviour |
|---|---|---|
| ≤ 50 m | reliable | Confirmed, good to go |
| 51–200 m | moderate | Confirmed + nudge to refine |
| 201–1000 m | poor | Warned, asked to place a pin instead |
| > 1000 m | rejected | **Coordinates discarded entirely** |

That last row is deliberate. A coordinate a kilometre off is worse than none —
it looks precise and isn't.

An address with no coordinates is not nothing — the strip says so, while the emitted
`locationConfidence` stays `empty`, because that field describes the coordinate rather
than the report. A rejected fix keeps its accuracy figure in
`locationGpsRejectedAccuracyM`: "the phone could only manage 2.4 km here" tells the
duty officer something about the area.

**A hand-placed pin is always `reliable`.** It has no machine accuracy figure, but
it's a deliberate act by someone who knows where the fault is. If a reporter gets a
bad automatic fix and then corrects it with the pin, the correction wins and the bad
reading is discarded.

## Mobile map interactions (v0.2)

Four problems, four fixes:

- **Scroll trap** — the map is inert until tapped. You can swipe straight past it.
  Tapping activates it (orange border); the ✕ locks it again. The activating tap
  never drops a pin.
- **Fat-finger placement** — crosshair fixed at map centre, pan the map underneath,
  commit with a button. Your finger never covers the target. Same pattern as
  delivery apps.
- **Cramped viewport** — ⛶ expands to fullscreen with the crosshair and commit bar
  intact. Escape or committing exits.
- **Gloved hands** — 44 px minimum on all map controls, 52 px on form controls.

The ◎ button recentres on the reporter *without* setting the pin — orientation only,
distinct from "use my location as the answer".

## Logic round (v0.3)

Six inconsistencies between what the interface showed and what it stored. Each one
could have shipped, and each one would have shown the duty officer something that
wasn't true.

- **A discarded fix left its pin on the map.** Over 1000 m the coordinates are thrown
  away — but a marker from an earlier attempt stayed visible. The map said "here",
  the data said nothing. Coordinates and marker now leave together.
- **Failure messages evaporated.** "Paikannus estettiin" was written straight to the
  DOM, so the next re-render — one keystroke in the address field — wiped it. Notices
  are part of the state now, and sit under the confidence strip instead of replacing it.
- **The geocoder overwrote hand-typed addresses.** Type *"metsätie n. 2 km Ähtävän
  risteyksestä pohjoiseen"*, then place a pin, and Nominatim's nearest street address
  silently replaced it. Now the reporter's own words stay and the geocode is offered
  beside them: **Käytä tätä** / **Pidä oma teksti**. Either way the nearest street
  address is kept for the duty officer.
- **"En ole paikalla" left the phone fix in place.** Answering that you are *not* at
  the fault, after taking a GPS fix, kept coordinates that are by definition your own
  position — and the street address derived from them. Both are dropped now, with an
  explanation. A hand-placed pin survives; it was never about the reporter's position.
- **An address with no coordinates read as "no location given".** The strip now says
  what has actually been given.
- **Keyboard focus was lost when the map opened.** The gate is `display:none` once the
  map is active. Focus moves to the map itself now — arrow keys pan, and it shows a
  focus ring.

Smaller: a rejected fix keeps its accuracy figure for the ops panel, a pin dropped at
zoom < 14 is flagged as area-not-point, a locked map no longer offers zoom buttons,
the OSM attribution is no longer hidden behind the commit bar, fullscreen carries its
own instruction, and the duty officer's panel is a grid rather than space-padded
text — so long addresses line up instead of drifting.

## Testing without going outside

Browser geolocation needs HTTPS and is blocked in many preview frames. The
simulation panel at the bottom of the page fires every accuracy tier plus the
permission-denied path. Use it to demo all states indoors.

The map interactions need no simulation — they work everywhere.

## What the operations centre sees

The dark panel renders the interpreted summary, not raw data. This is the artefact
for the conversation with päivystys: show them that panel and ask whether it's what
they need at 3am.

## Stack

- [Leaflet](https://leafletjs.com/) 1.9.4 via cdnjs — map rendering
- OpenStreetMap tiles
- [Nominatim](https://nominatim.org/) — reverse geocoding

No API key, no paid plugin, nothing requiring procurement approval at Nät. This was
a hard constraint: plugin purchases need sign-off, so v1 has to work without one.

## Known gaps

- **Address → map is not wired.** Typing an address doesn't move the map. Deliberately
  cut; pin → address is enough for v1.
- **The 400 m problem.** A pin in a forest still gets the nearest street address
  attached. Since v0.3 it is labelled and kept in its own field
  (`locationNearestAddress`) rather than posing as the reporter's answer — but whether
  a duty officer finds that useful or misleading is still a päivystys call.
- **Nominatim rate limit** (~1 req/s) is debounced but not hard-guarded.
- **Nominatim needs a server-side proxy — confirmed, not hypothetical.** A browser
  can't set User-Agent, so identification falls back to Referer, and the rate limit is
  debounced rather than guarded. One small PHP route solves both. The CSP half of this
  is resolved — herrforsnat.fi now allows OpenStreetMap, so `fetch` works there and the
  JSONP fallback is dormant. See [gravity-forms/README.md](gravity-forms/README.md).
- **Network area check** is out of scope. Needs the Nät boundary polygon, which may
  not exist in a usable form.

## Open questions

For Oskari:
1. Does the Nät network area boundary exist anywhere usable (GeoJSON, shapefile,
   existing map service)?
2. Where do submitted reports actually land — email, ticketing, straight to the
   24/7 operations centre? Determines what format the location needs on arrival.
   *Partly answered from the site itself:* the live form 32 has no notifications
   configured and a **Gravityforms Frends** add-on is active, so submissions probably
   leave through Frends. Worth confirming rather than assuming.

For päivystys / Mikaela:
3. What does the duty officer actually *do* with the location — type it into a
   navigator, compare against the network map, pass it on? Determines whether
   coordinates should be shown as decimals or purely as a map link.
4. How often does someone currently have to phone the reporter back to pin down
   the location? That's the success metric for this whole thing.

## Gravity Forms port

`gravity-forms/` holds the same interaction as an importable Gravity Forms form —
map and logic inside HTML fields, the address as a real required GF field, the data
model as hidden fields. No plugin and no PHP on the site. See
[gravity-forms/README.md](gravity-forms/README.md) for the import steps, the field
map, and the risks worth checking on a live site.

## Versions

- `index.html` — v0.3, current
- `versions/v0.2.html` — scroll lock, crosshair placement, fullscreen
- `versions/v0.1.html` — first pass, drag-a-marker, no scroll lock

---

Genero · service design
