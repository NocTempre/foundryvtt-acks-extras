/**
 * Roll gates on the attack throw and the damage roll: a typed modifier whose
 * gate is read at the roll (`registerGate`'s `at: "roll"`: the light gate, and
 * the five of `roll-gate-kinds.mjs`) becomes a labelled row on the attacker's
 * throw (target `attackThrow`) or damage roll (target `damage`) while the gate
 * answers yes. The loadout never writes such a row (`modifierDisposition`
 * answers "at the roll"), so this is the only place one takes effect, and it
 * reaches monsters as well as characters.
 *
 * A `damageDice` row (a `CONSUMED_TARGETS` entry, so no labelled row) multiplies
 * the count of the weapon's dice in the formula the system builds, under the
 * same gates, and the table is told once per attack which part did it. The
 * formula is asked under the delivery the throw's answer recorded on the context.
 *
 * The row's label is the ability's name, what its gate names (`gateLabel`), and the
 * ability's page reference where the import stamped one, because the system's
 * dialog shows a label and a value and nothing else. A spec with no figure
 * adds nothing, and a gate that cannot decide (no token for the attacker) adds
 * nothing either: the roll is never changed on a guess.
 */
import { MODULE_ID } from "./constants.mjs";
import { addAttackContributor, attackInFlight } from "./patches/attack-throw.mjs";
import { consumedRows, gateVerdict, rollGatedModifiers } from "./typed-modifiers.mjs";
import { CONDITIONS } from "./conditions.mjs";
import { locOr } from "./util.mjs";
import "./roll-gate-kinds.mjs";

/** The lang key and English fallback of what each gate kind names; `{x}` marks a figure filled at render. */
const GATE_PHRASES = Object.freeze({
  targetCondition: ["ACKS-LIB.gate.targetCondition", "against a target that is {condition}"],
  combatRound: ["ACKS-LIB.gate.combatRound", "in round {round}"],
  combatRoundRange: ["ACKS-LIB.gate.combatRoundRange", "in rounds {from} to {to}"],
  combatRoundFrom: ["ACKS-LIB.gate.combatRoundFrom", "from round {from}"],
  combatRoundTo: ["ACKS-LIB.gate.combatRoundTo", "through round {to}"],
  outnumbering: ["ACKS-LIB.gate.outnumbering", "while outnumbering"],
  outnumbered: ["ACKS-LIB.gate.outnumbered", "while outnumbered"],
  rangeBand: ["ACKS-LIB.gate.rangeBand", "at {band} range"],
  melee: ["ACKS-LIB.gate.melee", "in melee"],
  diceMultiplied: ["ACKS-LIB.gate.diceMultiplied", "Damage dice ×{times}: {part}"],
});

/** The `modifier` target whose rows multiply a weapon's dice (a `CONSUMED_TARGETS` entry read here). */
export const DAMAGE_DICE_TARGET = "damageDice";

/** The band words, by band; a lang key and its English fallback. */
const BAND_WORDS = Object.freeze({
  melee: ["ACKS-LIB.gate.band.melee", "melee"],
  short: ["ACKS-LIB.gate.band.short", "short"],
  medium: ["ACKS-LIB.gate.band.medium", "medium"],
  long: ["ACKS-LIB.gate.band.long", "long"],
});

/** A phrase localized, its `{x}` marks filled from `data`. */
function phrase([key, fallback], data = {}) {
  return locOr(key, fallback).replace(/\{(\w+)\}/g, (mark, name) => (name in data ? String(data[name]) : mark));
}

/** The words of a value that is one string or a list, joined for a label. */
const listed = (value, word) =>
  (Array.isArray(value) ? value : [value])
    .filter((w) => typeof w === "string" && w.trim())
    .map((w) => word(w.trim()))
    .join(", ");

/** The page reference the import stamped on an item, or "". */
const citeOf = (item) => String(item?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? item?.flags?.[MODULE_ID]?.cookbook?.cite ?? "").trim();

/**
 * Whether a spec's `forWhat` lets it ride an attack of this kind: unnarrowed, or
 * narrowed to the same delivery. A row narrowed to any other activity is a
 * different roll's.
 */
function reaches(forWhat, attackType) {
  const narrowed = String(forWhat ?? "").trim().toLowerCase();
  return !narrowed || narrowed === String(attackType ?? "").toLowerCase();
}

/**
 * What a gate names, by its kind, as a phrase that says what the gate is and
 * states no rule: a light level, "against a target that is {condition}", "in
 * round {round}", "while outnumbering", "at {band} range". A conjunction
 * (`allOf`) joins its gates' phrases. A kind with no phrase is named by the kind.
 */
export function gateLabel(gate) {
  switch (gate?.kind) {
    case "targetCondition":
      return phrase(GATE_PHRASES.targetCondition, { condition: listed(gate.condition, (id) => CONDITIONS[id]?.label ?? id) });
    case "combatRound": {
      const round = gate.round;
      if (round && typeof round === "object") {
        const from = round.from ?? "";
        const to = round.to ?? "";
        if (from !== "" && String(from) === String(to)) return phrase(GATE_PHRASES.combatRound, { round: from });
        if (from !== "" && to !== "") return phrase(GATE_PHRASES.combatRoundRange, { from, to });
        return phrase(from !== "" ? GATE_PHRASES.combatRoundFrom : GATE_PHRASES.combatRoundTo, { from, to });
      }
      return phrase(GATE_PHRASES.combatRound, { round });
    }
    case "outnumbering":
      return phrase(gate.side === "against" ? GATE_PHRASES.outnumbered : GATE_PHRASES.outnumbering);
    case "rangeBand": {
      const bands = Array.isArray(gate.band) ? gate.band : [gate.band];
      if (bands.length === 1 && bands[0] === "melee") return phrase(GATE_PHRASES.melee);
      return phrase(GATE_PHRASES.rangeBand, { band: listed(gate.band, (band) => (BAND_WORDS[band] ? phrase(BAND_WORDS[band]) : band)) });
    }
    case "allOf":
      return (Array.isArray(gate.of) ? gate.of : []).map(gateLabel).filter(Boolean).join(", ");
    default:
      return gate?.light ? locOr(`ACKS-LIB.light.level.${gate.light}`, gate.light) : String(gate?.kind ?? "");
  }
}

/** The label of one gated row: `{name} · {what the gate names} (cite)`. */
function labelOf({ item, gate }) {
  const level = gateLabel(gate);
  const cite = citeOf(item);
  return `${item.name}${level ? ` · ${level}` : ""}${cite ? ` (${cite})` : ""}`;
}

/** The labelled rows of the attacker's roll-gated modifiers for one target, each whose gate answers yes. */
function gatedRows(ctx, attackType, target) {
  const { actor, token = null, target: aimed = null, targetActor = null, item = null } = ctx ?? {};
  const asked = { token, target: aimed, targetActor, item, type: attackType };
  return rollGatedModifiers(actor, target)
    .filter((row) => reaches(row.spec.forWhat, attackType))
    .filter((row) => gateVerdict(actor, row.gate, asked) === true)
    .map((row) => ({ label: labelOf(row), value: row.value }));
}

/**
 * The rows the attacker's gated modifiers add to an attack throw: one per
 * modifier whose gate answers yes for the attacker's token. Pure over the
 * attack's context; asked once per attack type and again for the preview.
 *
 * @param {{actor: object, token?: object|null, target?: object|null, targetActor?: object|null, item?: object|null}} ctx the attack in flight
 * @param {string} attackType `melee` or `missile`
 * @returns {{label: string, value: number}[]}
 */
export function rollGateRows(ctx, attackType) {
  return gatedRows(ctx, attackType, "attackThrow");
}

/**
 * The rows the attacker's gated `damage` modifiers add to the damage roll, as
 * `rollGateRows` reads the throw's: same context, same label, a row only under a
 * gate that answers yes.
 */
export function rollGateDamageRows(ctx, attackType) {
  return gatedRows(ctx, attackType, "damage");
}

/**
 * The gated multiple of a weapon's dice an attack earns: the largest whole
 * `damageDice` value (two or more) among the actor's rows whose gate answers
 * yes for the attack, as `{times, row}`, or null. A row with no gate always
 * answers; one the gate cannot decide, and an attack whose delivery is not
 * known (`ctx.delivery`, which the `attack` answer records), earns none.
 *
 * @param {{actor: object, token?: object|null, target?: object|null, targetActor?: object|null, delivery?: string|null}} ctx the attack in flight
 * @param {object|null} item the weapon
 */
export function diceMultipleOf(ctx, item) {
  const { actor, token = null, target = null, targetActor = null, delivery = null } = ctx ?? {};
  if (!actor || !delivery) return null;
  const asked = { token, target, targetActor, item, type: delivery };
  let best = null;
  for (const row of consumedRows(actor, DAMAGE_DICE_TARGET)) {
    if (!Number.isInteger(row.value) || row.value < 2) continue;
    if (row.spec.gate?.kind && gateVerdict(actor, row.spec.gate, asked) !== true) continue;
    if (!best || row.value > best.times) best = { times: row.value, row };
  }
  return best;
}

/**
 * A damage formula with the count of every dice term multiplied by `times`
 * (`1d6 + 2` at 2 is `2d6 + 2`), flat terms left alone; null when the formula
 * holds no dice term.
 */
export function multiplyDice(formula, times) {
  let changed = false;
  const out = String(formula ?? "").replace(/(?<![\w@.])(\d*)d(\d+)/gi, (_m, count, sides) => {
    changed = true;
    return `${(count === "" ? 1 : Number(count)) * times}d${sides}`;
  });
  return changed ? out : null;
}

/** The attacks already told about their multiplied dice, so the notice comes once per attack. */
const toldDice = new WeakSet();

/** The attack seam's contributor. */
const rollGateContributor = {
  // A spell carrier's attack throw reads the attacker's gates; its damage has none.
  carriers: ["attack"],
  attack(ctx, attackType, modifiers) {
    // The system's builder asks the throw's modifiers for the chosen type, then the formula, in one build:
    // the delivery recorded here is the one `damageFormula` is asked under.
    if (ctx) ctx.delivery = attackType;
    const rows = rollGateRows(ctx, attackType);
    return rows.length ? [...modifiers, ...rows] : modifiers;
  },
  damage(ctx, attackType, modifiers) {
    const rows = rollGateDamageRows(ctx, attackType);
    return rows.length ? [...modifiers, ...rows] : modifiers;
  },
  damageFormula(item, _mode, formula) {
    const ctx = attackInFlight(item?.parent);
    if (!ctx || typeof formula !== "string") return formula;
    const multiple = diceMultipleOf(ctx, item);
    const multiplied = multiple ? multiplyDice(formula, multiple.times) : null;
    if (multiplied === null) return formula;
    if (!toldDice.has(ctx)) {
      toldDice.add(ctx);
      const part = labelOf({ item: multiple.row.item, gate: multiple.row.spec.gate });
      globalThis.ui?.notifications?.info?.(phrase(GATE_PHRASES.diceMultiplied, { times: multiple.times, part }));
    }
    return multiplied;
  },
};

/** Put the roll-gated modifiers on the attack throw. At `ready`, beside the conditions. */
export function installRollGates() {
  addAttackContributor(rollGateContributor);
}
