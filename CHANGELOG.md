# Changelog

## Unreleased

Post-merge cleanup pass.

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
