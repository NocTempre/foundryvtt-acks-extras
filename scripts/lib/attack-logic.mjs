/**
 * Attack-roll logic (pure, Foundry-free) — the corrected ACKS attack model.
 * An explicit throw target (the moving target) and an explicit bonus-term
 * list, replacing core's folded `bba = 10 − throw` resolution; used by lib's
 * core patch (patches/attack-roll.mjs). See docs/lib/DECISIONS.md, "One owner
 * for the attack roll, and one seam for future modifiers".
 *
 * Hit test (identical outcome to core's, restated in RAW form):
 *   d20 + Σbonuses ≥ throw + targetAC        (ascending AC; unarmored man = 0)
 * with the die specials preserved: a natural 1 always misses and a natural 20
 * always hits UNLESS exploding 20s are in play (then the die is open-ended and
 * carries no auto-result), exactly as core resolves them.
 */
import { toNum as num } from "./util.mjs";


/**
 * Build the bonus-term stack for one attack. Zero terms are dropped (they add
 * nothing and would pad the audit); keys are stable so replacer/dedup logic can
 * address them.
 *
 * @param {object} p
 * @param {"melee"|"missile"|"attack"} p.type  monster natural attacks are "attack"
 * @param {number} [p.abilityMod]   STR (melee) or DEX (missile) modifier
 * @param {number} [p.attackMod]    core `thac0.mod.melee|missile` (class/misc adjustment)
 * @param {number} [p.itemBonus]    the weapon's own bonus (magic, quality — and the
 *                                  channel acks-equipment's wrapper feeds deltas through)
 * @returns {Array<{key: string, value: number}>}
 */
export function attackTerms({ type, abilityMod = 0, attackMod = 0, itemBonus = 0 }) {
  const terms = [];
  if (type === "melee" || type === "missile") {
    if (num(abilityMod)) terms.push({ key: "ability", value: num(abilityMod) });
    if (num(attackMod)) terms.push({ key: "adjustment", value: num(attackMod) });
  }
  if (num(itemBonus)) terms.push({ key: "weapon", value: num(itemBonus) });
  return terms;
}

/** Sum of a term stack. */
export const termTotal = (terms) => (terms ?? []).reduce((s, t) => s + num(t?.value), 0);

/**
 * Resolve one attack.
 *
 * @param {object} p
 * @param {number} p.die           natural result of the d20 (first die total)
 * @param {number} p.bonus         Σ of all bonus terms (roll total − die)
 * @param {number} p.throwTarget   the attack throw (the moving target, e.g. 10)
 * @param {number} [p.targetAc]    defender's ascending AC; no target resolves vs 0,
 *                                 matching core
 * @param {boolean} [p.exploding]  the exploding-20s optional rule is on
 * @returns {{isSuccess: boolean, isFailure: boolean, isCritical: boolean,
 *            isFumble: boolean, total: number, acHit: number, effectiveTarget: number}}
 */
export function resolveAttack({ die, bonus = 0, throwTarget, targetAc = 0, exploding = false }) {
  const total = num(die) + num(bonus);
  const T = num(throwTarget, 10);
  const ac = num(targetAc);
  // Highest AC this roll hits: d20+bonuses ≥ T+X  ⇔  X ≤ total − T.
  const acHit = total - T;
  const out = {
    isSuccess: false,
    isFailure: false,
    isCritical: false,
    isFumble: false,
    total,
    acHit,
    effectiveTarget: T + ac,
  };
  if (die === 1 && !exploding) {
    out.isFailure = true;
    out.isFumble = true;
    return out;
  }
  if (die === 20 && !exploding) {
    out.isSuccess = true;
    out.isCritical = true;
    return out;
  }
  if (acHit >= ac) out.isSuccess = true;
  else out.isFailure = true;
  return out;
}

/**
 * Core's legacy resolution, kept ONLY as a parity oracle for tests: the folded
 * form `die + (10 − throw) + bonus ≥ targetAC + 10` with the same die specials.
 */
export function legacyCoreResolves({ die, bonus = 0, throwTarget, targetAc = 0, exploding = false }) {
  const bba = 10 - num(throwTarget, 10);
  const total = num(die) + bba + num(bonus);
  if (die === 1 && !exploding) return false;
  if (total < num(targetAc) + 10 && (die < 20 || exploding)) return false;
  return true;
}
