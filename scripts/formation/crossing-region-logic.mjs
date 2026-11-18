/**
 * What a Crossing obstacle region seeds into the party's crossing, and which of
 * its fields each kind of region uses. The behaviour's data model and window
 * are `crossing-region.mjs`; nothing here touches a Foundry global.
 *
 * A region states a kind (`climb` or `jump`) and, for a climb, which obstacle
 * of `OBSTACLES` it is. The crossing's own kind is the obstacle for a climb
 * and `jump` for a jump, so the obstacle pick is the seed's `kind` and never a
 * setup key. Every other field is a setup key of the crossing
 * (`SETUP_FIELDS`), blank when the Judge leaves it to the sheet: a blank number
 * and a blank yes/no seed nothing, and a stated value is read by the same
 * reader the sheet's form uses, so the seed holds what the sheet would store.
 * No value is defaulted here: a printed figure arrives only if the Judge types
 * it.
 *
 * The reader table is read inside function bodies only, so `crossing.mjs` can
 * import this file without a load-order cycle.
 */
import { JUMP_KIND, SETUP_FIELDS } from "./crossing.mjs";
import { OBSTACLES } from "./obstacles.mjs";

/** The kinds of region a Judge may draw, in the order the pick lists them. */
export const REGION_KINDS = Object.freeze(["climb", "jump"]);

/** The obstacles a climb region may name: every obstacle the crossing knows, in the crossing's own order. */
export const OBSTACLE_KEYS = Object.freeze(Object.keys(OBSTACLES));

/** The behaviour's number fields: feet, blank until the Judge states one. */
export const NUMBER_FIELDS = Object.freeze(["length", "depth", "gap"]);

/** The behaviour's yes/no fields: blank means the Judge sets it on the sheet. */
export const FLAG_FIELDS = Object.freeze(["ropeFixed", "runUp", "precarious", "charging"]);

/** The fields every kind shows, whatever it is. */
export const COMMON_FIELDS = Object.freeze(["kind", "art", "onEntry"]);

/**
 * The fields each kind of region uses, in the order its window lists them.
 * `obstacle` is the climb's own pick; every other name is a setup key of the
 * crossing and one of the party sheet's fields for that kind.
 */
export const KIND_FIELDS = Object.freeze({
  climb: Object.freeze(["obstacle", "length", "depth", "ropeFixed"]),
  jump: Object.freeze(["gap", "runUp", "precarious", "charging", "depth", "ropeFixed"]),
});

/** What happens when the party enters a region, in the order the pick lists them. */
export const ENTRY_MODES = Object.freeze(["offer", "start", "nothing"]);

/** The field names that depend on the kind: the union of every kind's list. */
export const KIND_BOUND_FIELDS = Object.freeze([...new Set(Object.values(KIND_FIELDS).flat())]);

/** The fields of a kind of region the window shows beyond the common ones, or an empty list for a kind that is none. */
export const fieldsOfKind = (kind) => KIND_FIELDS[kind] ?? [];

/** The kind-bound fields a kind of region does not use, which its window hides. */
export const hiddenFieldsOf = (kind) => KIND_BOUND_FIELDS.filter((key) => !fieldsOfKind(kind).includes(key));

/** A yes/no field's stored text as the boolean the crossing keeps, or undefined while it is blank. */
function flagOf(raw) {
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return undefined;
}

/** A number field's value as the reader takes it, or undefined while the field is blank. */
function numberOf(raw) {
  return raw === null || raw === undefined || raw === "" ? undefined : raw;
}

/**
 * What a region begins the crossing with.
 *
 * The seed's `kind` is the crossing's kind: a climb region's obstacle, or
 * `jump`. `setup` holds only the keys the region fills for its own kind: a
 * blank field, a value the sheet's reader refuses and a value stored for
 * another kind are absent. Each value passes through `SETUP_FIELDS`' reader, so
 * it equals what the sheet would write.
 *
 * @param {object} system a Crossing obstacle behaviour's `system` data
 * @returns {{kind: string, setup: Record<string, number|boolean>}|null} null for
 *   a region whose kind is none, or a climb naming no known obstacle
 */
export function regionSeed(system) {
  const fields = KIND_FIELDS[system?.kind];
  if (!fields) return null;
  const kind = system.kind === "jump" ? JUMP_KIND : system.obstacle;
  if (system.kind === "climb" && !OBSTACLE_KEYS.includes(kind)) return null;
  const setup = {};
  for (const key of fields) {
    const read = SETUP_FIELDS[key];
    if (!read) continue;
    const stated = NUMBER_FIELDS.includes(key) ? numberOf(system[key]) : flagOf(system[key]);
    if (stated === undefined) continue;
    const value = read(stated);
    if (value !== null) setup[key] = value;
  }
  return { kind, setup };
}
