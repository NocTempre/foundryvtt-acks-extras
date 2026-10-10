/**
 * The wilderness encounter chain: what a journey's throw finds, how far away
 * it starts, and whether the party can slip away.
 *
 * STRUCTURE ships here; the printed content does not. What ships: the
 * chain's ORDER (territory throw → civilized draw, or rarity throw → the
 * terrain-and-rarity monster draw, or a terrain-encounter kind → its d12 →
 * the sub-tables and terrain lookups its result leads to, or back into the
 * chain: a Double, a creature, a share-split between two kinds, a further
 * roll — all under a per-draw roll budget),
 * the column-selection rules (a road or navigable river uses the territory's
 * "+ Road" column; night in settled country shifts one column right; a
 * Column Shift result shifts right and re-rolls), the resting/known-route
 * downgrade of terrain encounters, the distance procedure (terrain dice
 * capped by visibility; each side's own terrain when they differ, the longer
 * roll detecting; flyers may open at altitude), the detection hand-off to
 * core's own Surprise Matrix (which owns the matrix, the rolls and the
 * evade permission — nothing here re-derives them), the evasion throw's
 * modifier VOCABULARY, and the aftermath (a flight leg, a clock direction,
 * a navigation throw). What imports (the `encounters` registered document,
 * from the reader's own book): every d20/d100 band, every creature name,
 * every distance die, every visibility figure, every evasion target and
 * modifier size, the terrain-encounter lists, and every sub-table and lookup
 * row a terrain result leads to. A missing table resolves to a "draw from
 * your book" line, never a guess.
 *
 * Everything here is arithmetic over plain objects plus registry reads —
 * Node-evaluable, no documents, no Foundry.
 */

import { bracketRow } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";
import { readTable } from "../vehicles/vehicle-speed.mjs";
import { TERRITORY_KEYS } from "./travel.mjs";
import { ENCOUNTER_TERRAINS, MONSTER_TABLE_KEYS, encounterTerrainFor } from "./encounter-terrains.mjs";

/** The registered ruledata document the chain reads. */
export const ENCOUNTERS_DOC = "encounters";

/**
 * The territory table's five columns, left to right. The MAPPING from a
 * party's territory and road to a column is the rule's own: each column
 * serves a roaded territory and the next-wilder unroaded one.
 */
export const ENCOUNTER_COLUMNS = Object.freeze([
  "civilizedRoad",
  "civilizedOrBorderlandsRoad",
  "borderlandsOrOutlandsRoad",
  "outlandsOrUnsettledRoad",
  "unsettled",
]);

/** What a territory throw can land on. The terrain kinds share their flag. */
export const ENCOUNTER_OUTCOMES = Object.freeze({
  columnShift: { label: "ACKS-FORMATION.travel.enc.outcome.columnShift" },
  none: { label: "ACKS-FORMATION.travel.enc.outcome.none" },
  civilized: { label: "ACKS-FORMATION.travel.enc.outcome.civilized" },
  monster: { label: "ACKS-FORMATION.travel.enc.outcome.monster" },
  dangerousTerrain: { label: "ACKS-FORMATION.travel.enc.outcome.dangerousTerrain", terrainKind: "dangerous" },
  valuableTerrain: { label: "ACKS-FORMATION.travel.enc.outcome.valuableTerrain", terrainKind: "valuable" },
  uniqueTerrain: { label: "ACKS-FORMATION.travel.enc.outcome.uniqueTerrain", terrainKind: "unique" },
});

/** The four monster rarities, common to every terrain sub-table. */
export const RARITIES = Object.freeze(["common", "uncommon", "rare", "veryRare"]);

/**
 * The terrain register and its reads live in `encounter-terrains.mjs`, a
 * leaf the battlemap's brush reads too; the chain's readers take them here.
 */
export { ENCOUNTER_TERRAINS, MONSTER_TABLE_KEYS, encounterTerrainFor };

/** The registered table ids the chain reads (expectTables declares these). */
export const ENCOUNTER_TABLE_IDS = Object.freeze([
  "territory",
  "rarity",
  "civilized",
  "distance",
  "visibility",
  "evasion",
  "evasionModifiers",
  "terrainEncounters",
  "terrainSubTables",
  "treasureByTerrain",
  "ruinModifier",
  "lesserTerrainShare",
  "lairsPerHex",
  "lairSubstitution",
  "settledLairShare",
  ...MONSTER_TABLE_KEYS.map((t) => `monsters.${t}`),
]);

/**
 * What a terrain result leads to, keyed by the result's name folded to its
 * letters: the sub-tables it rolls on, in order, and the terrain lookups it
 * reads. A key is the result's common noun; the printed list, its order and
 * every row it leads to arrive with the import. `chain` names a table rolled
 * next when a roll lands on its table's last band — a power that climbs. A
 * result not listed here resolves from the book.
 *
 * Hand-offs back into the chain: `double` rolls the same list twice more
 * (`DOUBLE_ON_DOUBLE` settles a Double among the pair); `monster` draws a
 * creature on the CALLER's territory; `either` names two kinds and picks one
 * by a d100 against the imported `lesserTerrainShare` percent (a roll at or
 * under it takes the first, JJ 67); `draw` rolls one further result on the
 * named kind's list.
 */
export const TERRAIN_FOLLOW_UPS = Object.freeze({
  cache: { lookups: ["treasure"] },
  ore: { rolls: ["ore"] },
  ruin: { rolls: ["structure"], lookups: ["ruin"] },
  safeHaven: { rolls: ["safeHaven"] },
  usefulHerbs: { rolls: ["usefulHerbs"] },
  challenge: { rolls: ["challenge"] },
  hazard: { rolls: ["hazard"] },
  poison: { rolls: ["poison"] },
  complexMap: { rolls: ["complexMap"] },
  curse: { rolls: ["curse"] },
  placeOfPower: { rolls: ["placeOfPower", "power"], chain: { power: "majorPower" } },
  double: { double: true },
  hiddenSettlement: { monster: true },
  monsterCarcass: { monster: true },
  monstrousShadow: { monster: true, lookups: ["treasure"] },
  lesserTerrain: { either: ["valuable", "dangerous"] },
  awfulDespoiling: { draw: "valuable" },
});

/**
 * What a Double does when a roll inside its pair is itself a Double, by the
 * kind whose list was rolled: a kind name discards the pair and rolls once on
 * that kind's list instead; "reroll" replaces the inner Double on the same
 * list.
 */
export const DOUBLE_ON_DOUBLE = Object.freeze({ valuable: "unique", dangerous: "unique", unique: "reroll" });

/**
 * List rolls one top-level terrain draw may make across all its hand-offs;
 * a node that would roll past it is marked `exhausted` and the Judge
 * resolves it from the book.
 */
export const DRAW_BUDGET = 8;

/** The terrain lookups a result can read: the table each lives in. */
export const TERRAIN_LOOKUPS = Object.freeze({ treasure: "treasureByTerrain", ruin: "ruinModifier" });

const foldName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const FOLLOW_UPS = new Map(Object.entries(TERRAIN_FOLLOW_UPS).map(([k, v]) => [foldName(k), v]));

/* -------------------------------------------------------------------- */
/*  Dice                                                                */
/* -------------------------------------------------------------------- */

/** One face of a die of `faces` sides, 1 to `faces`, from a [0, 1) source. */
export const die = (faces, rng) => 1 + Math.floor(rng() * faces);
export const d20 = (rng) => die(20, rng);
export const d100 = (rng) => die(100, rng);
export const d12 = (rng) => die(12, rng);

/**
 * "4d6", "2d4+1" or "1d6-3" rolled, a modifier added and the total floored at
 * zero; junk → null. Multipliers ride separately in the table.
 */
export function rollDice(expr, rng) {
  const m = /^(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?$/i.exec(String(expr ?? "").trim());
  if (!m) return null;
  let total = 0;
  for (let i = 0; i < Number(m[1]); i++) total += die(Number(m[2]), rng);
  if (m[3]) total += (m[3] === "-" ? -1 : 1) * Number(m[4]);
  return Math.max(0, total);
}

/* -------------------------------------------------------------------- */
/*  The chain                                                           */
/* -------------------------------------------------------------------- */

/**
 * Which column of the territory table this party rolls on: the territory's
 * own column, its "+ Road" neighbour when following a road or navigable
 * river, and one column right at night in settled country (unsettled
 * already stands at the wall). Shifts clamp at the last column.
 */
export function encounterColumnFor({ territory = "borderlands", road = false, night = false } = {}) {
  const t = TERRITORY_KEYS.includes(territory) ? territory : "borderlands";
  let index = TERRITORY_KEYS.indexOf(t) + 1; // unroaded: one right of its own road column
  if (road) index -= 1;
  if (night && t !== "unsettled") index += 1;
  return ENCOUNTER_COLUMNS[Math.min(Math.max(index, 0), ENCOUNTER_COLUMNS.length - 1)];
}

/**
 * The territory throw: 1d20 on the party's column, following Column Shift
 * results one column right (bounded by the table's edge — the wall shifts
 * no further). Returns every roll made, so the card can show its work.
 */
export function territoryThrow({ territory, road = false, night = false, rng = Math.random } = {}) {
  const table = readTable(ENCOUNTERS_DOC, "territory");
  if (!table) return { ok: false, missing: "territory" };
  let column = encounterColumnFor({ territory, road, night });
  const rolls = [];
  for (let guard = 0; guard < ENCOUNTER_COLUMNS.length; guard++) {
    const roll = d20(rng);
    const outcome = bracketRow(table[column] ?? [], roll)?.outcome ?? "none";
    rolls.push({ column, roll, outcome });
    if (outcome !== "columnShift") return { ok: true, column, roll, outcome, rolls };
    const next = ENCOUNTER_COLUMNS.indexOf(column) + 1;
    if (next >= ENCOUNTER_COLUMNS.length) return { ok: true, column, roll, outcome: "none", rolls };
    column = ENCOUNTER_COLUMNS[next];
  }
  return { ok: true, column, roll: rolls.at(-1).roll, outcome: "none", rolls };
}

/** The rarity throw: 1d20 against the territory's rarity bands. */
export function rarityThrow({ territory = "borderlands", rng = Math.random } = {}) {
  const table = readTable(ENCOUNTERS_DOC, "rarity");
  const bands = table?.[territory];
  if (!bands) return { ok: false, missing: "rarity" };
  const roll = d20(rng);
  const rarity = bracketRow(bands, roll)?.rarity ?? null;
  return rarity ? { ok: true, roll, rarity } : { ok: true, roll, rarity: RARITIES[0] };
}

/** The terrain-and-rarity monster draw: 1d100 → a creature's printed name. */
export function monsterDraw({ terrain, rarity, rng = Math.random } = {}) {
  const tableKey = ENCOUNTER_TERRAINS[terrain]?.monsters ?? terrain;
  const bands = readTable(ENCOUNTERS_DOC, `monsters.${tableKey}`)?.[rarity];
  if (!bands) return { ok: false, missing: `monsters.${tableKey}` };
  const roll = d100(rng);
  const name = bracketRow(bands, roll)?.name ?? null;
  return { ok: !!name, ...(name ? { roll, name } : { missing: `monsters.${tableKey}` }) };
}

/** The civilized draw: 1d100 on the terrain's column group. */
export function civilizedDraw({ terrain, rng = Math.random } = {}) {
  const group = ENCOUNTER_TERRAINS[terrain]?.civilized;
  const bands = readTable(ENCOUNTERS_DOC, "civilized")?.[group];
  if (!bands) return { ok: false, missing: "civilized" };
  const roll = d100(rng);
  const name = bracketRow(bands, roll)?.name ?? null;
  return { ok: !!name, ...(name ? { roll, name, group } : { missing: "civilized" }) };
}

/**
 * A terrain-encounter draw: 1d12 on the kind's list, then whatever the
 * result leads to (`terrainFollowUps`) for the party's terrain. Resting or
 * retracing a known route downgrades the whole outcome to none BEFORE this
 * is rolled — that judgment is the caller's (`runEncounter` applies it).
 *
 * A result that hands back into the chain recurses: the node carries `then`
 * (the nested draws, each tagged with the `via` that produced it), plus
 * `creature` (`{ rarity, rarityRoll, roll, name }`, or `{ missing }`) for a
 * creature hand-off on the CALLER's `territory`, `either` (`{ roll, share,
 * kind }`) for a share-split, and `discarded` / `rerolled` (the rolls a
 * Double set aside, each flagged `setAside` with its array's name). Every
 * roll on a list spends `budget`; a node past it is `{ ok: false, exhausted:
 * true }` and rolls nothing. A Double's pair is rolled before either
 * member's follow-ups.
 */
export function terrainEncounterDraw({ kind, terrain = "", territory, rng = Math.random, budget = DRAW_BUDGET } = {}) {
  const left = Number.isFinite(Number(budget)) ? Number(budget) : DRAW_BUDGET;
  return drawNode(kind, { terrain, territory, rng, left });
}

/** One list roll plus its resolution; `ctx` carries the shared budget. */
function drawNode(kind, ctx) {
  return resolveRoll(rollList(kind, ctx), ctx);
}

/** 1d12 on a kind's list, spending one unit of the budget; no follow-ups. */
function rollList(kind, ctx) {
  const list = readTable(ENCOUNTERS_DOC, "terrainEncounters")?.[kind];
  if (!Array.isArray(list) || !list.length) return { ok: false, kind, missing: "terrainEncounters" };
  if (ctx.left <= 0) return { ok: false, kind, exhausted: true };
  ctx.left -= 1;
  const roll = d12(ctx.rng);
  const name = list[roll - 1] ?? null;
  if (!name) return { ok: false, kind, missing: "terrainEncounters" };
  return { ok: true, kind, roll, name };
}

const isDouble = (node) => !!(node?.ok && FOLLOW_UPS.get(foldName(node.name))?.double);

/** A rolled result expanded with its follow-ups and any hand-off it names. */
function resolveRoll(raw, ctx) {
  if (!raw.ok) return raw;
  const spec = FOLLOW_UPS.get(foldName(raw.name));
  const node = { ...raw, ...terrainFollowUps({ name: raw.name, terrain: ctx.terrain, rng: ctx.rng }) };
  if (spec?.double) Object.assign(node, resolveDouble(raw.kind, ctx));
  if (spec?.monster) node.creature = creatureHandOff(ctx);
  if (spec?.either) Object.assign(node, resolveEither(spec.either, ctx));
  if (spec?.draw) node.then = [{ ...drawNode(spec.draw, ctx), via: "despoiled" }];
  return node;
}

/** A Double's pair, with `DOUBLE_ON_DOUBLE` applied when a Double is in it. */
function resolveDouble(kind, ctx) {
  const rule = DOUBLE_ON_DOUBLE[kind];
  const pair = [rollList(kind, ctx), rollList(kind, ctx)];
  if (rule === "reroll") {
    const rerolled = [];
    for (let i = 0; i < pair.length; i++) {
      while (isDouble(pair[i])) {
        rerolled.push({ ...pair[i], setAside: "rerolled" });
        pair[i] = rollList(kind, ctx);
      }
    }
    return { then: pair.map((n) => ({ ...resolveRoll(n, ctx), via: "double" })), ...(rerolled.length ? { rerolled } : {}) };
  }
  if (rule && pair.some(isDouble)) {
    return {
      discarded: pair.filter((n) => n.ok).map((n) => ({ ...n, setAside: "discarded" })),
      then: [{ ...drawNode(rule, ctx), via: "double" }],
    };
  }
  return { then: pair.map((n) => ({ ...resolveRoll(n, ctx), via: "double" })) };
}

/** A creature drawn on the caller's territory: rarity throw, then the terrain's sub-table. */
function creatureHandOff(ctx) {
  const rarity = rarityThrow({ territory: ctx.territory, rng: ctx.rng });
  if (!rarity.ok) return { missing: rarity.missing };
  const draw = monsterDraw({ terrain: ctx.terrain, rarity: rarity.rarity, rng: ctx.rng });
  return draw.ok
    ? { rarity: rarity.rarity, rarityRoll: rarity.roll, roll: draw.roll, name: draw.name }
    : { missing: draw.missing };
}

/**
 * A d100 against the imported share percent picks one of two kinds (a roll
 * at or under the share takes the first) and rolls that kind's list once.
 * An unimported share leaves a missing-table node in `then`.
 */
function resolveEither([first, second], ctx) {
  const share = readTable(ENCOUNTERS_DOC, "lesserTerrainShare");
  const pct = share == null || share === "" ? NaN : Number(share);
  if (!Number.isFinite(pct)) return { then: [{ ok: false, missing: "lesserTerrainShare" }] };
  const roll = d100(ctx.rng);
  const kind = roll <= pct ? first : second;
  return { either: { roll, share: pct, kind }, then: [drawNode(kind, ctx)] };
}

/**
 * A terrain draw as one list in resolution order, `[{ depth, node }]`: the
 * root at depth 0, then each node's set-aside rolls (discarded, rerolled),
 * then its nested draws, each followed by its own children. Takes an
 * old-shaped draw (no `then`) as a single node; nothing yields an empty list.
 */
export function flattenTerrainDraw(draw) {
  const out = [];
  const walk = (node, depth) => {
    out.push({ depth, node });
    for (const child of [...(node.discarded ?? []), ...(node.rerolled ?? []), ...(node.then ?? [])]) walk(child, depth + 1);
  };
  if (draw) walk(draw, 0);
  return out;
}

/**
 * One roll on a terrain sub-table, on the die its bands top out at. `top`
 * marks a roll on the table's last band, which is where a `chain` climbs.
 */
export function subTableDraw({ table, rng = Math.random } = {}) {
  const bands = readTable(ENCOUNTERS_DOC, "terrainSubTables")?.[table];
  const faces = Math.max(0, ...(Array.isArray(bands) ? bands : []).map((b) => Number(b?.max ?? b?.min) || 0));
  if (!faces) return { table, ok: false, missing: "terrainSubTables" };
  const roll = die(faces, rng);
  const row = bracketRow(bands, roll);
  if (!row?.name) return { table, ok: false, missing: "terrainSubTables" };
  return {
    table, ok: true, die: faces, roll, name: row.name, top: Number(row.max ?? row.min) >= faces,
    ...(typeof row.trap === "string" && row.trap ? { trap: row.trap } : {}),
  };
}

/**
 * A terrain lookup for the party's terrain: the row of `TERRAIN_LOOKUPS[kind]`
 * its encounter-terrain pick names. No pick is a different truth from an
 * unimported table, and the result says which.
 */
export function terrainLookup({ kind, terrain = "" } = {}) {
  const tableId = TERRAIN_LOOKUPS[kind];
  const group = ENCOUNTER_TERRAINS[terrain]?.[kind];
  if (!tableId || !group) return { kind, ok: false, noTerrain: true };
  const value = readTable(ENCOUNTERS_DOC, tableId)?.[group];
  return value == null ? { kind, ok: false, missing: tableId } : { kind, ok: true, value };
}

/**
 * Everything a terrain result leads to, in the order the Judge resolves it:
 * each sub-table roll (and the table a roll on a last band climbs to), then
 * each terrain lookup. A result `TERRAIN_FOLLOW_UPS` does not know leads to
 * nothing here and resolves from the book.
 */
export function terrainFollowUps({ name, terrain = "", rng = Math.random } = {}) {
  const spec = FOLLOW_UPS.get(foldName(name));
  const follow = [];
  for (const table of spec?.rolls ?? []) {
    const draw = subTableDraw({ table, rng });
    follow.push(draw);
    const next = spec.chain?.[table];
    if (next && draw.ok && draw.top) follow.push(subTableDraw({ table: next, rng }));
  }
  const lookups = (spec?.lookups ?? []).map((kind) => terrainLookup({ kind, terrain }));
  return { follow, lookups };
}

/**
 * Encounter distance for one side's terrain: the terrain's dice times its
 * multiplier. The AVERAGE rides along for the card; the cap against
 * visibility is `detection`'s business.
 */
export function encounterDistance({ terrain, rng = Math.random } = {}) {
  const key = ENCOUNTER_TERRAINS[terrain] ? ENCOUNTER_TERRAINS[terrain].distance : terrain;
  // null mapping = the book prints no row for this pick (a river) — a
  // different truth from an unimported table, and the card says which.
  if (!key) return { ok: false, noRow: true };
  const row = readTable(ENCOUNTERS_DOC, "distance")?.[key];
  if (!row) return { ok: false, missing: "distance" };
  const rolled = rollDice(row.dice, rng);
  if (rolled == null) return { ok: false, missing: "distance" };
  return { ok: true, feet: rolled * (Number(row.mult) || 1), dice: row.dice, mult: Number(row.mult) || 1, avg: row.avg ?? null };
}

/**
 * How many "men" a side counts as for visibility and evasion: every printed
 * size rides the imported `headCounts` ladder; a missing ladder counts every
 * body as one and says nothing it cannot back.
 */
export function headEquivalents({ men = 0, mounted = 0, large = 0, huge = 0, gigantic = 0, colossal = 0 } = {}) {
  const ladder = readTable(ENCOUNTERS_DOC, "visibility")?.headCounts ?? {};
  const per = (k, fallback) => Number(ladder[k]) || fallback;
  return (
    men +
    mounted * per("mounted", 1) +
    large * per("large", 1) +
    huge * per("huge", 1) +
    gigantic * per("gigantic", 1) +
    colossal * per("colossal", 1)
  );
}

/**
 * The farthest a side of `heads` men can be SEEN under the given light —
 * the base light figure scaled by the formation-size ladder. Null when the
 * visibility table is not imported (open country then never caps).
 *
 * `weather` is the sky's `{feet, factor}` (the merged effects' `visibility`):
 * the size scale is applied first, then the factor multiplies the result, then
 * a stated ceiling in `feet` caps it. An absent or empty `weather` leaves the
 * figure as the light and the size made it.
 */
export function visibilityMax({ light = "daylight", heads = 1, weather = null } = {}) {
  const vis = readTable(ENCOUNTERS_DOC, "visibility");
  const base = Number(vis?.[light]);
  if (!Number.isFinite(base)) return null;
  const scale = bracketRow(vis?.formationScale ?? [], heads)?.pct ?? 0;
  let feet = Math.round(base * (1 + scale / 100));
  const factor = numOrNull(weather?.factor);
  if (factor != null && factor > 0) feet = Math.round(feet * factor);
  const ceiling = numOrNull(weather?.feet);
  if (ceiling != null && ceiling > 0) feet = Math.min(feet, ceiling);
  return feet;
}

/**
 * Where the two sides actually stand when the encounter begins, and who saw
 * whom: each side rolls its OWN terrain's distance when they differ and the
 * encounter opens at the greater, the greater side detecting; the start is
 * then capped by how far each side can actually be seen. A side whose cap
 * hid it counts as undetected — the detection states the Judge feeds core's
 * Surprise Matrix. Flyers may open at altitude up to the imported fraction
 * of the distance.
 */
export function detection({ partyTerrain, monsterTerrain = null, partyHeads = 1, monsterHeads = 1, light = "daylight", weather = null, rng = Math.random } = {}) {
  const partyRoll = encounterDistance({ terrain: partyTerrain, rng });
  const monsterRoll = monsterTerrain && monsterTerrain !== partyTerrain
    ? encounterDistance({ terrain: monsterTerrain, rng })
    : null;
  if (!partyRoll.ok) return { ok: false, missing: partyRoll.missing };

  let feet = partyRoll.feet;
  let farSide = null; // who rolled the greater range across terrains
  if (monsterRoll?.ok) {
    farSide = monsterRoll.feet > partyRoll.feet ? "monsters" : "party";
    feet = Math.max(partyRoll.feet, monsterRoll.feet);
  }

  // Each side is visible out to its OWN cap; a side beyond its cap is unseen.
  const partyVisibleAt = visibilityMax({ light, heads: partyHeads, weather });
  const monstersVisibleAt = visibilityMax({ light, heads: monsterHeads, weather });
  const start = Math.min(feet, Math.max(partyVisibleAt ?? feet, monstersVisibleAt ?? feet));
  const partySees = monstersVisibleAt == null || start <= monstersVisibleAt;
  const monstersSee = partyVisibleAt == null || start <= partyVisibleAt;
  const altitudeFraction = Number(readTable(ENCOUNTERS_DOC, "visibility")?.altitudeFraction) || null;

  return {
    ok: true,
    feet: start,
    rolled: feet,
    partyRoll,
    monsterRoll,
    farSide,
    partySees: farSide ? farSide === "party" || partySees : partySees,
    monstersSee: farSide ? farSide === "monsters" || monstersSee : monstersSee,
    altitude: altitudeFraction ? Math.round(start * altitudeFraction) : null,
  };
}

/**
 * The evasion throw's target for this terrain and party size, from the
 * imported per-terrain size bands.
 */
export function evasionTarget({ terrain, partySize = 1 } = {}) {
  const key = ENCOUNTER_TERRAINS[terrain] ? ENCOUNTER_TERRAINS[terrain].evasion : terrain;
  if (!key) return { ok: false, noRow: true };
  const bands = readTable(ENCOUNTERS_DOC, "evasion")?.[key];
  if (!bands) return { ok: false, missing: "evasion" };
  const target = bracketRow(bands, partySize)?.target ?? null;
  return target != null ? { ok: true, target } : { ok: false, missing: "evasion" };
}

/**
 * The evasion modifiers that apply, each its own line: flying monsters over
 * open country, an explorer guiding familiar ground, a forlorn hope holding
 * the rear, and the speed comparison. Which modifiers EXIST is the rule's
 * shape; what each is worth is the imported `evasionModifiers` table. A
 * party that can fly over walkers simply evades — the caller short-circuits
 * on `autoEvade`.
 */
export function evasionModifiers({ terrain, monstersFly = false, partyFlies = false, monstersWalk = true, explorerGuide = false, forlornHope = false, fasterMonsters = false, slowerMonsters = false } = {}) {
  const mods = readTable(ENCOUNTERS_DOC, "evasionModifiers") ?? {};
  const parts = [];
  const add = (key, value, sign) => {
    const v = Number(value);
    if (Number.isFinite(v) && v !== 0) parts.push({ key, value: sign === "-" ? -Math.abs(v) : Math.abs(v) });
  };
  if (partyFlies && monstersWalk) return { autoEvade: true, parts: [] };
  if (monstersFly && !ENCOUNTER_TERRAINS[terrain]?.closed) add("aerial", mods.aerial, "-");
  if (explorerGuide) add("explorer", mods.explorer, "+");
  if (forlornHope) add("forlornHope", mods.forlornHope, "+");
  if (fasterMonsters) add("movement", mods.movement, "-");
  else if (slowerMonsters) add("movement", mods.movement, "+");
  return { autoEvade: false, parts };
}

/**
 * The aftermath of a successful evasion: a flight leg rolled on the same
 * distance table, a clock direction, and the navigation throw (at the
 * imported penalty) to learn whether the party is now lost.
 */
export function aftermath({ terrain, rng = Math.random } = {}) {
  const leg = encounterDistance({ terrain, rng });
  const nav = Number(readTable(ENCOUNTERS_DOC, "evasionModifiers")?.aftermathNavigation);
  return {
    ok: leg.ok,
    ...(leg.ok ? { feet: leg.feet } : { missing: leg.missing }),
    clock: d12(rng),
    navPenalty: Number.isFinite(nav) ? nav : null,
  };
}

/**
 * One whole encounter throw, composed in the rules' order. Pure: the caller
 * supplies territory/road/night/terrain and the flags the rules key on
 * (resting or retracing a known route downgrades terrain encounters), and
 * receives every step with its rolls — or the name of the first table the
 * registry could not answer, where the book takes over.
 *
 * `zone` is what the encounter zones the party stands in say, `{target,
 * table}`: `target` (0–6) a d6 target of their own, `table` whether they name
 * a RollTable. A target replaces the territory throw: the d6 is recorded as
 * `chain.zone` (`{roll, target, hit}`), `chain.territory` is a skipped marker
 * (`{ok: true, skipped: true}`), and a hit is a monster encounter. A named
 * table replaces the creature step of a creature outcome with `chain.zoneDraw`
 * — the caller draws it, since the table is a document — after the rarity
 * throw a territory monster outcome still makes; a zone's own hit with a
 * table stops there. Terrain outcomes and the distance roll are untouched.
 */
export function runEncounter({ territory, road = false, night = false, terrain, restingOrKnownRoute = false, zone = null, rng = Math.random } = {}) {
  const zoneTarget = Math.max(0, Math.min(6, Math.floor(Number(zone?.target) || 0)));
  const zoneTable = !!zone?.table;
  if (zoneTarget > 0) return zoneThrow({ territory, terrain, target: zoneTarget, table: zoneTable, rng });

  const chain = { territory: territoryThrow({ territory, road, night, rng }) };
  if (!chain.territory.ok) return chain;
  let outcome = chain.territory.outcome;

  const kind = ENCOUNTER_OUTCOMES[outcome]?.terrainKind;
  if (kind && restingOrKnownRoute) {
    chain.downgraded = outcome;
    outcome = "none";
  }
  chain.outcome = outcome;
  if (outcome === "none") return chain;

  if (outcome === "civilized") {
    if (zoneTable) chain.zoneDraw = true;
    else chain.creature = civilizedDraw({ terrain, rng });
  } else if (outcome === "monster") {
    chain.rarity = rarityThrow({ territory, rng });
    if (zoneTable) chain.zoneDraw = true;
    else if (chain.rarity.ok) chain.creature = monsterDraw({ terrain, rarity: chain.rarity.rarity, rng });
  } else if (kind) {
    chain.terrainEncounter = terrainEncounterDraw({ kind, terrain, territory, rng });
  }

  if (outcome === "civilized" || outcome === "monster") {
    chain.distance = encounterDistance({ terrain, rng });
  }
  return chain;
}

/**
 * A zone's own throw in place of the territory's: a d6 against the zone's
 * target, a hit being a monster encounter drawn from the zone's table when it
 * names one, else on the terrain's sub-table at the territory's rarity.
 */
function zoneThrow({ territory, terrain, target, table, rng }) {
  const roll = die(6, rng);
  const hit = roll >= target;
  const chain = { territory: { ok: true, skipped: true }, zone: { roll, target, hit }, outcome: hit ? "monster" : "none" };
  if (!hit) return chain;
  if (table) {
    chain.zoneDraw = true;
  } else {
    chain.rarity = rarityThrow({ territory, rng });
    if (chain.rarity.ok) chain.creature = monsterDraw({ terrain, rarity: chain.rarity.rarity, rng });
  }
  chain.distance = encounterDistance({ terrain, rng });
  return chain;
}
