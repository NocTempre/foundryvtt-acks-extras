/* global game */
/**
 * ITEM PROPERTY LAYERS — one baseline, recomputed.
 *
 * Masterwork (RR p159) and a scavenged condition (RR p160) both express
 * themselves in the SAME core fields: `system.bonus.attack`, the base damage
 * formula, `system.ac.value`, `system.weight6`. So there is exactly ONE
 * snapshot, `flags.acks-extras.pristine`, captured the first time any layer is
 * applied, and every change RECOMPUTES the fields from it:
 *
 *     pristine → + masterwork → + scavenged → − item loss → written to the item
 *
 * Clearing the last layer restores the pristine values exactly and drops the
 * snapshot. Damage deltas are combined NUMERICALLY (a +1 and a -1 cancel to
 * "1d6", not "1d6 + 1-1").
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { MASTERWORK, SILVER } from "./config.mjs";
import { silverFigure, masterworkFigure, provenanceTip, notImportedTip } from "./printed-layers.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { whenReady } from "../lib/library.mjs";
import { sumDeltas, entryOf, definitionFrom } from "./variations.mjs";
import { variationItemsOf } from "./variation-items.mjs";

/** The flag holding the item's unmodified field values. */
export const PRISTINE = "pristine";

/**
 * The reader's explicit answer about silver plating: `true` plated, `false`
 * explicitly not, `null` never stated (so `isSilvered` in silver.mjs guesses).
 * The price layer below keys on `true` alone.
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

/**
 * The die a weapon item deals: the system's base damage formula, or a bare
 * `system.damage` string where the item carries one.
 */
export function damageFormulaOf(item) {
  const damage = item?.system?.damage;
  if (typeof damage === "string") return damage;
  return damage?.base?.formula ?? "";
}

/** A weapon's attack bonus: the system's field, or a bare `system.bonus` number where the item carries one. */
export function attackBonusOf(item) {
  const bonus = item?.system?.bonus;
  return Number((typeof bonus === "object" && bonus !== null ? bonus.attack : bonus) ?? 0);
}

/** The item's unmodified values — the stored snapshot, else the item as it is. */
export function pristineOf(item) {
  return (
    item?.getFlag?.(MODULE_ID, PRISTINE) ?? {
      bonus: attackBonusOf(item),
      damage: damageFormulaOf(item),
      ac: Number(item?.system?.ac?.value ?? 0),
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
 * The armour class an item has lost to item loss, as a count above zero or 0.
 * It is a layer of its own, so rolling or clearing a scavenged condition never
 * touches it.
 */
export const itemLossAcOf = (item) => Math.max(0, Number(item?.getFlag?.(MODULE_ID, ITEM_FLAGS.ITEM_LOSS_AC)) || 0);

/**
 * The combined deltas of every active layer.
 * @returns {{bonus:number, damage:number, ac:number, weight6:number}}
 */
export function layerDeltas(
  item,
  { masterwork = masterworkTierOf(item), scavenged = scavengedOf(item), silvered = silveredFlagOf(item) === true, itemLossAc = itemLossAcOf(item) } = {},
) {
  // `costBaseMul` scales the weapon's OWN listed price, `costAdd` is then added,
  // and `costMul` scales the whole: silver (RR ch.4) cannot multiply a
  // masterwork surcharge (RR p. 159), and a scavenged item's fraction (RR
  // p. 160) applies last.
  const d = { bonus: 0, damage: 0, ac: 0, weight6: 0, costAdd: 0, costMul: 1, costBaseMul: 1 };
  // Both layers read the imported variation documents (`printed-layers.mjs`);
  // a layer whose document is not imported applies nothing.
  const sv = silvered ? silverFigure() : null;
  const mw = masterwork && masterwork !== "none" ? masterworkFigure(masterwork) : null;
  for (const fig of [sv, mw]) {
    if (!fig) continue;
    d.bonus += fig.bonus;
    d.damage += fig.damage;
    d.ac += fig.ac;
    d.weight6 += fig.weight6;
    d.costAdd += fig.costAdd;
    d.costMul *= fig.costMul;
    d.costBaseMul *= fig.costBaseMul;
  }
  if (scavenged) {
    d.bonus += scavenged.attack ?? 0;
    d.damage += scavenged.damage ?? 0;
    d.ac += scavenged.ac ?? 0;
    d.weight6 += (scavenged.encumbrance ?? 0) * 6;
    if (Number.isFinite(scavenged.valueMultiplier)) d.costMul *= scavenged.valueMultiplier;
  }
  d.ac -= itemLossAc;

  // Variations: documents applied to this item that carry their own numbers.
  // Both halves share one delta set and one cost order.
  const applied = variationItemsOf(item);
  if (applied.length) {
    const byKey = new Map(applied.map((v) => [v.system?.key, definitionFrom(v)]));
    const v = sumDeltas(applied.map(entryOf), (key) => byKey.get(key) ?? null, { item });
    d.bonus += v.bonus;
    d.damage += v.damage;
    d.ac += v.ac;
    d.weight6 += v.weight6;
    d.costAdd += v.costAdd;
    d.costMul *= v.costMul;
    d.costBaseMul *= v.costBaseMul;
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
  // The layers' figures are library documents read synchronously; wait for the
  // shelf so a still-loading one does not write the item back to pristine.
  await whenReady();
  const masterwork = "masterwork" in overrides ? overrides.masterwork : masterworkTierOf(item);
  const scavenged = "scavenged" in overrides ? overrides.scavenged : scavengedOf(item);
  const silvered = "silvered" in overrides ? overrides.silvered : silveredFlagOf(item) === true;
  const itemLossAc = "itemLossAc" in overrides ? overrides.itemLossAc : itemLossAcOf(item);
  const anyLayer =
    !!(masterwork && masterwork !== "none") || !!scavenged || silvered || itemLossAc > 0 || variationItemsOf(item).length > 0;

  const stored = item.getFlag?.(MODULE_ID, PRISTINE) ?? null;
  // With no snapshot yet, the item as it stands IS pristine.
  const base = stored ?? pristineOf(item);

  const update = {};
  if (!anyLayer) {
    // Nothing left: restore exactly, then forget the baseline.
    if (item.type === ITEM_TYPE.weapon) {
      update["system.bonus.attack"] = base.bonus;
      update["system.damage.base.formula"] = base.damage;
    }
    if (item.type === ITEM_TYPE.armor) update["system.ac.value"] = base.ac;
    update["system.weight6"] = base.weight6;
    if (base.cost != null) update["system.cost"] = base.cost;
    await item.update?.(update);
    if (stored) await item.unsetFlag?.(MODULE_ID, PRISTINE);
    return;
  }

  const d = layerDeltas(item, { masterwork, scavenged, silvered, itemLossAc });
  if (item.type === ITEM_TYPE.weapon) {
    update["system.bonus.attack"] = base.bonus + d.bonus;
    update["system.damage.base.formula"] = withFlatDelta(base.damage, d.damage);
  }
  if (item.type === ITEM_TYPE.armor) update["system.ac.value"] = Math.max(0, base.ac + d.ac);
  update["system.weight6"] = Math.max(0, base.weight6 + d.weight6);
  // Price follows the layers: plating first, surcharge second, resale fraction
  // last. Rounded to a hundredth so a 67% of 3gp reads 2.01, not a float tail.
  const cost = (Number(base.cost ?? 0) * d.costBaseMul + d.costAdd) * d.costMul;
  update["system.cost"] = Math.round(cost * 100) / 100;
  if (!stored) update[`flags.${MODULE_ID}.${PRISTINE}`] = base;
  await item.update?.(update);
}

/**
 * The snapshot value that `recomputeItemFields` turns into `typed` under
 * `delta`, for one snapshot key (`bonus`, `damage`, `ac`, `weight6`). A blank
 * damage stays blank; a number that is not one is null.
 */
export function baseForTyped(key, typed, delta) {
  if (key === "damage") return String(typed ?? "").trim() ? withFlatDelta(typed, -(delta?.damage ?? 0)) : "";
  const base = Number(typed) - (delta?.[key] ?? 0);
  return Number.isFinite(base) ? base : null;
}

/**
 * The silver and masterwork layers an item is set to but whose imported
 * document is absent, so they apply nothing. Each names the variation key a
 * Judge would import or make by hand.
 *
 * @returns {{layer: "silver"|"masterwork", tier?: string, key: string}[]}
 */
export function unstatedLayers(
  item,
  { masterwork = masterworkTierOf(item), silvered = silveredFlagOf(item) === true } = {},
) {
  const out = [];
  if (silvered && !silverFigure()) out.push({ layer: "silver", key: SILVER.variation });
  if (masterwork && masterwork !== "none" && MASTERWORK[masterwork] && !masterworkFigure(masterwork)) {
    out.push({ layer: "masterwork", tier: masterwork, key: MASTERWORK[masterwork] });
  }
  return out;
}

/**
 * Where the silver and masterwork figures on an item came from, one clause
 * per layer it carries, joined as a tooltip: the document and page each was
 * read from, or that it is not imported. Empty when the item carries neither.
 */
export function layerProvenance(item) {
  const tier = masterworkTierOf(item);
  const parts = [];
  const add = (label, fig, key) =>
    parts.push(`${game.i18n.localize(label)}: ${fig ? provenanceTip(fig.source) : notImportedTip(key)}`);
  if (tier && tier !== "none" && MASTERWORK[tier]) add("ACKS-EQUIPMENT.props.masterwork", masterworkFigure(tier), MASTERWORK[tier]);
  if (silveredFlagOf(item) === true) add("ACKS-EQUIPMENT.props.silver", silverFigure(), SILVER.variation);
  return parts.join(" · ");
}

/** Human summary of what the layers are doing, for the sheet. */
export function layerSummary(item) {
  const d = layerDeltas(item);
  const bits = [];
  if (d.bonus) bits.push(`${d.bonus > 0 ? "+" : ""}${d.bonus} hit`);
  if (d.damage) bits.push(`${d.damage > 0 ? "+" : ""}${d.damage} dmg`);
  if (d.ac) bits.push(`${d.ac > 0 ? "+" : ""}${d.ac} AC`);
  if (d.weight6) bits.push(`${d.weight6 > 0 ? "+" : ""}${(d.weight6 / 6).toFixed(2).replace(/\.?0+$/, "")} st`);
  for (const u of unstatedLayers(item)) {
    bits.push(game.i18n.format("ACKS-EQUIPMENT.printed.layerNotImported", { layer: game.i18n.localize(`ACKS-EQUIPMENT.props.${u.layer}`) }));
  }
  const sc = scavengedOf(item);
  if (sc?.breaks) bits.push(game.i18n.localize("ACKS-EQUIPMENT.itemSheet.condition.breakable"));
  if (sc?.cannotSneak) bits.push("cannot sneak");
  if (sc?.initiative) bits.push(`${sc.initiative} init`);
  for (const n of sc?.notes ?? []) bits.push(n);
  // The price effect, so the sheet's figure is explained.
  const base = pristineOf(item);
  if (d.costAdd || d.costMul !== 1 || d.costBaseMul !== 1) {
    const priced = Math.round((Number(base.cost ?? 0) * d.costBaseMul + d.costAdd) * d.costMul * 100) / 100;
    bits.push(`${priced}gp (was ${base.cost ?? 0}gp)`);
  }
  return bits.join(", ");
}

void globalThis.game;
