/**
 * What a hit with a special maneuver asks and writes: the save card posted for
 * the struck token (`maneuverSavePost`), the reading of the save's modifier and
 * of the parts that cannot be read (`maneuverSaveMods`), the post a resolved
 * attack makes (`settleManeuver`), and the writer of the card's Save press
 * (`maneuverSaveOutcome`), which lib's item runner calls.
 *
 * A maneuver that calls a save owes it once the attack succeeds, after any
 * damage it deals (RR pp. 305–306, Special Maneuvers); one that calls none
 * (`MANEUVERS[key].save` null) posts nothing. The card speaks for the attacker,
 * its one subject is the target, and its owners press the Save. The press
 * records the verdict on the card and writes nothing to either actor: what a
 * failed save does (prone, disarmed, forced back) is applied by hand.
 *
 * The save is named only where its modifier is fully read. A part that cannot be
 * read leaves the card with a blank save name, which is the Judge's Passed and
 * Failed card, never a figure that may be wrong: an imported part not read, a
 * size-adjusted maneuver between creatures not known to be one size (no size
 * figure is imported, and a mount's size stands for its rider's), a sunder (its
 * save moves with the struck weapon or shield, which the attack does not name),
 * and a disarm whose target's grip is not told by the one weapon it holds.
 */
import { makeLoc } from "../lib/util.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
import { sizeKeyOf } from "../lib/actor-read.mjs";
import { mountOf, riderOf } from "../lib/mount.mjs";
import { signedFigure } from "../lib/item-run-card-logic.mjs";
import { LANG, MODULE_ID } from "./constants.mjs";
import { MANEUVERS, maneuverMods, overlayEnabled } from "./overlays/maneuvers.mjs";
import { classifyWeapon, isTwoHandedOnly } from "./profiles.mjs";
import { getLoadout } from "./loadout.mjs";
import { heldGrip } from "./attack-mods.mjs";

const loc = makeLoc(LANG);

/** The card kind this feature registers an outcome writer for. */
export const MANEUVER_SAVE_KIND = "maneuverSave";

/** Whether an actor rides a mount or carries a rider. */
const mountedOrCarrying = (actor) => !!mountOf(actor) || !!riderOf(actor);

/**
 * The grip a target holds its weapon in: "two" or "one" where the target is a
 * character holding exactly one weapon, null where nothing says which weapon a
 * disarm would take or how it is held (a creature with no loadout, no weapon
 * held, several).
 */
function targetGrip(target) {
  if (target?.type !== ACTOR_TYPE.character) return null;
  const held = getLoadout(target).weapons;
  if (held.length !== 1) return null;
  const [{ item, profile }] = held;
  return heldGrip(target, item).twoHanded || isTwoHandedOnly(profile) ? "two" : "one";
}

/**
 * The save a maneuver asks of its target, read for one attack: `maneuverMods`
 * with the weapon's own qualities, the attacker's Combat Trickery, and, for a
 * disarm, the grip the target holds its weapon in. Alongside, `unread` names each
 * input the reading could not take, any of `struck` (sunder), `size` and `grip`;
 * the save is named on a card only where `unread` is empty and `targetSaveMod`
 * is a number.
 *
 * @param {{actor: object, weapon: object, key: string, target: object|null}} p  `target` is the struck actor
 * @param {{mounted?: Function}} [deps]  the mounted-or-carrying test, replaceable for a test
 * @returns {object|null}  `maneuverMods`' answer with `unread: string[]`, or null for an unknown maneuver
 */
export function maneuverSaveMods({ actor, weapon, key, target }, { mounted = mountedOrCarrying } = {}) {
  const m = MANEUVERS[key];
  if (!m) return null;
  const profile = classifyWeapon(weapon);
  const grip = m.save && key === "disarm" ? targetGrip(target) : null;
  const mods = maneuverMods(actor, profile, key, { hooked: profile.hooked, targetTwoHanded: grip === "two" });
  const unread = [];
  if (m.save) {
    if (m.shaftVariant) unread.push("struck");
    if (m.sizeAdjusted) {
      const mine = sizeKeyOf(actor);
      if (!mine || mine !== sizeKeyOf(target) || mounted(actor) || mounted(target)) unread.push("size");
    }
    if (key === "disarm" && grip === null) unread.push("grip");
  }
  return { ...mods, unread };
}

/** The part names a save modifier's tooltip lists. */
const partName = (part) => loc(`maneuverSave.part.${part}`);

/**
 * The argument of lib's `postOutcomeCard` for one maneuver, or null where nothing
 * is asked: the attack did not hit, struck no token, or the maneuver calls no
 * save. The save is named, with the modifier's tooltip naming its parts and the
 * page, only where `mods` read it whole (`maneuverSaveMods`); a card whose
 * save cannot be read has a blank save name and no figure. A modifier of zero is
 * left off, and a positive one helps the saver.
 *
 * @param {{maneuver: string, isHit: boolean, target: {uuid: string, name?: string}|null, attacker: {uuid: string, name?: string}, weapon?: {uuid?: string}, mods?: object|null}} p
 * @returns {object|null}
 */
export function maneuverSavePost({ maneuver, isHit, target, attacker, weapon, mods } = {}) {
  const m = MANEUVERS[maneuver];
  if (isHit !== true || !target?.uuid || !m?.save) return null;
  const read = !!mods && Number.isFinite(mods.targetSaveMod) && !(mods.unread ?? []).length;
  const mod = read && mods.targetSaveMod !== 0 ? mods.targetSaveMod : null;
  const parts = read ? (mods.saveParts ?? []).map((p) => `${partName(p.part)} ${signedFigure(p.value)}`).join(" · ") : "";
  const attackerName = attacker?.name ?? "";
  const targetName = target.name ?? "";
  const cite = loc("maneuverSave.cite");
  return {
    kind: MANEUVER_SAVE_KIND,
    itemUuid: weapon?.uuid ?? "",
    title: loc("maneuverSave.title", { maneuver: m.label, attacker: attackerName, target: targetName }),
    subtitle: cite,
    subjects: [{ key: target.uuid, name: targetName }],
    saveName: read ? m.save : "",
    saveMod: mod,
    facts: {
      maneuver,
      cite,
      // A maneuver's save answers a blow, not a spell: no magical part rides it.
      saveMagical: false,
      ...(mod !== null && parts ? { saveLabel: loc("maneuverSave.saveLabel", { maneuver: m.label, parts }) } : {}),
    },
    speakerActorUuid: attacker?.uuid ?? "",
  };
}

/**
 * Settle one resolved attack: where it declared a maneuver that calls a save and
 * hit a target, read the save and post the card. Nothing is posted with the
 * maneuver overlay off. The post cannot fail the attack: an error in the read or
 * the post is logged and dropped.
 *
 * @param {{actor: object, item: object, ctx?: object, outcome?: object}} p
 * @param {{post?: Function, mounted?: Function}} [deps]  the card post (lib's `postOutcomeCard`) and the mounted test, replaceable for a test
 */
export function settleManeuver({ actor, item, ctx, outcome }, { post = postCard, mounted } = {}) {
  const key = ctx?.maneuver;
  if (!key || !MANEUVERS[key]?.save || outcome?.resolution?.isHit !== true || !overlayEnabled()) return;
  let card = null;
  try {
    const target = outcome?.result?.target ?? ctx?.target ?? null;
    const targetActor = ctx?.target?.actor ?? target?.actor ?? null;
    const mods = maneuverSaveMods({ actor, weapon: item, key, target: targetActor }, mounted ? { mounted } : {});
    card = maneuverSavePost({ maneuver: key, isHit: true, target, attacker: actor, weapon: item, mods });
  } catch (err) {
    console.error(`${MODULE_ID} | the maneuver's save could not be read`, err);
  }
  if (card) Promise.resolve(post(card)).catch((err) => console.error(`${MODULE_ID} | the maneuver save card could not be posted`, err));
}

/** Post a card through lib's item runner, loaded when first needed. */
async function postCard(card) {
  const { postOutcomeCard } = await import("../lib/item-run.mjs");
  return postOutcomeCard(card);
}

/**
 * The writer of a maneuver save card's outcome: nothing, whatever the verdict.
 * The card holds the verdict and the Judge applies what a failure does.
 *
 * @returns {{records: [], names: [], life: string}}
 */
export function maneuverSaveOutcome() {
  return { records: [], names: [], life: "raised" };
}

/**
 * Register the card's outcome writer with lib's item runner, which is loaded here
 * and not at import so the attack seam's own import of this file pulls in none of
 * it.
 */
export async function installManeuverSave() {
  const { registerPressOutcome } = await import("../lib/item-run.mjs");
  registerPressOutcome(MANEUVER_SAVE_KIND, maneuverSaveOutcome);
}
