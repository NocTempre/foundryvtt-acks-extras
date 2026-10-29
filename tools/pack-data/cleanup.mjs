/**
 * The post-switch cleaner: opens the repair tool on what the pre-merge acks-*
 * modules left in a world (flag scopes, Active Effect change keys, world
 * settings, sheet-class pointers, documents and region behaviours of a removed
 * sub-type), scanned on opening. The walk and the removals are the
 * `lib.mergeResidue` check (scripts/lib/repair-checks.mjs); the macro is its
 * launcher, beside the coin check that warns what an unloadable actor holds.
 * Consumed by the synced tools/build-packs.mjs harness via the `packs` map
 * exported at the bottom of this file; registered as a feature in
 * tools/pack-data.mjs, whose aggregator concatenates this `macros` pack with
 * every other feature's into the one shared `macros` compendium. See
 * docs/DECISIONS.md, "The cleaner macro — why it is not a migration".
 *
 * `_id` is content-hashed from the macro name and carries the declared "acks"
 * idPrefix; dropping or re-adding this pack entry never reissues it, so a world
 * that already has this macro keeps the same document identity.
 */
import crypto from "node:crypto";

const did = (seed) => "acks" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
const STATS = { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 };

const COMMAND = `// ACKS II — clean up after the module merge.
// Opens the repair tool on what the nine old acks-* modules left in this world,
// already scanned: tick the rows and press Fix selected to remove them. Nothing
// is migrated: the merge was a clean break, so this is residue, not data.
const api = game.modules.get("acks-extras")?.api?.lib ?? globalThis.acksExtras?.lib;
if (!api) return ui.notifications.error("ACKS Extras is not active.");
if (typeof api.repair?.open !== "function") {
  return ui.notifications.warn("ACKS Extras | Clean Up After the Merge needs a newer build of this module.");
}
api.repair.open({ only: ["lib.mergeResidue", "lib.strandedCoin"], scan: true });`;

export function buildMacros() {
  const id = did("macro:cleanup-after-merge");
  return [
    {
      _id: id,
      _key: `!macros!${id}`,
      name: "Clean Up After the Merge (GM)",
      type: "script",
      scope: "global",
      img: "icons/svg/daze.svg",
      command: COMMAND,
      ownership: { default: 0 },
      _stats: STATS,
    },
  ];
}

export const packs = { macros: buildMacros };
