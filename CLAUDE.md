# Project context for Claude Code

## What this repo is

A standalone interaction prototype for the location section of the Herrfors Nät
fault reporting form. It is **not** production code and is not wired to anything.
Its job is to settle interaction design before implementation in WordPress /
Gravity Forms.

Client: Herrfors Nät (Finnish electricity network operator, Pietarsaari region).
Agency: Genero.

## Hard constraints — do not violate without asking

- **No paid plugins, no API keys.** Plugin purchases need procurement sign-off at
  Nät, so v1 must work without one. Leaflet + OpenStreetMap + Nominatim only.
  Do not introduce Google Maps, Mapbox, or anything requiring a key.
- **No build step.** Single self-contained HTML file. Anyone should be able to open
  `index.html` and have it work. Do not add npm, bundlers, or frameworks.
- **UI language is Finnish.** Code, comments, and docs are English. Swedish will be
  needed eventually (Herrfors is bilingual) but is not in scope yet.

## Design principles that are load-bearing

Changing these changes the product, not just the code. Ask first.

1. **The address field is authoritative; coordinates are supplementary.** Never lock
   or hide the address field.
2. **Visual precision must match actual certainty.** A coordinate over ~1 km
   inaccurate is discarded rather than shown, because a precise-looking wrong number
   is worse than no number.
3. **A hand-placed pin outranks an automatic fix.** It has no accuracy figure but
   it's a deliberate act. Committing a pin discards any prior GPS accuracy value and
   sets confidence to `reliable`.
4. **The map never captures gestures unasked.** It is inert until explicitly
   activated. The activating tap must not also place a pin.
5. **"Are you at the site?" gates the GPS option.** If the reporter isn't there,
   automatic location is hidden entirely rather than offered and ignored.

## Brand

- Navy `#0b2545`, orange `#E05A2B`, teal `#3ABFA1`, salmon `#FAECE7`
- Danger `#C62828`, warning `#B26A00`
- Body: Mulish. Headings: Source Serif 4.

## Accessibility floor

- 52 px minimum tap target on form controls, 44 px on map controls (gloved hands,
  outdoors, bad weather)
- Visible keyboard focus everywhere
- `aria-live` on the confidence strip, `role="alert"` on the 112 warning
- `prefers-reduced-motion` respected

## Data model

Emitted in the JSON panel. Keep field names stable — they're the contract with the
developer building the Gravity Forms version.

```
locationAddress        string   the address text
locationAddressSource  enum     typed | reverse-geocoded | derived-from-pin | edited-after-geocode
locationLat            number   6 dp
locationLng            number   6 dp
locationSource         enum     gps | map-pin | null
locationAccuracyM      number   metres, GPS only; null for a hand-placed pin
locationZoomAtDrop     number   map zoom when pin committed — proxy for intended precision
locationCapturedAt     string   ISO timestamp
locationAtSite         boolean  reporter's own answer
locationConfidence     enum     empty | reliable | moderate | poor | rejected | conflict
locationOverrodeGps    boolean  reporter corrected an automatic fix by hand
```

Added in v0.3 — additive and nullable, but not yet blessed by the developer:

```
locationNearestAddress        string  geocoded street address for the coordinate, kept
                                      separately when the reporter writes their own
                                      description. What päivystys needs for the
                                      "pin in a forest" case.
locationGpsRejectedAccuracyM  number  accuracy of a fix discarded for being over 1 km.
                                      Records that the phone tried and failed here;
                                      null when nothing was rejected.
```

`locationConfidence` describes the *coordinate*, not the report. An address with no
coordinates emits `empty` — the confidence strip says something more useful to the
reporter, but the stored value stays as documented above.

## Deployment

GitHub Pages from `main`, root. HTTPS matters — browser geolocation is blocked
without it.

## Likely next tasks

- Real-device testing on iOS Safari (v0.3 is verified in a desktop-engine mobile
  viewport only — fullscreen `100dvh` and the safe-area insets need a real phone)
- Developer-facing implementation spec (Finnish + English — that's the established
  pattern on this account)
- Swedish UI strings
- Possibly: address → map syncing, currently cut

## Working style

Structure before design. One deliverable at a time. Prototype and iterate before
writing specs. Prefer plain language over jargon in all user-facing copy.
