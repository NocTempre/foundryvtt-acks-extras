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
external mode resolves against.

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

## The modifier hook

A consumer that holds the roll passes flat rows in `options.modifiers`
(`[{label, value}]`); a consumer that only knows the party's surroundings has no
call to hold. `openInfluenceApp` therefore fires `acksExtras.influenceModifiers`
(`HOOKS.INFLUENCE_MODIFIERS` in `constants.mjs`) once, before the app is
constructed, with `{actor, targetActor, mode, modifiers}`, and every listener
pushes its own rows onto that same array. The two routes add; neither replaces
the other. A row arriving this way is treated as the dialog already treats an
external row: named, read-only, in the subtotal and on the posted card.

`externalRows` (`constants.mjs`) is what the roller keeps of either route, and
what a player's dialog forwards to the Judge's. A row whose value is 0 is
dropped, since it adds nothing and says nothing. The exception is a **note**: a
row pushed with `note: true` and no value is kept, drawn in the dialog with no
figure beside it, left out of the subtotal and out of the card's list of what
was added. It exists for a listener that has something to SAY about the roll and
nothing to add to it, and a row that carries a figure is never a note whatever
it was marked.

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
