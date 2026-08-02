# Merge findings

What the merge surfaced, and what was done about it. Kept after the fact because
several of these are the reason the code looks the way it does.

Everything marked RESOLVED shipped in 0.1.0. What is left is either pre-existing
(and named as such) or deliberate.

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
