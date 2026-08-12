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

**2026-08-11 — a missing i18n key ships as the identifier, and nothing catches it.**

`ACKS-FORMATION.app.frontage` was absent from `lang/en.json`, so the marching
order's Frontage field was labelled `ACKS-FORMATION.APP.FRONTAGE` on screen. Its
`frontageHint` sat directly beside it in the file and was present, which is what
made the gap survive: the tooltip worked, so the field behaved correctly in every
way except the one a reader sees first. Found while shooting the v3.7.0 release
snapshot — the frame is what surfaced it, not the code.

`npm run validate` passes on this. It checks that every key in `lang/en.json` is
under a declared namespace root — the reverse direction — but not that a key a
template or script asks for actually exists. A one-off scan of every literal
`localize` / `format` argument across `templates/` and `scripts/` found this as
the only real gap; the two other hits were prefix roots (`LOCALIZATION_PREFIXES`
on the encounter-zone data model, and the henchmen location sheet's `labelPrefix`)
whose leaves all exist.

Closing that hole belongs in `tools/validate.mjs`, which is **synced from
acks-module-template and never hand-edited here** — so it is recorded in
[ROADMAP.md](ROADMAP.md) rather than fixed in this repo.
