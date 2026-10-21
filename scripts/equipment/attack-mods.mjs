/* global game */
/**
 * The per-weapon modifiers the equipment feature adds to the system's attack
 * throw, as the labelled rows the attack seam carries
 * (`lib/patches/attack-throw.mjs`), and the grip it offers as a damage mode.
 *
 * Always-on, loadout-level modifiers (fighting-style specialization, Combat
 * Reflexes, Swashbuckling) are folded into the system's own `system.*.mod`
 * fields by the managed loadout Active Effect. What cannot be a static actor
 * modifier is per weapon and per kind of attack, and is answered here:
 *
 *   - non-proficient use (RR 15): a character equipped with any weapon or
 *     armour unusable by their class, or an untrained fighting style, attacks
 *     with the untrained throw, and no attribute BONUS reaches the throw;
 *   - Weapon Finesse: DEX in place of STR on a tiny, small or medium melee
 *     weapon, when DEX is the better of the two;
 *   - a damage-attribute substitution (Strength of Faith): another score in
 *     place of STR on every damage roll STR modifies;
 *   - a weapon that takes no damage bonus (a torch): the body's bonuses are
 *     left off its die, its penalties stay;
 *   - a special manoeuvre declared with the attack: its attack penalty.
 *
 * The system adds STR to the damage of a melee and of a thrown attack itself,
 * so a hurled axe needs nothing from here. The two-handed die of a medium
 * weapon is the system's ALTERNATE damage mode: offered where the weapon
 * table prints one, and put first when the loadout already holds the weapon
 * in both hands, since the system opens on the first mode listed.
 *
 * Pure: every function reads documents and returns data, so
 * `tools/test-equipment.mjs` asserts them without Foundry.
 */
import { LANG, EFFECT_DOMAINS } from "./constants.mjs";
import { SIZE } from "./config.mjs";
import { getLoadout } from "./loadout.mjs";
import { classifyWeapon, canOneHand } from "./profiles.mjs";
import { isWeaponProficient } from "./proficiency.mjs";
import { hasEffectFlag, collectStringFlags } from "./effects.mjs";
import { maneuverMods, MANEUVERS, overlayEnabled as maneuverOverlayEnabled } from "./overlays/maneuvers.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";

/** Sizes eligible for Weapon Finesse (RR 121). */
const FINESSE_SIZES = [SIZE.TINY, SIZE.SMALL, SIZE.MEDIUM];

/**
 * The attack throw a character fights with while non-proficiently equipped
 * (RR 15): the throw of a character with no class. A character whose own
 * throw is no better loses nothing to it.
 */
export const UNTRAINED_ATTACK_THROW = 11;

/** The system's kinds of attack and damage modes, as its `ATTACK_TYPE` and `DAMAGE_MODE` spell them. */
export const ATTACK_TYPE = Object.freeze({ melee: "melee", missile: "missile", thrown: "thrown" });
export const DAMAGE_MODE = Object.freeze({ base: "base", alternate: "alternate" });

const num = (v) => Number(v ?? 0) || 0;
const abilityMod = (actor, key) => num(actor?.system?.scores?.[key]?.mod);
const label = (key, data, fallback) => {
  const full = `${LANG}.attack.${key}`;
  return game?.i18n?.has?.(full) ? game.i18n.format(full, data) : fallback;
};

/**
 * How much a damage-attribute substitution changes a damage roll STR
 * modifies: the DIFFERENCE between the substitute and STR, so equal scores
 * cancel to nothing. An attribute the actor does not carry is a typo in
 * someone's ability, not a substitution.
 * @returns {{delta:number, attribute:string}|null} null when nothing applies.
 */
export function damageAttributeDelta(actor) {
  const [attribute] = collectStringFlags(actor, EFFECT_DOMAINS.DAMAGE_ATTRIBUTE);
  if (!attribute) return null;
  const scores = actor.system?.scores ?? {};
  if (scores[attribute]?.mod == null) return null;
  const delta = Number(scores[attribute].mod) - Number(scores.str?.mod ?? 0);
  return Number.isFinite(delta) && delta !== 0 ? { delta, attribute } : null;
}

/**
 * What this feature knows of one weapon in a character's hands: its profile,
 * its loadout entry, and whether the character fights non-proficiently —
 * because of this weapon or of anything else equipped. Null for a body that
 * is not a character or an item that is not a weapon: a monster's natural
 * attacks are not proficiency-gated.
 */
function weaponContext(actor, item) {
  if (actor?.type !== ACTOR_TYPE.character || item?.type !== ITEM_TYPE.weapon) return null;
  const profile = classifyWeapon(item);
  const loadout = getLoadout(actor);
  const entry = item.id ? (loadout.weapons.find((w) => w.item.id === item.id) ?? null) : null;
  const proficient = entry ? entry.proficient : isWeaponProficient(actor, profile);
  return { profile, loadout, entry, nonProficient: !!loadout.nonProficientUse || !proficient };
}

/**
 * The rows this feature adds to the attack throw of one attack.
 *
 * Non-proficient use is one labelled row for the whole package — the untrained
 * throw and the cancelled attribute bonus — so the reader sees why the throw
 * dropped, not a weapon that seems to carry a penalty of its own. Weapon
 * Finesse is the character's election, so it applies only when DEX is the
 * better score, and never while non-proficiently equipped, when no attribute
 * grants a bonus to swap.
 *
 * @param {Actor} actor
 * @param {Item} item  the weapon
 * @param {string} attackType  the system's kind: melee, missile or thrown
 * @param {{maneuver?: string|null}} [options]  a manoeuvre declared with the attack
 * @returns {Array<{label: string, value: number}>}
 */
export function attackThrowRows(actor, item, attackType, { maneuver = null } = {}) {
  const c = weaponContext(actor, item);
  if (!c) return [];
  const rows = [];
  if (c.nonProficient) {
    const level = num(actor.system?.details?.level ?? 1);
    let penalty = 0;
    // 1st level and up attacks with the untrained throw; a character with no
    // level already fights with it and takes a further −1 instead.
    if (level >= 1) penalty += num(actor.system?.attack?.throw ?? 10) - UNTRAINED_ATTACK_THROW;
    else penalty -= 1;
    // No attribute BONUS on the throw, whatever the level: a penalty is not a
    // bonus and still applies, so only a positive modifier is cancelled. The
    // system adds STR to a melee throw and DEX to the others.
    const attr = abilityMod(actor, attackType === ATTACK_TYPE.melee ? "str" : "dex");
    if (attr > 0) penalty -= attr;
    if (penalty) rows.push({ label: label("nonProficient", {}, "Non-proficient"), value: penalty });
  } else if (
    attackType === ATTACK_TYPE.melee &&
    FINESSE_SIZES.includes(c.profile.size) &&
    hasEffectFlag(actor, EFFECT_DOMAINS.FINESSE)
  ) {
    const str = abilityMod(actor, "str");
    const dex = abilityMod(actor, "dex");
    if (dex > str) rows.push({ label: label("finesse", {}, "Weapon Finesse"), value: dex - str });
  }
  if (maneuver && MANEUVERS[maneuver] && maneuverOverlayEnabled()) {
    const man = maneuverMods(actor, c.profile, maneuver);
    if (man?.attackPenalty) rows.push({ label: MANEUVERS[maneuver].label, value: man.attackPenalty });
  }
  return rows;
}

/**
 * The damage roll's rows from the attacker, as this feature leaves them.
 *
 * A weapon that takes no damage bonus deals its bare die: every positive row
 * the body brings is left out and every penalty stays. Otherwise a
 * damage-attribute substitution adds its difference to every roll STR
 * modifies — a melee attack, a thrown weapon at range — which the system has
 * already given STR.
 *
 * @param {Actor} actor
 * @param {Item} item  the weapon
 * @param {string} attackType
 * @param {Array<{label: string, value: number|string}>} rows  the attacker's rows so far
 * @returns {Array<{label: string, value: number|string}>}
 */
export function damageRows(actor, item, attackType, rows) {
  const c = weaponContext(actor, item);
  if (!c) return rows;
  const special = c.profile.special ?? [];
  if (special.includes("noDamageBonus")) return rows.filter((m) => !(typeof m.value === "number" && m.value > 0));
  if (attackType !== ATTACK_TYPE.melee && attackType !== ATTACK_TYPE.thrown) return rows;
  const sub = damageAttributeDelta(actor);
  if (!sub) return rows;
  const attribute = sub.attribute.toUpperCase();
  return [...rows, { label: label("substitute", { attribute }, `${attribute} for Strength`), value: sub.delta }];
}

/**
 * The kinds of attack a weapon offers: the system's own, and the throw the
 * weapon table knows of where the item does not declare one.
 */
export function attackTypesFor(item, types) {
  if (item?.type !== ITEM_TYPE.weapon) return types;
  const out = [...types];
  if (classifyWeapon(item).thrown && !out.includes(ATTACK_TYPE.thrown)) out.push(ATTACK_TYPE.thrown);
  return out;
}

/**
 * The damage modes a weapon offers for one kind of attack, first mode the
 * default. A medium melee weapon the table prints a two-handed die for
 * offers the ALTERNATE mode whether or not the item has one written in; the
 * mode asked for — by the caller, else by a loadout that already holds the
 * weapon in both hands — goes first.
 *
 * @param {Actor|null} actor
 * @param {Item} item
 * @param {string} attackType
 * @param {string[]} modes  the system's answer
 * @param {string|null} [preferred]  the mode a caller asked to open on
 */
export function damageModesFor(actor, item, attackType, modes, preferred = null) {
  if (item?.type !== ITEM_TYPE.weapon) return modes;
  const profile = classifyWeapon(item);
  let out = [...modes];
  if (attackType === ATTACK_TYPE.melee && profile.damage2h && canOneHand(profile) && !out.includes(DAMAGE_MODE.alternate)) {
    out.push(DAMAGE_MODE.alternate);
  }
  let want = preferred;
  if (!want && actor?.type === ACTOR_TYPE.character && item.id) {
    const entry = getLoadout(actor).weapons.find((w) => w.item.id === item.id);
    if (entry?.wieldTwoHanded) want = DAMAGE_MODE.alternate;
  }
  if (want && out.includes(want)) out = [want, ...out.filter((m) => m !== want)];
  return out;
}

/** The die a damage mode deals: the system's, else the table's two-handed die for an ALTERNATE the item leaves blank. */
export function damageFormulaFor(item, mode, formula) {
  if (mode !== DAMAGE_MODE.alternate || String(formula ?? "").trim()) return formula;
  if (item?.type !== ITEM_TYPE.weapon) return formula;
  return classifyWeapon(item).damage2h ?? formula;
}
