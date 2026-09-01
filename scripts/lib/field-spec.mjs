/**
 * Field specs — a shape a form can be built from, described as data.
 *
 * Two things now need to record fields nobody shipped: a base type's metadata
 * (what a gem records that a loaf does not) and a variation entry's own storage
 * (a named weapon's ladder). Both are content, so both arrive from
 * the importer with the GM's own book behind them — which means neither can
 * be a hand-written Handlebars fieldset, because the fields are not known when
 * the template is written.
 *
 * So a spec is a list of field descriptions, and one renderer builds the form.
 * The VOCABULARY here ships — `"number"` is how the code names a kind of input,
 * not something read off a page. Every spec that uses it is imported.
 *
 * Foundry-free on purpose: the coercion and validation below are what the
 * offline suite checks, and a spec is just data.
 */

/**
 * The kinds of field a spec may declare. Deliberately small: this is a form
 * over imported data, not a schema language. Anything that needs more than
 * these is a variation with its own tab and its own code.
 */
export const FIELD_KIND = Object.freeze({
  number: "number",
  text: "text",
  boolean: "boolean",
  /** One of `choices` — the imported spec supplies both keys and labels. */
  select: "select",
  /** Long-form prose the reader writes. */
  prose: "prose",
});

/**
 * One field, as a definition declares it.
 *
 * @typedef {object} FieldSpec
 * @property {string} key      where the value is stored on the entry
 * @property {string} kind     one of `FIELD_KIND`
 * @property {string} [label]  imported words; the key is a poor fallback
 * @property {string} [hint]
 * @property {number} [min]    numbers only
 * @property {number} [max]
 * @property {Array<{value: string, label: string}>} [choices] select only
 * @property {*} [initial]
 */

/** Is this a spec this version knows how to render and coerce? */
export function isUsableSpec(spec) {
  if (!spec || typeof spec.key !== "string" || !spec.key) return false;
  if (!Object.hasOwn(FIELD_KIND, spec.kind)) return false;
  if (spec.kind === FIELD_KIND.select) return Array.isArray(spec.choices) && spec.choices.length > 0;
  return true;
}

/**
 * The specs a caller can actually use, with the rest reported rather than
 * dropped silently.
 *
 * An imported spec can name a field kind a later version of the importer knows
 * and this one does not. Rendering nothing for it would lose the reader's data
 * with no explanation, so the unusable ones come back named and the caller says
 * so on the sheet.
 *
 * @returns {{fields: FieldSpec[], unusable: string[]}}
 */
export function usableSpecs(specs) {
  const fields = [];
  const unusable = [];
  for (const spec of specs ?? []) {
    if (isUsableSpec(spec)) fields.push(spec);
    else if (spec?.key) unusable.push(spec.key);
  }
  return { fields, unusable };
}

/**
 * Coerce one submitted value to what its spec asked for.
 *
 * A form hands back strings for everything. Clamping happens here rather than
 * at the input, because an imported spec's `min`/`max` are the book's and a
 * value outside them is a data error worth correcting once, not a validation
 * message per keystroke.
 */
export function coerceField(spec, value) {
  switch (spec?.kind) {
    case FIELD_KIND.number: {
      const n = Number(value);
      if (!Number.isFinite(n)) return Number.isFinite(spec.initial) ? spec.initial : 0;
      const lo = Number.isFinite(spec.min) ? Math.max(n, spec.min) : n;
      return Number.isFinite(spec.max) ? Math.min(lo, spec.max) : lo;
    }
    case FIELD_KIND.boolean:
      return value === true || value === "true" || value === "on" || value === 1;
    case FIELD_KIND.select: {
      const allowed = (spec.choices ?? []).map((c) => c.value);
      return allowed.includes(value) ? value : (spec.initial ?? allowed[0] ?? "");
    }
    case FIELD_KIND.text:
    case FIELD_KIND.prose:
      return value == null ? "" : String(value);
    default:
      return value;
  }
}

/**
 * Coerce a whole payload against a spec list.
 *
 * Keys the spec does not mention are KEPT untouched. An importer that drops a
 * field from a definition must not thereby delete what a Judge already recorded
 * under it — the data outlives the spec that described it, and a later import
 * may bring the field back.
 */
export function coerceData(specs, data = {}) {
  const out = { ...data };
  for (const spec of specs ?? []) {
    if (!isUsableSpec(spec)) continue;
    out[spec.key] = coerceField(spec, Object.hasOwn(data, spec.key) ? data[spec.key] : spec.initial);
  }
  return out;
}

/** A blank payload for a spec list — every field at its declared initial. */
export const blankData = (specs) => coerceData(specs, {});
