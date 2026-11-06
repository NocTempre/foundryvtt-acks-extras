---
name: acks-printed-value
description: Move a printed value out of acks-extras source and onto the importer — a figure off the page (a modifier, rate, price, band edge, ladder rung, day length) that code reads as a literal, a constant or a frozen table. Use when a session finds one, when a ROADMAP "printed values in code" row is picked up, when a comment claims a table is "not book data" and that needs checking, or when a feature needs a number only the book prints. Not for importing names, prose or whole entries (docs/importer/RECIPES.md), and not for looking a rule up (rules-lookup.md, shelf-extract).
---

The rule is `.claude/rules/ip-doctrine.md`, "A printed value found in source is
fixed by the work that finds it". This skill routes the work and says what
done is; the file headers it names are the reference for how, and nothing
here restates them. Paths are `foundryvtt-acks-extras`', where the importer
and the registry live. A printed value found in another repo still moves; how
it reaches that repo, where no route exists yet, is the owner's call.

## 1. Before touching it

- **Whose file is it?** A file another session has in flight gets the finding
  sent to that session, not an edit (doctrine).
- **Read the consumer and what it stands on.** The read must hand the consumer
  exactly the shape it uses, or nothing. Follow what the figure multiplies or
  looks up: a base table nothing produces (a `WAIVERS` row in
  `tools/validate-producers.mjs`) means the figure is already empty in every
  world, and moving it alone changes nothing a Judge can see.
- **Find every copy.** The same figure often ships twice: a second table in
  another feature, a lang label that prints the magnitude, a comment that
  spells it out. Search `scripts/`, `templates/` and `lang/` by the
  constant's name and by the role the figure plays. Copies in append-only
  history (`DECISIONS.md`, `CHANGELOG.md`) are the owner's call.
- **Confirm the figure against the page**, cheapest source first
  (`rules-lookup.md`; `shelf-extract` where the shelf has to be read). What
  you learn stays local: the number never enters a commit, a test, a comment,
  a commit message or a report. Quote agreement as counts ("5 of 5").

## 2. Route by how the page prints it

Every read is a recipe in `TABLE_RECIPES` (`scripts/importer/table-recipes.mjs`
header) or a register `values` spec. Reuse the shape a sibling already reads
the same kind of thing with; `table-extract.mjs` holds the cell patterns and
the `take` kinds.

| The page prints it as | Read it with | Model and test |
| --- | --- | --- |
| a 2d6 result column: bands of a roll, each naming an outcome | `proseValues`, `take: "bandEdges"` | the `monsterMorale`, `hirelingObedience` and `hiringOffer` recipes, read through `printedBands` (`scripts/influence/printed.mjs`); its cases in `tools/test-influence.mjs` |
| one figure inside a sentence | `proseValues` with the `take` for its shape (`signed`, `signedInt`, `wagePeriod`, `quantity`, …), read straight into the raw table | `baseLoyalty`, `apparentLevel`, `signingBonus`; `test-prose-values.mjs` |
| several figures in sentences that only make sense assembled | `proseValues` windows (`take: "window"`) plus a binding that assembles the engine table and exports `PRODUCES` | `light-binding.mjs`, `voyages-binding.mjs`, `produces.mjs`; `tools/test-light-binding.mjs` |
| cells in labelled rows and columns | `gridRows` | `tools/importer/test-grid-rows.mjs` |
| a thing's own passage stating what it is (a weight, an armour class) | a `values` spec on its register entry | `docs/importer/COOKBOOK.md`, "`values`" |

- A new binding runs only once it is listed in `SIMPLE_BINDINGS`
  (`scripts/importer/module.mjs`); a document with its own wiring there needs
  none.
- An engine table cites every page of the raw tables it reads
  (`produces.mjs` `assembledDoc`), so a figure on one page of a many-page raw
  table gets a recipe of its own if its tooltip is to name that page.
- The read lands as a ruledata document in the layered registry
  (`scripts/lib/tables.mjs` header, `docs/lib/API.md` "`tables`"). The
  consumer declares every table it reads with `expectTables`, which
  `validate-extra.mjs` holds it to.

## 3. Done is all of these

1. **The importer reads it** from the seat's own book at import. Source holds
   anchors, geometry and label patterns, never the figure. A window that does
   not read costs its own figure and nothing beside it; a register `values`
   spec is all-or-nothing.
2. **A Judge can edit it.** A registry table has this already: the Ruledata
   Browser's override layer (`scripts/location/ruledata-browser.mjs`). A value
   outside the registry needs the feature's own form.
3. **Nothing imported, nothing shown.** The surface says "not imported" (a
   lang key) and shows no figure in its place. The consumer answers null, and
   so does every figure derived from it; nothing falls back to the old
   literal, and no zero stands in for a missing price.
4. **Its tooltip says where it came from** (`ui-tooltips.md`), in one of three
   states: the page `citeOf` names, the Judge's override, or not imported.
5. **Every copy is gone**: each literal, its sample row, each label and
   comment that restated it. The page reference stays (doctrine, "What a
   citation does not do"). Removing an exported constant is an API change: the
   module's `apiVersion` moves, and the release kind follows the repo's
   precedent (`acks-release`).
6. **Tests, offline.**
   - Removing the literal breaks every test that asserted it, and that
     failure is correct. Each such test registers its own ruledata with
     INVENTED figures, on the model test of its route (table above). A real
     figure sits only in the gitignored `tools/rules-tests/`.
   - `test-recipe-pages.mjs` checks every recipe's folio on its own.
     `test-recipe-content.mjs` checks shape only for the tables in its
     `TABLES` list, so a new recipe is added there. Both skip without the
     books and never assert a value.
   - Where the WIKI-SNAPSHOT covers the book, the read is checked against it
     and the result quoted as counts.
   - `npm run validate` stays green, `validate-producers.mjs` included.
7. **Live** (`live-testing.md`), on a GM seat with the book connected: the
   import reads the figure and the consumer acts on it; with the table absent
   the surface says not imported; an override set in the Ruledata Browser
   wins and reverts. The walk goes into the feature's `TESTING.md`.
8. **Docs** (`docs-doctrine.md`): the feature's `MODEL.md` says what it reads,
   from which page, and what it does without it; `docs/importer/MODEL.md`
   gains a line where the read is a new kind; the ROADMAP row is deleted in
   the same commit. A `DECISIONS.md` entry only where something was ruled.
   The commit message carries counts and page references, no values.

## When it cannot be done as written

- **The page prints no figure for a case the code covered.** That case
  answers null and the surface says so; the gap is reported, never filled
  with a default.
- **No page prints the number at all.** Whether it is structural or printed
  is a doctrine call, and it goes to the owner with the search that was made.
  It is never delegated (`delegation.md`, Tier C).
- **The figure rests on a base nothing imports.** Moving the figure is still
  the work; whether the base moves in the same change is the owner's call,
  put with what the base is and where it is printed.
- **The read cannot be made reliable on this machine's printing.** Both
  ways out cost something: the doctrine forbids leaving the literal on a
  ledger row, and pulling it leaves a working surface saying not imported
  until a Judge fills the declared table's placeholder by hand. That is the
  owner's call; take it to them with what the attempt found.
