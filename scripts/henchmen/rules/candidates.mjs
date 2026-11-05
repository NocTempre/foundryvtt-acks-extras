/**
 * Candidate identity rolls. Pure module — dice arrive via an injected async
 * roller. A candidate's class and level are fixed when the monthly pool is
 * rolled, with no per-candidate reroll surface; attributes (3d6 ×6) are
 * rolled once, at hire time, and recorded. See docs/henchmen/DECISIONS.md,
 * "Candidate class and level are fixed at the market roll, not at hire".
 */
import { bracketRow, getTable, optTable } from "./tables.mjs";
import { classBlocked } from "./availability.mjs";

/**
 * How many draws a class roll makes before a market's blocked classes give
 * way to the "special" row. Rejection keeps the imported ranges as printed:
 * each allowed class keeps its share of what is left.
 */
export const BLOCKED_CLASS_DRAWS = 50;

/**
 * Fallback class roll from the core-six class percentages (people doc) when
 * the full JJ double-d100 distribution has not been imported. This is the
 * "core classes, specials deferred" mode: only fighter/crusader/thief/mage/
 * explorer/venturer come up; the expansion/demihuman classes (which are GM
 * endpoints anyway) simply do not appear until the distribution is imported.
 */
async function rollCoreClass(rollDice, level = 1) {
  const pct = optTable("people", "classPercentages");
  if (!pct?.rows?.length) return { classKey: "fighter", bucket: "fighter", rolls: [0, 0] };
  const row = bracketRow(pct.rows, level, "minLevel", "maxLevel") ?? pct.rows[0];
  const entries = Object.entries(row.weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const roll = await rollDice(`1d${total}`);
  let running = 0;
  let classKey = entries[0][0];
  for (const [k, w] of entries) {
    running += w;
    if (roll <= running) { classKey = k; break; }
  }
  return { classKey, bucket: classKey, rolls: [roll, 0] };
}

/**
 * Random class via the JJ GM-screen double-d100 distribution (RAW cells,
 * bucket-first): the first d100 selects the BUCKET, the second resolves the
 * class on that bucket's ladder. A location rarity variant may override the
 * buckets (JJ 118: rarity varies by settlement). "special" = Judge picks
 * from the expansion books. Falls back to the core-six percentages when the
 * distribution grid is not imported.
 *
 * A class the market never offers (`blocked`) is drawn again, both dice; after
 * `BLOCKED_CLASS_DRAWS` draws that all land on one, the class is "special" and
 * `blocked` is true on the result.
 * @param {(f: string) => Promise<number>} rollDice
 * @param {string} [variant="default"] - classRarityTables variant id
 * @param {number} [level=1] - used only by the core-class fallback
 * @param {{blocked?: string[]}} [opts] the market's `blockedClasses`
 * @returns {Promise<{classKey: string, bucket: string, rolls: [number, number], blocked?: true}>}
 */
export async function rollClassFromDistribution(rollDice, variant = "default", level = 1, { blocked = [] } = {}) {
  let drawn = null;
  for (let n = 0; n < BLOCKED_CLASS_DRAWS; n++) {
    drawn = await drawClass(rollDice, variant, level);
    if (!classBlocked(blocked, drawn.classKey)) return drawn;
  }
  return { ...drawn, classKey: "special", blocked: true };
}

/** One double-d100 draw, or the core-six fallback when the grid is not imported. */
async function drawClass(rollDice, variant, level) {
  const distribution = optTable("rarity", "classDistribution");
  if (!distribution) return rollCoreClass(rollDice, level);
  const variants = getTable("rarity", "classRarityTables").variants;
  const buckets = variants[variant]?.buckets ?? distribution.buckets;
  const bucketRoll = await rollDice("1d100");
  const rowRoll = await rollDice("1d100");
  const bucket = bracketRow(buckets, bucketRoll) ?? buckets[buckets.length - 1];
  const row = bracketRow(bucket.rows, rowRoll);
  return { classKey: row?.class ?? "special", bucket: bucket.id, rolls: [bucketRoll, rowRoll] };
}

/**
 * 0th-level class trajectory: the BUCKET rolls from the JJ 247 level-0
 * archetype weights, then the class resolves on the same bucket ladder.
 * @returns {Promise<{classKey: string, bucket: string, rolls: [number, number]}>}
 */
export async function rollTrajectoryFromDistribution(rollDice, variant = "default") {
  const distribution = optTable("rarity", "classDistribution");
  if (!distribution) return rollCoreClass(rollDice, 0);
  const variants = getTable("rarity", "classRarityTables").variants;
  const buckets = variants[variant]?.buckets ?? distribution.buckets;
  const weights = distribution.trajectoryBucketWeights?.weights;
  if (!weights) return rollCoreClass(rollDice, 0); // JJ 247 weights not imported yet
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const bucketRoll = await rollDice(`1d${total}`);
  let running = 0;
  let bucketId = Object.keys(weights)[0];
  for (const [id, w] of Object.entries(weights)) {
    running += w;
    if (bucketRoll <= running) {
      bucketId = id;
      break;
    }
  }
  const bucket = buckets.find((b) => b.id === bucketId) ?? buckets[0];
  const rowRoll = await rollDice("1d100");
  const row = bracketRow(bucket.rows, rowRoll);
  return { classKey: row?.class ?? "special", bucket: bucket.id, rolls: [bucketRoll, rowRoll] };
}

/**
 * Random Henchman Level (JJ 118): 1d20, −2 in a Class VI market.
 * @returns {Promise<{level: number, die: number, penalty: number}>}
 */
export async function rollRandomLevel(rollDice, marketClass) {
  const table = getTable("rarity", "randomHenchmanLevel");
  // Class VI penalty comes from the imported JJ 119 prose values (sqm doc);
  // absent that import there is no penalty — never a hardcoded stand-in.
  const imported = optTable("rarity", "specificQualificationMods")?.gpClassVIPenalty;
  const penalty = marketClass === 6 ? (table.classVIPenalty ?? imported ?? 0) : 0;
  const die = await rollDice("1d20");
  const total = die + penalty;
  const row = bracketRow(table.rows, total) ?? table.rows[0];
  return { level: row.level, die, penalty };
}

/**
 * A general-proficiency search's henchman level (JJ ch. 3, "Henchmen Rarity
 * by General Proficiency"): the imported level die, whose imported zero band
 * makes a 0th-level henchman and whose other faces roll the Random Henchman
 * Level table. With the die or the band not imported, every such henchman
 * rolls that table.
 */
export async function rollProficiencyLevel(rollDice, marketClass) {
  const sqm = optTable("rarity", "specificQualificationMods");
  const band = sqm?.gpZeroBand;
  if (!sqm?.gpLevelDie || !Array.isArray(band) || band.length !== 2) return rollRandomLevel(rollDice, marketClass);
  const die = await rollDice(sqm.gpLevelDie);
  if (die >= band[0] && die <= band[1]) return { level: 0, die, penalty: 0 };
  return rollRandomLevel(rollDice, marketClass);
}

/**
 * Attributes, 3d6 in order (RR 168: henchmen are rolled up like PCs).
 * Rolled at HIRE only.
 * @returns {Promise<{str:number,int:number,wil:number,dex:number,con:number,cha:number}>}
 */
export async function rollAttributes(rollDice) {
  const attributes = {};
  for (const key of ["str", "int", "wil", "dex", "con", "cha"]) {
    attributes[key] = await rollDice("3d6");
  }
  return attributes;
}
