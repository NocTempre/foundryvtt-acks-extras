/**
 * Roll gates on the attack throw: a typed modifier whose gate is read at the
 * roll (`registerGate`'s `at: "roll"`, the light gate) becomes a labelled row on
 * the attacker's throw while the gate answers yes. The loadout never writes
 * such a row (`modifierDisposition` answers "at the roll"), so this is the only
 * place one takes effect, and it reaches monsters as well as characters.
 *
 * The row's label is the ability's name, the level its gate names, and the
 * ability's page reference where the import stamped one, because the system's
 * dialog shows a label and a value and nothing else. A spec with no figure
 * adds nothing, and a gate that cannot decide (no token for the attacker) adds
 * nothing either: the throw is never penalized on a guess.
 */
import { MODULE_ID } from "./constants.mjs";
import { addAttackContributor } from "./patches/attack-throw.mjs";
import { gateVerdict, rollGatedModifiers } from "./typed-modifiers.mjs";
import { locOr } from "./util.mjs";

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

/** The label of one gated row: `{name} · {level} (cite)`. */
function labelOf({ item, gate }) {
  const level = locOr(`ACKS-LIB.light.level.${gate.light}`, gate.light);
  const cite = citeOf(item);
  return `${item.name} · ${level}${cite ? ` (${cite})` : ""}`;
}

/**
 * The rows the attacker's gated modifiers add to an attack throw: one per
 * modifier whose gate answers yes for the attacker's token. Pure over the
 * attack's context; asked once per attack type and again for the preview.
 *
 * @param {{actor: object, token?: object|null}} ctx the attack in flight
 * @param {string} attackType `melee` or `missile`
 * @returns {{label: string, value: number}[]}
 */
export function rollGateRows(ctx, attackType) {
  const { actor, token = null } = ctx ?? {};
  return rollGatedModifiers(actor, "attackThrow")
    .filter((row) => reaches(row.spec.forWhat, attackType))
    .filter((row) => gateVerdict(actor, row.gate, { token }) === true)
    .map((row) => ({ label: labelOf(row), value: row.value }));
}

/** The attack seam's contributor. */
const rollGateContributor = {
  attack(ctx, attackType, modifiers) {
    const rows = rollGateRows(ctx, attackType);
    return rows.length ? [...modifiers, ...rows] : modifiers;
  },
};

/** Put the roll-gated modifiers on the attack throw. At `ready`, beside the conditions. */
export function installRollGates() {
  addAttackContributor(rollGateContributor);
}
