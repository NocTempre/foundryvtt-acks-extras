# Influence & reactions — Design Model

How this feature applies the family doctrine **reuse → extend → enhance →
invent**.

- **Reuse**: the core `acks` actor's alignment, level and proficiency data; the
  system's own Active Effect machinery.
- **Extend**: an `attitude` Item sub-type recording how one party regards
  another, and effect conventions under `flags["acks-extras"]` —
  `reaction` / `loyalty` / `morale` change keys plus their
  `situational` / `tone` / `label` metadata.

The `attitude` Item lives on the **influencer**, one per target: `targetUuid`
/ `targetName` / `targetImg`, the 0–4 reaction ladder, per-tone
(`diplomacy`/`intimidation`/`seduction`) attempt counters so a resumed
conversation picks up at the right attempt level, and notes. It is
auto-created the first time an influence roll resolves against a target and
updated thereafter, across every resolution path (visible target, hidden
target relayed through the GM, GM-as-influencer). The sheet's Notes tab
injects a row per attitude record — click to open, drag to transfer to
another actor, delete (owner-only) — and every change fires
`acksExtras.influenceAttitudeChanged`. henchmen's **slander** is the same
edge shape aimed at a location instead of a character; the two share
conventions but no store — see henchmen's DECISIONS for why.
- **Enhance**: the Influence application — one dialog that resolves a social
  roll with its whole modifier stack itemized and every situational modifier
  offered as a toggle.
- **Invent**: nothing the system provides.

## The modifier stack

Every modifier resolves from one of three sources:

- **auto** — computed from the two actors (alignment relationship, level gap,
  age, proficiencies, social rank). A source whose input is unknown returns
  nothing and is skipped, rather than being counted as zero. The social rank
  source (`socialRank`) feeds Seduction's status row with the rungs the
  character stands above the target — never below — and is read from the
  henchmen feature's facts chain through the api at call time
  (`docs/henchmen/MODEL.md` §7), so a character with no stated rank leaves
  the row untouched.
- **effect** — contributed by an Active Effect whose change key is exactly a
  member of this feature's domain set. Membership is tested exactly, not by
  prefix, because sibling features share the flag scope.
- **manual** — set by the roller.

`ctx:<key>` sources read the caller's own context bag, which is the seam an
external mode resolves against. A mode may also take its **bands** from that
bag (`bands: "ctx"`: the caller passes `ctx.bands` as `[{key, min?, max?}]`
in band order) where the column is imported per world rather than
structural — the markets feature's `marketAssessment` page is the first — and
a page opened without them warns and refuses to roll. The bribe row's fee is
priced against the target's hit dice, or against `ctx.bribeBasisHd` when the
caller sets one, for a target that has none (a market). The roll-complete
hook payload carries `bribe: {level, fee}` for a page with a bribe row, so a
consumer can charge what the page priced; an external page never moves gold
itself. `apiVersion` 9 is the first to carry all three.

On the app's own pages an armed bribe moves its fee as coin when the roll is
made, at the seat that resolves the roll: the roller's own, or the Judge's
for a target the roller's seat may not see. A target that is an actor
receives the payer's own coins (`lib.money.transferCoin`, with no reach gate:
the two are talking) wherever that seat may write it or a GM is connected to
write it for them; the lib relays the payment whole (docs/lib/MODEL.md,
"Currency"). With no target actor, or nobody to write one, the fee is paid
off-stage and the coin leaves the world (`sinkCoin`). The fee is drawn by the
payer's coin order, inside the world's standing reach.

The bribe is checked before the roll counts it. A payer who cannot cover the
fee — the coin their order reaches is worth less than it, or the seat may not
write the payer — has the tier put back to none: its modifier is not in the
total or on the card's list, the seat resolving the roll is warned, nothing is
written, and the card carries a note that the bribe was not paid. A player
rolling against a target they cannot observe is checked on their own seat as
well, before the roll is handed to the Judge's, which checks the same coin. A
tier with no fee, and a roll with no influencer, have nothing to check.

The result card states a bribe only when coin moved: the fee, who paid it,
and who received it where somebody did. An unpaid bribe is a note in the
card's notes and states no fee.

**An ability counts once per page.** One proficiency can reach the roller by
every route at once: its name fills a static `prof:` row, an Active Effect on it
speaks, and its abilities-model effects speak. So each page settles which source
speaks for an item — a static proficiency row wins over that item's effects, and
an Active Effect wins over the same item's abilities model. The claim is made
per page, because which proficiencies a page renders a row for differs by page;
an ability the page offers nowhere else keeps its own row.

A power standing in for a proficiency (`actsAs`) fills that same row, renames it
after itself, and is claimed with it. The rename lives in the config rather than
the view, so the dialog and the chat card name it identically; a character
holding both the power and the proficiency keeps the proficiency's name, because
the two are one non-stacking capability.

## Printed pages

The `morale` page (RR 307), the `obedience` page (RR 167) and the `hiring` page
(RR 162) ship their structure and no figure. `EXTERNAL_MODES` states which rows
a page has, which of them are **ladders** (rungs of one scale, of which at most
one applies), which are single **printed** figures and which are a
**printedFactor** (a figure owed once per count of something), and the names
of the page's results in band order (`bandKeys`). Each mode names the table it
reads (`printed`) and the ruledata document holding it (`printedDoc`, `morale`
when absent): the morale pages read the `morale` document, which the
importer's `morale` recipe fills, and the hiring page reads the `influence`
document's `hiringOffer`, which the `influence` recipe fills. The henchmen
feature's own hiring throw reads that same table (`docs/henchmen/MODEL.md`
§2, "The hiring figures").

A row may name a table of its own in the same two keys, and reads it in place
of the mode's. The `loyalty` page (RR 166) reads the `influence` document's
`hirelingLoyalty` for its result column, `postsWithoutBands` like the morale
pages, and its apparent-level row names a table of its own: a `printedFactor`
on `apparentLevel` (RR 168), the per-level figure. The row counts the levels
its opener hands in (`ctx.apparentLevelDiff`). Read, the count is owed that
figure each; unread, the row is a typed field. The Irrefusable Offer (MM 351)
reads `irrefusableOffer` the same way, for its result column and for its
opposite-alignment row, a `printed` figure. The henchmen feature's fallback
throws read these same tables, and the henchmen feature reads the
consequences from two more: the starting loyalties in `irrefusableOffer` and
the loyalty changes in `loyaltyChanges` (`docs/henchmen/MODEL.md` §3).

`modeRows` (`printed.mjs`) turns the declared rows into the rows the dialog
draws, against what the world holds:

| Declared | Read from the page | Not read |
|---|---|---|
| `ladder` | a choice among the rungs that were read, each worded as the Judge's page words it and falling back to its figure | a typed signed field |
| `ladder` marked `ordinal` | the same choice, read whole: its place is what a consumer prices by | a disabled select holding only the blank |
| `printed` | a tick worth the figure, shown beside the row's name | a typed signed field |
| `printedFactor` | the row's count times the figure, the figure shown beside the row's name | a typed signed field |

A ladder stores the **position** of the chosen rung, not its figure, so two
rungs that print one figure stay two options and a rung printing zero is not
the blank. A row left as a typed field carries no badge. The label of
every row names the field and cites its page; the wording of a rung is the
reader's own page and exists in no file of this repo.

The result column is the imported edges under the mode's own result names
(`printedBands`). Edges arriving in a different count than the names are some
other table, and the page then has no column. The two morale pages are
`postsWithoutBands`: with no column they still roll, and the card lists every
modifier applied, the dice and the total, and names no result. The
roll-complete payload carries `outcome: null` for such a roll. The hiring page
is not: a hire needs a result to apply, so with no column it refuses to roll
and shows no message.

**The tone pages.** The three reaction tones read the `influence` document
the same way, one table each (`TONE_PAGES` in `constants.mjs` names it and its
folio): `diplomacyModifiers` (JJ 85), `intimidationModifiers` (JJ 86),
`seductionModifiers` (JJ 87). The importer reads them from the Judge's Judges
Journal by `proseValues` recipes (anchors and column geometry, no figure), and
`toneRows` (`printed.mjs`) turns `INFLUENCE_MODIFIERS`' rows into what the
dialog draws:

| Declared | Read | Not read |
|---|---|---|
| `check` with a `figure` | a tick worth the figure, shown beside the row's name | disabled |
| `factor` with a `figure` | the row's count times the figure | disabled |
| `select` with `rungs` | a choice among the rungs that were read, by position, each worded as the page words it where the import caught one | disabled |

A disabled row contributes nothing and is never pre-filled; the page carries
no notice about it. A
proficiency box that cannot be worth anything drops its `prof:` claim, so the
item's own Active Effect still reaches the page. Every figure's row carries a
tooltip naming where the figure came from: the page the importer read it from,
the Judge's own override, or the page reference alone where nothing is
imported (`figureOrigin`).

Two things are read as structure and not as a figure: which direction a
level gap or an alignment match points (a rung's name, found by `autoRung`),
and the threshold a level gap must reach before it counts, which the page
prints as a floor and the recipe reads as a quantity
(`printedQuantity`). With the threshold unread, the gap's row fills nothing.
A row that is typed by the roller because the page prints a floor or a rate
("or more", "per favor") stays a typed `signed` field; its label names it and
cites the page, and no figure ships for it. The bribe row is a select of three
tiers (`BRIBE_RUNGS`, labelled "Tier 1" to "Tier 3") whose bonuses are the
`bribeTiers` table's (RR 287); it names that table in `table` and `cite` and is
`complete`, so it is read whole or not at all (a tier left out would renumber
the rest). What is stored is the tier's place, which the henchmen api prices
(`DECISIONS.md`, "The tone pages read their figures from the imported page");
a bribe row not imported is a disabled select, so no tier is chosen and no
fee is asked. A bribe offered by a roller holding Bribery reads one more
figure, `bribeCrime.natural` (RR 287, `bribeCrimeMark` in `actor-data.mjs`):
an unmodified roll equal to it puts a note on the card that the charge mark
was met, followed by where the figure came from (the page, the Judge's
override, or not imported). Unread, the card names no charge.

**The reaction and the ladder.** What a tone page does with its total is the
page's too. Each tone reads two more tables of the `influence` document
(`TONE_PAGES`): `<tone>Reaction`, the result column and `shift1` to `shift5`,
the count of attitudes each result moves a continuing roll by, and
`<tone>Attitude`, the modifier for a target already at a rung of the ladder
(`attitude0` hostile end to `attitude4`; the middle rung and a rung the page
prints no row for have no key and add nothing). `toneBands` and
`attitudeFigure` (`printed.mjs`) read them. The structure stays in
`INFLUENCE_RESULTS`: the five results worst first, the rung an initial reaction
sets, and the direction a continuing roll moves (the middle result moves
toward Neutral, never past it). A result column not imported, or a continuing
roll whose count for its result was not read, leaves the roll with no result
named: the card carries the total and the modifiers and no result, the
attitude stays where it was, and the attempt is not counted, so
the `acksExtras.influenceRollComplete` payload carries `band: null` and
`newAttitude` equal to `startAttitude`. A rung's tooltip names the modifier it
adds and where it was read, that the page prints none for it, or the page
reference alone where the table is not imported. The `band` of that payload is the result's position key
(`result1` to `result5`).

The Seduction page's age row counts categories between the two actors, which
the `characterAging` table (RR 19) draws: `ageCategoryIndex` takes the last
category whose first year the actor has reached, by the race the class names
(a race with no row counts as human). Not imported, the row's count is left
unfilled. The Mystic Aura's bewitching total is `mysticAura.at` (RR 115): at or
above it the card names the subject bewitched, and unread the card names
none. A power marked `bewitched` is a source, not a figure.

**Held rows.** A proficiency the hiring page and the market assessment page
offer — Diplomacy, Intimidation, Seduction, Mystic Aura — is declared `held`
and carries no figure. `resolveHeldRows` (`actor-data.mjs`) draws the box
only for a roller who holds the proficiency or a power standing in for it,
and makes it worth what the roller's own item carries for the page's roll
family: the item's Active Effect where one speaks, else the value the importer
located on its page. An item carrying neither draws a typed field with a *no
value* badge; an unaudited value is offered and never pre-ticked. A drawn box
claims its item, so the item is not offered a second time below.

**Offered rows.** An opener may hand the page effect rows of its own in
`ctx.offeredModifiers` (`offeredEffectRows`): rows from change keys this
feature does not read, such as the henchmen feature's `hiring`,
`henchmanMorale`, `obedienceRoll` and `loyaltyRoll` effects. They are the
roller's, join the page's own effect rows, and claim their item as an Active
Effect does. A note row pushed with an `itemId` (below) is left out where a
held box draws that item, so the page does not say twice that it has no value.

Neither page has an influencer. The dialog draws the subject alone, the card
speaks as the subject, and the rating the roll adds is `moraleRatingOf`: a
creature's own morale, or for a group actor its command morale — its one
stack's unit morale when it holds exactly one.

The morale page also names the subject's conditions (RR 507-515). A mode that
declares `conditions` says which roll it is in the lib's conditions model, and
a listener on the modifier hook (below) pushes what that model answers
(`condition-rows.mjs`): a figure the roll takes is a named row in the total
and on the card, and a condition the roll does not take is a note beside it —
one whose figure is bound to a circumstance the page cannot tell, and one under
which the creature makes no such roll (a condition whose figure the world has
not imported has no row). The system's own roll takes the same figures as a shift of the
score (`docs/lib/MODEL.md`), so the two paths agree and the page is the one
that shows its work. Only `morale` declares it.

Three things open the morale page: the system's own morale roll, through the
lib's `morale-roll` contract (`docs/lib/API.md`); a group actor's directory
context menu (the henchmen feature's `openMoraleViaInfluence`); and
`open(null, {mode: "morale", targetActor})`. The obedience page is opened by
the henchmen feature's `openObedienceRoll`.
`apiVersion` 10 is the first whose two morale pages read the imported table;
`apiVersion` 11 is the first whose hiring page does, with held and offered
rows.

## The modifier hook

A consumer that holds the roll passes flat rows in `options.modifiers`
(`[{label, value}]`); a consumer that only knows the party's surroundings has no
call to hold. `openInfluenceApp` therefore fires `acksExtras.influenceModifiers`
(`HOOKS.INFLUENCE_MODIFIERS` in `constants.mjs`) once, before the app is
constructed, with `{actor, targetActor, mode, modifiers}`, and every listener
pushes its own rows onto that same array. `targetActor` is the one the roller
opens with (`openingTarget`, `actor-data.mjs`): the caller's own, else the
actor of the first token the user has targeted, and never the influencer. The
opener hands the same one to the app, so the sheet's Influence button, which
names none, carries the rows about a targeted target exactly as the api call
that names it does. The two routes add; neither replaces
the other. A row arriving this way is treated as the dialog already treats an
external row: named, read-only, in the subtotal and on the posted card.

`externalRows` (`constants.mjs`) is what the roller keeps of either route, and
what a player's dialog forwards to the Judge's. A row whose value is 0 is
dropped, since it adds nothing and says nothing. The exception is a **note**: a
row pushed with `note: true` and no value is kept, drawn in the dialog with no
figure beside it, left out of the subtotal and out of the card's list of what
was added. It exists for a listener that has something to SAY about the roll and
nothing to add to it, and a row that carries a figure is never a note whatever
it was marked. A note about one item keeps that item's `itemId`.

The call is synchronous by design. A constructor throw — a bad `mode`, an
invalid actor — has to reach the caller as a real exception, because the
henchmen feature opens this app first and falls back to its own dialog on a
plain `try/catch`, which only a synchronous throw satisfies. A listener's own
throw is caught and logged, so no listener can stop the roller opening. The hook
fires once per open: a re-render reads the rows the app was constructed with
rather than asking again, so a listener is never consulted mid-roll.

A listener owns its own gate. `mode` is the external mode the roll was opened
in, or null for the bare influence roll, and `EXTERNAL_MODES[mode].family` says
which family that mode belongs to; a listener pricing a reception answers only
for the reaction family and stays silent for a mode it has never heard of. The
formation feature's district reception (`docs/formation/MODEL.md`, "The
districts") is the first listener and the shape to copy; the factions
feature's standing rows (`docs/factions/MODEL.md`, "What reads the ledger")
are the second, through the same gate (`isReactionMode` in `constants.mjs`,
which is the one place the family test lives).

## Recipes, not rules

The dialog **offers** modifiers; it does not assert them. Situational modifiers
render as toggles so the table decides what is in play, and a mechanic that has
not been read against the printed page is badged **unaudited** — amber rather
than red, because it is probably right and is genuinely offered; it is simply not
the book's ruling until somebody has checked it.

## Shared with hiring

The reaction convention is consumed by the henchmen feature's hiring throws, so
an effect that grants a reaction bonus is written once and works in both places.
This is why influence imports before henchmen in `scripts/module.mjs`.
