/**
 * Compendium documents for the formation feature: its macros, and the Hazards
 * pack (one hazard item per key of `hazard-keys.mjs`).
 *
 * Contract: export documents ready for tools/build-packs.mjs. Every top-level
 * document needs a 16-alphanumeric `_id` and a matching `_key`; ids and fixed
 * _stats timestamps are preserved so rebuilds stay byte-identical. See
 * docs/DECISIONS.md, "formation and influence had no `tools/pack-data.mjs`
 * — RESOLVED".
 */
import crypto from "node:crypto";
import fs from "node:fs";

import { HAZARD_ICONS, HAZARD_KEYS, hazardLabelKey } from "../../scripts/formation/hazard-keys.mjs";

/**
 * The two guards every command runs behind: the formation slice of the module
 * api must be ready, and the function must exist on this build, since a macro
 * imported into a world outlives the build that shipped it.
 */
const guard = (name, fn) => `const api = game.modules.get("acks-extras")?.api?.formation ?? globalThis.acksExtras?.formation;
if (!api) return ui.notifications.error("ACKS Extras is not active.");
if (typeof api.${fn} !== "function") return ui.notifications.warn("ACKS Extras | ${name} needs a newer build of this module.");`;

// The dungeon-turn macro (acksfmMacroTurn0) is no longer built: the party
// sheet's own clock advances a turn. Its id is never reissued.
export function buildMacros() {
  return [
  {
    _id: "acksfmMacroSheet",
    _key: "!macros!acksfmMacroSheet",
    name: "Party Sheet",
    type: "script",
    scope: "global",
    img: "icons/svg/combat.svg",
    command: `// Open the exploration party sheet.
${guard("Party Sheet", "open")}
api.open();`,
    ownership: { default: 0 },
    _stats: { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 },
  },
  ];
}

const LANG = JSON.parse(fs.readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8"));

/** A lang key's English text: the file holds both flat dotted keys and nested blocks. */
const english = (key) => {
  if (typeof LANG[key] === "string") return LANG[key];
  const found = key.split(".").reduce((at, part) => at?.[part], LANG);
  if (typeof found !== "string") throw new Error(`pack-data: no English text for lang key ${key}`);
  return found;
};

/** Deterministic 16-char id under the module's declared idPrefix ("acks"), so a rebuild never churns the pack. */
const hazardId = (key) => "acks" + crypto.createHash("sha1").update(`hazard:${key}`).digest("hex").slice(0, 12);

/**
 * The Hazards compendium: one Hazard item per key, named by its label and
 * carrying a core icon. The items hold a key and nothing else: no figure, and
 * no description beyond the Judge's own to type.
 */
export function buildHazards() {
  return HAZARD_KEYS.map((key, i) => ({
    _id: hazardId(key),
    _key: `!items!${hazardId(key)}`,
    name: english(hazardLabelKey(key)),
    type: "acks-extras.hazard",
    img: HAZARD_ICONS[key],
    system: { key, description: "" },
    effects: [],
    folder: null,
    sort: (i + 1) * 100000,
    ownership: { default: 0 },
    flags: {},
    _stats: { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 },
  }));
}

export const packs = { macros: buildMacros, hazards: buildHazards };
