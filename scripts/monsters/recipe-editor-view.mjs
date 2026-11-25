/**
 * What the recipe editor's template draws, as plain data: the logic's rows
 * (`recipe-editor-logic.mjs`) and the window's own state in, one context out,
 * and the single change a control makes as the `changes` `savePart` takes.
 * Foundry-free: every string comes through the `loc` the caller passes (a full
 * lang key and its data), and every boolean the template tests is computed here,
 * so the template holds no logic and the window holds no layout.
 *
 * A seat that cannot write gets no edit box, no write button and no sentence
 * button: the context carries `canWrite` and the template draws nothing that
 * writes without it.
 */
import { RECIPE_ROLES } from "./config.mjs";
import { ANIMAL_TYPE, TEMPLATE_TYPE } from "../lib/constants.mjs";
import { MODULE_ID, MONSTER_TYPE } from "./constants.mjs";
import { LINKED_ROLES, editorRows, handCount, laid, mountBeastLink, parseCount, recipeTarget, validatePart } from "./recipe-editor-logic.mjs";

/** The lang root of the editor's strings. */
export const RECIPE_LANG = "ACKS-MONSTERS.recipe";

/** The encounter states a tab names: the values of a part's `when.state`. */
export const RECIPE_STATES = Object.freeze(["wandering", "lair"]);

/** How many library entries a link search lists at once. */
const LINK_LIMIT = 12;

const K = (key) => `${RECIPE_LANG}.${key}`;
const blank = (v) => v === null || v === undefined || (typeof v === "string" && !v.trim());
const text = (v) => (v === null || v === undefined ? "" : String(v));

/* -------------------------------------------- */
/*  One change from one control                  */
/* -------------------------------------------- */

/**
 * A count field's text as the `changes` it makes to `part`. A share part keeps
 * its `ratioOf` and takes a typed percentage as its new `percent`; any other text
 * is `parseCount`'s (a figure, a die, or blank to clear).
 * @param {string} input
 * @param {object} part the stored part
 * @returns {{ok: boolean, count?: object}}
 */
export function countEdit(input, part) {
  const t = text(input).trim();
  const share = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (share && !blank(part?.count?.ratioOf)) return { ok: true, count: { percent: Number(share[1]) } };
  return parseCount(t);
}

/**
 * The `changes` the one control that fired makes, for `savePart`: only that
 * control's field is named, so a field left alone is never rewritten (a share's
 * `ratioOf`, or the other words of `when.units`, survive a change elsewhere).
 * `ok: false` is a count the editor cannot read.
 * @param {string} field the control's `data-field`
 * @param {string|boolean} value its value; a unit word's checkbox gives a boolean
 * @param {object} part the stored part
 * @param {string} [word] the unit word of a `unit` checkbox
 * @returns {{ok: boolean, changes?: object}}
 */
export function changesFor(field, value, part, word = "") {
  switch (field) {
    case "label": case "role": case "cite": case "chance": return { ok: true, changes: { [field]: value } };
    case "morale": return { ok: true, changes: { moraleWhileAlive: value } };
    case "fixedHp": return { ok: true, changes: { fixedHp: value } };
    case "state": return { ok: true, changes: { when: { state: value } } };
    case "unit": {
      const have = (part?.when?.units ?? []).filter((u) => u !== word);
      return { ok: true, changes: { when: { units: value ? [...have, word] : have } } };
    }
    case "count": {
      const r = countEdit(value, part);
      return r.ok ? { ok: true, changes: { count: r.count } } : { ok: false };
    }
    default: return { ok: false };
  }
}

/**
 * The problems a set of changes would give a part, as `{field, key}` (`validatePart`
 * over the stored part with the changes laid over it). A count `changesFor` could not
 * read is a count problem.
 * @param {object} part
 * @param {object} changes
 * @returns {{field: string, key: string}[]}
 */
export const problemsOf = (part, changes) => validatePart(laid(part, changes));

/* -------------------------------------------- */
/*  Which document a door opens                  */
/* -------------------------------------------- */

/** The axes of a template, as plain data. */
const axesOf = (doc) => doc?.system?.toObject?.().axes ?? doc?.system?.axes ?? [];

/**
 * The document and stored recipe an entry point opens. A monster or animal actor
 * opens its own recipe; a family template opens the variant option `optionKey`
 * names; an organisation host (any other actor) opens the option its Roll record
 * names, `hostTemplate` being that record's template (a document) and variant.
 * Nothing opens where the document, the option or the record is missing, and the
 * reason is the lang key tail of the notice that says so.
 * @param {object|null} doc
 * @param {{optionKey?: string, axisKey?: string, hostTemplate?: {doc: object|null, variant: string}|null}} [args]
 * @returns {{ok: true, doc: object, target: object, name: string, option: string}|{ok: false, reason: "noDoc"|"noOption"|"noRecord", name: string}}
 */
export function doorOf(doc, { optionKey = "", axisKey = "variant", hostTemplate = null } = {}) {
  if (!doc) return { ok: false, reason: "noDoc", name: "" };
  const name = text(doc.name);
  if (doc.type === MONSTER_TYPE || doc.type === ANIMAL_TYPE) return { ok: true, doc, target: recipeTarget(doc), name, option: "" };
  const isTemplate = doc.type === TEMPLATE_TYPE || axesOf(doc).length > 0;
  const onTemplate = isTemplate ? doc : hostTemplate?.doc ?? null;
  const key = isTemplate ? optionKey : text(hostTemplate?.variant);
  if (!onTemplate) return { ok: false, reason: "noRecord", name };
  if (!key) return { ok: false, reason: isTemplate ? "noOption" : "noRecord", name };
  const target = recipeTarget(onTemplate, { optionKey: key, axisKey });
  if (!target) return { ok: false, reason: "noOption", name: text(onTemplate.name) };
  const option = axesOf(onTemplate).find((a) => a?.key === axisKey)?.options?.find((o) => o?.key === key);
  return { ok: true, doc: onTemplate, target, name: text(onTemplate.name), option: text(option?.label) || key };
}

/**
 * The extras a target's document carries: the actor's own, or the variant option's.
 * The stored prose and encounter lines the reading pane re-reads are in it.
 * @param {object} doc
 * @param {object} target `recipeTarget`'s answer
 * @returns {object}
 */
export function extrasAt(doc, target) {
  const node = target.kind === "actor" ? doc : axesOf(doc).find((a) => a?.key === target.axisKey)?.options?.find((o) => o?.key === target.optionKey);
  return node?.flags?.[MODULE_ID]?.extras ?? {};
}

/* -------------------------------------------- */
/*  Tooltips                                     */
/* -------------------------------------------- */

/** A tooltip's figures as words: each figure the data holds, named, and the parts' shape where a share or a die is held. */
function readText(data, loc) {
  const out = [];
  if (data.count) out.push(loc(K("figure.count"), { v: data.share ? `${data.count} ${loc(K("figure.of"), { of: data.of })}` : data.count }));
  if (data.round) out.push(loc(K("figure.round"), { v: data.round }));
  if (data.perUnit) out.push(loc(K("figure.per"), { v: data.perUnit }));
  if (data.chance !== "") out.push(loc(K("figure.chance"), { v: data.chance }));
  if (data.morale !== "") out.push(loc(K("figure.morale"), { v: data.morale }));
  if (data.units) out.push(loc(K("figure.units"), { v: data.units }));
  return out.length ? out.join(", ") : loc(K("figure.none"));
}

/** A row's tooltip as text: the logic's lang key and data, the figures composed into `read`. */
const tipText = (tip, loc) => loc(tip.key, { ...tip.data, read: readText(tip.data, loc) }).trim();

/* -------------------------------------------- */
/*  Rows                                         */
/* -------------------------------------------- */

/** A part's count as the table writes it: the text, the share it is of, and the unit it is rolled per. */
function countText(row, recipe, loc) {
  let out = row.count.text;
  if (!out) return "";
  if (row.count.share) {
    const of = row.count.of === "unit" ? loc(K("count.ofUnits")) : recipe.find((p) => p?.key === row.count.of)?.label || row.count.of;
    out = loc(K("count.share"), { text: out, of });
  }
  if (row.count.perUnit) out = loc(K("count.per"), { text: out, unit: row.count.perUnit });
  return out;
}

/** A row as the template draws it, apart from its edit box. */
function rowView(row, { recipe, editKey, canWrite, loc }) {
  const role = row.role ? loc(K(`role.${row.role}`)) : loc(K("role.none"));
  const name = row.label || role;
  const countFigure = countText(row, recipe, loc);
  const rowTip = tipText(row.tip, loc);
  const units = row.when.units.join(", ");
  const chance = row.chance === null ? "" : `${row.chance}%`;
  const figureTip = row.hand ? rowTip : countFigure ? loc(K("tip.figure"), { cite: row.cite }).trim() : row.cite;
  return {
    key: row.key,
    name,
    muted: !row.label,
    role,
    hand: row.hand,
    tip: rowTip,
    countText: countFigure,
    countTip: figureTip,
    countBlank: !countFigure,
    whenText: [units || loc(K("when.any")), chance].filter(Boolean).join(" · "),
    whenTip: figureTip,
    madeOf: row.madeOf,
    cite: row.cite,
    fromText: row.hand ? loc(K("from.hand")) : row.from ? loc(K(`from.${row.from}`)) : "",
    inEdit: canWrite && row.key === editKey,
    editLabel: loc(K("row.edit"), { name }),
    edit: null,
  };
}

/* -------------------------------------------- */
/*  A part in edit                               */
/* -------------------------------------------- */

/**
 * The fields of the part in edit and what sits around them. A field shows what a
 * hand typed and `savePart` refused (the draft) over what is stored, with its problem
 * beside it.
 */
function editView(part, row, ctx) {
  const { loc, draft, readCopy, words, library } = ctx;
  const mine = draft?.key === part.key ? draft : null;
  const value = (field, stored) => (mine && field in mine.values ? mine.values[field] : stored);
  const error = (field) => { const p = mine?.problems.find((x) => x.field === field); return p ? loc(p.key) : ""; };
  const cite = row.cite;
  const figureTip = (blankFigure) => (row.hand ? tipText(row.tip, loc) : blankFigure ? cite : loc(K("tip.figure"), { cite }).trim());
  const textField = (name, stored, extra = {}) => ({ name, isText: true, value: value(name, stored), label: loc(K(`field.${name}`)), hint: loc(K(`hint.${name}`)), error: error(name), tip: "", ...extra });
  const numberField = (name, stored, blankFigure) => ({ ...textField(name, stored), isText: false, isNumber: true, tip: figureTip(blankFigure && !value(name, stored)) });
  const selectField = (name, stored, options) => ({
    name, isSelect: true, label: loc(K(`field.${name}`)), hint: loc(K(`hint.${name}`)), error: error(name), tip: "",
    options: options.map((o) => ({ ...o, selected: o.value === value(name, stored) })),
  });

  const fields = [
    textField("label", part.label),
    selectField("role", part.role, [{ value: "", label: loc(K("role.none")) }, ...Object.keys(RECIPE_ROLES).map((r) => ({ value: r, label: loc(K(`role.${r}`)) }))]),
    { ...textField("count", row.count.text), tip: figureTip(!row.count.text) },
    numberField("chance", row.chance ?? "", row.chance === null),
    selectField("state", part.when?.state ?? "", [{ value: "", label: loc(K("state.either")) }, ...RECIPE_STATES.map((s) => ({ value: s, label: loc(K(`state.${s}`)) }))]),
    numberField("morale", part.moraleWhileAlive ?? "", part.moraleWhileAlive == null),
    textField("cite", part.cite),
    numberField("fixedHp", part.fixedHp ?? "", part.fixedHp == null),
  ];
  // The role being edited decides the link block: a field the draft holds counts, so choosing Mount shows it before the write lands.
  const role = value("role", part.role);
  const linked = LINKED_ROLES.includes(role) ? mountBeastLink({ ...part, role }, library) : null;
  const query = text(ctx.linkQuery).trim().toLowerCase();
  const open = !!linked && (!linked.linked || ctx.changing);
  const entries = !open ? [] : query ? library.filter((e) => e.name.toLowerCase().includes(query)).slice(0, LINK_LIMIT) : linked.candidates;
  const problems = mine?.problems.length ?? 0;
  return {
    fields,
    units: words.map((word) => ({ word, checked: (part.when?.units ?? []).map((u) => u.toLowerCase()).includes(word), aria: loc(K("unit.aria"), { word }) })),
    leaderNote: role === "leader" || role === "caster",
    link: linked && {
      name: linked.linked?.name ?? "",
      uuid: linked.linked?.uuid ?? "",
      isLinked: !!linked.linked,
      open,
      query: ctx.linkQuery ?? "",
      entries: entries.map((e) => ({ uuid: e.uuid, name: e.name, aria: loc(K("link.aria"), { name: e.name }) })),
      searched: !!query,
      none: open && !entries.length,
      openAria: loc(K("link.open"), { name: linked.linked?.name ?? "" }),
    },
    canReset: row.hand && readCopy.some((p) => p?.key === part.key),
    problems,
  };
}

/* -------------------------------------------- */
/*  The reading pane                             */
/* -------------------------------------------- */

/** The stored prose's sentences grouped into their paragraphs, each marked read (by which parts) or unread, and which the part in edit read. */
function paneView(marks, { recipe, editKey, canWrite, loc }) {
  const name = (key) => recipe.find((p) => p?.key === key)?.label || key;
  const paragraphs = [];
  let at = "";
  for (const m of marks) {
    const id = `${m.field}:${m.paragraph}`;
    if (id !== at) { paragraphs.push({ sentences: [] }); at = id; }
    const read = m.keys.length > 0;
    paragraphs.at(-1).sentences.push({
      field: m.field, paragraph: m.paragraph, sentence: m.sentence, text: m.text, read, unread: !read,
      selected: !!editKey && m.keys.includes(editKey),
      keys: m.keys.join(" "),
      press: canWrite,
      tip: read ? loc(K("pane.readBy"), { parts: m.keys.map(name).join(", ") }) : loc(K("pane.unread")),
    });
  }
  const unread = marks.filter((m) => !m.keys.length).length;
  return {
    paragraphs,
    unread,
    hasUnread: unread > 0,
    selected: editKey ? marks.filter((m) => m.keys.includes(editKey)).map((m) => ({ text: m.text })) : [],
  };
}

/* -------------------------------------------- */
/*  The context                                  */
/* -------------------------------------------- */

/**
 * The editor's whole context for one render.
 *
 * @param {object} args
 * @param {object[]} args.recipe the stored recipe, read now
 * @param {object[]} args.readCopy the import's copy
 * @param {"wandering"|"lair"} args.state the tab
 * @param {string} [args.place] the Found in filter; blank shows every place
 * @param {string} [args.editKey] the part in edit
 * @param {{key: string, values: object, problems: {field: string, key: string}[]}|null} [args.draft] what a hand typed that `savePart` refused
 * @param {boolean} args.canWrite Foundry's test of the document written, read at render
 * @param {{name: string, uuid: string}[]} [args.library] the library's actor index
 * @param {boolean} [args.changing] a linked part's creature is being changed
 * @param {string} [args.linkQuery] the library search typed for a link
 * @param {object[]} [args.marks] `sentenceMarks` over the stored prose
 * @param {string} [args.cite] the page the import read
 * @param {(key: string, data?: object) => string} args.loc a full lang key, formatted
 * @returns {object}
 */
export function buildContext({ recipe, readCopy = [], state, place = "", editKey = "", draft = null, canWrite, library = [], changing = false, linkQuery = "", marks = [], cite = "", loc }) {
  const all = (Array.isArray(recipe) ? recipe : []).filter(Boolean);
  const copy = Array.isArray(readCopy) ? readCopy : [];
  const shown = place ? all.filter((p) => blank(p.when?.place) || p.when.place === place) : all;
  const rows = editorRows({ recipe: shown, readCopy: copy, state });
  const { words } = editorRows({ recipe: all, readCopy: copy, state });
  const count = handCount(all);
  const places = [...new Set(all.map((p) => text(p.when?.place)).filter((p) => p.trim()))];
  const placeLabel = (p) => { const l = loc(K(`place.${p}`)); return l === K(`place.${p}`) ? p : l; };
  const ctx = { loc, draft, readCopy: copy, words, library, changing, linkQuery, recipe: all, editKey, canWrite };
  const view = (row) => {
    const out = rowView(row, ctx);
    const part = all.find((p) => p?.key === row.key);
    if (out.inEdit && part) out.edit = editView(part, row, ctx);
    return out;
  };
  const edited = editKey ? all.find((p) => p?.key === editKey) : null;
  const problems = draft?.problems.length ?? 0;
  return {
    canWrite,
    head: {
      line: cite ? loc(K("head.line"), { cite, hand: count.hand, all: count.all }) : loc(K("head.lineNoCite"), { hand: count.hand, all: count.all }),
      tip: cite ? loc(K("head.tip"), { cite }) : "",
    },
    places: places.length ? [{ value: "", label: loc(K("place.all")), selected: !place }, ...places.map((p) => ({ value: p, label: placeLabel(p), selected: p === place }))] : [],
    states: RECIPE_STATES.map((s) => ({ key: s, label: loc(K(`state.${s}`)), active: s === state })),
    units: rows.units.map(view),
    parts: rows.parts.map(view),
    unitsTip: cite,
    hasUnits: rows.units.length > 0,
    hasParts: rows.parts.length > 0,
    partsCount: rows.parts.length,
    pane: paneView(marks, { recipe: all, editKey, canWrite, loc }),
    paneCite: cite,
    selectedName: edited ? edited.label || loc(K(`role.${edited.role || "none"}`)) : "",
    foot: {
      line: problems ? loc(K("foot.fix"), { n: problems }) : canWrite ? loc(K("foot.saved")) : loc(K("foot.readOnly")),
      canResetAll: canWrite && count.hand > 0 && copy.length > 0,
      error: problems > 0,
    },
  };
}
