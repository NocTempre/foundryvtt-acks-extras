# Exploration formations — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md); unbuilt work is
[ROADMAP.md](ROADMAP.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### Save keys track the RELEASED system, never the dev branch

`breath` is correct for acks 14.0.1: a fresh character's schema is
`[paralysis, death, breath, implements, spell, wand]`, and `ACKS.saves.blast.long`
does not exist. The system's dev branch renames `breath` → `blast`.

**Flip the key when that lands in a system RELEASE, not before.** The modules
target the released system and the test world runs it, so tracking the dev branch
would break every world that is not running it.

---

### A party actor holds almost no data

The formation record holds the state; the party actor exists so the party can
have a token. Its schema is the compatibility stub every non-character sub-type
needs, so the acks system's unguarded per-actor compute (`isNew`, `thac0`,
initiative, movement, `saves.implements|wand`) does not error on it. That stub has
one home: the lib subsystem's `acksCompatStubs()`.

**A party does not save; its members do.** The six saves the party actor used to
carry were never read — `rollPartySave` reads each member's own — so folding to
the canonical stub drops them.

Movement is re-declared for two party-specific reasons the shared stub cannot
carry: `base` defaults to a human's 120 (synced from members on the first
formation sync), where the stub's 0 is right for a settlement; and `value` holds
the "N'/turn (exploration)" label. `mod` is deliberately absent — the system only
reads it in `_calculateMovement`, which bails on `type !== "character"`.

---

### Every sync step is fault-isolated

The scene sync steps run in sequence, and one used to be able to abort the whole
sweep: a throw in the FIRST step (token light) meant ownership, token size, fog,
measurement and map sessions never synced at all. The caller only logs, so the
table just saw the map go dark with no error surfaced.

A failing step must cost only itself.

---

### Phantom records are pruned before anything else

A formation whose party actor has been deleted from the sidebar used to leave a
record behind, which the next "Add to party" silently re-adopted — resurrecting
the deleted actor with its stale members. Dead records are now dropped first, at
ready on the primary GM, before environments are synced.

A fresh formation (a hand-created Party Formation actor with no token placed yet)
is still adopted rather than spawning a duplicate — but only while its actor
exists.

---

### Party rolls post one GM card, not per-member public cards

A party check resolves every member, which as public per-member cards is a wall
of chat nobody reads. One compact GM-whispered card carries the whole result.
The GM can overturn what the automation decided, so the card has to be theirs.

---

### The ladders come from the GM's own book (2026-07-19)

This feature ships no skill ladder. Every number resolves from the world's
imported copy of a skill, by way of acks-importer:

1. an explicit `thiefSkill` flag names the skill to scale as — the GM's binding,
   so it is consulted first;
2. otherwise the ladder the item itself carries, resolved at the owner's factored
   level, which covers every imported skill with no setup;
3. otherwise the item's cookbook identity names its skill, so a copy tagged by
   hand still borrows the real one.

Anything else returns null and the caller falls back to the sheet's roll target.

**Attunement to Nature is +4 with Listening, not +2** — verified against JJ p.311
and authored into the acks-importer register on 2026-07-19. It is deliberately not
an alias of Alertness precisely because the value differs.

A binding the world can no longer resolve still lists itself, so the GM sees
their own choice rather than a silently blank select.

- **2026-08-03 — A detached member is leashed to one round, not given its own
  clock.** Sending a scout out raises "whose movement spends dungeon turns?".
  Rejected: measuring the furthest mover each tick, and summing every
  detachment's movement — both rework the turn engine, and both let a scout
  range far enough that the party's position becomes a fiction. Ruled instead
  that a detached member may not get more than one round's movement from where
  they stood when the party token last moved. The party token stays the sole
  clock driver (`onPartyTokenMoved` is untouched), because a scout can never
  get more than a tenth of a turn ahead.
  - Implemented as a DISTANCE from an anchor rather than a spent budget:
    stateless per move, evaluable on any client, and pacing inside the circle
    costs nothing because it gains nothing. Party movement re-anchors everyone
    detached — that reset *is* "caught up or passed".
  - Enforced for players, warn-only for GMs, matching the module's existing
    trust model. Combat clears `detached` outright so a fight is never leashed.
  - Deploy/recall were extracted from `combat-bridge.mjs` into
    `deployment.mjs` so the combat path and the detach path cannot drift; the
    two identical `announce` copies (combat-bridge, map-items) collapsed into
    `announce.mjs` at the same time rather than becoming three.

- **2026-08-03 — Judge actions supply gear instead of refusing it.** The gear and
  free-hand gates on lighting a source were written against a player claiming a
  torch they never bought. Applied to a GM they inverted: assigning the light was
  the Judge *changing* the fact the gate was quoting back at them. Ruled that a
  GM action carries an **override** — the gear appears, a hand is emptied, and
  the action proceeds — while a player declaration stays gated exactly as before.
  - Authority is the **declaring** user's, never the executing client's. Player
    declarations are relayed to and run on a GM client, so `game.user.isGM` there
    would have handed the override to the whole table.
  - The override never blocks. Where it cannot finish (no such item in the world,
    or hands full of lit torches that sheathing cannot free) it warns and lets
    the action through. Rejected: falling back to the old refusal, which is a
    Judge being told "no" in a smaller voice.
  - The two mutations live in the equipment feature (`grantGear`, `clearHands`) because
    both are equipment facts; this feature keeps only the rule about what a
    light or a role *needs*. Missing the equipment feature supplies nothing
    rather than throwing.

- **2026-08-03 — The mapper's kit is quill and parchment, one hand each.** RR
  p. 266 requires the mapper to have "both hands occupied" without naming what
  occupies them. Ruled the kit is a quill and parchment, and that the hand cost
  DERIVES from the kit list (`ROLE_HAND_COST` = number of pieces) rather than
  being a second constant that can disagree with it.
  - The RAW equipment list prices the quill and no writing surface, so
    **parchment is a stand-in at 1 gp / 0 stone**, matching the quill's price
    point. It is used only when the world has no item of that name to copy — a
    Judge who adds a real one gets theirs. This is the one invented figure in the
    feature and it is deliberately trivial; nothing mechanical reads it.
  - Rejected: shipping parchment in a module pack. The system already ships the
    quill, and a stand-in that only materialises when nothing better exists costs
    no pack, no `module.json` entry, and no rebuild.
  - The 10' pole's implement moved into the same `ROLE_GEAR` table, so the pole
    gate, the mapper gate, the standing warnings and the override all read one
    list. `hasPoleItem` and the two pole-specific messages went with it.

- **2026-08-03 — "Room for one more thing" is not "hands free".** `clearHands`
  first appeared to strip a fighter bare: sheathing the shield freed a hand, the
  lone sword immediately widened to a two-handed grip to fill it, and the loop
  saw no progress. A two-handed grip is ELECTIVE — it yields the moment a torch
  or a map needs the hand — so it commits nothing. Added `handsCommitted` /
  `handsSpare` alongside `handsFree`, and every "can they take up one more
  object?" test now reads `handsSpare` (`spareHands`).
  - This also fixed a standing false refusal: a swordsman with an empty off hand
    read as having no free hand and could not light a torch at all.

- **2026-08-03 — Two shipped matcher bugs, found while extending them.**
  Recorded because both had passed a green offline suite:
  - `POLE_ITEM_PATTERN` held literal **backspace bytes** where `\b` word
    boundaries were meant (`/\x08pole\x08|polearm|…/`), committed that way, so
    the 10' Pole role never recognised an item named "Pole" — only a polearm,
    spear, pike, halberd, glaive or lance.
  - A lantern's fuel pattern excluded military oil with a lookbehind
    (`(?<!military\s)\boil\b`), which cannot work: the RAW item is named "Oil,
    Military (1 pint)", with `oil` FIRST. A party's thrown-weapon oil read as
    lamp fuel and would have been burnt. Now the whole name is rejected when it
    mentions military.

---

**2026-08-11 — a missing i18n key ships as the identifier, shielded by its own
`Hint`.**

`ACKS-FORMATION.app.frontage` was absent from `lang/en.json`, so the marching
order's Frontage field was labelled `ACKS-FORMATION.APP.FRONTAGE` on screen. Its
`frontageHint` sat directly beside it in the file and was present, which is what
made the gap survive at the table: the tooltip worked, so the field behaved
correctly in every way except the one a reader sees first. Found while shooting
the v3.7.0 release snapshot — the frame is what surfaced it, not the code.

**CORRECTED 2026-08-11, same day.** This entry first said `validate` does not
check that a referenced key exists. That is wrong, and the correction matters
because the sibling `Hint` is not incidental — it is the mechanism.

`tools/validate.mjs:350` **does** fail on `missing key referenced in code`. Line
349 tolerates dynamic families, where code builds `PREFIX.${value}` and only the
prefix can be captured:

```js
if (langKeys.some((k) => k.startsWith(key))) continue;
```

It cannot tell that prefix from an exact literal reference, so a literal
`localize("…app.frontage")` passes as long as *any* defined key starts with it —
and `…app.frontageHint` did. Confirmed by experiment: delete `…app.frontage`
alone and `validate` passes clean; delete `…app.frontageHint` too and it fails on
**both**. The reference was scanned correctly all along; only the tolerance was
wrong.

**217 of 2279 keys (9.5%) are strict prefixes of a longer sibling**, so this is
not a one-off. The `foo` / `fooHint` pairing this family writes labels in makes it
systematic, and `foo` — the visible label — is always the shielded one.

Closing it belongs in `tools/validate.mjs`, which is **synced from
acks-module-template and never hand-edited here** — so the fix is recorded in
[ROADMAP.md](ROADMAP.md) rather than made in this repo. Two hits in a one-off
scan were genuine non-problems and should stay excluded: prefix roots Foundry
expands itself (`LOCALIZATION_PREFIXES` on the encounter-zone data model, the
henchmen location sheet's `labelPrefix`).

---

### 2026-08-15 — A marching block's heading is the token's rotation, and south is zero

`formationOffset` laid every block out to the right and down, so the column
trailed south-east whichever way the party was walking. The fix rotates the
offsets, and the heading comes from the party token's `rotation` rather than a
new field on the formation record: core writes that field itself on every drag
and keyboard step (`tokenAutoRotate`, default on), so it already answers the
question, and a stored copy would immediately disagree with it.

Rejected: storing a `heading` on the formation and offering a compass control.
It buys a party that faces one way while its token faces another, and a second
thing to keep in sync for no rule that asks for one.

**What it cost.** Foundry's rotation is zero at *south*, so the default heading
is south — not the north the old right-and-down layout implicitly assumed. A
party whose token has never been turned now deploys its column upward rather
than downward. Taking north as the default instead was rejected: it would mean a
token reading `rotation: 0` and a formation with no token on a scene at all
disagreeing about where the block goes, and zero is the only value both can be
read from. Marching north is otherwise unchanged — it reproduces the historic
offsets exactly, which `tools/test-formation-heading.mjs` pins.

Diagonal rotations snap to the nearest cardinal. The grid has four directions to
lay a rank against, and a half-square diagonal block would need the offsets to
stop being whole numbers to buy nothing.

---

### 2026-08-15 — A saved marching order restores an arrangement, not a roster

Saved orders record order, roles and frontage and nothing else. Rejected:
capturing member records wholesale (token snapshots, lights, the clock). That
would make "load the standing order" a way to resurrect a dead man's hit points
from a week-old save, and the failure would be silent.

Three reconciliation rulings, all forced by the fact that the party an order is
applied to is never the party it was saved from:

- **A named member who has left is dropped and the line closes up**, rather than
  leaving a blank in their square. Preserving the geometry was the alternative
  and it is defensible — the fighter really was front-left — but it marches the
  party with phantom gaps nobody asked for and which the Judge then has to clear
  by hand. The count is reported instead, so the absence is stated rather than
  implied.
- **A member the order never knew about is appended, keeping their current
  roles.** An arrangement that silently discharged the henchman hired since it
  was saved would be a roster edit disguised as a layout.
- **A role is refused when its gear is gone**, on `toggleRole`'s own rule.
  Restoring a mapper who has lost their quill would write a state the feature's
  own rules call impossible, and it would be written by a path that never asked.

Named **marching order**, not template: `lib/template-logic.mjs` already owns
"template" for the Monster Manual's stat-by-rank pages, and one vocabulary per
concept is cheaper than telling two apart forever.

**What it cost.** Forming up is refused during a combat, so a Judge who wants
the party gathered mid-fight must end the combat first — the same refusal
`toggleDetachMember` already makes, and for the same reason: recalling a fighter
would take them out of the initiative they are in.

---

### 2026-08-15 — Jumping is a distance, not a throw, so it is not an obstacle

Checked against the wiki snapshot (ch. 6, *Jumping and Leaping*) before deciding
where it belonged. Every row of `OBSTACLES` carries an Adventuring target, a
per-100' cadence, a failure cost, a botch row and a vulnerable-in-combat flag.
Jumping has none of the five. Crossing a chasm is not rolled for at all: the
jumper has a distance (DEX + 1d6, less a foot per stone, halved without a 20'
run-up), the gap has a width, and if the number reaches, an ordinary jump onto
solid ground is simply made.

Adding it to the table would have meant six null columns and a primary output —
a distance rather than a target number — that no other row produces. So it is
its own derivation beside `swimming.mjs`, on that file's precedent.

Rejected: rolling the 1d6 and reporting one distance. The die is inside the
distance, so a single roll answers "could he have made it" for one attempt and
tells a Judge nothing about whether to allow the attempt. `canClear` reports the
range and how many of the six faces clear the gap, which is the question actually
being asked at the table.

Rejected: prompting for a saving throw on every jump. RAW the landing save is
owed only for a precarious destination or a jump made charging into melee, and
asking for one otherwise would invent a check the rules do not have.

**What it cost.** Two readings had to be fixed where the text is silent, and
both are marked in the code. The printed 1' minimum attaches to the leap's base
formula, so encumbrance can take a character below it — but the result is
clamped at zero, because a negative maximum jump is arithmetic left over rather
than a measurement. And the creature multiplier (running speed / 120) is applied
last, after encumbrance and the standing-jump halving; the book's only worked
example, the medium horse, carries nothing and so does not disambiguate the
order. That example is pinned in `tools/test-jumping.mjs`.

---

### 2026-08-15 — Jumping holds no printed value that already has an owner

Amends the entry above, which shipped with two tables it had no business
holding: the attribute bonus bands (including the jumping rule's own extension
to 19–24) and the Acrobatics numbers (a cap of 24, +2 on the landing save).

Both are book content, and both already have an owner. The attribute modifier is
the SYSTEM's — every sheet carries it as `system.scores.dex.mod` — so
`dexModifier` reads it and a caller holding a seat's imported extended rows
passes what they say. What Acrobatics is worth is the PROFICIENCY's, arriving
with the character's own imported ability, so `effectiveDex` takes a `dexCap`
and `landingSave` takes a `saveBonus`. `NO_ACROBATICS` is what an unimported
proficiency contributes: nothing, rather than a guess.

This is the same ruling the thief skill ladders got when they left
`constants.mjs` for the GM's own book. Jumping knows the SHAPE of the rules —
that a proficiency raises the score, that a cap exists, that the landing is a
Paralysis save — because that shape is the jumping rule itself. It does not know
the numbers.

**What it cost.** A world whose Acrobatics was never imported now applies no cap
and no save bonus, so an acrobat's score can exceed what the book allows. That is
the right failure: a ceiling invented here would be a printed number with no book
behind it, and it would silently shorten every acrobat's jump in worlds that
never asked for it.

One bug fell out of the change and is worth naming, because the shape recurs
across this repo's option bags: `Number(null)` is **zero, not NaN**, so a plain
`Number.isFinite` test reads every absent option as a supplied zero — capping an
uncapped score at 0 and answering every modifier with 0. `given()` distinguishes
"not supplied" from "supplied as zero"; both are meaningful here and they are
not the same.
