/**
 * The henchmen feature's macros — the loyalty and obedience throws, follower
 * generation, monster recruitment and the recruitment clock. Pure data;
 * consumed by tools/build-packs.mjs.
 *
 * Ids are content-hashed from the macro NAME, so adding or dropping one leaves
 * every other id untouched and no world's imported copy is orphaned. An id is
 * identity: rename freely, never re-issue. The recruitment board and the
 * posting notice are no longer built: both are the place sheet's own tabs
 * (docs/DECISIONS.md, "The macro pack is launchers").
 */
import crypto from "node:crypto";

/** Deterministic prefixed 16-char id ("acksHm" + 10 hash chars) from a seed. */
function did(seed) {
  return "acksHm" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10);
}

/**
 * The two guards every command runs behind: the henchmen slice of the module
 * api must be ready, and the function must exist on this build, since a macro
 * imported into a world outlives the build that shipped it.
 */
const guard = (name, fn) => `const api = game.modules.get("acks-extras")?.api?.henchmen ?? globalThis.acksExtras?.henchmen;
if (!api) return ui.notifications.error("ACKS Extras is not active.");
if (typeof api.${fn} !== "function") return ui.notifications.warn("ACKS Extras | ${name} needs a newer build of this module.");`;

/** The selected token's actor, else the user's own character. */
const SELECTED = `const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;`;

export function buildMacros() {
  const macro = (name, img, command) => {
    const id = did(`macro:${name}`);
    return {
      _id: id,
      _key: `!macros!${id}`,
      name,
      type: "script",
      scope: "global",
      img,
      command,
    };
  };
  return [
    macro(
      "Loyalty Check (Selected)",
      "icons/svg/daze.svg",
      `// Roll a loyalty check for the selected hireling, with its employer's modifiers.
${guard("Loyalty Check", "openLoyaltyRoll")}
${SELECTED}
if (!actor) return ui.notifications.warn("Select a hireling token first.");
api.openLoyaltyRoll(actor);`
    ),
    macro(
      "Obedience Check (Selected)",
      "icons/svg/combat.svg",
      `// Roll an obedience check for the selected hireling.
${guard("Obedience Check", "openObedienceRoll")}
${SELECTED}
if (!actor) return ui.notifications.warn("Select a hireling token first.");
api.openObedienceRoll(actor);`
    ),
    macro(
      "Generate Followers (Selected)",
      "icons/svg/castle.svg",
      `// Open the followers dialog for the selected character: who arrives when a character of rank earns them.
${guard("Generate Followers", "openFollowersDialog")}
${SELECTED}
if (!actor) return ui.notifications.warn("Select a character token first.");
api.openFollowersDialog(actor);`
    ),
    macro(
      "Recruit Monster (Targeted)",
      "icons/svg/pawprint.svg",
      `// Recruit the targeted monster for the selected character, as a captive or by offer.
${guard("Recruit Monster", "recruitMonster")}
const employer = canvas.tokens.controlled[0]?.actor ?? game.user.character;
const monster = game.user.targets.first()?.actor;
if (!employer || !monster) return ui.notifications.warn("Select your character's token and TARGET the monster.");
const captured = await foundry.applications.api.DialogV2.confirm({
  window: { title: "Recruit " + monster.name },
  classes: ["acks-extras", "acks-extras-scroll"],
  content: "<p>Was the monster defeated and captured (MM 351)? Choose No for an offer made in peace or at market.</p>",
});
api.recruitMonster(monster, employer, { captured });`
    ),
    macro(
      "Process Recruitment Time Now",
      "icons/svg/regen.svg",
      `// Advance every place's recruitment postings by the time that has passed — GM only.
${guard("Process Recruitment Time", "processAllLocations")}
if (!game.user.isGM) return ui.notifications.warn("Processing recruitment time is a GM tool.");
api.processAllLocations().then(() => ui.notifications.info("Recruitment postings processed."));`
    ),
  ];
}

/**
 * Pack contract for the synced tools/build-packs.mjs harness (see
 * acks-module-template): pack name -> document builder.
 */
export const packs = {
  macros: buildMacros,
};
