/* global foundry, game, Roll, ChatMessage, ui */
/**
 * The ability roller: the Rolls tab's buttons and, through roll-wrap.mjs, every
 * other route the game rolls an ability by.
 *
 * An ability's throws live in `flags["acks-extras"].extras.rolls` (core's item
 * holds one). `rollsOf()` is the only read — it folds core's singleton fields
 * in — and `writeRolls()` the only write. Targets resolve against the
 * CHARACTER (rank or level); a shared world item shows the ladder instead.
 */
import { MODULE_ID, FLAG_EXTRAS, ABILITY_TYPE } from "./constants.mjs";
import AbilityExtras from "./ability-extras.mjs";
import { slug, ATTRIBUTES, isMeasure, ITEM_TYPE, capabilityForId, satisfies } from "../lib/vocab.mjs";
import { cookbookId, byCookbookId } from "../lib/library.mjs";
import { resolveStacking } from "../lib/typed-modifiers.mjs";
import { throwResolution, recordParts } from "../lib/roll-mods.mjs";
import { hasCapability } from "../lib/capabilities.mjs";
import { abilityMod } from "../lib/actor-read.mjs";
import { escape as esc } from "../lib/util.mjs";
import { rollMath, subjectOf } from "../lib/conditions.mjs";
import { auditLine, rollDetailsDialog, situationalTerm, skipDialogFor } from "../lib/roll-dialog.mjs";
// The classes registry, not lib: lib cannot see the world's class documents,
// so it answers null for the `progression` kind a borrowed ladder uses.
import { resolveLevelOutcome } from "../classes/registry.mjs";

/**
 * An actor's rank in this ability: the count of same-named ability items it
 * carries (rank N is N copies).
 */
export function rankOf(actor, item) {
  if (!actor || !item) return 1;
  const mine = slug(item.name);
  const n = actor.items.filter((i) => i.type === item.type && slug(i.name) === mine).length;
  return Math.max(1, n);
}

/** The scales a target may be keyed on, for this actor holding this item. */
export function scalesFor(actor, item) {
  return {
    level: Number(actor?.system?.details?.level ?? actor?.system?.level ?? 1) || 1,
    rank: rankOf(actor, item),
  };
}

/** The vocabulary key a proficiency-throw modifier is written against. */
const THROW_TARGET = "proficiencyThrow";

/** Does `forWhat` name this ability? Splits the "A and B" the books write. */
const namesActivity = (forWhat, wanted) =>
  String(forWhat)
    .split(/\s*(?:,|\band\b|\bor\b|&|\/)\s*/i)
    .some((part) => slug(part) === wanted);

/**
 * The page an imported item's own stamp names, or the empty string: the
 * citation a figure's tooltip points at.
 */
export const citeOf = (item) => String(item?.flags?.[MODULE_ID]?.cookbook?.cite ?? item?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? "");

/** An ability as the `{id, provides}` a capability test reasons over. */
const refOf = (item) => ({ id: cookbookId(item) || null, provides: item?.getFlag?.(MODULE_ID, FLAG_EXTRAS)?.provides ?? [] });

/** The capabilities an ability provides, its own id's included, folded. */
const capsOf = (ref) => [...(ref.id ? [capabilityForId(ref.id)] : []), ...ref.provides.map((p) => String(p).toLowerCase())];

/**
 * The handle a spell record's `rollKey` is tested against: the throw's own key,
 * or the `roll<index>` that stands for a keyless one (`keyOf`). Undefined where
 * the caller names no throw, which sends every part scoped to a throw to pending.
 */
function handleOf(item, roll) {
  if (!roll) return undefined;
  if (roll.key) return roll.key;
  const index = rollsOf(item).indexOf(roll);
  return index >= 0 ? `roll${index}` : undefined;
}

/** What `throwResolution` answers for a bearer with no record on a throw. */
const noRecord = () => ({ outcome: "throw", add: [], total: 0, set: null, auto: null, dropped: [], pending: [] });

/**
 * What a bearer's spell records do to one throw: `throwResolution` over the
 * throw parts that name this ability, read live at the roll, so a part is gone
 * the moment its record ends. A `set` figure is read as the throw's own type
 * orients it (`below` makes the higher target the better).
 */
function recordThrow(actor, item, roll) {
  if (!actor || !item) return noRecord();
  return throwResolution(actor, { subject: refOf(item), rollKey: handleOf(item, roll), rollType: roll?.rollType || "above" });
}

/** A record's part as the `{label, cite, value}` a surface prints: the spell's name, its page and its figure. */
const spoken = (p) => ({ label: p.spell, cite: p.cite ?? "", value: p.value });

/**
 * What a verdict tells of its records, or null where no record touched the
 * throw: the part that made it automatic, the target a part set, the parts that
 * were added, those that yielded (each naming what it yielded to) and those that
 * could not be told.
 */
function recordNote(record, { set = record.set, added = record.add, yielded = [] } = {}) {
  const note = {
    auto: record.auto ? spoken(record.auto) : null,
    set: set ? spoken(set) : null,
    added: added.map(spoken),
    dropped: [...record.dropped.map((p) => ({ ...spoken(p), set: p.mode === "set", yieldsTo: p.yieldsTo })), ...yielded],
    pending: record.pending.map((p) => ({ label: p.label })),
  };
  return note.auto || note.set || note.added.length || note.dropped.length || note.pending.length ? note : null;
}

/**
 * The `modifies` rows of the character's abilities that act on a subject's
 * proficiency throw, after stacking.
 *
 * A row acts when its `target` is the proficiency throw, it is the holder's own
 * and additive, one of its `refs` names a capability the subject provides, and
 * every `ifHas` is held by the character. Two rows whose abilities provide one
 * capability, or that name each other in `notStacksWith`, do not stack: the
 * larger applies. A row scoped by `appliesToRoll` applies to that throw alone.
 *
 * @param {Actor} actor
 * @param {{id: string|null, provides: string[]}} subject what is being thrown: an
 *   ability's own reference, or the capability an Adventuring figure stands for
 * @param {object} [opts]
 * @param {object} [opts.roll] the throw being resolved
 * @param {boolean} [opts.unskilled] the subject is a figure the character holds
 *   no skill for: a row whose `ifHas` needs the subject itself is left out
 * @returns {{kept: Array<{label: string, value: number, cite: string, itemId: string}>,
 *   dropped: Array<{label: string, value: number, yieldsTo: string}>}}
 */
export function modifiesParts(actor, subject, { roll = null, unskilled = false } = {}) {
  const resolve = globalThis.acksExtras?.lib?.resolveLevelValue;
  const candidates = [];
  const seen = new Set();
  for (const other of actor?.items ?? []) {
    if (other.type !== ITEM_TYPE.ability) continue;
    const name = slug(other.name);
    if (seen.has(name)) continue;
    seen.add(name);
    const extras = other.getFlag(MODULE_ID, FLAG_EXTRAS) ?? {};
    const ref = refOf(other);
    for (const effect of extras.effects ?? []) {
      if (effect?.type !== "modifies" || effect.target !== THROW_TARGET) continue;
      if ((effect.appliesTo ?? "self") !== "self") continue;
      if (effect.mode && effect.mode !== "add") continue;
      if (!(effect.refs ?? []).some((token) => satisfies([subject], token))) continue;
      const needs = effect.ifHas ?? [];
      if (unskilled && needs.some((token) => satisfies([subject], token))) continue;
      if (!needs.every((token) => hasCapability(actor, token))) continue;
      const scoped = String(effect.appliesToRoll ?? "");
      if (scoped && roll?.key !== scoped) continue;
      const scales = scalesFor(actor, other);
      const value = resolve ? resolve(effect.value, scales.level, scales) : (effect.value?.flat ?? null);
      if (typeof value !== "number" || !value) continue;
      candidates.push({
        label: other.name,
        value,
        cite: citeOf(other),
        itemId: other.id,
        ref,
        caps: capsOf(ref),
        stacksWith: effect.stacksWith ?? [],
        notStacksWith: effect.notStacksWith ?? [],
      });
    }
  }
  const { kept, dropped } = resolveStacking(candidates);
  return {
    kept: kept.map(({ label, value, cite, itemId }) => ({ label, value, cite, itemId })),
    dropped: dropped.map(({ label, value, yieldsTo }) => ({ label, value, yieldsTo })),
  };
}

/**
 * What this character's other abilities do to THIS ability's throws: the
 * proficiency-throw modifiers naming it in `forWhat`, and the `modifies` rows
 * naming a capability it provides (`modifiesParts`). Each ability counts once
 * (a second copy is rank, RR §III.3); one scoped by `appliesToRoll` applies to
 * that throw alone; a conditioned one naming no throw is returned in `pending`,
 * unapplied. See docs/abilities/DECISIONS.md, "A modifier must name what it
 * modifies, and may name the throw".
 *
 * A third source is the character's spell records (`recordThrow`): the bonuses
 * they add, resolved among themselves, join `bonus` and `parts`, each part
 * named for its spell with its page. The `set` and `auto` of a record are not
 * a bonus and belong to `throwOutcome`.
 *
 * @param {object} [roll] the throw being resolved; omit for the ability's
 *   unscoped total
 * @param {object} [opts]
 * @param {object} [opts.record] `throwResolution`'s answer for this throw, when the caller already holds it
 * @returns {{bonus: number, pending: Array<{name: string, amount: number, condition: string}>,
 *   parts: Array<{label: string, value: number, cite: string, itemId: string|null}>}}
 *   `parts` itemizes `bonus`, one entry per ability or spell record that contributed
 */
export function throwModifiers(actor, item, roll = null, { record = null } = {}) {
  const out = { bonus: 0, pending: [], parts: [] };
  if (!actor || !item) return out;
  const mine = slug(item.name);
  const resolve = globalThis.acksExtras?.lib?.resolveLevelValue;

  const seen = new Set();
  for (const other of actor.items ?? []) {
    if (other.type !== item.type) continue;
    const name = slug(other.name);
    if (seen.has(name)) continue;
    seen.add(name);

    for (const effect of other.getFlag(MODULE_ID, FLAG_EXTRAS)?.effects ?? []) {
      if (effect?.type !== "modifier" || effect.target !== THROW_TARGET) continue;
      // A penalty imposed on the ability's victims is not its holder's.
      if ((effect.appliesTo ?? "self") !== "self") continue;
      if (effect.mode && effect.mode !== "add") continue;
      // `forWhat` may name several activities; any member matching is a match.
      if (!effect.forWhat || !namesActivity(effect.forWhat, mine)) continue;

      const scales = scalesFor(actor, other);
      const amount = resolve ? resolve(effect.value, scales.level, scales) : (effect.value?.flat ?? null);
      if (typeof amount !== "number" || !amount) continue;

      const scoped = String(effect.appliesToRoll ?? "");
      if (scoped) {
        // Named a throw: it applies to that one and to no other.
        if (roll && roll.key === scoped) {
          out.bonus += amount;
          out.parts.push({ label: other.name, value: amount, cite: citeOf(other), itemId: other.id });
        }
        continue;
      }
      if (effect.condition) out.pending.push({ name: other.name, amount, condition: effect.condition });
      else {
        out.bonus += amount;
        out.parts.push({ label: other.name, value: amount, cite: citeOf(other), itemId: other.id });
      }
    }
  }

  for (const part of modifiesParts(actor, refOf(item), { roll }).kept) {
    out.bonus += part.value;
    out.parts.push(part);
  }
  for (const part of (record ?? recordThrow(actor, item, roll)).add) {
    out.bonus += part.value;
    out.parts.push({ ...spoken(part), itemId: null });
  }
  return out;
}

/** A number with its sign always shown. */
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

/**
 * Is this throw a MEASURE — dice with nothing to beat? The one predicate every
 * surface asks; a measure and an unresolved target both carry a null target.
 */
export const measures = (roll) => isMeasure(roll?.rollType);

/**
 * What a throw is called when it has no label of its own: the unnamed-throw
 * wording, or the unnamed-measure wording for a measure.
 */
export const labelOf = (roll) =>
  roll?.label || game.i18n.localize(measures(roll) ? "ACKS-ABILITIES.roll.unnamedMeasure" : "ACKS-ABILITIES.roll.unnamed");

/**
 * What an ability score contributes to this throw — its modifier times
 * `times` — or null when the throw declares no score or there is no character.
 *
 * @param {object} roll the throw
 * @param {Actor} actor the character holding it
 * @returns {{key: string, label: string, times: number, mod: number, bonus: number}|null}
 */
export function scoreTerm(roll, actor) {
  const key = roll?.score?.key;
  if (!key || !actor) return null;
  const mod = abilityMod(actor, key);
  const raw = Number(roll.score.times ?? 1);
  // A blank multiplier reads as once, never as zero.
  const times = Number.isFinite(raw) ? raw : 1;
  return { key, label: ATTRIBUTES[key]?.label ?? key.toUpperCase(), times, mod, bonus: mod * times };
}

/**
 * Does a throw's score term move its target? Not on an exact-match throw or a
 * measure, where the term is stated rather than applied. Every surface that
 * prints the term asks here.
 */
export const scoreApplies = (roll) => {
  const type = roll?.rollType || "above";
  return type !== "result" && type !== "measure";
};

/**
 * A score term as one line — "WIL +2", or "WIL +2 × 4 = +8" when multiplied —
 * written as the modifier, not the target it moved. Given a throw the term does
 * not move, the line says where it lands instead: in a measure's result, or
 * nowhere on an exact-match throw.
 */
export function scoreText(term, roll = null) {
  const written = scoreWritten(term);
  if (!written || !roll || scoreApplies(roll)) return written;
  const key = measures(roll) ? "ACKS-ABILITIES.roll.scoreInResult" : "ACKS-ABILITIES.roll.scoreUnapplied";
  return game.i18n.format(key, { term: written });
}

/** The term as the modifier it is written as, with no claim about the target. */
function scoreWritten(term) {
  if (!term) return "";
  const where = { score: term.label, mod: signed(term.mod) };
  return term.times === 1
    ? game.i18n.format("ACKS-ABILITIES.roll.scoreTerm", where)
    : game.i18n.format("ACKS-ABILITIES.roll.scoreTermTimes", { ...where, times: term.times, total: signed(term.bonus) });
}

/**
 * What a throw comes to for this character — the whole verdict, read at the
 * roll's own `scale` and resolved through the classes registry (which completes
 * the `progression` kind lib cannot see).
 *
 * @param {object} [opts]
 * A spell record on the character acts here, the one place every surface reads:
 * a record's `auto` answers "auto" with no roll, a `set` target is the figure
 * the throw is rolled against (the better of two by the throw's type, and
 * nothing else is added to it but the character's conditions), and a record's
 * bonuses join `parts`. `record` on the answer names what each did.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.conditions=true] fold the character's conditions into
 *   the target; false leaves them out, for a caller whose own roll applies them
 * @param {number|null} [opts.level] read the target at this level, not the character's (a granted proficiency's `atLevel`)
 * @param {{spell: string, cite: string, value: number|null}|null} [opts.grant] a granted proficiency's set target,
 *   which competes with a record's own `set`; a null `value` is a blank figure and leaves the target unresolved
 * @returns {{outcome: string, target: number|null, text: string,
 *   parts?: Array<{kind: string, label: string, value: number, cite: string}>,
 *   record?: {auto: object|null, set: object|null, added: object[], dropped: object[], pending: object[]}}}
 *   `outcome` is "throw" (roll against `target`), "auto" (no roll — it happens)
 *   or "none" (not available to this character yet); `text` is the printed cell.
 *   `parts` itemizes what moved the target, one entry per ability, spell, score and
 *   conditions source, and is present on a throw. `record` is present only where a spell touched it.
 */
export function throwOutcome(roll, actor, item, { conditions = true, level = null, grant = null } = {}) {
  const none = (target = null, text = "") => ({ outcome: "throw", target, text });
  // A measure has no target, whatever the target fields still hold.
  if (measures(roll)) return none();
  const record = recordThrow(actor, item, roll);
  if (record.auto) return { outcome: "auto", target: null, text: "", record: recordNote(record) };
  const set = betterTarget(roll?.rollType || "above", [grant, record.set]);
  if (set) {
    const standing = conditions && actor ? conditionParts(actor) : [];
    const to = set.cite ? `${set.spell} (${set.cite})` : set.spell;
    const yielded = [
      ...record.add.map((p) => ({ ...spoken(p), yieldsTo: to })),
      ...[grant, record.set].filter((p) => p && p !== set).map((p) => ({ ...spoken(p), set: true, yieldsTo: to })),
    ];
    return {
      outcome: "throw",
      target: set.value == null ? null : withModifiers(Number(set.value), roll, standing),
      text: "",
      parts: itemized(standing),
      record: recordNote(record, { set, added: [], yielded }),
    };
  }
  const target = roll?.target;
  const scales = scalesFor(actor, item);
  if (level != null) scales.level = level;
  const at = scales[roll?.scale || "level"];
  // A scale nothing here supplies (Arcane Value, Hit Dice): a flat target still
  // answers; a ladder does not, and the sheet shows it whole.
  if (at == null) return none((target?.kind ?? "flat") === "flat" ? (target?.flat ?? null) : null);

  let verdict;
  try {
    verdict = resolveLevelOutcome(target, at, scales);
  } catch (err) {
    console.error(`${MODULE_ID} | could not resolve a throw's target`, err);
    return none(target?.flat ?? null);
  }
  if (verdict.outcome !== "throw") return verdict;
  const parts = typeof verdict.target === "number" ? targetModifiers(roll, actor, item, { conditions, record }) : [];
  const note = recordNote(record);
  return { ...verdict, target: withModifiers(verdict.target, roll, parts), parts: itemized(parts), ...(note ? { record: note } : {}) };
}

/**
 * The target among `sets` the throw takes: the better figure by the throw's
 * type (the lower for "above" and an exact match, the higher for "below"), or
 * the first with no figure where none has one, or null with nothing to choose.
 */
function betterTarget(type, sets) {
  const live = sets.filter(Boolean);
  const figured = live.filter((p) => p.value != null && Number.isFinite(Number(p.value)));
  if (!figured.length) return live[0] ?? null;
  return figured.reduce((best, p) => ((type === "below" ? Number(p.value) > Number(best.value) : Number(p.value) < Number(best.value)) ? p : best));
}

/** What a character's conditions do to a proficiency throw, as the one part they make, or none. */
function conditionParts(actor) {
  const value = rollMath("throw", subjectOf(actor)).total;
  return value ? [{ kind: "conditions", label: "", value }] : [];
}

/**
 * A throw's standing bonuses with the abilities' share broken out by ability:
 * one entry per source that moved the target, `kind` "abilities", "score" or
 * "conditions", `label` the ability's or the score's name (blank for
 * conditions) and `cite` the page an ability's import names.
 */
function itemized(parts) {
  return parts.flatMap((part) =>
    part.kind === "abilities" && part.parts?.length
      ? part.parts.map(({ label, value, cite }) => ({ kind: "abilities", label, value, cite }))
      : [{ kind: part.kind, label: part.label, value: part.value, cite: "" }],
  );
}

/**
 * How a throw READS on a control — "15+", "3-", "12", a measure's dice, the
 * cell a lettered rung prints, or "—" when nothing resolved.
 *
 * The one place this string is built, for every surface that shows it (the
 * Rolls tab, the expanded row's tag strip, Favorites, the cycle control's
 * tooltip).
 */
export function throwText(roll, actor, item) {
  if (measures(roll)) return roll?.formula || "1d20";
  return readText(roll, throwOutcome(roll, actor, item));
}

/** A verdict as the cell a control prints: the target with its sign, the table's cell, "auto", or "—". */
function readText(roll, { outcome, target, text }) {
  if (outcome !== "throw") return text || (outcome === "auto" ? game.i18n.localize("ACKS-ABILITIES.roll.autoShort") : "—");
  if (target == null) return text || "—";
  const type = roll?.rollType || "above";
  return `${target}${type === "below" ? "-" : type === "result" ? "" : "+"}`;
}

/**
 * Resolve a roll's target number, or null when it cannot be known here — the
 * number half of `throwOutcome`. An automatic or unavailable rung has none.
 */
export const targetOf = (roll, actor, item) => throwOutcome(roll, actor, item).target;

/**
 * The standing bonuses a throw's target carries, one entry per source that
 * contributes: other abilities' modifiers (`abilities`), the throw's score term
 * (`score`, labelled with the score's name) and what the character's
 * conditions do to a proficiency throw (`conditions`). The one place the three
 * are read, so the number a surface shows and the parts it itemizes agree.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.conditions=true] false leaves the conditions source out
 * @param {object} [opts.record] `throwResolution`'s answer for this throw, when the caller already holds it
 * @returns {Array<{kind: "abilities"|"score"|"conditions", label: string, value: number}>}
 *   sources that come to nothing are left out; `[]` with no character
 */
export function targetModifiers(roll, actor, item, { conditions = true, record = null } = {}) {
  if (!actor) return [];
  const term = scoreTerm(roll, actor);
  const mods = throwModifiers(actor, item, roll, { record });
  return [
    { kind: "abilities", label: "", value: mods.bonus, parts: mods.parts },
    { kind: "score", label: term?.label ?? "", value: term?.bonus ?? 0 },
    ...(conditions ? conditionParts(actor) : []),
  ].filter((part) => part.value);
}

/** The sum of a throw's standing bonuses. */
const modifierTotal = (parts) => parts.reduce((sum, part) => sum + part.value, 0);

/**
 * A resolved target with the character's standing bonuses folded in
 * (`targetModifiers`, already read by the caller). A bonus lowers an "above"
 * target and raises a "below" one; an exact-match throw takes neither. Applied
 * here, once, so every surface reads the same number.
 */
function withModifiers(target, roll, parts) {
  if (typeof target !== "number") return target;
  const bonus = modifierTotal(parts);
  if (!bonus) return target;
  const type = roll?.rollType || "above";
  if (type === "result") return target;
  return type === "below" ? target + bonus : target - bonus;
}

/**
 * Every roll an ability offers: the read path. Folds core's singleton fields
 * in when this module's store is empty; core's schema defaults (`1d20`,
 * target 0) are not a roll.
 *
 * @param {Item} item
 * @returns {object[]} rolls in presentation order (possibly empty)
 */
export function rollsOf(item) {
  const stored = item?.getFlag(MODULE_ID, "extras")?.rolls ?? [];
  if (stored.length) return stored;

  const s = item?.system ?? {};
  const hasTarget = Number(s.rollTarget ?? 0) !== 0;
  const hasFormula = !!s.roll && s.roll !== "1d20";
  if (!hasTarget && !hasFormula) return [];

  return [
    {
      key: "primary",
      label: "",
      formula: s.roll || "1d20",
      rollType: s.rollType || "above",
      target: { kind: "flat", flat: Number(s.rollTarget ?? 0) },
      scale: "level",
      condition: "",
    },
  ];
}

/**
 * The handle a roll answers to: its stored key, or `roll<index>` when it has
 * none. The one rule every lookup uses — never gate a lookup on the stored key
 * alone.
 */
export const keyOf = (roll, index) => roll?.key || `roll${index}`;

/** `base`, suffixed until nothing in `taken` holds it. */
function uniqueKey(base, taken) {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
  taken.add(key);
  return key;
}

/**
 * Give every roll a unique key. An existing key is never rewritten (macros and
 * importing modules hold it), and all existing keys are claimed before blank
 * ones are filled from labels.
 */
function settleKeys(rolls) {
  const settled = rolls.map((roll) => ({ ...roll }));
  const taken = new Set();
  for (const roll of settled) if (roll.key) roll.key = uniqueKey(roll.key, taken);
  settled.forEach((roll, i) => {
    if (!roll.key) roll.key = uniqueKey(slug(roll.label) || `roll${i}`, taken);
  });
  return settled;
}

/**
 * The key of the throw a bare roll reaches — the stored default, or the first.
 * A stored key naming no current throw (deleted, or re-imported away) reads as
 * the first; it is resolved on read, never repaired on write.
 */
export function defaultKeyOf(item) {
  const rolls = rollsOf(item);
  if (!rolls.length) return null;
  const stored = item?.getFlag(MODULE_ID, FLAG_EXTRAS)?.defaultRoll || "";
  const found = rolls.findIndex((r, i) => keyOf(r, i) === stored);
  return found >= 0 ? stored : keyOf(rolls[0], 0);
}

/** Make one throw the ability's default. Writes the key, never the index, so a reorder cannot move it. */
export async function setDefaultKey(item, key) {
  const raw = foundry.utils.deepClone(item.getFlag(MODULE_ID, FLAG_EXTRAS) ?? {});
  raw.defaultRoll = String(key ?? "");
  await item.update({ [`flags.${MODULE_ID}.${FLAG_EXTRAS}`]: AbilityExtras.normalize(raw) });
  return raw.defaultRoll;
}

/** The throw AFTER the current default, wrapping — what the cycle control steps to. */
export function nextKeyAfter(item, key) {
  const rolls = rollsOf(item);
  if (rolls.length < 2) return null;
  const keys = rolls.map((r, i) => keyOf(r, i));
  const at = keys.indexOf(key);
  return keys[(at + 1) % keys.length];
}

/** A new, empty roll — what "add a roll" puts in the list. */
export const blankRoll = () => ({
  key: "",
  label: "",
  formula: "1d20",
  rollType: "above",
  target: { kind: "flat", flat: null },
  scale: "level",
  score: { key: "", times: 1 },
  condition: "",
  note: "",
});

/** Every roll, as a detached copy safe to mutate and hand back to writeRolls. */
export const readRolls = (item) => foundry.utils.deepClone(rollsOf(item));

/**
 * Persist an ability's rolls: the write path. Settles keys first. An emptied
 * list also resets core's singleton roll fields to their schema initials, or
 * rollsOf() would fold the deleted throw back in.
 */
export async function writeRolls(item, rolls) {
  const settled = settleKeys(rolls);
  const raw = foundry.utils.deepClone(item.getFlag(MODULE_ID, FLAG_EXTRAS) ?? {});
  raw.rolls = settled;
  let cleaned;
  try {
    cleaned = AbilityExtras.normalize(raw);
  } catch (err) {
    console.error(`${MODULE_ID} | roll normalization failed; saving as-is`, err);
    cleaned = raw;
  }
  const update = { [`flags.${MODULE_ID}.${FLAG_EXTRAS}`]: cleaned };
  if (!settled.length) {
    update["system.roll"] = "1d20";
    update["system.rollTarget"] = 0;
  }
  await item.update(update);
  return cleaned.rolls;
}

/**
 * The chat message mode for an ability's throws: "blind" when core's
 * ability-wide `system.blindroll` is set ("self" for a GM, as core's
 * `AcksDice.#sendRoll` does), else undefined for the seat's default. Mode names
 * are Foundry 14's `CONFIG.ChatMessage.modes` keys.
 */
function messageModeFor(item) {
  if (!item?.system?.blindroll) return undefined;
  return game.user?.isGM ? "self" : "blind";
}

/**
 * The die core's ability model starts a throw at: the initial value of its
 * `roll` field, read from the registered data model. "1d20" stands in only
 * where the model is not registered (a bare test harness).
 */
export function coreThrowDie() {
  const initial = globalThis.CONFIG?.Item?.dataModels?.[ABILITY_TYPE]?.schema?.fields?.roll?.initial;
  const die = typeof initial === "function" ? initial() : initial;
  return typeof die === "string" && die.trim() ? die.trim() : "1d20";
}

/**
 * A throw's formula, or core's own throw die when it is blank or unparseable.
 * An unparseable one also warns, naming the throw and the die used — Foundry's
 * parser would otherwise throw inside this async roller as an unhandled
 * rejection.
 */
function rollableFormula(roll, item) {
  const formula = String(roll?.formula ?? "").trim();
  const fallback = coreThrowDie();
  if (!formula) return fallback;
  if (Roll.validate(formula)) return formula;
  ui.notifications.warn(
    game.i18n.format("ACKS-ABILITIES.roll.badFormula", {
      name: [item?.name, roll?.label].filter(Boolean).join(" — ") || labelOf(roll),
      formula,
      fallback,
    }),
  );
  return fallback;
}

/**
 * The formula to roll: a measure's dice with its score term appended (in the
 * formula, not the total, so Foundry's dice box agrees); any other throw's
 * formula unchanged — its score is already in the target.
 */
function measuredFormula(roll, item, actor) {
  const formula = rollableFormula(roll, item);
  if (!measures(roll)) return formula;
  const bonus = scoreTerm(roll, actor)?.bonus ?? 0;
  return bonus ? `${formula} ${signed(bonus)}` : formula;
}

/**
 * The system's OWN throw card — the template it posts every save, reaction and
 * exploration roll through. Nothing here re-templates it, so a system restyle
 * carries ability throws along. See docs/abilities/DECISIONS.md, "A
 * proficiency throw wears the system's own chat card".
 */
const CARD_TEMPLATE = "systems/acks/templates/chat/roll-result.hbs";

/**
 * Why a scored throw has no target — a shared world item (no character to read
 * against), or an owned one below its ladder's first rung — or "" when it has
 * one.
 */
function missingTargetText(target, actor) {
  if (target != null) return "";
  return game.i18n.localize(actor ? "ACKS-ABILITIES.roll.noRung" : "ACKS-ABILITIES.roll.noTarget");
}

/**
 * Why a throw is automatic, as a sentence: the spell that made it
 * automatic where a record did, else the table's own cell.
 */
export function autoText(verdict) {
  const by = verdict?.record?.auto;
  if (by) return game.i18n.format("ACKS-ABILITIES.roll.autoRecord", { spell: by.cite ? `${by.label} (${by.cite})` : by.label });
  return game.i18n.format("ACKS-ABILITIES.roll.autoDetail", { cell: verdict?.text || "—" });
}

/**
 * The card's context in the shape core's template reads. The target rides
 * core's success row; the details slot carries the natural die behind a total
 * that is more than dice, the throw's condition and any unresolved-target
 * reason. A measure is unscored and carries no target line.
 */
async function cardData(item, actor, roll, { target, success, suffix, verdict, evaluated }) {
  const term = scoreTerm(roll, actor);
  const outcome = verdict?.outcome ?? "throw";
  const details = [
    evaluated ? esc(auditLine(evaluated)) : "",
    // An automatic or unavailable rung prints its cell, not a missing-target line.
    outcome !== "throw"
      ? esc(outcome === "auto" ? autoText(verdict) : game.i18n.format("ACKS-ABILITIES.roll.noneDetail", { cell: verdict.text || "—" }))
      : measures(roll)
        ? ""
        : esc(missingTargetText(target, actor)),
    // Names the score term that moved the target.
    term ? esc(scoreText(term, roll)) : "",
    roll.condition ? `<em>${esc(roll.condition)}</em>` : "",
  ].filter(Boolean).join("<br>");

  return {
    title: [item.name, roll.label].filter(Boolean).join(" — "),
    // The card carries its own dice: Foundry substitutes roll HTML only for
    // content with no child elements, and this template opens with a section.
    rollACKS: evaluated ? await evaluated.render() : null,
    data: {
      item: { img: item.img },
      actor: { img: actor?.img ?? item.img },
      // Core's template hides a blind card's body; the message mode withholds it.
      roll: { blindroll: !!item.system?.blindroll },
    },
    result: {
      details,
      isSuccess: success === true,
      isFailure: success === false,
      // On an automatic rung the success row carries the printed cell.
      target: outcome === "auto" ? verdict.text || game.i18n.localize("ACKS-ABILITIES.roll.autoShort") : target == null ? "" : `${target}${suffix}`,
    },
  };
}

/**
 * The throw a call reaches and what it comes to for the holder: the one named
 * by `key`, else the ability's default, else the first. No key means the
 * default throw: every route that cannot pass one arrives so.
 *
 * @param {Actor|null} [actor] the holder; the ability's own parent by default
 * @returns {{roll: object, actor: Actor|null, verdict: object}|null} null when the ability has no throw
 */
function pickThrow(item, key, actor = item.actor ?? null) {
  const rolls = rollsOf(item);
  const wanted = key ?? defaultKeyOf(item);
  const roll = rolls.find((r, i) => keyOf(r, i) === wanted) ?? rolls[0];
  if (!roll) return null;
  return { roll, actor, verdict: throwOutcome(roll, actor, item) };
}

/** Did this total meet this target? Null when no target is known; "above" meets or beats, "below" meets or stays under, "result" matches. */
function successOf(type, total, target) {
  if (target == null) return null;
  return type === "below" ? total <= target : type === "result" ? total === target : total >= target;
}

/**
 * Roll a throw's formula, with an optional situational term, and score it
 * against its target. The one place a throw is evaluated.
 */
async function castThrow({ base, extra, type, target }) {
  const evaluated = await new Roll(`${base}${situationalTerm(extra)}`).evaluate();
  return { evaluated, total: evaluated.total, success: successOf(type, evaluated.total, target) };
}

/**
 * Roll one of an ability's throws (its default when `key` is omitted) and
 * return what it came to, posting nothing and asking nothing. For a caller that
 * rolls several characters' throws and shows them on a card of its own.
 *
 * `outcome` is "throw" (rolled), "auto" (the rung needs no throw: `success` is
 * true, nothing was rolled) or "none" (not available to this character yet:
 * nothing was rolled). `target` is the number rolled against, with the
 * character's standing bonuses folded in; `base` is the same before them, and
 * `modifiers` itemizes the difference (`targetModifiers`), so a surface can
 * show where the number came from. Both are null on a measure and where no
 * target resolves.
 *
 * @param {Item} item
 * @param {string} [key] the throw; the ability's default when omitted
 * @param {object} [opts]
 * @param {number} [opts.bonus] a situational modifier, joined to the formula as its own term
 * @returns {Promise<{roll: object, actor: Actor|null, verdict: object, outcome: string, type: string, total: number|null, target: number|null, base: number|null, modifiers: Array<{kind: string, label: string, value: number}>, success: boolean|null, evaluated: Roll|null}|null>}
 *   null when the ability has no throw
 */
export async function evaluateThrow(item, key, { bonus = 0 } = {}) {
  const picked = pickThrow(item, key);
  if (!picked) return null;
  const { roll, actor, verdict } = picked;
  const type = roll.rollType || "above";
  const out = {
    roll,
    actor,
    verdict,
    outcome: verdict.outcome,
    type,
    total: null,
    target: null,
    base: null,
    modifiers: [],
    success: verdict.outcome === "auto" ? true : null,
    evaluated: null,
  };
  if (verdict.outcome !== "throw") return out;

  const target = verdict.target;
  const { evaluated, total, success } = await castThrow({
    base: measuredFormula(roll, item, actor),
    extra: Math.trunc(Number(bonus)) || 0,
    type,
    target,
  });
  const modifiers = target == null ? [] : verdict.record?.set ? verdict.parts : targetModifiers(roll, actor, item);
  // An exact-match throw takes no bonus, so its base is its target.
  const shift = type === "result" ? 0 : type === "below" ? -modifierTotal(modifiers) : modifierTotal(modifiers);
  return { ...out, total, target, base: target == null ? null : target + shift, modifiers, success, evaluated };
}

/**
 * Roll one of an ability's throws (its default when `key` is omitted) and post
 * the result. The one place an ability's throw is posted, so blind applies
 * wherever the roll started. Success is scored only when a target is known; a
 * measure's total is the whole answer.
 *
 * A throw asks for a situational modifier first, unless `skipDialog` is true
 * or the system's skip key is held on `event`; the modifier joins the formula
 * as its own term, never the target. A rung with nothing to roll asks nothing.
 *
 * @param {Item} item
 * @param {string} [key] the throw; the ability's default when omitted
 * @param {object} [opts]
 * @param {Event} [opts.event]          the gesture that asked, read for the skip key
 * @param {boolean} [opts.skipDialog]   true rolls without asking
 * @param {number} [opts.bonus]         the situational modifier, or what the dialog opens on
 * @param {string} [opts.messageMode]   the visibility, or what the dialog opens on; a blind ability overrides it
 * @returns {Promise<{total: number|null, target: number|null, success: boolean|null, outcome: string}|null>}
 *   null when the ability has no throw or the dialog was closed
 */
export async function rollAbility(item, key, { event, skipDialog, bonus = 0, messageMode } = {}) {
  const picked = pickThrow(item, key);
  if (!picked) return null;
  return rollPicked(item, picked, { event, skipDialog, bonus, messageMode });
}

/** Roll and post a throw `pickThrow` (or a granted one) resolved; the one place a throw is posted. */
async function rollPicked(item, picked, { event, skipDialog, bonus = 0, messageMode } = {}) {
  const { roll, actor, verdict } = picked;

  // An unavailable rung posts nothing; the clicker is told why.
  if (verdict.outcome === "none") {
    ui.notifications.info(
      game.i18n.format("ACKS-ABILITIES.roll.notAvailable", {
        name: [item.name, roll.label].filter(Boolean).join(" — "),
        cell: verdict.text || "—",
      }),
    );
    return { total: null, target: null, success: null, outcome: "none" };
  }

  // A blind ability's mode is the ability's, not the roller's.
  const forced = messageModeFor(item);
  let mode = forced ?? messageMode;

  // An automatic rung posts its card with no dice.
  if (verdict.outcome === "auto") {
    await postAutomatic(item, actor, roll, verdict, mode);
    return { total: null, target: null, success: true, outcome: "auto" };
  }

  const target = verdict.target;
  const type = roll.rollType || "above";
  const base = measuredFormula(roll, item, actor);
  let extra = Math.trunc(Number(bonus)) || 0;
  if (!skipDialogFor(event, skipDialog)) {
    const asked = await rollDetailsDialog({
      title: [item.name, roll.label].filter(Boolean).join(" — "),
      formula: base,
      messageMode: mode,
      lockMode: !!forced,
      bonus: extra,
      hint: type === "below" ? game.i18n.localize("ACKS-ABILITIES.roll.belowHint") : "",
    });
    if (!asked) return null;
    extra = asked.bonus;
    mode = asked.messageMode;
  }
  const { evaluated, total, success } = await castThrow({ base, extra, type, target });

  const suffix = type === "above" ? "+" : type === "below" ? "-" : "";

  // The card, or a plain line when it cannot render (a moved or renamed core
  // template): a missing template costs the throw its banner, never its result.
  let content = null;
  try {
    content = await foundry.applications.handlebars.renderTemplate(
      CARD_TEMPLATE,
      await cardData(item, actor, roll, { target, success, suffix, verdict, evaluated }),
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not render ${CARD_TEMPLATE}; posting the throw without its card`, err);
  }

  const label = [item.name, roll.label].filter(Boolean).join(" — ");
  const targetText = measures(roll)
    ? ""
    : target == null
      ? missingTargetText(target, actor)
      : `${game.i18n.localize("ACKS-ABILITIES.roll.target")} ${target}${suffix}`;
  const word =
    success == null ? "" : success ? game.i18n.localize("ACKS-ABILITIES.roll.success") : game.i18n.localize("ACKS-ABILITIES.roll.failure");

  await evaluated.toMessage(
    {
      speaker: ChatMessage.getSpeaker({ actor }),
      // The card renders the dice (`rollACKS`); the Roll is still attached for
      // Dice So Nice and roll inspection.
      ...(content
        ? { content }
        : {
            flavor: `${esc(label)}${
              targetText || word
                ? `<br><span class="acks-abilities-roll-target">${targetText}${
                    word ? `${targetText ? " — " : ""}<strong>${word}</strong>` : ""
                  }</span>`
                : ""
            }${roll.condition ? `<br><em>${esc(roll.condition)}</em>` : ""}`,
          }),
    },
    // undefined falls through to the seat's own default.
    { messageMode: mode },
  );
  return { total, target, success, outcome: "throw" };
}

/**
 * The card for a rung that needs no throw — same banner, no dice — posted as a
 * plain message because there is no Roll. Blind applies.
 */
async function postAutomatic(item, actor, roll, verdict, messageMode) {
  let content = null;
  try {
    content = await foundry.applications.handlebars.renderTemplate(
      CARD_TEMPLATE,
      await cardData(item, actor, roll, { target: null, success: true, suffix: "", verdict }),
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not render ${CARD_TEMPLATE}; posting the automatic result without its card`, err);
  }
  const label = [item.name, roll.label].filter(Boolean).join(" — ");
  await ChatMessage.create(
    {
      speaker: ChatMessage.getSpeaker({ actor }),
      ...(content
        ? { content }
        : {
            content: `<p>${esc(label)} — <strong>${esc(autoText(verdict))}</strong></p>`,
          }),
    },
    { messageMode },
  );
}

/* -------------------------------------------- */
/*  What spell records tell of a throw           */
/* -------------------------------------------- */

/** The throw's sign: "-" under, nothing on an exact match, "+" otherwise. */
const suffixOf = (roll) => (roll?.rollType === "below" ? "-" : roll?.rollType === "result" ? "" : "+");

/** A spoken part with its page: "Spell (RR p.1)". */
const cited = (p) => (p.cite ? `${p.label} (${p.cite})` : p.label);

/**
 * The parts behind a throw a spell record touched, as one line for a tooltip:
 * what made it automatic, the target a part set, every bonus with its source
 * (abilities, spells, the score, conditions) and what yielded to what. Empty
 * where no record touched the throw.
 */
function provenance(roll, verdict) {
  const note = verdict?.record;
  if (!note) return "";
  const bits = [];
  if (note.auto) bits.push(`${cited(note.auto)} ${game.i18n.localize("ACKS-ABILITIES.roll.autoShort")}`);
  if (note.set) bits.push(note.set.value == null ? cited(note.set) : `${cited(note.set)} = ${note.set.value}${suffixOf(roll)}`);
  for (const part of verdict.parts ?? []) {
    const label = part.kind === "conditions" ? game.i18n.localize("ACKS-LIB.statusPalette.source.condition") : part.label;
    bits.push(`${part.cite ? `${label} (${part.cite})` : label} ${signed(part.value)}`.trim());
  }
  for (const p of note.dropped) {
    const name = `${cited(p)} ${p.set ? (p.value == null ? "" : `${p.value}${suffixOf(roll)}`) : signed(p.value)}`.trim();
    bits.push(game.i18n.format("ACKS-LIB.rollMods.yields", { name, to: p.yieldsTo }));
  }
  return bits.join(" · ");
}

/**
 * Where a throw's figure came from, for `data-tooltip-text`: the parts a spell
 * record added or set, each with its page, and what yielded. The empty string
 * where no record touched the throw, so the surface keeps the tooltip it had.
 */
export function throwProvenance(roll, actor, item) {
  if (!roll || measures(roll)) return "";
  return provenance(roll, throwOutcome(roll, actor, item));
}

/* -------------------------------------------- */
/*  Throws a spell record grants                 */
/* -------------------------------------------- */

/** The level a grant's `atLevel` names: a number, or `{value, parts}`; null where it names none. */
function levelOf(atLevel) {
  const raw = atLevel && typeof atLevel === "object" ? atLevel.value : atLevel;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * A stand-in for the proficiency a grant names, shaped as the ability the roller
 * reads (its cookbook id, what it provides, a name and an image) and held by no
 * one: the grant makes the character count as holding it only while its record
 * lasts, so nothing is added to the character.
 */
function standIn(actor, ref, def, spell) {
  const flags = { [MODULE_ID]: { cookbook: { id: ref }, [FLAG_EXTRAS]: { provides: def?.getFlag?.(MODULE_ID, FLAG_EXTRAS)?.provides ?? [] } } };
  return {
    id: null,
    type: ABILITY_TYPE,
    name: def?.name || spell,
    img: def?.img || actor?.img || "icons/svg/d20.svg",
    system: {},
    flags,
    actor,
    getFlag: (scope, key) => flags[scope]?.[key],
  };
}

/** The throw of a grant whose definition is not imported: a die and no target. */
const blankGrantRoll = () => ({ key: "grant", label: "", formula: coreThrowDie(), rollType: "above", scale: "level", target: { kind: "flat", flat: null }, condition: "" });

/**
 * The tooltip of a granted throw's figure: the spell with its page alone where
 * there is no figure; else the spell, the level the definition is read at with
 * what that level is made of, and the parts behind the figure.
 */
function grantTip(hit, roll, verdict, level) {
  if (verdict.target == null && verdict.outcome !== "auto") return hit.label;
  const bits = [];
  if (!verdict.record?.set) bits.push(hit.label);
  if (level != null && !verdict.record?.set) {
    const made = (hit.atLevel?.parts ?? []).map((p) => `${p?.label ?? ""} ${p?.value ?? ""}`.trim()).filter(Boolean);
    bits.push([game.i18n.format("ACKS-ABILITIES.roll.grantedAt", { level }), ...made].join(" · "));
  }
  bits.push(provenance(roll, verdict));
  return bits.filter(Boolean).join(" · ");
}

/**
 * The throws a character's spell records grant: one per throw of each
 * proficiency a `grant` part names, while that record lasts and the character
 * holds no ability that provides it. Read live at every call.
 *
 * A grant with a `set` mode is rolled against its figure (a blank one has no
 * target: "—"); a grant with no mode is the definition's own throw, read at
 * the grant's `atLevel` or the character's level. A definition that is not
 * imported leaves the figure blank. Two grants of one proficiency leave the
 * better target for that throw's type (`recordParts`).
 *
 * @param {Actor} actor
 * @returns {Array<{id: string, effectId: string, ref: string, key: string, name: string, label: string,
 *   spell: string, cite: string, tip: string, text: string, outcome: string, target: number|null,
 *   type: string, level: number|null, roll: object, item: object, verdict: object}>}
 *   `id` is `grant:<effectId>:<key>`, stable for as long as the record lasts; `text` is
 *   what the throw reads as (`throwText`'s cell); `tip` is for `data-tooltip-text`
 */
export function grantedThrows(actor) {
  if (!actor) return [];
  const probe = recordParts(actor, "grant", {});
  const refs = new Set(
    [...probe.kept, ...probe.dropped, ...probe.pending.map((p) => ({ refTo: [].concat(p.part?.ref ?? p.part?.refs ?? [])[0] }))]
      .map((p) => p.refTo)
      .filter(Boolean),
  );
  const out = [];
  for (const ref of refs) {
    const def = byCookbookId("Item", ref, { original: true });
    const all = def ? rollsOf(def) : [];
    const throws = all.map((roll, i) => ({ roll, key: keyOf(roll, i) })).filter(({ roll }) => !measures(roll));
    for (const { roll, key } of throws.length ? throws : [{ roll: blankGrantRoll(), key: "grant" }]) {
      const hit = recordParts(actor, "grant", { rollType: roll.rollType || "above", rollKey: key }).kept.find((p) => p.refTo === ref);
      if (!hit) continue;
      const item = standIn(actor, ref, def, hit.spell);
      const set = hit.mode === "set" ? { spell: hit.spell, cite: hit.cite ?? "", value: hit.value } : null;
      const level = set ? null : levelOf(hit.atLevel);
      const verdict = throwOutcome(roll, actor, item, { level, grant: set });
      out.push({
        id: `grant:${hit.effect?.id ?? ""}:${key}`,
        effectId: hit.effect?.id ?? "",
        ref,
        key,
        name: item.name,
        label: roll.label || "",
        spell: hit.spell,
        cite: hit.cite ?? "",
        tip: grantTip(hit, roll, verdict, level),
        text: readText(roll, verdict),
        outcome: verdict.outcome,
        target: verdict.target ?? null,
        type: roll.rollType || "above",
        level,
        roll,
        item,
        verdict,
      });
    }
  }
  return out;
}

/**
 * Roll a throw `grantedThrows` listed and post it on the system's own card.
 * Resolved afresh: a grant whose record has ended since the list was read is
 * gone, and nothing is rolled (null). Takes `rollAbility`'s options.
 *
 * @param {Actor} actor
 * @param {{id: string}} grant a `grantedThrows` entry
 * @returns {Promise<{total: number|null, target: number|null, success: boolean|null, outcome: string}|null>}
 */
export async function rollGrantedThrow(actor, grant, opts = {}) {
  const live = grantedThrows(actor).find((g) => g.id === grant?.id);
  if (!live) return null;
  return rollPicked(live.item, { roll: live.roll, actor, verdict: live.verdict }, opts);
}
