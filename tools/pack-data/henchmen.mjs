/**
 * The henchmen feature's macros — the hiring board, the loyalty and obedience
 * throws, follower generation, monster recruitment and the recruitment clock.
 * Pure data; consumed by tools/build-packs.mjs.
 *
 * Ids are content-hashed from the macro NAME, so adding or dropping one leaves
 * every other id untouched and no world's imported copy is orphaned. An id is
 * identity: rename freely, never re-issue.
 */
import crypto from "node:crypto";

/** Deterministic prefixed 16-char id ("acksHm" + 10 hash chars) from a seed. */
function did(seed) {
  return "acksHm" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10);
}

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
      "Open Recruitment Board",
      "icons/svg/tankard.svg",
      `const locations = game.actors.filter((a) => a.type === "acks-extras.location");
if (!locations.length) return ui.notifications.warn("Create a Location actor first.");
(locations.find((l) => l.testUserPermission(game.user, "OBSERVER")) ?? locations[0]).sheet.render(true);`
    ),
    macro(
      "Post Recruitment Notice",
      "icons/sundries/scrolls/scroll-bound-black-brown.webp",
      `const locations = game.actors.filter((a) => a.type === "acks-extras.location");
if (!locations.length) return ui.notifications.warn("Create a Location actor first.");
acksExtras.henchmen.openPostingDialog(locations[0]);`
    ),
    macro(
      "Loyalty Check (Selected)",
      "icons/svg/daze.svg",
      `const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a hireling token first.");
acksExtras.henchmen.openThrowDialog("hirelingLoyalty", {
  title: actor.name,
  actor,
  derived: { effectiveLoyalty: actor.system?.retainer?.loyalty ?? 0 },
});`
    ),
    macro(
      "Obedience Check (Selected)",
      "icons/svg/combat.svg",
      `const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a hireling token first.");
acksExtras.henchmen.openThrowDialog("hirelingObedience", {
  title: actor.name,
  actor,
  derived: { moraleScore: actor.system?.details?.morale ?? 0 },
});`
    ),
    macro(
      "Generate Followers (Selected)",
      "icons/svg/castle.svg",
      `const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a 9th+ level character token first.");
acksExtras.henchmen.openFollowersDialog(actor);`
    ),
    macro(
      "Recruit Monster (Targeted)",
      "icons/svg/pawprint.svg",
      `const employer = canvas.tokens.controlled[0]?.actor ?? game.user.character;
const monster = game.user.targets.first()?.actor;
if (!employer || !monster) return ui.notifications.warn("Select your character's token and TARGET the monster.");
const captured = await foundry.applications.api.DialogV2.confirm({
  window: { title: "Recruit " + monster.name },
  classes: ["acks-extras", "acks-extras-scroll"],
  content: "<p>Was the monster defeated and captured (Irrefusable Offer, MM 351)? Choose No for a peaceful/market offer.</p>",
});
acksExtras.henchmen.recruitMonster(monster, employer, { captured });`
    ),
    macro(
      "Process Recruitment Time Now",
      "icons/svg/regen.svg",
      `acksExtras.henchmen.processAllLocations().then(() => ui.notifications.info("Recruitment postings processed."));`
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
