/**
 * Formation assembly: the raw RR ch. 6 delve reads → the engine-shaped
 * `formation` ruledata tables acks-extras declares (the delve clock, the
 * carried-body load and the swimming throw read them through
 * `formationValue`).
 *
 * One page holds the first eight figures (RR p. 271). The swimming paragraph
 * gives seven: the penalty sizes a Judge may set on the throw, in printed order
 * and apart from any one water condition, what the Swimming proficiency is worth, the share of speed a swimmer makes, the sink
 * rate per stone, a breath's base before Constitution, and the load a rescuer
 * hauls — the body's own figure and the share of its kit that comes with it.
 * The rest paragraph gives the turns an unrested party may explore before it
 * is winded.
 *
 * Two more passages follow. Jumping and Leaping (RR pp. 270-271) is read into
 * the `jumping` table (the leap's formula and floor, the jump's die, the foot a
 * stone takes off, the run-up and what lacking it keeps, a creature's scale and
 * assumed Dexterity, the die a failed landing falls short by, the Acrobatics
 * score ceiling and the leap's bonus bands) and the `fall`
 * table (the die and the feet it is dealt per). The Spelunking grids (RR p. 268)
 * give the `spelunking` table: the stretch one throw covers and the target an
 * adventurer with no climbing proficiency throws against, or that none may try,
 * whether the climber is helpless on each obstacle, and the botch band each
 * grid's botched-throw row names; and the `spelunkingOutcomes` table: what a failed and a botched throw cost at
 * each obstacle, as the cell's words and whether they name a fall. The
 * Combatant Frontage and Interval passage (RR ch. 6) gives three distances in
 * feet: the march and wide frontages and the rank interval, one window each.
 * The trap passages (RR ch. 6 Searching, Traps and Trapbreaking, the combat
 * actions; JJ ch. 8 the pit) give eleven more, one window per figure
 * (`assembleTrapFigures`): the search reach bare and with a pole, the pole's
 * lead, the secret die and the band that springs it, the botch band of each
 * Trapbreaking mode, the methodical bonus, the trapbreak reach, and the spiked
 * pit's two dice. The Squeezing passage (RR ch. 6) gives four more
 * (`assembleSqueezing`): the length a chokepoint is told by, the bonus
 * Contortionism adds, the distance an escape carries and the penalty each
 * failed escape adds to the next. The faster paces of a proficient climber (RR
 * pp. 269-270) give three pairs (`assemblePacePenalties`): the two penalties a
 * climb, a crawling traverse and a balancing traverse each price a faster pace
 * at, in printed order, the pace nearer the base one first, and the same
 * paragraphs give the speed each pace moves at (`assemblePaceRates`).
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
    swimWaterPenaltySteps: "swimmingProse",
    swimmingBonus: "swimmingProse",
    swimSpeedShare: "swimmingProse",
    sinkFeetPerStone: "swimmingProse",
    breathRounds: "swimmingProse",
    jumping: ["jumpingProse", "jumpingLandingProse"],
    fall: "jumpingLandingProse",
    spelunking: ["spelunkingGrid", "spelunkingOutcomeGrid"],
    spelunkingOutcomes: "spelunkingOutcomeGrid",
    marchFrontageFeet: "frontageProse",
    wideFrontageFeet: "frontageProse",
    rankIntervalFeet: "frontageProse",
    searchReachFeet: "searchProse",
    poleSearchReachFeet: "searchProse",
    poleLeadFeet: "trapProse",
    trapTriggerDie: "trapProse",
    trapTriggerOn: "trapProse",
    trapbreakHastyBotch: "trapProse",
    trapbreakMethodicalBotch: "trapProse",
    trapbreakMethodicalBonus: "trapProse",
    trapbreakReachFeet: "actionProse",
    pitSpikeCount: "pitSpikeProse",
    pitSpikeDie: "pitSpikeProse",
    contortionismBonus: "squeezingProse",
    chokepointFeet: "squeezingProse",
    escapeFeet: "squeezingProse",
    escapePenaltyStep: "squeezingProse",
    squeezeBotchBand: "squeezingProse",
    climbPacePenalties: "climbPaceProse",
    crawlPacePenalties: "crawlPaceProse",
    balancePacePenalties: "balancePaceProse",
    climbPaceRates: "climbPaceProse",
    crawlPaceRates: "crawlPaceProse",
    balancePaceRates: "balancePaceProse",
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
const SHARE_WORDS = String.raw`one-half|one half|one-third|two-thirds|one-quarter|half|\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*%`;
const SHARE = new RegExp(String.raw`(?<![\w-])(${SHARE_WORDS})(?![\w-])`);

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
 * The penalty sizes a Judge may set on the swimming throw: the signed figures of
 * the sentence in printed order, each as a size (whatever sign is printed).
 * The sentence prices the conditions together rather than one apiece, so the
 * conditions are never consulted and nothing is paired with them; the throw
 * adds the size a Judge picks to its target. Null when the sentence prints no
 * figure.
 */
export function parseWaterPenaltySteps(window) {
  const steps = signedFigures(firstSentence(window)).map(Math.abs).filter((n) => n > 0);
  return steps.length ? steps : null;
}

/**
 * The two penalties a faster pace costs, in printed order: the sentence's
 * signed figures as sizes, the pace nearer the base one first. Exactly two are
 * read, each above zero; a sentence with another count, or a size of nothing,
 * answers null, because a pair that cannot be told which pace is which would
 * price the wrong one.
 *
 * @returns {number[]|null} `[nearer, farther]`
 */
export function parsePacePenalties(window) {
  const sizes = signedFigures(firstSentence(window)).map(Math.abs);
  return sizes.length === 2 && sizes.every((n) => n > 0) ? sizes : null;
}

/**
 * The speeds a pace paragraph can name, each by the word the page prints for it,
 * keyed by the module's own names for them (`formation/climb-pace.mjs`
 * `PACE_SPEEDS`). Apart from `PROGRESS_SPEED_WORDS` on purpose: the base pace
 * names the exploration speed, which a progress cell never does, and the two
 * sets are published as separate lists. The edges are letter tests.
 */
export const PACE_SPEED_WORDS = Object.freeze({
  exploration: /(?<![a-z])exploration(?![a-z])/,
  combat: /(?<![a-z])combat(?![a-z])/,
  run: /(?<![a-z])run(?:ning)?(?![a-z])/,
});

/**
 * One share-and-speed phrase of a pace sentence: an optional share (a share
 * word, a fraction, a percentage, or the whole-speed word) and the word before
 * "speed", with a possessive allowed between them. The seams are `\s+`: a
 * phrase whose words extraction welded together does not read, and the window
 * answers null rather than another rate.
 */
const PACE_PHRASE = new RegExp(
  String.raw`(?:(?<![\w-])(${SHARE_WORDS}|full)\s+(?:(?:his|her|their|the)\s+)?)?(?<![a-z])([a-z]+)\s+speed(?![a-z])`,
  "g",
);

/**
 * The share-and-speed phrases of a window's first sentence, in printed order,
 * each `{share, speed}` (`share` null where the phrase prints none). Null when
 * a phrase names no speed of `PACE_SPEED_WORDS`, or when the sentence says
 * "speed" anywhere a phrase does not read, so a speed never goes unclaimed.
 */
function paceSpeedPhrases(window) {
  const text = firstSentence(window);
  const phrases = [...text.matchAll(PACE_PHRASE)];
  if ((text.match(/(?<![a-z])speed(?![a-z])/g) ?? []).length !== phrases.length) return null;
  const out = [];
  for (const m of phrases) {
    const named = Object.keys(PACE_SPEED_WORDS).filter((key) => PACE_SPEED_WORDS[key].test(m[2]));
    if (named.length !== 1) return null;
    const share = m[1] == null ? null : m[1] === "full" ? 1 : parseShare(m[1], SHARE);
    if (m[1] != null && !(share > 0)) return null;
    out.push({ share, speed: named[0] });
  }
  return out;
}

/**
 * The rate the base pace moves at, from the window that holds only the
 * exploration-speed branch: `{share, speed}` with `speed` `"exploration"`, the
 * share a printed one or the whole speed where the branch prints none. A window
 * with another count of speeds, one that names a speed other than the
 * exploration one (the round-tracked branch), a share that is no share, or a
 * figure left in the sentence that no phrase read (a multiple, a share the
 * vocabulary lacks) answers null, so no such cell is read as the whole speed.
 *
 * @returns {{share: number, speed: string}|null}
 */
export function parsePaceBase(window) {
  const phrases = paceSpeedPhrases(window);
  if (phrases?.length !== 1 || phrases[0].speed !== "exploration") return null;
  // A figure the phrase did not read (a share in words the vocabulary lacks, a multiple, a
  // fraction with a word between it and the speed) is never the whole speed.
  const rest = firstSentence(window).replace(new RegExp(PACE_PHRASE.source, "g"), " ");
  if (/\d|%|half|third|quarter|fifth|sixth|eighth|tenth|full|whole|twice|double|triple|times/.test(rest)) return null;
  return { share: phrases[0].share ?? 1, speed: "exploration" };
}

/**
 * The rates of the two faster paces, in printed order, the pace nearer the base
 * one first: exactly two phrases, each a share and the one speed it is a share
 * of, so a share that is not said is not guessed. The pair must also order its
 * paces: its two penalties (`parsePacePenalties`) are read and must differ, and
 * two shares of one speed must rise. Anything else answers null, because a pair
 * that cannot be told which pace is which would put each pace on the other's
 * speed.
 *
 * @returns {Array<{share: number, speed: string}>|null} `[faster, fastest]`
 */
export function parsePaceRates(window) {
  const phrases = paceSpeedPhrases(window);
  if (phrases?.length !== 2 || phrases.some((p) => p.share == null)) return null;
  const sizes = parsePacePenalties(window);
  if (!sizes || sizes[0] === sizes[1]) return null;
  const [a, b] = phrases;
  if (a.speed === b.speed && !(b.share > a.share)) return null;
  return phrases.map(({ share, speed }) => ({ share, speed }));
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
 * The ceiling Acrobatics holds a raised score to: the whole figure after the
 * words "maximum of" in the window's first sentence; null when there is none or
 * it is not above zero.
 */
export function parseDexCap(window) {
  const n = wholeAfter(window, /maximum\s*of\s*(\d+)/);
  return n != null && n > 0 ? n : null;
}

/**
 * The bonus the leap takes at each score band, as rows `{min, max, mod}` in
 * ascending order: each clause of the window's first sentence that names a
 * score or a pair of scores, then the signed bonus it grants. A clause that
 * does not read leaves only itself out; bands that overlap are a misreading and
 * answer null, as does a window with no clause.
 * @returns {{min: number, max: number, mod: number}[]|null}
 */
export function parseDexBands(window) {
  const clause = /(?<![\w.+-])(\d+)(?:\s*[-–—−]\s*(\d+))?\s*grants?\s*a?\s*\+\s*(\d+)/g;
  const bands = [];
  for (const m of firstSentence(window).matchAll(clause)) {
    const min = Number(m[1]);
    const max = Number(m[2] ?? m[1]);
    if (min >= 1 && max >= min) bands.push({ min, max, mod: Number(m[3]) });
  }
  bands.sort((a, b) => a.min - b.min);
  const overlapped = bands.some((b, i) => i > 0 && b.min <= bands[i - 1].max);
  return bands.length && !overlapped ? bands : null;
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
 * Whether a cell of the grid's helplessness row says yes or no: true or false
 * for a cell that is only that word, undefined for any other cell (so it is
 * left out, never read as an answer).
 */
export function parseVulnerableCell(cell) {
  const t = cellText(cell);
  if (t === "yes") return true;
  return t === "no" ? false : undefined;
}

/**
 * The speeds a progress cell can name, each by the word the grid prints for it,
 * keyed by the module's own names for them (`obstacles.mjs` `PROGRESS_SPEEDS`).
 * The edges are letter tests, since extraction welds a figure onto the word
 * after it and a symbol onto the word before it.
 */
export const PROGRESS_SPEED_WORDS = Object.freeze({
  combat: /(?<![a-z])combat(?![a-z])/,
  run: /(?<![a-z])run(?:ning)?(?![a-z])/,
});

/**
 * The rate one cell of the grid's success row, or a failed-throw cell that
 * still moves the climber, says the climber moves at: `{share, speed}`, the
 * share of the named speed as a ratio (no fraction printed is the whole speed)
 * and the speed's own name, a key of `PROGRESS_SPEED_WORDS`. A cell that names
 * no speed, names two, or prints a figure other than one fraction (a bare
 * number, a share in words) decides nothing and answers null, so it is left
 * out and never read as another rate.
 *
 * @returns {{share: number, speed: string}|null}
 */
export function parseProgressCell(cell) {
  const t = cellText(cell);
  if (!/speed/.test(t)) return null;
  const named = Object.keys(PROGRESS_SPEED_WORDS).filter((key) => PROGRESS_SPEED_WORDS[key].test(t));
  if (named.length !== 1) return null;
  const fraction = /(\d+)\s*\/\s*(\d+)/.exec(t);
  const rest = fraction ? t.replace(fraction[0], " ") : t;
  if (/\d|half|third|quarter|fifth|full|twice|double/.test(rest)) return null;
  if (!fraction) return { share: 1, speed: named[0] };
  const share = Number(fraction[1]) / Number(fraction[2]);
  return Number.isFinite(share) && share > 0 ? { share, speed: named[0] } : null;
}

/**
 * The natural results a botched-throw row's label names, as `{min, max}`: the
 * label's bracketed note read as one whole number or a pair of them, and null
 * for a note that is neither. Seams are `\s*`; a pair's first end may not
 * exceed its second.
 */
export function parseBotchRange(note) {
  const m = /^\s*(\d+)\s*(?:[-–—−]\s*(\d+))?\s*$/.exec(String(note ?? ""));
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2] ?? m[1]);
  return min >= 1 && max >= min ? { min, max } : null;
}

/**
 * The `jumping` table from the two passages' windows: each figure on its own,
 * so a window that drifted costs that figure and nothing beside it. The jump's
 * die is kept only where it is a single die, which is the one the range the
 * jump reports is derived from. The Acrobatics score ceiling
 * (`acrobaticsDexCap`) and the bonus bands (`extendedDexBands`, rows of
 * `{min, max, mod}`) come from the landing passage's page.
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
  const cap = parseDexCap(landing.dexCap);
  if (cap != null) out.acrobaticsDexCap = cap;
  const bands = parseDexBands(landing.dexBands);
  if (bands) out.extendedDexBands = bands;
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
 * Two more rows are read per obstacle: `vulnerable`, whether the climber is
 * helpless on it (`parseVulnerableCell`), and `botchBand`, the natural results
 * that are a botch, which the botched-throw row's label prints and every
 * column of its grid shares (`parseBotchRange`), and `progress`, the rate a
 * climber moves at, `{success, fail}` with each present only where its cell
 * read (`parseProgressCell`): the success from the grid's own row, the fail
 * from the failed-throw row of `outcomes` (the `spelunkingOutcomeGrid` read,
 * where those cells wrap), which names a rate only for the one outcome that
 * still moves the climber. Each leaves out what did not read.
 */
export function assembleSpelunking(grid = {}, outcomes = {}) {
  const out = {};
  const rows = [
    { stretch: grid.stretchFirst, throws: grid.adventuringFirst, moves: grid.progressFirst, slower: outcomes.failFirst, botch: grid.botchFirst, helpless: grid.vulnerableFirst, kinds: SPELUNKING_COLUMNS[0] },
    { stretch: grid.stretchSecond, throws: grid.adventuringSecond, moves: grid.progressSecond, slower: outcomes.failSecond, botch: grid.botchSecond, helpless: grid.vulnerableSecond, kinds: SPELUNKING_COLUMNS[1] },
  ];
  const adventuring = {};
  const vulnerable = {};
  const botchBand = {};
  const progress = {};
  for (const { stretch, throws, moves, slower, botch, helpless, kinds } of rows) {
    const band = botch?.__missing ? null : parseBotchRange(botch?.note);
    for (const [i, kind] of kinds.entries()) {
      const column = ["first", "second", "third"][i];
      const feet = stretch?.__missing ? null : parseStretchFeet(stretch?.[column]);
      if (feet != null && out.stretchFeet == null) out.stretchFeet = feet;
      const target = throws?.__missing ? undefined : parseAdventuringCell(throws?.[column]);
      if (target !== undefined) adventuring[kind] = target;
      const helplessNow = helpless?.__missing ? undefined : parseVulnerableCell(helpless?.[column]);
      if (helplessNow !== undefined) vulnerable[kind] = helplessNow;
      if (band) botchBand[kind] = { ...band };
      const success = moves?.__missing ? null : parseProgressCell(moves?.[column]);
      const fail = slower?.__missing ? null : parseProgressCell(slower?.[column]);
      if (success || fail) progress[kind] = { ...(success ? { success } : {}), ...(fail ? { fail } : {}) };
    }
  }
  if (Object.keys(adventuring).length) out.adventuring = adventuring;
  if (Object.keys(vulnerable).length) out.vulnerable = vulnerable;
  if (Object.keys(botchBand).length) out.botchBand = botchBand;
  if (Object.keys(progress).length) out.progress = progress;
  return out;
}

/** The number words a round count may be written in, the numerals' own range of words (`COUNT`). */
const ROUND_COUNT = new RegExp(
  String.raw`(?<![\w./-])(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty)\s*rounds?(?![a-z])`,
  "gi",
);

/**
 * The rounds a cell's words count: a positive whole number, as a numeral or a
 * number word, right before a round noun. A cell that prints its count twice
 * in forms that agree reads it; two that disagree decide nothing, and so does a
 * cell with no count before a round noun. A turn is not a round.
 *
 * @returns {number|null}
 */
function roundsOf(text) {
  const counts = new Set();
  for (const m of String(text).matchAll(ROUND_COUNT)) {
    const n = parseCount(m[1].toLowerCase());
    if (!Number.isInteger(n) || n <= 0) return null;
    counts.add(n);
  }
  return counts.size === 1 ? [...counts][0] : null;
}

/**
 * One failed- or botched-throw cell as the obstacle procedure reads it: the
 * cell's words, kept whole for the card to print, `falls`, whether they name a
 * fall (which ends that climber's attempt), and `advances`, whether the
 * outcome still covers ground.
 *
 * `advances` has three states and the key is present only in the first two.
 * A negated progress noun reads false. Checked first, so a cell that negates
 * progress and also names a rate stays false. A cell that names the rate the
 * climber moves at (a speed or a pace) reads true. Any other wording decides
 * nothing and leaves the key off: the procedure treats an undecided outcome as
 * one that does not advance. A cell with no words is null, so its obstacle is
 * left out.
 *
 * `rounds`, the duration the outcome costs, is present only where the cell
 * prints a positive whole count right before a round noun (`roundsOf`).
 * @returns {{text: string, falls: boolean, advances?: boolean, rounds?: number}|null}
 */
export function parseOutcomeCell(cell) {
  const text = String(cell ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const out = { text: text[0].toUpperCase() + text.slice(1), falls: /\bfall(?:s|ing)?\b/i.test(text) };
  const rounds = roundsOf(text);
  if (rounds != null) out.rounds = rounds;
  // Seams are `\s*` and the noun's end is a letter test: extraction welds a figure onto the word after it.
  if (/\b(?:no|without)\s*progress(?![a-z])|\b(?:not|cannot|can't)\s*(?:progress|advance)(?![a-z])/i.test(text)) out.advances = false;
  else if (/\b(?:speed|pace)\b/i.test(text)) out.advances = true;
  return out;
}

/**
 * The `spelunkingOutcomes` table from the two grids' failed- and
 * botched-throw rows: per obstacle, `fail` and `botch`, each a
 * `parseOutcomeCell` result. A row that did not read, or a cell with no
 * words, leaves that outcome out and nothing beside it.
 */
export function assembleSpelunkingOutcomes(grid = {}) {
  const out = {};
  const rows = [
    [grid.failFirst, grid.botchFirst, SPELUNKING_COLUMNS[0]],
    [grid.failSecond, grid.botchSecond, SPELUNKING_COLUMNS[1]],
  ];
  for (const [fails, botches, kinds] of rows) {
    for (const [i, kind] of kinds.entries()) {
      const column = ["first", "second", "third"][i];
      const fail = fails?.__missing ? null : parseOutcomeCell(fails?.[column]);
      const botch = botches?.__missing ? null : parseOutcomeCell(botches?.[column]);
      if (!fail && !botch) continue;
      out[kind] = { ...(fail ? { fail } : {}), ...(botch ? { botch } : {}) };
    }
  }
  return out;
}

/**
 * The top of the band a window opens on: `1-2` is 2, a lone `1` is 1. Null for
 * a window that does not start on a count. The band is the die faces that
 * spring a trap, so only a range that starts at 1 reads.
 */
export function parseBandTop(window) {
  const m = /^\s*(\d+)(?:\s*[-–−]\s*(\d+))?/.exec(String(window ?? ""));
  if (!m || Number(m[1]) !== 1) return null;
  const top = Number(m[2] ?? m[1]);
  return Number.isInteger(top) && top >= 1 ? top : null;
}

/**
 * The unmodified die at or below which a throw goes wrong: the top of the band
 * the first "natural roll of" in the window opens on. The window is one
 * paragraph's, so its first such clause is that mode's own.
 */
export function parseBotchBand(window) {
  const m = /natural\s+roll\s+of\s+(\d+(?:\s*[-–−]\s*\d+)?)/.exec(String(window ?? "").toLowerCase().replace(/\s+/g, " "));
  return m ? parseBandTop(m[1]) : null;
}

/**
 * The trap passages' figures, each on its own so a window that drifted costs
 * that figure and nothing beside it: the automatic search's reach bare and with
 * a pole (`searchProse`), the pole's lead, the secret die and its band and the
 * Trapbreaking figures (`trapProse`, `actionProse`), and the spiked pit's dice
 * (`pitSpikeProse`).
 */
export function assembleTrapFigures(raw = {}) {
  const out = {};
  const search = raw.searchProse ?? {};
  const trap = raw.trapProse ?? {};
  const set = (key, value) => {
    if (value != null) out[key] = value;
  };
  set("searchReachFeet", parseFeet(search.reach));
  set("poleSearchReachFeet", parseFeet(search.poleReach));
  set("poleLeadFeet", parseFeet(trap.lead));
  const die = parseDie(firstSentence(trap.die));
  if (die && /^1d/.test(die)) out.trapTriggerDie = die;
  set("trapTriggerOn", parseBandTop(firstSentence(trap.band)));
  set("trapbreakHastyBotch", parseBotchBand(trap.hasty));
  set("trapbreakMethodicalBotch", parseBotchBand(trap.methodical));
  const bonus = parseBonusMagnitude(trap.methodical);
  if (bonus != null && bonus > 0) out.trapbreakMethodicalBonus = bonus;
  set("trapbreakReachFeet", parseFeet(raw.actionProse?.reach));
  const spikes = raw.pitSpikeProse ?? {};
  const count = parseDie(firstSentence(spikes.count));
  if (count) out.pitSpikeCount = count;
  const each = parseDie(firstSentence(spikes.each));
  if (each && /^1d/.test(each)) out.pitSpikeDie = each;
  return out;
}

/**
 * The Squeezing figures, one window each: `chokepointFeet`, the length below
 * which a narrowing is a chokepoint; `contortionismBonus`, the magnitude
 * Contortionism adds to the squeeze throw and the push-forward throw; `escapeFeet`, the
 * distance a successful escape carries, read from the retreat window and the
 * push window; and `escapePenaltyStep`, the magnitude each failed escape adds
 * to the next; and `squeezeBotchBand`, the top of the band of unmodified
 * results (it starts at the die's lowest) that leaves a squeezer stuck, read
 * as `parseBandTop` reads a trap's band. A window that does not read leaves its
 * figure out. Both escape windows that read must print one distance — one
 * figure stands for both, so two that differ answer none.
 */
export function assembleSqueezing(raw = {}) {
  const out = {};
  const chokepoint = parseFeet(raw.chokepoint);
  if (chokepoint != null) out.chokepointFeet = chokepoint;
  const bonus = parseBonusMagnitude(raw.contortion);
  if (bonus != null && bonus > 0) out.contortionismBonus = bonus;
  const ways = [parseFeet(raw.retreat), parseFeet(raw.advance)].filter((n) => n != null);
  if (ways.length && ways.every((n) => n === ways[0])) out.escapeFeet = ways[0];
  const step = parseBonusMagnitude(raw.penalty);
  if (step != null && step > 0) out.escapePenaltyStep = step;
  const band = parseBandTop(raw.botch);
  if (band != null) out.squeezeBotchBand = band;
  return out;
}

/**
 * The faster-pace penalties, one pair for each way of crossing, each read from
 * its own paragraph: `climbPacePenalties`, `crawlPacePenalties` and
 * `balancePacePenalties`. A paragraph that did not read leaves its pair out and
 * costs nothing beside it.
 */
export function assemblePacePenalties(raw = {}) {
  const out = {};
  for (const [key, table] of [
    ["climbPacePenalties", raw.climbPaceProse],
    ["crawlPacePenalties", raw.crawlPaceProse],
    ["balancePacePenalties", raw.balancePaceProse],
  ]) {
    const pair = parsePacePenalties(table?.pace);
    if (pair) out[key] = pair;
  }
  return out;
}

/**
 * The rates each way of crossing moves at, each read from its own paragraph:
 * `climbPaceRates`, `crawlPaceRates` and `balancePaceRates`, each
 * `{normal, faster, fastest}` of `{share, speed}`, with a member present only
 * where it read. `normal` is the exploration-speed branch (`parsePaceBase`, the
 * recipe's `base` window); `faster` and `fastest` are the two faster paces'
 * shares of the speed the paragraph names (`parsePaceRates`, the same `pace`
 * window as the penalties). A paragraph that read none leaves its key out.
 */
export function assemblePaceRates(raw = {}) {
  const out = {};
  for (const [key, table] of [
    ["climbPaceRates", raw.climbPaceProse],
    ["crawlPaceRates", raw.crawlPaceProse],
    ["balancePaceRates", raw.balancePaceProse],
  ]) {
    const rates = {};
    const normal = parsePaceBase(table?.base);
    if (normal) rates.normal = normal;
    const pair = parsePaceRates(table?.pace);
    if (pair) [rates.faster, rates.fastest] = pair;
    if (Object.keys(rates).length) out[key] = rates;
  }
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

  const steps = parseWaterPenaltySteps(swim.water);
  if (steps) out.swimWaterPenaltySteps = steps;

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
  const spelunking = assembleSpelunking(raw.spelunkingGrid, raw.spelunkingOutcomeGrid);
  if (Object.keys(spelunking).length) out.spelunking = spelunking;
  const outcomes = assembleSpelunkingOutcomes(raw.spelunkingOutcomeGrid);
  if (Object.keys(outcomes).length) out.spelunkingOutcomes = outcomes;

  const frontage = raw.frontageProse ?? {};
  for (const [key, window] of [
    ["marchFrontageFeet", frontage.march],
    ["wideFrontageFeet", frontage.wide],
    ["rankIntervalFeet", frontage.interval],
  ]) {
    const feet = parseFeet(window);
    if (feet != null) out[key] = feet;
  }

  Object.assign(out, assembleTrapFigures(raw));
  Object.assign(out, assembleSqueezing(raw.squeezingProse));
  Object.assign(out, assemblePacePenalties(raw));
  Object.assign(out, assemblePaceRates(raw));

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
