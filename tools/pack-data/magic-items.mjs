/**
 * Compendium document content for the magic-items feature (module-owned; the
 * harness in tools/build-packs.mjs is synced from acks-module-template and
 * consumes the `packs` map exported at the bottom of this file).
 *
 * Keep this file free of Foundry runtime imports — it runs under plain Node
 * at build time. _stats timestamps are FIXED so every rebuild is
 * byte-identical.
 */

const STATS = { coreVersion: "14", createdTime: 1785551134915, modifiedTime: 1785551134915 };

/** Macro command: opens the Judge's roller window (scripts/magic-items/roll-dialog.mjs). */
const ROLL_A_MAGIC_ITEM = `// Roll a magic item from the imported tables; the card is whispered to the GM.
const api = game.modules.get("acks-extras")?.api?.magicItems ?? globalThis.acksExtras?.magicItems;
if (!api) return ui.notifications.error("ACKS Extras is not active.");
if (typeof api.openRoller !== "function") {
  return ui.notifications.warn("ACKS Extras | Roll a Magic Item needs a newer build of this module.");
}
await api.openRoller();`;

export function buildMacros() {
  return [
    {
      _id: "acksMagItemRoll0",
      _key: "!macros!acksMagItemRoll0",
      name: "Roll a Magic Item",
      type: "script",
      scope: "global",
      img: "icons/svg/d20-grey.svg",
      command: ROLL_A_MAGIC_ITEM,
      folder: null,
      flags: {},
      ownership: { default: 0 },
      sort: 0,
      _stats: { ...STATS },
    },
  ];
}

/** Pack contract for the synced tools/build-packs.mjs harness: pack name → document builder. */
export const packs = {
  macros: buildMacros,
};
