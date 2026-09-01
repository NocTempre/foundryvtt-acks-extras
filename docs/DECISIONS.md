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
> (`flags.acks-henchmen` change keys shipping inert in proficiencies-powers);
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
prose pack name to a declared one, and this is the residue.

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
