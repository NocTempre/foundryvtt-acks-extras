/**
 * The crossing's rules as arithmetic: no dice, no documents, no Foundry. A
 * crossing sends the party over one obstacle or one gap, a member at a time
 * (RR ch. 6, Spelunking and Jumping and Leaping). `crossing.mjs` supplies the
 * flag, the roll and the card; this file answers what a row may do, where a
 * throw leaves a member and how far a fall is.
 *
 * Every figure comes from the readers `obstacles.mjs` and `jumping.mjs` hold,
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
import { canClear, fallFigures } from "./jumping.mjs";
import { pitDamage } from "./trap-rules.mjs";

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
 * @returns {object} the `canClear` result with `refusal`, `can` and `warn`
 */
export function jumpRow(gapFeet, { options = {}, seat = {}, standing = null } = {}) {
  const cleared = canClear(gapFeet, options);
  const refusals = seatRefusals({ seat, standing, state: null });
  if (cleared.verdict === "unknown") refusals.push({ cls: REFUSAL.absence, reason: "jump" });
  if (cleared.verdict === "impossible") refusals.push({ cls: REFUSAL.permission, reason: "impossible" });
  return { ...cleared, ...settle(refusals, seat?.judge) };
}
