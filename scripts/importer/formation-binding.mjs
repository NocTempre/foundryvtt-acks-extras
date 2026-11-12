/**
 * Formation assembly: the raw RR ch. 6 delve reads → the engine-shaped
 * `formation` ruledata tables acks-extras declares (the delve clock, the
 * carried-body load and the swimming throw read them through
 * `formationValue`).
 *
 * One page holds the first eight figures (RR p. 271). The swimming paragraph
 * gives seven: what each named water condition costs the throw, what the
 * Swimming proficiency is worth, the share of speed a swimmer makes, the sink
 * rate per stone, a breath's base before Constitution, and the load a rescuer
 * hauls — the body's own figure and the share of its kit that comes with it.
 * The rest paragraph gives the turns an unrested party may explore before it
 * is winded.
 *
 * Two more passages follow. Jumping and Leaping (RR pp. 270-271) is read into
 * the `jumping` table (the leap's formula and floor, the jump's die, the foot a
 * stone takes off, the run-up and what lacking it keeps, a creature's scale and
 * assumed Dexterity, the die a failed landing falls short by) and the `fall`
 * table (the die and the feet it is dealt per). The Spelunking grids (RR p. 268)
 * give the `spelunking` table: the stretch one throw covers and the target an
 * adventurer with no climbing proficiency throws against, or that none may try.
 *
 * Each figure is read out of a short window of prose and parsed here, once. A
 * window that did not read leaves its key absent, so the reader reports that
 * figure as unknown; nothing is defaulted. Like every binding here, no value
 * ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";
import { parseCount, parseShare } from "./survival-binding.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const FORMATION_DOC_ID = "formation";

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [FORMATION_DOC_ID]: {
    restInterval: "restProse",
    carriedBodyStone: "swimmingProse",
    carriedGearShare: "swimmingProse",
    swimWaterModifiers: "swimmingProse",
    swimmingBonus: "swimmingProse",
    swimSpeedShare: "swimmingProse",
    sinkFeetPerStone: "swimmingProse",
    breathRounds: "swimmingProse",
    jumping: ["jumpingProse", "jumpingLandingProse"],
    fall: "jumpingLandingProse",
    spelunking: "spelunkingGrid",
  },
});

/**
 * The obstacles each Spelunking grid's three columns hold, left to right, in
 * the order the page stacks the grids. The names are formation/obstacles.mjs
 * `OBSTACLES` keys: the module's own vocabulary for what the columns are.
 */
export const SPELUNKING_COLUMNS = Object.freeze([
  Object.freeze(["easyClimb", "sheerClimb", "rappel"]),
  Object.freeze(["crawl", "narrowLedge", "precariousLedge"]),
]);

/**
 * The water conditions the swimming throw prices, as the engine names them
 * (`WATER` in formation/swimming.mjs) and as a sentence names them. `calm` is
 * not here: it costs nothing by definition and is never emitted.
 */
export const WATER_KEYS = Object.freeze(["cold", "rough"]);

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/** A count as prose writes it: digits, or a number word `parseCount` reads. */
const COUNT = "\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty";

/**
 * A share as prose writes it — a word, a fraction or a percentage — captured
 * whole for `parseShare`. Bounded on both sides, so "half" is never read out
 * of a longer word.
 */
const SHARE = /(?<![\w-])(one-half|one half|one-third|two-thirds|one-quarter|half|\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*%)(?![\w-])/;

/**
 * A window's first sentence, lowercased and whitespace-collapsed. Windows are
 * cut by length, so they run on into whatever follows, and a figure past the
 * full stop belongs to the next rule.
 */
export function firstSentence(window) {
  const t = String(window ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const end = t.search(/\.(?:\s|$)/);
  return end === -1 ? t : t.slice(0, end);
}

/**
 * Every figure printed with a sign, in reading order, as signed numbers. The
 * sign may be a hyphen or a true minus (−).
 */
export function signedFigures(text) {
  return [...String(text ?? "").matchAll(/([-+−])\s?(\d+(?:\.\d+)?)/g)]
    .map((m) => (m[1] === "+" ? 1 : -1) * Number(m[2]));
}

/** The first count a text prints, digits or a number word; null when none. */
export function firstCount(text) {
  const m = new RegExp(`(?<![\\w./-])(${COUNT})(?![\\w/-])`).exec(String(text ?? "").toLowerCase());
  return m ? parseCount(m[1]) : null;
}

/**
 * What each named water condition costs the throw, as `{cold, rough}`: the
 * signed figures of the sentence in printed order, paired with the conditions
 * in the order the sentence names them. Stored negative whatever sign is
 * printed — the reader subtracts a modifier, so a penalty raises the target.
 * A condition the sentence leaves without a figure is left out; null when
 * none pairs.
 */
export function parseWaterModifiers(window) {
  const s = firstSentence(window);
  const named = WATER_KEYS
    .map((key) => ({ key, at: s.search(new RegExp(`\\b${key}\\b`)) }))
    .filter((w) => w.at !== -1)
    .sort((a, b) => a.at - b.at);
  const figures = signedFigures(s);
  const out = {};
  named.forEach(({ key }, i) => {
    if (figures[i] != null) out[key] = -Math.abs(figures[i]);
  });
  return Object.keys(out).length ? out : null;
}

/** A bonus as a magnitude: the first signed figure of the sentence; null when none. */
export function parseBonusMagnitude(window) {
  const [first] = signedFigures(firstSentence(window));
  return first == null ? null : Math.abs(first);
}

/** A share of a whole, between zero and one; null when the sentence prints none. */
export function parseShareOf(window) {
  const share = parseShare(firstSentence(window), SHARE);
  return share != null && share > 0 && share <= 1 ? share : null;
}

/**
 * A distance in feet: the first figure the sentence prints with a feet mark
 * or a feet unit. A figure without one is not read — a rate in some other
 * unit is not this rate.
 */
export function parseFeet(window) {
  const re = new RegExp(`(?<![\\w./-])(${COUNT})\\s*(?:[’'′]|feet\\b|foot\\b|ft\\b)`, "g");
  for (const m of firstSentence(window).matchAll(re)) {
    const n = parseCount(m[1]);
    if (n != null && n > 0) return n;
  }
  return null;
}

/**
 * The load a rescuer hauls: the stone figure the body is weighed at — a whole
 * number, a decimal, or a whole number with a fraction — and the share of its
 * kit, read from AFTER that figure, because the figure itself may be written
 * with a fraction that is not the share.
 *
 * @returns {{stone: number|null, gearShare: number|null}}
 */
export function parseCarriedBody(window) {
  const s = firstSentence(window);
  const m = /(?<![\w./])(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?\s*stone\b/.exec(s);
  if (!m) return { stone: null, gearShare: null };
  const fraction = m[2] != null && Number(m[3]) > 0 ? Number(m[2]) / Number(m[3]) : 0;
  const stone = Number(m[1]) + fraction;
  return {
    stone: Number.isFinite(stone) && stone > 0 ? stone : null,
    gearShare: parseShareOf(s.slice(m.index + m[0].length)),
  };
}

/**
 * Turns an unrested party may explore before it is winded: the count of
 * turns past which the paragraph winds it — the threshold the clock compares
 * against — else the count its rest cadence is stated per. Whole turns only.
 */
export function parseRestInterval(window) {
  const t = String(window ?? "").toLowerCase().replace(/\s+/g, " ");
  for (const re of [
    new RegExp(`\\bmore\\s+than\\s+(${COUNT})\\s+turns?\\b`),
    new RegExp(`\\bevery\\s+(${COUNT})\\s+turns?\\b`),
  ]) {
    const m = re.exec(t);
    const n = m ? parseCount(m[1]) : null;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/**
 * The first dice the text prints, as `NdM` rebuilt from its integers; null
 * when it prints none. Nothing but two integers reaches a roll.
 */
export function parseDie(text) {
  const m = /(?<![\w.])(\d+)\s*d\s*(\d+)(?!\w|\.\d)/.exec(String(text ?? "").toLowerCase());
  const [count, faces] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  return count > 0 && faces > 0 ? `${count}d${faces}` : null;
}

/** A whole figure the pattern captures from the window's first sentence; null when none. */
const wholeAfter = (window, re) => {
  const m = re.exec(firstSentence(window));
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** The distance a text prints in feet, closest to the unit mark: `1’`, `10 feet`. */
const FEET_MARK = String.raw`\s*(?:[’'′]|feet\b|foot\b|ft\b)`;

/**
 * The leap's height formula: the figure added to the Dexterity bonus and the
 * floor the height holds to, read from the sentence's two figures by the
 * words that name them.
 * @returns {{plus: number|null, minimum: number|null}}
 */
export function parseLeap(window) {
  return {
    plus: wholeAfter(window, /bonus\s*\+\s*(\d+)/),
    minimum: wholeAfter(window, /minimum\s+of\s+(\d+)/),
  };
}

/**
 * What a standing start keeps: "halved" is one half, "quartered" one quarter,
 * and a share written any other way is the one `parseShareOf` reads.
 */
export function parseStandingShare(window) {
  const s = firstSentence(window);
  if (/\bhalved\b/.test(s)) return 0.5;
  if (/\bquartered\b/.test(s)) return 0.25;
  return parseShareOf(s);
}

/** A table's cell text: one run of words, lowercased and whitespace-collapsed. */
const cellText = (cell) => String(cell ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The feet one throw covers, out of the grid's "one throw per N feet" cell;
 * null for a cell that prints no distance.
 */
export function parseStretchFeet(cell) {
  const m = new RegExp(String.raw`\bper\s+(\d+)${FEET_MARK}`).exec(cellText(cell));
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The throw an adventurer with no climbing proficiency makes at one obstacle:
 * the figure before the plus sign, `false` for the words that say none may
 * try, and undefined for a cell that says neither (so it is left out, never
 * read as a refusal).
 */
export function parseAdventuringCell(cell) {
  const t = cellText(cell);
  const m = /^(\d+)\s*\+$/.exec(t);
  if (m) return Number(m[1]) > 0 ? Number(m[1]) : undefined;
  return /^not\s*permitted$/.test(t) ? false : undefined;
}

/**
 * The `jumping` table from the two passages' windows: each figure on its own,
 * so a window that drifted costs that figure and nothing beside it. The jump's
 * die is kept only where it is a single die, which is the one the range the
 * jump reports is derived from.
 */
export function assembleJumping(jump = {}, landing = {}) {
  const out = {};
  const leap = parseLeap(jump.leap);
  if (leap.plus != null) out.leapPlus = leap.plus;
  if (leap.minimum != null) out.leapMinimum = leap.minimum;
  const die = parseDie(firstSentence(jump.jump));
  if (die && /^1d/.test(die)) out.jumpDie = die;
  const perStone = new RegExp(String.raw`(\d+(?:\.\d+)?)${FEET_MARK}\s*per\s+stone`).exec(firstSentence(jump.load));
  if (perStone && Number(perStone[1]) > 0) out.feetPerStone = Number(perStone[1]);
  const runUp = parseFeet(jump.runUp);
  if (runUp != null) out.runUpFeet = runUp;
  const standing = parseStandingShare(jump.runUp);
  if (standing != null) out.standingShare = standing;
  const base = wholeAfter(landing.speed, /speed\s*\/\s*(\d+)/);
  if (base) out.creatureSpeedBase = base;
  const dex = wholeAfter(landing.dex, /^\s*(\d+)/);
  if (dex != null) out.creatureDex = dex;
  const short = parseDie(firstSentence(landing.short));
  if (short) out.shortfallDie = short;
  return out;
}

/** The `fall` table from the landing passage's last window: the die and the feet it is dealt per. */
export function assembleFall(window) {
  const s = firstSentence(window);
  const out = {};
  const die = parseDie(s);
  if (die) out.die = die;
  const feet = wholeAfter(s, new RegExp(String.raw`\bper\s+(\d+)${FEET_MARK}`));
  if (feet) out.feetPerDie = feet;
  return out;
}

/**
 * The `spelunking` table from the two stacked grids: `stretchFeet`, the feet
 * one throw covers (every column states it; the first read stands), and
 * `adventuring`, one entry per obstacle that read. A grid that did not read,
 * or a cell that says neither a target nor a refusal, leaves its obstacle out.
 */
export function assembleSpelunking(grid = {}) {
  const out = {};
  const rows = [
    [grid.stretchFirst, grid.adventuringFirst, SPELUNKING_COLUMNS[0]],
    [grid.stretchSecond, grid.adventuringSecond, SPELUNKING_COLUMNS[1]],
  ];
  const adventuring = {};
  for (const [stretch, throws, kinds] of rows) {
    for (const [i, kind] of kinds.entries()) {
      const column = ["first", "second", "third"][i];
      const feet = stretch?.__missing ? null : parseStretchFeet(stretch?.[column]);
      if (feet != null && out.stretchFeet == null) out.stretchFeet = feet;
      const target = throws?.__missing ? undefined : parseAdventuringCell(throws?.[column]);
      if (target !== undefined) adventuring[kind] = target;
    }
  }
  if (Object.keys(adventuring).length) out.adventuring = adventuring;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented prose. Each figure assembles on its own, so a window that drifted
 * costs that figure and nothing beside it.
 */
export function assembleFormationTables(raw = {}) {
  const out = {};
  const swim = raw.swimmingProse ?? {};

  const water = parseWaterModifiers(swim.water);
  if (water) out.swimWaterModifiers = water;

  const bonus = parseBonusMagnitude(swim.proficiency);
  if (bonus != null) out.swimmingBonus = bonus;

  const pace = parseShareOf(swim.pace);
  if (pace != null) out.swimSpeedShare = pace;

  const sink = parseFeet(swim.sink);
  if (sink != null) out.sinkFeetPerStone = sink;

  const breath = firstCount(firstSentence(swim.breath));
  if (breath != null && breath > 0) out.breathRounds = breath;

  const body = parseCarriedBody(swim.rescue);
  if (body.stone != null) out.carriedBodyStone = body.stone;
  if (body.gearShare != null) out.carriedGearShare = body.gearShare;

  const rest = parseRestInterval(raw.restProse?.cadence);
  if (rest != null) out.restInterval = rest;

  const jumping = assembleJumping(raw.jumpingProse, raw.jumpingLandingProse);
  if (Object.keys(jumping).length) out.jumping = jumping;
  const fall = assembleFall(raw.jumpingLandingProse?.fall);
  if (Object.keys(fall).length) out.fall = fall;
  const spelunking = assembleSpelunking(raw.spelunkingGrid);
  if (Object.keys(spelunking).length) out.spelunking = spelunking;

  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applyFormationImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(FORMATION_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleFormationTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[FORMATION_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
