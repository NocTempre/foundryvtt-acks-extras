/**
 * The inventory bucket: a list of documents a seat drops into a window, each
 * with a value, a fit and a quantity, totalled against an amount due and
 * settled by what the cast came to. One model serves every window that holds
 * goods or victims (a ritual's components, a research project's, a blood
 * sacrifice's victims, an implement set held for a cast); what each window
 * accepts, values, fits, owes and does with its rows is a POLICY its owner
 * writes, so this file names no rule and states no figure.
 *
 * An ENTRY is `{uuid, kind, name, img, qty, cap, value, fit, reason?, effects?}`:
 * `kind` is `item`, `actor`, `token` or `power` (a power row's uuid is a key the
 * caller owns, not a document); `qty` is how many of it count and `cap` the most
 * it can be (the stack, the ledger's balance); `value` is `{gp, each?, source,
 * cite, basis?}` with `gp` null where nothing was read, never zero; `fit` is the
 * key of the policy's fit option the seat holds; `reason` says why a row that was
 * added counts for nothing, and a row with one is dimmed and never totalled;
 * `effects` are the names a part answers to, which the fit match reads.
 *
 * A POLICY is `{accepts, value?, fit, due, parts, settle, verdicts, pick?}`:
 * `accepts` is `{kinds, reason?}` (a drop of another kind is refused, and
 * `reason(entry, doc)` answers a string for a row that is listed but counts for
 * nothing); `value(doc, entry)` replaces the item default and answers a value;
 * `fit` is `{options: [{key, label, tone?, names?}], fallback?}`; `due` is
 * `{gp, cite?}` or null where nothing is read; `parts` are the due's labelled
 * parts for its tooltip; `settle` maps an outcome to an action per entry kind
 * (`settlementPlan`); `verdicts` are the policy's own findings for its owner's
 * plan, which this file never ranks (a Player's block and a Judge's warning
 * belong to the cast plan); `pick: "one"` makes the rows radios.
 *
 * Foundry-free. The writes a settlement makes are `bucket-apply.mjs`'s; the
 * valuation of a part, a creature and a victim is `bucket-value.mjs`'s.
 */
import { LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { foldName } from "./spell-sources.mjs";
import { gpText } from "./money-logic.mjs";
import { stackCountOf } from "./item-model.mjs";
import { itemValue } from "./bucket-value.mjs";

/** The partials a window draws a bucket with: the bucket, and its row (which a list that is not a bucket may draw alone). */
export const BUCKET_TEMPLATE = `modules/${MODULE_ID}/templates/lib/bucket.hbs`;
export const BUCKET_ROW_TEMPLATE = `modules/${MODULE_ID}/templates/lib/bucket-row.hbs`;

/** The lang prefix of every string `bucketView`'s `loc` is asked for; the owning window binds `makeLoc(BUCKET_LANG_PREFIX)`. */
export const BUCKET_LANG_PREFIX = `${LANG_PREFIX}.bucket`;

/** The sources a value's tooltip has a string for; any other source reads `plain`. */
const TIP_SOURCES = new Set(["cost", "components", "xp", "edited", "excluded"]);

/** The kinds of document or figure a row stands for. */
export const ENTRY_KIND = Object.freeze({ item: "item", actor: "actor", token: "token", power: "power" });

/** What a cast came to, which the policy's `settle` map is keyed by. */
export const OUTCOME = Object.freeze({ success: "success", failure: "failure", botch: "botch" });

/** What becomes of a row: spent, left alone, destroyed, or (a creature, never deleted) marked. */
export const SETTLE = Object.freeze({ consume: "consume", keep: "keep", destroy: "destroy", mark: "mark" });

/** Whether the rows reach the amount due; `unknown` where the due or a counted figure was not read. */
export const COVERAGE = Object.freeze({ covered: "covered", short: "short", unknown: "unknown" });

/** The `data-action` values the view's controls carry; the owning window wires them. */
export const BUCKET_ACTIONS = Object.freeze({ remove: "bucketRemove", fit: "bucketFit", pick: "bucketPick" });

/** Foundry's own default icons, the pictures a document with none shows. */
const DEFAULT_IMG = Object.freeze({ item: "icons/svg/item-bag.svg", actor: "icons/svg/mystery-man.svg", token: "icons/svg/mystery-man.svg" });

/** A drop's `type` as the kind of row it makes. */
const DROP_KIND = Object.freeze({ Item: ENTRY_KIND.item, Actor: ENTRY_KIND.actor, Token: ENTRY_KIND.token });

/** The picture a row shows when its document has none; null for a power row, which draws a glyph. */
export const defaultImgFor = (kind) => DEFAULT_IMG[kind] ?? null;

const BLANK_VALUE = Object.freeze({ gp: null, source: "unimported", cite: null });

/** A figure as a finite number, else null; blank and non-numeric are not zero. */
const figure = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Number(n));

/** A whole count of at least one, held to `cap` where there is one. */
function count(qty, cap) {
  const n = Math.max(1, Math.floor(Number(qty)) || 1);
  const top = Number(cap);
  return Number.isFinite(top) && top >= 1 ? Math.min(n, Math.floor(top)) : n;
}

/** The value as stored on an entry: only the known keys, `gp` null where it was not read. */
function valueOf(raw) {
  if (!raw || typeof raw !== "object") return { ...BLANK_VALUE };
  const out = { gp: figure(raw.gp), source: String(raw.source ?? ""), cite: raw.cite ?? null };
  if (figure(raw.each) !== null) out.each = figure(raw.each);
  if (raw.basis && typeof raw.basis === "object") out.basis = { ...raw.basis };
  if (raw.reason) out.reason = String(raw.reason);
  return out;
}

/**
 * Make an entry from its parts. A row's quantity and fit are normalized here
 * and in `withQty` / `withFit`, the only places they change.
 * @param {object} parts `uuid`, `kind`, `name` and `img` of the thing, with `qty`, `cap`, `value`, `fit`, `reason` and `effects` where they are known
 */
export function makeEntry({ uuid, kind, name = "", img = "", qty = 1, cap = null, value = null, fit = "", reason = null, effects = [] } = {}) {
  const top = figure(cap);
  const v = valueOf(value);
  const entry = {
    uuid: String(uuid ?? ""),
    kind: Object.values(ENTRY_KIND).includes(kind) ? kind : ENTRY_KIND.item,
    name: String(name ?? ""),
    img: String(img ?? ""),
    qty: count(qty, top),
    cap: top,
    value: v,
    fit: String(fit ?? ""),
    effects: (Array.isArray(effects) ? effects : []).map((e) => String(e).trim()).filter(Boolean),
  };
  const why = reason ?? v.reason ?? null;
  if (why) entry.reason = String(why);
  return entry;
}

/**
 * The entry for a power row: an amount of a power the caller's ledger holds,
 * capped by what it holds. Its value is the caller's to say (`value`).
 * @param {{key: string, name: string, amount?: number, balance: number, value?: object, fit?: string}} power
 */
export function powerEntry({ key, name, amount = 1, balance, value = null, fit = "" }) {
  const entry = makeEntry({ uuid: `power:${key}`, kind: ENTRY_KIND.power, name, qty: amount, cap: balance, value, fit });
  return value?.each !== undefined ? withQty(entry, entry.qty) : entry;
}

/** The entry at a new quantity: held to `cap`, its value rescaled when it has a per-unit figure. */
export function withQty(entry, qty) {
  const next = count(qty, entry.cap);
  const each = figure(entry.value?.each);
  const value = each === null ? entry.value : { ...entry.value, gp: each * next };
  return { ...entry, qty: next, value };
}

/** The entry with a hand-set value: its figure replaced, its source `edited`, the page it was read from kept. */
export function withValue(entry, gp) {
  const n = figure(gp);
  const value = { ...entry.value, gp: n, source: "edited", basis: { was: figure(entry.value?.gp) } };
  delete value.each;
  delete value.reason;
  return { ...entry, value };
}

/** The entry set to a fit option, or unchanged when the policy offers no such key. */
export function withFit(entry, key, fit) {
  return (fit?.options ?? []).some((o) => o.key === key) ? { ...entry, fit: key } : entry;
}

/** The key after `entry`'s own in the policy's fit options, wrapping: what a press on the chip selects. */
export function nextFit(entry, fit) {
  const keys = (fit?.options ?? []).map((o) => o.key);
  if (!keys.length) return entry.fit;
  const at = keys.indexOf(entry.fit);
  return keys[(at + 1) % keys.length];
}

/**
 * The fit option a row opens on: the first whose `names` any of the row's own
 * names (its name, then its `effects`) match by `foldName`, else the policy's
 * `fallback`, else the first option. A name folds to nothing under three
 * characters and never matches, so an empty label cannot claim every row.
 */
export function preselectFit(entry, fit) {
  const options = fit?.options ?? [];
  if (!options.length) return "";
  const mine = [entry.name, ...(entry.effects ?? [])].map(foldName).filter(Boolean);
  for (const option of options) {
    const wanted = (option.names ?? []).map(foldName).filter((w) => w.length >= 3);
    if (wanted.some((w) => mine.some((m) => m === w || m.includes(w)))) return option.key;
  }
  return fit.fallback && options.some((o) => o.key === fit.fallback) ? fit.fallback : options[0].key;
}

/**
 * Whether a row counts: a row with a `reason` is listed and dimmed and adds
 * nothing to the total or to a settlement.
 */
export const counts = (entry) => !entry.reason;

/**
 * What the counted rows add up to. `gp` is the sum of the figures read and
 * `blank` how many counted rows had none, so a total with a blank in it is
 * never mistaken for the whole.
 * @returns {{gp: number, blank: number}}
 */
export function totalOf(entries) {
  let gp = 0;
  let blank = 0;
  for (const entry of entries ?? []) {
    if (!counts(entry)) continue;
    const n = figure(entry.value?.gp);
    if (n === null) blank += 1;
    else gp += n;
  }
  return { gp, blank };
}

/**
 * The rows against the amount due. `status` is `unknown` where `due` was not
 * read or a counted row has no figure: no coverage is claimed on a guess.
 * @param {object[]} entries
 * @param {{gp: number|null}|number|null} due
 * @returns {{total: number, blank: number, due: number|null, short: number|null, status: string}}
 */
export function coverage(entries, due) {
  const { gp, blank } = totalOf(entries);
  const owed = figure(typeof due === "object" && due !== null ? due.gp : due);
  if (owed === null || blank) return { total: gp, blank, due: owed, short: null, status: COVERAGE.unknown };
  const short = Math.max(0, owed - gp);
  return { total: gp, blank, due: owed, short, status: short > 0 ? COVERAGE.short : COVERAGE.covered };
}

/**
 * Whether a policy takes a drop of this kind, and the reason a taken row
 * counts for nothing.
 * @returns {{ok: boolean, reason: string|null}} `ok` false is a drop refused outright
 */
export function acceptVerdict(policy, entry, doc = null) {
  const kinds = policy?.accepts?.kinds;
  if (Array.isArray(kinds) && !kinds.includes(entry.kind)) return { ok: false, reason: null };
  const reason = policy?.accepts?.reason?.(entry, doc) ?? null;
  return { ok: true, reason: reason ? String(reason) : null };
}

/** An entry for a resolved document of `kind`, valued by the policy, else by the item default. */
function entryOfDoc(doc, kind, uuid, policy, { qty, fit } = {}) {
  const img = doc?.img || doc?.texture?.src || doc?.actor?.img || defaultImgFor(kind) || "";
  const stack = kind === ENTRY_KIND.item ? stackCountOf(doc) : null;
  const cap = stack !== null && stack >= 1 ? stack : kind === ENTRY_KIND.item ? 1 : null;
  const base = makeEntry({ uuid, kind, name: doc?.name ?? "", img, qty: qty ?? cap ?? 1, cap });
  let value = policy?.value ? policy.value(doc, base) : null;
  if (!value && kind === ENTRY_KIND.item) value = itemValue({ cost: doc?.system?.cost, count: base.qty });
  const withV = makeEntry({ ...base, value, effects: value?.effects ?? [] });
  const preset = fit ?? preselectFit(withV, policy?.fit);
  const entry = { ...withV, fit: preset };
  const verdict = acceptVerdict(policy, entry, doc);
  return verdict.reason ? { ...entry, reason: verdict.reason } : entry;
}

/**
 * The entry a drop makes. `resolve(uuid)` (a document or a promise of one,
 * null for none) is injected, so this reads no Foundry global.
 * @param {{type?: string, uuid?: string}|null} data the drag event's data
 * @param {(uuid: string) => *} resolve
 * @param {{policy?: object, present?: object[]}} [options] `present` are the entries already held, whose uuids a drop may not repeat
 * @returns {Promise<{entry: object}|{refused: "noDrop"|"gone"|"kind"|"duplicate", name?: string}>}
 */
export async function entryFromDrop(data, resolve, { policy = null, present = [] } = {}) {
  const kind = DROP_KIND[data?.type];
  if (!kind || !data?.uuid) return { refused: "noDrop" };
  if (present.some((e) => e.uuid === data.uuid)) return { refused: "duplicate" };
  const doc = await resolve(data.uuid);
  if (!doc) return { refused: "gone" };
  const kinds = policy?.accepts?.kinds;
  if (Array.isArray(kinds) && !kinds.includes(kind)) return { refused: "kind", name: doc.name ?? "" };
  return { entry: entryOfDoc(doc, kind, data.uuid, policy) };
}

/**
 * A stored answer's list, `[{uuid, qty, fit}]`, read back into entries: each
 * uuid is resolved again, so a row's value is the document's now, and a
 * document the world no longer holds is named in `gone` and left out. The kind
 * is the document's own (`documentName`). A power row is the caller's to
 * restore, since it names no document.
 * @returns {Promise<{entries: object[], gone: string[]}>}
 */
export async function entriesFromAnswer(list, resolve, { policy = null } = {}) {
  const entries = [];
  const gone = [];
  for (const row of list ?? []) {
    if (!row?.uuid || String(row.uuid).startsWith("power:")) continue;
    const doc = await resolve(row.uuid);
    const kind = DROP_KIND[doc?.documentName];
    if (!doc || !kind) {
      gone.push(row.uuid);
      continue;
    }
    entries.push(entryOfDoc(doc, kind, row.uuid, policy, { qty: row.qty, fit: row.fit || undefined }));
  }
  return { entries, gone };
}

/** The entries as an answer stores them: `[{uuid, qty, fit}]`. */
export const answerOf = (entries) => (entries ?? []).map((e) => ({ uuid: e.uuid, qty: e.qty, fit: e.fit }));

/**
 * What becomes of each row for an outcome. The policy's `settle[outcome]` is an
 * action for every kind or a map `{item, actor, token, power}`; a row it does
 * not name is kept, so an unmapped outcome loses nothing. A creature (`actor`
 * or `token`) is NEVER consumed or destroyed: the action becomes `mark`, which
 * the writer turns into core's dead status. A row that does not count is kept,
 * and where `used` is given (a `pick: "one"` bucket's picked uuid) only that row
 * is acted on. The plan is data; `bucket-apply.mjs` writes it.
 * @param {object[]} entries
 * @param {string} outcome one of `OUTCOME`
 * @param {object} settle
 * @param {{used?: string|null}} [options]
 * @returns {Array<{uuid: string, kind: string, qty: number, action: string}>}
 */
export function settlementPlan(entries, outcome, settle, { used } = {}) {
  const rule = settle?.[outcome];
  return (entries ?? []).map((entry) => {
    const named = typeof rule === "string" ? rule : rule?.[entry.kind];
    let action = Object.values(SETTLE).includes(named) ? named : SETTLE.keep;
    const creature = entry.kind === ENTRY_KIND.actor || entry.kind === ENTRY_KIND.token;
    if (creature && (action === SETTLE.consume || action === SETTLE.destroy)) action = SETTLE.mark;
    if (!counts(entry) || (used !== undefined && entry.uuid !== used)) action = SETTLE.keep;
    return { uuid: entry.uuid, kind: entry.kind, qty: entry.qty, action };
  });
}

/* -------------------------------------------- */
/*  The view                                    */
/* -------------------------------------------- */

/** The figure of a value as a row shows it: its gold, or "" where none was read. */
const valueText = (value) => (figure(value?.gp) === null ? "" : gpText(value.gp));

/** The tooltip of a row's value: where the figure came from, or the page alone where nothing was read. */
function valueTip(value, loc) {
  const cite = value?.cite ?? "";
  if (figure(value?.gp) === null) return cite;
  const basis = value.basis ?? {};
  const data = { gp: gpText(value.gp), each: figure(value.each) === null ? "" : gpText(value.each), cite: cite ? ` (${cite})` : "", ...basis, was: figure(basis.was) === null ? "" : ` (was ${gpText(basis.was)})` };
  const named = TIP_SOURCES.has(value.source) ? value.source : "plain";
  const key = named === "xp" && basis.multiplier === undefined ? "xpPlain" : named;
  return loc(`valueTip.${key}`, { ...data, reason: value.reason ? loc(`barred.${value.reason}`) : "" });
}

/** The `[true, false, ...]` of a diamond strip: filled for what is in force, hollow for what was lost. */
const strip = (d) => (d ? [...Array(Math.max(0, d.filled | 0)).fill(true), ...Array(Math.max(0, d.lost | 0)).fill(false)] : []);

/**
 * What `templates/lib/bucket.hbs` renders. Text is assembled here through the
 * injected `loc(key, data)` (keys under `BUCKET_LANG_PREFIX`, which the caller
 * binds), so the template carries no figure and no string of its own.
 * @param {object} policy
 * @param {object[]} entries
 * @param {object} options
 * @param {string} options.key the bucket's key; it names the radio group and the drop zone
 * @param {(key: string, data?: object) => string} options.loc
 * @param {string} options.legend the heading, already localized
 * @param {string} [options.icon] a Font Awesome class for the heading
 * @param {string|null} [options.picked] a `pick: "one"` bucket's picked uuid
 * @param {Record<string, {caption?: string, captionTip?: string, off?: boolean, reason?: string, diamonds?: {filled: number, lost: number}}>} [options.rows]
 *   the caller's own caption, dimming and diamonds per row, which a `pick: "one"` bucket's rows carry
 * @param {boolean} [options.locked] no X, no fit change, no drop zone
 * @param {string} [options.dropText] the drop zone's wording, already localized; the generic string by default
 * @param {string} [options.emptyText] the wording of an empty bucket, already localized; the generic string by default
 */
export function bucketView(policy, entries, { key, loc, legend = "", icon = "", picked = null, rows = {}, locked = false, dropText = "", emptyText = "" } = {}) {
  const pick = policy?.pick === "one";
  const cover = coverage(entries, policy?.due ?? null);
  const dueText = cover.due === null ? "" : gpText(cover.due);
  const totalText = gpText(cover.total);
  const parts = (policy?.parts ?? []).map((p) => (p.gp === undefined || p.gp === null ? p.label : `${p.label} ${gpText(p.gp)}`)).join(" · ");
  const cite = policy?.due?.cite ?? "";
  let head = null;
  if (!pick) {
    const unread = cover.due === null;
    head = {
      status: cover.status,
      text: unread ? (entries?.length ? totalText : "") : loc("headTotal", { total: totalText, due: dueText }),
      tip: unread ? cite : loc("headTip", { due: dueText, covered: totalText, parts: parts ? `: ${parts}` : "", cite: cite ? ` (${cite})` : "" }),
    };
  }
  const fit = policy?.fit ?? null;
  const viewRows = (entries ?? []).map((entry) => {
    const extra = rows[entry.uuid] ?? {};
    const barred = entry.value?.source === "excluded" && entry.reason === entry.value.reason;
    const reason = extra.reason ?? (barred ? loc(`barred.${entry.reason}`) : entry.reason ?? "");
    const off = Boolean(extra.off) || Boolean(entry.reason);
    const option = fit?.options?.find((o) => o.key === entry.fit) ?? null;
    return {
      uuid: entry.uuid,
      kind: entry.kind,
      name: entry.name,
      qtyText: entry.qty > 1 ? `×${entry.qty}` : "",
      img: entry.img || defaultImgFor(entry.kind) || "",
      glyph: entry.kind === ENTRY_KIND.power && !entry.img ? "fa-bolt" : "",
      removeLabel: loc("remove", { name: entry.name }),
      qtyTip: entry.qty > 1 && entry.cap ? loc("qtyTip", { qty: entry.qty, cap: entry.cap }) : "",
      removeAction: BUCKET_ACTIONS.remove,
      fitAction: BUCKET_ACTIONS.fit,
      pickAction: BUCKET_ACTIONS.pick,
      chips: [],
      caption: extra.caption ?? "",
      captionTip: extra.captionTip ?? "",
      diamonds: strip(extra.diamonds),
      showValue: extra.caption === undefined,
      valueLabel: loc("value"),
      valueText: valueText(entry.value),
      valueBlank: figure(entry.value?.gp) === null,
      valueTip: valueTip(entry.value, loc),
      reason,
      off,
      pick,
      picked: pick && picked === entry.uuid,
      usedLabel: loc("used"),
      radioName: `bucket-${key}`,
      disabled: off || locked,
      locked,
      fit: !pick && option
        ? {
            key: option.key,
            label: option.label,
            tone: option.tone ?? "",
            aria: loc("fitAria", { name: entry.name, fit: option.label }),
            tip: loc("fitTip", { fit: option.label }),
            changeable: !locked && (fit.options.length > 1),
          }
        : null,
    };
  });
  return {
    key,
    pick,
    legend,
    icon,
    head,
    rows: viewRows,
    empty: viewRows.length === 0,
    emptyText: emptyText || loc(pick ? "emptyPick" : "empty"),
    dropLabel: dropText || loc("drop"),
    canDrop: !locked,
  };
}
