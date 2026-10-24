# Map layers — what ACKS tracks, what the module tracks, how to keep them apart

In-flight audit (2026-10-24), opened by the owner's report on the country
brush: the brush paints through its own palette, the paint layers overlap,
territory should read as a border colour over the terrain fill, climate
should become a map-wide setting, markets should show their reach, and
domains are a further layer to keep visually apart. A second request asked
for the UI lessons of Paradox's grand strategy maps and of Hexographer, and
weighed an embedded external tool that syncs both ways. When the work lands, its
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

## 4. What the reference tools do

**Paradox (EU4, CK3, Victoria 3).** The map never shows every layer at once.
A **map mode** picks which layer owns the fill; the rest stay out of the way.
What carries over:

- **One fill per mode, chosen by button or hotkey.** EU4 groups its modes in
  four tabs and binds them to the top keyboard row; pressing a key again
  cycles the modes bound to it.
- **Stripes mean "a second answer here".** EU4 stripes a province whose
  controller is not its owner, cores and claims outside a border, a religion
  that differs from its owner's. It is the channel for a hex whose value
  disagrees with the value it would otherwise inherit.
- **Checkered means "out of range".** EU4's trade mode colours each province
  by its trade node and checkers the ones outside the country's trade range;
  hovering gives the effective distance. That is the closest published pattern
  to a market's reach.
- **The hover card reads every layer.** A province tooltip answers what the
  active mode does not show, so no layer needs to be drawn just to be known.
- **A legend per mode**, with a value scale where the mode is graded.
- **Zoom changes the detail.** CK3's realm mode shows independent realms far
  out, a liege's vassals in the middle and terrain close in; vassal borders
  appear when a realm is selected. (The exact CK3 border and shading
  conventions were not confirmed from a primary source.)

**Hexographer and Worldographer.**

- **Categories with show/hide.** Hexographer tags text and lines as
  political, natural or infrastructure and toggles each category like a
  layer, so a copy of the map can be saved with no political markings: a
  player handout.
- **Layer opacity.** Worldographer 2025 adds per-layer transparency in its
  Layers toolbox.
- **Border or fill is the user's choice.** Its nation generator asks whether
  borders are one colour or varied, and whether the area is filled
  translucently or not.
- **Map levels.** World, continent and kingdom levels live in one file, and a
  change on one can update the others. That is an answer to F2's
  counter-argument (climate read from the continent level above a regional
  map), kept for later; the owner's ruling makes climate map-wide now.
- **Brush ergonomics**: flood fill, brush sizes over several hexes, an
  eraser. The country brush paints one hex at a time.

## 5. Proposed scheme: map modes over one data store

The Regions stay the data store for every painted layer; core draws only the
terrain fill (territory Regions drop to `REGION_VISIBILITY.LAYER`, shown only
on the Regions control). A module overlay draws the GM's modes. The brush
palette's layer pills become the mode switch, and painting a layer shows its
mode.

| Mode | Fill (overlay over the terrain) | Lines | Stripes / checker |
|---|---|---|---|
| Terrain (rest state) | the core terrain fill alone | domain borders, thin | — |
| Territory | class colour per hex | domain borders | stripes where a Judge's territory differs from the domain's class (Q1 a) |
| Domains | colour per domain; a vassal a shade of its liege's | border weight by realm tier; domain names across their land | stripes on hexes a domain's record holds that the map has not painted |
| Markets | colour of the market whose reach covers the hex | roads and water | checkered outside every reach |

Every mode gets the hover card (`countryAt` already returns each key's value
and its `source`), a legend, an opacity slider, and a "handout" toggle that
hides every GM overlay. Climate is not a mode: it is the scene's setting,
shown as a chip in the legend. Players see the terrain mode only. The
`registerPaintLayer` registry gains the mode a layer draws in, so the domain
layer brings its own without battlemap naming it.

## 6. An embedded external tool

The owner accepts a dedicated external tool if it syncs both ways. What two-way
sync needs here: the tool addresses hexes in a way that maps onto the offset
keys; it models territory, domains with a hierarchy, and markets; it runs in
the browser beside Foundry, or offers an API or a file the module can read and
write; and its licence lets the module ship or call it.

| Tool | Runs | Hex-native | Political model | Data | Licence | Sync available |
|---|---|---|---|---|---|---|
| Worldographer 2025 (Inkwell Ideas) | desktop, Java | yes | nation borders, labels, map levels | `.wxx`; gzip-compressed UTF-16 XML, inferred from the Apache-2.0 Go reader `mdhender/wxconv` (v1.73), not from a published spec | paid, closed | file round trip only; live needs a local companion process watching the file |
| Hexfriend | browser (Svelte, PIXI) | yes | none: lines, fills, text, icons | its own JSON | GPL-2.0 | self-hosted fork in an iframe with a message bridge; GPL terms reach what bundles it |
| Azgaar's Fantasy Map Generator | browser | no: Voronoi cells | states, provinces, burgs, routes, cultures | `.map`, full JSON export | MIT | one way today (the `azgaar-foundry` module imports journals); cell-to-hex resampling loses data both ways |
| Lidarion Hexmap Studio | inside Foundry 14 | yes | Regions as solid territory overlays, Locations hatched | not documented | not stated; Patreon | none documented |

**Finding: no candidate offers live two-way sync with hex identity.**
Worldographer is the only hex-native tool with a political model, and its
sync is a file round trip keyed by column and row. Recommendation: build the
map modes in Foundry, where the hex key, the domain actors and the imported
values already live, and treat a Worldographer import and export as a
separate, optional piece if the owner maps there. Counter-argument (moderate):
Worldographer's painting tools (art, labels, flood fill, map levels) took
years to build and a Foundry brush will trail them; the cost of the external
route is a sync seam with two sources of truth and a paid, closed dependency
whose format is reverse-engineered.

## 7. Open rulings

Answer each with its letter, e.g. "Q1 a, Q2 a, Q3 yes, Q4 a, Q5 a, Q6 a".

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
- **Q4 — When does a GM map mode show?**
  (a) the mode picked in the palette stays on until the Judge returns to
  Terrain, through every control, with the handout toggle to hide it;
  (b) only while the Judge works the map (the Battlemap tools or the Regions
  control), as the road overlay does now.
- **Q5 — Climate Regions already painted in worlds:**
  (a) fold the most-painted climate into the scene setting where the scene
  has none, and leave the Regions inert for the Judge to delete;
  (b) as (a), then delete them;
  (c) leave them untouched.
- **Q6 — The external tool:**
  (a) none; build the map modes in Foundry;
  (b) as (a), plus a Worldographer `.wxx` import and export later;
  (c) a tool you already use — name it.

## Sources

- EU4 map modes: <https://eu4.paradoxwikis.com/Map_modes>
- CK3 map modes and vassal borders (community answers): <https://steamcommunity.com/app/1158310/discussions/0/3004423845035930917>
- Victoria 3 map lenses (news coverage): <https://www.altchar.com/game-news/there-will-be-at-least-5-map-modes-in-victoria-3-a8dSi0K54DdL>
- Hexographer categories with show/hide: <https://inkwellideas.com/2009/05/hexographer-free-hex-mapping-program-gets-more-updates/>
- Worldographer map levels: <https://inkwellideas.com/2016/07/hexographer-2s-map-levels/>
- Worldographer nation borders, fill: <https://inkwellideas.com/2021/01/worldographer-update-released/>
- Worldographer 2025 layer opacity: <https://worldographer-2025.backerkit.com/hosted_preorders/project_updates>
- `.wxx` reader: <https://pkg.go.dev/github.com/mdhender/wxconv/adapters>
- Hexfriend: <https://github.com/Aidymouse/Hexfriend>
- Azgaar FMG: <https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Quick-Start-Tutorial>; Foundry importer: <https://github.com/Ethck/azgaar-foundry>
- Lidarion Hexmap Studio: <https://foundryvtt.com/packages/lidarion-hexmaps>
