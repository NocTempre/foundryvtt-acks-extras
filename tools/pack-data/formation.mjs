/**
 * Compendium macros for the formation feature.
 *
 * Contract: export documents ready for tools/build-packs.mjs. Every top-level
 * document needs a 16-alphanumeric `_id` and a matching `_key`; ids and fixed
 * _stats timestamps are preserved so rebuilds stay byte-identical. See
 * docs/DECISIONS.md, "formation and influence had no `tools/pack-data.mjs`
 * — RESOLVED".
 */
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

export const packs = { macros: buildMacros };
