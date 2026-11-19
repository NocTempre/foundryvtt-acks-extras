/**
 * The Crossing fieldset of the keying rail, on plain data: which crossing keys
 * an obstacle thing's rail offers, how each reads off the thing's `params`, and
 * the edit a field's change makes. Nothing here touches a Foundry global, and
 * nothing here imports the crossing: the readers the seed uses arrive as
 * `readers` (`formation/hazard-logic.mjs`'s `PARAM_KEYS`, `PICK_KEYS`,
 * `SQUEEZE_SHAPES`, `setupKeysOf`, `readParam`, `readPick`, `penaltyPicksOf`,
 * with `figureRefKey` from `hazard-keys.mjs`), so the editor shows and writes
 * exactly what `crossingSeed` accepts, and `keying-logic.mjs` stays loadable
 * with no globals.
 *
 * A kind offers the setup keys it reads that a place may carry: a climb
 * obstacle its length and depth, a jump its gap and depth, a squeeze its shape
 * and length, a swim its penalty pick and the larger figure. A stored value the
 * seed would not accept shows as not set, and a blank field removes its key, so
 * the crossing panel's own default stands. The penalty select is built from the
 * steps the world imported, never from a list shipped here.
 */
import { KEYING_REFUSAL, ROOT } from "./keying-logic.mjs";

const CROSSING = `${ROOT}crossing.`;
const FORMATION = "ACKS-FORMATION.crossing.";

/** The lang key of each field's caption, as the crossing panel words it. */
const LABEL_KEYS = Object.freeze({
  length: `${FORMATION}length`,
  gap: `${FORMATION}gap`,
  depth: `${FORMATION}depth`,
  shape: `${FORMATION}squeeze.shape.label`,
  penaltyPick: `${FORMATION}swim.penalty`,
  penaltyLarger: `${FORMATION}swim.largerField`,
});

const isBlank = (value) => value === null || value === undefined || String(value).trim() === "";

/**
 * The keys an obstacle of `kind` offers: what the crossing reads for that kind,
 * restricted to the figures and picks a thing's `params` may carry, in the
 * crossing's own order. A kind that is no obstacle offers none.
 * @param {string|null} kind the thing's hazard key
 * @param {object} readers see the file header
 * @returns {string[]}
 */
export function offeredKeys(kind, readers) {
  const carried = new Set([...readers.PARAM_KEYS, ...readers.PICK_KEYS]);
  return readers.setupKeysOf(kind).filter((key) => carried.has(key));
}

/** The select's rows: a "not set" row, then each option, one selected. */
function selectRows(rows, current, t) {
  return [{ value: "", label: t(`${CROSSING}unset`) }, ...rows].map((row) => ({ ...row, selected: row.value === current }));
}

/**
 * The Crossing fieldset of one entry, ready to draw, or null where the entry is
 * no obstacle thing of a kind that offers a field.
 *
 * @param {object} entry the scene's entry for the thing, with its `params`
 * @param {object} input
 * @param {string|null} input.kind the hazard key its `ref` resolves to
 * @param {number[]|null} input.steps the imported water-penalty sizes, or null while none are
 * @param {object} input.readers see the file header
 * @param {(key: string, data?: object) => string} input.t the words
 * @returns {{fields: object[]}|null}
 */
export function crossingOf(entry, { kind, steps, readers, t }) {
  if (entry?.kind !== "obstacle") return null;
  const keys = offeredKeys(kind, readers);
  if (!keys.length) return null;
  const picks = readers.penaltyPicksOf(steps);
  const params = entry.params ?? {};
  const ref = t(`${FORMATION}ref.${readers.figureRefKey(kind)}`);
  const pick = readers.readPick("penaltyPick", params.penaltyPick, {}, picks) ?? "";
  const fields = keys.map((key) => {
    const label = t(LABEL_KEYS[key]);
    const base = { key, label, tip: [t(`${CROSSING}tip`, { field: label }), ref].join(" · ") };
    if (readers.PARAM_KEYS.includes(key)) return { ...base, number: true, value: readers.readParam(key, params[key]) ?? "", disabled: false };
    if (key === "penaltyLarger") return { ...base, number: true, value: readers.readPick(key, params[key], { penaltyPick: pick }, picks) ?? "", disabled: pick !== "larger" };
    if (key === "shape") {
      const shape = readers.readPick(key, params[key], {}, picks) ?? "";
      return { ...base, options: selectRows(readers.SQUEEZE_SHAPES.map((value) => ({ value, label: t(`${FORMATION}squeeze.shape.${value}`) })), shape, t) };
    }
    const rows = [
      { value: "none", label: t(`${FORMATION}swim.penaltyNone`) },
      ...(Array.isArray(steps) ? steps : []).map((size, i) => ({ value: String(size), label: t(`${FORMATION}swim.penaltyStep`, { n: i + 1, size }) })),
      { value: "larger", label: t(`${FORMATION}swim.penaltyLarger`) },
    ];
    return { ...base, options: selectRows(rows, pick, t) };
  });
  return { fields };
}

/**
 * The edits one change of a Crossing field makes, from the list as stored:
 * `{edits, refusal}` as `editsFor` answers. A change is `{field, value}`, the
 * field one of the kind's offered keys. A blank value removes the key; a figure
 * the crossing's reader refuses removes it too, as the panel's own save does; a
 * pick that is not listed is refused. Leaving the larger pick removes the larger
 * figure with it, and a larger figure is written only while the pick is larger,
 * so what is stored never exceeds what `crossingSeed` accepts.
 *
 * @param {object[]} list the place's things as stored
 * @param {string} id the thing being keyed
 * @param {{field: string, value?: *}} change
 * @param {object} input
 * @param {string|null} input.kind the hazard key the thing's `ref` resolves to
 * @param {number[]|null} input.steps the imported water-penalty sizes, or null while none are
 * @param {object} input.readers see the file header
 */
export function crossingEdits(list, id, change, { kind, steps, readers }) {
  const thing = (Array.isArray(list) ? list : []).find((held) => held.id === id);
  if (!thing) return { edits: [], refusal: KEYING_REFUSAL.GONE };
  const { field, value } = change ?? {};
  if (thing.kind !== "obstacle" || !offeredKeys(kind, readers).includes(field)) return { edits: [], refusal: KEYING_REFUSAL.FIELD };
  const one = (params) => ({ edits: [{ id, patch: { params } }], refusal: null });
  if (readers.PARAM_KEYS.includes(field)) return one({ [field]: readers.readParam(field, value) ?? null });
  if (isBlank(value)) return one(field === "penaltyPick" ? { penaltyPick: null, penaltyLarger: null } : { [field]: null });
  const picks = readers.penaltyPicksOf(steps);
  if (field === "penaltyLarger") {
    const stored = readers.readPick("penaltyPick", thing.params?.penaltyPick, {}, picks);
    if (stored !== "larger") return { edits: [], refusal: KEYING_REFUSAL.FIELD };
    return one({ penaltyLarger: readers.readPick(field, value, { penaltyPick: stored }, picks) ?? null });
  }
  const pick = readers.readPick(field, value, {}, picks);
  if (pick === undefined) return { edits: [], refusal: KEYING_REFUSAL.FIELD };
  return one(field === "penaltyPick" && pick !== "larger" ? { penaltyPick: pick, penaltyLarger: null } : { [field]: pick });
}
