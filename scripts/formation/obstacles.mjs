/* global game, Roll */
/**
 * Obstacles the party has to get past one member at a time (RR ch. 6, the
 * Spelunking tables): a wall to climb, a rope to rappel, a ledge to edge along.
 *
 * Each obstacle answers four independent questions:
 *
 *  - **may an ordinary adventurer try at all, and against what target?** Read
 *    from the `spelunking` registered table (`adventuringTarget`);
 *  - **what does a failed throw cost?** and **what does a natural 1 cost?**
 *    Read from the `spelunkingOutcomes` registered table (`obstacleOutcome`):
 *    the row's words, which the card prints, and whether they name a fall. A
 *    fall ends that climber's attempt; any other outcome leaves the next
 *    stretch to throw;
 *  - **is the climber helpless while doing it?** (`vulnerable`).
 *
 * One throw per stretch of the obstacle, the stretch being the imported figure
 * (`stretchFeet`). Nothing here knows a distance, a target or an outcome: with
 * the table not imported an ordinary adventurer's attempt is reported as
 * unknown, never rolled against a guess, and a missed throw whose outcome is
 * not imported ends that climber's attempt.
 *
 * A rope secured by a proficient climber, a grappling hook, or a mountaineer
 * supervising each turn `sheer` into `easy` for everyone who follows: that is
 * what `assisted` means below.
 */
import { postToJudges } from "../lib/roll-audience.mjs";
import { citeOf } from "../lib/tables.mjs";
import { FORMATION_DOC, MODULE_ID, formationValue } from "./constants.mjs";

const LANG_PREFIX = "ACKS-FORMATION.obstacles";

/** The registered table a failed or botched throw's outcome is read from. */
export const OUTCOMES_TABLE = "spelunkingOutcomes";

/**
 * The Spelunking tables, as the procedure each obstacle runs: its label, which
 * way it goes, and whether the climber is helpless on it. The keys name the six
 * columns, in the order the grids print them (`importer/formation-binding.mjs`
 * `SPELUNKING_COLUMNS`). What an ordinary adventurer throws and what a missed
 * throw costs are not here: see `adventuringTarget` and `obstacleOutcome`.
 */
export const OBSTACLES = Object.freeze({
  easyClimb: { label: `${LANG_PREFIX}.easyClimb`, vertical: true, vulnerable: false },
  sheerClimb: { label: `${LANG_PREFIX}.sheerClimb`, vertical: true, vulnerable: true },
  rappel: { label: `${LANG_PREFIX}.rappel`, vertical: true, descendOnly: true, vulnerable: true },
  crawl: { label: `${LANG_PREFIX}.crawl`, vertical: false, vulnerable: true },
  narrowLedge: { label: `${LANG_PREFIX}.narrowLedge`, vertical: false, vulnerable: true },
  precariousLedge: { label: `${LANG_PREFIX}.precariousLedge`, vertical: false, vulnerable: true },
});

/**
 * What a missed throw costs at this obstacle: `which` is `"fail"` for a failed
 * throw and `"botch"` for a natural 1. Answers `{text, falls}` — the words the
 * card prints and whether they end the attempt — or null until the table holds
 * that outcome. A Judge's override with no words reads as not imported.
 *
 * @param {string} kind a key of OBSTACLES
 * @param {"fail"|"botch"} which
 * @returns {{text: string, falls: boolean}|null}
 */
export function obstacleOutcome(kind, which) {
  const cell = formationValue(OUTCOMES_TABLE)?.[kind]?.[which];
  const text = typeof cell?.text === "string" ? cell.text.trim() : "";
  return text ? { text, falls: cell.falls === true } : null;
}

/**
 * Where an outcome came from, for its tooltip: the page the table was imported
 * from, a Judge's override (which holds no page), or not imported.
 * @param {{text: string}|null} outcome an `obstacleOutcome` result
 */
export function outcomeProvenance(outcome) {
  if (!outcome) return game.i18n.localize("ACKS-FORMATION.chat.cadenceFrom.none");
  const cite = citeOf(FORMATION_DOC, OUTCOMES_TABLE);
  return cite
    ? game.i18n.format("ACKS-FORMATION.chat.cadenceFrom.import", { cite })
    : game.i18n.localize("ACKS-FORMATION.chat.cadenceFrom.override");
}

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
 * The throws a distance demands, one per stretch. Null until the stretch one
 * throw covers is imported.
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
  // Assistance turns the sheer climb into the easy one; it does not help along a ledge.
  const effective = assisted && kind === "sheerClimb" ? "easyClimb" : kind;
  const obstacle = OBSTACLES[effective];
  if (!obstacle) return { permitted: false, target: null, reason: "unknown", obstacle: null };

  if (proficient) {
    // A proficient climber throws against their own class value; with none
    // recorded the plan says `needsClassThrow`.
    return classThrow != null
      ? { permitted: true, target: classThrow, reason: null, obstacle, effective }
      : { permitted: true, target: null, reason: "needsClassThrow", obstacle, effective };
  }
  const open = adventuringTarget(effective);
  // Not imported is its own answer: neither refused nor rolled.
  if (open === null) return { permitted: false, target: null, reason: "notImported", obstacle, effective };
  if (open === false) return { permitted: false, target: null, reason: "notPermitted", obstacle, effective };
  return { permitted: true, target: open, reason: null, obstacle, effective };
}

/**
 * Read one throw's result against a plan, testable without dice. A miss
 * answers the imported outcome (`obstacleOutcome`, null while not imported)
 * and `ends`: whether the climber's attempt stops here, which it does on a
 * fall and on an outcome nobody imported.
 */
export function readThrow({ plan, natural, total }) {
  if (!plan?.permitted || plan.target == null) return { ok: false, outcome: null };
  const success = total >= plan.target;
  if (success) return { ok: true, success: true, outcome: "progress", ends: false, vulnerable: plan.obstacle.vulnerable };
  // A natural 1 is its own row on the table, read apart from a plain miss.
  const botch = natural === 1;
  const outcome = obstacleOutcome(plan.effective ?? plan.kind, botch ? "botch" : "fail");
  return {
    ok: true,
    success: false,
    outcome,
    ends: outcome == null || outcome.falls,
    botch,
    vulnerable: plan.obstacle.vulnerable,
  };
}

/**
 * Send a party at an obstacle, one member at a time, and report what happened
 * to each. Members who may not attempt it at all are listed as such rather
 * than rolled for.
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
      if (read.ends) break;
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
      // The imported words are free text from the Judge's book or override, so
      // they are escaped; the tooltip says which of the two, or not imported.
      const said = last.success
        ? game.i18n.localize(`${LANG_PREFIX}.outcome.progress`)
        : `<span data-tooltip-text="${foundry.utils.escapeHTML(outcomeProvenance(last.outcome))}">`
          + `${foundry.utils.escapeHTML(last.outcome?.text ?? game.i18n.localize(`${LANG_PREFIX}.outcome.notImported`))}</span>`;
      return `<li><strong>${r.name}</strong> — ${said}` +
        ` <span>(${r.attempts.map((a) => a.total).join(", ")})</span></li>`;
    }).join("")}</ul>`,
    rolls: results.flatMap((r) => (r.attempts ?? []).map((a) => a.roll)),
  });

  return results;
}

/** Names this module answers to, for a caller binding its own UI. */
export const OBSTACLE_KEYS = Object.keys(OBSTACLES);
export { MODULE_ID };
