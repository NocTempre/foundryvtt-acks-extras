# Gallery

One row per feature area: what it shows, the guide that explains it, and the
release its current screenshot was taken in.

A row pointing at an older `v<X.Y.Z>/` directory is a truthful statement of how
stale that image is — that is the audit, visible at a glance. Link here from the
README and from release notes, never to a raw PNG path, so those links survive
the next refresh.

| Feature | What it shows | Guide | Shot |
|---|---|---|---|
| Appearance | The system's own character sheet on a dark seat, in the ACKS palette | [guide](guides/appearance.md) | [v2.0.0](releases/v2.0.0/character-sheet-dark.png) |
| Colour scheme | The per-player setting that holds the ACKS look steady | [guide](guides/appearance.md#pick-a-colour-scheme) | [v2.0.0](releases/v2.0.0/settings-colour-scheme.png) |
| Character sheet | The system's sheet on a light seat: ruled page, boxed write-in fields | [guide](guides/appearance.md) | [v2.0.0](releases/v2.0.0/character-sheet.png) |
| Locations | Goods kept at a place — coin included — and who is recorded there | [guide](guides/location.md) | [v2.1.0](releases/v2.1.0/location-sheet.png) |
| Storage | Moving goods in and out of a place that holds them, and giving a character a vault | [guide](guides/location.md) | [v2.1.0](releases/v2.1.0/location-storage-manager.png) |
| Storage messages | What a refused stow tells you, in words rather than an identifier | [guide](guides/location.md) | [v2.1.0](releases/v2.1.0/storage-message.png) |
| Henchmen | An employer's roster: who is hired, on what terms | [guide](guides/henchmen.md) | [v2.0.0](releases/v2.0.0/henchmen-roster.png) |
| Equipment | An item's construction: where it sits and what it costs to reach | [guide](guides/equipment.md) | [v2.0.0](releases/v2.0.0/equipment-item-sheet.png) |
| Formations | The party sheet: exploration clock, party rolls, marching-order roles | [guide](guides/formation.md) | [v2.0.0](releases/v2.0.0/formation-party-sheet.png) |
| Groups | A retinue kept as one document rather than a dozen | [guide](guides/formation.md) | [v2.0.0](releases/v2.0.0/group-sheet.png) |
| Templates | The generator that stats a creature when you need one | [guide](guides/monsters.md) | [v2.0.0](releases/v2.0.0/template-sheet.png) |
| Influence | A social roll with its modifier stack itemized | [guide](guides/influence.md) | [v2.0.0](releases/v2.0.0/influence-dialog.png) |
| Abilities | An ability item's sheet, with its rolls and mechanics | [guide](guides/abilities.md) | [v2.0.0](releases/v2.0.0/ability-sheet.png) |
| Monster card | What a monster opens on: attacks, powers and spells on one page | [guide](guides/monsters.md) | [v2.2.0](releases/v2.2.0/monster-card.png) |
| Read aloud | A named power posted to chat for the table to read | [guide](guides/monsters.md#what-opens-first) | [v2.2.0](releases/v2.2.0/monster-card-chat.png) |
| Monsters | The extended stat block, one click behind the card | [guide](guides/monsters.md) | [v2.2.0](releases/v2.2.0/monster-sheet.png) |
| Sheet light controls | Lighting, dousing and shuttering a lamp from the row it sits on | [guide](guides/equipment.md#lighting-a-lamp-from-your-own-sheet) | [v1.3.0](releases/v1.3.0/equipment-light-controls.png) |
| Vision & light | A token's sight derived from its ACKS senses, not typed by hand | [guide](guides/formation.md#seeing-in-the-dark) | [v1.1.0](releases/v1.1.0/token-vision.png) |
| Ability throws | One throw in a window of its own, with the level table it is read from | [guide](guides/abilities.md#typing-in-a-throw) | [v1.3.0](releases/v1.3.0/ability-roll-editor.png) |
| Wear slots | Declaring where a piece of gear sits, and what it costs to reach into | [guide](guides/equipment.md#where-gear-is-worn) | [v1.2.0](releases/v1.2.0/equipment-slot-picker.png) |

**The last four rows were not re-shot for 2.0.0**, against the rule that a major
re-shoots every feature area. Each needs a state a rendered document does not
reach on its own — a lit lamp equipped to a character, a token placed on a
canvas, a throw editor opened from an ability that declares one, a slot picker
opened from a worn item — and the 2.0.0 pass built its fixtures by rendering
documents rather than by driving the UI. The palettes in those four images are
stale; the features themselves are current.

Snapshots are captured during the live-verification session of a release
(`acks-module-template/docs/TOOLCHAIN.md` §4b), never staged afterwards. Every
subject is a disposable fixture built for the shot and destroyed after it.
