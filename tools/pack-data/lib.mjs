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
 * Putting the compendium sidebar back the way the manifests describe it.
 *
 * A library drifts and cannot right itself: Foundry files a package's packs
 * from its manifest once, skips any pack whose configuration already names a
 * folder, and never revisits the decision — so a folder deleted years ago
 * strands every pack that named it at the sidebar root permanently. This is
 * the surface that asks for all of them at once.
 *
 * It OVERRULES rather than repairs: every ACKS pack goes back to its declared
 * place and every per-pack override — a custom sort, a lock, an ownership
 * grant — is dropped back to the package's own default. That is what "restore"
 * means, and it is why the macro asks before it writes. The gentle pass that
 * only fills an empty or dangling slot runs by itself at every load and needs
 * no macro (scripts/lib/compendium-folders.mjs).
 */
const RESTORE_LIBRARY = `// Put every ACKS compendium back where its package's manifest says it goes.
const api = game.modules.get("acks-extras")?.api?.lib ?? globalThis.acksExtras?.lib;
if (!api?.packs) return ui.notifications.error("ACKS Extras is not active.");
if (typeof api.packs.restoreCompendiumLibrary !== "function") {
  return ui.notifications.warn("ACKS Extras | Restore the Compendium Library needs a newer build of this module.");
}
await api.packs.restoreCompendiumLibrary();`;

export function buildMacros() {
  return [
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
