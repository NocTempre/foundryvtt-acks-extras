/**
 * Compendium macros for the formation feature.
 *
 * Lifted verbatim out of acks-formation's hand-written tools/build-packs.mjs
 * during the merge: that module never adopted the canonical generated-packs
 * contract, and a repo has exactly one build-packs.mjs, synced from the
 * template. Ids and fixed _stats timestamps are preserved so rebuilds stay
 * byte-identical.
 *
 * Contract: export documents ready for tools/build-packs.mjs. Every top-level
 * document needs a 16-alphanumeric `_id` and a matching `_key`.
 */
export function buildMacros() {
  return [
  {
    _id: "acksfmMacroTurn0",
    _key: "!macros!acksfmMacroTurn0",
    name: "Dungeon Turn (+10 min)",
    type: "script",
    scope: "global",
    img: "icons/svg/clockwork.svg",
    command: "// Mark off one dungeon turn for the (first) formation — GM only.\nconst api = game.modules.get(\"acks-extras\")?.api?.formation ?? globalThis.acksExtras?.formation;\nif (!api) return ui.notifications.error(\"ACKS Exploration Formations is not active.\");\nconst formation = Object.values(api.getFormations())[0];\nif (!formation) return ui.notifications.warn(\"No formation exists yet.\");\napi.advanceTurns(formation, 1, { reason: \"manual\" });",
    ownership: { default: 0 },
    _stats: { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 },
  },
  {
    _id: "acksfmMacroSheet",
    _key: "!macros!acksfmMacroSheet",
    name: "Party Sheet",
    type: "script",
    scope: "global",
    img: "icons/svg/combat.svg",
    command: "// Open the exploration party sheet.\nconst api = game.modules.get(\"acks-extras\")?.api?.formation ?? globalThis.acksExtras?.formation;\nif (api?.open) api.open();\nelse ui.notifications.error(\"ACKS Exploration Formations is not active.\");",
    ownership: { default: 0 },
    _stats: { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 },
  },
  ];
}

export const packs = { macros: buildMacros };
