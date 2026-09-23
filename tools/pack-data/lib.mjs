/**
 * Module-owned compendium document content, consumed by the synced
 * tools/build-packs.mjs harness.
 *
 * Contract: export a `packs` map of pack name -> documents (array, or a
 * zero-arg function returning one). Every top-level document needs:
 *   _id   16 alphanumeric characters, unique within the pack
 *   _key  "!<collection>!<_id>" (e.g. "!items!<id>", "!macros!<id>",
 *         "!tables!<id>"); embedded documents use
 *         "!items.effects!<parentId>.<childId>" style keys
 * Large datasets may live in sibling files (e.g. bestiary-data.mjs) and be
 * re-exported through this map.
 *
 * If documents carry `_stats`, use FIXED createdTime/modifiedTime values —
 * `Date.now()` makes every rebuild churn packs/_source and the compiled packs.
 */

/**
 * Macro command: re-files every ACKS compendium to its manifest-declared
 * folder and resets each pack's per-pack overrides (sort, lock, ownership).
 * See docs/lib/MODEL.md (compendium-folders) for how this differs from the
 * load-time pass that only fills an empty or dangling slot
 * (scripts/lib/compendium-folders.mjs).
 */
const RESTORE_LIBRARY = `// Put every ACKS compendium back where its package's manifest says it goes.
const api = game.modules.get("acks-extras")?.api?.lib ?? globalThis.acksExtras?.lib;
if (!api?.packs) return ui.notifications.error("ACKS Extras is not active.");
if (typeof api.packs.restoreCompendiumLibrary !== "function") {
  return ui.notifications.warn("ACKS Extras | Restore the Compendium Library needs a newer build of this module.");
}
await api.packs.restoreCompendiumLibrary();`;

/** Macro command: opens the repair tool (scripts/lib/apps/repair-app.mjs). */
const REPAIR_WORLD = `// Find the data this module left damaged, and fix what you choose.
const api = game.modules.get("acks-extras")?.api?.lib ?? globalThis.acksExtras?.lib;
if (!api) return ui.notifications.error("ACKS Extras is not active.");
if (typeof api.repair?.open !== "function") {
  return ui.notifications.warn("ACKS Extras | Repair This World needs a newer build of this module.");
}
api.repair.open();`;

export function buildMacros() {
  return [
    {
      _id: "acksLibRepair000",
      _key: "!macros!acksLibRepair000",
      name: "Repair This World (GM)",
      type: "script",
      scope: "global",
      img: "icons/svg/clockwork.svg",
      command: REPAIR_WORLD,
      ownership: { default: 0 },
      _stats: { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 },
    },
    {
      _id: "acksLibRestore00",
      _key: "!macros!acksLibRestore00",
      name: "Restore the Compendium Library (GM)",
      type: "script",
      scope: "global",
      img: "icons/svg/book.svg",
      command: RESTORE_LIBRARY,
      ownership: { default: 0 },
      _stats: { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 },
    },
  ];
}

export const packs = { macros: buildMacros };
