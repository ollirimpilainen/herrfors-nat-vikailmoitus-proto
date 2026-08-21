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

## Known risks on a real site

1. **`<script>` and `<style>` inside an HTML field need the `unfiltered_html`
   capability.** Administrators have it on a single-site install; on multisite only
   super admins do. If the site strips them on import, the field will render but do
   nothing — the fallback is a small mu-plugin that enqueues `hn-location.css` and
   `hn-location.js` instead, with the HTML fields keeping only the markup. **Verify
   this first after importing.**
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
