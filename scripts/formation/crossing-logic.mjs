/**
 * The crossing's rules as arithmetic: no dice, no documents, no Foundry. A
 * crossing sends the party over one obstacle or one gap, a member at a time
 * (RR ch. 6, Spelunking and Jumping and Leaping). `crossing.mjs` supplies the
 * flag, the roll and the card; this file answers what a row may do, what a
 * landing asks for and costs, where a throw leaves a member, how far a fall is,
 * and where a rolled jump leaves a jumper (`jumpResult`) and what a jumper
 * hanging at the edge climbs (`climbUpRow`), and what the water asks of a
 * swimmer each round (`swimRow`).
 *
 * Every figure comes from the readers `obstacles.mjs`, `jumping.mjs` and
 * `swimming.mjs` hold,
 * so nothing here is a printed value. A figure the world has not imported
 * answers null and is named in `unknown`; the row is refused, never rolled
 * against a guess.
 *
 * A refusal has one of three classes, and the class decides who it stops:
 *
 *  - `seat`: the seat cannot press this row. Not the member's owner (binds a
 *    player only), a member whose crossing is over (`across`, `fell`: nothing
 *    is left to throw), and, for a player, a member who is down, left behind,
 *    detached or stalled. It stops the seat it names.
 *  - `absence`: a figure the answer rests on was never imported or never
 *    resolved. It stops every seat, a Judge included, because proceeding
 *    would roll against a guess.
 *  - `permission`: the table says this member may not try, a jump cannot
 *    reach, or, for a Judge, the member is down, left behind, detached or
 *    stalled. It stops a player and warns a Judge, whose throw proceeds on the
 *    member's own figure and is marked as thrown over a refusal.
 *
 * When more than one applies the row reports the first of that order.
 */
import { OBSTACLES, obstaclePlan, obstacleStep, stretchFeet, throwsFor } from "./obstacles.mjs";
import { canClear, fallFigures, landingFailure, landingSave } from "./jumping.mjs";
import { pitDamage } from "./trap-rules.mjs";
import { carriedBody } from "./constants.mjs";
import {
  breathRounds, drowning, rescueStone, sinkFeetPerStone, swimSpeed as paceOf, swimSpeedShare, swimmingThrow, waterPenaltyAllowed,
} from "./swimming.mjs";

/**
 * The climb's party-check configuration, local to the crossing. It carries
 * what `resolveCheck` reads: a holder of Climbing throws the proficiency's own
 * figure, anyone else the actor's own Adventuring figure for climbing. It is
 * not a `PARTY_CHECKS` entry, so no other consumer of that table (the skill
 * audit, the party roll) picks up a climb.
 */
export const CLIMB_CHECK = Object.freeze({
  flagKey: "climb",
  capability: "kw:climbing",
  rollKey: "climb",
  advKey: "climb",
  pattern: /climbing/i,
});

/** The refusal classes, in the order a row reports them. */
export const REFUSAL = Object.freeze({ seat: "seat", absence: "absence", permission: "permission" });

/** The states of a member's crossing that leave nothing to throw, for every seat. */
export const SETTLED = Object.freeze(["across", "fell"]);

/** The state of a member whose last miss covered no ground; a Judge may rule a re-throw. */
export const STALLED = "stalled";

/** The state of a jumper at the gap's edge, hanging, who has a climb up to make. */
export const HANGING = "hanging";

/** The state of a jumper whose distance is rolled and whose landing save is not: the save is what is left to make. */
export const LANDING = "landing";

/**
 * The obstacle a hanging jumper's climb up is thrown on. Spelunking prints no
 * column for climbing back up from an edge, so this is the crossing's own
 * reading: the face under the jumper's hands is a sheer one, which a fixed rope
 * (`ropeFixed`) makes the easy climb. One place, so a ruling that names another
 * obstacle changes one line.
 */
export const HANG_CLIMB = "sheerClimb";

/**
 * The statuses a crossing can hold on a member while they are on an obstacle.
 * Each is read from a figure the Spelunking grid carries; a status the grid
 * does not give is not held. `vulnerable` keeps the first slot of the held
 * condition's id; a swimmer whose throw failed holds `drowning`, and the
 * condition catalogue's own closure adds Vulnerable to it.
 */
export const CROSSING_STATUSES = Object.freeze(["vulnerable", "drowning"]);

/**
 * The held condition one crossing keeps for one status: its holder names the
 * crossing and the status, so a release takes off what this crossing put there
 * and nothing else, and two statuses under one crossing stand as two effects.
 * The effect's `_id` is 16 letters and digits, unique to the pair.
 *
 * @param {string} crossingId the crossing's id
 * @param {string} statusId one of `CROSSING_STATUSES`
 * @returns {{holder: string, statusId: string, id: string}}
 */
export function crossingHeld(crossingId, statusId) {
  const slot = Math.max(0, CROSSING_STATUSES.indexOf(statusId));
  const id = `c${slot}${String(crossingId).replace(/[^A-Za-z0-9]/g, "")}`.padEnd(16, "0").slice(0, 16);
  return { holder: `crossing:${crossingId}:${statusId}`, statusId, id };
}

/** The crossing id a holder string names, or null for a holder that is no crossing's. */
export function crossingOfHolder(holder) {
  const match = /^crossing:(.+):[^:]+$/.exec(String(holder ?? ""));
  return match ? match[1] : null;
}

/**
 * The statuses a member holds after a throw: while they are still on the
 * obstacle (`climbing`, `stalled`), the ones the grid names for it; once they
 * are across or fell, none. A figure nobody imported (`vulnerable` null) holds
 * nothing.
 *
 * @param {object} o
 * @param {string} o.state the member's state after the throw
 * @param {boolean|null} [o.vulnerable] `readThrow`'s `vulnerable`
 * @returns {string[]} members of `CROSSING_STATUSES`
 */
export function heldAfter({ state, vulnerable = null } = {}) {
  if (state === DROWNING) return ["drowning"];
  if (SETTLED.includes(state)) return [];
  return vulnerable === true ? ["vulnerable"] : [];
}

/** The obstacles a fall is figured on the climb's own progress. */
const CLIMBS = Object.freeze(["easyClimb", "sheerClimb", "rappel"]);

/**
 * What a seat may do with a row, from the refusals found. `refusals` are
 * `{cls, reason}`; the first of the class order is reported. `can` says whether
 * this seat may go ahead and `warn` whether it does so over a permission
 * refusal.
 */
function settle(refusals, judge) {
  const first = (cls) => refusals.find((r) => r.cls === cls) ?? null;
  const refusal = first(REFUSAL.seat) ?? first(REFUSAL.absence) ?? first(REFUSAL.permission);
  const over = refusal?.cls === REFUSAL.permission && !!judge;
  return { refusal, can: !refusal || over, warn: over };
}

/**
 * The refusals from who the seat is and where the member stands. A member who
 * is down, left behind, detached or stalled blocks a player (seat class, which
 * the GM client re-checks) and warns a Judge (permission class).
 */
function seatRefusals({ seat, standing, state }) {
  const out = [];
  const standingCls = seat?.judge ? REFUSAL.permission : REFUSAL.seat;
  if (!seat?.judge && !seat?.owns) out.push({ cls: REFUSAL.seat, reason: "notOwner" });
  if (standing) out.push({ cls: standingCls, reason: String(standing) });
  if (state === STALLED) out.push({ cls: standingCls, reason: STALLED });
  if (SETTLED.includes(state)) out.push({ cls: REFUSAL.seat, reason: state });
  return out;
}

/**
 * One member's row at an obstacle: what may be pressed from this seat, against
 * what, and why not.
 *
 * The member's own figure is the target, held by a Climbing holder or not. The
 * table's Adventuring column is read only for whether the member may try; the
 * number it holds is not the member's.
 *
 * @param {object} o
 * @param {string} o.kind a key of OBSTACLES
 * @param {boolean} [o.ropeFixed] a rope is fixed to the face
 * @param {number|string|null} [o.feet] the obstacle's length; blank is one stretch
 * @param {boolean} [o.holds] the member holds Climbing
 * @param {{target: number|null, parts?: object[]}|null} [o.figure] the member's
 *   `resolveCheck` result for `CLIMB_CHECK`, null when none resolved
 * @param {number} [o.judgeMod] the Judge's throw modifier; positive lowers the target
 * @param {{judge?: boolean, owns?: boolean}} [o.seat] who is pressing
 * @param {string|null} [o.standing] `down`, `leftBehind` or `detached`, else null
 * @param {{state?: string, covered?: number, throws?: number}|null} [o.member] the member's crossing record
 * @returns {{kind: string, effective: string|null, stretches: number|null, target: number|null,
 *   judgeMod: number, parts: object[], covered: number, throws: number, state: string,
 *   refusal: {cls: string, reason: string}|null, can: boolean, warn: boolean,
 *   plan: object|null, unknown: string[]}}
 *   `plan` is what `readThrow` takes and is null while `can` is false; its
 *   `overRefusal` is true where a Judge goes ahead over a permission refusal.
 *   `unknown` names each figure missing: `stretchFeet`, `spelunking`, `figure`.
 */
export function memberRow({
  kind, ropeFixed = false, feet = null, holds = false, figure = null, judgeMod = 0, seat = {}, standing = null, member = null,
} = {}) {
  const state = member?.state ?? "climbing";
  const stretches = throwsFor(feet);
  const own = Number.isFinite(figure?.target) ? figure.target : null;
  const mod = Number(judgeMod) || 0;
  const base = obstaclePlan({ kind, proficient: holds, classThrow: own, ropeFixed });

  const unknown = [];
  const refusals = seatRefusals({ seat, standing, state });
  if (stretches === null) {
    refusals.push({ cls: REFUSAL.absence, reason: "stretch" });
    unknown.push("stretchFeet");
  }
  if (base.reason === "unknown") refusals.push({ cls: REFUSAL.absence, reason: "kind" });
  if (base.reason === "notImported") {
    refusals.push({ cls: REFUSAL.absence, reason: "table" });
    unknown.push("spelunking");
  }
  if (own === null && base.reason !== "unknown") {
    refusals.push({ cls: REFUSAL.absence, reason: "figure" });
    unknown.push("figure");
  }
  if (base.reason === "notPermitted") refusals.push({ cls: REFUSAL.permission, reason: "notPermitted" });

  const { refusal, can, warn } = settle(refusals, seat?.judge);
  const target = own === null ? null : own - mod;
  const effective = base.effective ?? null;
  return {
    kind,
    effective,
    stretches,
    target,
    judgeMod: mod,
    parts: figure?.parts ?? [],
    covered: Math.max(0, Number(member?.covered) || 0),
    throws: Math.max(0, Number(member?.throws) || 0),
    state,
    refusal,
    can,
    warn,
    plan: can ? { kind, effective, obstacle: base.obstacle, permitted: true, target, reason: null, overRefusal: warn } : null,
    unknown,
  };
}

/**
 * Where one throw leaves a member: `obstacleStep` on the member's record. The
 * record is `{state, covered, throws, last}`, `state` being `climbing` while
 * the member is on the obstacle, `across` or `fell` once nothing is left to
 * throw, and `stalled` after a miss that covered no ground. A stalled member's
 * throw, which a Judge's ruling brings in, continues from the stretches
 * covered. A member who is across or fell takes no step and comes back as they
 * stood; a stretch count that is no count stalls the member.
 *
 * @param {object} o
 * @param {{state?: string, covered?: number, throws?: number, last?: object}|null} [o.member]
 * @param {number|null} o.stretches stretches the obstacle takes
 * @param {object} o.read a `readThrow` result
 * @param {number} [o.natural] the die's face, kept in `last`
 * @param {number} [o.total] the throw's total, kept in `last`
 * @returns {{state: string, covered: number, throws: number, last: object|null}}
 */
export function stepMember({ member = null, stretches = null, read = null, natural = null, total = null } = {}) {
  const covered = Math.max(0, Number(member?.covered) || 0);
  const throws = Math.max(0, Number(member?.throws) || 0);
  const kept = { state: member?.state ?? "climbing", covered, throws, last: member?.last ?? null };
  if (SETTLED.includes(kept.state)) return kept;
  const count = Number(stretches);
  if (!(count > 0)) return { ...kept, state: STALLED, throws: throws + 1 };
  const stepped = obstacleStep({ covered, stretches: count, read });
  return {
    state: stepped.step === "covered" ? "climbing" : stepped.step,
    covered: stepped.covered,
    throws: throws + 1,
    last: {
      natural: Number.isFinite(natural) ? natural : null,
      total: Number.isFinite(total) ? total : null,
      success: read?.success === true,
      botch: read?.botch === true,
      outcome: read?.outcome?.text ?? null,
    },
  };
}

/**
 * How far a member falls, and what the fall deals.
 *
 * On a climb or a rappel the distance is the stretches made times the stretch,
 * plus half the stretch in progress (RR ch. 6, Spelunking). The stretch in
 * progress is the imported one, or the part of the length left where the length
 * is not a whole number of stretches. Any other way across has no height of its
 * own, so the distance is the depth the Judge gives.
 *
 * `feet` and `damage` are null with the missing figure named in `unknown`
 * (`stretchFeet`, `depth`, `fall`) while any figure the answer rests on is
 * absent; a fall too short to deal a die has a distance and no damage.
 *
 * @param {object} o
 * @param {string} o.kind the obstacle as planned (`plan.effective`)
 * @param {number} [o.covered] stretches made before the throw that failed
 * @param {number|string|null} [o.feet] the obstacle's length; blank is one stretch
 * @param {number|string|null} [o.depth] the Judge's depth, for a way across that has none of its own
 * @returns {{feet: number|null, damage: string|null, unknown: string[], parts: Array<{key: string, value: number}>}}
 */
export function fallFromClimb({ kind, covered = 0, feet = null, depth = null } = {}) {
  if (!OBSTACLES[kind]) return { feet: null, damage: null, unknown: ["kind"], parts: [] };
  const unknown = [];
  const parts = [];
  let drop = null;
  if (CLIMBS.includes(kind)) {
    const stretch = stretchFeet();
    if (stretch === null) unknown.push("stretchFeet");
    else {
      const done = Math.max(0, Number(covered) || 0) * stretch;
      const length = Number(feet) > 0 ? Number(feet) : stretch;
      const attempted = Math.min(stretch, Math.max(0, length - done));
      parts.push({ key: "covered", value: done }, { key: "midpoint", value: attempted / 2 });
      drop = done + attempted / 2;
    }
  } else if (Number(depth) > 0) {
    drop = Number(depth);
    parts.push({ key: "depth", value: drop });
  } else {
    unknown.push("depth");
  }
  if (drop === null) return { feet: null, damage: null, unknown, parts };
  const dealt = pitDamage(drop, false, { fall: fallFigures(), spike: null });
  return { feet: drop, damage: dealt.formula, unknown: [...unknown, ...dealt.unknown], parts };
}

/**
 * What a fall over empty space deals when its distance is the depth the Judge
 * gave: the fall `landingOutcome` reports for the empty footing, without the
 * shortfall die, which only a landing that slipped rolls. A blank depth reads
 * unknown and nothing is dealt.
 *
 * @param {number|string|null} depth the drop, in feet
 * @returns {{feet: number|null, damage: string|null, unknown: string[], parts: Array<{key: string, value: number}>}}
 */
export function fallFromDepth(depth = null) {
  const out = landingOutcome({ footing: "empty", depth });
  const drop = Number(depth) > 0 ? Number(depth) : null;
  return { feet: out.feet, damage: out.damage, unknown: out.unknown.filter((key) => key !== "shortfallDie"), parts: drop ? [{ key: "depth", value: drop }] : [] };
}

/**
 * One member's row against a gap: `canClear`'s answer whole, with what this
 * seat may do about it. An unreachable gap is a permission refusal, so a Judge
 * is warned and a player is stopped; a jump whose figures are not imported is an
 * absence refusal and stops every seat.
 *
 * @param {number} gapFeet the distance to be cleared
 * @param {object} [o]
 * @param {object} [o.options] `canClear`'s options: dex, encumbrance, acrobatics, level, dexCap, runningStart, runSpeed
 * @param {{judge?: boolean, owns?: boolean}} [o.seat] who is pressing
 * @param {string|null} [o.standing] `down`, `leftBehind` or `detached`, else null
 * @param {{state?: string, jump?: {footing?: string}}|null} [o.member] the member's crossing record; a jumper who is
 *   across or fell has nothing left to jump, and one hanging at the edge climbs up (`climbUpRow`) instead
 * @returns {object} the `canClear` result with `refusal`, `can` and `warn`
 */
export function jumpRow(gapFeet, { options = {}, seat = {}, standing = null, member = null } = {}) {
  const cleared = canClear(gapFeet, options);
  const refusals = seatRefusals({ seat, standing, state: SETTLED.includes(member?.state) ? member.state : null });
  if (isHanging(member) && !SETTLED.includes(member?.state)) refusals.push({ cls: REFUSAL.seat, reason: HANGING });
  if (cleared.verdict === "unknown") refusals.push({ cls: REFUSAL.absence, reason: "jump" });
  if (cleared.verdict === "impossible") refusals.push({ cls: REFUSAL.permission, reason: "impossible" });
  return { ...cleared, ...settle(refusals, seat?.judge) };
}

/**
 * What a jump row offers about the landing: `landingSave`'s answer, and whether
 * the row's own refusals let a seat press it. A plain landing asks for no
 * throw, so nothing is offered; a precarious one, or a charging jump, asks for
 * the save. The save inherits the row's refusals whole: an unknown jump stops
 * every seat, an unreachable gap warns a Judge and stops a player.
 *
 * @param {{can: boolean, warn: boolean}} row a `jumpRow` result
 * @param {object} [o]
 * @param {boolean} [o.precarious] the setup marks the far side precarious
 * @param {boolean} [o.charging] the jump is made charging
 * @param {boolean} [o.acrobatics] the member holds Acrobatics
 * @param {number} [o.saveBonus] what Acrobatics is worth to the save, passed in
 * @returns {{needed: boolean, save: string, bonus: number, can: boolean, warn: boolean}}
 */
export function landingRow(row, { precarious = false, charging = false, acrobatics = false, saveBonus = 0 } = {}) {
  const asked = landingSave({ precarious, charging, acrobatics, saveBonus });
  return { ...asked, can: asked.needed && !!row?.can, warn: asked.needed && !!row?.can && !!row?.warn };
}

/** The footings a Judge picks after a failed landing, in the order a pick lists them. */
export const FOOTINGS = Object.freeze(["solid", "edge", "empty"]);

/** The state each footing leaves a jumper in: on solid ground across, on the edge hanging, over empty space fell. */
export const FOOTING_STATE = Object.freeze({ solid: "across", edge: HANGING, empty: "fell" });

/**
 * What a failed landing costs on the footing the Judge picked: `landingFailure`
 * whole, with the footing and the fall's distance beside it. A footing that is
 * no footing answers null. A fall over empty space with no depth given has no
 * distance and names `depth` in `unknown`; nothing is rolled and no hit point
 * moves here.
 *
 * @param {object} o
 * @param {string} o.footing one of `FOOTINGS`
 * @param {number|string|null} [o.depth] the drop under a fall, in feet
 * @returns {{footing: string, outcome: string, shortBy: string|null, damage: string|null, feet: number|null, unknown: string[]}|null}
 */
export function landingOutcome({ footing, depth = null } = {}) {
  if (!FOOTINGS.includes(footing)) return null;
  const drop = Number(depth) > 0 ? Number(depth) : 0;
  const failure = landingFailure(footing, drop);
  const falls = failure.outcome === "fall";
  return {
    footing,
    ...failure,
    feet: falls && drop > 0 ? drop : null,
    unknown: falls && !drop ? [...failure.unknown, "depth"] : failure.unknown,
  };
}

/**
 * Whether a member's record is a jumper hanging at the gap's edge with a climb
 * up still to make: `hanging`, or `stalled` after a climb up that covered no
 * ground. A jumper who is across or fell is not.
 *
 * @param {{state?: string, jump?: {footing?: string}}|null} [member] the member's crossing record
 */
export function isHanging(member) {
  if (!member || SETTLED.includes(member.state)) return false;
  return member.state === HANGING || (member.state === STALLED && member.jump?.footing === "edge");
}

/**
 * A hanging jumper's row for the climb up: `memberRow` on `HANG_CLIMB`, one
 * stretch long (a blank length is one), the jumper's own figure the target and
 * a stalled climb up read as a stalled member. Everything `memberRow` answers
 * stands: the table's refusals, the three classes and the Judge's warning.
 *
 * @param {object} o
 * @param {boolean} [o.ropeFixed] a rope is fixed to the face
 * @param {boolean} [o.holds] the member holds Climbing
 * @param {{target: number|null, parts?: object[]}|null} [o.figure] `resolveCheck` for `CLIMB_CHECK`
 * @param {{judge?: boolean, owns?: boolean}} [o.seat] who is pressing
 * @param {string|null} [o.standing] `down`, `leftBehind` or `detached`, else null
 * @param {{state?: string, throws?: number}|null} [o.member] the member's crossing record
 * @returns {object} a `memberRow` result
 */
export function climbUpRow({ ropeFixed = false, holds = false, figure = null, seat = {}, standing = null, member = null } = {}) {
  return memberRow({
    kind: HANG_CLIMB,
    ropeFixed,
    feet: null,
    holds,
    figure,
    seat,
    standing,
    member: { state: member?.state === STALLED ? STALLED : "climbing", covered: 0, throws: member?.throws ?? 0 },
  });
}

/**
 * Where a rolled jump leaves the jumper, from the distance the die gave, the
 * gap, the landing save (where one was asked) and the feet a failed landing
 * fell short by.
 *
 * A distance that reaches the gap lands, and with no save asked, or one made,
 * the jumper is across. A distance that does not reach it falls short of the
 * far side by the difference and over empty space. A failed landing slips back
 * by the shortfall, and where that leaves the jumper against the far edge is
 * the footing: past it, solid ground and prone; exactly on it, the edge and
 * hanging; short of it, empty space and a fall, whose distance is the
 * Judge's depth. Footing names and what each costs are `landingFailure`'s.
 *
 * `footing` is null where the jumper is across clean, or where the failed
 * landing's slip was not rolled (`unknown` names the shortfall die). A short
 * jump rolls no save and no slip, so its `unknown` never names the die.
 *
 * @param {object} o
 * @param {number} o.gap the distance to be cleared, in feet
 * @param {number} o.distance the distance the die gave, in feet
 * @param {{passed: boolean}|null} [o.save] the landing save, null where none was asked
 * @param {number|null} [o.slip] the feet a failed landing fell short by
 * @param {number|string|null} [o.depth] the drop under a fall, in feet
 * @returns {{gap: number, distance: number, clears: boolean, shortBy: number, saved: boolean|null, slip: number|null,
 *   position: number|null, footing: string|null, outcome: string|null, state: string,
 *   feet: number|null, damage: string|null, unknown: string[]}|null} null where the gap or the distance is no figure
 */
export function jumpResult({ gap, distance, save = null, slip = null, depth = null } = {}) {
  const need = Number(gap);
  const reach = distance === null || distance === undefined ? NaN : Number(distance);
  if (!(need > 0) || !Number.isFinite(reach)) return null;
  const clears = reach >= need;
  const base = { gap: need, distance: reach, clears, shortBy: clears ? 0 : need - reach, saved: save ? save.passed === true : null };
  const across = { slip: null, position: reach - need, footing: null, outcome: null, state: "across", feet: null, damage: null, unknown: [] };
  if (clears && (!save || save.passed)) return { ...base, ...across };
  const slipped = clears ? (slip === null || slip === undefined ? NaN : Number(slip)) : 0;
  if (!Number.isFinite(slipped)) {
    return { ...base, ...across, state: LANDING, position: null, unknown: ["shortfallDie"] };
  }
  const position = reach - slipped - need;
  const footing = Math.abs(position) < 1e-9 ? "edge" : position > 0 ? "solid" : "empty";
  const failure = landingOutcome({ footing, depth });
  return {
    ...base,
    slip: clears ? slipped : null,
    position,
    footing,
    outcome: failure.outcome,
    state: FOOTING_STATE[footing],
    feet: failure.feet,
    damage: failure.damage,
    unknown: clears ? failure.unknown : failure.unknown.filter((key) => key !== "shortfallDie"),
  };
}

/**
 * A `jumpResult` with the footing a Judge picked in place of the one the
 * attempt reached: the footing, what it costs and the state it implies, with
 * the distance, the slip and the position left as rolled. A result that is no
 * result, or a footing that is no footing, comes back unchanged.
 *
 * @param {object|null} result a `jumpResult` answer
 * @param {string|null} footing one of `FOOTINGS`
 * @param {number|string|null} [depth] the drop under a fall, in feet
 * @returns {object|null}
 */
export function withFooting(result, footing, depth = null) {
  const failure = landingOutcome({ footing, depth });
  if (!result || !failure) return result;
  return {
    ...result,
    footing,
    outcome: failure.outcome,
    state: FOOTING_STATE[footing],
    feet: failure.feet,
    damage: failure.damage,
    unknown: failure.unknown.filter((key) => key !== "shortfallDie"),
  };
}

/** Whether a stamp `{combatId, round}` is this turn's: the same fight and the same round. */
export const sameTurn = (stamp, turn) => !!stamp && !!turn && stamp.combatId === turn.combatId && stamp.round === turn.round;

/** Whether a stamp is no later than this turn: the same fight, and a round that has not moved past the stamp's. */
export const notLater = (stamp, turn) => !!stamp && !!turn && stamp.combatId === turn.combatId && turn.round <= stamp.round;

/** The state of a swimmer who is afloat, with a throw to make each round. */
export const SWIMMING = "swimming";

/** The state of a swimmer whose throw failed: no actions, no more throws, sinking until rescued or out of breath. */
export const DROWNING = "drowning";

/**
 * One swimmer's row for the round: the throw the water asks, the pace a success
 * allows, what drowning would cost and, for a member who is drowning, what a
 * rescuer lifts.
 *
 * A creature with a swim speed of its own takes no throw (`skip` is `swimSpeed`)
 * and paces at that speed. A holder of Swimming whose target reaches nothing
 * takes none either (`skip` is `proficiency`); anyone else with a target of
 * nothing still throws. A drowning member takes no throw and no pace. `can`
 * says a throw may be pressed from this seat, which a skipped row never offers.
 *
 * A holder's bonus that is not imported is an absence refusal, so no throw is
 * rolled against a guess. A water penalty the page does not let a Judge set
 * (`waterPenaltyAllowed`) is a permission refusal: a player is stopped and a
 * Judge is warned. Every other figure is null on its own, with the missing
 * import named in that figure's own `unknown`, and refuses nothing. Each figure
 * carries the parts a tooltip lists, as `{key, value}` pairs the surface names
 * and cites.
 *
 * @param {object} o
 * @param {number|null} [o.encumbrance] the stone the member carries; null is a figure
 *   nobody has (a creature that carries nothing the module reads), an absence refusal
 * @param {boolean} [o.holds] the member holds Swimming
 * @param {{combat: number|null, run: number|null}|null} [o.own] the member's own
 *   swim speed (`ownSwimSpeed`)
 * @param {{combat?: number, run?: number}} [o.speeds] the member's combat and
 *   running speed in feet, whose share a swimmer makes
 * @param {number} [o.conMod] the member's Constitution modifier, for their breath
 * @param {number|string|null} [o.penalty] the water penalty as a size
 * @param {string[]} [o.conditions] keys of `WATER` ticked as its reason
 * @param {number} [o.judgeMod] the Judge's modifier to the target
 * @param {{stone: number|null}|null} [o.hauled] the body this member is carrying
 *   to the surface (`rescueStone`), added to what they carry; null stone is a
 *   figure not imported
 * @param {{combatId: string, round: number}|null} [o.turn] the round the throw is for, where a
 *   fight is running; a member whose `thrownAt` is this turn has no throw left
 * @param {{judge?: boolean, owns?: boolean}} [o.seat] who is pressing
 * @param {string|null} [o.standing] `down`, `leftBehind` or `detached`, else null
 * @param {{state?: string, drownedRounds?: number}|null} [o.member] the member's
 *   crossing record; `drownedRounds` is the rounds spent drowning so far
 * @returns {{kind: string, state: string, skip: string|null, target: number|null, needed: boolean|null,
 *   penalty: number, conditions: string[], parts: object[], refusal: {cls: string, reason: string}|null,
 *   can: boolean, warn: boolean, plan: object|null, unknown: string[],
 *   pace: {combat: number|null, run: number|null, share: number|null, own: boolean,
 *     parts: {combat: object[], run: object[]}, unknown: string[]}|null,
 *   drown: {active: boolean, rounds: number|null, feetPerRound: number|null, depthAtDeath: number|null,
 *     elapsed: number, left: number|null, depth: number|null, parts: object[], unknown: string[]},
 *   rescue: {stone: number|null, parts: object[], unknown: string[]}|null}}
 */
export function swimRow({
  encumbrance = 0, holds = false, own = null, speeds = {}, conMod = 0, penalty = 0, conditions = [], judgeMod = 0, hauled = null, turn = null,
  seat = {}, standing = null, member = null,
} = {}) {
  const state = member?.state ?? SWIMMING;
  const sinking = state === DROWNING;
  const exempt = [own?.combat, own?.run].some((feet) => Number(feet) > 0);
  const carried = encumbrance === null ? null : Math.max(0, Number(encumbrance) || 0);
  const lifted = hauled && Number.isFinite(hauled.stone) ? Math.max(0, hauled.stone) : 0;
  const stone = (carried ?? 0) + lifted;

  const refusals = seatRefusals({ seat, standing, state });
  if (sinking) refusals.push({ cls: REFUSAL.seat, reason: DROWNING });
  else if (turn && sameTurn(member?.thrownAt, turn)) refusals.push({ cls: REFUSAL.seat, reason: "thrown" });

  const thrown = swimmingThrow({ encumbrance: stone, proficient: holds, penalty, conditions, judgeMod });
  const unknown = [];
  const water = waterPenaltyAllowed(penalty);
  if (!exempt && !sinking) {
    if (carried === null) {
      refusals.push({ cls: REFUSAL.absence, reason: "stone" });
      unknown.push("encumbrance");
    }
    if (hauled && hauled.stone === null) {
      refusals.push({ cls: REFUSAL.absence, reason: "rescue" });
      unknown.push("carriedBodyStone");
    }
    if (thrown.unknown.length) {
      refusals.push({ cls: REFUSAL.absence, reason: "bonus" });
      unknown.push(...thrown.unknown);
    }
    if (!water.ok) refusals.push({ cls: REFUSAL.permission, reason: "penalty" });
  }

  const skip = exempt ? "swimSpeed" : thrown.needed === false ? "proficiency" : null;
  const { refusal, can: allowed, warn } = settle(refusals, seat?.judge);
  const blind = carried === null || (!!hauled && hauled.stone === null);
  const needed = exempt ? false : blind ? null : thrown.needed;
  const can = allowed && needed === true && !sinking;
  const target = exempt || blind ? null : thrown.target;

  const share = swimSpeedShare();
  const paceFor = (feet) => (Number(feet) > 0 && share !== null ? paceOf(feet) : null);
  const partsFor = (feet) => (Number(feet) > 0 && share !== null ? [{ key: "speed", value: Number(feet) }, { key: "share", value: share }] : []);
  let pace = null;
  if (exempt) {
    pace = { combat: own.combat, run: own.run, share: null, own: true, parts: { combat: [], run: [] }, unknown: [] };
  } else if (!sinking) {
    pace = {
      combat: paceFor(speeds?.combat), run: paceFor(speeds?.run), share, own: false,
      parts: { combat: partsFor(speeds?.combat), run: partsFor(speeds?.run) }, unknown: share === null ? ["swimSpeedShare"] : [],
    };
  }

  const breath = drowning({ conMod, encumbrance: stone });
  const elapsed = Math.max(0, Number(member?.drownedRounds) || 0);
  const perStone = sinkFeetPerStone();
  const base = breathRounds();
  const drownUnknown = [...(base === null ? ["breathRounds"] : []), ...(perStone === null ? ["sinkFeetPerStone"] : [])];
  const drown = {
    active: sinking,
    ...breath,
    elapsed,
    left: breath.rounds === null ? null : Math.max(0, breath.rounds - elapsed),
    depth: breath.feetPerRound === null ? null : elapsed * breath.feetPerRound,
    parts: [
      ...(base === null ? [] : [{ key: "breath", value: base }, { key: "conMod", value: Number(conMod) || 0 }]),
      { key: "encumbrance", value: stone },
      ...(perStone === null ? [] : [{ key: "sink", value: perStone }]),
    ],
    unknown: drownUnknown,
  };

  let rescue = null;
  if (sinking) {
    const body = carriedBody();
    rescue = {
      stone: rescueStone(stone),
      parts: body.stone === null || body.gearShare === null
        ? []
        : [{ key: "body", value: body.stone }, { key: "gear", value: stone }, { key: "gearShare", value: body.gearShare }],
      unknown: [...(body.stone === null ? ["carriedBodyStone"] : []), ...(body.gearShare === null ? ["carriedGearShare"] : [])],
    };
  }

  return {
    kind: "swim",
    state,
    skip,
    target,
    needed,
    penalty: water.size,
    conditions: thrown.conditions,
    parts: exempt || blind ? [] : [...thrown.parts, ...(lifted ? [{ key: "hauled", value: lifted }] : [])],
    refusal,
    can,
    warn: can && warn,
    plan: can ? { target, needed: true, conditions: thrown.conditions, overRefusal: warn } : null,
    unknown,
    pace,
    drown,
    rescue,
  };
}

/**
 * Where one swimmer's throw leaves their record, as a patch: what to set, what
 * to unset, and the member a failed rescuer lets go. A success keeps the member
 * afloat. A failure makes them drowning with one round counted and, where a
 * fight is running, stamps that round so the member's own turn that round does
 * not count it again. A rescuer who fails drops the body they were lifting, so
 * the hauling link goes and the body they held is named in `released`.
 *
 * @param {object} o
 * @param {{throws?: number, hauling?: string}|null} [o.member] the member's record before the throw
 * @param {boolean} o.success the throw made its target
 * @param {number|null} [o.natural] the die's face, kept in `last`
 * @param {number|null} [o.total] the throw's total, kept in `last`
 * @param {{combatId: string, round: number}|null} [o.turn] the fight and round the throw is for, where one is running
 * @returns {{set: object, unset: string[], released: string|null}} keys of the member's record
 */
export function swimThrowStep({ member = null, success, natural = null, total = null, turn = null } = {}) {
  const throws = Math.max(0, Number(member?.throws) || 0) + 1;
  const set = { state: success ? SWIMMING : DROWNING, throws, last: { natural, total, success: !!success } };
  const unset = [];
  if (turn) set.thrownAt = { combatId: turn.combatId, round: turn.round };
  let released = null;
  if (!success) {
    set.drownedRounds = 1;
    if (turn) set.drownedAt = { combatId: turn.combatId, round: turn.round };
    else unset.push("drownedAt");
    unset.push("breathOut", "rescuer");
    if (member?.hauling) {
      unset.push("hauling");
      released = member.hauling;
    }
  }
  return { set, unset, released };
}

/**
 * What a drowning member's own turn adds: one round counted, once for each
 * round of a fight. A member who is not drowning, a turn with no fight, and a
 * turn no later than the one already counted (the Judge stepping back, the
 * tracker re-sorting) add nothing and answer null. The round the count reaches
 * the breath's last is reported once (`breathOut`), and never again.
 *
 * @param {object} o
 * @param {{state?: string, drownedRounds?: number, drownedAt?: object, breathOut?: boolean}|null} o.member
 * @param {{combatId: string, round: number}|null} o.turn
 * @param {number|null} o.rounds the member's breath in rounds (`drowning`), null until imported
 * @returns {{set: object, elapsed: number, left: number|null, breathOut: boolean}|null}
 */
export function swimTick({ member = null, turn = null, rounds = null } = {}) {
  if (member?.state !== DROWNING || !turn) return null;
  if (notLater(member.drownedAt, turn)) return null;
  const elapsed = Math.max(0, Number(member.drownedRounds) || 0) + 1;
  const left = rounds === null ? null : Math.max(0, rounds - elapsed);
  const breathOut = left === 0 && !member.breathOut;
  const set = { drownedRounds: elapsed, drownedAt: { combatId: turn.combatId, round: turn.round } };
  if (breathOut) set.breathOut = true;
  return { set, elapsed, left, breathOut };
}

/**
 * Whether a member may take a drowning member's weight, as the reason they may
 * not, or null. A rescuer is not the drowning member, not drowning themselves,
 * not down, left behind or detached, and not already carrying another.
 *
 * @param {object} o
 * @param {{actorId: string, state?: string}} o.drowner
 * @param {{actorId: string, state?: string, hauling?: string}} o.rescuer
 * @param {string|null} [o.standing] `down`, `leftBehind` or `detached` for the rescuer, else null
 * @returns {null|"notDrowning"|"self"|"drowning"|"standing"|"busy"}
 */
export function rescueRefusal({ drowner, rescuer, standing = null } = {}) {
  if (drowner?.state !== DROWNING) return "notDrowning";
  if (rescuer?.actorId === drowner.actorId) return "self";
  if (rescuer?.state === DROWNING) return "drowning";
  if (standing) return "standing";
  if (rescuer?.hauling && rescuer.hauling !== drowner.actorId) return "busy";
  return null;
}

/**
 * The patch that brings a drowning member to the surface: afloat again with no
 * rounds counted and every link and stamp of the drowning gone. The rescuer the
 * member had is named in `released`, so their hauling goes with it.
 *
 * @param {{rescuer?: string}|null} member the member's record
 * @returns {{set: object, unset: string[], released: string|null}}
 */
export function haulStep(member) {
  return { set: { state: SWIMMING, drownedRounds: 0 }, unset: ["rescuer", "drownedAt", "breathOut"], released: member?.rescuer ?? null };
}
