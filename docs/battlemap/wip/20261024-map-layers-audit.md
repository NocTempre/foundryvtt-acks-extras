# Map layers — what ACKS tracks, what the module tracks, how to keep them apart

In-flight audit (2026-10-24), opened by the owner's report on the country
brush: the brush paints through its own palette, the paint layers overlap,
territory should read as a border colour over the terrain fill, climate
should become a map-wide setting, markets should show their reach, and
domains are a further layer to keep visually apart. When the work lands, its
substance moves to `docs/battlemap/{MODEL,DECISIONS}.md` and this file is
deleted.

Citations only; no page values. Symbols are named rather than line numbers.

## 1. Hex-attribute layers

What is true of a hex, as the book keys it and as the module stores it.

| Layer | Question it answers | Book owner | Book grain | Module grain | Where the value lives | Seen by | Drawn |
|---|---|---|---|---|---|---|---|
| Terrain | What ground is this? (speed, encounter table, visibility) | RR §VI.2 Wilderness Expeditions; JJ Ch2 wilderness encounters | regional hex | regional hex | Region per value, flags `terrain`/`terrainHexes` (`terrain-paint.mjs`) | everyone | core Region hatch fill |
| Territory | How settled is it? (encounter frequency and table, hunting, XP "civilization", lairs) | RR §VIII.3 "Acquiring the Domain" (RR p. 337); JJ Ch2 "Placing Lairs in Civilized, Borderlands, or Outlands Hexes"; JJ Ch6 Step 9 | **the domain**: a hex takes its domain's class; a hex in no domain is unsettled; a sea hex takes its shore's, stepped down by distance (JJ Ch2 sea encounters) | regional hex, painted independently | Region per value, `territory`/`territoryHexes`; scene default `battlemap.country.territory` | GM | core Region hatch fill |
| Climate | Which weather table? | JJ Ch2 "Weather", "Climate by Terrain" | weather hex, the larger hex the day's weather is rolled in | regional hex | Region per value, `climate`/`climateHexes`; scene default `battlemap.country.climate` | GM | core Region hatch fill |
| Domain | Whose land is it, and under which liege? | RR §VIII.3 Domains and Realms; JJ Ch6 Step 8 (A–G) | hex sets, nested: personal domain ⊂ county ⊂ duchy ⊂ principality | domain actor's `territory` rows (labels or a count, optional `map: {sceneUuid, key}`); the actor's `classification` | domain actor (`domains/data/domain-data.mjs`) | GM (sheet) | **not drawn**; no writer fills `map` yet (`docs/domains/ROADMAP.md`, "Territory on the map") |
| Hex stock | What lairs and finds are here? | JJ Ch5 Step 7D; JJ Ch2 lairs per hex | regional hex | regional hex | scene flag `hexStock.<key>` (`formation/hex-stock-run.mjs`) | GM | not drawn (a per-hex Region overlay was rejected, `docs/formation/ROADMAP.md`) |
| Market reach | How far does a market's trade carry? | JJ Ch6 Step 7E "Range of Trade" (JJ p. 205) | per market class, by road and by water, measured along the route | **not built** | the market class is the location actor's `marketClass` (and a domain holding's) | — | — |

## 2. Context: the other channels already on the map

Not hex attributes, but they claim drawing channels a new layer must not
reuse.

| Channel | Layers on it | Drawn |
|---|---|---|
| Lines | roads (Wall flag `road`), rivers and coasts (Wall flag `water`), declared hex routes | own GM overlay, `road-markers.mjs`, while the Judge works the map |
| Areas with behaviour | encounter zones, districts, trap zones, location scene links | core Region hatch fill |
| Points | places (location actors' tokens), incident and terrain Notes | tokens; core Note pins |

## 3. Findings

**F1 — Core Regions have one look, so only one layer can own it.** A v14
Region draws a hatched fill tinted by its colour at a fixed alpha, and its
border only when hovered, controlled or highlighted (core `Region#_refreshState`).
A hex painted on all three layers carries three hatched fills; the GM sees
them blended. A border-only look is not available from core: it needs a
module overlay (the `road-markers.mjs` pattern). That reverses the 2026-08-28
rejection of "a PIXI overlay of our own"; what that ruling did not know is that
one layer would become three, plus domains. Counter-argument (moderate): an
overlay is a second renderer to keep in step with the Regions it reads; the
core-only alternative is territory and climate Regions at
`REGION_VISIBILITY.LAYER`, shown only on the Regions control, which clears play
but leaves editing as blended as now.

**F2 — Climate is painted at a finer grain than the book keys it.** The book
rolls weather per weather hex, the larger of its two hex scales, from that
hex's climate; the module paints climate per regional hex *and* already holds a map-wide default
(`sceneCountry().climate`, the Battlemap window's climate select). The owner's
ruling ("weather becomes a map global setting") is therefore a removal: the
climate paint layer goes, and `countryAt` answers climate from the scene
alone. Costs: climate Regions already painted in worlds stay in the Regions
tab, inert; the party sheet's climate card loses its paint chip
(`COUNTRY_CARDS` in `formation-view.mjs`) and its label and colour must stop
going through the layer registry; a map spanning several climates (a
continent mapped in weather hexes) has one answer. Counter-argument
(moderate): the book's own fast-travel note expects climate to change between
weather hexes,
which only a continent-scale map shows — a regional sandbox sits in one
climate. This reverses part of 2026-10-15 (nine days old); its entry names
the overlap as the new evidence.

**F3 — Territory and domain answer one rules question twice.** A hex's class
is its domain's class (RR §VIII.3), and the module already encodes that: a
domain actor carries `classification`, drawn from `TERRITORY_KEYS` minus
`unsettled` (`domains/constants.mjs`). Once the planned domain layer paints a
domain's hexes, a hex's territory is derivable, and the territory paint
becomes a second source that can disagree with the domain sheet.
Counter-argument (strong): JJ Ch6 Step 9 leaves existing realms' classes to
the Judge's judgement, a Judge rarely builds a domain actor for every NPC
realm on the map, and sea hexes take a class with no domain at all — so a
derive-only rule leaves most of a sandbox unanswerable. Either way, territory
and domain borders mostly fall on the same hex edges, so the visual scheme
must let one edge carry both.

**F4 — Market reach is not built, and needs its values imported.** The
market class is stored (`location-data.mjs` `marketClass`, 1–6, read by
henchmen availability and the markets engine); no code computes an area
around a market (`location/here.mjs` rejects a radius on purpose, for
footprints). The book's reach is a per-class distance, by road and by water,
measured along the route, so the honest shape is a reach over the road and
water lines (`roadDistance` already walks the road graph), not a circle. The
table is listed in the JJ manifest but no register or cookbook entry emits it,
so the reach depends on the importer emitting it first. Trade routes are
deferred in `docs/markets/ROADMAP.md`. A second, different "reach" exists:
the civilized and borderlands distances from a city or large town that
classify a newly established domain (RR §VIII.3) — crow-flies, cities and
large towns only.

**F5 — The brush paints through its palette (inferred, cause pinned in
code).** PIXI 7.4.3 binds `pointermove` on `document` and `pointerdown` on the
canvas element alone (`@pixi/events` `EventSystem#addEvents`). The catcher is
full-screen, so a swatch click with a pixel of travel, a palette drag, or a
stroke dragged over any window arrives as a move with the button held and
paints the hex under the window. Live check: log `ev.nativeEvent.target` in
`#paintAt` while clicking a swatch. Fix: paint on move only inside a stroke
the catcher's own `pointerdown` opened, and only while the event's target is
the board canvas. Independent of every ruling below.

## 4. Proposed scheme: one drawing channel per layer

| Layer | Channel | Seen by |
|---|---|---|
| Terrain | core Region fill (unchanged) | everyone |
| Territory | a band of the class colour just inside each hex edge where the class changes (module overlay) | GM |
| Domain | a line on the hex edge itself, coloured per domain, heavier per realm tier (module overlay) | GM; players' own domain an open question |
| Market reach | a dashed outline of the reach, per market (module overlay) | GM |
| Roads, water | lines (unchanged) | GM overlay |
| Climate | no map drawing; the scene setting, shown in the Battlemap window and the party sheet | — |

Territory and domain then share an edge without colliding: the outer line
says whose land, the inner band how settled. Territory and climate Regions
stay the data store and drop to `REGION_VISIBILITY.LAYER`, so core draws them
only on the Regions control. The `registerPaintLayer` registry gains the
layer's drawing style (`fill` or `border`), so the domain layer chooses its
own without battlemap naming it.

## 5. Open rulings

Answer each with its letter, e.g. "Q1 a, Q2 a, Q3 yes, Q4 a, Q5 a".

- **Q1 — Where does a hex's territory come from?**
  (a) the domain it is painted into, with a territory paint as the Judge's
  override for land no domain actor holds and for sea hexes;
  (b) territory stays painted on its own, independent of domains;
  (c) the domain alone; a hex in no domain reads unsettled.
- **Q2 — Which reach is a market's "sphere of influence"?**
  (a) its Range of Trade, along roads and navigable water;
  (b) the civilized and borderlands distances around a city or large town;
  (c) both, as separate outlines.
- **Q3 — "Permanent markets at class 6 and above"**: every placed location
  with a market class, Class VI through Class I — yes, or name the cut.
- **Q4 — When do the GM overlays draw?**
  (a) while the Judge works the map (the Battlemap tools or the Regions
  control), each layer with a show/hide toggle in the brush palette;
  (b) always, for a GM.
- **Q5 — Climate Regions already painted in worlds:**
  (a) fold the most-painted climate into the scene setting where the scene
  has none, and leave the Regions inert for the Judge to delete;
  (b) as (a), then delete them;
  (c) leave them untouched.
