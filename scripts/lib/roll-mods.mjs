/**
 * A record's modifiers at the roll: the figures an Active Effect carries in
 * `flags["acks-extras"].rollMods` that no field a change can write holds, read
 * when the roll that wants them is made.
 *
 * The flag is `{id, label, cite, sourceAlignment, parts}`. A part is `{key,
 * on, value, itemId, gate, stacksWith, notStacksWith, provides}` plus the scope
 * fields `scopeApplies` reads (`vsKinds`, `vsAlignment`, `vsAlignmentOf`,
 * `vsAlignmentMode`, `vsEnemy`, `anyOf`), and on a `ward` part the `save` the
 * attacker would throw, whose target number the notice carries. `on` names the roll: `attack` and
 * `damage` on the weapon the bearer attacks with, `ac` on an attack made against
 * the bearer, `save` on a saving throw, `ward` for a protection that is told and
 * never added. The feature that writes a record resolves the figures; lib reads
 * them and owns the stacking, so a part is only ever built by `stackingPart`
 * (`resolveStacking` reads its capabilities and throws on a bare one, and the
 * attack seam drops a contributor that throws without a word).
 *
 * Every other roll reads a record through `recordParts`: `throw`, `reaction`,
 * `grant` and `immune` parts, and the saving throw's `save` parts. It narrows by
 * `ref`, `rollKey`, `saves` and `attackKinds` first, tests `partHolds` (a gate,
 * `ifHas`, an `occasion`), then resolves what applies, so a larger part for
 * another roll never takes a smaller one's place. A part may also carry `mode`
 * (`add`, `set` or `auto`) and the narrowing fields above.
 *
 * The attack seam's contributor puts the attacker's parts on its weapon's
 * attack and damage and the target's `ac` parts on the attack against it. A
 * weapon's own bonus is already among core's rows, so the parts are resolved
 * against what `registerItemBonusSource` reports for that weapon: a spell part
 * that wins is a row of its own, an item part that yields is taken back by a row
 * of its negative, and a pair that stacks adds both. Scope is settled against
 * the roll's other party; one that cannot be settled adds nothing and is told.
 * Foundry-free except for the notices (`ui`) and the translations (`game`).
 */
import { MODULE_ID, LANG_PREFIX, FLAG_ROLL_MODS } from "./constants.mjs";
import { addAttackContributor } from "./patches/attack-throw.mjs";
import { gateVerdict, registerGate, resolveStacking, stackingPart } from "./typed-modifiers.mjs";
import { ACTOR_TYPE, capabilityForId, hasScope, satisfies, scopeApplies } from "./vocab.mjs";
import { vocabLabel } from "./magic-vocab.mjs";
import { saveSpec } from "./saves.mjs";
import { saveKindOf } from "./actor-compat.mjs";
import { acMath, acWaivedSet, conditionNameKey, subjectOf } from "./conditions.mjs";
import { hasCapability } from "./capabilities.mjs";
import { actorAlignment, areEnemies, creatureKinds } from "./actor-read.mjs";
import { activeNumericChanges, appliedEffects, CHANGE } from "./effect-scan.mjs";
import { isMagical } from "./item-model.mjs";
import { signed } from "./frame-model.mjs";

/**
 * The rolls a part is read on. The attack and the saving throw read the first
 * five; `throw` (a proficiency's throw), `reaction`, `grant` (a proficiency the
 * bearer counts as holding) and `immune` (what the bearer cannot be affected by)
 * are read by `recordParts` and its siblings.
 */
export const ROLL_MODS_ON = Object.freeze(["attack", "damage", "ac", "save", "ward", "throw", "reaction", "grant", "immune"]);

/** Where a part came from, as `resolveItemParts` marks it: the weapon's own bonus or a record's. */
const FROM_ITEM = "item";
const FROM_SPELL = "spell";

/** One notice or label, localized under this file's lang root. */
function loc(key, data = {}) {
  const full = `${LANG_PREFIX}.rollMods.${key}`;
  const i18n = globalThis.game?.i18n;
  return i18n?.format ? i18n.format(full, data) : [full, ...Object.values(data)].join(" ");
}

/* -------------------------------------------- */
/*  Reading the records                          */
/* -------------------------------------------- */

const flagOf = (effect) => effect?.getFlag?.(MODULE_ID, FLAG_ROLL_MODS) ?? effect?.flags?.[MODULE_ID]?.[FLAG_ROLL_MODS] ?? null;

/**
 * Every roll-mod part the actor's applicable, active effects carry:
 * `[{effect, id, label, cite, sourceAlignment, part}]`, one entry per part. A
 * disabled effect, or one the system reports as not active, adds none, and a
 * part whose `on` is not a `ROLL_MODS_ON` value is skipped.
 */
export function rollModsOf(actor) {
  const out = [];
  for (const effect of appliedEffects(actor)) {
    if (!effect || effect.disabled || effect.active === false) continue;
    const flag = flagOf(effect);
    if (!Array.isArray(flag?.parts)) continue;
    for (const part of flag.parts) {
      if (!part || !ROLL_MODS_ON.includes(part.on)) continue;
      out.push({
        effect,
        id: flag.id ?? null,
        label: String(flag.label ?? ""),
        cite: String(flag.cite ?? ""),
        sourceAlignment: flag.sourceAlignment ?? null,
        part,
      });
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  What a condition's effect does to a field    */
/* -------------------------------------------- */

/** The fields the step reader is asked about: the creature's Armor Class and saving-throw modifiers. */
export const CONDITION_STEP_KEYS = Object.freeze({ ac: "system.ac.mod", save: "system.save.mod" });

/**
 * The ids whose entry in the system's condition list carries Active Effect
 * changes, read from `CONFIG.ACKS.conditions` at the call: the module holds no
 * list of them.
 */
function changeCarrying() {
  const ids = new Set();
  for (const entry of globalThis.CONFIG?.ACKS?.conditions ?? []) {
    if (entry?.id && Array.from(entry.system?.changes ?? []).length) ids.add(entry.id);
  }
  return ids;
}

/**
 * A field's value before any effect applies: its stored value. The system's
 * actor preparation derives neither `system.ac.mod` nor `system.save.mod`, so
 * the stored figure is what its changes replay from, on a monster and on a
 * character alike. Zero where the actor holds no stored data.
 *
 * @param {object} actor
 * @param {string} key  a change key, `system.<path>`
 * @returns {number}
 */
function storedFigure(actor, key) {
  let at = actor?._source?.system;
  for (const part of String(key).replace(/^system\./, "").split(".")) at = at?.[part];
  const figure = Number(at);
  return Number.isFinite(figure) ? figure : 0;
}

/** The Active Effect changes an effect carries, as Foundry applies them: `system.changes`, else the plain `changes`. */
const changesOf = (effect) => Array.from(effect?.system?.changes ?? effect?.changes ?? []);

/** Whether the system's entry for condition `id` carries a change on `key`, read from `CONFIG.ACKS.conditions` at the call. */
function entryCarries(id, key) {
  for (const entry of globalThis.CONFIG?.ACKS?.conditions ?? []) {
    if (entry?.id === id) return Array.from(entry.system?.changes ?? []).some((change) => change?.key === key);
  }
  return false;
}

/**
 * The status of an effect that a change on `key` belongs to: the one status
 * whose system entry carries a change on that key. Null when none does, or when
 * more than one does, since the change then cannot be attributed.
 */
function statusOfChange(effect, key) {
  const owners = [...(effect?.statuses ?? [])].filter((id) => entryCarries(id, key));
  return owners.length === 1 ? owners[0] : null;
}

/**
 * Whether a change of `effect` counts, so that one condition's change on one
 * field applies once however many effects carry it. The change belongs to the
 * status of its effect whose system entry carries its key (`statusOfChange`);
 * it counts unless an EARLIER active effect of the same actor, in
 * `allApplicableEffects()` order, carries that status and a change on that key.
 * A change that cannot be attributed, and an effect with no actor, count. It reads the actor's effects and never
 * `actor.statuses`, which Foundry fills in the same loop that asks. This is
 * the one rule behind Foundry's `shouldApplyChange` (`status-effects.mjs`) and
 * behind every reader of a condition's step (`conditionSteps`).
 *
 * @param {object} effect  the Active Effect the change belongs to
 * @param {{key?: string}} change
 * @returns {boolean}
 */
export function countsOnce(effect, change) {
  const key = change?.key;
  const status = key ? statusOfChange(effect, key) : null;
  const actor = effect?.actor;
  if (!status || !actor) return true;
  const effects = typeof actor.allApplicableEffects === "function" ? actor.allApplicableEffects() : (actor.effects ?? []);
  for (const other of effects) {
    if (other === effect) return true;
    if (other?.disabled || other?.active === false) continue;
    if (other?.statuses?.has?.(status) && changesOf(other).some((c) => c?.key === key)) return false;
  }
  return true;
}

/**
 * The steps the system's condition effects make to one field of an actor, read
 * from the effects themselves: `activeNumericChanges` narrowed to the effects
 * whose statuses include an id whose system entry carries changes, and to the
 * changes Foundry applied (`countsOnce`), so a condition set twice counts once
 * and a step Foundry did not apply is no step here. A character already holds
 * them in the prepared field; a monster's field has none of them, so a caller
 * that puts them on a roll asks for a monster. The reader looks at no actor
 * type, its callers do. The changes replay from the field's stored value, so an
 * override, a multiply or a bound reads as the shift it makes to what the actor
 * stores.
 *
 * A step belongs to the status its change is attributed to (`statusOfChange`):
 * the Armor Class step on a charging effect is Disordered's. On
 * `system.ac.mod` a step whose own condition sits in the Armor Class waiver's
 * decision (`acWaivedSet`) is not suffered, and moves to `waived`. A change
 * the rule cannot attribute is waived only when every status of its effect is
 * decided: no waiver on a guess.
 *
 * @param {object} actor
 * @param {string} key  a field a condition effect changes (`CONDITION_STEP_KEYS`)
 * @returns {{steps: Array<{effect: object, change: object, type: string, value: number, condition: string}>,
 *   waived: Array<{condition: string, type: string, value: number, effect: object}>}}
 *   Values are the step as the field takes it, a bonus positive; `type` is the
 *   change's type, `add` where it names none. `condition` is
 *   the status the change belongs to, else the first status of the effect that
 *   carries changes. `waived` is empty off `system.ac.mod`.
 */
export function conditionSteps(actor, key) {
  const out = { steps: [], waived: [] };
  const ids = changeCarrying();
  if (!actor || !ids.size) return out;
  const decided = key === CONDITION_STEP_KEYS.ac ? acWaivedSet(subjectOf(actor)) : new Set();
  for (const step of activeNumericChanges(actor, key, { base: storedFigure(actor, key), admit: countsOnce })) {
    const statuses = [...(step.effect?.statuses ?? [])];
    const owner = statusOfChange(step.effect, key);
    const condition = owner ?? statuses.find((id) => ids.has(id));
    if (!condition) continue;
    const waived = owner ? decided.has(owner) : decided.size > 0 && statuses.every((id) => decided.has(id));
    if (waived) out.waived.push({ condition, type: step.type, value: step.value, effect: step.effect });
    else out.steps.push({ ...step, condition });
  }
  return out;
}

/** The figures of `steps` summed. */
export const sumSteps = (steps) => steps.reduce((total, step) => total + step.value, 0);

/** A condition's name: its lang string, or its id before any translation is loaded. */
const conditionName = (id) => globalThis.game?.i18n?.localize?.(conditionNameKey(id)) ?? id;

/**
 * How one effect's step is named, as `{name, condition?}`: the effect's own
 * name, with `condition` set to the condition the step belongs to only where
 * that condition's name differs from the effect's. An effect with no name is
 * named by its condition, and a step that belongs to no condition has none.
 */
function stepName(effect, condition) {
  const own = String(effect?.name ?? "").trim();
  if (!condition) return { name: own };
  const named = conditionName(condition);
  if (!own) return { name: named };
  return own === named ? { name: own } : { name: own, condition };
}

/** The text of a named step: the effect's name, followed by its condition's in brackets where `stepName` kept one. */
export function lineLabel({ name, condition }) {
  if (!condition) return name;
  const data = { effect: name, condition: conditionName(condition) };
  const i18n = globalThis.game?.i18n;
  return i18n?.format ? i18n.format(`${LANG_PREFIX}.conditionRoll.targetAc.named`, data) : `${data.effect} (${data.condition})`;
}

/** Whether a change type says something a signed figure does not: every type but `add` and `subtract`. */
const namesKind = (type) => Boolean(type) && type !== CHANGE.ADD && type !== CHANGE.SUBTRACT;

/**
 * Foundry's own words for change types, joined by ", ": the localized
 * `EFFECT.CHANGES.TYPES.<type>` of each, the type itself where Foundry has no
 * word for it. The one place a type becomes words, for the sheet's tooltip lines
 * and for `stepLabel`.
 * @param {string[]} types
 * @returns {string}
 */
export function kindWords(types) {
  const i18n = globalThis.game?.i18n;
  return types
    .map((type) => {
      const key = `EFFECT.CHANGES.TYPES.${type}`;
      const word = i18n?.localize?.(key);
      return word && word !== key ? word : type;
    })
    .join(", ");
}

/**
 * A name that ends with the change's type in Foundry's word, "{label}, {kind}",
 * where the type is not `add` or `subtract`; the label as given otherwise. The
 * one place a name takes the word, for `stepLabel` and for the terms an attack
 * builds from a step (`status-effects.mjs`).
 * @param {string} label
 * @param {string} [type]  a step's change type (`conditionSteps`)
 */
export function kindedLabel(label, type) {
  if (!namesKind(type)) return label;
  const data = { label, kind: kindWords([type]) };
  const i18n = globalThis.game?.i18n;
  return i18n?.format ? i18n.format(`${LANG_PREFIX}.conditionRoll.targetAc.kinded`, data) : `${data.label}, ${data.kind}`;
}

/**
 * The label of one effect's step to a field: its effect named, plus the
 * condition the step belongs to where the two differ (a charge's Armor Class
 * step is its disorder's), plus the change's type in Foundry's word where the
 * type is not `add` or `subtract` (`kindedLabel`).
 * @param {object} effect
 * @param {string|null} condition
 * @param {string} [type]  the step's change type (`conditionSteps`)
 */
export function stepLabel(effect, condition, type) {
  return kindedLabel(lineLabel(stepName(effect, condition)), type);
}

/**
 * What every active effect does to one field of an actor, one line per effect
 * in the order Foundry applied them: the shape of the system's own attack-card
 * breakdown (the stored value, a line per effect, the remainder), rebuilt from
 * the module's reader because the system's function cannot be imported. The
 * changes are `activeNumericChanges` narrowed to the ones Foundry applied
 * (`countsOnce`), so a condition two effects carry is listed once, and an
 * effect's changes on the key are summed into its one line. An effect whose
 * changes net to nothing has no line. Every figure is read from the effect
 * documents at the call.
 *
 * `condition` is the condition the effect's change belongs to
 * (`statusOfChange`, else the first status of the effect that carries
 * changes), and is present only where its name differs from the effect's
 * (`stepName`).
 *
 * @param {object} actor
 * @param {string} key  a field an effect changes (`CONDITION_STEP_KEYS`)
 * @param {{base?: number}} [options]  `base` is the field's value before any effect, which an override or a multiply replays from
 * @returns {Array<{name: string, condition?: string, value: number, kinds: string[], effect: object}>}
 *   `value` is the signed step, a bonus positive; `kinds` are the change types
 *   of the effect's counted changes on the key other than `add` and `subtract`,
 *   each once in the order met, empty for an effect that only adds or subtracts
 *   (`kindWords` gives them in Foundry's words); `effect` is the document, for
 *   a caller that lists some effect's changes itself and so drops its line
 */
export function effectLines(actor, key, { base = 0 } = {}) {
  const ids = changeCarrying();
  const lines = new Map();
  for (const step of activeNumericChanges(actor, key, { base, admit: countsOnce })) {
    const line = lines.get(step.effect);
    if (line) {
      line.value += step.value;
      if (namesKind(step.type) && !line.kinds.includes(step.type)) line.kinds.push(step.type);
      continue;
    }
    const condition = statusOfChange(step.effect, key) ?? [...(step.effect?.statuses ?? [])].find((id) => ids.has(id)) ?? null;
    const kinds = namesKind(step.type) ? [step.type] : [];
    lines.set(step.effect, { ...stepName(step.effect, condition), value: step.value, kinds, effect: step.effect });
  }
  return [...lines.values()].filter((line) => line.value !== 0);
}

/* -------------------------------------------- */
/*  The weapon's own bonus                       */
/* -------------------------------------------- */

const sources = new Set();

/**
 * Register a reader of the bonus a weapon already carries in core's rows.
 * `source(item, on)` answers `[{key, label, value, provides, cite}]` for `on`
 * `attack` or `damage`: the parts of that bonus, each with the capabilities it
 * provides, so a record's part that names one in `notStacksWith` can yield to it
 * or take it back. Returns the function that removes the registration.
 */
export function registerItemBonusSource(source) {
  if (typeof source !== "function") return () => {};
  sources.add(source);
  return () => void sources.delete(source);
}

/**
 * The parts every registered source reports for a weapon on one field, as
 * `stackingPart`s with zero figures dropped. A source that throws is reported and
 * leaves its parts out.
 */
export function itemBonusParts(item, on) {
  const out = [];
  if (!item) return out;
  for (const source of sources) {
    let entries = [];
    try {
      entries = source(item, on);
    } catch (err) {
      console.error(`${MODULE_ID} | an item bonus source failed; its figures are left out`, err);
    }
    for (const entry of Array.isArray(entries) ? entries : []) {
      const value = Number(entry?.value);
      if (!Number.isFinite(value) || value === 0) continue;
      out.push(
        stackingPart({
          value,
          label: String(entry.label ?? ""),
          ref: { provides: entry.provides ?? [] },
          key: entry.key ?? null,
          cite: String(entry.cite ?? ""),
          on,
        }),
      );
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Parts and their stacking                     */
/* -------------------------------------------- */

/**
 * The `stackingPart` for one `rollModsOf` entry. Its reference is the record's
 * `id` (the spell's definition id, so a printed `stacksWith` naming another
 * spell matches) with the capabilities the part provides, and every field of the
 * part rides along. `sign` multiplies the figure: -1 where a scope reverses it.
 */
export function spellStackingPart(entry, sign = 1) {
  const { value, stacksWith, notStacksWith, provides, ref: _ref, caps: _caps, label: _label, ...rest } = entry.part;
  return stackingPart({
    ...rest,
    value: Number(value) * sign,
    label: entry.label,
    ref: { id: entry.id, provides },
    stacksWith,
    notStacksWith,
    cite: entry.cite,
    sourceAlignment: entry.sourceAlignment,
    effect: entry.effect,
  });
}

/** Whether a part was built by `stackingPart` and carries a finite, nonzero figure. */
const usable = (p) => Array.isArray(p?.caps) && p.ref && typeof p.ref === "object" && Number.isFinite(p.value) && p.value !== 0;

const withCite = (part) => (part.cite ? `${part.label} (${part.cite})` : part.label);

/**
 * Resolve a weapon's own bonus parts and a record's parts on one field, item
 * parts first, so a tie keeps the weapon's. Pure.
 *
 * A part not built by `stackingPart`, or with no figure, is left out of
 * everything. Returns the rows to add to core's, `kept` and the parts that
 * yielded (`droppedItems`, `droppedSpells`, each carrying `yieldsTo`, the label
 * of what it yielded to). A kept spell part is a row labelled `{name} ({cite})`
 * of its figure; a dropped item part is a row of minus its figure, because core's
 * rows already carry it; a kept item part adds nothing.
 *
 * @param {object[]} itemParts  from `itemBonusParts`
 * @param {object[]} spellParts  from `spellStackingPart`
 * @returns {{rows: {label: string, value: number}[], kept: object[], droppedItems: object[], droppedSpells: object[]}}
 */
export function resolveItemParts(itemParts, spellParts) {
  const items = (itemParts ?? []).filter(usable).map((p) => ({ ...p, from: FROM_ITEM }));
  const spells = (spellParts ?? []).filter(usable).map((p) => ({ ...p, from: FROM_SPELL }));
  const { kept, dropped } = resolveStacking([...items, ...spells]);
  const rows = kept.filter((p) => p.from === FROM_SPELL).map((p) => ({ label: withCite(p), value: p.value }));
  const droppedItems = dropped.filter((p) => p.from === FROM_ITEM);
  for (const p of droppedItems) rows.push({ label: loc("yields", { name: p.label, to: p.yieldsTo }), value: -p.value });
  return { rows, kept, droppedItems, droppedSpells: dropped.filter((p) => p.from === FROM_SPELL) };
}

/* -------------------------------------------- */
/*  Scope                                        */
/* -------------------------------------------- */

/**
 * What `scopeApplies` reads of the roll's other party: its kinds and alignment,
 * the alignment of whoever the record came from and whether the two sides are
 * enemies (`areEnemies`, null where unknown).
 */
export function scopeCtxFor(other, { sourceAlignment = null, enemy = null } = {}) {
  return { kinds: creatureKinds(other), alignment: actorAlignment(other), sourceAlignment, enemy };
}

/** The scope verdict of one entry against `other`, the bearer's token and the other's deciding `enemy`. */
function settle(entry, other, enemy) {
  return scopeApplies(entry.part, scopeCtxFor(other, { sourceAlignment: entry.sourceAlignment, enemy }));
}

/** A notice to tell once per attack: `{key, level, lang, data}`. */
function note(entry, lang, level, data, extra = "") {
  return { key: `${lang}|${entry.effect?.id ?? entry.id}|${entry.part.key ?? ""}|${entry.part.on}|${extra ?? ""}`, level, lang, data };
}

/** Whether an entry's gate, if it names one, answers yes for the actor and this roll. */
const gateHolds = (actor, part, ctx) => !part.gate?.kind || gateVerdict(actor, part.gate, ctx) === true;

/* -------------------------------------------- */
/*  Reading parts at a roll                      */
/* -------------------------------------------- */

/** A part's figure as a finite, nonzero number, else null: a part with no figure never reaches stacking. */
const figureOf = (part) => {
  if (part?.value == null || part.value === "") return null;
  const n = Number(part.value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** The tokens a part's `ref` (or `refs`) names. */
const refsOf = (part) => [].concat(part?.ref ?? [], part?.refs ?? []).filter((r) => typeof r === "string" && r);

/** A part's list field as an array of non-blank strings. */
const listOf = (value) => (Array.isArray(value) ? value : []).map(String).filter(Boolean);

/**
 * Whether a part's narrowing fields admit the roll, read BEFORE any stacking so
 * that a part which does not reach this roll never takes another's place: true
 * (every field it declares matches), false (one misses), or null (one is
 * declared and the caller named nothing to test it against). The fields are
 * `ref` and `refs` (matched through `satisfies` against `subject`, `{id,
 * provides}`; skipped with `byRef: false`), `rollKey`, `saves` (compared as
 * `saveKindOf` reads them), and `attackKinds` (against `kind`).
 */
function narrow(part, { subject = null, rollKey, save, kind, byRef = true } = {}) {
  const checks = [];
  const refs = byRef ? refsOf(part) : [];
  if (refs.length) checks.push(subject ? refs.some((r) => satisfies([subject], r)) : null);
  if (part?.rollKey) checks.push(rollKey == null ? null : part.rollKey === rollKey);
  const saves = listOf(part?.saves);
  if (saves.length) checks.push(save == null ? null : saves.map(saveKindOf).includes(saveKindOf(save)));
  const kinds = listOf(part?.attackKinds);
  if (kinds.length) checks.push(kind == null ? null : kinds.includes(kind));
  if (checks.includes(false)) return false;
  return checks.includes(null) ? null : true;
}

/**
 * Whether a record's part (or a spell's row, before any record exists) holds
 * for `actor` now: true, false, or null where it cannot be told. A gate is
 * tested through `gateVerdict` (an item gate answers null unless `ctx.item` is
 * held, a roll gate unless the context it reads is: `ctx.token` for the light gate,
 * and the attack-moment gates of `roll-gate-kinds.mjs` read the target and weapon too), and a gate marked `occasion` that
 * holds answers null unless `ctx.occasion` names its status, since the roll
 * that gate belongs to is the caller's to name. Each `ifHas` token is tested
 * through `hasCapability`. A false answer wins over a null one.
 *
 * @param {object} actor  the bearer, or the saver a row is tested against
 * @param {{gate?: object, ifHas?: string[]}} part
 * @param {{item?: object, token?: object, occasion?: string}} [ctx]
 * @returns {boolean|null}
 */
export function partHolds(actor, part, ctx = {}) {
  const answers = [];
  const gate = part?.gate?.kind ? part.gate : null;
  if (gate) {
    let verdict = gateVerdict(actor, gate, ctx);
    if (verdict === true && gate.occasion) verdict = ctx?.occasion && ctx.occasion === gate.status ? true : null;
    answers.push(verdict);
  }
  for (const token of listOf(part?.ifHas)) answers.push(hasCapability(actor, token));
  if (answers.includes(false)) return false;
  return answers.includes(null) ? null : true;
}

/**
 * Resolve one group of parts on one field: those with a figure go through
 * `resolveStacking` (larger first), then the ones with none (a grant or an
 * `auto` throw, which carry `value: null`) yield to what was kept, or the first
 * is kept where nothing has a figure. `lowerBetter` orients a target number,
 * where the smaller figure is the better throw.
 */
function resolveGroup(parts, lowerBetter) {
  const figured = parts.filter((p) => p.value !== null);
  const bare = parts.filter((p) => p.value === null);
  const oriented = figured.map((p) => ({ ...p, value: lowerBetter ? -p.value : p.value, orig: p }));
  const { kept, dropped } = resolveStacking(oriented);
  const keptParts = kept.map((p) => p.orig);
  const droppedParts = dropped.map((p) => ({ ...p.orig, yieldsTo: p.yieldsTo }));
  if (!keptParts.length && bare.length) keptParts.push(bare.shift());
  for (const p of bare) droppedParts.push({ ...p, yieldsTo: keptParts[0].label });
  return { kept: keptParts, dropped: droppedParts };
}

/**
 * The parts one kind of roll takes from a bearer's records: the one reader
 * every feature calls. The order is fixed. A part is narrowed first (`ref`
 * through `subject`, `rollKey`, `saves`, `attackKinds`, so a part that does not
 * reach this roll never takes another's place), then `partHolds` tests its
 * gate and `ifHas`, then the parts that apply are resolved among themselves, so
 * two records of one kind give one figure, the larger, and a part is gone the
 * moment its record ends. A part with no figure never reaches the stacking
 * (except a `grant`, and a `throw` of mode `auto`, which have none by nature
 * and carry `value: null`). A `grant` applies only while no ability of the
 * bearer provides the capability of its `ref`.
 *
 * A part that declares a field the caller named nothing to test goes to
 * `pending`, never to the roll. Stacking is per group: a grant's by `ref`, a
 * throw's by mode (`add` among adds, `set` among sets, one `auto`).
 *
 * @param {object} actor  the bearer
 * @param {string} on  a `ROLL_MODS_ON` value
 * @param {object} [options]
 * @param {{id?: string, provides?: string[]}} [options.subject]  what the roll is of (a proficiency's reference), tested against `ref`
 * @param {string} [options.rollKey]  which of the subject's throws is rolled
 * @param {string} [options.save]  the saving throw rolled, a system save key
 * @param {string} [options.kind]  the attack's kind, one of `ATTACK_KINDS`
 * @param {{item?: object, token?: object, occasion?: string}} [options.ctx]  what `partHolds` reads
 * @param {"above"|"below"|string} [options.rollType]  how the throw is read: a `set` figure is a target, lower the better throw unless `below`
 * @param {object[]} [options.entries]  the parts to read, in `rollModsOf`'s entry shape; the actor's own records when omitted. A caller adding the parts a cast would write (`availableRollMods`) passes the recorded ones first and the available after, so a part a record holds wins a tie
 * @returns {{kept: object[], dropped: object[], pending: object[]}}
 *   a part is a `stackingPart` labelled `{spell} ({cite})`, carrying `spell`, `refTo` (its first `ref`), `effect` and every field of the part; `dropped` carry `yieldsTo`; `pending` is `{label, value, why: "narrow"|"gate", effect, part}`
 */
export function recordParts(actor, on, { subject = null, rollKey, save, kind, ctx = {}, rollType = "above", entries = rollModsOf(actor) } = {}) {
  const pending = [];
  const groups = new Map();
  const byRef = on !== "grant" && on !== "immune";
  for (const entry of entries) {
    const { part } = entry;
    if (part.on !== on) continue;
    const fit = narrow(part, { subject, rollKey, save, kind, byRef });
    if (fit === false) continue;
    if (on === "grant" && refsOf(part).some((r) => hasCapability(actor, capabilityForId(r)))) continue;
    const holds = partHolds(actor, part, ctx);
    const label = withCite({ label: entry.label, cite: entry.cite });
    if (holds === false) continue;
    if (fit === null || holds === null) {
      pending.push({ label, value: part.value ?? null, why: fit === null ? "narrow" : "gate", effect: entry.effect, part });
      continue;
    }
    const mode = part.mode ?? "add";
    const bare = figureOf(part) === null;
    if (bare && on !== "grant" && on !== "immune" && mode !== "auto") continue;
    const built = spellStackingPart({ ...entry, label, part: bare ? { ...part, value: 1 } : part });
    if (bare) built.value = null;
    built.spell = entry.label;
    built.refTo = refsOf(part)[0] ?? null;
    const group =
      on === "grant" ? `grant|${built.refTo}` : on === "throw" ? `throw|${mode === "set" || mode === "auto" ? mode : "add"}` : on === "immune" ? `immune|${groups.size}` : on;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(built);
  }
  const kept = [];
  const dropped = [];
  for (const [group, parts] of groups) {
    const lowerBetter = rollType !== "below" && (group.startsWith("grant|") || group === "throw|set");
    const resolved = resolveGroup(parts, lowerBetter);
    kept.push(...resolved.kept);
    dropped.push(...resolved.dropped);
  }
  return { kept, dropped, pending };
}

/**
 * What a bearer's records do to a proficiency's throw, from its `throw` parts
 * (`recordParts`): `add` (the bonuses that apply, resolved among themselves) with
 * their `total`, `set` (the one target a part sets, or null), and `auto` (a part
 * that makes the throw automatic, or null). `outcome` is `auto` where one does,
 * else `throw`: the shape `resolveLevelOutcome` answers, so a roller that reads
 * a rung's outcome reads this the same way. The caller's own bonuses are its
 * own: these join them, and a set target replaces the stored one only when the
 * caller chooses. Takes `recordParts`'s options.
 *
 * @returns {{outcome: "auto"|"throw", add: object[], total: number, set: object|null, auto: object|null, dropped: object[], pending: object[]}}
 */
export function throwResolution(actor, options = {}) {
  const { kept, dropped, pending } = recordParts(actor, "throw", options);
  const add = kept.filter((p) => !p.mode || p.mode === "add");
  const auto = kept.find((p) => p.mode === "auto") ?? null;
  return {
    outcome: auto ? "auto" : "throw",
    add,
    total: add.reduce((sum, p) => sum + p.value, 0),
    set: kept.find((p) => p.mode === "set") ?? null,
    auto,
    dropped,
    pending,
  };
}

/**
 * What a bearer's records make it immune to, from their `immune` parts
 * (`{on: "immune", spells, conditions}`): the spell asked about (`spell`,
 * `{id, provides}`, matched against each part's `spells` through `satisfies`)
 * and which of `conditions` (keys) a part lists, each with the label of the
 * record that grants it. A part is tested through `partHolds`; one that cannot
 * be told is in `pending`. Reads only: marking a cast's entry exempt is the
 * cast's.
 *
 * @returns {{spell: {label: string, spell: string, effect: object}|null, conditions: Record<string, {label: string, spell: string, effect: object}>, pending: {label: string}[]}}
 */
export function recordImmunity(actor, { spell = null, conditions = [], ctx = {} } = {}) {
  const out = { spell: null, conditions: {}, pending: [] };
  for (const entry of rollModsOf(actor)) {
    const { part } = entry;
    if (part.on !== "immune") continue;
    const holds = partHolds(actor, part, ctx);
    if (holds === false) continue;
    const label = withCite({ label: entry.label, cite: entry.cite });
    if (holds === null) {
      out.pending.push({ label });
      continue;
    }
    const granted = { label, spell: entry.label, effect: entry.effect };
    if (!out.spell && spell && listOf(part.spells).some((token) => satisfies([spell], token))) out.spell = granted;
    const keys = listOf(part.conditions);
    for (const key of conditions) if (keys.includes(key) && !out.conditions[key]) out.conditions[key] = granted;
  }
  return out;
}

/**
 * The target parts a saver takes from the rows of the spell's own save (rows
 * marked `ownSave`), each tested for THIS saver through `partHolds`: a row that
 * holds is a target part, one that cannot be told is `pending`, and one that
 * does not hold adds nothing. A row with no figure, or one whose `saves` miss
 * `save`, adds nothing. A positive figure lowers the number to roll. Rows of
 * one cast are not stacked: the cast's own rows add.
 *
 * @param {object} saver
 * @param {{label: string, cite?: string, value: number, gate?: object, ifHas?: string[], saves?: string[], key?: string}[]} rows
 * @param {{save?: string, ctx?: object}} [options]  `ctx` is `partHolds`'s (name `occasion` there)
 * @returns {{parts: {key: string, label: string, value: number, side: "target"}[], pending: {label: string, value: number, when: "gate"|"save"}[]}}
 */
export function ownSaveParts(saver, rows, { save, ctx = {} } = {}) {
  const parts = [];
  const pending = [];
  for (const row of rows ?? []) {
    const value = figureOf(row);
    if (value === null) continue;
    const fit = narrow(row, { save, byRef: false });
    if (fit === false) continue;
    const label = withCite({ label: String(row.label ?? ""), cite: String(row.cite ?? "") });
    const holds = partHolds(saver, row, ctx);
    if (holds === false) continue;
    if (fit === null || holds === null) pending.push({ label, value, when: fit === null ? "save" : "gate" });
    else parts.push({ key: row.key ?? "ownSave", label, value, side: "target" });
  }
  return { parts, pending };
}

/* -------------------------------------------- */
/*  The attack seam                              */
/* -------------------------------------------- */

/** The attacker's own parts on one field of its weapon's roll. */
function attackerSide(ctx, on, rows, told) {
  const { actor, item, token, target, targetActor } = ctx;
  const own = rollModsOf(actor).filter((e) => e.part.on === on);
  if (!own.length) return;
  const applying = [];
  for (const entry of own) {
    const { part } = entry;
    if (part.itemId && part.itemId !== item?.id) continue;
    if (!gateHolds(actor, part, { item, token })) continue;
    const verdict = settle(entry, targetActor, areEnemies(token, target));
    if (verdict.undetermined) {
      told.push(note(entry, "notice.undetermined", "warn", { spell: entry.label, target: actor?.name ?? "", attacker: ctx.targetName ?? "" }, targetActor?.uuid));
      continue;
    }
    if (verdict.applies) applying.push(spellStackingPart(entry, verdict.sign));
  }
  if (!applying.length) return;
  const resolved = resolveItemParts(itemBonusParts(item, on), applying);
  rows.push(...resolved.rows);
  for (const p of resolved.droppedSpells) {
    told.push({
      key: `notice.yielded|${p.effect?.id ?? p.ref?.id}|${p.key ?? ""}|${on}`,
      level: "info",
      lang: "notice.yielded",
      data: { spell: p.label, item: item?.name ?? "", to: p.yieldsTo },
    });
  }
}

/**
 * The saving throw a ward part names (its `save`, a system save key) as the
 * attacker would make it: `{save, number}` with the save's label and its target
 * number, or null when the part names none or the attacker has no target stored.
 * A ward is told, never refused; the figure is for the Judge who rolls it.
 */
function wardSaveTarget(attacker, part) {
  if (typeof part?.save !== "string" || !part.save) return null;
  const { target } = saveSpec(attacker, part.save);
  if (typeof target !== "number" || !Number.isFinite(target)) return null;
  return { save: vocabLabel("saveCategory", part.save), number: target };
}

/**
 * The armour class a `set` part adds to an attack of one kind, as the lift
 * above what the target already has: `max(0, figure − (ac.value − dexMod +
 * conditions))`. Armour, shield, powers (all in `ac.value`) and the target's
 * conditions compete with the set and never add to it; a character's Dexterity
 * modifier, which `ac.value` carries, is read out of that comparison and
 * stays on top, and a monster has none. The conditions are the module's own
 * rows (`acMath`) and, for a monster, the steps its condition effects make to
 * `system.ac.mod` (`conditionSteps`); a character's `ac.value` already holds
 * those. Null where the target's armour class is not a number.
 */
function armourLift(targetActor, figure, kind) {
  const base = Number(targetActor?.system?.ac?.value);
  if (!Number.isFinite(base)) return null;
  const character = targetActor.type === ACTOR_TYPE.character;
  const dex = character ? Number(targetActor.system?.scores?.dex?.mod) || 0 : 0;
  const subject = subjectOf(targetActor);
  const own = subject?.statuses && [...subject.statuses].length ? acMath(subject, undefined, { kind }).total : 0;
  const steps = character ? 0 : sumSteps(conditionSteps(targetActor, CONDITION_STEP_KEYS.ac).steps);
  return Math.max(0, figure - (base - dex + own + steps));
}

/**
 * The target's `ac` parts, as the minus terms they are on an attack against it,
 * and its `ward` parts, told. A part is narrowed by the attack's `kind` and
 * tested through `partHolds` first, then the parts that apply are resolved
 * together: a `set` part is its lift (`armourLift`), so a set and an add meet in
 * one resolution and the larger stands. A set whose lift is 0 is told as
 * yielding to the target's own armour class and never reaches it.
 */
function defenderSide(ctx, rows, told, kind) {
  const { actor, token, target, targetActor } = ctx;
  const theirs = rollModsOf(targetActor).filter((e) => e.part.on === "ac" || e.part.on === "ward");
  if (!theirs.length) return;
  const enemy = areEnemies(token, target);
  const applying = [];
  for (const entry of theirs) {
    const { part } = entry;
    const data = { spell: entry.label, target: ctx.targetName ?? "", attacker: actor?.name ?? "" };
    if (part.on === "ward") {
      const verdict = settle(entry, actor, enemy);
      if (verdict.applies || verdict.undetermined) {
        const throwTarget = wardSaveTarget(actor, part);
        if (throwTarget === null) told.push(note(entry, "notice.ward", "warn", data, actor?.uuid));
        else told.push(note(entry, "notice.wardSave", "warn", { ...data, ...throwTarget }, actor?.uuid));
      }
      continue;
    }
    const fit = narrow(part, { kind, byRef: false });
    if (fit === false) continue;
    const holds = partHolds(targetActor, part, { item: ctx.item, token: target });
    if (holds === false) continue;
    if (fit === null || holds === null) {
      told.push(note(entry, "notice.undetermined", "warn", data, actor?.uuid));
      continue;
    }
    const verdict = settle(entry, actor, enemy);
    if (verdict.undetermined) {
      told.push(note(entry, "notice.undetermined", "warn", data, actor?.uuid));
      continue;
    }
    if (!verdict.applies) continue;
    if (part.mode === "set") {
      const figure = figureOf(part);
      const lift = figure === null ? null : armourLift(targetActor, figure, kind);
      if (lift === null) continue;
      if (lift === 0) {
        told.push({
          key: `notice.yielded|${entry.effect?.id ?? entry.id}|${part.key ?? ""}|ac`,
          level: "info",
          lang: "notice.yielded",
          data: { spell: entry.label, item: ctx.targetName ?? "", to: loc("ownAc", { target: ctx.targetName ?? "" }) },
        });
        continue;
      }
      applying.push({ ...spellStackingPart({ ...entry, part: { ...part, value: lift } }), setTo: figure, kind });
      continue;
    }
    applying.push(spellStackingPart(entry, verdict.sign));
  }
  const { kept, dropped } = resolveStacking(applying.filter(usable));
  for (const p of kept) {
    const name = withCite(p);
    const label = p.mode === "set" ? loc("onTargetKind", { name, target: ctx.targetName ?? "", kind: loc(`kind.${p.kind}`) }) : loc("onTarget", { name, target: ctx.targetName ?? "" });
    rows.push({ label, value: -p.value });
  }
  for (const p of dropped) {
    told.push({
      key: `notice.yielded|${p.effect?.id ?? p.ref?.id}|${p.key ?? ""}|ac`,
      level: "info",
      lang: "notice.yielded",
      data: { spell: p.label, item: ctx.targetName ?? "", to: p.yieldsTo },
    });
  }
}

/**
 * The rows a record's parts add to one question of the attack in flight, and
 * the notices to tell. `question` is `attack` or `damage`: the attacker's parts
 * on that field and, for `attack`, the target's `ac` parts as terms against the
 * attacker. Cached on `ctx.rollMods` by question and attack type, because the
 * dialog's preview asks again on every keystroke.
 *
 * @param {object} ctx  the attack's context (`attackContext`)
 * @param {string} attackType  the kind the question is asked for; a cache key only
 * @param {"attack"|"damage"} question
 * @returns {{rows: {label: string, value: number}[], told: {key: string, level: string, lang: string, data: object}[]}}
 */
export function rollModRows(ctx, attackType, question) {
  const cache = (ctx.rollMods ??= {});
  const key = `${question}:${attackType}`;
  if (cache[key]) return cache[key];
  const rows = [];
  const told = [];
  attackerSide(ctx, question, rows, told);
  if (question === "attack" && ctx.targetActor) defenderSide(ctx, rows, told, attackType);
  return (cache[key] = { rows, told });
}

/** Say each notice once per attack: a later question, or the preview asking again, finds its key already told. */
function tell(ctx, told) {
  const seen = (ctx.rollModsTold ??= new Set());
  for (const t of told) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    globalThis.ui?.notifications?.[t.level]?.(loc(t.lang, t.data));
  }
}

/** The attack seam's contributor. A spell carrier's attack throw is read; its damage is the spell's own. */
const rollModsContributor = {
  carriers: ["attack"],
  attack(ctx, attackType, modifiers) {
    const { rows, told } = rollModRows(ctx, attackType, "attack");
    tell(ctx, told);
    return rows.length ? [...modifiers, ...rows] : modifiers;
  },
  damage(ctx, attackType, modifiers) {
    const { rows, told } = rollModRows(ctx, attackType, "damage");
    tell(ctx, told);
    return rows.length ? [...modifiers, ...rows] : modifiers;
  },
};

/** Put the records' parts on the attack throw and the damage roll. At `ready`, after the roll gates. */
export function installRollMods() {
  addAttackContributor(rollModsContributor);
}

/* -------------------------------------------- */
/*  Item gates                                   */
/* -------------------------------------------- */

// A weapon is magic by what it is (`isMagical`), never by what a spell was cast on it.
registerGate("weaponMundane", (_actor, _gate, ctx) => (ctx?.item ? !isMagical(ctx.item) : null), { at: "item" });
registerGate("weaponMagical", (_actor, _gate, ctx) => (ctx?.item ? isMagical(ctx.item) : null), { at: "item" });

/* -------------------------------------------- */
/*  Saving throws                                */
/* -------------------------------------------- */

/** Resolve applying save parts among themselves and give each kept one as a target part. */
function targetParts(applying) {
  return resolveStacking(applying.filter(usable)).kept.map((p) => ({ key: p.key ?? "rollMods", label: p.label, value: p.value, side: "target" }));
}

/**
 * The target parts a saving throw takes from the saver's `save` parts. A part
 * whose scope applies against `against` (`{actor, token}`, what the save is made
 * against) is a target part labelled as its record, a figure that lowers the
 * number to roll; one whose scope cannot be settled, or any scoped part with no
 * `against`, is returned in `pending` as `{label, value, when: "source"}` and
 * left out of the target. A part that fails adds nothing. Unscoped parts always
 * apply, and the applying ones are resolved among themselves, so two records of
 * one kind give one figure. Pure.
 *
 * A part is narrowed by the save rolled (`save`, against the part's `saves`)
 * and tested through `partHolds` before anything is resolved: one whose gate is
 * off adds nothing, and one whose `saves` the caller named nothing to test, or
 * whose gate cannot be told (an `occasion` gate the roll does not name), is
 * `pending` as `{label, value, when: "save"|"gate"}`.
 *
 * @param {object} saver
 * @param {{against?: {actor: object, token?: object}|null, bearerToken?: object|null, save?: string, occasion?: string}} [options]
 *   `bearerToken` is the saver's token, read for `vsEnemy` against `against.token`; `save` is the system's key for the throw; `occasion` names the occasion the roll is (`partHolds`)
 * @returns {{parts: {key: string, label: string, value: number, side: "target"}[], pending: {label: string, value: number, when: "source"|"save"|"gate"}[]}}
 */
export function saveModParts(saver, { against = null, bearerToken = null, save, occasion } = {}) {
  const applying = [];
  const pending = [];
  for (const entry of rollModsOf(saver).filter((e) => e.part.on === "save")) {
    const { part } = entry;
    const fit = narrow(part, { save, byRef: false });
    if (fit === false) continue;
    const holds = partHolds(saver, part, { token: bearerToken, occasion });
    if (holds === false) continue;
    if (fit === null || holds === null) {
      pending.push({ label: entry.label, value: Number(part.value), when: fit === null ? "save" : "gate" });
      continue;
    }
    if (!hasScope(part)) {
      applying.push(spellStackingPart(entry));
      continue;
    }
    if (!against?.actor) {
      pending.push({ label: entry.label, value: Number(part.value), when: "source" });
      continue;
    }
    const verdict = settle(entry, against.actor, areEnemies(bearerToken, against.token));
    if (verdict.undetermined) pending.push({ label: entry.label, value: Number(part.value), when: "source" });
    else if (verdict.applies) applying.push(spellStackingPart(entry, verdict.sign));
  }
  return { parts: targetParts(applying), pending };
}

/**
 * What a saving throw rolled from the sheet takes from the saver's `save` parts,
 * which know nothing of what is resisted: the ones that hold (narrowed by the
 * `save` rolled and tested through `partHolds`), resolved among themselves,
 * lower the number to roll by `total`; each scoped one is left out and told,
 * as is one whose gate or `saves` cannot be told (`pending`). `told` is a
 * list of notices for `tellRollMods`.
 *
 * @param {object} actor
 * @param {{save?: string, occasion?: string}} [options]  `save` is the system's key for the throw rolled; `occasion` is `partHolds`'s
 * @returns {{total: number, parts: {key: string, label: string, value: number}[], pending: {label: string, value: number, when: "save"|"gate"}[], told: {level: string, lang: string, data: object}[]}}
 */
export function sheetSaveShift(actor, { save, occasion } = {}) {
  const applying = [];
  const pending = [];
  const told = [];
  for (const entry of rollModsOf(actor).filter((e) => e.part.on === "save")) {
    const fit = narrow(entry.part, { save, byRef: false });
    if (fit === false) continue;
    const holds = partHolds(actor, entry.part, { occasion });
    if (holds === false) continue;
    if (fit === null || holds === null) {
      pending.push({ label: entry.label, value: Number(entry.part.value), when: fit === null ? "save" : "gate" });
      told.push({ level: "info", lang: "notice.savePending", data: { name: actor?.name ?? "", spell: entry.label, value: signed(Number(entry.part.value)) } });
      continue;
    }
    if (hasScope(entry.part)) told.push({ level: "info", lang: "notice.saveScoped", data: { name: actor?.name ?? "", spell: entry.label } });
    else applying.push(spellStackingPart(entry));
  }
  const parts = targetParts(applying);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (parts.length) {
    const rows = parts.map((p) => `${p.label} ${signed(p.value)}`).join(", ");
    told.push({ level: "info", lang: "notice.saveApplied", data: { name: actor?.name ?? "", rows } });
  }
  return { total, parts, pending, told };
}

/** Say notices `sheetSaveShift` returned, through the notification bar. */
export function tellRollMods(told) {
  for (const t of told ?? []) globalThis.ui?.notifications?.[t.level]?.(loc(t.lang, t.data));
}
