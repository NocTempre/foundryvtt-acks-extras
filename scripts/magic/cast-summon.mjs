/* global fromUuid, fromUuidSync, Roll */
/**
 * Casting a summoning spell places its creatures. A claimant on the cast seam
 * (`lib/patches/spell-use.mjs`) takes the cast of a summoning spell on a
 * character this seat owns, whichever door the player pressed (the system's
 * sheet button, the Magic tab, a hotbar macro): it asks for the creature and
 * the count (`lib/summons.mjs` `pickSummon`, from the spell's own rows), has the
 * seat click where each stands and the GM's client make the tokens
 * (`placeSummons`), and only then spends the cast through the seam's `spend`.
 * A cancel or a refusal spends nothing. The cast leaves a record on the
 * caster, an Active Effect marked with the cast id the summons carry
 * (`spell-effect.mjs`), whose duration is the spell's imported duration or
 * none.
 *
 * Two feature rules ride lib's registries and read the summoner's spell item
 * on the seat and on the GM's client alike: a NAMING that says the spell's
 * rows name a creature (which exempts it from the shelf-readable check, since
 * the GM's client resolves it), and a POLICY that refuses a creature the rows
 * do not name and a count over the row's amount. A Player seat's summon must
 * come through a summoning spell, so the policy also refuses a spell that is
 * none.
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { isSummonSpell, summonOptionsOf, libraryTwin, resolveSummonRef } from "./summon-spell.mjs";
import { spellEffectData, newCastId } from "./spell-effect.mjs";
import { castDuration } from "./cast-duration.mjs";
import { byCookbookId, cookbookId, whenReady } from "../lib/library.mjs";
import { normalizeRef, registerSummonPolicy, registerSummonNaming, bareSummonAllowed } from "../lib/summons-logic.mjs";
import { pickSummon, placeSummons, announceSummon } from "../lib/summons.mjs";
import { addSpellUseClaimant, removeSpellUseClaimant } from "../lib/patches/spell-use.mjs";

/** The claimant's key on the cast seam. */
export const CAST_SUMMON_KEY = `${MODULE_ID}.magic.castSummon`;

/** The world lookups the rows and the twin need, as the live world gives them. */
const worldLookups = () => ({ byCookbookId, fromUuidSync: (uuid) => fromUuidSync(uuid) });

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
 * The refusal this feature adds to a placement, or null.
 * - `badSpell`: a seat that may not summon bare names a spell that is no
 *   summoning spell;
 * - `notNamed`: the spell's rows name creatures and this is not one of them;
 * - `badCount`: more creatures than the amount every row that fits states.
 * A row with no ref is an open pick and fits any creature; a row stating no
 * amount sets no limit; a spell with no rows asks nothing.
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
  const fitting = rows.filter((row) => !row.ref || rowNames(row.ref, req));
  if (!fitting.length) return "notNamed";
  if (fitting.every((row) => row.amount > 0) && count > Math.max(...fitting.map((row) => row.amount))) return "badCount";
  return null;
}

/**
 * The effect duration a cast leaves: the spell's own imported duration, else
 * its library twin's, through `castDuration`. No caster level is passed, since
 * a class's level is not always its caster level, so a per-level duration
 * answers none and the record stays until its owner removes it.
 * @returns {{value: number, units: string}|{none: string}}
 */
export function summonCastDuration(spell, { lookups = worldLookups(), roll } = {}) {
  const own = spell?.flags?.[MODULE_ID]?.[FLAG_SPELL]?.duration;
  const duration = own?.shape ? own : (libraryTwin(spell, lookups)?.flags?.[MODULE_ID]?.[FLAG_SPELL]?.duration ?? own);
  return castDuration(duration, { roll });
}

/** The dependencies a cast uses, as the live world supplies them; a test supplies its own. */
const liveDeps = () => ({
  ready: whenReady,
  lookups: worldLookups(),
  resolveRef: (ref) => resolveSummonRef(ref, { fromUuid: (uuid) => fromUuid(uuid), byCookbookId }),
  pick: pickSummon,
  place: placeSummons,
  announce: announceSummon,
  roll: (formula) => new Roll(formula).evaluateSync().total,
  castId: () => newCastId(),
});

/**
 * The cast of one summoning spell. Asks, places, then spends: `spend()` runs
 * only when the relay answered ok, before this returns, so a cancel, a closed
 * prompt or a refusal costs the spell nothing. The record is written after the
 * spend, and its failure is logged and never undoes a cast that happened.
 * @param {Item} spell
 * @param {() => Promise<boolean>} spend  the seam's once-only door to the system's cast
 * @param {object} [deps]  see `liveDeps`
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, tokenUuids?: string[]}>}
 */
export async function castSummonSpell(spell, spend, deps = liveDeps()) {
  const caster = spell.parent;
  await deps.ready?.();
  const options = summonRowsOf(spell, deps.lookups);
  const picked = await deps.pick(caster, { spell, options, resolveRef: deps.resolveRef });
  if (!picked) return { ok: false, reason: "cancelled" };
  const result = await deps.place(caster, { sourceUuid: picked.sourceUuid, count: picked.count, spellId: picked.spellId });
  deps.announce(result);
  if (!result?.ok) return result ?? { ok: false, reason: "noGm" };
  await spend();
  try {
    const duration = summonCastDuration(spell, { lookups: deps.lookups, roll: deps.roll });
    const data = spellEffectData({
      spell: { uuid: spell.uuid, name: spell.name, img: spell.img },
      caster: { uuid: caster.uuid },
      castId: result.castId || deps.castId(),
      role: "caster",
      duration,
    });
    await caster.createEmbeddedDocuments("ActiveEffect", [data]);
  } catch (err) {
    console.error(`${MODULE_ID} | the cast record of a summoning was not written`, err);
  }
  return result;
}

/**
 * The claimant for the cast seam. `claims` is synchronous and answers true only
 * for a summoning spell on a character this seat owns; a monster's spell items
 * and a character this seat does not own are the system's own cast.
 * @param {object} [deps]  see `liveDeps`
 */
export function castSummonClaimant(deps) {
  return {
    key: CAST_SUMMON_KEY,
    claims: (item) => isSummonSpell(item) && item.parent?.isOwner === true,
    cast: (item, _options, spend) => castSummonSpell(item, spend, deps),
  };
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
 * Register the claimant, the policy and the naming. Once, at `init`; a second
 * call replaces the first rather than doubling it.
 * @returns {() => void} removes all three
 */
export function registerCastSummon() {
  unregister?.();
  addSpellUseClaimant(castSummonClaimant());
  const offPolicy = registerSummonPolicy((req) => summonRefusal(req));
  const offNaming = registerSummonNaming((req) => spellNamesCreature(req));
  let done = false;
  const off = () => {
    // A registration that was replaced or already removed does nothing, so a stale handle never takes the live one down.
    if (done) return;
    done = true;
    removeSpellUseClaimant(CAST_SUMMON_KEY);
    offPolicy();
    offNaming();
    if (unregister === off) unregister = null;
  };
  unregister = off;
  return off;
}
