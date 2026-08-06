/* global game */
/**
 * ITEM PROPERTY LAYERS — one baseline, recomputed.
 *
 * Masterwork (RR p159) and a scavenged condition (RR p160) both express
 * themselves in the SAME core fields: `system.bonus`, the damage string,
 * `system.aac.value`, `system.weight6`. Each used to stamp those fields and
 * snapshot its own "base" to restore later — which is wrong the moment both are
 * present: clearing one restores a baseline that already contains the other's
 * delta, leaving residue (a "pristine" item still reading 1d6-1) or silently
 * discarding the other layer.
 *
 * So there is exactly ONE snapshot — `flags.acks-extras.pristine`, captured
 * the first time any layer is applied — and every change RECOMPUTES the fields
 * from it:
 *
 *     pristine → + masterwork → + scavenged → written to the item
 *
 * Clearing the last layer restores the pristine values exactly and drops the
 * snapshot, so an item can always get back to what it was. Damage deltas are
 * combined NUMERICALLY (a +1 masterwork and a -1 dent cancel to "1d6", not
 * "1d6 + 1-1"), which is also what a reader expects to see on the sheet.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { MASTERWORK, SILVER } from "./config.mjs";

/** The flag holding the item's unmodified field values. */
export const PRISTINE = "pristine";

/**
 * The reader's explicit answer about silver plating: `true` plated, `false`
 * explicitly not, `null` never stated (so `isSilvered` in silver.mjs guesses).
 * The price layer below keys on `true` alone — only plating a reader ASKED for
 * bills them for it.
 */
export function silveredFlagOf(item) {
  const v = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED);
  return v === undefined || v === null ? null : !!v;
}

/** Split a damage string into its die text and trailing flat modifier. */
export function splitDamage(damage) {
  const s = String(damage ?? "").trim();
  const m = /^(.*?)\s*([+-])\s*(\d+)\s*$/.exec(s);
  if (!m || !m[1]) return { die: s, flat: 0 };
  return { die: m[1].trim(), flat: (m[2] === "-" ? -1 : 1) * parseInt(m[3], 10) };
}

/** Re-join a die and a flat modifier ("1d6", +1 → "1d6 + 1"; 0 → "1d6"). */
export function joinDamage(die, flat) {
  const base = String(die ?? "").trim();
  if (!flat) return base;
  if (!base) return `${flat > 0 ? "+" : "-"}${Math.abs(flat)}`;
  return `${base} ${flat > 0 ? "+" : "-"} ${Math.abs(flat)}`;
}

/** Apply a numeric delta to a damage string, combining with any existing one. */
export function withFlatDelta(damage, delta) {
  const { die, flat } = splitDamage(damage);
  return joinDamage(die, flat + (delta ?? 0));
}

/** The item's unmodified values — the stored snapshot, else the item as it is. */
export function pristineOf(item) {
  return (
    item?.getFlag?.(MODULE_ID, PRISTINE) ?? {
      bonus: Number(item?.system?.bonus ?? 0),
      damage: item?.system?.damage ?? "",
      ac: Number(item?.system?.aac?.value ?? 0),
      weight6: Number(item?.system?.weight6 ?? 0),
      cost: Number(item?.system?.cost ?? 0),
    }
  );
}

/** The masterwork tier key on an item, or null. */
export const masterworkTierOf = (item) => item?.getFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK)?.tier ?? null;
/** The accumulated scavenged condition on an item, or null. */
export const scavengedOf = (item) => item?.getFlag?.(MODULE_ID, "scavenged") ?? null;

/**
 * The combined deltas of every active layer.
 * @returns {{bonus:number, damage:number, ac:number, weight6:number}}
 */
export function layerDeltas(
  item,
  { masterwork = masterworkTierOf(item), scavenged = scavengedOf(item), silvered = silveredFlagOf(item) === true } = {},
) {
  // `costBaseMul` scales the weapon's OWN listed price, `costAdd` is then added,
  // and `costMul` scales the whole. The order is the rules': silver is "10× the
  // listed price of the weapon" (RR ch.4) and so cannot multiply a masterwork
  // surcharge that RAW states as a flat "additional 80gp" (RR p159); a scavenged
  // item is then worth a fraction of whatever it would otherwise fetch (RR p160
  // sells scavenged gear "in volumes determined by their actual (reduced) value").
  const d = { bonus: 0, damage: 0, ac: 0, weight6: 0, costAdd: 0, costMul: 1, costBaseMul: 1 };
  // Silver moves no other number: "apart from gaining the Silver feature, the
  // weapon's characteristics do not change" (RR ch.4).
  if (silvered) d.costBaseMul *= SILVER.priceMultiplier;
  const mw = masterwork && masterwork !== "none" ? MASTERWORK[masterwork] : null;
  if (mw) {
    d.bonus += mw.toHit ?? 0;
    d.damage += mw.toDamage ?? 0;
    d.ac += mw.ac ?? 0;
    d.weight6 -= (mw.weightMinusStone ?? 0) * 6;
    d.costAdd += mw.cost ?? 0;
  }
  if (scavenged) {
    d.bonus += scavenged.attack ?? 0;
    d.damage += scavenged.damage ?? 0;
    d.ac += scavenged.ac ?? 0;
    d.weight6 += (scavenged.encumbrance ?? 0) * 6;
    if (Number.isFinite(scavenged.valueMultiplier)) d.costMul *= scavenged.valueMultiplier;
  }
  return d;
}

/**
 * Recompute an item's fields from its pristine baseline plus every active layer,
 * and write the result. Captures the baseline on the first layer; restores it
 * exactly and drops it when the last layer is cleared.
 *
 * `overrides` lets a caller recompute for a layer it is about to store (or
 * remove) without a second write — pass `{masterwork: null}` to drop masterwork.
 */
export async function recomputeItemFields(item, overrides = {}) {
  if (!item) return;
  const masterwork = "masterwork" in overrides ? overrides.masterwork : masterworkTierOf(item);
  const scavenged = "scavenged" in overrides ? overrides.scavenged : scavengedOf(item);
  const silvered = "silvered" in overrides ? overrides.silvered : silveredFlagOf(item) === true;
  const anyLayer = !!(masterwork && masterwork !== "none") || !!scavenged || silvered;

  const stored = item.getFlag?.(MODULE_ID, PRISTINE) ?? null;
  // With no snapshot yet, the item as it stands IS pristine — capture it before
  // the first layer writes over it.
  const base = stored ?? pristineOf(item);

  const update = {};
  if (!anyLayer) {
    // Nothing left: restore exactly, then forget the baseline.
    update["system.bonus"] = base.bonus;
    if (item.type === "weapon") update["system.damage"] = base.damage;
    if (item.type === "armor") update["system.aac.value"] = base.ac;
    update["system.weight6"] = base.weight6;
    if (base.cost != null) update["system.cost"] = base.cost;
    await item.update?.(update);
    if (stored) await item.unsetFlag?.(MODULE_ID, PRISTINE);
    return;
  }

  const d = layerDeltas(item, { masterwork, scavenged, silvered });
  update["system.bonus"] = base.bonus + d.bonus;
  if (item.type === "weapon") update["system.damage"] = withFlatDelta(base.damage, d.damage);
  if (item.type === "armor") update["system.aac.value"] = Math.max(0, base.ac + d.ac);
  update["system.weight6"] = Math.max(0, base.weight6 + d.weight6);
  // Price follows the layers: plating first, surcharge second, resale fraction
  // last. Rounded to a hundredth so a 67% of 3gp reads 2.01, not a float tail.
  const cost = (Number(base.cost ?? 0) * d.costBaseMul + d.costAdd) * d.costMul;
  update["system.cost"] = Math.round(cost * 100) / 100;
  if (!stored) update[`flags.${MODULE_ID}.${PRISTINE}`] = base;
  await item.update?.(update);
}

/** Human summary of what the layers are doing, for the sheet. */
export function layerSummary(item) {
  const d = layerDeltas(item);
  const bits = [];
  if (d.bonus) bits.push(`${d.bonus > 0 ? "+" : ""}${d.bonus} hit`);
  if (d.damage) bits.push(`${d.damage > 0 ? "+" : ""}${d.damage} dmg`);
  if (d.ac) bits.push(`${d.ac > 0 ? "+" : ""}${d.ac} AC`);
  if (d.weight6) bits.push(`${d.weight6 > 0 ? "+" : ""}${(d.weight6 / 6).toFixed(2).replace(/\.?0+$/, "")} st`);
  const sc = scavengedOf(item);
  if (sc?.breaks) bits.push("breaks on a 1");
  if (sc?.cannotSneak) bits.push("cannot sneak");
  if (sc?.initiative) bits.push(`${sc.initiative} init`);
  for (const n of sc?.notes ?? []) bits.push(n);
  // Say what happened to the PRICE, since that is the whole point of a resale
  // percentage and the number on the sheet otherwise looks unexplained.
  const base = pristineOf(item);
  if (d.costAdd || d.costMul !== 1 || d.costBaseMul !== 1) {
    const priced = Math.round((Number(base.cost ?? 0) * d.costBaseMul + d.costAdd) * d.costMul * 100) / 100;
    bits.push(`${priced}gp (was ${base.cost ?? 0}gp)`);
  }
  return bits.join(", ");
}

void game;
