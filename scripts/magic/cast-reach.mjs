/* global fromUuidSync */
/**
 * What a cast of a spell would write on its own caster: the reach the
 * castable-spell register (`lib/spell-sources.mjs`) asks of magic. A cast's
 * rows each name who they apply to, and the spell names what it is aimed at, so
 * the caster is a recipient of a row where the row is aimed at itself, or where
 * the spell's target model admits a creature standing where the caster stands
 * and the target gates (`cast-gates.mjs`) do not leave it out. The rows kept are
 * built into the parts a record would carry (`modParts`), at the source's
 * caster level.
 *
 * Every option of a choice group counts: the caster has not chosen yet, and the
 * register answers what it could write. The two forms of a reversible spell
 * both count. Reads the world through lookups passed in, one set per
 * `castableSpells` call (`twinLookups`).
 */
import { rowsOf, rowsOfMode, aimedAtSelf, hasReversedRows, CAST_MODES } from "./cast-rows.mjs";
import { modParts } from "./cast-mods.mjs";
import { targetGate } from "./cast-gates.mjs";
import { castGateExtrasOf } from "./cast-spell.mjs";
import { invocationFigure } from "./cast-level.mjs";
import { MODULE_ID } from "./constants.mjs";
import { libraryDocs, cookbookId } from "../lib/library.mjs";

/** The subjects a row names for what the cast is aimed at; a creature standing where the caster stands is one of them. */
const AIMED = Object.freeze(["target", "recipient", "area"]);

/** The target models that admit a creature standing where the caster stands: a blank model counts, since a grants row names none. */
const ADMITS_CASTER = Object.freeze(["self", "creature", "recipient", "hdPool", "area"]);

/** The models no creature stands in. */
const NOT_A_CREATURE = Object.freeze(["object", "structure"]);

/**
 * The lookups a spell's twin is read through, built once for one
 * `castableSpells` call and kept on its `call` object: a map from cookbook id to
 * the first library document carrying it (a template part is no twin), read from
 * the library on first use only, since `byCookbookId` is a linear scan.
 *
 * @param {object} call  the register's per-call scratch
 * @returns {{byCookbookId: (type: string, id: string) => object|null, fromUuidSync: (uuid: string) => object|null}}
 */
export function twinLookups(call) {
  if (call.lookups) return call.lookups;
  const indexes = {};
  call.lookups = {
    byCookbookId: (type, id) => {
      if (!id) return null;
      if (!indexes[type]) {
        indexes[type] = new Map();
        for (const doc of libraryDocs(type)) {
          const key = cookbookId(doc);
          if (key && !doc.flags?.[MODULE_ID]?.templatePart && !indexes[type].has(key)) indexes[type].set(key, doc);
        }
      }
      return indexes[type].get(id) ?? null;
    },
    fromUuidSync: (uuid) => fromUuidSync(uuid),
  };
  return call.lookups;
}

/**
 * The reach of a cast on its caster, as the register asks it.
 *
 * `onSelf` is true where a cast writes at least one row on the caster, false
 * where it writes none (a spell with no rows, one aimed at objects or a
 * structure, or one whose gates leave the caster out), and null where the spell
 * is aimed at something special and no row is aimed at the caster itself.
 * `selfParts` are the parts those rows build.
 *
 * @param {{lookups?: (call: object) => object}} [deps]
 * The cap the rows are read at is the entry's `cap`, else the one the repertoire
 * source put on `call.caps` for the entry's spell.
 *
 * @returns {(actor: object, entry: {spell: object, casterLevel: object|null, cap?: number|null}, call?: object) => {onSelf: boolean|null, selfParts: object[]}}
 */
export function makeSelfReach({ lookups = twinLookups } = {}) {
  return (actor, entry, call = {}) => {
    const spell = entry.spell;
    const look = lookups(call);
    const rows = rowsOf(spell, look).rows;
    if (!rows.length) return { onSelf: false, selfParts: [] };
    // A row bounded by the invocation level, or a figure keyed on it, is read at the tradition's cap; with no cap none stands. The register's entry carries no cap, so it is read from the call the repertoire source left it on.
    const at = { invocationLevel: invocationFigure(entry.cap ?? call.caps?.get(spell)) };
    const extras = castGateExtrasOf(spell, look, at);
    const model = String(extras.target?.model ?? "");
    const level = Number.isFinite(entry.casterLevel?.value) ? entry.casterLevel.value : null;
    const kept = [];
    let undecided = false;
    for (const mode of hasReversedRows(rows) ? [CAST_MODES.normal, CAST_MODES.reversed] : [CAST_MODES.normal]) {
      for (const keyed of rowsOfMode(rows, mode, at)) {
        const { row } = keyed;
        if (aimedAtSelf(row)) kept.push(keyed);
        else if (!AIMED.includes(row.appliesTo) || NOT_A_CREATURE.includes(model)) continue;
        else if (model && !ADMITS_CASTER.includes(model)) undecided = true;
        else if (targetGate({ actor, extras, row, level }).affected) kept.push(keyed);
      }
    }
    if (!kept.length) return { onSelf: undecided ? null : false, selfParts: [] };
    return { onSelf: true, selfParts: modParts(kept, { level, actorType: actor?.type ?? "character", save: extras.save ?? null }).parts };
  };
}

/** The register's reach: what a cast of a spell writes on its own caster. */
export const selfReach = makeSelfReach();
