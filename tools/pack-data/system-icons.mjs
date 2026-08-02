/**
 * Purpose-drawn ACKS proficiency icons shipped BY THE SYSTEM at
 * `systems/acks/assets/icons/` — a hard dependency of this module, so the
 * paths are always resolvable at runtime. The table is the exact-name matches
 * between our pack items and that tree (parenthesised variants share their
 * base icon: every "Weapon Focus (…)" gets weapon-focus.webp).
 *
 * Kept as an explicit table so `npm run build:packs` never needs a system
 * checkout; validate-extra's icon check verifies the paths against one when
 * it is discoverable.
 */

const ROOT = "systems/acks/assets/icons";

/** slug of the item name with any parenthesised qualifier stripped. */
const slug = (name) =>
  name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[''’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const FILES = Object.freeze({
  "ambushing": "ambushing.webp",
  "beast-friendship": "beast-friendship.webp",
  "berserkergang": "berserkergang.webp",
  "bribery": "bribery.webp",
  "combat-reflexes": "combat-reflexes.webp",
  "command": "command.webp",
  "diplomacy": "diplomacy.webp",
  "martial-training": "martial-training.webp",
  "mystic-aura": "mystic-aura.webp",
  "precise-shooting": "precise-shooting.webp",
  "riding": "riding.webp",
  "running": "running.webp",
  "seduction": "seduction.webp",
  "skirmishing": "skirmishing.webp",
  "sniping": "sniping.webp",
  "swashbuckling": "swashbuckling.webp",
  "unarmed-fighting": "unarmed-fighting.webp",
  "vermin-slaying": "vermin-slaying.webp",
  "weapon-focus": "weapon-focus.webp",
});

/** The system icon for an ability name, or `fallback` when none matches. */
export function systemIcon(name, fallback) {
  const file = FILES[slug(name ?? "")];
  return file ? `${ROOT}/${file}` : fallback;
}
