# Full monster stat block — decision record

Rulings through v11.14.5: [DECISIONS-through-v11.14.5.md](DECISIONS-through-v11.14.5.md).

## In force

- 2026-08-02 — [the Full Monster sheet is the DEFAULT, not an alternate](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-02 — [the animal sub-type gets it too](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-02 — [REJECTED: unregistering the system's monster sheet](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-02 — [REJECTED: a replacement character sheet](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-02 — [the base-class lookup ignores this module's own sheets](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-14 — [Defence bands adopt the shared shape; capacity answers once](DECISIONS-through-v11.14.5.md#2026-08-14--defence-bands-adopt-the-shared-shape-capacity-answers-once)
- 2026-08-19 — [SIZES frontage structured into numeric footprints](DECISIONS-through-v11.14.5.md#2026-08-19--sizes-frontage-structured-into-numeric-footprints) — superseded in part by "2026-11-11 — SIZES keeps a label and a footprint; the unread printed columns go"; "2026-11-11 — The size footprint is imported, and a category with none is left alone"
- 2026-08-28 — [The animal's fields are a tab on this sheet, not an injected panel](DECISIONS-through-v11.14.5.md#2026-08-28--the-animals-fields-are-a-tab-on-this-sheet-not-an-injected-panel)
- 2026-09-04 — [The Hit Dice rating writes core's roll formula](DECISIONS-through-v11.14.5.md#2026-09-04--the-hit-dice-rating-writes-cores-roll-formula)
- 2026-10-23 — [The monster sheet is drawn on the lib's frame](DECISIONS-through-v11.14.5.md#2026-10-23--the-monster-sheet-is-drawn-on-the-libs-frame)
- 2026-10-31 — [One encounter-line parser, and a count of units is no headcount](DECISIONS-through-v11.14.5.md#2026-10-31--one-encounter-line-parser-and-a-count-of-units-is-no-headcount)
- 2026-11-11 — [SIZES keeps a label and a footprint; the unread printed columns go](DECISIONS-through-v11.14.5.md#2026-11-11--sizes-keeps-a-label-and-a-footprint-the-unread-printed-columns-go) — superseded in part by "2026-11-11 — The size footprint is imported, and a category with none is left alone"
- 2026-11-11 — [The size footprint is imported, and a category with none is left alone](DECISIONS-through-v11.14.5.md#2026-11-11--the-size-footprint-is-imported-and-a-category-with-none-is-left-alone)

## 2026-11-14 — The body-form list is imported

**Ruled (owner).** Asked: "The monster sheet's Body form dropdown ships 40
body-form names in code, each with an example creature in brackets ("<name>
(<sample>)"), taken from the Monstrous Manual's body-form table. What should
happen to that list?" with the options "Import it (Recommended)", "Trim the
examples" and "Leave it, roadmap it", the owner answered **"Import it
(Recommended)"**. And, the same day: **"Missing imports stay blank with page
reference as a subtle clue on where they could get that info. Fields that
require imports stay blank period. How a feature behaves without imports is not
really a concern for this project as long as long as it fails in a non-breaking
way"**. (The example in the question is left out of this quotation: a printed
name is the book's, and this file ships.)

So `BODY_FORMS` is gone from `config.mjs`. The table is read from MM p. 389 into
`monsters` / `bodyForms` (MODEL, "The body forms"), the select offers what was
read, and a Judge's override replaces the list whole. With nothing imported the
select is blank and disabled and its tooltip is the page reference; no text
says "not imported". The one thing a missing import must not do is lose data, so
`bodyForm` is a plain string field, a stored key the table lacks keeps an option
of its own, and the disabled select is left out of the form data so the stored
key never meets a submit. `acksExtras.monsters.config.BODY_FORMS` goes with it,
and the lib API version moves to 43.

**Glyph locator.** The band's glyph map keeps its 32 assignments, keyed by
`printKey` of each form's key (the hash of its folded letters,
`importer/printed-name.mjs`), because the map is a second place a printed name
would ship. A glyph is looked up by hashing the key, and a form with none wears
the paw. `test-recipe-content` holds every glyph hash to a row the local book
reads, so a hash that matches nothing fails there.

**Rejected.** Trimming the examples and keeping the names: the names are the
table of options the doctrine says is registered, not shipped. A list of named
row specs in the recipe: it ships the names. Keeping a `choices` list on
`bodyForm`: validation would drop a stored key the imported table spells
differently, and one of the forty stored keys does differ from the print.

**What it cost.** A monster that stored the spelling that differs from the print
shows its key as an orphan option and no band name until the Judge picks the
printed form. A world without the Rules tables imported shows a blank Body Form.
