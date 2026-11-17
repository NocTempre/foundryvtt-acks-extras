/* global Roll */
/**
 * A saving throw as a named list of parts: what the roll adds, what the
 * target is lowered by, and the throw made from them. The system's own
 * `rollSave` posts a card and asks a dialog per call; a feature rolling for
 * several creatures at once composes the same parts here and posts one card.
 *
 * `saveSpec` is pure. It reads the creature's stored target, the roll's
 * bonuses the system adds (a character's modifier against magic and its
 * Wisdom modifier, only when the throw is against magic), the creature's
 * conditions through `rollMath("save", …)` the way the conditions' own
 * wrapper lowers the target, the `save` parts of the creature's records
 * (`roll-mods.mjs`, scoped against what the throw is made against), the
 * creature's defenses against the damage the throw resists (`defenses.mjs`,
 * only when the caller names the damage), and whatever the caller adds.
 * `saveThrow` rolls
 * the spec. It never takes states off the creature: the loss a failed save
 * costs is the caller's, through `loseStates` (`status-effects.mjs`), so one
 * place decides who is asked to write it.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { rollMath, subjectOf } from "./conditions.mjs";
import { saveKindOf } from "./actor-compat.mjs";
import { actorDefenses, defenseFigures, defenseSaveParts } from "./defenses.mjs";
import { saveModParts } from "./roll-mods.mjs";
import { locOr } from "./util.mjs";
import { ACTOR_TYPE } from "./vocab.mjs";

/** A finite number from a number or numeric text, else null. */
const figure = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One formula term with an explicit sign, written as the system writes a modifier: `+ 2`, `- 1`, `+ 1d4`. */
function termOf(value) {
  const text = String(value).trim();
  const sign = text.startsWith("-") ? "-" : "+";
  return `${sign} ${text.replace(/^[+-]\s*/, "")}`;
}

/** The wording of one part's label: the lang string, else the plain fallback. */
const word = (key, fallback) => locOr(`${LANG_PREFIX}.saves.part.${key}`, fallback);

/**
 * The throw one creature makes against one saving-throw key, as parts.
 *
 * A part is `{key, label, value, side}`. A `roll` part's value is added to
 * the die; a `target` part's value is the figure that LOWERS the number to
 * roll, so a positive value helps the roller on either side. A roll's number
 * parts are summed into one signed term (`1d20 + 3`); a part that is not a
 * number (`1d4`) is appended as written. A part of zero adds nothing and is
 * not listed.
 *
 * @param {Actor} actor
 * @param {string} save  the system's key for the throw
 * @param {object} [options]
 * @param {boolean} [options.magical=true]  the throw is against magic: a character's own modifier and Wisdom modifier join the roll
 * @param {boolean} [options.conditions=true]  the creature's conditions lower the target
 * @param {number|string|null} [options.situational]  a figure for this one throw
 * @param {Array<{key: string, label: string, value: number|string}>} [options.parts]  the caller's parts on the roll
 * @param {object} [options.values]  the conditions' registered figures, in place of the world's
 * @param {{actor: object, token?: object}|null} [options.against]  what the throw is made against: the saver's scoped `save` parts (`roll-mods.mjs`) are settled against it
 * @param {object|null} [options.bearerToken]  the saver's token, read for an enemy test against `against.token`
 * @param {boolean} [options.rollMods=conditions]  the saver's records' `save` parts join the target; off with the conditions, so a caller that opts out of the one opts out of the other
 * @param {{types?: Iterable<string>, extraordinary?: boolean|null, silver?: boolean}|null} [options.damage]  the damage the throw resists (`extraordinary` null or absent is a quality not stated, which a band waiting on it sends to `pending`): the saver's defenses (`defenses.mjs`) then join the throw, and the spec carries `auto`. Absent, the spec has no defense part and no `auto` key
 * @param {{sources?: object[], figures?: object}} [options.defenses]  the defenses read and the resistance's figures, in place of the saver's own (`actorDefenses`) and the world's (`defenseFigures`)
 * @returns {{save: string, kind: string, formula: string, baseTarget: number|null,
 *   target: number|null, parts: Array<{key: string, label: string, value: number|string, side: "roll"|"target"}>,
 *   pending: Array<{condition: string, value: number, when: string}|{label: string, value: number, when: "source"}|{label: string, value: null, when: "defense", why?: string}>, unpriced: string[],
 *   auto?: {label: string, source: string, types: string[]}|null}}
 *   a condition's pending row names its `condition`; a record's names its `label`; a defense's has no figure
 *   (blank, or the Judge's case) and says so by `when: "defense"`. `auto` (only with `damage`) is a success with
 *   no roll: every type dealt is one the saver is immune to
 */
export function saveSpec(
  actor,
  save,
  { magical = true, conditions = true, situational = null, parts = [], values, against = null, bearerToken = null, rollMods = conditions, damage = null, defenses = null } = {},
) {
  const kind = saveKindOf(save);
  const stored = actor?.system?.saves?.[save]?.value;
  const baseTarget = typeof stored === "number" && Number.isFinite(stored) ? stored : null;

  const rollParts = [];
  if (magical && actor?.type === ACTOR_TYPE.character) {
    rollParts.push({ key: "saveMod", label: word("saveMod", "Save modifier"), value: actor.system?.save?.mod ?? 0, side: "roll" });
    rollParts.push({ key: "wis", label: word("wis", "Wisdom"), value: actor.system?.scores?.wis?.mod ?? 0, side: "roll" });
  }
  if (situational !== null && situational !== undefined && String(situational).trim() !== "") {
    rollParts.push({ key: "situational", label: word("situational", "Situational"), value: situational, side: "roll" });
  }
  for (const part of parts ?? []) {
    if (part && part.value !== null && part.value !== undefined) rollParts.push({ side: "roll", ...part });
  }
  const listed = rollParts.filter((p) => figure(p.value) !== 0);
  const sum = listed.reduce((total, p) => total + (figure(p.value) ?? 0), 0);
  let formula = "1d20";
  if (sum !== 0) formula += ` ${termOf(sum)}`;
  for (const p of listed) if (figure(p.value) === null && String(p.value).trim()) formula += ` ${termOf(p.value)}`;

  const targetParts = [];
  let pending = [];
  let unpriced = [];
  let shift = 0;
  if (conditions) {
    const subject = subjectOf(actor);
    if (subject?.statuses && [...subject.statuses].length) {
      const math = rollMath("save", subject, values, { save: kind });
      shift = math.total;
      pending = math.pending;
      unpriced = math.unpriced;
      for (const p of math.parts) {
        if (p.value) targetParts.push({ key: p.condition, label: locOr(`${LANG_PREFIX}.condition.${p.condition}`, p.condition), value: p.value, side: "target" });
      }
    }
  }
  if (rollMods) {
    const mods = saveModParts(actor, { against, bearerToken });
    for (const p of mods.parts) {
      targetParts.push(p);
      shift += p.value;
    }
    pending = [...pending, ...mods.pending];
  }
  let auto;
  if (damage) {
    const made = defenseSaveParts(defenses?.sources ?? actorDefenses(actor), damage, defenses?.figures ?? defenseFigures());
    for (const p of made.parts) {
      targetParts.push(p);
      shift += p.value;
    }
    pending = [...pending, ...made.pending];
    auto = made.auto;
  }
  return {
    save,
    kind,
    formula,
    baseTarget,
    target: baseTarget === null ? null : baseTarget - shift,
    parts: [...listed, ...targetParts],
    pending,
    unpriced,
    ...(damage ? { auto } : {}),
  };
}

/**
 * Make the throw `saveSpec` describes. With no target the creature has no
 * throw to make: nothing is rolled and `roll`, `total` and `success` are null.
 * A total at or above the target succeeds. A spec with `auto` is a success
 * with nothing rolled: `roll` and `total` are null and `success` is true, with
 * or without a target.
 *
 * @param {Actor} actor
 * @param {string} save
 * @param {object} [options]  `saveSpec`'s, and
 * @param {(formula: string) => Promise<{total: number}>} [options.roll]  the roll, in place of a Foundry `Roll`
 * @returns {Promise<{roll: object|null, total: number|null, success: boolean|null} & ReturnType<typeof saveSpec>>}
 */
export async function saveThrow(actor, save, { roll = null, ...options } = {}) {
  const spec = saveSpec(actor, save, options);
  if (spec.auto) return { ...spec, roll: null, total: null, success: true };
  if (spec.target === null) return { ...spec, roll: null, total: null, success: null };
  const made = roll ? await roll(spec.formula) : await new Roll(spec.formula).evaluate();
  const total = Number(made?.total);
  return { ...spec, roll: made, total, success: total >= spec.target };
}
