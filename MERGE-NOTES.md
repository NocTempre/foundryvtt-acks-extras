# Merge findings

Running log of things the merge surfaced. **Recorded, not fixed** — each needs a
careful check before it is touched. Delete an entry once it is resolved.

Source repos are read-only inputs; nothing here is a change to them.

---

## 1. Flag key collisions — blocks the `MODULE_ID` rewrite

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

**Decision still open:** flat namespace with those two keys renamed (166 call
sites unchanged, one flat key-space) vs. sub-namespacing per feature
(`flags["acks-extras"].equipment.size`, all 166 call sites rewritten, features
stay isolated). Flat is far less churn; sub-namespacing is more future-proof.

## 2. `EFFECT_PREFIX` collapses silently

`equipment/constants.mjs:9` and `henchmen/constants.mjs:4` both derive
``EFFECT_PREFIX = `flags.${MODULE_ID}.` ``. Once `MODULE_ID` is shared these
become the same string and equipment's effect collector starts reading
henchmen's domains. No throw, no warning. Tied to the decision in §1.

## 3. `stackSignature` prunes only top-level empty flag scopes

`scripts/lib/storage-logic.mjs` treats an item whose flag scope was emptied in
transit as identical to one that never travelled — but it only prunes at the top
level. Any sub-namespacing (§1) turns `{"acks-lib":{}}` into
`{"acks-extras":{"lib":{}}}`, which is not empty at the top level, and item
stacks quietly stop merging. Only bites if §1 lands as sub-namespacing.

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

## 6. acks-content references a lang key it does not own

`ACKS-HENCHMEN.rarityTable.default` is referenced from acks-content but defined
in acks-henchmen's `lang/en.json`. It resolves only when henchmen happens to be
installed. Surfaced by the widened `validate.mjs` §6 regex — the old
module-scoped regex could not see cross-module references at all. acks-content
becomes the importer, henchmen becomes extras, so it stays cross-module.

## 7. `TYPES` labels lost a disambiguator — intentional

henchmen's Location was labelled `"Location (Henchmen Market)"` to tell it apart
from acks-location's `"Location"`. One subtype now, so the merged lang keeps
`"Location"`.

## 8. formation and influence have no `tools/pack-data.mjs`

Both carry a custom `tools/build-packs.mjs` with pack data inline, so they did
not participate in the canonical generated-packs contract. A repo has exactly
one `build-packs.mjs` and it comes from the template, so both need their macro
definitions lifted into `tools/pack-data/{formation,influence}.mjs`.

## 10. `npm run validate` — 7 failures, all one decision

Everything else passes: 1,198 lang keys, 4,068 CSS lines, all pack `_id`s under
`idPrefix: "acks"`, i18n coverage, and a clean ip-scan.

The 7 failures are all §7c, and all the same shape — each feature still exposes
its own global:

```
globalThis.acksLib  acksAbilities  acksEquipment  acksFormation
                    acksHenchmen   acksInfluence  acksMonsters
```

§7c requires them to start with `acksExtras`. **These are not runtime errors** —
the globals work, and the 44 cross-feature reads of `globalThis.acksLib` still
resolve. It is a policy failure that blocks release, and the fix (one
`globalThis.acksExtras` with the features hanging off it) is a public-API shape
decision, so it belongs with §1 rather than being done reflexively.

Same family, currently WARN not FAIL:
- hooks `acksFormation.lightChanged`, `acksInfluenceRollComplete`,
  `acksInfluenceAttitudeChanged` fire under what is now a foreign namespace
- Handlebars helpers `acksMonstersVal` / `acksMonstersHas` likewise

Also WARN, and **expected**: `id "acks-extras" does not match directory name
"foundryvtt-acks-extras"`. Deliberate — the same split `foundryvtt-acks-core`
uses, whose system id is just `acks`.

## 9. Macros merged cleanly but need an audit

The five `macros` packs (equipment 7, henchmen 10, formation 2, influence 1,
location 4 = 24) merged into one with **no filename and no `_id` collisions**,
so no rename was needed. Reported to contain dead and stale entries. Every
survivor embeds `globalThis.acks*` names as string literals in its `command`
body, so each needs repointing and a live run.
