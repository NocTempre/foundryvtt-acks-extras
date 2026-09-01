# Cookbook schema v1 — the shipped, engine-agnostic database

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

Original design content (in-repo). The cookbook is the pipeline's **output
artifact**: a versioned database (plain JSON) that any engine binding can
consume. It contains **no engine vocabulary** (no Foundry types, no `system.*`
paths, no UI concepts), **no prose**, and **no values read from a page** — only
structure, pointers, and extraction assists. See `RECIPES.md` for the
pipeline that produces it and `BINDING-FOUNDRY.md` for the first consumer.

Schema id: `"acks-cookbook/2"`. A binding declares which schema versions it
consumes; the instruction set below is **frozen per schema version** — old
cookbooks must keep executing forever. v2 (2026-07-24) is v1 plus the `grid`
instruction and the `kind.monsterTemplate` entry shape (a `template` wiring
block beside `fields`); nothing in v1 changed, so the executor accepts both.

## Files

- `cookbook/<book>.json` — the entries anchored in one book.
- `cookbook/registers.json` — shared lookup tables + definition/keyword nodes.

### `cookbook/<book>.json`

```jsonc
{
  "schema": "acks-cookbook/1",
  "book": { "id": "mm", "label": "ACKS II Monstrous Manual", "short": "MM",
            "pages": 441, "titleRe": "Monstrous Manual" },   // fingerprint
  "entries": {
    "mm.griffon": {
      "kind": "kind.monster",          // register kind id (opaque to the executor)
      "name": "Griffon",               // short label
      "cite": "MM p.171",
      "pages": [171],
      "fields": { "<fieldName>": <instruction>, … }
    }
  }
}
```

### `cookbook/registers.json`

```jsonc
{
  "schema": "acks-cookbook/1",
  "tables": {                          // exact-match lookup tables (assists)
    "damageGlyph": { "": { "key": "slashing", "ref": "def.dmg.slashing" }, … },
    "damageColor": { "#ff2e17": "extraordinary", "#2c2e35": "mundane" },
    "proficiency": { "Alertness": { "key": "alertness", "ref": "def.prof.alertness" }, … },
    "creatureType": { "Monstrosity": { "key": "monstrosity", "ref": "def.type.monstrosity" }, … },
    "subtype":     { "Bestial": { "key": "bestial" } }      // keyword: no ref
  },
  "nodes": {                           // definition/keyword/note nodes
    "def.type.monstrosity": {
      "role": "definition", "name": "Monstrosity",
      "aliases": [],
      "editions": { "acks2": { "book": "mm", "pages": [12],
                               "anchor": { "runin": "Monstrosity:" } } }
    },
    "def.prof.alertness": { "role": "definition", "name": "Alertness",
                            "editions": { "acks2": { "book": "rr", "pages": [] } } } // stub: page unfilled (verify warns)
  }
}
```

Lookup is **exact-match only** (every surface form the pipeline met is a table
row; aliases included). The executor never normalizes, fuzzy-matches, or
promotes. A token absent from its table renders as plain text.

## Addressing: geometry, not indexes

All content addressing uses **page geometry over the footer-filtered text
items** (`{x0,x1,y0,y1}` boxes in top-origin page points, the same space
`extract.mjs pageItems` emits). DTRPG watermarks each customer's copy with
different footer text, so raw item indexes differ per seat — geometry inside
the body region is identical across copies of a printing. The book fingerprint
(page count + title) gates edition mismatch before any instruction runs.

## Instruction set v1 (frozen)

An **instruction** is `{ "op": …, "page": n, … }`. The executor performs it
mechanically; every judgment already happened at compile time.

| op | inputs | output | semantics |
|---|---|---|---|
| `expect` | `box`, `text` | ok/mismatch | integrity check: the runs in `box` start with `text` (short label). Used for names/anchors; a mismatch marks the entry unresolvable this session (stub), never an error. |
| `text` | `paras: [ { box, section?, dropText?, fixes? } … ]` | `[{section?, text}]` | assemble prose: for each para box, take items in reading order (y, then x), join, apply `fixes`/`dropText`. Paragraph boundaries AND section labels (`combat`, `ecology`, …) were computed offline from the book's own run-in headings; `@PdfText[id#section]` tags resolve section-scoped prose. |
| `value` | `box`, `pattern`, `table?`, `split?` | typed value(s) | join the runs in `box`, apply `pattern` (below); if `split`, divide first and apply per segment; if `table`, map each token through `tables[table]` → `{text, key, ref?}` (miss ⇒ `{text}` only). |
| `attacks` | `attacksBox`, `damageBox`, `glyphTable`, `colors?`, `colorTable?` | attack **modes** | parse Attacks + Damage live; both split on top-level `" or "` into aligned MODES (alternatives like "1 weapon OR 2 claws + bite"); within a mode, damage segments zip 1:1 with expanded attack names (stemmed to natural-weapon keys). Per segment: glyph → damage type via `glyphTable`; quality from the shipped per-segment **color annotation** (`colors[i]` over global segment order, e.g. `"#ff2e17"`) mapped through `colorTable`. Output: `{ text, throw, alternatives, modes:[{ count, throw, segments:[{name,naturalWeapon,damage,damageType,quality}] }] }`. |
| `art` | `select: {minW,minH,maxW,maxRatio}`, `name?` | image pointer | pick the page's illustration by the shipped criteria (or exact XObject `name`); the binding decides upload/usage. The image itself is seat-extracted. |
| `grid` *(v2)* | `box`, `label: {x0,x1}`, `cols: [{key,x0,x1,pattern?,table?}]`, `transpose?`, `rowTol?`, `minCells?` | `{rows: [{key,label,cells}]}` | a printed TABLE read by authored geometry — the MM's "characteristics by rank/age/tier" pages. Rows cluster by y; the label span names each row (key = `slugLabel`, shared with the binding); each column span parses through the cell-pattern library (`raw`/`int`/`num`/`dice`/`dashNull`/`intDash`/`rollBand`, plus `glyphs` mapping PUA damage-marks through a shipped table). `transpose` reads a sideways table (properties as rows, options as columns): one output row per COLUMN, cells keyed by slugged property labels. Header rows caught in the band parse almost no cells and are dropped but stay claimed. Values materialize from the seat's page, like every stat. |

**Defenses are materialized, never baked.** Immunities / resistances /
susceptibilities are not shipped per creature. The executor scans each
monster's OWN extracted description prose (from the seat's book) against a
shipped vocabulary — the damage-type keys plus the `defenseEffect` register —
and emits `fields.defenses`. The cookbook embeds only the enum vocabulary and
the fixed verb patterns; *which* defenses apply comes from the seat's copy, and
a bookless seat gets none (the GM who owns the book imports them into world
data). This keeps the rule: point at where the keyword lives, don't reproduce
which apply.

**Observations over runtime derivation.** When the compiler can observe a
presentation attribute (ink color, emphasis, position), the cookbook ships the
*observation* — "this glyph prints red" — never machinery for the runtime to
re-derive it. The runtime performs no operator-list walks and no visual
scraping; it maps shipped observations through shipped tables, gated on the
seat's book yielding the content they annotate. Observations are plain data, so
a chef can hand-author one wherever automatic attribution fails.

**Patterns** (fixed library, part of the frozen set): `raw` (joined, trimmed),
`int` (first integer), `dice` (first `NdM±k`), `refList` (split on `,`,
tokens trimmed), `spoilList` (component regex → `{name, weight6, cost,
effects[]}`), `statValue` (short run up to the next label), `statline`
(additive, 2026-07-22: the AX-line inline quick-stat block — top-level `;`
segments classified by leading token into class / ability scores /
Proficiencies / Equipment / Class Abilities / Spells, the core clause read by
keyword — `MV, AC, HD, hp, #AT (weapon n+), Dmg, Save/SV, ML, AL, XP` —
tolerating the era's missing commas; unrecognized segments degrade to
`extra[]`, absent keys are absent, never a throw).

**Value configs** (shipped per instruction, mechanical): `stripRoll` (drop a
trailing "N+" roll target before lookup), `stripColon` (drop a trailing ":"),
`stripParen` (drop one trailing parenthetical) — AX quick-stat labels print
"Skeletons (12):", creature-table keys are clean names.

**Fixes** (text-assembly transformations; never corrected text): 
`{"joinSpace": [i]}` insert a space between adjacent runs; `{"mergeHyphen": [i]}`
merge across a line-break hyphen; `{"drop": [i]}` discard a decorative run.
Indexes are run-ordinals *within the instruction's box* (geometry-stable).

**Executor contract:** pure lookup + mechanical execution; no heuristics, no
promotion, no writes. Inputs: cookbook + the seat's opened PDF. Output: the
node's extract JSON (values, typed blocks, `{text,key,ref}` triples). Every
failure degrades to a stub or plain text — the executor cannot throw on
content.

## Claims and coverage (pipeline-facing)

Each instruction's boxes are its **claim** on the page. Verify replays every
entry of a page and reports **residue** — body items claimed by no instruction
— and cross-entry double-claims. The cookbook may include a per-page
`skips: [ { box, reason } ]` list (recorded page furniture: letter-divider
ornaments etc.) so residue can reach zero honestly.

## Size & loading

Per-book files so a binding lazy-loads only connected books; `registers.json`
always loads (it is small: tables + def nodes). Everything is plain JSON,
committed, shipped in the release zip, and lint-gated (`tools/lint-register.mjs`
caps every literal at 60 chars and whitelists every key).

### `values`

A definition entry may carry `values`: the numbers its OWN passage states about
itself — an armour's class, a weight, a price. Each spec names the field it
fills and a `from.pattern` locator; the compiler ships the locator and the field
name, never the number, and the executor runs the pattern over the prose the
seat's own book yielded (the frozen `effects` op and its all-or-nothing
materializer, so a spec that half-matched is dropped rather than shipped looking
complete). A field is therefore the book's number or absent — never a default
wearing the book's authority.

A field name may name the UNIT the page states the value in where the page and
the schema disagree on one: `weight6.stone` and `weight6.item` both fill
`weight6`, which counts sixths of a stone. Converting is a change of unit, not
of value; the binding does it (`locatedValues`).

Distinct from `variation`, which uses the same machinery for the opposite thing:
a variation's numbers are what a difference MOVES, these are what a thing IS.

### `aliases`

A definition entry may carry `aliases`: other names the BOOKS print for the same
thing (`Art/Craft` is also printed `Art` and `Craft`; `Fighting Style
Specialization` is also printed `Fighting Style Spec.`). They are authored in
the register, compiled onto the entry, and read by the name resolvers so a
printed short form binds to the definition that owns it.

The bound: an alias may only give another printed surface to an entry this
module already ships. It never introduces a name for something the module does
not ship, and never collides with another entry's name or alias —
`lint-register` refuses both. Authoring rules are in [RECIPES.md](RECIPES.md).
