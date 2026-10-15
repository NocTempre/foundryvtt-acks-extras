/**
 * The official character sheet's fillable form, read and written through an
 * open pdf.js document. Every field is found by hashing the name the reader's
 * own copy carries (`form-keys.mjs`), so nothing here knows what a field is
 * called — only what it means.
 *
 * Foundry-free: the document is opened by the caller (`openBook` in the
 * browser, the same pdf.js under Node in the suites), and a test can hand in
 * any object with `numPages`, `getPage(n).getAnnotations()` and, for a write,
 * `annotationStorage.setValue` and `saveDocument`.
 */
import { hash36 } from "../../importer/printed-name.mjs";
import { FORM_FIELDS } from "./form-keys.mjs";

/** Field kinds, as the key table writes them. */
export const KIND = Object.freeze({ text: "t", multiLine: "m", radio: "r", checkbox: "c" });

/** Every key the form carries → its kind. */
export const FORM_KEYS = Object.freeze(Object.fromEntries(Object.values(FORM_FIELDS)));

/** How many of the form's keys a file must carry to be read as the form. */
export const FINGERPRINT_SHARE = 0.9;

/** The module key a field name maps to, or null for a field the form does not have. */
export const keyOfField = (name) => FORM_FIELDS[hash36(name)]?.[0] ?? null;

/** Whether a key names a box that holds text rather than a tick. */
export const isTextKey = (key) => FORM_KEYS[key] === KIND.text || FORM_KEYS[key] === KIND.multiLine;

/**
 * Every widget on every page that maps to a key: its annotation id (what a
 * write addresses), its key and kind, and what it holds now — text with its
 * line breaks made `\n`, or whether a tick box is ticked.
 * @param {object} doc an open pdf.js document
 * @param {{fields?: Record<string, [string, string]>}} [options] the hash →
 *   `[key, kind]` table to read by; the shipped form's unless a suite hands
 *   in one of invented names
 * @returns {Promise<{widgets: Array<{id: string, key: string, kind: string, value: string|boolean}>, unknown: number}>}
 */
export async function formWidgets(doc, { fields = FORM_FIELDS } = {}) {
  const widgets = [];
  let unknown = 0;
  for (let p = 1; p <= (doc?.numPages ?? 0); p++) {
    const page = await doc.getPage(p);
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Widget" || !a.fieldName) continue;
      const [key, kind] = fields[hash36(a.fieldName)] ?? [];
      if (!key) {
        unknown++;
        continue;
      }
      let value;
      if (kind === KIND.radio) value = a.fieldValue != null && a.fieldValue !== "Off" && a.fieldValue === a.buttonValue;
      else if (kind === KIND.checkbox) value = a.fieldValue != null && a.fieldValue !== "Off" && a.fieldValue === a.exportValue;
      else value = String(a.fieldValue ?? "").replace(/\r\n?/g, "\n");
      widgets.push({ id: a.id, key, kind, value });
    }
  }
  return { widgets, unknown };
}

/**
 * Read the form: what each key holds, and whether the file is the form at all.
 * A file is the form when it carries at least `FINGERPRINT_SHARE` of the keys;
 * a printing that adds or renames a few fields still reads, and a book or the
 * flattened sheet (no fields) never does.
 * @param {object} doc an open pdf.js document
 * @param {{fields?: Record<string, [string, string]>}} [options] as `formWidgets`
 * @returns {Promise<{isForm: boolean, share: number, values: Record<string, string|boolean>, unknown: number}>}
 */
export async function readForm(doc, { fields = FORM_FIELDS } = {}) {
  const { widgets, unknown } = await formWidgets(doc, { fields });
  const values = {};
  for (const w of widgets) values[w.key] = w.value;
  const total = Object.keys(fields).length;
  const share = total ? Object.keys(values).length / total : 0;
  return { isForm: share >= FINGERPRINT_SHARE, share, values, unknown };
}

/**
 * Only what a reader filled in: text with something in it, ticks that are on.
 * What `flags["acks-extras"].sheetPdf.fields` keeps.
 */
export function filledValues(values) {
  return Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => (typeof v === "boolean" ? v : String(v ?? "").trim() !== "")));
}

/**
 * Write `values` into the open form and return the saved file's bytes. Every
 * field the form carries is written — a key `values` does not name is cleared —
 * so a copy that was already filled in comes back holding this character and
 * nobody else.
 * @param {object} doc an open pdf.js document of the form
 * @param {Record<string, string|number|boolean>} values key → text, or a tick
 * @param {{fields?: Record<string, [string, string]>}} [options] as `formWidgets`
 * @returns {Promise<Uint8Array>}
 */
export async function fillForm(doc, values, { fields = FORM_FIELDS } = {}) {
  const { widgets } = await formWidgets(doc, { fields });
  for (const w of widgets) {
    const v = values?.[w.key];
    if (w.kind === KIND.radio || w.kind === KIND.checkbox) doc.annotationStorage.setValue(w.id, { value: !!v });
    else doc.annotationStorage.setValue(w.id, { value: v == null ? "" : String(v) });
  }
  return doc.saveDocument();
}
