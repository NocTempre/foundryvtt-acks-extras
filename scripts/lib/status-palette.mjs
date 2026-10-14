/**
 * The token palette as the Judge arranged it: which statuses a token's HUD
 * offers, in what order, and the ones the Judge added.
 *
 * A status is KNOWN when something offers it: the conditions catalogue, the
 * states the engine reads, the system's tracker, another package, or the
 * Judge. The stored arrangement names ids only, so a status that becomes known
 * later (a catalogue that grew, a package enabled since) takes its source's
 * default instead of being lost, and one that stops being known drops out
 * without a write.
 *
 * Foundry-free: `status-effects.mjs` gathers what is known and writes the
 * result to `CONFIG.statusEffects`; `apps/status-palette-app.mjs` edits it.
 */

/** Where a known status comes from, in the order the editor groups them. */
export const PALETTE_SOURCES = Object.freeze(["condition", "state", "custom", "system", "foreign"]);

/** The fields of an Active Effect a Judge-made status keeps from one dropped on the editor. */
export const CUSTOM_EFFECT_FIELDS = Object.freeze(["system", "duration", "description", "tint"]);

const ID_SHAPE = /^[A-Za-z][A-Za-z0-9-]{1,39}$/;

const strings = (list) => [...new Set((Array.isArray(list) ? list : []).filter((s) => typeof s === "string" && s))];

/**
 * A known status, as `resolvePalette` takes it.
 *
 * @typedef {object} KnownStatus
 * @property {string} id
 * @property {string} source   one of `PALETTE_SOURCES`
 * @property {string} name     an i18n key or plain text
 * @property {string} img
 * @property {boolean} defaultOn  on the palette until the Judge says otherwise
 * @property {boolean} keep       stays registered while off the palette, because code toggles it by id
 * @property {object} [data]      further status-effect fields, passed through
 */

/**
 * Why `id` cannot be a new status id, or null when it can: `shape` (not a
 * letter followed by letters, digits and hyphens), `reserved` (a name the list
 * `CONFIG.statusEffects` is built on already answers to), or `taken`.
 *
 * @param {string} id
 * @param {Iterable<string>} taken  ids already known
 * @returns {"shape"|"reserved"|"taken"|null}
 */
export function statusIdError(id, taken = []) {
  if (typeof id !== "string" || !ID_SHAPE.test(id)) return "shape";
  // Foundry keys each status on its array by id, so an id an array already
  // carries (`fill`, `length`) would be read as that member.
  if (id in []) return "reserved";
  if (new Set(taken).has(id)) return "taken";
  return null;
}

/**
 * A free status id made from a name: its letters and digits, hyphenated, with
 * a number appended until nothing known carries it.
 *
 * @param {string} name
 * @param {Iterable<string>} taken
 */
export function slugStatusId(name, taken = []) {
  const used = new Set(taken);
  let base = String(name ?? "")
    .normalize("NFKD")
    // An accent is dropped, so its letter stays in the word.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 32);
  // Too short, or not opening on a letter: the id still needs its shape.
  if (base.length < 2 || !/^[a-z]/.test(base)) base = `status-${base}`.replace(/-+$/g, "");
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!statusIdError(id, used)) return id;
  }
}

/**
 * One Judge-made status as it is stored, or null when it has no usable id,
 * name or icon. `effect` keeps only `CUSTOM_EFFECT_FIELDS`.
 */
export function normalizeCustom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const img = typeof raw.img === "string" ? raw.img.trim() : "";
  if (statusIdError(id) || !name || !img) return null;
  const out = { id, name, img };
  if (raw.effect && typeof raw.effect === "object") {
    const effect = {};
    for (const field of CUSTOM_EFFECT_FIELDS) if (raw.effect[field] !== undefined) effect[field] = raw.effect[field];
    if (Object.keys(effect).length) out.effect = effect;
  }
  return out;
}

/**
 * The stored arrangement in its one shape, whatever was stored.
 *
 * @param {object} raw
 * @returns {{layout: string[], off: string[], custom: object[]}} `layout`: the
 *   ids on the palette, in order; `off`: ids the Judge took off it; `custom`:
 *   the statuses the Judge made, one per id.
 */
export function normalizePalette(raw) {
  const custom = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw?.custom) ? raw.custom : []) {
    const one = normalizeCustom(entry);
    if (!one || seen.has(one.id)) continue;
    seen.add(one.id);
    custom.push(one);
  }
  const layout = strings(raw?.layout);
  return { layout, off: strings(raw?.off).filter((id) => !layout.includes(id)), custom };
}

/**
 * True when the Judge has put the palette in an order. Until then the palette
 * carries no places and a token's HUD lists it by name.
 */
export const isArranged = (setting) => normalizePalette(setting).layout.length > 0;

/**
 * The palette: every known status with whether it is on the palette, where,
 * and whether it is registered at all.
 *
 * A status in `layout` is on, at that place. One in `off` is off. One in
 * neither takes its `defaultOn` and, when on, follows the arranged ones in
 * the order it was given. `registered` is false only for a status that is off
 * and that nothing needs by id.
 *
 * @param {object} setting  the stored arrangement, in any state
 * @param {KnownStatus[]} known  first one wins where two share an id
 * @returns {Array<KnownStatus & {on: boolean, order: number|null, registered: boolean}>}
 *   on-palette entries first, in palette order, then the rest as given
 */
export function resolvePalette(setting, known) {
  const { layout, off } = normalizePalette(setting);
  const byId = new Map();
  for (const entry of known ?? []) if (entry?.id && !byId.has(entry.id)) byId.set(entry.id, entry);

  const offSet = new Set(off);
  const placed = layout.filter((id) => byId.has(id));
  const placedSet = new Set(placed);
  const fresh = [...byId.values()].filter((e) => !placedSet.has(e.id) && !offSet.has(e.id) && e.defaultOn).map((e) => e.id);
  const onIds = [...placed, ...fresh];
  const onSet = new Set(onIds);

  const out = onIds.map((id, order) => ({ ...byId.get(id), on: true, order, registered: true }));
  for (const entry of byId.values()) {
    if (!onSet.has(entry.id)) out.push({ ...entry, on: false, order: null, registered: !!entry.keep });
  }
  return out;
}

/**
 * The arrangement to store for an edited palette. `off` lists only the
 * statuses that would otherwise come back on by default.
 *
 * @param {Array<{id: string, on: boolean, defaultOn?: boolean}>} entries  on-palette entries in palette order
 * @param {object[]} custom  the Judge-made statuses
 * @param {object} [options]
 * @param {boolean} [options.arranged]  false to store no order; a status that
 *   is on only because the Judge put it there then needs one, so it is stored
 *   regardless
 */
export function paletteSetting(entries, custom = [], { arranged = true } = {}) {
  const list = entries ?? [];
  const on = list.filter((e) => e.on);
  return normalizePalette({
    layout: arranged || on.some((e) => !e.defaultOn) ? on.map((e) => e.id) : [],
    off: list.filter((e) => !e.on && e.defaultOn).map((e) => e.id),
    custom,
  });
}

/** True when the stored arrangement changes nothing: every status sits at its source's default. */
export function isDefaultPalette(setting) {
  const { layout, off, custom } = normalizePalette(setting);
  return !layout.length && !off.length && !custom.length;
}
