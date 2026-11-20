/**
 * Compendium document content for the treasure feature (module-owned; the
 * harness in tools/build-packs.mjs consumes the `packs` map exported at the
 * bottom of this file).
 *
 * Keep this file free of Foundry runtime imports — it runs under plain Node
 * at build time. _stats timestamps are FIXED so every rebuild is
 * byte-identical.
 */

const STATS = { coreVersion: "14", createdTime: 1785551134915, modifiedTime: 1785551134915 };

/**
 * Macro command: the token-controls button's own entry (scripts/treasure/deal.mjs
 * `newDealPot`), so a pot opens staged with the selected monster tokens' rows,
 * or By hand with none selected.
 */
const DEAL_TREASURE = `// Open a treasure pot in staging: the selected monster tokens' rows, or By hand.
const api = game.modules.get("acks-extras")?.api?.treasure ?? globalThis.acksExtras?.treasure;
if (!api) return ui.notifications.error("ACKS Extras is not active.");
if (!game.user.isGM) return ui.notifications.warn("ACKS Extras | Only a GM deals treasure.");
await api.newDealPot();`;

function buildMacros() {
  return [
    {
      _id: "acksTreasDeal000",
      _key: "!macros!acksTreasDeal000",
      name: "Deal Treasure",
      type: "script",
      scope: "global",
      img: "icons/svg/chest.svg",
      command: DEAL_TREASURE,
      folder: null,
      flags: {},
      ownership: { default: 0 },
      sort: 0,
      _stats: { ...STATS },
    },
  ];
}

/** Pack contract for the tools/build-packs.mjs harness: pack name → document builder. */
export const packs = {
  macros: buildMacros,
};
