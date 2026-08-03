# Gallery

One row per feature area: what it shows, the guide that explains it, and the
release its current screenshot was taken in.

A row pointing at an older `v<X.Y.Z>/` directory is a truthful statement of how
stale that image is — that is the audit, visible at a glance. Link here from the
README and from release notes, never to a raw PNG path, so those links survive
the next refresh.

| Feature | What it shows | Guide | Shot |
|---|---|---|---|
| Locations | Goods kept at a place, grouped by whose they are | [guide](guides/location.md) | [v1.0.0](releases/v1.0.0/location-sheet.png) |
| Henchmen | A market's recruitment board on a location sheet | [guide](guides/henchmen.md) | [v1.0.0](releases/v1.0.0/henchmen-market.png) |
| Equipment | A character's inventory, gear grouped by where it is worn | [guide](guides/equipment.md) | [v1.2.0](releases/v1.2.0/equipment-wear-slots.png) |
| Wear slots | Declaring where a piece of gear sits, and what it costs to reach into | [guide](guides/equipment.md#where-gear-is-worn) | [v1.2.0](releases/v1.2.0/equipment-slot-picker.png) |
| Sheet light controls | Lighting, dousing and shuttering a lamp from the row it sits on | [guide](guides/equipment.md#lighting-a-lamp-from-your-own-sheet) | [v1.3.0](releases/v1.3.0/equipment-light-controls.png) |
| Formations | The party sheet: exploration clock, party rolls, marching-order roles, and a light the Judge handed over | [guide](guides/formation.md) | [v1.3.0](releases/v1.3.0/formation-judge-override.png) |
| Vision & light | A token's sight derived from its ACKS senses, not typed by hand | [guide](guides/formation.md#seeing-in-the-dark) | [v1.1.0](releases/v1.1.0/token-vision.png) |
| Influence | A social roll with its modifier stack itemized | [guide](guides/influence.md) | [v1.0.0](releases/v1.0.0/influence-dialog.png) |
| Abilities | An ability item's sheet, with its rolls and mechanics | [guide](guides/abilities.md) | [v1.0.0](releases/v1.0.0/ability-sheet.png) |
| Ability throws | One throw in a window of its own, with the level table it is read from | [guide](guides/abilities.md#typing-in-a-throw) | [v1.3.0](releases/v1.3.0/ability-roll-editor.png) |
| Monsters | A Monstrous Manual stat block on the monster sheet | [guide](guides/monsters.md) | [v1.0.0](releases/v1.0.0/monster-sheet.png) |

Snapshots are captured during the live-verification session of a release
(`acks-module-template/docs/TOOLCHAIN.md` §4b), never staged afterwards. Every
subject is a disposable fixture built for the shot and destroyed after it.
