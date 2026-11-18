/**
 * Whom a cast reaches and who makes no save. A spell's `target.hdCap` is the
 * most Hit Dice a target may have for the spell to touch it at all, so a target
 * over it is unaffected on every row, and its `target.hdBelow` the Hit Dice a
 * target must stay strictly under (a target at or above it is exempt); its
 * `target.filters` name the kinds of creature it touches (`kindGate`); its
 * `save.exemptBelowHd` is the Hit Dice
 * below which a target makes no save and takes the effect as on a failed save;
 * and a row's `exemptSizeFrom` exempts a target at or above that size from that
 * row alone, its `exemptSizeOver` one strictly above it. A target whose own
 * records grant it immunity (`recordImmunity`) to the spell, or to every condition
 * a row writes, is exempt too. Both thresholds are LevelValues read at the caster level, and a
 * threshold the import left blank, or one that scales with a level none
 * resolved, gates nothing: a level is never defaulted. A target's Hit Dice are
 * `hitDiceOrLevel` (a monster's bonus to its Hit Dice is not counted), and a
 * target whose Hit Dice or size cannot be read is gated by no figure that needs
 * it.
 *
 * The cast and the relay's GM client both ask `targetGate`, so the verdict is
 * recomputed where it is enforced. Every figure is read from the world: this file
 * holds the comparisons only. Pure and Foundry-free.
 */
import { hitDiceOrLevel, sizeKeyOf, rankOfSize, creatureKinds } from "../lib/actor-read.mjs";
import { vocabLabel } from "../lib/magic-vocab.mjs";
import { recordImmunity } from "../lib/roll-mods.mjs";
import { modifierFigure } from "./cast-mods.mjs";
import { scaled } from "./cast-instances.mjs";

/** The keys of the gate's parts, named in the card's tooltips. */
export const GATE_KEYS = Object.freeze({ hd: "hd", size: "size", kind: "kind", noSave: "noSave", immune: "immune" });

/**
 * The target filters a creature's kinds (`creatureKinds`) can decide, each as the
 * test a creature passes. A character counts as humanoid and living, and the
 * defined term humanoid takes in the man-like monster type beastman (RR ch. 5,
 * Defined Terms); `living` fails on undead alone. Every other filter (allies, enemies, objects, structures,
 * the sapient, the dead) is shown on the card and never gates.
 */
const KIND_RULES = Object.freeze({
  living: (kinds) => !kinds.has("undead"),
  undead: (kinds) => kinds.has("undead"),
  enchanted: (kinds) => kinds.has("enchanted"),
  humanoid: (kinds) => kinds.has("humanoid") || kinds.has("beastman") || kinds.has("character"),
  animal: (kinds) => kinds.has("animal"),
  plant: (kinds) => kinds.has("plant"),
});

/**
 * What a spell's `target.filters` say of one creature: null where it passes or the
 * filters cannot decide, else the parts that name why it is exempt (`filter`, the
 * words, and `kinds`, what the creature answers to). `living` is a condition of its
 * own, and the other words are alternatives, any one of which admits the creature.
 * A creature whose kinds are unknown (an empty set) is not gated, and a list that
 * holds a word no kind decides cannot exempt on its alternatives.
 *
 * @param {object} actor
 * @param {Iterable<string>|null|undefined} filters
 * @returns {Array<{key: string, value: string}>|null}
 */
export function kindGate(actor, filters) {
  const words = [...new Set(Array.from(filters ?? []).map((w) => String(w ?? "").trim()).filter(Boolean))];
  if (!words.length || !actor) return null;
  const kinds = creatureKinds(actor);
  if (!kinds.size) return null;
  const exempt = [{ key: "filter", value: words.join(",") }, { key: "kinds", value: [...kinds].join(",") }];
  if (words.includes("living") && !KIND_RULES.living(kinds)) return exempt;
  const types = words.filter((w) => w !== "living");
  if (!types.length || !types.every((w) => w in KIND_RULES)) return null;
  return types.some((w) => KIND_RULES[w](kinds)) ? null : exempt;
}

/** A threshold's figure at a caster level with the level it was read at where it scales; null where nothing reads. */
function figureAt(lv, level) {
  const value = modifierFigure({ value: lv }, level);
  if (value === null) return null;
  return { value, parts: scaled(lv) ? [{ key: "level", value: Number(level) }] : [] };
}

/** A creature's Hit Dice where they are readable, else null. */
function hdOf(actor) {
  const hd = Number(hitDiceOrLevel(actor));
  return Number.isFinite(hd) && hd > 0 ? hd : null;
}

/**
 * What a target's records say of immunity to this spell or this row: null where
 * none applies, else the part naming the record. The spell's own immunity
 * exempts every row; a row is exempt by condition only where the record covers
 * every condition the row writes (a row covered in part still writes the rest).
 */
function immuneGate(actor, spell, row) {
  const conditions = Array.from(row?.conditions ?? []).map(String);
  const found = recordImmunity(actor, { spell, conditions });
  if (spell && found.spell) return { key: GATE_KEYS.immune, parts: [{ key: "by", value: found.spell.label }] };
  if (conditions.length && conditions.every((c) => found.conditions[c])) return { key: GATE_KEYS.immune, parts: [{ key: "by", value: [...new Set(conditions.map((c) => found.conditions[c].label))].join(", ") }] };
  return null;
}

/**
 * What the spell's gates say of one target for one row.
 *
 * `affected` is false where the target is over the cap, at or above the strict bound,
 * outside the kinds the filters name, or its size is at or
 * above the row's exemption; `noSave` is true where the target is affected and
 * below the Hit Dice that save. `why` names the gate that decided and its parts
 * with the world's own numbers: `hd` (the target's Hit Dice, the cap or the `bound`,
 * the caster level where it scales), `kind` (the filters and the target's kinds), `size` (the target's size key and the row's), or
 * `noSave` (the target's Hit Dice, the threshold, the level). A target no gate
 * touches answers `why.key` "". The cap and the bound are checked before the kinds, and the kinds before immunity and the size.
 *
 * @param {object} from
 * @param {object} from.actor  the target's actor
 * @param {{target?: {hdCap?: object, hdBelow?: object, filters?: Iterable<string>}, save?: {exemptBelowHd?: object}, spell?: {id?: string, provides?: string[]}}|null} [from.extras]  the spell's figures, and the spell as a record's immunity names it
 * @param {{exemptSizeFrom?: string, exemptSizeOver?: string, conditions?: string[]}|null} [from.row]  the spell's own row; absent, the spell-wide gates only
 * @param {number|null} [from.level]  the resolved caster level
 * @returns {{affected: boolean, noSave: boolean, why: {key: string, parts: Array<{key: string, value: number|string}>}}}
 */
export function targetGate({ actor, extras = null, row = null, level = null } = {}) {
  const clear = { affected: true, noSave: false, why: { key: "", parts: [] } };
  if (!actor) return clear;
  const hd = hdOf(actor);
  const cap = hd === null ? null : figureAt(extras?.target?.hdCap, level);
  if (cap && hd > cap.value) {
    return { affected: false, noSave: false, why: { key: GATE_KEYS.hd, parts: [{ key: "hd", value: hd }, { key: "cap", value: cap.value }, ...cap.parts] } };
  }
  const bound = hd === null ? null : figureAt(extras?.target?.hdBelow, level);
  if (bound && hd >= bound.value) {
    return { affected: false, noSave: false, why: { key: GATE_KEYS.hd, parts: [{ key: "hd", value: hd }, { key: "bound", value: bound.value }, ...bound.parts] } };
  }
  const kind = kindGate(actor, extras?.target?.filters);
  if (kind) return { affected: false, noSave: false, why: { key: GATE_KEYS.kind, parts: kind } };
  const immune = immuneGate(actor, extras?.spell ?? null, row);
  if (immune) return { affected: false, noSave: false, why: immune };
  const from = String(row?.exemptSizeFrom ?? "").trim();
  const over = String(row?.exemptSizeOver ?? "").trim();
  const key = sizeKeyOf(actor);
  const at = rankOfSize(key);
  const floor = from ? rankOfSize(from) : null;
  const above = over ? rankOfSize(over) : null;
  if (at !== null && floor !== null && at >= floor) {
    return { affected: false, noSave: false, why: { key: GATE_KEYS.size, parts: [{ key: "size", value: key }, { key: "from", value: from }] } };
  }
  if (at !== null && above !== null && at > above) {
    return { affected: false, noSave: false, why: { key: GATE_KEYS.size, parts: [{ key: "size", value: key }, { key: "over", value: over }] } };
  }
  const below = hd === null ? null : figureAt(extras?.save?.exemptBelowHd, level);
  if (below && hd < below.value) {
    return { affected: true, noSave: true, why: { key: GATE_KEYS.noSave, parts: [{ key: "hd", value: hd }, { key: "below", value: below.value }, ...below.parts] } };
  }
  return clear;
}

/**
 * The resist a no-save target carries: a failed save with no roll, kept in the
 * shape of a rolled one so the application reads it as it reads a failure, and
 * marked by the gate that made it. The relay recomputes the gate, never this
 * object.
 *
 * @param {{category?: string}} save  the cast's save
 * @param {{key: string, parts: object[]}} why  the gate's `why`
 */
export const noSaveResist = (save, why) => ({
  kind: "save",
  category: save?.category ?? "",
  formula: "",
  total: null,
  target: null,
  baseTarget: null,
  success: false,
  noSave: { key: why?.key ?? GATE_KEYS.noSave, parts: Array.from(why?.parts ?? []).map(({ key, value }) => ({ key, value })) },
  parts: [],
});

/** The label of a size key as the monsters feature names it, else the key. */
export function sizeLabel(key) {
  const label = globalThis.acksExtras?.monsters?.config?.SIZES?.[key]?.label;
  return label ? (globalThis.game?.i18n?.localize?.(label) ?? label) : String(key ?? "");
}

/** The label of a kind token as the monsters feature names its types, else the token. */
function kindLabel(token) {
  const label = globalThis.acksExtras?.monsters?.config?.MONSTER_TYPES?.[token]?.label;
  return label ? (globalThis.game?.i18n?.localize?.(label) ?? label) : String(token ?? "");
}

/** A gate part's value as the tooltip words it: sizes, filters and kinds by their labels. */
function partValue(part) {
  if (part.key === "size" || part.key === "from" || part.key === "over") return sizeLabel(part.value);
  if (part.key === "filter") return String(part.value).split(",").map((w) => vocabLabel("targetFilter", w)).join(", ");
  if (part.key === "kinds") return String(part.value).split(",").map(kindLabel).join(", ");
  return part.value;
}

/**
 * The tooltip of a gate: the target, each part with the world's own numbers, and
 * the spell's page reference. The wording is the cast's own strings
 * (`tip.gateHd`, `tip.gateSize`, `tip.gateKind`, `tip.noSave` and the `tip.gatePart` words).
 *
 * @param {{key: string, parts: Array<{key: string, value: number|string}>}|null|undefined} why
 * @param {(key: string, data?: object) => string} loc  the cast's strings
 * @param {{name?: string, cite?: string}} [of]
 * @returns {string} empty where no gate decided
 */
export function gateTip(why, loc, { name = "", cite = "" } = {}) {
  const lead = { [GATE_KEYS.hd]: "tip.gateHd", [GATE_KEYS.size]: "tip.gateSize", [GATE_KEYS.kind]: "tip.gateKind", [GATE_KEYS.noSave]: "tip.noSave", [GATE_KEYS.immune]: "tip.gateImmune" }[why?.key];
  if (!lead) return "";
  const parts = (why.parts ?? []).map((p) => loc(`tip.gatePart.${p.key}`, { value: partValue(p) })).join(" · ");
  return loc(lead, { name, parts, cite });
}
