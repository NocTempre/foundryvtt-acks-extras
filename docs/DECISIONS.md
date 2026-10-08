# Decision record — repo level

Decisions true of the whole module, not of any one feature: the merge that made
eight modules into one, the namespace and flag-scope rules that fell out of it,
and the guards added so the same class of mistake fails loudly next time.

Per-feature records live in `docs/<feature>/DECISIONS.md`. A fact belongs here
only when it is true of every feature — anything narrower belongs to its feature,
and nothing is stated in two places.

Entries are append-only. RESOLVED means it shipped; a superseded entry stays,
marked, because knowing an option was tried and abandoned is the point.

---

## The merge (0.1.0, 2026-07)

What the merge surfaced and what was done about it. Kept after the fact because
several of these are the reason the code looks the way it does. Source repos were
read-only inputs; nothing here was a change to them.

> **Post-0.1.0 addendum (2026-08-02).** A cleanup pass audited the merged tree
> and corrected this document's record in four places: §4's claim that the
> remaining apiVersion gates "pass" was wrong — `module.api` is the whole
> namespace, so the influence-hosted henchmen pages never opened (fixed, with a
> guard); the §10 WARN family is now enforced — every hook fires under
> `acksExtras.*` and the retired names FAIL validation; the pack-data rewrite
> miss §10 records for bestiary-data had a second, still-live instance
> (stale `flags.acks-henchmen` scope keys that are now removed);
> and the §4 CSS-class rename was one of five — the merge renamed the scope
> classes inside every JS `classes:` array while the stylesheets kept the old
> selectors, leaving ~255 rules dead. validate-extra now carries guards for all
> four classes of miss (plus icon-path existence), each verified red on the
> pre-fix tree.

> **Second addendum (2026-08-02, v1.0.3).** The `module.api` trap named in the
> addendum above had three surviving instances, all in the macros pack:
> **Influence Roller**, **Party Sheet** and **Dungeon Turn (+10 min)** each read
> `game.modules.get("acks-extras")?.api ?? globalThis.acksExtras.<feature>`.
> The aggregate api is never null, so the `??` fallback behind it is unreachable
> — the first two reported the module inactive and Dungeon Turn threw on
> `getFormations`. All three now read `api.<feature>`. The rule for any new
> macro: **`module.api` is the namespace, never a feature — always drill in.**
> Found by the release live gate, not by validation: `validate-extra` does not
> inspect macro command strings in `tools/pack-data/`. A guard belongs there and
> is not yet written.

Source repos are read-only inputs; nothing here was a change to them.

---

## 1. Flag key collisions — RESOLVED (flat namespace)

Every feature still declares its own `MODULE_ID` (`scripts/<feature>/constants.mjs`).
Pointing all eight at `"acks-extras"` is what makes the module one module — but
166 flag API calls pass `MODULE_ID` as the scope, so the eight key-spaces become
one the moment that happens.

Measured across all 65 flag keys, only **two genuinely collide**:

| key | claimed by | note |
|---|---|---|
| `damageType` | lib, equipment | Two different values. `lib/damage-type.mjs:61` already reads *equipment's* copy, so these are known-distinct concepts sharing a name. |
| `extras` | abilities, monsters | The whole structured ability model vs. the whole Monstrous Manual stat block. Unrelated payloads. |

`idPrefix` also appeared in the scan (lib, abilities, location) — **false positive**.
That is the `module.json` manifest flag `flags["acks-lib"].idPrefix`, not a
document flag. Ignore it.

**Resolved: flat.** Sub-namespacing was rejected on evidence — the flag key
constants are used in mixed forms (`flags.${MODULE_ID}.${CONST}`, where dots
expand, but also `{ [MODULE_ID]: { [CONST]: v } }` and `flags[LIB_ID][CONST]`,
where they do not), so prefixing the constants would have silently produced
literal dotted keys. `damageType` was renamed to `damageTypeOverride` on the lib
side; `extras` was left alone. All 166 flag call sites are unchanged.

## 2. `EFFECT_PREFIX` collapse — RESOLVED

`equipment/constants.mjs:9` and `henchmen/constants.mjs:4` both derive
``EFFECT_PREFIX = `flags.${MODULE_ID}.` ``. Once `MODULE_ID` is shared these
become the same string and equipment's effect collector starts reading
henchmen's domains. No throw, no warning. Both gates now test exact membership of their own `EFFECT_DOMAINS` (29 equipment,
12 henchmen, verified disjoint) rather than the shared prefix — which also fixes
a pre-existing looseness, since the prefix test already matched plain item flags
like `flags.<id>.size` that are not effect domains at all.

## 3. `stackSignature` — NOT NEEDED (namespace stayed flat)

`scripts/lib/storage-logic.mjs` treats an item whose flag scope was emptied in
transit as identical to one that never travelled — but it only prunes at the top
level. Any sub-namespacing (§1) turns `{"acks-lib":{}}` into
`{"acks-extras":{"lib":{}}}`, which is not empty at the top level, and item
stacks quietly stop merging. §1 landed flat, so this never bites. Live-verified anyway: deposit a stack,
retrieve half, re-deposit — one row of 20, not two.

## 4. `Actor.location` declared twice — RESOLVED

henchmen and location both declared `Actor.location` with an identical config,
and had two of everything behind it. `docs/location/MODEL.md` ruled 2026-07-19
that the sub-type belongs to the location feature, blocked only by a data
migration this merge does not need. Everything now lives under
`scripts/location/`:

- **Data model** — henchmen's was a strict SUPERSET (both carried
  `acksCompatStubs()` + `region` + `notes`; henchmen added the market schema),
  so the union is henchmen's. `migrateData` dropped — it renamed
  `slander.partyKey` → `subject` in a namespace never shipped under this id.
- **Sheet** — one `LocationSheet` on henchmen's tabbed base with location's
  storage grafted in as a seventh `storage` tab (its 5 actions, its
  groups-by-owner context, its store-not-copy `_onDropItem`). location's
  `_onDropActor` stub, which returned null because actor drops were "henchmen's",
  is gone: this sheet *is* henchmen's now.
- **Registration** — once, in `location/module.mjs`.
- The bare CSS class `location-sheet` became `acks-extras-location-sheet`; it
  only ever passed because the CSS rule scans `styles/*.css`, not JS class arrays.

**A regression this nearly caused.** The sheet registration sits after two
`apiVersion` early-returns that gated on acks-lib being a separately-installed
dependency. Post-merge those can only fail spuriously — and failing meant
`return`, which would have skipped the registration and taken the whole Location
sheet, market included, down with it. Both gates removed; lib attaches at import
time and is always present at this exact version.

Similar dead gates remain in `henchmen/integrations/influence.mjs` (influence
apiVersion ≥3 / ≥6, and influence exposes 7) and
`location/apps/storage-tab.mjs`. They pass, they only select a nicer UI over a
fallback, and they gate no registration — left alone.

## 4b. Import cycles — pre-existing, not merge-caused

The merged tree has 4 cycles. All four exist identically in the source repos
(verified by running the same check against them): equipment `loadout ↔ effects`
— actually a false positive, a JSDoc `import("./loadout.mjs")` type annotation —
and henchmen `hire ↔ monster`, `recruit-dialog ↔ influence`. ES modules tolerate
these and they shipped working.

## 5. `Item.attitude` had no type label — FIXED

acks-influence declared the `attitude` Item subtype but shipped no
`TYPES.Item.*` key for it, so Foundry rendered it unlabelled. Added as
`TYPES.Item.acks-extras.attitude = "Attitude"` during the lang merge.
Pre-existing, not caused by the merge.

## 6. The importer references a lang key it does not own — CORRECT AS IS

`ACKS-HENCHMEN.rarityTable.default` is referenced from acks-content but defined
in acks-henchmen's `lang/en.json`. It resolves only when henchmen happens to be
installed. Surfaced by the widened `validate.mjs` §6 regex — the old
module-scoped regex could not see cross-module references at all.

It stays cross-module, and that is right: the label is written into the imported
rarity table as DATA, and extras localizes it when it renders the table —
possibly long after the importer has been uninstalled. Pointing it at an
importer-owned key would break exactly then. Mirrored into the importer's own
lang file so that module still validates standalone.

## 7. `TYPES` labels lost a disambiguator — intentional

henchmen's Location was labelled `"Location (Henchmen Market)"` to tell it apart
from acks-location's `"Location"`. One subtype now, so the merged lang keeps
`"Location"`.

## 8. formation and influence had no `tools/pack-data.mjs` — RESOLVED

Both carried a custom `tools/build-packs.mjs` with pack data inline, so they
never participated in the canonical generated-packs contract. A repo has exactly
one `build-packs.mjs` and it comes from the template, so their macro definitions
were lifted into `tools/pack-data/{formation,influence}.mjs` with ids and fixed
timestamps preserved.

`tools/pack-data.mjs` is now an aggregator over the per-feature modules, and it
CONCATENATES same-named packs rather than spreading them — five features each
shipped a pack called `macros`, and an object spread would have kept only the
last one silently.

## 10. `npm run validate` — RESOLVED, and now carries merge guards

Everything else passes: 1,198 lang keys, 4,068 CSS lines, all pack `_id`s under
`idPrefix: "acks"`, i18n coverage, and a clean ip-scan.

The 7 failures are all §7c, and all the same shape — each feature still exposes
its own global:

```
globalThis.acksLib  acksAbilities  acksEquipment  acksFormation
                    acksHenchmen   acksInfluence  acksMonsters
```

Resolved: one `globalThis.acksExtras` with a key per feature
(`scripts/namespace.mjs`), which is also what `game.modules.get(...).api` points
at — eight features each assigning their own would have left only the last
visible. 71 references repointed.

`tools/validate-extra.mjs` now also runs four merge guards: no stale family ids
in code, flag-call scopes resolved to their declared value, one libWrapper
registration per target, and every template path present on disk. The first of
them immediately caught a real miss — `tools/pack-data/bestiary-data.mjs` was
copied in after the rewrite pass and still generated every bestiary document
with `flags["acks-monsters"]`.

Same family, currently WARN not FAIL:
- hooks `acksFormation.lightChanged`, `acksInfluenceRollComplete`,
  `acksInfluenceAttitudeChanged` fire under what is now a foreign namespace
- Handlebars helpers `acksMonstersVal` / `acksMonstersHas` likewise

Also WARN, and **expected**: `id "acks-extras" does not match directory name
"foundryvtt-acks-extras"`. Deliberate — the same split `foundryvtt-acks-core`
uses, whose system id is just `acks`.

## 9. Macros — RESOLVED

The five `macros` packs (equipment 7, henchmen 10, formation 2, influence 1,
location 4 = 24) merged into one with **no filename and no `_id` collisions**,
so no rename was needed. All 24 are filed under a single *ACKS Extras* folder
instead of the five per-feature trees they arrived in, joined by the cleaner
macro (§11).

A macro's `command` is a string. Nothing type-checks it, `validate.mjs` cannot
see inside it, and a stale API name shows up only when a user clicks the macro —
so every global, module id and sub-type in every body was rewritten and every
call checked against the real merged api surface. That pass also caught a live
bug: `module.api` is the whole `acksExtras` namespace now, so
`game.modules.get(...)?.api.annotateItem` had silently become `undefined`; the
bodies go through the feature key.

Live-verified: all 45 macros across both modules compile under Foundry's own
async wrapper, and none references a stale identifier.

## 11. The cleaner macro — why it is not a migration

Nothing is carried across from the old modules; that was the decision. But a
world that ran them keeps what they wrote, and one part of that is not merely
inert: Foundry refuses to instantiate an Actor whose sub-type is gone, so an old
`acks-henchmen.location` actor throws on every world load forever.

**Clean Up After the Merge (GM)** removes the residue — documents of a removed
sub-type, flag scopes under the nine old ids, AE change keys into them, world
settings in their namespaces, and `core.sheetClass` pointers at their sheets. It
reports before it touches anything and is idempotent.

Two awkward bits are load-bearing. Invalid documents are unreachable through the
normal collection lookup, so it goes through `invalidDocumentIds` / `getInvalid`.
And `unsetFlag` refuses a scope that is not an active package — which is every
scope it needs to clear — so it falls back to `flags.-=<scope>` on the document's
own update.

Live-verified on the test world: 43 leftovers removed, a second run reported
"already clean" without prompting, and the world then loaded with zero console
errors where it had previously thrown on every load.

**Extended 2026-09-23** (docs/lib/DECISIONS.md, "One standing repair tool").
The repair tool's `lib.mergeResidue` check runs this walk in module code as a
scan. The scan includes the region behaviours the macro no longer reaches. The
macro stays the fix for everything except those behaviours, which nothing
removes yet (docs/lib/ROADMAP.md).

**Amended 2026-10-07** (docs/lib/DECISIONS.md, "A deletion is the operator,
spelled once"). The fallback named above no longer writes `flags.-=<scope>`: it
assigns the deletion operator to each scope, in a nested `flags` object. On
Foundry 14.367 the two spellings send the same request and leave the same
flags, and the legacy one logged a compatibility warning for every scope.

## 12. Single-branch development — RESOLVED (isolation off, guard on)

The convention was always one branch. It read `Branch `main`; tags `v<semver>`.`
— true, but stated as a fact about the repo rather than as an instruction, and
nothing enforced it. Five `claude/*` branches and three worktrees accumulated
under `.claude/worktrees/` anyway, none of them asked for.

They were not hand-made. Background sessions default to worktree isolation
(`worktree.bgIsolation`), so every task spun off from a background-task chip got
its own worktree and a generated `claude/<adjective>-<scientist>-<hash>` branch.
Work then landed there instead of on `main`, invisibly.

The cost was not just untracked refs. A session working inside
`.claude/worktrees/gallant-leavitt-73353f` rewrote the repo's own name to its
worktree directory name in two places in CLAUDE.md — the Foundry junction target
and the release manifest URL both became
`.../NocTempre/gallant-leavitt-73353f/...`. A worktree names itself after
nothing; anything keyed on "the current directory" inherits that.

**Resolution.** `worktree.bgIsolation: "none"` in `.claude/settings.json` — the
root cause, since it stops background sessions minting a branch at all.
`.claude/hooks/single-branch-guard.mjs` covers what that setting does not: a
PreToolUse hook denies `git checkout -b` / `switch -c` / `branch <name>` /
`worktree add` (deletes, renames and listings pass), and a SessionStart hook
warns any session whose cwd is under `.claude/worktrees/`. The convention line
in CLAUDE.md is now an instruction with the guard named.

**Rejected:** blocking the worktree at the `WorktreeCreate` event alone — it
fires too late to stop the session that is already being placed there, and it
would not catch a hand-typed `git checkout -b`.

> **Addendum, same day.** The "rejected" note above is superseded: `WorktreeCreate`
> is now wired, and the setting alone was proven insufficient. Three minutes after
> `bgIsolation: "none"` was committed, a background session spawned into a fresh
> `.claude/worktrees/vibrant-kare-57829c` on a new `claude/*` branch. The setting
> is read when the background daemon starts, so a daemon already running keeps
> minting worktrees until it restarts. The Bash guard cannot see that path either
> — the app creates the worktree itself, without shelling out. `WorktreeCreate`
> is the only hook that sits in front of it, so it now returns `continue: false`.
> Its blocking behaviour is unverified until the next background session spawns;
> the setting and the Bash guard are both verified.

---

## 13. The Patreon link — header icon and one footer line

A funding link is on the docs site, in two places and no others: a Patreon icon
in the Starlight header beside GitHub, at the same 16px and the same treatment,
and one line at the foot of every page below the prev/next pagination. The
footer line comes from `src/components/Footer.astro`, a component override that
renders Starlight's own footer unmodified and appends to it — edit links, "last
updated" and pagination are still Starlight's.

The line states the terms before it asks: everything is free and nothing is
gated, *then* the link. That ordering is the whole point — a reader who wants
none of it has already been told they lose nothing.

**It does not go on `start/buying.md`.** That page opens with "nothing on this
page is sold by, or earns anything for, this project" — a sentence that is the
reason the page can list the publisher's prices without reading as a storefront.
A funding link there makes it false, and the page is the module's only claim
about money.

**Rejected:** a hero action on the landing page, and a full footer band. Both
make supporting the module a thing the site asks for. The module is free,
nothing in it is gated behind the Patreon, and no feature or page depends on the
link resolving.

> **Same-day revision.** The header icon shipped alone first and read as too
> quiet to find — an unlabelled 16px glyph among two others. The footer line is
> the correction, not a second attempt at the same job: the icon is a
> destination for someone already looking, the line is the only place the site
> says what the module costs.

---

## 14. The site's stale sections, and the two guards that end them

A sweep of the published site found four kinds of drift, all of the same shape:
a fact the site stated in its own words while the code stated it in another.

**Guides that published to nobody.** `guides/classes` and `guides/appearance`
were staged, built, indexed by search and linked from the gallery — but had no
sidebar entry, so nothing in the navigation reached them. The classes guide had
been live and unlisted since 3.3.0, through the whole run of class releases.
`tools/sync.mjs` now reads the sidebar's `guides/*` slugs out of
`astro.config.mjs` and fails the build in both directions: a staged guide with
no entry, and an entry naming a guide that no longer exists.

**A hand-typed count.** The landing page advertised "All 44 registrations" while
the extractor was reporting 48 — it had been wrong for four releases, and
nothing could notice, because the number was prose. `sync.mjs` now writes
`src/data/counts.json` and `index.mdx` imports it. A count that appears on a
page is now the extractor's count or it is not on the page.

**Feature areas the site did not know about.** The landing page's grid was
missing Monsters and Classes, its tagline said seven areas, and the root
README's `## Features` — which *is* the site's "What this is" page — had no
Classes section at all. So the class builder shipped in 3.8.0 to a site whose
front door never mentioned classes. Fixed at the source: the README section is
written, and the page follows.

**A compendium that had been renamed.** "Getting started" told readers to open
**Bestiary**; the pack is `ACKS Full Monsters (Example)`. Nothing links a
prose pack name to a declared one, and this is the residue. (§20 closes it.)

**Rejected:** generating the sidebar from `docs/guides/` with `autogenerate`.
It would have prevented the orphans, but guide order is the README's feature
order and alphabetical scrambles it — the guard buys the same safety and keeps
the order hand-held.

## 15. Domains at War: Battles is out of scope — interop, not resolution

Standing decision (owner, 2026-07-24; recorded here 2026-08-18). No `acks-*`
module implements Domains at War: Battles rules. Autarch has a dedicated
Battles VTT under development (the owner holds beta access); battles resolve
there, and this family's job at that boundary is an **import/export loop** —
army/unit rosters out of Foundry, battle results back in. This closes off the
D@W Battles conversion, the original book, AXIOMS 4 *Pitching Battle!*, the
Aide-de-Camp play aids, and Air Combat's unit-scale layer.

Still in scope, because they are not battle resolution: **battle ratings as a
monster/unit datum** (stored on the ecology tab; the corrected BR formula
stays relevant for display and derivation), **Skirmish scale** (a tier below
platoon battles, meant for the table — confirm with the owner before
building), and **roster modelling** (the stackable group actor is the natural
export source). REJECTED: building battle resolution in Foundry — it would
compete with a patron benefit, cost a large build, and fork from whatever
data model the official tool settles on.

## 16. The importer joins — RESOLVED (2026-09-01)

The family-level ruling (why the edge closed, what it cost) is the template's
`docs/DECISIONS.md`, 2026-09-01. This entry is what the merge did to this repo
and the calls it forced.

**Layout.** `scripts/importer/` (the 44 runtime files, flat), `tools/importer/`
(its module-owned tooling; the synced harness files were duplicates and were
dropped), `cookbook/` and `register/` at the root (the shared release workflow
already ships the first and excludes the second), `vendor/pdfjs/`,
`styles/importer.css`, `docs/importer/` with its topic docs, one guide
`docs/guides/importer.md`, and the pre-merge screenshots under
`docs/releases/importer/v*/` — filed under the importer release they came from,
because an extras `v4.3.0/` directory holding an importer 4.3.0 shot would make
the gallery's "how stale is this" audit lie.

**Identity.** `MODULE_ID` comes from lib like every feature's; `LANG_PREFIX`
stays `ACKS-IMPORTER` (roots stay put — the family rule); CSS classes are
re-prefixed `acks-extras-importer-` (the first merge's precedent); pack `_id`s
keep `acksc…`, which starts with `acks` and is identity. `module.api` is the
namespace, so the importer's own `module.api = api` was deleted and the macros
drill into `acksExtras.importer` (§9's rule, again).

**One flag scope.** Twelve keys moved under `flags["acks-extras"]`; one
collided — the importer's boolean `generated` ("minted from the page, not
defined by a register entry") against lib's template-generator provenance
object of the same name — and is now `minted`. One reader: `cookbookId` in
`lib/library.mjs`; the six local copies of `flags?.["acks-importer"]?.cookbook?.id`
went through it.

**Migration, not a clean break — and not dual-read.** The first merge carried
nothing across and shipped a cleaner, because the old modules' data was
residue. The importer's stamps are not: `cookbook.id` is the identity every
class ref, dedup index and library read resolves by, and a world's imported
library is thousands of documents. Three options were weighed:

- *Clean break (re-import).* The importer's own posture for content shape —
  "delete-and-re-import is the upgrade path" (its DECISIONS, 2026-08-24/25) —
  does not reach identity: a re-import under the new scope cannot see the old
  stamps, so it duplicates every document, and every character's class refs
  point at the old copies. Rejected.
- *Dual-read forever.* Read `acks-extras` then `acks-importer` at every site.
  Zero migration risk, but a dead scope in every world indefinitely, two-scope
  reads at every seam, and a permanent exemption in the stale-id gate.
  Rejected.
- *One-shot migration* (`scripts/importer/migrate.mjs`) — chosen. On the
  primary GM, once per world: every document carrying the legacy scope in the
  world collections and the `ACKS Cookbook — *` packs, children at every
  embedded depth through the document hierarchy, the three world settings
  read raw from the settings collection (the retired namespace cannot be
  registered, so `game.settings.get` cannot see them), the two client
  settings per seat from localStorage, and world macros addressing
  `globalThis.acksImporter` rewritten in place. Recorded in a world setting;
  a failure leaves it unset and says so, so the next load retries.

**The merged importer yields while the old module is active.** Both writing
one library races: two Books dialogs at ready, doubled sidebar buttons, every
import stamping two scopes, and a migration running under a module that keeps
writing the scope it is moving. So with `acks-importer` active the subsystem
registers nothing — no settings, no hooks, no api — and every load says why.
`module.json` declares the conflict as well, for Foundry's own dialog.
Rejected: a `globalThis.acksImporter` compat alias (validate 7c forbids it, and
the migration rewrites the one shipped prelude that used it).

**The cleaner macro is not extended.** It strips residue; the legacy importer
scope is identity until the migration has moved it, and the migration deletes
it in the same write. A cleaner that stripped `acks-importer` would destroy
exactly what the migration exists to keep.

**Tooling.** The importer's `validate-extra` is chained from ours (register
lint, icon ledger, OSE suites, prose boxes, cookbook drift); its 24 suites
joined `run-tests.mjs`; its authoring scripts are `package.json` scripts under
`tools/importer/`. `pdfjs-dist` joined the dev dependencies.

## 17. A free variable fails validate (2026-09-17)

**What was found.** The 8.0.0 live walk hit a progress bar counting a
collection the same release had deleted: a `ReferenceError` on a line nothing
offline reached, so every suite was green over it. A scan for the whole class
found two more. The class binder folded its key with a helper declared inside
another function; that was new in 8.0.0 and never shipped. The language
upgrade called `cookbookIdOf`, a name its imports never bound. That one shipped
in 6.0.2 and aborted the whole upgrade, on every load, in any world still
holding old imported languages (CHANGELOG 8.0.0, Fixed).

**Ruled.** `tools/free-variables.mjs` parses every file under `scripts/` and
`tools/`, builds the lexical scope tree, and fails validate
(`validate-extra.mjs` §7) on any identifier that no enclosing scope binds and no
allowlist names. There are two allowlists because the trees run in two
runtimes: `free-variables-browser.json` holds the browser's and Foundry's
globals, and `free-variables-node.json` holds Node's. An entry names a global
that runtime really supplies. It is never a way to quiet a finding.

**Rejected.**

- *ESLint `no-undef`.* It is the same check, but it brings an install, a config
  and a globals list that would be these allowlists anyway. The repo has no
  lint step, and one rule does not justify adding one.
- *A regex over identifiers.* It cannot tell a bound name from a free one, and
  scope is the whole question.

**What it costs.** It depends on a private Node path. `internal/deps/acorn/…` is
not API, it is reachable only behind `--expose-internals`, and it can move
between Node majors. The release workflow runs Node 20 while this machine runs
22, so 8.0.0 was dry-run on CI before it was tagged. If the path goes, the gate
exits 2 and says so rather than skipping, and the remedy is `acorn` as a
devDependency, which its error message names. The allowlists also need upkeep:
a new file reading a Foundry global fails validate until the global is listed,
which is the gate doing its job.

### History the source comments carried, recorded (2026-09-22)

These were written into code comments as the reason a guard exists. The
comments now state the guard; the story is here.

- **`tools/audit-imports.mjs` exists because a wrong named import shipped.** An import line copied between two files whose constants live in different places named an export its target did not provide. The browser threw at load and every later hook was dead, while `validate` (which reads files) and the test suite (which imports only the pure modules) both stayed green.
- **`tools/audit-styles.mjs` strips comments before it scans.** A previous hand-rolled version parsed selectors out of comment prose and reported 85 hits where there were 19.

## 18. A guide links another by its file, and the site re-points the link (2026-10-01)

**What was found.** A guide names another as `other.md#section`. GitHub
resolves that beside the guide. The site publishes each guide at
`/guides/<slug>/`, so the same href resolved beneath the page that held it and
returned 404. The first such link was written for 8.0.0, six weeks after the
site opened. By 10.0.0 there were fifteen across seven guides, and every one
had published broken. Nothing failed: Astro does not follow links, and the
sync's guards covered settings, screenshots and the sidebar.

**Ruled.** The source keeps the file form. `GALLERY.md` sends readers to the
guides on GitHub, and that is the form GitHub follows. `stageGuides()` rewrites
a link to a sibling guide into that guide's route and reports which guides each
one links to, and `sync.mjs` exits non-zero when one of them is not a guide.
`validate` runs the sync (`validate-extra.mjs` §6), so the check runs before a
push as well as in the site build.

**Rejected.**

- *A remark plugin in `astro.config.mjs`.* It would read links off the parsed
  tree, where the sync matches text. It also runs only inside the Astro build,
  and `validate` runs the sync on the module's own toolchain, without the
  site's dependencies. The check therefore cannot use a parser, and a rewrite
  in one file with its check in another is two definitions of what a link to a
  guide is.
- *An absolute href carrying the site base.* The base is set once, in
  `astro.config.mjs`. A relative link needs no copy of it, and relative is the
  form that file's header already asks of a hand-written href.

**What it costs.** The match is on text, and it recognises the one form the
guides use: `](name.md#section)`. A reference-style definition, a destination
with a title, a raw `<a href>` and a relative link out of `docs/guides/` are
all staged as written, and break on the site with nothing failing. A
link-shaped string inside a code sample is rewritten, and checked, with the
rest. The section is not checked at all: a heading renamed under a link breaks
it on GitHub and on the site alike, in silence. Only the build knows the ids it
gave the headings, so that check belongs over the built pages, and there is
none.

## 19. The settings reference names every feature that registers a setting (2026-10-01)

**What was found.** The settings reference takes each section's heading and
its place on the page from two lists in `extract-settings.mjs`,
`FEATURE_LABEL` and `FEATURE_ORDER`. A feature in neither still rendered:
headed by its directory name, and first, because a missing position sorts
ahead of every listed one. Four features began registering settings and were
never added: `classes` in 3.0.0, `markets` in 3.10.0, `bridge` in 7.0.0 and
`factions` in 8.0.0. The page therefore opened on `classes`, `markets` and
`factions`, and `bridge`, whose three keys are all internal, showed its
directory name in the internal-state table. The importer was added in 6.0.0
at the end of the order, while that release's README introduced it first.

**Ruled.** Both lists name every feature that registers a setting. The order
is the README's `## Features` order, which moves the importer's section from
last to first; `bridge` and `markets` have no section there and sit where the
sidebar lists their guides. A label is drawn from the name the README or the
sidebar already gives the feature. Every row reports whether both lists name
its feature, and `sync.mjs` exits non-zero on a feature they do not, as it
does on a key it cannot resolve.

**Rejected.**

- *Reading labels and order out of the sidebar.* That is one vocabulary by
  construction, but the library has no guide of its own to take a label from,
  and every existing heading would become its guide's full title.
- *Sorting an unlisted feature last.* The page would still publish a
  directory name as a heading, in the place it is least likely to be noticed.

**What it costs.** The check is on presence. Neither the order nor the
vocabulary is checked: a feature listed at the wrong point passes, as the
importer did, and so does a label coined on the spot. A feature added under
`scripts/` fails `validate` at its first registered setting until both lists
name it, which is the gate doing its job.

## 20. Prose names a compendium pack only while the manifest declares it (2026-10-01)

**What was found.** The module stopped shipping its item, actor and table
packs in two steps, four at 4.1.0 and four at 6.0.1, which left the macros.
The README went on describing them. Its `## Compendia` table still listed nine
packs at 10.0.0, and its `## Getting started` sent a new user to import from
**ACKS Equipment Samples**, a pack gone since 6.0.1. The site publishes that
section as its Getting started page. §14 had met the same failure once, when
the step named **Bestiary**, and corrected it to the label the pack then had;
that pack was dropped at 4.1.0 and the corrected name went stale in its turn.
Read against every release tag, the README named a pack the manifest no longer
declared in 139 of 180.

**Ruled.** Three things.

- The README's `## Compendia` is a pointer to the generated reference, as
  `## Settings reference` is, and keeps no pack name or count. The sentence
  about authored restatements went with the table: it described the item
  packs' descriptions, and a macro has none. That the module ships no book
  text is still said where the README introduces the importer, and in the
  note on the generated page.
- The first step for a user who has imported nothing is to open a character.
  The sheet is the module's own by default and needs no content.
- `pack-names.mjs` reads every label `module.json` has declared out of the
  manifest's own git history. `sync.mjs` exits non-zero when the README, a
  guide or a hand-written site page names one the manifest declares no longer:
  the whole label or the label without its trailing parenthetical, wrapped
  across a line or not. `validate` runs the sync (`validate-extra.mjs` §6).

**Rejected.**

- *An emphasised phrase followed by "compendium" or "pack" that is not a
  declared label.* It needs no history. Over the same tags it failed 36, all
  on a short name whose pack was still declared, and passed every tag on which
  a name was stale.
- *Every emphasised phrase opening "ACKS " that is not a declared label.* It
  fails all 180 tags: on the book titles, the licence, the compendium folder
  and the module's own name. The allowlist it needs is longer than the list it
  guards.
- *Keeping the table and checking it against the manifest.* A hand-kept list
  with a gate on it is still stated twice, and the generated page already
  holds the list.

**What it costs.** The history is git's, so a checkout without it checks
nothing. CI checks out at depth 1: there the sync prints a note and passes,
and the gate is `npm run validate` on a full clone. The match is on a label or
its stem, so a short name the manifest never held still passes, as "Bestiary"
would. Nothing exempts a mention. Prose that has to speak of a retired pack, a
migration note for one, must describe it without its label until the check
learns an exemption. The changelog is not read, because naming what a release
removed is its job.

## 21. The compendia reference lists what an import leaves (2026-10-01)

**What was found.** With the library gone from the module, the compendia
reference listed one pack of macros. Nothing said which compendiums a world
holds once its Judge has imported, though that is where a world's library now
lives. The importer guide named three of them, in a table of its own.

**Ruled.** The reference gains a section read from the code that names and
files those compendiums (`extract-library.mjs`). A label is built by
`libraryPackLabel` and `judgeLine` themselves. The types come from
`LIBRARY_TYPES` and `ADVENTURE_TYPE`, the sidebar folder from the manifest and
`IMPORT_FOLDER`, the Item shelves from `ITEM_SHELF`, and the Adventure
compendium's set from the books whose cookbook carries a map. One thing is
authored: `BRIEFS`, a sentence or two for each document type on what its
compendium is for. A brief states no rule, no figure and no name a book
prints, and it lists no shelf. `sync.mjs` exits non-zero on a type with no
brief and on a brief with no type.

**Rejected.**

- *Writing the list in the importer guide and copying it to the page.* Prose
  belongs in a guide, but a hand-kept table of compendium names is the shape
  that went stale in the README (§20).
- *Naming each series' set from the book registry.* The registry knows them.
  The page would print other publishers' product names and say nothing the
  pattern does not.
- *Listing the folders inside the Actor compendium, as the Item shelves are.*
  The Item shelves are the module's own. The Actor folders are the types a
  stat block declares, which is a book's taxonomy.

**What it costs.** A brief is prose about behaviour the code decides, and one
that goes stale fails nothing while its type remains. `lineOf` cannot be
imported outside Foundry, so its rule for a shipped book is restated in the
extractor, and the sync stops when the source no longer holds that rule,
whether it changed or was only rewritten. The page says which compendiums can
exist. Which of them a world holds depends on the books it imported. The
guide's own table of three is still kept by hand and nothing checks it.

## 22. Prose names a macro only while the pack holds it (2026-10-06)

**What was found.** 6.0.1 retired six macros in one commit, and prose went on
naming three of them in five places. The README's `## Installation`, which
the site publishes as its Install page, told a Judge upgrading from the
separate modules to run *Clean Up After the Merge (GM)* through 7.2.0, 23
releases, until 7.3.0 put the macro back. The formation guide sent readers to
*Migrate Token Vision* through 10.1.0, 74 releases, and docs/lib/MODEL.md and
docs/lib/TESTING.md named it as long. docs/location/TESTING.md walked *Recover
Coin from Unloadable Locations (GM)* for the same 74, and still did when this
check first ran. Nothing failed: §20 reads pack labels, and nothing tied a
name in prose to a macro in the pack.

**Ruled.** Four things.

- `macro-names.mjs` reads every name a macro under `packs/_source/macros` has
  carried out of that directory's git history. `sync.mjs` exits non-zero when
  prose names one the pack build no longer makes. The test is held once and
  not held now: the cleaner macro was deleted and came back, and is not
  retired. A folder in the pack is not a macro, and its name is not read.
- The match is §20's, made by §20's own function: the whole name or the name
  without its trailing parenthetical, wrapped across a line or not, with every
  name the pack still holds blanked first.
- It reads what §20 reads and, besides, `docs/TESTING.md` and each feature's
  `MODEL.md` and `TESTING.md`.
- A checkout without history prints a note and passes, as §20's does. Two
  holes in that are closed for both checks. A copy of the tree kept inside
  another repository was answered by that repository and passed in silence,
  and it now prints the note. With git's `log.showRoot` off, §20's reader
  skipped the first commit and never saw the four labels dropped at 4.1.0,
  and both readers now ask for that commit by flag.

Read against all 181 release tags, the check fails the 74 from 6.0.1 through
10.1.0 and passes the rest, and it reports the five places above and no
other.

**Rejected.**

- *The whole name only.* Over the tags it reports the same five places,
  because each of them wrote the name in full. Today's prose does not. With
  each of the 33 held names retired in turn, the check reports 74 places in
  the scope, and 36 of them leave the parenthetical off, as in "run **Import
  Everything** from the Macros compendium". The README, the guides and the
  site pages name two macros only that way. A check that lists half goes green
  with the other half still published.
- *Emphasis around the name, or the word "macro" beside it.* Of those 74,
  emphasis or quotation marks surround 51, and "macro" stands on the same or
  an adjacent line of 28. The location recipe's step said "macro" three lines
  below the name, and prose writes "the Disable Storage Here macro" bare.
- *The sources §20 reads and no more.* Three of the five places were a
  MODEL.md or a TESTING.md, and one of those was the last to be corrected. A
  recipe step that runs a macro the pack does not hold cannot be walked. Over
  the tags the wider scope reported nothing that was not stale.
- *Every document under `docs/`.* DECISIONS.md names what was retired, as the
  changelog names what a release removed: docs/henchmen/DECISIONS.md and
  docs/lib/DECISIONS.md name three of the five retired macros on purpose.
  ROADMAP.md speaks of what is not there.
- *A second copy of the search.* The two checks differ in where a name comes
  from and in which documents they read. What a parenthetical is, what a
  wrapped name is and which pages are hand-written would otherwise be decided
  twice.

**What it costs.** §20's costs, unchanged: a shallow checkout checks nothing,
CI's is one, and nothing exempts a mention. Three are the macro check's own.

- A name that is also a word fails wherever the word is. One held name is a
  single word, *Containers*. Retired, it would fail a README bullet, a guide
  heading and two recipe steps, none of them about the macro, under either
  match. No other held name is written in the scope except of its macro or of
  the tool that macro opens.
- A name without its parenthetical is often that tool's title. A macro
  retired while its tool stays reachable under the same title fails every
  mention of the tool: 17 for *Reimport One Shelf (GM)*. Such prose must
  change, or the check must learn an exemption.
- What it does not read can still go stale. A feature's topic files beside
  its MODEL.md name no macro today. The interface's own strings are not prose
  the sync reads: from 6.0.1 through 8.0.6, 48 releases, a setting hint in
  `lang/en.json` and a warning in `scripts/henchmen/repair.mjs` sent the Judge
  to *Repair Henchmen References*, and this check would have passed both.

The history is read from one directory. A second macro pack would need naming
in `macro-names.mjs`.

## 23. Interface text and comments name a macro only while the pack holds it (2026-10-06)

**What was found.** §22 holds prose to the macro pack and names what it
leaves unread: the module's own strings. From 6.0.1, which retired *Repair
Henchmen References*, through 8.0.6, a setting hint in `lang/en.json` and a
console warning in `scripts/henchmen/repair.mjs` went on sending the Judge to
it. Both went at 8.0.7. A comment in `scripts/lib/module.mjs` said *Migrate
Token Vision*, retired by the same commit, drove the world-wide vision sweep,
and it stood through 10.1.0. The strings name macros now as they did then: 11
language strings name four macros, 17 times between them, and nothing tied
one of those names to the pack.

**Ruled.** Seven things. The owner ruled on a proposal that read the
interface text alone: its match stands, and comments are read too.

- `tools/validate-macro-names.mjs` reads three kinds of interface text. Each
  string value of the language files the manifest declares. Each string
  expression under `scripts/`: a literal, a template, or several joined by
  `+`, taken as the text it evaluates to, with a mark where a value is
  interpolated. Each string field of each document the pack build makes,
  which is where a macro's body is.
- It reads each comment under `scripts/` besides: a block without the stars
  that open its lines, or a run of line comments on consecutive lines with
  nothing between them. A name wrapped across comment lines is found as one
  wrapped across the lines of a string is.
- In a comment, the phrase quoted straight after the name of a DECISIONS.md
  is a decision cited by its heading, and is not read. The owner set this
  before the check was built: a comment that quotes a DECISIONS heading may
  name a retired macro on purpose. A DECISIONS.md names what was retired
  (§22), and a comment that cites one of its headings sends nobody to the
  macro.
- The names and the search are §22's, by §22's own functions: a name the pack
  source's history holds and the build no longer makes, found whole or without
  its trailing parenthetical, wrapped across a line or not, with every held
  name blanked first.
- A name found is a mention only where it stands as words of its own, in a
  text that has other words. A text that is the name and no more is a title,
  a window's or a menu entry's, and a `{placeholder}` in it is not a word. A
  name inside a longer word is part of an identifier or a key. A comment is
  held to the same two tests, so a banner that is a name alone passes.
- `validate-extra.mjs` §9 runs it behind `--expose-internals`, as §17's scan
  runs, because a script's strings and comments come from a parse.
- A checkout without history prints a note and passes, as §20's and §22's do.

Read against all 181 release tags, the check fails the 74 from 6.0.1 through
10.1.0 and passes the rest. It reports three places and no other: the two
strings on the 48 through 8.0.6, and the comment on all 74. The tags cannot
choose the match: over the strings, each of the first six below fails the
same 48 on the same two places. Today's text can. With each of the 33 held
names retired in turn, the 17 places are what a match has to find.

**Rejected.**

- *The word "macro" directly after the name.* Both stale strings wrote it so,
  and 2 of the 17 do. Fourteen name *Import Everything (GM)* or *Reimport One
  Shelf (GM)*, none of them that way: either macro could be retired with
  every string that sends a Judge to it still shipped.
- *The whole name only.* 3 of the 17 write it. The other 14 leave the
  parenthetical off.
- *Quotation marks or emphasis around the name.* None of the 17 has them.
- *The word "macro" anywhere in the sentence.* It finds 14 of the 17, and 12
  of those only because the sentence also names the pack, *ACKS Extras
  Macros*.
- *§22's match with nothing added.* It finds all 17 and reports 11 places
  that are right, and no tag is without one. Six are the title of a window or
  a menu entry that bears its macro's name, four mean the Books dialog's
  button and not the macro, and one is a language key that ends in a macro's
  name. A macro retired while its window stays would fail on the window's own
  title.
- *A phrase in quotation marks before "macro" that the pack does not hold.*
  It needs no history, so it would run on CI, and it fails the same 48 tags.
  It covers none of the 17.
- *Comments left unread.* The proposal, because a comment is not shown to a
  Judge. The owner ruled them in. Over the tags they are the difference
  between 48 failing releases and 74: the stale comment outlived both strings
  by 26. A macro's body was read whole either way, its comment lines with it,
  because a Judge opens it.
- *A cited heading told another way.* By the headings the DECISIONS files
  hold: of the 293 phrases comments quote in that place, 58 match none of
  them, even as a heading's opening words and without its number or date. By
  any quotation in a comment that names a DECISIONS.md: 132 of the 380
  phrases such comments quote match no heading, and a comment can cite a
  decision and still send its reader to a macro.
- *Templates.* The 109 templates write no sentence themselves: beside marks
  such as `st`, `gp` and `CON`, the words they show are language strings.
- *The pack data's source in place of the documents it builds.* The documents
  are the text a Judge is given, and each field says which macro it belongs
  to.
- *A pattern in place of a parse.* The warning was two templates joined by
  `+`. Whether a text says more than a name depends on where the text ends,
  and a pattern cannot say where a string or a comment does. §17 already
  depends on this parser.
- *Failing where there is no history, or a list of once-held names kept in
  the tree.* The first fails every release, because the release workflow
  checks out at depth 1. The second is git's history written out a second
  time, to be kept by hand.

**What it costs.** §22's costs: a shallow checkout checks nothing, CI's is
one, and nothing exempts a mention but the cited heading. §17's as well: the
parser is Node's private copy, and without it the check exits 2 and does not
skip. Seven are this check's own.

- A comment that names a macro in a sentence changes when the macro goes.
  Eleven do today. Six speak of the macro and would be reported rightly. The
  other five are among the next two costs.
- A name that is also a control's label, a window's title or a run's fails
  where the text means that thing. Four strings and three comments write
  *Import Everything* of the Books dialog's button or of the run it starts,
  and one comment writes *Your ACKS Books* of the window. Each would fail
  with its macro retired. No other held name is written that way today.
- A name that is also a word fails wherever a sentence writes the word with
  its capital. *Containers* is the one such name. No string does today, and
  one comment does: the header of `scripts/equipment/containers.mjs`, which
  has opened on the word since 0.1.0.
- A text that is only a name passes, whatever it stands for. A name kept
  alone in a constant and joined into a sentence as the module runs is such a
  text, and so is one handed to a `{placeholder}`.
- The cited heading is told by its form. Whatever a comment quotes straight
  after the name of a DECISIONS.md passes, a heading or not. A heading cited
  another way is read: of the 248 headings comments quote today, 13 stand
  outside the form, as a second phrase or ahead of the file's name. No
  comment has needed it yet: the 181 tags and the tree after them read the
  same with it and without.
- A template is not read, and neither is a comment outside `scripts/`: a
  template's, a tool's, or the pack data source's.
- The pack's label and its folders are not macros. Nine language strings send
  a Judge to *ACKS Extras Macros*, and two of them to a folder inside it. §20
  reads prose for a pack's label and not these strings, and nothing reads
  either for a folder.

It adds about five seconds to `validate`.

## 24. The suites and the child checks run side by side (2026-10-08)

**What was found.** The gate did its work one process at a time. `run-tests.mjs`
ran 102 committed suites one after another, `tools/importer/validate-extra.mjs`
ran fourteen checks one after another, and `tools/validate-extra.mjs` ran §5 to
§9 one after another. In the gate of ae71ea0 on 2026-10-07 `npm run validate`
took 324 s and `npm test` 119 s. On 2026-10-06 seven commits landed here
between 22:01 and 23:00, six to fifteen minutes apart, under a gate of five to
nine minutes. The owner ruled that the gate's serial work run side by side,
with the same checks (acks-module-template `docs/DECISIONS.md`, 2026-10-07 and
2026-10-08).

**Ruled.**

- `tools/side-by-side.mjs` runs node scripts several at a time, eight at
  most, and shows what each printed, whole, in the order they were listed. A
  script's output appears once every script before it has ended, so a green
  run prints what it printed when the scripts ran in turn.
- `tools/test-side-by-side.mjs` holds it to that order, to each script's own
  exit status, to the directory given and to the limit. Nine single edits to
  the runner each turned it red.
- `run-tests.mjs` runs every suite through it. Each suite runs to its end,
  and the ones that failed are named after the last.
- `tools/importer/validate-extra.mjs` runs the register lint first and
  alone, as it did, and the thirteen checks after it side by side.
- `tools/validate-extra.mjs` runs §5 to §9 side by side, once §1 to §4 have
  passed.

**What this asks of a suite or a check.** It reads the repository, and what
it writes goes to a scratch directory of its own making. Today four `discord`
suites and the cookbook drift check write, each under an `mkdtemp`, and the
docs site's sync writes its staging, which no other check reads.

**Limits.**

- Nothing checks that the next suite keeps to that. Two that share a scratch
  path would fail one run in some, and pass alone.
- A failed suite no longer stops the suites after it, so a red run lasts as
  long as its suites do.
- The cookbook drift check is one process, a recompile, and is now most of
  `validate`. Nothing here shortens it.

**Measured** on a copy of ae71ea0 on 2026-10-08, with `validate` and the
tests started together as the gate starts them, and with the template's
validator of the same day, which checks syntax eight files at a time:

| | before | after |
|---|---|---|
| `validate` | 277 s | 160 s |
| the tests | 109 s | 40 s |
| the gate | 277 s | 160 s |

Through the commit tool, in a clone of this repository with its history:
`npm run validate: exit 0 in 164s` beside `npm test: exit 0 in 41s`. With
the template's validator alone changed, 199 s and 112 s. The gate of ae71ea0
the day before, 324 s and 119 s.

Each printed what it had printed, line for line, apart from its timings and
the count of one more file under `tools/`. With one script and two suites
broken, both runs exited 1 on the same syntax failure. The side-by-side run
went on to print what the later checks found and named every failed suite,
where the run in turn stopped at its first. With one late importer check
alone made to fail, `validate` exited 1 and named it, and the checks beside
it ran to their end.

Not checked: the gate's length on a CI runner, which has fewer processors
than the sixteen of the machine this was measured on.
