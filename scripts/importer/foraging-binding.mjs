/**
 * Foraging-table assembly: the raw RR ch. 6 reads → the engine-shaped
 * `foraging` ruledata tables acks-extras declares (its forage, hunt, dog-pack
 * and grazing derivations read them via `expectTables`).
 *
 * Living off the country is four throws with different shapes — firewood is
 * per forager and repeatable, water is one throw per group, food is per
 * forager once a day, hunting costs the whole day — and the recipe reads them
 * as four prose windows. This step turns each into a target, the modifiers
 * that move it, and what a success is worth.
 *
 * The three modifiers are kept APART rather than pre-summed into a target:
 * hard country, settled country whose forage is somebody's crop, and the
 * proficiency are different rules that happen to add, and a reader that was
 * handed one number could not say why. Like every binding here, no value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";
import { parseCount, countFrom } from "./survival-binding.mjs";
import { terrainKeys, keyTerrainMap } from "./terrain-vocab.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const FORAGING_DOC_ID = "foraging";

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Every "<n>+ in <terrains>" clause in a window, as {target, terrains[]}.
 *
 * Split on the TARGETS rather than matched as one pattern: a terrain list is
 * itself comma-separated ("14+ in clear, forest, hills, jungle, mountains, or
 * swamp terrain"), so any pattern that ends a clause at punctuation reads only
 * the first terrain and drops five. Each clause instead runs from its own
 * target to wherever the next one begins.
 */
export function parseTargetClauses(text) {
  const t = String(text ?? "").toLowerCase();
  const heads = [...t.matchAll(/(\d+)\s*\+\s*in\s+/g)];
  const out = [];
  for (const [i, head] of heads.entries()) {
    const from = head.index + head[0].length;
    const to = i + 1 < heads.length ? heads[i + 1].index : t.length;
    // A clause ends at its sentence too, whichever comes first.
    const stop = t.slice(from, to).search(/[.;]/);
    let body = t.slice(from, stop === -1 ? to : from + stop);
    body = body.replace(/\bterrain\b.*$/s, "").replace(/,?\s*(?:\bor\b|\band\b)\s*$/, "");
    const terrains = body
      .split(/,|\bor\b|\band\b/)
      .map((w) => w.trim())
      .filter((w) => w && w !== "other");
    out.push({ target: Number(head[1]), terrains, other: /\bother\b/.test(body) });
  }
  return out;
}

/**
 * A per-terrain target map from those clauses.
 *
 * A clause naming "other terrain" becomes the `any` fallback, which is how the
 * firewood throw is printed: one good case and everywhere else.
 */
export function targetsFromClauses(text, { fallback = null } = {}) {
  const clauses = parseTargetClauses(text);
  if (!clauses.length) return null;
  const out = {};
  for (const c of clauses) {
    if (c.other || !c.terrains.length) out.any = c.target;
    for (const terrain of c.terrains) out[terrain] = c.target;
  }
  // Two clauses with no "other" leave the commoner one as the fallback.
  if (out.any == null && fallback != null) out.any = fallback;
  return Object.keys(out).length ? out : null;
}

/** A bare "throw of 18+" target. */
export function parseThrowTarget(text) {
  const m = /throw\s+of\s+(\d+)\s*\+/i.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** The first signed modifier in a window ("gains a +4 bonus"). */
export function parseSigned(text) {
  const m = /([+-]\s*\d+)/.exec(String(text ?? ""));
  return m ? Number(m[1].replace(/\s+/g, "")) : null;
}

/**
 * A penalty clause list: "-4 penalty … in civilized territory, but gain a +2
 * bonus in outlands territory, and +4 in unsettled" → {civilized:-4, …}.
 *
 * `noun` is "territory" or "terrain", which is the only thing separating the
 * two otherwise identical shapes on this page.
 */
export function parseModifierClauses(text, noun) {
  const t = String(text ?? "").toLowerCase();
  const out = {};
  // The gap is generous because the clause names the throw between the
  // modifier and the country ("-4 penalty to their Hunting proficiency throws
  // in civilized territory"), which is nearly fifty characters on its own.
  const re = new RegExp(`([+-]\\s*\\d+)[^.]{0,70}?\\bin\\s+([a-z\\s,]+?)\\s+${noun}`, "g");
  for (const m of t.matchAll(re)) {
    const value = Number(m[1].replace(/\s+/g, ""));
    for (const word of m[2].split(/,|\bor\b|\band\b/)) {
      const key = word.trim();
      if (key) out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * A list of kinds or terrains named at the head of a clause.
 *
 * BOTH the printed word and its singular are emitted when they differ. The
 * page is not consistent with itself — the same country is "barrens" in one
 * sentence and "deserts" in another where the terrain key is "desert" — and
 * the reader tests membership, so an extra alias only ever helps. Stripping
 * the plural instead would turn "barrens", a terrain key in its own right,
 * into one that matches nothing.
 */
export function parseKindList(text, re) {
  const m = re.exec(String(text ?? "").trim());
  if (!m) return null;
  const out = [];
  const body = m[1]
    .toLowerCase()
    .replace(/^[^a-z]+/, "")            // a window can open mid-sentence
    .replace(/^animals\s+in\s+/, "");
  for (const word of body.split(/,|\bor\b|\band\b/)) {
    const key = word.trim();
    if (!key) continue;
    out.push(key);
    if (key.endsWith("s")) out.push(key.slice(0, -1));
  }
  return out.length ? [...new Set(out)] : null;
}

/** "gathers 1/2 stone of food, enough for three man-sized creatures". */
export function parseYield(text) {
  const t = String(text ?? "").toLowerCase();
  const m = /(\d+(?:\s*\/\s*\d+)?|\d*\.\d+)\s*(st|stone)\b/.exec(t);
  if (!m) return null;
  const raw = m[1].replace(/\s+/g, "");
  const frac = /^(\d+)\/(\d+)$/.exec(raw);
  const amount = frac ? Number(frac[1]) / Number(frac[2]) : Number(raw);
  if (!Number.isFinite(amount)) return null;
  const out = { amount, unit: "stone" };
  const feeds = countFrom(t, /enough\s+(?:for|to\s+feed)\s+(\S+)\s+man-?sized/);
  if (feeds != null) out.feeds = feeds;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented prose. Each half assembles independently, so a window that missed
 * costs only what it carried.
 */
export function assembleForagingTables(raw = {}) {
  const out = {};
  const targets = {};
  const yields = {};
  const forageTerrain = {};
  const forageTerritory = {};

  const wood = raw.firewoodProse ?? {};
  const woodTargets = targetsFromClauses(wood.targets);
  if (woodTargets) targets.firewood = keyTerrainMap(woodTargets);
  const woodYield = parseYield(wood.targets ?? wood.yield);
  if (woodYield) yields.firewood = woodYield;

  const water = raw.waterProse ?? {};
  const waterTargets = targetsFromClauses(water.targets);
  if (waterTargets) targets.water = keyTerrainMap(waterTargets);
  // Water's yield is counted in DAYS, not stone: the throw finds a source, and
  // what it is worth is how long it lasts the people who found it.
  const waterDays = countFrom(String(water.yield ?? ""), /meet\s+(\S+)\s+days?/i);
  if (waterDays != null) yields.water = { amount: waterDays, unit: "days" };
  // The size one throw covers. Its window is anchored on "Parties larger
  // than", so the figure is the window's own first token — the phrases that
  // introduce it are behind the anchor, not inside the text.
  const group = countFrom(String(water.group ?? ""), /^\s*(\S+)\s+man-?sized/i)
    ?? countFrom(String(water.group ?? ""), /(?:up\s+to|larger\s+than)\s+(\S+)\s+man-?sized/i);
  if (group != null) out.partyGroupSize = group;

  const food = raw.foodProse ?? {};
  // The window opens ON the target, so the bare figure is its first token; the
  // reader is given the phrase it expects rather than a second pattern.
  const foodTarget = parseThrowTarget(`throw of ${food.target ?? ""}`);
  if (foodTarget != null) targets.food = { any: foodTarget };
  const foodYield = parseYield(food.target ?? food.yield);
  if (foodYield) yields.food = foodYield;
  // Both modifier sentences are the TAIL of this paragraph, past the yield.
  const foodTail = String(food.modifiers ?? food.yield ?? "");
  const foodTerrain = parseModifierClauses(foodTail, "terrain");
  if (foodTerrain) forageTerrain.food = keyTerrainMap(foodTerrain);
  const foodTerritory = parseModifierClauses(foodTail, "territory");
  if (foodTerritory) forageTerritory.food = foodTerritory;

  // The proficiency is worth the same on every forage the page describes, so
  // it is one figure rather than one per kind.
  const survival = parseSigned(wood.survival ?? food.yield ?? water.yield ?? "");
  if (survival != null) out.survivalBonus = survival;

  // Hunting is two paragraphs: its own throw and yield, then how settled
  // country moves it.
  const hunt = raw.huntProse ?? {};
  const hunting = raw.huntingProse ?? {};
  const huntTarget = parseThrowTarget(hunt.throw ?? "");
  if (huntTarget != null) out.huntTarget = huntTarget;
  const huntTerritory = parseModifierClauses(hunting.territory ?? "", "territory");
  if (huntTerritory) out.huntTerritory = huntTerritory;
  const huntYield = parseYield(hunt.throw ?? "");
  if (huntYield) yields.hunt = huntYield;

  const dogs = raw.dogsProse ?? {};
  const dogTarget = parseThrowTarget(dogs.pack ?? "");
  if (dogTarget != null) out.dogTarget = dogTarget;
  const per = /([+-]\s*\d+)\s*bonus\s+to\s+the\s+throw\s+per\s+dog/i.exec(String(dogs.pack ?? ""));
  if (per) out.dogHelpPerDog = Math.abs(Number(per[1].replace(/\s+/g, "")));
  const cap = /maximum\s+bonus\s+of\s*([+-]?\s*\d+)/i.exec(String(dogs.pack ?? ""));
  if (cap) out.dogHelpCap = Math.abs(Number(cap[1].replace(/\s+/g, "")));

  // Grazing: which kinds feed themselves on ancillary hours alone, and which
  // country feeds nothing that is not already living in it.
  const grazing = raw.grazingRules ?? {};
  const ancillary = parseKindList(grazing.ancillary, /^(.+?)\s+can\s+graze\s+for\s+their\s+full/i);
  if (ancillary) out.efficientGrazers = ancillary;
  const barren = parseKindList(grazing.barren, /^(.+?)\s+can\s+only\s+graze/i);
  if (barren) out.barrenTerrains = terrainKeys(barren);

  if (Object.keys(targets).length) out.targets = targets;
  if (Object.keys(yields).length) out.yields = yields;
  if (Object.keys(forageTerrain).length) out.forageTerrain = forageTerrain;
  if (Object.keys(forageTerritory).length) out.forageTerritory = forageTerritory;
  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applyForagingImport() {
  const svc = services.get("ruledata-import");
  if (!svc || !hasDoc(FORAGING_DOC_ID)) return { assembled: [] };
  const doc = getDoc(FORAGING_DOC_ID);
  const engine = assembleForagingTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    { id: FORAGING_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engine } },
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}

/** Re-exported so sibling binders share one count reader. */
export { parseCount };
