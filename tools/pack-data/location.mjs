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

export function buildMacros() {
  return [
    macro(
      "Open Storage Manager",
      "icons/svg/chest.svg",
      `if (!game.user.isGM) return ui.notifications.warn("The storage manager is a GM tool.");
game.modules.get("acks-extras").api.location.openStorageManager();`,
    ),
    // A CHARACTER is refused here for the same reason the manager's Enable
    // dialog leaves characters out of its list: a place is somewhere goods are
    // left, and a character is who leaves them. Flagging one made the character
    // a shared warehouse, which is not what a personal vault is and not what
    // anyone selecting their own token meant to ask for.
    macro(
      "Enable Storage Here",
      "icons/svg/village.svg",
      `if (!game.user.isGM) return ui.notifications.warn("Only a GM can turn storage on for an actor.");
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a token first (or assign yourself a character).");
if (actor.isToken) return ui.notifications.warn("Link the token to its actor first — an unlinked token cannot hold goods.");
if (actor.type === "character") return ui.notifications.warn(actor.name + " is a character, not a place. Use the storage manager's Create Vault for a personal vault, or select a cart, wagon or stronghold.");
await acksExtras.lib.storage.setProvider(actor, true);
ui.notifications.info(actor.name + " can now hold goods for people.");`,
    ),
    macro(
      "Disable Storage Here",
      "icons/svg/village.svg",
      `if (!game.user.isGM) return ui.notifications.warn("Only a GM can turn storage off for an actor.");
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a token first (or assign yourself a character).");
if (!acksExtras.lib.storage.isProvider(actor)) return ui.notifications.warn(actor.name + " is not holding goods for anyone.");
const held = acksExtras.lib.storage.storedItems(actor).length;
if (held) return ui.notifications.warn(actor.name + " still holds " + held + " stored item(s). Return them to their owners first — the storage manager has a button for it.");
await acksExtras.lib.storage.setProvider(actor, false);
ui.notifications.info(actor.name + " is no longer a place that holds goods.");`,
    ),
    macro(
      "My Stored Goods",
      "icons/svg/coins.svg",
      `const actor = game.user.character ?? canvas.tokens.controlled[0]?.actor;
if (!actor) return ui.notifications.warn("Assign yourself a character, or select your token.");
const places = acksExtras.lib.storage.providersFor(actor);
if (!places.length) return ui.notifications.info(actor.name + " has nothing in storage anywhere.");
await actor.sheet.render(true);
// The tab is injected on render, so switch after the sheet has drawn itself.
setTimeout(() => { try { actor.sheet.changeTab("acks-location-storage", "primary"); } catch (e) { console.warn(e); } }, 250);`,
    ),
    macro(
      "Run Vault Sweep Now",
      "icons/svg/chest.svg",
      `if (!game.user.isGM) return ui.notifications.warn("The vault sweep is a GM tool.");
const result = await game.modules.get("acks-extras").api.location.runVaultSweep();
ui.notifications.info(result.swept
  ? "Swept banked coin for " + result.swept + " character(s) — " + result.gp + " gp moved to vaults."
  : "No banked coin left to sweep.");`,
    ),
  ];
}

export const packs = {
  macros: buildMacros,
};
