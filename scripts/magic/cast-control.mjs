/* global fromUuidSync */
/**
 * The end of a summons' control, read from its spell. A cast's creatures carry
 * their own record (`lib/summons-logic.mjs` `summonRecordOf`: the summoner's
 * spell item id, the creature the cast named, the cast id), and the spell's
 * `summon` rows state what becomes of the creatures when control ends
 * (`controlEnd`, `lib/magic-vocab.mjs` `CONTROL_ENDS`). The GM's client reads
 * the outcome here, from the summoner's own spell item and the creatures'
 * records, never from a card or a request, and has lib carry it out
 * (`applyControlEnd`) on the creatures the cast's own record names.
 *
 * Both ends of a cast come here: concentration's end (`cast-held.mjs`) and the
 * clock's (`cast-expiry.mjs`). With no GM client nothing is applied.
 *
 * See docs/magic/DECISIONS.md, "A summons' control ends as its page says".
 */
import { summonRecordOf } from "../lib/summons-logic.mjs";
import { castSummons } from "../lib/summons.mjs";
import { byCookbookId } from "../lib/library.mjs";
import { summonRowsOf, controlEndFor } from "./cast-summon.mjs";

/** The world lookups the rows and the twin need. */
const worldLookups = () => ({ byCookbookId, fromUuidSync: (uuid) => fromUuidSync(uuid) });

/** The creature a cast's record names, as a row's ref is matched against it: the document where it resolves, else its uuid and name as stamped. */
function creatureOf(record, lookups) {
  let source = null;
  try {
    source = record.sourceUuid ? (lookups.fromUuidSync(record.sourceUuid) ?? null) : null;
  } catch {
    source = null;
  }
  return { source: source ?? { uuid: record.sourceUuid ?? "", name: record.name ?? "" }, sourceRef: record.sourceUuid ?? "" };
}

/**
 * The outcome a cast's control ends with: the `controlEnd` the summoner's spell
 * row states for the cast's creature. The spell is the summoner's own item the
 * creatures' record names; a cast with no creature standing, a spell that is
 * gone and a spell with no row all read `stays`. Pure over the objects passed.
 * @param {object} caster  the summoner's actor
 * @param {{tokens: object[], held: object[]}} found  `castSummons`' answer
 * @param {{byCookbookId: Function, fromUuidSync: Function}} lookups
 * @returns {"stays"|"gone"|"hostile"}
 */
export function castControlOutcome(caster, found, lookups) {
  const record = summonRecordOf(found?.tokens?.[0]?.actor) ?? found?.held?.[0]?.record ?? null;
  const spell = record?.spellId ? (caster?.items?.get?.(record.spellId) ?? null) : null;
  if (!spell) return "stays";
  return controlEndFor(summonRowsOf(spell, lookups), creatureOf(record, lookups));
}

/**
 * Carry out the end of a cast's control, on the GM's client: the outcome from
 * the spell (`castControlOutcome`), applied to the creatures the cast left.
 * @param {{casterUuid: string, castId: string}} request
 * @param {object} [deps]  `caster(uuid)`, `standing(caster, castId)`, `apply(caster, {castId, outcome})` and `lookups`, lib's and the world's unless a test hands its own
 * @returns {Promise<{ok: boolean, reason?: string, outcome?: string, stamped?: number, deleted?: number, released?: number, hostile?: number, unapplied?: number}>}
 */
export async function applyCastControl({ casterUuid, castId } = {}, deps = {}) {
  const caster = (deps.caster ?? ((uuid) => (uuid ? fromUuidSync(uuid) : null)))(casterUuid);
  if (!caster || !castId) return { ok: false, reason: "noCaster" };
  const found = (deps.standing ?? castSummons)(caster, castId);
  if (!found.tokens.length && !found.held.length) return { ok: true, outcome: "stays", stamped: 0, deleted: 0, released: 0, hostile: 0, unapplied: 0 };
  const outcome = castControlOutcome(caster, found, deps.lookups ?? worldLookups());
  const apply = deps.apply ?? (async (...args) => (await import("../lib/summons.mjs")).applyControlEnd(...args));
  return apply(caster, { castId, outcome });
}
