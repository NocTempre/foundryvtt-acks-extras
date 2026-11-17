/* global game, Roll */
/**
 * Obstacles the party has to get past one member at a time (RR ch. 6, the
 * Spelunking tables): a wall to climb, a rope to rappel, a ledge to edge along.
 *
 * Each obstacle answers four independent questions:
 *
 *  - **may an ordinary adventurer try at all, and against what target?** Read
 *    from the `spelunking` registered table (`adventuringTarget`);
 *  - **what does a failed throw cost?** and **what does a botched one cost?**
 *    Read from the `spelunkingOutcomes` registered table (`obstacleOutcome`):
 *    the row's words, which the card prints, whether they name a fall, and
 *    whether the outcome still covers ground (`advances`). A fall ends that
 *    climber's attempt, and so does a miss that does not advance: the stretch
 *    is not covered and nothing here throws it again (`obstacleStep`). Which
 *    natural results are a botch is the grid's own row (`botchBand`);
 *  - **is the climber helpless while doing it?** The grid's own row
 *    (`obstacleVulnerable`).
 *
 * One throw per stretch of the obstacle, the stretch being the imported figure
 * (`stretchFeet`). Nothing here knows a distance, a target, a band, a
 * helplessness or an outcome: with the table not imported an ordinary
 * adventurer's attempt is reported as unknown, never rolled against a guess,
 * no natural result reads as a botch, helplessness is null, and a missed throw
 * whose outcome is not imported, or imported with no `advances`, ends that
 * climber's attempt.
 *
 * `ropeFixed` is one flag the caller sets: a rope is already fixed to the face.
 * Where it is true, `obstaclePlan` plans a sheer climb as the easy climb, for
 * the target and for the outcomes read; it changes no other obstacle.
 */
import { postToJudges } from "../lib/roll-audience.mjs";
import { citeOf } from "../lib/tables.mjs";
import { FORMATION_DOC, MODULE_ID, formationValue } from "./constants.mjs";

const LANG_PREFIX = "ACKS-FORMATION.obstacles";

/** The registered table a failed or botched throw's outcome is read from. */
export const OUTCOMES_TABLE = "spelunkingOutcomes";

/**
 * The Spelunking tables' obstacles, each with its label. The keys name the six
 * columns, in the order the grids print them (`importer/formation-binding.mjs`
 * `SPELUNKING_COLUMNS`). Every figure the grids print is read from the
 * registered tables instead: see `adventuringTarget`, `obstacleOutcome`,
 * `obstacleVulnerable` and `botchBand`.
 */
export const OBSTACLES = Object.freeze({
  easyClimb: { label: `${LANG_PREFIX}.easyClimb` },
  sheerClimb: { label: `${LANG_PREFIX}.sheerClimb` },
  rappel: { label: `${LANG_PREFIX}.rappel` },
  crawl: { label: `${LANG_PREFIX}.crawl` },
  narrowLedge: { label: `${LANG_PREFIX}.narrowLedge` },
  precariousLedge: { label: `${LANG_PREFIX}.precariousLedge` },
});

/**
 * What a missed throw costs at this obstacle: `which` is `"fail"` for a failed
 * throw and `"botch"` for a natural result inside the obstacle's botch band
 * (`botchBand`). Answers `{text, falls, advances?}` — the
 * words the card prints, whether they end the attempt, and whether the outcome
 * still covers ground — or null until the table holds that outcome. A Judge's
 * override with no words reads as not imported. `advances` is present only
 * where the table says it with a boolean; absent, `obstacleStep` reads the
 * outcome as one that does not advance.
 *
 * @param {string} kind a key of OBSTACLES
 * @param {"fail"|"botch"} which
 * @returns {{text: string, falls: boolean, advances?: boolean}|null}
 */
export function obstacleOutcome(kind, which) {
  const cell = formationValue(OUTCOMES_TABLE)?.[kind]?.[which];
  const text = typeof cell?.text === "string" ? cell.text.trim() : "";
  if (!text) return null;
  const out = { text, falls: cell.falls === true };
  if (typeof cell.advances === "boolean") out.advances = cell.advances;
  return out;
}

/**
 * Where an outcome came from, for its tooltip: the page the table was imported
 * from, a Judge's override (which holds no page), or an empty string while
 * nothing is imported.
 * @param {{text: string}|null} outcome an `obstacleOutcome` result
 */
export function outcomeProvenance(outcome) {
  if (!outcome) return "";
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

/**
 * Whether the climber is helpless while crossing this obstacle: the grid's
 * own row, or null until the table holds it. Only a boolean counts, so a
 * Judge's override that is no boolean reads as not imported.
 *
 * @param {string} kind a key of OBSTACLES
 * @returns {boolean|null}
 */
export function obstacleVulnerable(kind) {
  const cell = formationValue("spelunking")?.vulnerable?.[kind];
  return typeof cell === "boolean" ? cell : null;
}

/**
 * The natural results of the throw that are a botch at this obstacle, the
 * grid's own row: `{min, max}`, or null until the table holds it. Only a pair
 * of whole numbers from 1 up, the first not above the second, counts; a single
 * face is a band with both ends the same.
 *
 * @param {string} kind a key of OBSTACLES
 * @returns {{min: number, max: number}|null}
 */
export function botchBand(kind) {
  const cell = formationValue("spelunking")?.botchBand?.[kind];
  const whole = (v) => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return Number.isInteger(n) ? n : null;
  };
  const min = whole(cell?.min);
  const max = whole(cell?.max);
  return min !== null && max !== null && min >= 1 && max >= min ? { min, max } : null;
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
 * @param {boolean} o.ropeFixed   a rope is fixed to the face
 * @returns {{permitted: boolean, target: number|null, reason: string|null, obstacle: object}}
 */
export function obstaclePlan({ kind, proficient = false, classThrow = null, ropeFixed = false } = {}) {
  // A fixed rope turns the sheer climb into the easy one; it changes no other obstacle.
  const effective = ropeFixed && kind === "sheerClimb" ? "easyClimb" : kind;
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
 * fall and on an outcome nobody imported. Whether a miss that names no fall
 * still covers ground is not in `ends`; `obstacleStep` answers it.
 *
 * The natural result is read before the target: a result inside the obstacle's
 * imported botch band is a miss whatever the total reaches, and reads the
 * botch row. With no band imported no natural result is a botch and the target
 * alone decides the miss. `vulnerable` is the obstacle's imported helplessness,
 * null while not imported.
 */
export function readThrow({ plan, natural, total }) {
  if (!plan?.permitted || plan.target == null) return { ok: false, outcome: null };
  const kind = plan.effective ?? plan.kind;
  const vulnerable = obstacleVulnerable(kind);
  const band = botchBand(kind);
  const botch = band !== null && Number.isFinite(natural) && natural >= band.min && natural <= band.max;
  const success = !botch && total >= plan.target;
  if (success) return { ok: true, success: true, outcome: "progress", ends: false, vulnerable };
  const outcome = obstacleOutcome(kind, botch ? "botch" : "fail");
  return {
    ok: true,
    success: false,
    outcome,
    ends: outcome == null || outcome.falls,
    botch,
    vulnerable,
  };
}

/**
 * Where one throw leaves a member on the obstacle. Pure: it counts stretches
 * and reads the throw, and knows no distance and no table.
 *
 * - `fell`: the miss names a fall; the stretch is not covered.
 * - `covered`: a stretch is made (a make, or a miss whose outcome says it
 *   `advances`) with more to go.
 * - `across`: the stretch made was the last.
 * - `stalled`: a miss that does not advance, or whose outcome is not imported,
 *   or has no `advances`; the stretch is not covered and the attempt ends
 *   without a throw again.
 *
 * @param {object} o
 * @param {number} [o.covered] stretches covered before this throw
 * @param {number} o.stretches stretches the obstacle takes
 * @param {object} o.read a `readThrow` result
 * @returns {{step: "covered"|"across"|"fell"|"stalled", covered: number}}
 */
export function obstacleStep({ covered = 0, stretches, read } = {}) {
  const so = Math.max(0, Number(covered) || 0);
  if (!read?.ok) return { step: "stalled", covered: so };
  if (!read.success) {
    if (read.outcome?.falls === true) return { step: "fell", covered: so };
    if (read.outcome?.advances !== true) return { step: "stalled", covered: so };
  }
  const now = so + 1;
  return { step: now >= stretches ? "across" : "covered", covered: now };
}

/**
 * Send a party at an obstacle, one member at a time, and report what happened
 * to each. Members who may not attempt it at all are listed as such rather
 * than rolled for. A member's row carries `covered`, the stretches made, and
 * `across`, whether the last was; each attempt carries its `step`.
 *
 * The length is the obstacle's, in feet; left out it is one stretch of the
 * imported table. With the stretch not imported no throw count can be made, so
 * every member is listed as unable to attempt it, naming the table.
 *
 * @param {Array<{actor: Actor, proficient?: boolean, classThrow?: number}>} members
 */
export async function attemptObstacle(members, { kind, ropeFixed = false, feet = stretchFeet() } = {}) {
  const throws = throwsFor(feet);
  const results = [];

  for (const m of members) {
    const plan = throws === null
      ? { permitted: false, target: null, reason: "notImported", obstacle: OBSTACLES[kind] ?? null }
      : obstaclePlan({ kind, proficient: m.proficient, classThrow: m.classThrow, ropeFixed });
    if (!plan.permitted || plan.target == null) {
      results.push({ name: m.actor?.name, plan, blocked: true });
      continue;
    }
    // Every stretch is its own throw. A fall ends the climb, and so does a miss
    // that covers no ground: that stretch is not thrown again.
    const attempts = [];
    let covered = 0;
    let across = false;
    for (let i = 0; i < throws; i++) {
      const roll = await new Roll("1d20").evaluate();
      const natural = roll.dice[0]?.results?.[0]?.result ?? roll.total;
      const read = readThrow({ plan, natural, total: roll.total });
      const stepped = obstacleStep({ covered, stretches: throws, read });
      covered = stepped.covered;
      across = stepped.step === "across";
      attempts.push({ ...read, step: stepped.step, natural, total: roll.total, roll });
      if (stepped.step === "fell" || stepped.step === "stalled" || across) break;
    }
    results.push({ name: m.actor?.name, plan, attempts, covered, across, blocked: false });
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
        // A table nobody imported gives the refusal no words.
        const why = r.plan.reason === "notImported" ? "" : game.i18n.localize(`${LANG_PREFIX}.reason.${r.plan.reason}`);
        return `<li><strong>${r.name}</strong>${why ? ` — ${why}` : ""}</li>`;
      }
      const last = r.attempts[r.attempts.length - 1];
      // The imported words are free text from the Judge's book or override, so
      // they are escaped; the tooltip says which of the two, and is empty
      // while nothing is imported.
      const said = last.success
        ? game.i18n.localize(`${LANG_PREFIX}.outcome.progress`)
        : `<span data-tooltip-text="${foundry.utils.escapeHTML(outcomeProvenance(last.outcome))}">`
          + `${foundry.utils.escapeHTML(last.outcome?.text ?? game.i18n.localize(`${LANG_PREFIX}.outcome.missed`))}</span>`;
      // A face of several stretches says how far a member who is not across got.
      const reach = throws > 1 && !r.across
        ? ` <span>${game.i18n.format(`${LANG_PREFIX}.covered`, { covered: r.covered, stretches: throws })}</span>`
        : "";
      return `<li><strong>${r.name}</strong> — ${said}` +
        ` <span>(${r.attempts.map((a) => a.total).join(", ")})</span>${reach}</li>`;
    }).join("")}</ul>`,
    rolls: results.flatMap((r) => (r.attempts ?? []).map((a) => a.roll)),
  });

  return results;
}

/** Names this module answers to, for a caller binding its own UI. */
export const OBSTACLE_KEYS = Object.keys(OBSTACLES);
export { MODULE_ID };
