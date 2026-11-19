/* global fromUuidSync */
/**
 * What a summoning spell's rows say to a cast. The cast itself is the spell
 * cast's (`cast-spell.mjs`, which claims every summoning spell, a rowless one
 * too): it asks for the creature and the count, has the seat click where each
 * stands, spends, and only then has the GM's client make the tokens
 * (`lib/summons.mjs`). This file holds the rows' reading and the two feature
 * rules that ride lib's registries and read the summoner's spell item on the
 * seat and on the GM's client alike: a NAMING that says the spell's rows name a
 * creature (which exempts it from the shelf-readable check, since the GM's
 * client resolves it), and a POLICY that refuses a creature the rows do not name
 * and, for a Player, a count over the ceiling the rows state at the cast's
 * caster level. A Player seat's summon must come through a summoning spell, so
 * the policy also refuses a spell that is none.
 */
import { isSummonSpell, summonOptionsOf, libraryTwin } from "./summon-spell.mjs";
import { flattenAt } from "./cast-rows.mjs";
import { modifierFigure } from "./cast-mods.mjs";
import { byCookbookId, cookbookId } from "../lib/library.mjs";
import { normalizeRef, registerSummonPolicy, registerSummonNaming, bareSummonAllowed } from "../lib/summons-logic.mjs";

/** The world lookups the rows and the twin need, as the live world gives them. */
const worldLookups = () => ({ byCookbookId, fromUuidSync: (uuid) => fromUuidSync(uuid) });

/** The `summonFormat` of a row whose creature is called from where it stands, so no range bounds its place (a key of `SUMMON_FORMATS`). */
export const CALLING_FORMAT = "calling";

/**
 * A summoning spell's rows: its own, else its library twin's. The twin is
 * looked for only when the spell has none of its own.
 * @param {object} spell
 * @param {{byCookbookId: Function, fromUuidSync: Function}} lookups
 */
export function summonRowsOf(spell, lookups = worldLookups()) {
  const own = summonOptionsOf(spell);
  return own.length ? own : summonOptionsOf(spell, { twin: libraryTwin(spell, lookups) });
}

/**
 * Does a row's ref name this creature? A creature in hand is named by its uuid,
 * its importer cookbook id or its own name; one the seat could not open
 * (`source` null) is named by the ref the request carries, compared as written.
 */
function rowNames(rowRef, { source, sourceRef }) {
  const ref = normalizeRef(rowRef);
  if (!ref) return false;
  if (source) return ref === source.uuid || ref === cookbookId(source) || ref.toLowerCase() === String(source.name ?? "").trim().toLowerCase();
  return ref === normalizeRef(sourceRef);
}

/**
 * The naming lib asks: true only when one of the spell's rows names the
 * creature. An open row (no ref) names nothing, so an open pick keeps the
 * shelf-readable check.
 * @param {object} req  `registerSummonNaming`'s request
 * @param {{byCookbookId: Function, fromUuidSync: Function}} [lookups]
 */
export function spellNamesCreature(req, lookups = worldLookups()) {
  return summonRowsOf(req.spell, lookups).some((row) => row.ref && rowNames(row.ref, req));
}

/**
 * The rows that fit a creature: those that name it and those with no ref (an
 * open pick fits any creature).
 * @param {object[]} rows  `summonRowsOf`'s
 * @param {{source: object|null, sourceRef?: string}} creature  the creature in hand, or the ref a seat that could not open it names it by
 */
export const summonFitting = (rows, creature) => rows.filter((row) => !row.ref || rowNames(row.ref, creature));

/**
 * The most creatures one row lets a cast call: its `max` at the caster level
 * where it states one, else its `amount`; null where it states neither, or its
 * `max` cannot be read yet (no caster level). The row is read at the
 * invocation level `at` carries first (`flattenAt`), so a `max` keyed on it
 * resolves before the caster level reads it.
 * @param {{amount?: number, max?: *}} row  one of `summonRowsOf`'s
 * @param {{level?: number|null, at?: {invocationLevel?: number|null}|null}} [from]
 * @returns {number|null}
 */
export function summonCeiling(row, { level = null, at = null } = {}) {
  // A row that states a max states its ceiling by it alone: a max that reads null here (no level, below a ladder's first rung) is a blank, and the amount does not stand in.
  if (row?.max != null) {
    const figure = modifierFigure({ value: flattenAt(row, at).max }, level);
    return Number.isFinite(figure) && figure > 0 ? figure : null;
  }
  return Number(row?.amount) > 0 ? Number(row.amount) : null;
}

/**
 * The most creatures a cast of this spell may call of this creature: the
 * greatest ceiling among the rows that fit it, and null as soon as one fitting
 * row states none (it sets no limit), or none fits.
 * @param {object[]} rows  `summonRowsOf`'s
 * @param {{source: object|null, sourceRef?: string, level?: number|null, at?: object|null}} from
 * @returns {number|null}
 */
export function summonCeilingFor(rows, { source = null, sourceRef = "", level = null, at = null } = {}) {
  const fitting = summonFitting(rows, { source, sourceRef });
  if (!fitting.length) return null;
  const ceilings = fitting.map((row) => summonCeiling(row, { level, at }));
  return ceilings.every((c) => c !== null) ? Math.max(...ceilings) : null;
}

/**
 * Is this creature called from where it stands? True when every row that fits
 * it names the calling format; false with no fitting row.
 * @param {object[]} rows  `summonRowsOf`'s
 * @param {{source: object|null, sourceRef?: string}} creature
 */
export function summonIsCalling(rows, creature) {
  const fitting = summonFitting(rows, creature);
  return fitting.length > 0 && fitting.every((row) => row.summonFormat === CALLING_FORMAT);
}

/**
 * The refusal this feature adds to a placement, or null.
 * - `badSpell`: a seat that may not summon bare names a spell that is no
 *   summoning spell;
 * - `notNamed`: the spell's rows name creatures and this is not one of them;
 * - `badCount`: more creatures than the ceiling every row that fits states at
 *   the request's caster level (`cast`, where the request names one; a `max`
 *   with no level states none yet). A Judge's count is not refused: the cast's
 *   verdict warns a Judge, and a refusal here would make that warning false.
 * A row with no ref is an open pick and fits any creature; a row stating no
 * ceiling sets no limit; a spell with no rows asks nothing.
 * @param {object} req  `registerSummonPolicy`'s request
 * @param {{byCookbookId: Function, fromUuidSync: Function}} [lookups]
 * @returns {string|null}
 */
export function summonRefusal(req, lookups = worldLookups()) {
  const { spell, count, user } = req;
  if (!spell) return null;
  if (!bareSummonAllowed(user) && !isSummonSpell(spell)) return "badSpell";
  const rows = summonRowsOf(spell, lookups);
  if (!rows.length) return null;
  if (!summonFitting(rows, req).length) return "notNamed";
  const ceiling = summonCeilingFor(rows, { source: req.source, sourceRef: req.sourceRef, level: req.cast?.casterLevel ?? null, at: { invocationLevel: req.cast?.invocationLevel ?? null } });
  if (user?.isGM !== true && ceiling !== null && count > ceiling) return "badCount";
  return null;
}

/**
 * Cast a summoning spell and wait for it. The system's `use()` does not await
 * `_useSpell`, so a caller that must wait for the placement calls the wrapped
 * method itself, which settles when the claimant's cast does.
 * @param {Item} spell
 * @param {object} [options]
 */
export async function castSummon(spell, options = {}) {
  await spell._useSpell(options);
}

let unregister = null;

/**
 * Register the policy and the naming. Once, at `init`; a second call replaces
 * the first rather than doubling it.
 * @returns {() => void} removes both
 */
export function registerCastSummon() {
  unregister?.();
  const offPolicy = registerSummonPolicy((req) => summonRefusal(req));
  const offNaming = registerSummonNaming((req) => spellNamesCreature(req));
  let done = false;
  const off = () => {
    // A registration that was replaced or already removed does nothing, so a stale handle never takes the live one down.
    if (done) return;
    done = true;
    offPolicy();
    offNaming();
    if (unregister === off) unregister = null;
  };
  unregister = off;
  return off;
}
