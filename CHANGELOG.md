# Changelog

## 1.0.0

### Changed
- Documentation restructured into four kinds, each answering one question:
  MODEL (how it works now), DECISIONS (what was ruled and rejected), ROADMAP
  (what is not built), and guides/ (how to use it). Nothing is stated twice —
  a fact lives at the deepest level where it is entirely true.
- Code comments now explain mechanics only. Dated rulings, attributions,
  tombstones for deleted code and roadmap notes moved to the decision record.
  One ruling that had been restated at seven call sites is now stated once.
- MERGE-NOTES.md became docs/DECISIONS.md — it was already the repo decision
  record, for one event.

### Added
- docs/guides/ — a user-facing how-to per feature, and the landing page for
  release screenshots. docs/GALLERY.md indexes them with the release each shot
  came from.
- Docstrings on every exported class.

### Fixed
- getLoadout and computeDefaults each had an undocumented parameter.
- Several docs described a state that no longer held: the location sub-type
  collision was recorded as unresolved when it is resolved; the monsters enum
  migration was recorded as deferred when it had already happened, in the
  opposite direction; a referenced test file does not exist.

## 0.3.0

Location enhancements — a location becomes a **place** (2026-08-02).

### Added

- **Places nest.** A location can sit inside another: realm > town > inn >
  cellar > chest. The sheet gains a breadcrumb, a Contents tab listing
  sub-places and goods together, and drag-a-location-onto-a-location to
  re-parent. Cycles are refused at the write, not merely survived by the
  readers. An acks-equipment container item is the trivial case of the same
  model — see `docs/lib/PLACES.md`.
- **`acksLib.places`** — the new shared primitive behind all of it (nesting,
  occupancy, stack splitting, coin roll-up), with the Foundry-free half unit
  tested. `apiVersion` 11 → 12.
- **Location inventories hold living things.** Groups, monsters, retainers and
  animals go on a reference roster; drag an actor onto the sheet to place it
  there. Tokens on the linked scene are shown as *derived* rows — live, never
  stored, and promoted to a permanent record only by an explicit pin.
- **Scenes can be linked to a place.** A picker in Scene Configuration, "Create
  Place for Scene" in the scene directory, and drag-a-scene-onto-a-place. Never
  automatic: nothing is created until a GM asks.
- **Stacked places.** One actor can stand for eight identical warehouse bays;
  split one off when it becomes interesting.

### Changed

- **Markets are now opt-in per place.** A new location has no market: no
  recruitment, henchmen, mercenaries or specialists tabs, and the recruitment
  engine skips it entirely. "Add a market" is one click on the header or GM tab.
  The gate is on the DATA, not just the UI — `system.market` is genuinely `null`
  on a place without one, and every market field moved from `system.*` to
  `system.market.*`. Existing locations migrate on load; one whose market was
  empty and untouched becomes market-less.
- The sheet opens on **Contents** rather than Recruitment.

### Fixed

- **Deleting a place no longer loses the goods stored in it.** `returnGoodsTo`
  guarded on an identifier left undeclared by the module merge, so it threw a
  ReferenceError on any non-coin item and the caller swallowed it — under the
  default "return the goods" policy, which exists precisely to prevent that.

## 0.2.0

Post-merge cleanup pass (2026-08-02).

### Fixed

- **The proficiencies-powers compendium works again.** Its 25 Active Effect
  change keys shipped under the dead `flags.acks-henchmen` scope, so every
  proficiency's mechanics were inert (masked only by the name-fallback net).
- **Influence-hosted henchmen pages open again.** The version gate read
  `apiVersion` off the whole namespace instead of the influence feature, so
  hiring/loyalty/obedience/irrefusable-offer always fell back to plain
  dialogs. Monster wage levels read the same way and always fell back to
  sheet HD.
- **~255 dead CSS rules re-scoped.** The merge renamed the scope classes in
  JS but not the stylesheets — the party sheet, skill audit, monster sheet,
  roster, throw/posting dialogs, location sheet and ruledata browser were
  rendering unstyled. Rules for long-removed UI (the container panel, the
  pre-merge location header) are deleted instead.
- Equipment's proficiency-enforcement "auto" tested the module against
  itself; lock-picked/container-bashed hooks fired under dead
  `acksEquipment*` names; formation's map macro broadcast on an unregistered
  socket channel; 13 icon paths pointed at files Foundry v14 does not ship.

### Changed

- **One hook namespace.** Every custom hook and Handlebars helper now fires
  under `acksExtras.*`; the retired `acksFormation.*` / `acksInfluence*` /
  `acksMonsters*` names FAIL validation.
- **One socket transport** (`scripts/lib/sockets.mjs`) replaces the three
  per-feature ones, with duplicate-handler protection.
- Compendium art: bestiary monsters and sample characters get real portraits
  and token art; 30 ability items adopt the system's purpose-drawn icons.
- Dead compatibility gates, dead exports, duplicated helpers (`loc()` ×11,
  `num()` ×5, `gmIds()` ×4, `overlayEnabled()` ×6, the effect-scan core) and
  the eight copies of the `module.api` assignment are consolidated; stale
  pre-merge module ids are gone from messages, docs and pack prose; the
  loadout chat card is localized.
- `npm test` runs all three suites; `find:dead-config` scans the post-merge
  layout; bestiary builds are deterministic; validate-extra gains guards for
  namespace-root api reads, dead CSS scopes, icon existence and the widened
  stale-id patterns.

## 0.1.0

First release. Eight modules merged into one: `acks-lib`, `acks-abilities`,
`acks-equipment`, `acks-formation`, `acks-henchmen`, `acks-influence`,
`acks-location` and `acks-monsters`.

### Upgrading

Install this module, disable all eight old ones, reload, then run the **Clean Up
After the Merge (GM)** macro. Nothing is migrated — the old modules' data is not
carried across, and the macro removes what they left behind. A document whose
sub-type came from a now-absent module cannot load at all, so this step matters.

### Changed by the merge

- One module id, one flag scope, one global (`globalThis.acksExtras`, with a key
  per feature) and one `game.modules.get("acks-extras").api`.
- **One Location actor.** henchmen and location each defined a `location`
  sub-type; they are now one, with a single sheet carrying the market tabs and a
  storage tab.
- `damageType` was claimed by two features as a deliberate two-tier design (a
  hand-set override over a stamped classifier value); the override is now
  `damageTypeOverride`, because the module id used to be what told them apart.
- Paper Doll support removed.
- All 25 macros are in one *ACKS Extras* compendium folder.

### Fixed

- Equipment and henchmen effect-domain gates test exact domain membership rather
  than a shared flag prefix — which also tightens a pre-existing looseness, since
  the prefix test matched plain item flags that are not effect domains.
- The `attitude` Item sub-type shipped with no type label and rendered
  unlabelled.
