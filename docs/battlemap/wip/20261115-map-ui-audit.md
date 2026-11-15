# Map tools — UI audit and the not-to-scale mark

**NOT IN EFFECT.** Inputs to Phase 3 of
[20261115-map-setup-revision.md](20261115-map-setup-revision.md), written in
`main`'s tree while that plan's branch is open. When Phase 3's work lands,
what this file holds moves into `MODEL.md`, `DECISIONS.md`, `TESTING.md` and
the bug-intake ledger, and the file is deleted in the same session.

## 1. Owner rulings made after the plan's branch opened

- **The square family's spans** (the plan's §5 Q2), 2026-11-15. Asked whether
  the one count becomes two, the owner chose: "Two numbers (recommended): “3
  across, 1 down”. Any box shape works." Slice G is in: a box on a square
  grid carries a count across and a count down, and a strip of three by one
  fits exactly.

## 2. The not-to-scale mark (slice I)

**Ruled** (owner, 2026-11-15, answering whether a mile-scale apply leaves
token auto-sizing off): "Yes, and Anything that is outside scale should get a
border (maybe a looking glass effect?) to clarify that it is not to scale."

Restated with one example: a token whose size on the map is not its footprint
at the scene's scale carries a visible frame that says so. A six-mile hex
apply leaves auto-sizing off, so a plain character stays one cell wide: a man
drawn six miles across, and he gets the frame.

What follows is an `architect`'s design from that sentence, read from the
code and not walked.

### The predicate

`footprint.mjs` gains a pure `scaleMismatch({feet, feetPerCell, width,
height, step = SPAN_STEP})`, `width` and `height` being the token's stored
size in cells. It answers null with no footprint or no usable cell. Otherwise
the exact size is `feet / feetPerCell` on each axis, unrounded, and an axis is
off when the drawn size differs from it by more than half the step the sizer
rounds to. The answer is null or `{dir: "larger" | "smaller" | "mixed",
exact}`. It never compares against `tokenSpan` or `sizeForToken`: their floor
would call the floored man right.

`token-scale.mjs` exports `footprintOf(tokenDoc, scene)`, answering
`{judged, feet, feetPerCell, source}` with `source` one of token, actor, size
or square. `resolveSize` is rebuilt on it and keeps the lock check, so
`sizeForToken` and `unsizedTokenCount` answer as they do now.

| Token | Marked | Why |
|---|---|---|
| The party token | never judged | it has no body, so no footprint |
| A marker actor's token | never judged | it is as big as the Judge drew it |
| A scene with no usable distance | never judged | no scale to compare against |
| A `footprintLock` token | judged | the lock stops writes, and the mark writes nothing |
| A gridless scene with a distance | judged | its distance still sets a scale |
| Nothing imported | no mark | the mark needs a figure, and a missing import stays blank |

### How it is drawn

A new `scripts/battlemap/scale-mark.mjs` is the mark's one owner, on hooks
alone, with no wrap of core. The precedent is the `refreshToken` listeners in
`formation/column-view.mjs` and `lib/group-encounter.mjs`. Each marked token
gets one `PIXI.Graphics` child of the token's own container (named
`acks-extras-scale-mark`, deaf to pointer events, behind the token's own
drawing), rebuilt when found destroyed, since core clears a token's children
on a redraw. Being a child, it moves with the token and hides with fog and
with a hidden token.

The look is a magnifying glass drawn as a border, which is both of the
owner's suggestions at the cost of one: a rim along the token's own shape,
clear of core's border, and a short handle from its lower right. Solid, since
core dashes a hidden token's border, and in none of the disposition colours.

The listener returns at once unless the refresh carries a size, shape, state
or visibility flag, and redraws only when its key (the token's size, the
cell's worth, the footprint, the interface scale) changes. It re-judges on a
token's or actor's footprint flags changing, on the monsters tables changing,
and on its own setting. Nothing is written to any document; each client works
it out for itself.

### Who sees it, and what it says

Every seat, always, and the handout view leaves it alone: a player judging
distance by eye is the reader a six-mile man misleads most. A client setting
turns the drawing off for that seat (Settings tab → Game Settings → ACKS II —
Extras). It has no second home in the Map modes window.

On hover, canvas text under the nameplate (the trap markers' hover text is
the precedent; the canvas has no tooltip manager) says which way the token is
off, the size it is drawn at in the scene's units, its footprint in feet, and
where the footprint comes from (set on the token, set on the actor, its size
category with the imported frontage and square and their page reference, or
the imported square alone). A seat that is neither the GM nor the token's
owner sees the first two lines only. Every figure is read from the world at
render; no rule sentence and no printed value ships.

### What it touches

`footprint.mjs`, `token-scale.mjs`, the new `scale-mark.mjs`, `module.mjs`
(installed beside `installTokenAutoScale`), `lang/en.json` under
`ACKS-BATTLEMAP.scaleMark`, and `tools/test-battlemap.mjs`, which pins the
predicate at both sides of its tolerance, the floor, an exact fit, each
direction, each axis, null inputs and a half-cell step, and `footprintOf`'s
exclusions and four sources over a made-up square. `MODEL.md` gains a
paragraph under "Token sizing — ownership", `TESTING.md` a step, `DECISIONS.md`
an entry opening with the owner's sentence, and the slice ships a changelog
fragment. Slice E's mile-scale line names the ring.

### Acceptance, from the Judge's seat

- A mile-scale hex scene, a one-cell character: the mark is drawn, its hover
  reads larger with the drawn size, the footprint and its source, and it is
  still there after a move, a resize and a change of scene and back.
- A square scene whose cell is the imported square, the same character: no
  mark. A large monster resized there: no mark; set to one cell it reads
  smaller.
- The party token on both scenes, and a marker's token: no mark.
- A player seat: marks only on tokens it can see, the two-line hover on a
  token it does not own, and a watcher on token updates records no write from
  either seat.

Fixtures, by marker: scenes `battlemap/scale-mark-hex` and
`battlemap/scale-mark-square`; tokens `battlemap/scale-mark-man` and
`battlemap/scale-mark-large`.

### Owner questions on the mark

Each default is the first answer; slice I builds the defaults unless told
otherwise.

1. Do players see the mark? **Yes** / Judge only (the handout view then hides
   it).
2. Does the party token, one cell at every scale, get the mark? **No** / Yes.
3. Can each seat turn it off? **Yes** / No switch.

### Rejected

Core's dynamic token ring (turning it on writes to the token document); a
true magnifying filter (a filter pass per token per frame); recolouring core's
border (it shows only on hover or selection); an icon-font glyph (the canvas
draws none); comparing against the sizer's own answer (its floor hides the
owner's example); a stand-in footprint where nothing is imported (a figure in
source); a field in the Map modes view (only a Judge reaches it).

### Not verified, and what to expect

Nothing was walked. Whether core holds a token's width to half cells is still
open (the schema shows no step; the plan's Phase 2 walk reads it), and the
tolerance follows `SPAN_STEP` if that changes. On a map whose cell is twice
the imported square, every one-square token nobody sized gets the ring until
it is resized. Canvas text does not follow the type-size knob, as the trap
markers' text does not.
