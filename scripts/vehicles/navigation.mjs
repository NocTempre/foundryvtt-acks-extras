/**
 * Staying on course, and what happens when you do not (RR ch. 7).
 *
 * A voyage asks two separate questions each day, and they have different
 * owners: the NAVIGATOR keeps the vessel on course, and the CAPTAIN keeps her
 * off the rocks. Conflating them loses the fact that a ship can be perfectly
 * sure where she is and still tear her bottom out on a reef nobody charted.
 *
 * STRUCTURE ships here; the printed numbers do not. What ships: which waters
 * exist, which modifiers exist and when each applies (one navigational art
 * helps, both together help more; slowing for a hazard helps the throw AND
 * halves the damage — the rule rewarding caution twice for one decision; a
 * shallow-draft hull helps over sandbar and shoal), which hazards exist and
 * each one's SHAPE (kelp holds her, ground strands her, rock simply tears).
 * Every target, bonus, die and rate reads from the `voyages` registered
 * document, imported from the reader's own book; absent, a throw carries a
 * `tablesMissing` part instead of a number, never a guess.
 */

import { readTable, VOYAGES_DOC } from "./vehicle-speed.mjs";

/** The waters a course can be lost in — the structural key list. */
export const WATERS = Object.freeze({
  lakeOrRiver: { label: "ACKS-VEHICLES.water.lakeOrRiver" },
  coast: { label: "ACKS-VEHICLES.water.coast" },
  openSea: { label: "ACKS-VEHICLES.water.openSea" },
});

/**
 * The Navigation throw a vessel makes at the start of each day OR NIGHT of
 * travel — sailing through the dark is a second chance to get lost, not a
 * continuation of the first.
 *
 * @param {object} o
 * @param {string} [o.terrain] a key of WATERS
 * @param {boolean} [o.pathfinding] someone aboard has the Pathfinding power
 * @param {boolean} [o.navigation] someone aboard has the Navigation proficiency
 * @returns {{target, bonus, effective, parts: object[], missing: boolean}}
 */
export function navigationThrow({ terrain = "openSea", pathfinding = false, navigation = false } = {}) {
  const nav = readTable(VOYAGES_DOC, "navigation");
  const water = WATERS[terrain] ? terrain : "openSea";
  const target = Number(nav?.targets?.[water]);
  const parts = [];
  let missing = false;
  if (Number.isFinite(target)) {
    parts.push({ key: `terrain.${water}`, value: target });
  } else {
    missing = true;
  }
  // Both arts together are worth more than either alone, and more than the
  // two of them added — the rule prices the pair outright.
  const both = pathfinding && navigation;
  const one = pathfinding || navigation;
  const bonus = both ? Number(nav?.bothArts) : one ? Number(nav?.oneArt) : 0;
  const bonusKnown = Number.isFinite(bonus);
  if (one && bonusKnown && bonus) parts.push({ key: both ? "bothArts" : "oneArt", value: bonus });
  if (one && !bonusKnown) missing = true;
  if (missing) parts.push({ key: "tablesMissing", missing: true, note: true });
  return {
    target: Number.isFinite(target) ? target : null,
    bonus: bonusKnown ? bonus : 0,
    effective: Number.isFinite(target) ? target - (bonusKnown ? bonus : 0) : null,
    parts,
    missing,
  };
}

/**
 * The captain's Seafaring throw on entering a hex that holds a hazard.
 *
 * Slowing down is the universally available answer — half speed or less
 * helps the throw AND halves the damage if she strikes anyway.
 *
 * @param {object} o
 * @param {boolean} [o.masterMariner] Seafaring taken three times
 * @param {boolean} [o.halfSpeed] making half her speed or less
 * @param {boolean} [o.shallowDraft] a galley or longship, over sandbar or shoal
 * @returns {{target, bonus, effective, parts: object[], missing: boolean}}
 */
export function hazardThrow({ masterMariner = false, halfSpeed = false, shallowDraft = false } = {}) {
  const table = readTable(VOYAGES_DOC, "hazardThrow");
  const target = Number(table?.[masterMariner ? "masterMariner" : "captain"]);
  const parts = [];
  let missing = !Number.isFinite(target);
  if (!missing) parts.push({ key: masterMariner ? "masterMariner" : "captain", value: target });
  let bonus = 0;
  const add = (on, key) => {
    if (!on) return;
    const v = Number(table?.[key]);
    if (Number.isFinite(v)) {
      bonus += v;
      parts.push({ key, value: v });
    } else {
      missing = true;
    }
  };
  add(halfSpeed, "halfSpeed");
  add(shallowDraft, "shallowDraft");
  if (missing) parts.push({ key: "tablesMissing", missing: true, note: true });
  return {
    target: Number.isFinite(target) ? target : null,
    bonus,
    effective: Number.isFinite(target) ? target - bonus : null,
    parts,
    missing,
  };
}

/**
 * What is in the water — the STRUCTURAL half: which hazards exist and each
 * one's shape. Kelp holds her without harm until she is cut out; rock, reef
 * or wreck tears and lets her sail on; sandbar or shoal both harms and
 * strands, and a stranded crew can lighten her or wait for the tide. What
 * each is WORTH — the dice, the hours, the rates — is `hazardSpec`'s read.
 */
export const HAZARD_KINDS = Object.freeze({
  kelpForest: { label: "ACKS-VEHICLES.hazard.kelpForest", immobile: true, harmless: true },
  rockReefWreck: { label: "ACKS-VEHICLES.hazard.rockReefWreck", immobile: false, damageType: "piercing" },
  sandbarShoal: { label: "ACKS-VEHICLES.hazard.sandbarShoal", immobile: true, damageType: "bludgeoning", lightenable: true },
});

/** One hazard's structure merged with its imported figures (null = absent). */
export function hazardSpec(kind) {
  const structure = HAZARD_KINDS[kind];
  if (!structure) return null;
  const row = readTable(VOYAGES_DOC, "hazards")?.[kind] ?? {};
  return {
    kind,
    ...structure,
    damage: row.damage ?? null,
    freeFormula: row.freeFormula ?? null,
    perTons: row.perTons ?? null,
    escapePctPerStone: row.escapePctPerStone ?? null,
    perStone: row.perStone ?? null,
    unloadStonePerTurn: row.unloadStonePerTurn ?? null,
    missing: !Object.keys(row).length,
  };
}

/** Hours to cut a vessel out of kelp: the rolled hours plus her bulk's own. */
export function kelpHours(rolled, tons, spec = hazardSpec("kelpForest")) {
  const per = Number(spec?.perTons);
  const bulk = Number.isFinite(per) && per > 0 ? Math.floor((Number(tons) || 0) / per) : 0;
  return (Number(rolled) || 0) + bulk;
}

/**
 * The chance a grounded vessel floats free after throwing cargo over the
 * side. Cumulative in the stone jettisoned, and capped at certainty. Null
 * when the rates are not imported — a chance of nothing is not zero.
 */
export function lightenChance(stoneJettisoned, spec = hazardSpec("sandbarShoal")) {
  const pct = Number(spec?.escapePctPerStone);
  const per = Number(spec?.perStone);
  if (!Number.isFinite(pct) || !Number.isFinite(per) || per <= 0) return null;
  return Math.min(1, Math.max(0, Number(stoneJettisoned) || 0) * (pct / per));
}
