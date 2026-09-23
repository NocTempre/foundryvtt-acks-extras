/**
 * Compendium macros for the influence feature.
 *
 * Contract: export documents ready for tools/build-packs.mjs. Every top-level
 * document needs a 16-alphanumeric `_id` and a matching `_key`; ids and fixed
 * _stats timestamps are preserved so rebuilds stay byte-identical. See
 * docs/DECISIONS.md, "formation and influence had no `tools/pack-data.mjs`
 * — RESOLVED".
 */
export function buildMacros() {
  return [
  {
    _id: "acksInflMacro001",
    _key: "!macros!acksInflMacro001",
    name: "Influence Roller",
    type: "script",
    scope: "global",
    img: "icons/skills/social/diplomacy-handshake-yellow.webp",
    command: "// Open the ACKS Influence roller for the selected/assigned actor.\nconst actor = canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;\nconst api = game.modules.get(\"acks-extras\")?.api?.influence ?? globalThis.acksExtras?.influence;\nif (api?.open) api.open(actor);\nelse ui.notifications.error(\"ACKS Influence & Reactions module is not active/enabled.\");",
    ownership: { default: 0 },
    _stats: { coreVersion: "13", createdTime: 1784206144345, modifiedTime: 1784206144345 },
  },
  ];
}

export const packs = { macros: buildMacros };
