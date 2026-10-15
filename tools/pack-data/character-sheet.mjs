/**
 * Compendium macros for the character-sheet feature.
 *
 * Contract: export documents ready for tools/build-packs.mjs. Every top-level
 * document needs a 16-alphanumeric `_id` and a matching `_key`; ids and fixed
 * _stats timestamps are preserved so rebuilds stay byte-identical.
 */
export function buildMacros() {
  return [
    {
      _id: "acksCsMacroSheet",
      _key: "!macros!acksCsMacroSheet",
      name: "Official Character Sheet (PDF)",
      type: "script",
      scope: "global",
      img: "icons/svg/book.svg",
      command:
        "// Read a filled official character sheet onto a character, or write one into a blank copy.\n// Opens on the selected token's character, else your own character, else a new one.\nconst api = game.modules.get(\"acks-extras\")?.api?.characterSheet ?? globalThis.acksExtras?.characterSheet;\nif (!api?.pdf) return ui.notifications.error(\"ACKS Extras is not active.\");\nconst picked = canvas?.tokens?.controlled?.map((t) => t.actor).find((a) => a?.type === \"character\" && a.isOwner);\nconst own = game.user.character?.isOwner ? game.user.character : null;\napi.pdf.open({ actor: picked ?? own ?? null });",
      ownership: { default: 0 },
      _stats: { coreVersion: "14", createdTime: 1792022400000, modifiedTime: 1792022400000 },
    },
  ];
}

export const packs = { macros: buildMacros };
