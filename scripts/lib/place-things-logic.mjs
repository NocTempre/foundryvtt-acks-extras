/**
 * The Foundry-free half of a place's THINGS: the one list of what stands at a
 * place, in the one shape every feature reads, and the registry that says which
 * kind a dropped document becomes. Pure over plain data, so it imports under
 * Node and is unit-tested offline.
 *
 * A thing is `{id, kind, ref, hidden, hint, point, params, layers, state}`:
 *
 * - `ref` is the uuid of the document the thing stands for (a pointer, never a
 *   copy), or null for a thing that stands for nothing but itself;
 * - `hidden` and `hint` are authored: the thing starts unseen by players, and
 *   the Judge's optional line the table sees when something more remains;
 * - `point` is `{x, y}` in scene pixels where a map drop put it, else null;
 * - `params` is the kind registrant's authored figures;
 * - `layers` is `{hasty?, methodical?}`, whose keys belong to the feature that
 *   reads them: it arrives here as a normalizer argument, never as an import;
 * - `state` is runtime progress, and the only part a Reset clears.
 *
 * `params` and `state` are the registrants' own and are kept whole, unknown
 * keys included: this file never strips what it does not know. The list is
 * written whole by one GM client, so whatever `normalizeThings` drops is gone
 * at the next write; the drop set is three cases and no more (see there).
 */

/** The kinds of thing a place carries. */
export const THING_KINDS = Object.freeze({
  BODY: "body",
  CONTAINER: "container",
  FIXTURE: "fixture",
  EXIT: "exit",
  TRAP: "trap",
  OBSTACLE: "obstacle",
  CONDITION: "condition",
  LOT: "lot",
  FLOOR: "floor",
});

const KIND_VALUES = new Set(Object.values(THING_KINDS));

/** The layer names a thing may carry. */
export const LAYER_NAMES = Object.freeze(["hasty", "methodical"]);

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A deep copy of plain data, so a returned list shares nothing with its input. */
const copy = (value) => structuredClone(value);

/** `{x, y}` from two finite numbers, else null. */
function pointOf(raw) {
  if (!isPlain(raw)) return null;
  const x = raw.x === null || raw.x === "" ? NaN : Number(raw.x);
  const y = raw.y === null || raw.y === "" ? NaN : Number(raw.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * One thing in its signed shape, or null when it is not a thing (not an
 * object, or a kind this module does not name). A missing id reads as "" and
 * `normalizeThings` / `addThing` assign one.
 *
 * @param {object} raw
 * @param {object} [options]
 * @param {(layer: object, name: string, thing: object) => object|null} [options.layer]
 *   the feature's normalizer for one authored layer; absent, a layer is kept as given.
 *   Returning null drops that layer.
 */
export function normalizeThing(raw, { layer = null } = {}) {
  if (!isPlain(raw) || !KIND_VALUES.has(raw.kind)) return null;
  const hint = typeof raw.hint === "string" ? raw.hint.trim() : "";
  const thing = {
    id: typeof raw.id === "string" ? raw.id.trim() : "",
    kind: raw.kind,
    ref: typeof raw.ref === "string" && raw.ref ? raw.ref : null,
    hidden: raw.hidden === true,
    hint: hint || null,
    point: pointOf(raw.point),
    params: isPlain(raw.params) ? copy(raw.params) : {},
    layers: {},
    state: isPlain(raw.state) ? copy(raw.state) : {},
  };
  for (const name of LAYER_NAMES) {
    const authored = raw.layers?.[name];
    if (!isPlain(authored)) continue;
    const kept = layer ? layer(copy(authored), name, thing) : copy(authored);
    if (isPlain(kept)) thing.layers[name] = kept;
  }
  return thing;
}

/**
 * The next id a list has no use for: `thing-<n>` past the highest `thing-<n>`
 * already in it. An id is never reused below the highest, so a reference to a
 * removed thing does not land on a later one unless the highest was removed.
 */
export function nextThingId(list) {
  let top = 0;
  for (const thing of list ?? []) {
    const match = /^thing-(\d+)$/.exec(thing?.id ?? "");
    if (match) top = Math.max(top, Number(match[1]));
  }
  return `thing-${top + 1}`;
}

/**
 * A stored list read into its signed shape: a NEW list, the input untouched.
 * It drops exactly three cases: an entry that is not an object, an entry whose
 * kind is not one of `THING_KINDS`, and a second entry carrying an id an
 * earlier one holds. A missing id is assigned, never dropped. Unknown keys
 * inside `params` and `state` are kept.
 *
 * @param {object[]} list
 * @param {object} [options] see `normalizeThing`
 */
export function normalizeThings(list, options = {}) {
  const out = [];
  const taken = new Set();
  const unnamed = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const thing = normalizeThing(raw, options);
    if (!thing) continue;
    if (thing.id) {
      if (taken.has(thing.id)) continue;
      taken.add(thing.id);
    } else unnamed.push(thing);
    out.push(thing);
  }
  for (const thing of unnamed) {
    thing.id = nextThingId(out);
    taken.add(thing.id);
  }
  return out;
}

/**
 * The list with one thing added: a NEW list, the inputs untouched. The thing
 * is normalized; an id it does not carry comes from `makeId` (default
 * `nextThingId`). A kind this module does not name, or an id the list already
 * holds, throws: both are a caller's bug and a silent drop would lose the drop.
 *
 * @param {object[]} list
 * @param {object} thing
 * @param {object} [options] `layer` as in `normalizeThing`, and
 *   `makeId(list)` for the id of a thing that has none
 */
export function addThing(list, thing, { layer = null, makeId = nextThingId } = {}) {
  const next = normalizeThings(list, { layer });
  const added = normalizeThing(thing, { layer });
  if (!added) throw new TypeError("addThing: not a thing of a known kind");
  added.id = added.id || makeId(next);
  if (next.some((held) => held.id === added.id)) throw new RangeError(`addThing: id ${added.id} is taken`);
  next.push(added);
  return next;
}

/** The list without the thing of this id: a NEW list, the input untouched. */
export function removeThing(list, id, options = {}) {
  return normalizeThings(list, options).filter((thing) => thing.id !== id);
}

/**
 * The list with one thing's `state` cleared: a NEW list, the input untouched.
 * Its authored fields (`hidden`, `hint`, `point`, `params`, `layers`) stay, and
 * so does every other thing. An id the list does not hold changes nothing.
 */
export function resetThing(list, id, options = {}) {
  return normalizeThings(list, options).map((thing) => (thing.id === id ? { ...thing, state: {} } : thing));
}

/**
 * The list with one thing patched, found by id: a NEW list, the input untouched.
 * `patch.hidden`, when a boolean, replaces the thing's `hidden`; `patch.state`
 * names keys of its `state`, each replacing the stored value whole (so an
 * emptied ledger is empty, not merged back) while every key the patch does not
 * name stays. Nothing else is writable here. An id the list does not hold
 * changes nothing.
 *
 * @param {object[]} list
 * @param {string} id
 * @param {{hidden?: boolean, state?: object}} patch
 * @param {object} [options] see `normalizeThing`
 */
export function patchThing(list, id, patch, options = {}) {
  return normalizeThings(list, options).map((thing) => {
    if (thing.id !== id) return thing;
    const state = { ...thing.state };
    for (const [key, value] of Object.entries(isPlain(patch?.state) ? patch.state : {})) {
      if (value !== undefined) state[key] = copy(value);
    }
    return { ...thing, hidden: typeof patch?.hidden === "boolean" ? patch.hidden : thing.hidden, state };
  });
}

/**
 * `base` with `patch` merged over it, key by key: a plain object merges one
 * level down, a `null` removes the key, `undefined` is skipped and anything
 * else (an array included) replaces the stored value whole. A new object.
 */
function mergeAuthored(base, patch) {
  const out = isPlain(base) ? copy(base) : {};
  for (const [key, value] of Object.entries(isPlain(patch) ? patch : {})) {
    if (value === undefined) continue;
    if (value === null) delete out[key];
    else if (isPlain(value) && isPlain(out[key])) out[key] = mergeAuthored(out[key], value);
    else if (isPlain(value)) out[key] = mergeAuthored({}, value);
    else out[key] = copy(value);
  }
  return out;
}

/**
 * The list with the authored half of some things changed: a NEW list, the input
 * untouched. Each edit is `{id, patch}`, found by id; an id the list does not
 * hold changes nothing. `patch.hidden`, when a boolean, replaces `hidden`;
 * `patch.hint`, a string or null, replaces `hint`; `patch.layers` names layers
 * (`LAYER_NAMES`), each a patch merged over the stored layer key by key
 * (`null` removes a key, a plain object merges one level down, an array
 * replaces the stored one) or `null` to remove the layer. A layer left with no
 * keys is removed. `state`, `params`, `ref`, `point` and `kind` are never
 * written here, and a layer key the patch does not name stays as stored, so a
 * caller holding an overlaid view (a feature's runtime keys laid over the
 * authored layer) writes only the keys it names.
 *
 * @param {object[]} list
 * @param {Array<{id: string, patch: {hidden?: boolean, hint?: string|null, layers?: object}}>} edits
 * @param {object} [options] see `normalizeThing`
 */
export function reviseThings(list, edits, options = {}) {
  const byId = new Map();
  for (const edit of Array.isArray(edits) ? edits : []) if (isPlain(edit) && typeof edit.id === "string") byId.set(edit.id, edit.patch);
  return normalizeThings(list, options).map((thing) => {
    if (!byId.has(thing.id)) return thing;
    const patch = isPlain(byId.get(thing.id)) ? byId.get(thing.id) : {};
    const next = { ...thing, layers: { ...thing.layers } };
    if (typeof patch.hidden === "boolean") next.hidden = patch.hidden;
    if (patch.hint === null || typeof patch.hint === "string") next.hint = (patch.hint ?? "").trim() || null;
    for (const name of LAYER_NAMES) {
      if (!isPlain(patch.layers) || !(name in patch.layers) || patch.layers[name] === undefined) continue;
      const merged = patch.layers[name] === null ? null : mergeAuthored(next.layers[name], patch.layers[name]);
      if (merged && Object.keys(merged).length) next.layers[name] = merged;
      else delete next.layers[name];
    }
    return next;
  });
}

/* -------------------------------------------- */
/*  What a drop becomes                          */
/* -------------------------------------------- */

const KIND_TABLE = new Map();

/**
 * Register one kind of thing with what it accepts. The ONE table: a feature
 * names the kind it owns and a predicate over the drop descriptor (an opaque
 * object, typically `{documentName, type, uuid, document}`). A kind has one
 * registrant; registering it again throws. Returns the unregister function.
 *
 * @param {string} kind one of `THING_KINDS`
 * @param {object} spec
 * @param {(drop: object) => boolean} spec.accepts
 */
export function registerThingKind(kind, { accepts }) {
  if (!KIND_VALUES.has(kind)) throw new RangeError(`registerThingKind: ${kind} is not a thing kind`);
  if (typeof accepts !== "function") throw new TypeError("registerThingKind: accepts must be a function");
  if (KIND_TABLE.has(kind)) throw new Error(`registerThingKind: ${kind} already has a registrant`);
  const entry = { accepts };
  KIND_TABLE.set(kind, entry);
  return () => {
    if (KIND_TABLE.get(kind) === entry) KIND_TABLE.delete(kind);
  };
}

/** Every registered kind that accepts this drop, in the order they registered. */
export function kindsAccepting(drop) {
  const kinds = [];
  for (const [kind, { accepts }] of KIND_TABLE) if (accepts(drop)) kinds.push(kind);
  return kinds;
}

/**
 * The one kind this drop becomes, or null when no kind accepts it or more than
 * one does (an ambiguous drop is the caller's to ask about, from
 * `kindsAccepting`).
 */
export function kindOfDrop(drop) {
  const kinds = kindsAccepting(drop);
  return kinds.length === 1 ? kinds[0] : null;
}
