# Classes — decisions

Dated, append-only. How it works now is [MODEL.md](MODEL.md); what is not
built is [ROADMAP.md](ROADMAP.md).

## 2026-08-05 — Class is an Item sub-type; the constructor is the only editor

Ruled: classes are `acks-extras.class` Items (module sub-type), owned by
extras; acks-importer materializes INTO this model and the dependency edge
stays one-directional. Rejected: a JournalEntry+flags blob (no typed fields,
no validation), an Actor sub-type (token/sheet semantics a class does not
have), extending the system's free-text `details.class` alone (nothing to
hold tables). Imported and hand-made classes share one sheet deliberately —
review-and-tweak and homebrew are the same workflow (user ruling: editable
constructor from v1, composition-first over primitives).

## 2026-08-05 — The JJ custom-class builder informs the model, and is not automated

The Judges Journal's custom-class rules are how the printed spreads are
arranged under the hood — every class is category progressions (the four
chassis) plus trade-offs. That arrangement is why `saveChassis` /
`attackChassis` are the model's borrowing primitive. Ruled (user): the
builder itself is NOT automated — no build-point validation, no XP-cost
derivation; the document stores what the RR spread prints and the UI stays
RR-spread-simple.

## 2026-08-05 — Inventory accepts; it does not offer

Ruled (user): the constructor's inventory lists accept drops (and typed
refs). No catalogue picker of world abilities is offered by the sheet.

## 2026-08-05 — Book vocabulary in the document, released keys at the write

Save bands store `blast`/`spells` as printed. The one book→released mapping
(`blast`→`breath`, `spells`→`spell`, `wand` never written) lives in
lib/actor-compat.mjs `savesUpdateData`; extras also owns the repair pass for
dangling save-key references (user ruling). When the system releases its
breath→blast rename, that file is the single place that changes.

## 2026-08-05 — Level-up HP is RAW: reroll the full HD, minimum +1

Ruled (user): on gaining a level the full Hit Dice are rerolled and the new
maximum is at least one higher than the old; past 9th the printed flat bonus
applies with no CON adjustment. An additive-die house rule may be offered as
a setting, never as the default. (Consumed by the level-up wizard — ROADMAP.)

## 2026-08-05 — Casting is a typed framework from the start

Ruled (user): nothing deferred — the casting schema carries kind-typed
traditions (vancian, points, ritual, ceremonial, gnosis) and per-tradition
pools now, so By This Axe gnosis and Heroic Fantasy ceremonial content
materialize into the same fields; the Nobiran's dual pools are tracked fully
(implementation lands with the casting framework phase, on this schema).
