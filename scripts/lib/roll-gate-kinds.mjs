/**
 * The roll gates that describe an attack's moment, registered through
 * `typed-modifiers.mjs` `registerGate` with `at: "roll"`: the target's
 * condition (`targetCondition`), the encounter's round (`combatRound`), the
 * two sides of the fight (`outnumbering`), the distance to the target
 * (`rangeBand`) and a conjunction of those (`allOf`). They are the roll-gate half of `roll-gates.mjs`, which asks
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
import { registerGate, gateVerdict } from "./typed-modifiers.mjs";
import { CONDITIONS, conditionSet } from "./conditions.mjs";
import { areEnemies } from "./actor-read.mjs";
import { tokenGapFeet } from "./distance-units.mjs";
import { bodyCount } from "./group-logic.mjs";

/** The bands a `rangeBand` gate names: melee, and the three bands of a ranged weapon, nearest first. */
export const RANGE_BANDS = Object.freeze(["melee", "short", "medium", "long"]);

/** The non-blank strings of a value that is one string or a list of them. */
const wordsOf = (value) =>
  (Array.isArray(value) ? value : [value]).map((w) => (typeof w === "string" ? w.trim() : "")).filter(Boolean);

/**
 * The encounter the attacker's token fights in, or null. Core's
 * `token.combatant` reads only the combat this client's tracker views, so a
 * token fighting in another one is looked for among every combat: a combatant
 * of that token on that scene, the active combat first, then a begun one.
 */
function combatOf(token) {
  const combatant = token?.combatant;
  const own = combatant?.parent ?? combatant?.combat ?? null;
  if (own || !token?.id) return own;
  const sceneId = token.parent?.id ?? null;
  const holds = (combat) => [...(combat?.combatants ?? [])].some((c) =>
    c?.tokenId === token.id && (!sceneId || (c.sceneId ?? combat.scene?.id ?? combat.scene ?? sceneId) === sceneId));
  const found = [...(globalThis.game?.combats ?? [])].filter(holds);
  return found.find((c) => c.active) ?? found.find((c) => c.round > 0) ?? found[0] ?? null;
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
 * attacker included in its side. A combatant counts the bodies it stands for
 * (`bodyCount`: a stack its living bodies, any other actor one; a combatant
 * whose actor cannot be read counts one). A neutral or secret attacker, a token
 * in no combat, a gate that is no clause, and a fight with nobody on the other
 * side are undecided.
 *
 * A gate with no ratio is a clause that prints none (`gate.strict`): the
 * comparison is then strictly more, the attacker's side over the opposing one
 * (or with `side: "against"` the opposing over the attacker's). With neither a
 * ratio nor `strict` the gate is a ratio the import failed to read, and
 * undecided.
 */
export function outnumberingHolds(gate, ctx) {
  const ratio = Number(gate?.ratio);
  const strict = gate?.strict === true && !(ratio > 0);
  const combat = combatOf(ctx?.token);
  if ((!(ratio > 0) && !strict) || !combat || !ctx?.token || areEnemies(ctx.token, ctx.token) === null) return null;
  let own = 0;
  let opposing = 0;
  for (const combatant of combat.combatants ?? []) {
    const token = combatant?.token;
    if (!token || isDown(combatant)) continue;
    const enemies = areEnemies(ctx.token, token);
    if (enemies === null) continue;
    const actor = combatant.actor ?? token.actor ?? null;
    const bodies = actor ? bodyCount(actor) : 1;
    if (enemies === true) opposing += bodies;
    else own += bodies;
  }
  if (opposing === 0) return null;
  if (strict) return gate?.side === "against" ? opposing > own : own > opposing;
  return gate?.side === "against" ? opposing >= ratio * own : own >= ratio * opposing;
}

/**
 * Whether every gate of `gate.of` (a list of gates, each asked through
 * `gateVerdict` with the same context) holds. Any gate false is false; all true
 * is true; otherwise, with none false and one undecided, the answer is
 * undecided. An empty or missing list is undecided.
 */
export function allOfHolds(actor, gate, ctx) {
  const parts = Array.isArray(gate?.of) ? gate.of : [];
  if (!parts.length) return null;
  const verdicts = parts.map((part) => gateVerdict(actor, part, ctx));
  if (verdicts.includes(false)) return false;
  return verdicts.every((v) => v === true) ? true : null;
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
registerGate("allOf", (actor, gate, ctx) => allOfHolds(actor, gate, ctx), { at: "roll" });
