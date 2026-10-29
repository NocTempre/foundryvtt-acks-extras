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
import crypto from "node:crypto";

/** Deterministic prefixed 16-char id ("acksl" + 11 hash chars). */
function did(seed) {
  return "acksl" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 11);
}

function macro(name, img, command) {
  const id = did(`macro:${name}`);
  return { _id: id, _key: `!macros!${id}`, name, type: "script", scope: "global", img, command };
}

/**
 * The two guards every command runs behind: the named slice of the module api
 * must be ready, and the function must exist on this build, since a macro
 * imported into a world outlives the build that shipped it. The storage
 * macros read the shared lib's `storage`; the manager is location's own.
 */
const guard = (name, slice, fn) => `const api = game.modules.get("acks-extras")?.api?.${slice} ?? globalThis.acksExtras?.${slice};
if (!api) return ui.notifications.error("ACKS Extras is not active.");
if (typeof api.${fn} !== "function") return ui.notifications.warn("ACKS Extras | ${name} needs a newer build of this module.");`;

// The vault-sweep macro is no longer built: the sweep runs at ready and from
// the repair tool's location.vaultSweep check. Its id is never reissued.
export function buildMacros() {
  return [
    macro(
      "Open Storage Manager",
      "icons/svg/chest.svg",
      `// Open the storage manager: every place that holds goods, and whose they are — GM only.
${guard("Open Storage Manager", "location", "openStorageManager")}
if (!game.user.isGM) return ui.notifications.warn("The storage manager is a GM tool.");
api.openStorageManager();`,
    ),
    // Refuses a character, matching the storage manager's own Enable dialog.
    // See docs/location/DECISIONS.md, "Storage can be turned off again".
    macro(
      "Enable Storage Here",
      "icons/svg/village.svg",
      `// Let the selected place, cart or stronghold hold goods for people — GM only.
${guard("Enable Storage Here", "lib", "storage")}
if (!game.user.isGM) return ui.notifications.warn("Only a GM can turn storage on for an actor.");
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a token first (or assign yourself a character).");
if (actor.isToken) return ui.notifications.warn("Link the token to its actor first — an unlinked token cannot hold goods.");
if (actor.type === "character") return ui.notifications.warn(actor.name + " is a character, not a place. Use the storage manager's Create Vault for a personal vault, or select a cart, wagon or stronghold.");
await api.storage.setProvider(actor, true);
ui.notifications.info(actor.name + " can now hold goods for people.");`,
    ),
    macro(
      "Disable Storage Here",
      "icons/svg/village.svg",
      `// Stop the selected place holding goods, once it holds none — GM only.
${guard("Disable Storage Here", "lib", "storage")}
if (!game.user.isGM) return ui.notifications.warn("Only a GM can turn storage off for an actor.");
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a token first (or assign yourself a character).");
if (!api.storage.isProvider(actor)) return ui.notifications.warn(actor.name + " is not holding goods for anyone.");
const held = api.storage.storedItems(actor).length;
if (held) return ui.notifications.warn(actor.name + " still holds " + held + " stored item(s). Return them to their owners first — the storage manager has a button for it.");
await api.storage.setProvider(actor, false);
ui.notifications.info(actor.name + " is no longer a place that holds goods.");`,
    ),
    macro(
      "My Stored Goods",
      "icons/svg/coins.svg",
      `// Open your character's sheet on its Storage tab, where what you have in storage is listed.
${guard("My Stored Goods", "lib", "storage")}
const actor = game.user.character ?? canvas.tokens.controlled[0]?.actor;
if (!actor) return ui.notifications.warn("Assign yourself a character, or select your token.");
const places = api.storage.providersFor(actor);
if (!places.length) return ui.notifications.info(actor.name + " has nothing in storage anywhere.");
await actor.sheet.render(true);
// The tab is injected on render, so switch after the sheet has drawn itself.
setTimeout(() => { try { actor.sheet.changeTab("acks-location-storage", "primary"); } catch (e) { console.warn(e); } }, 250);`,
    ),
  ];
}

export const packs = {
  macros: buildMacros,
};
