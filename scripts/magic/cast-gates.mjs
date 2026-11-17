/**
 * Whom a cast reaches and who makes no save. A spell's `target.hdCap` is the
 * most Hit Dice a target may have for the spell to touch it at all, so a target
 * over it is unaffected on every row; its `save.exemptBelowHd` is the Hit Dice
 * below which a target makes no save and takes the effect as on a failed save;
 * and a row's `exemptSizeFrom` exempts a target at or above that size from that
 * row alone. Both thresholds are LevelValues read at the caster level, and a
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
import { hitDiceOrLevel, sizeKeyOf, rankOfSize } from "../lib/actor-read.mjs";
import { modifierFigure } from "./cast-mods.mjs";
import { scaled } from "./cast-instances.mjs";

/** The keys of the gate's parts, named in the card's tooltips. */
export const GATE_KEYS = Object.freeze({ hd: "hd", size: "size", noSave: "noSave" });

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
 * What the spell's gates say of one target for one row.
 *
 * `affected` is false where the target is over the cap or its size is at or
 * above the row's exemption; `noSave` is true where the target is affected and
 * below the Hit Dice that save. `why` names the gate that decided and its parts
 * with the world's own numbers: `hd` (the target's Hit Dice, the cap, the caster
 * level where the cap scales), `size` (the target's size key and the row's), or
 * `noSave` (the target's Hit Dice, the threshold, the level). A target no gate
 * touches answers `why.key` "". The cap is checked before the size.
 *
 * @param {object} from
 * @param {object} from.actor  the target's actor
 * @param {{target?: {hdCap?: object}, save?: {exemptBelowHd?: object}}|null} [from.extras]  the spell's figures
 * @param {{exemptSizeFrom?: string}|null} [from.row]  the spell's own row; absent, the spell-wide gates only
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
  const from = String(row?.exemptSizeFrom ?? "").trim();
  const key = sizeKeyOf(actor);
  const at = rankOfSize(key);
  const floor = from ? rankOfSize(from) : null;
  if (at !== null && floor !== null && at >= floor) {
    return { affected: false, noSave: false, why: { key: GATE_KEYS.size, parts: [{ key: "size", value: key }, { key: "from", value: from }] } };
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

/**
 * The tooltip of a gate: the target, each part with the world's own numbers, and
 * the spell's page reference. The wording is the cast's own strings
 * (`tip.gateHd`, `tip.gateSize`, `tip.noSave` and the `tip.gatePart` words).
 *
 * @param {{key: string, parts: Array<{key: string, value: number|string}>}|null|undefined} why
 * @param {(key: string, data?: object) => string} loc  the cast's strings
 * @param {{name?: string, cite?: string}} [of]
 * @returns {string} empty where no gate decided
 */
export function gateTip(why, loc, { name = "", cite = "" } = {}) {
  const lead = { [GATE_KEYS.hd]: "tip.gateHd", [GATE_KEYS.size]: "tip.gateSize", [GATE_KEYS.noSave]: "tip.noSave" }[why?.key];
  if (!lead) return "";
  const parts = (why.parts ?? []).map((p) => loc(`tip.gatePart.${p.key}`, { value: p.key === "size" || p.key === "from" ? sizeLabel(p.value) : p.value })).join(" · ");
  return loc(lead, { name, parts, cite });
}
