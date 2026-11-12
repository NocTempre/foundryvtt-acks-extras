/* global game, Roll */
/**
 * Obstacles the party has to get past one member at a time (RR ch. 6, the
 * Spelunking tables): a wall to climb, a rope to rappel, a ledge to edge along.
 *
 * The tables' shape is the whole feature. Each obstacle answers four questions
 * and they do NOT move together:
 *
 *  - **may an ordinary adventurer try at all?** Some obstacles are open to
 *    Adventuring and the rest are not permitted without Climbing or
 *    Mountaineering, and no roll changes that. Which is which, and the target
 *    an open one throws against, are printed: they arrive in the `spelunking`
 *    registered table (`adventuringTarget`);
 *  - **what does failure cost?** On the gentle obstacles, a round and nothing
 *    else. On the hard ones, a FALL — which is the difference between an
 *    inconvenience and a funeral;
 *  - **what does a natural 1 cost?** Usually the fall that failure did not;
 *  - **is the climber helpless while doing it?** Some obstacles leave them
 *    Vulnerable in combat and one does not.
 *
 * One throw per stretch of the obstacle, the stretch being the imported figure
 * (`stretchFeet`). Nothing here knows a distance or a target: with the table
 * not imported an ordinary adventurer's attempt is reported as unknown, never
 * rolled against a guess.
 *
 * A party has three ways to make a sheer face easy, and the module models the
 * outcome rather than the method: a rope secured by a proficient climber, a
 * grappling hook, or a mountaineer supervising. All three turn `sheer` into
 * `easy` for everyone who follows, which is what `assisted` means below.
 */
import { postToJudges } from "../lib/roll-audience.mjs";
import { MODULE_ID, formationValue } from "./constants.mjs";

const LANG_PREFIX = "ACKS-FORMATION.obstacles";

/** Failure and botch outcomes, named so a card can say them plainly. */
export const OUTCOME = Object.freeze({
  noProgress: "noProgress",
  fall: "fall",
  fallUnlessGeared: "fallUnlessGeared", // survives with Climbing + Mountaineering gear
  fallUnlessBurglar: "fallUnlessBurglar", // survives with Climbing + Cat Burglary
  slowDescent: "slowDescent", // a rappel that fails merely slows to combat speed
});

/**
 * The Spelunking tables, as the procedure each obstacle runs: its label, which
 * way it goes, what a failure and a botch cost, and whether the climber is
 * helpless on it. The keys name the six columns, in the order the grids print
 * them (`importer/formation-binding.mjs` `SPELUNKING_COLUMNS`). What an
 * ordinary adventurer throws is not here: see `adventuringTarget`.
 */
export const OBSTACLES = Object.freeze({
  easyClimb: {
    label: `${LANG_PREFIX}.easyClimb`, vertical: true,
    fail: OUTCOME.noProgress, botch: OUTCOME.fallUnlessGeared, vulnerable: false,
  },
  sheerClimb: {
    label: `${LANG_PREFIX}.sheerClimb`, vertical: true,
    fail: OUTCOME.fallUnlessGeared, botch: OUTCOME.fall, vulnerable: true,
  },
  rappel: {
    label: `${LANG_PREFIX}.rappel`, vertical: true, descendOnly: true,
    fail: OUTCOME.slowDescent, botch: OUTCOME.fallUnlessGeared, vulnerable: true,
  },
  crawl: {
    label: `${LANG_PREFIX}.crawl`, vertical: false,
    fail: OUTCOME.noProgress, botch: OUTCOME.fallUnlessGeared, vulnerable: true,
  },
  narrowLedge: {
    label: `${LANG_PREFIX}.narrowLedge`, vertical: false,
    fail: OUTCOME.noProgress, botch: OUTCOME.fallUnlessBurglar, vulnerable: true,
  },
  precariousLedge: {
    label: `${LANG_PREFIX}.precariousLedge`, vertical: false,
    fail: OUTCOME.fallUnlessBurglar, botch: OUTCOME.fall, vulnerable: true,
  },
});

/**
 * What an adventurer with no climbing proficiency throws against at this
 * obstacle: the target, `false` where the table says none may try, or null
 * until the table is imported. A Judge's override is free text, so a figure
 * that is no positive number reads as not imported.
 *
 * @param {string} kind a key of OBSTACLES
 * @returns {number|false|null}
 */
export function adventuringTarget(kind) {
  const cell = formationValue("spelunking")?.adventuring?.[kind];
  if (cell === false) return false;
  const n = cell == null || cell === "" ? NaN : Number(cell);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The feet one throw covers, or null until the table is imported. */
export function stretchFeet() {
  const n = Number(formationValue("spelunking")?.stretchFeet);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Throws a distance demands — a wall is not one roll because it is one wall.
 * Null until the stretch one throw covers is imported.
 */
export function throwsFor(feet) {
  const stretch = stretchFeet();
  return stretch === null ? null : Math.max(1, Math.ceil((Number(feet) || 0) / stretch));
}

/**
 * What this member faces at this obstacle.
 *
 * @param {object} o
 * @param {string} o.kind        a key of OBSTACLES
 * @param {boolean} o.proficient has Climbing or Mountaineering
 * @param {number|null} o.classThrow the proficient climber's own throw, if known
 * @param {boolean} o.assisted   a rope is fixed, or a mountaineer is supervising
 * @returns {{permitted: boolean, target: number|null, reason: string|null, obstacle: object}}
 */
export function obstaclePlan({ kind, proficient = false, classThrow = null, assisted = false } = {}) {
  // A fixed rope or a supervising mountaineer turns the hard vertical climb
  // into the easy one — that is what the party bought by sending a climber up
  // first. It does not help along a ledge, which nobody can rope for you.
  const effective = assisted && kind === "sheerClimb" ? "easyClimb" : kind;
  const obstacle = OBSTACLES[effective];
  if (!obstacle) return { permitted: false, target: null, reason: "unknown", obstacle: null };

  if (proficient) {
    // A proficient climber throws against their own class value; without one
    // recorded, the Judge is told rather than given an invented number.
    return classThrow != null
      ? { permitted: true, target: classThrow, reason: null, obstacle, effective }
      : { permitted: true, target: null, reason: "needsClassThrow", obstacle, effective };
  }
  const open = adventuringTarget(effective);
  // Not imported is its own answer: an ordinary adventurer's attempt is
  // neither refused nor rolled when the table that says which is absent.
  if (open === null) return { permitted: false, target: null, reason: "notImported", obstacle, effective };
  if (open === false) return { permitted: false, target: null, reason: "notPermitted", obstacle, effective };
  return { permitted: true, target: open, reason: null, obstacle, effective };
}

/**
 * Read one throw's result against a plan. Pure, so the outcome table is
 * testable without dice.
 */
export function readThrow({ plan, natural, total }) {
  if (!plan?.permitted || plan.target == null) return { ok: false, outcome: null };
  const success = total >= plan.target;
  if (success) return { ok: true, success: true, outcome: "progress", vulnerable: plan.obstacle.vulnerable };
  return {
    ok: true,
    success: false,
    // A natural 1 is its own row on the table, and on the hard obstacles it is
    // the difference between standing still and falling.
    outcome: natural === 1 ? plan.obstacle.botch : plan.obstacle.fail,
    botch: natural === 1,
    vulnerable: plan.obstacle.vulnerable,
  };
}

/**
 * Send a party at an obstacle, one member at a time, and report what happened
 * to each. Members who may not attempt it at all are listed as such rather
 * than rolled for — being unable to try is a fact the party needs BEFORE
 * someone falls, not a failed roll.
 *
 * The length is the obstacle's, in feet; left out it is one stretch of the
 * imported table. With the stretch not imported no throw count can be made, so
 * every member is listed as unable to attempt it, naming the table.
 *
 * @param {Array<{actor: Actor, proficient?: boolean, classThrow?: number}>} members
 */
export async function attemptObstacle(members, { kind, assisted = false, feet = stretchFeet() } = {}) {
  const throws = throwsFor(feet);
  const results = [];

  for (const m of members) {
    const plan = throws === null
      ? { permitted: false, target: null, reason: "notImported", obstacle: OBSTACLES[kind] ?? null }
      : obstaclePlan({ kind, proficient: m.proficient, classThrow: m.classThrow, assisted });
    if (!plan.permitted || plan.target == null) {
      results.push({ name: m.actor?.name, plan, blocked: true });
      continue;
    }
    // Every stretch is its own throw, and the first fall ends the climb.
    const attempts = [];
    for (let i = 0; i < throws; i++) {
      const roll = await new Roll("1d20").evaluate();
      const natural = roll.dice[0]?.results?.[0]?.result ?? roll.total;
      const read = readThrow({ plan, natural, total: roll.total });
      attempts.push({ ...read, natural, total: roll.total, roll });
      if (read.outcome === OUTCOME.fall || read.outcome === OUTCOME.fallUnlessGeared || read.outcome === OUTCOME.fallUnlessBurglar) break;
    }
    results.push({ name: m.actor?.name, plan, attempts, blocked: false });
  }

  await postToJudges({
    flavor: feet == null
      ? game.i18n.localize(OBSTACLES[kind]?.label ?? `${LANG_PREFIX}.unknown`)
      : game.i18n.format(`${LANG_PREFIX}.flavor`, {
        obstacle: game.i18n.localize(OBSTACLES[kind]?.label ?? `${LANG_PREFIX}.unknown`),
        feet,
      }),
    content: `<ul class="acks-extras-obstacle-results">${results.map((r) => {
      if (r.blocked) {
        return `<li><strong>${r.name}</strong> — ${game.i18n.localize(`${LANG_PREFIX}.reason.${r.plan.reason}`)}</li>`;
      }
      const last = r.attempts[r.attempts.length - 1];
      const key = last.success ? "progress" : last.outcome;
      return `<li><strong>${r.name}</strong> — ${game.i18n.localize(`${LANG_PREFIX}.outcome.${key}`)}` +
        ` <span>(${r.attempts.map((a) => a.total).join(", ")})</span></li>`;
    }).join("")}</ul>`,
    rolls: results.flatMap((r) => (r.attempts ?? []).map((a) => a.roll)),
  });

  return results;
}

/** Names this module answers to, for a caller binding its own UI. */
export const OBSTACLE_KEYS = Object.keys(OBSTACLES);
export { MODULE_ID };
