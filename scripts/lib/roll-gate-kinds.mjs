/**
 * The roll gates that describe an attack's moment, registered through
 * `typed-modifiers.mjs` `registerGate` with `at: "roll"`: the target's
 * condition (`targetCondition`), the encounter's round (`combatRound`), the
 * two sides of the fight (`outnumbering`) and the distance to the target
 * (`rangeBand`). They are the roll-gate half of `roll-gates.mjs`, which asks
 * them with the attack's context and labels the row they admit.
 *
 * Each evaluator answers true, false, or null, and null whenever the context
 * to decide is missing (no token, no target, no combat, a figure the import did
 * not read): a gate never guesses. A figure a gate compares against (`round`,
 * `ratio`) arrives on the gate from the imported table, never from here.
 *
 * The context is the attack's own: `token` (the attacker's token), `target` and
 * `targetActor` (the first targeted token and its actor), `item` (the weapon)
 * and `type` (the delivery, `melee` or `missile`). See `docs/lib/API.md`,
 * "Typed modifiers", for what each gate reads.
 *
 * Foundry-free: every read goes through the objects the context holds.
 */
import { registerGate } from "./typed-modifiers.mjs";
import { CONDITIONS, conditionSet } from "./conditions.mjs";
import { areEnemies } from "./actor-read.mjs";
import { tokenGapFeet } from "./distance-units.mjs";

/** The bands a `rangeBand` gate names: melee, and the three bands of a ranged weapon, nearest first. */
export const RANGE_BANDS = Object.freeze(["melee", "short", "medium", "long"]);

/** The non-blank strings of a value that is one string or a list of them. */
const wordsOf = (value) =>
  (Array.isArray(value) ? value : [value]).map((w) => (typeof w === "string" ? w.trim() : "")).filter(Boolean);

/** The encounter the attacker's token fights in, or null: its combatant's own combat. */
function combatOf(token) {
  const combatant = token?.combatant;
  return combatant?.parent ?? combatant?.combat ?? null;
}

/**
 * Whether the attacker's target carries any of the conditions the gate names
 * (`gate.condition`, one id of the conditions catalogue or a list). A state
 * the carried one implies counts; an id the catalogue does not hold is
 * ignored, and a gate naming none is undecided, as is an attack with no target.
 */
export function targetConditionHolds(gate, ctx) {
  const wanted = wordsOf(gate?.condition).filter((id) => CONDITIONS[id]);
  const statuses = ctx?.targetActor?.statuses;
  if (!wanted.length || !statuses) return null;
  const carried = conditionSet(statuses);
  return wanted.some((id) => carried.has(id));
}

/**
 * Whether the encounter's round is the one the gate names: `gate.round` as a
 * number is that round exactly, as `{from, to}` the rounds from one to the
 * other inclusive, either bound optional. Undecided for a token in no combat, a
 * combat not yet begun (round 0), or a gate naming no round.
 */
export function combatRoundHolds(gate, ctx) {
  const round = combatOf(ctx?.token)?.round;
  if (!Number.isInteger(round) || round < 1) return null;
  const named = gate?.round;
  const finite = (n) => (n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n)) ? Number(n) : null);
  if (named && typeof named === "object") {
    const from = finite(named.from);
    const to = finite(named.to);
    if (from === null && to === null) return null;
    return (from === null || round >= from) && (to === null || round <= to);
  }
  const exact = finite(named);
  return exact === null ? null : round === exact;
}

/** Whether a combatant is out of the fight: defeated, by core's own reading. */
const isDown = (combatant) => (combatant?.isDefeated ?? combatant?.defeated) === true;

/**
 * Whether the attacker's side outnumbers the opposing side by at least
 * `gate.ratio` (the attackers' count against ratio times the opponents'), or
 * with `gate.side: "against"` the opposing side the attacker's.
 *
 * Sides are the friendly and the hostile token dispositions (`areEnemies`),
 * counted among the undefeated combatants of the attacker's own combat, the
 * attacker included in its side. A neutral or secret attacker, a token in no
 * combat, a gate with no ratio, and a fight with nobody on the other side are
 * undecided.
 */
export function outnumberingHolds(gate, ctx) {
  const ratio = Number(gate?.ratio);
  const combat = combatOf(ctx?.token);
  if (!(ratio > 0) || !combat || !ctx?.token || areEnemies(ctx.token, ctx.token) === null) return null;
  let own = 0;
  let opposing = 0;
  for (const combatant of combat.combatants ?? []) {
    const token = combatant?.token;
    if (!token || isDown(combatant)) continue;
    const enemies = areEnemies(ctx.token, token);
    if (enemies === true) opposing += 1;
    else if (enemies === false) own += 1;
  }
  if (opposing === 0) return null;
  return gate?.side === "against" ? opposing >= ratio * own : own >= ratio * opposing;
}

/**
 * The band the target stands in, from the weapon's own range figures: `melee`
 * for a melee attack, else the first of short, medium and long whose reach the
 * token gap (feet) does not exceed. Null where the delivery, the gap or the
 * weapon's figures cannot say, and beyond the long reach.
 */
export function rangeBandOf(ctx) {
  if (ctx?.type === "melee") return "melee";
  if (ctx?.type !== "missile" && ctx?.type !== "thrown") return null;
  const gap = tokenGapFeet(ctx.token, ctx.target);
  const range = ctx.item?.system?.range;
  if (gap === null || !range) return null;
  for (const band of RANGE_BANDS.slice(1)) {
    const reach = Number(range[band]);
    if (Number.isFinite(reach) && reach > 0 && gap <= reach) return band;
  }
  return null;
}

/** Whether the attack's range band is one the gate names (`gate.band`, one band or a list); undecided where the band is. */
export function rangeBandHolds(gate, ctx) {
  const wanted = wordsOf(gate?.band).filter((band) => RANGE_BANDS.includes(band));
  if (!wanted.length) return null;
  const band = rangeBandOf(ctx);
  return band === null ? null : wanted.includes(band);
}

registerGate("targetCondition", (_actor, gate, ctx) => targetConditionHolds(gate, ctx), { at: "roll" });
registerGate("combatRound", (_actor, gate, ctx) => combatRoundHolds(gate, ctx), { at: "roll" });
registerGate("outnumbering", (_actor, gate, ctx) => outnumberingHolds(gate, ctx), { at: "roll" });
registerGate("rangeBand", (_actor, gate, ctx) => rangeBandHolds(gate, ctx), { at: "roll" });
