/**
 * How a sheet writes a list of rows without losing what it does not show.
 * Foundry-free, so the harness can assert it.
 *
 * An array field is updated by replacing it whole, and each row is cleaned as
 * a complete value: a row field the form does not render resets to its schema
 * initial, and an update keyed through a row's index
 * (`system.templates.0.abilities`) replaces the outer list with that one row.
 * `keepUnrenderedFields` answers the first from a sheet's `_processFormData`;
 * `rowListUpdate` answers the second for its add and delete controls.
 */

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isIndex = (key) => /^\d+$/.test(key);

/**
 * Fill each array element in `submitted` (a sheet's expanded form data) with
 * whatever its stored twin in `source` (the document's `_source`) holds and
 * the form did not send; mutates and returns `submitted`.
 *
 * A submitted value always wins and a stored one only fills an absence, at
 * every depth of the element. The form still decides how many elements an
 * array holds: an element is never added or dropped here. Outside arrays
 * nothing is filled, since an update merges plain objects and already keeps
 * what was not sent.
 */
export function keepUnrenderedFields(submitted, source) {
  descend(submitted, source);
  return submitted;
}

function descend(sent, stored) {
  if (!isRecord(sent) || !isRecord(stored)) return;
  for (const [key, value] of Object.entries(sent)) {
    const prior = stored[key];
    if (Array.isArray(prior) && (Array.isArray(value) || isRecord(value))) fillSlots(value, prior);
    else descend(value, prior);
  }
}

/** The form sends an array as one or keyed by index; only index keys are slots. */
function fillSlots(sent, stored) {
  for (const key of Object.keys(sent)) {
    if (isIndex(key)) sent[key] = fillElement(sent[key], stored[Number(key)]);
  }
}

function fillElement(sent, stored) {
  if (Array.isArray(stored) && (Array.isArray(sent) || isRecord(sent))) fillSlots(sent, stored);
  else if (isRecord(sent) && isRecord(stored)) {
    for (const [key, value] of Object.entries(stored)) {
      sent[key] = key in sent ? fillElement(sent[key], value) : structuredClone(value);
    }
  }
  return sent;
}

/**
 * The update that applies `change` to the list of rows at `path` (dotted,
 * inside `system`) and writes it without losing a row: a path through a row of
 * an outer list writes that outer list whole. `system` is a plain copy of the
 * document's system source and is mutated; `change(list)` edits the list in
 * place. Returns null when a row on the path no longer exists.
 */
export function rowListUpdate(system, path, change) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((node, key) => (node !== null && typeof node === "object" ? node[key] : undefined), system);
  if (parent === null || typeof parent !== "object") return null;
  if (!Array.isArray(parent[last])) parent[last] = [];
  change(parent[last]);
  const cut = keys.findIndex(isIndex);
  const outer = cut < 0 ? [...keys, last] : keys.slice(0, cut);
  return { [`system.${outer.join(".")}`]: outer.reduce((node, key) => node[key], system) };
}
