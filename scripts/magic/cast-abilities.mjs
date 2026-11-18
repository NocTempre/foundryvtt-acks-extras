/**
 * What a caster's own abilities do to one cast: which `spellcastingMod` rows
 * (gathered by lib's `spellcastingRows`) apply to the spell being cast, how
 * they stack, and the figures they leave on the caster level, the save and the
 * damage. FOUNDRY-FREE and pure: the rows, the spell and every lookup are
 * passed in, and nothing is written.
 *
 * A row names what it changes (`target`: `casterLevel`, `save`, `damage`) and
 * narrows what spell it concerns (`schools`, `elements`, `bySelection`,
 * `saveCategories`, a named spell, or the legacy `school` string). Fields AND,
 * the members of one field OR, and a word is told by its folded form, singular
 * or plural. A row with no narrowing field matches nothing, since an unnarrowed
 * row is what the prose scan writes. A row with a blank figure applies nothing
 * and is kept, so its tooltip can still name the page it was read from.
 *
 * Stacking is lib's (`stackingPart`, `resolveStacking`): two abilities add
 * unless a row names the pair, and the rows of one ability never add to each
 * other (the largest stands).
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { libraryTwin } from "./summon-spell.mjs";
import { foldKey } from "./spell-logic.mjs";
import { spellRefOf } from "../lib/spell-sources.mjs";
import { stackingPart, resolveStacking } from "../lib/typed-modifiers.mjs";
import { satisfiesAll } from "../lib/vocab.mjs";

/** The three things a spellcasting row can change, and the order a result lists them in. */
export const ABILITY_BUCKETS = Object.freeze(["casterLevel", "save", "damage"]);

/** The raw spell flag of an item. */
const flagOf = (item) => item?.flags?.[MODULE_ID]?.[FLAG_SPELL] ?? {};

/** A list from an array or a numeric-keyed object, trimmed, blanks dropped. */
const listOf = (value) => {
  const raw = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
  return raw.map((w) => String(w ?? "").trim()).filter(Boolean);
};

/** A word's forms for matching: folded, and folded with a trailing `s` dropped. */
const formsOf = (word) => {
  const folded = foldKey(word);
  return folded ? [folded, folded.replace(/s$/, "")] : [];
};

/** Whether two words are one word, by folded form. */
const sameWord = (a, b) => {
  const left = formsOf(a);
  return left.length > 0 && formsOf(b).some((form) => left.includes(form));
};

/** Whether any word of `wants` is one of `have`. */
const anyWord = (wants, have) => wants.some((w) => have.some((h) => sameWord(w, h)));

/**
 * The facts of a spell a row can narrow on: its type, schools, elements, save
 * category, cookbook id, uuids and folded name. Each figure is the copy's own
 * and, where the copy holds none, its library twin's (`libraryTwin`, read only
 * when something is missing), as the cast's other readers resolve a twin. The
 * identity half (`id`, `uuid`, `uuids`, `name`) is lib's `spellRefOf`.
 *
 * @param {object} spell
 * @param {{byCookbookId: Function, fromUuidSync: Function}} [lookups]
 * @returns {{type: string, schools: string[], elements: string[], saveCategory: string, id: string, uuid: string, uuids: string[], name: string}}
 */
export function spellFacts(spell, lookups) {
  const own = flagOf(spell);
  const lacking = !own.type || !listOf(own.schools).length || !listOf(own.elements).length || !own.save?.category;
  let twin = null;
  if (lacking && lookups) {
    try {
      twin = libraryTwin(spell, lookups);
    } catch {
      twin = null;
    }
  }
  const other = flagOf(twin);
  const ref = spellRefOf(spell, twin);
  return {
    type: own.type || other.type || "",
    schools: listOf(own.schools).length ? listOf(own.schools) : listOf(other.schools),
    elements: listOf(own.elements).length ? listOf(own.elements) : listOf(other.elements),
    saveCategory: own.save?.category || other.save?.category || "",
    id: ref.cookbookId,
    uuid: ref.uuid,
    uuids: ref.uuids,
    name: ref.key,
  };
}

/**
 * Whether a row's named spell is this one: by cookbook id where the row names
 * one and the spell has one, else by uuid on the same terms, else by folded name.
 */
function namesSpell(spec, facts) {
  const ref = spec.spellRef ?? {};
  if (ref.cookbookId && facts.id) return ref.cookbookId === facts.id;
  if (ref.uuid && facts.uuids.length) return facts.uuids.includes(ref.uuid);
  const name = foldKey(ref.name || spec.spell);
  return Boolean(name) && name === facts.name;
}

/** Whether a row names a spell at all. */
const namesAny = (spec) => Boolean(spec.spellRef?.cookbookId || spec.spellRef?.uuid || spec.spellRef?.name || String(spec.spell ?? "").trim());

/**
 * Whether the row's narrowing fields all hold for the spell, and whether it
 * has any. Returns null when the row narrows on nothing.
 */
function narrows(row, facts) {
  const spec = row.spec ?? {};
  const kinds = [facts.type, ...facts.schools];
  const checks = [];
  const schools = listOf(spec.schools);
  const legacy = String(spec.school ?? "").trim();
  if (legacy) schools.push(legacy);
  if (schools.length) checks.push(anyWord(schools, kinds));
  const elements = listOf(spec.elements);
  if (elements.length) checks.push(anyWord(elements, facts.elements));
  if (spec.bySelection === true) checks.push(anyWord(listOf(row.selections), [...facts.elements, ...kinds]));
  const categories = listOf(spec.saveCategories);
  if (categories.length) checks.push(Boolean(facts.saveCategory) && anyWord(categories, [facts.saveCategory]));
  if (namesAny(spec)) checks.push(namesSpell(spec, facts));
  return checks.length ? checks.every(Boolean) : null;
}

/** The held-ability check: a function of the tokens, a list of `{id, provides}`, or the rows' own abilities. */
function holder(has, rows) {
  if (typeof has === "function") return (tokens) => Boolean(has(tokens));
  const abilities = Array.isArray(has) ? has : rows.map((r) => r.ref).filter(Boolean);
  return (tokens) => satisfiesAll(abilities, tokens);
}

/** The signed text of a figure: `+2`, `-1`. */
export const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * The spellcasting rows that apply to one spell, per bucket, after stacking.
 *
 * A part is `{bucket, key, ability, itemId, index, value, perDie, cite,
 * unverified, blank, applies, yieldsTo, sameItem}`, in the rows' order. `applies`
 * is true on a part that counts. A blank-figure row is a part with a null value
 * and `applies: false` (its `cite` is the page the row was read from). A part
 * that lost to another is kept with `applies: false` and `yieldsTo` naming the
 * ability it yielded to; `sameItem` marks a loss to a row of its own ability.
 *
 * A row matches when its target is one of the buckets, it narrows on at least
 * one field, every field it narrows on holds, and every `ifHas` is held.
 *
 * @param {object[]} rows  `spellcastingRows(actor)`
 * @param {object} spell
 * @param {object} [options]
 * @param {Function|object[]} [options.has]  what the actor holds: a function of an `ifHas` token list, or `[{id, provides}]`; the rows' own abilities when omitted
 * @param {{byCookbookId: Function, fromUuidSync: Function}} [options.lookups]  for the spell's library twin
 * @param {object} [options.facts]  the spell's facts, where the caller has read them
 * @returns {{casterLevel: object[], save: object[], damage: object[]}}
 */
export function matchAbilities(rows, spell, { has, lookups, facts } = {}) {
  const out = { casterLevel: [], save: [], damage: [] };
  const list = Array.isArray(rows) ? rows : [];
  const known = facts ?? spellFacts(spell, lookups);
  const held = holder(has, list);
  const byBucket = { casterLevel: [], save: [], damage: [] };
  list.forEach((row, at) => {
    const spec = row?.spec;
    const bucket = spec?.target;
    if (!ABILITY_BUCKETS.includes(bucket) || spec.type !== "spellcastingMod") return;
    if (narrows(row, known) !== true) return;
    if (listOf(spec.ifHas).length && !held(listOf(spec.ifHas))) return;
    const flags = row.item?.flags?.[MODULE_ID]?.cookbook ?? {};
    const blank = row.value === null || row.value === undefined || !Number.isFinite(Number(row.value));
    byBucket[bucket].push(
      stackingPart({
        value: blank ? null : Number(row.value),
        label: String(row.item?.name ?? ""),
        ref: row.ref ?? {},
        stacksWith: listOf(spec.stacksWith),
        notStacksWith: listOf(spec.notStacksWith),
        at,
        bucket,
        key: `${row.item?.id ?? row.ref?.id ?? ""}:${row.index ?? 0}`,
        owner: row.ref?.id || row.item?.id || String(row.item?.name ?? ""),
        itemId: row.item?.id ?? null,
        index: row.index ?? 0,
        perDie: spec.perDie === true,
        cite: String(flags.cite ?? ""),
        unverified: row.unverified === true,
        blank,
      }),
    );
  });
  for (const bucket of ABILITY_BUCKETS) out[bucket] = stackBucket(byBucket[bucket], bucket);
  return out;
}

/** Plain data of a stacking part: the stacking machinery's fields left off. */
const plain = ({ caps: _c, stacksWith: _s, notStacksWith: _n, ref: _r, owner: _o, at: _a, ...part }, applies, yieldsTo = null, sameItem = false) => ({
  ...part,
  applies,
  yieldsTo,
  sameItem,
});

/**
 * One bucket's matched parts, stacked: a blank part applies nothing, one
 * ability's rows leave the best, and lib orders what remains. "Best" is the
 * caster's benefit: the largest figure for `casterLevel` and `damage`, the most
 * negative for `save`, whose figure is added to the target's die. lib ranks by
 * the larger value, so the save bucket goes through it negated and the verdicts
 * come back to the original parts.
 */
function stackBucket(parts, bucket) {
  const sign = bucket === "save" ? -1 : 1;
  const verdict = new Map();
  const figures = parts.filter((p) => !p.blank);
  const survivors = [];
  const owners = new Map();
  for (const part of figures) {
    if (!owners.has(part.owner)) owners.set(part.owner, []);
    owners.get(part.owner).push(part);
  }
  for (const group of owners.values()) {
    const [winner, ...rest] = [...group].sort((x, y) => sign * (y.value - x.value));
    survivors.push(winner);
    for (const lost of rest) verdict.set(lost, { yieldsTo: winner.label, sameItem: true });
  }
  const { dropped } = resolveStacking(survivors.map((p) => ({ ...p, value: sign * p.value })));
  for (const lost of dropped) {
    const original = survivors.find((p) => p.at === lost.at);
    verdict.set(original, { yieldsTo: lost.yieldsTo, sameItem: false });
  }
  return parts.map((part) => {
    if (part.blank) return plain(part, false);
    const lost = verdict.get(part);
    return lost ? plain(part, false, lost.yieldsTo, lost.sameItem) : plain(part, true);
  });
}

/** The sum of the figures of the parts that apply (a `perDie` part counts once; see `perDieTotal`). */
export const appliedSum = (parts) => (parts ?? []).filter((p) => p.applies && Number.isFinite(p.value)).reduce((sum, p) => sum + p.value, 0);

/**
 * The caster level with the abilities' deltas on it. `level` is `casterLevel()`'s
 * output. A level nothing resolved stays null, and a level typed by hand takes
 * no delta; in both the matched parts are returned in `listed`, not added. The
 * result is never below one.
 *
 * @param {{value: number|null, source: string|null, parts: object[]}} level
 * @param {object[]} parts  the `casterLevel` bucket of `matchAbilities`
 * @returns {{value: number|null, source: string|null, base: number|null, parts: object[], listed: object[]}}
 */
export function castAbilityLevel(level, parts) {
  const base = Number.isFinite(level?.value) ? level.value : null;
  const source = level?.source ?? null;
  const all = Array.isArray(parts) ? parts : [];
  if (base === null || source === "hand") return { value: base, source, base, parts: [], listed: all };
  const applied = all.filter((p) => p.applies && Number.isFinite(p.value));
  const value = Math.max(1, base + appliedSum(applied));
  return { value, source, base, parts: applied, listed: all.filter((p) => !applied.includes(p)) };
}

/**
 * How many dice a formula rolls: every `NdM` term counts N, a bare `dM` counts
 * one. A formula with no die counts none.
 */
export function diceCount(formula) {
  let total = 0;
  for (const match of String(formula ?? "").toLowerCase().matchAll(/(\d*)d\d+/g)) total += match[1] === "" ? 1 : Number(match[1]);
  return total;
}

/**
 * A damage part's figure for a scaled formula: a `perDie` part is its value
 * times the dice the formula rolls, any other part its value. A part with no
 * figure is zero.
 *
 * @param {{value: number|null, perDie?: boolean}} part
 * @param {string} formula  the scaled damage formula
 */
export function perDieTotal(part, formula) {
  if (!Number.isFinite(part?.value)) return 0;
  return part.perDie ? part.value * diceCount(formula) : part.value;
}

/**
 * The tooltip of one ability part: "{ability} {±value} ({cite})", and
 * "yields to {other}" after it where the part lost. A part with no figure names
 * its ability and its page. `loc(key, data)` is the caller's localizer.
 *
 * @param {object} part
 * @param {(key: string, data?: object) => string} loc
 */
export function abilityPartTip(part, loc) {
  const ability = part?.label ?? "";
  const cite = part?.cite ?? "";
  let head;
  if (part?.blank) head = cite ? loc("ACKS-MAGIC.cast.ability.blank", { ability, cite }) : ability;
  else head = loc(cite ? "ACKS-MAGIC.cast.ability.part" : "ACKS-MAGIC.cast.ability.partBare", { ability, value: signed(part?.value), cite });
  return part?.yieldsTo ? `${head} · ${loc("ACKS-MAGIC.cast.ability.yields", { other: part.yieldsTo })}` : head;
}
