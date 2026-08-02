# Changelog

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
