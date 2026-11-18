/* global game */
/**
 * What the cast dialog shows and answers, as plain data: Foundry-free, so the
 * window (`cast-dialog.mjs`) is only the wiring around it. The seat's answer
 * lives in one `state` object (mode, picks, kind, weapons by holder, throw
 * splits by token uuid, caster level, situational figure, the save toggle,
 * the tradition's procedure answer, visibility), and `dialogContext(ctx, state)` reads the cast's live questions
 * (`ctx.levelAt`, `ctx.verdictsAt`, `ctx.reachAt`, `ctx.gatesAt`,
 * `ctx.pendingAt`) against it on every render, so a re-render keeps what was
 * typed and a changed bucket re-reads its verdicts. The bucket is the seat's own
 * `game.user.targets`: `resolveDrop` says which token an Actor or Token drop
 * targets, and `untarget` releases one, with no other list kept.
 */
import { rowsForMode } from "../cast-rows.mjs";
import { describeSpellEffect } from "../describe.mjs";
import { instancesTip } from "../cast-instances.mjs";
import { levelTip } from "../cast-ability-tips.mjs";
import { gateTip } from "../cast-gates.mjs";
import { needsBearer, kindChoices, saveModifierOf } from "../cast-mods.mjs";
import { FIELD_KIND } from "../../lib/field-spec.mjs";
import { bucketView, BUCKET_LANG_PREFIX } from "../../lib/bucket.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { invocationFigure } from "../cast-level.mjs";
import { procedureHeading } from "../cast-procedure.mjs";

/** The visibility modes the dialog offers, as lib's roll dialog offers them. */
export const VISIBILITY_MODES = ["public", "gm", "blind", "self"];

const loc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.cast.${key}`, data);

/** A figure with its sign, as the cast's lists print one. */
const signed = (n) => (Number(n) > 0 ? `+${n}` : String(n));

/** The text of a range verdict's tooltip: the targets out of range with each measured distance, then the range's parts (figure and source) and the spell's page reference. */
export function rangeTip(v, cite) {
  const targets = v.out.map((t) => loc("tip.rangeTarget", { name: t.name, gap: Math.round(t.gap * 10) / 10 })).join("; ");
  const parts = (v.parts ?? []).map((p) => loc(`tip.rangePart.${p.key}`, { value: Math.round(p.value * 100) / 100 })).join(" · ");
  return loc("tip.range", { targets, limit: Math.round(v.limit * 10) / 10, parts, cite });
}

/* -------------------------------------------- */
/*  Effect rows: tone and symbol                */
/* -------------------------------------------- */

/** The tone of a row's cell, in the character sheet's three tones: harm is `neg`, a buff or a grant `pos`, anything else the spell's own record `ts`. */
const ROW_TONE = Object.freeze({
  conditionGrant: "neg",
  ignite: "neg",
  damage: "neg",
  slay: "neg",
  destroyItem: "neg",
  heal: "pos",
  conditionRemove: "pos",
  modifier: "pos",
  ward: "pos",
  modifies: "pos",
  grants: "pos",
  immunity: "pos",
});

/** The glyph a row wears where it has no status image of its own. */
const ROW_ICON = Object.freeze({
  conditionGrant: "fa-solid fa-circle-exclamation",
  ignite: "fa-solid fa-fire",
  damage: "fa-solid fa-burst",
  slay: "fa-solid fa-skull",
  destroyItem: "fa-solid fa-hammer",
  heal: "fa-solid fa-heart",
  conditionRemove: "fa-solid fa-eraser",
  modifier: "fa-solid fa-plus-minus",
  ward: "fa-solid fa-shield",
  modifies: "fa-solid fa-sliders",
  grants: "fa-solid fa-hand-sparkles",
  immunity: "fa-solid fa-shield-halved",
});

/**
 * One spell row as an effect row of the dialog: the character sheet's cell
 * (tone, and the status image where the row is a condition, else a glyph) and
 * the row read as the card reads it.
 *
 * @param {object} row
 * @param {(id: string) => string|null} [statusImg]  the image of a status id
 * @returns {{tone: string, icon: string, img: string, text: string}}
 */
export function effectRow(row, statusImg = () => null) {
  const status = row?.type === "conditionGrant" ? statusImg(Array.from(row.conditions ?? [])[0]) : null;
  return {
    tone: ROW_TONE[row?.type] ?? "ts",
    icon: ROW_ICON[row?.type] ?? "fa-solid fa-wand-sparkles",
    img: status ?? "",
    text: describeSpellEffect(row).text,
  };
}

/* -------------------------------------------- */
/*  The answer's state                          */
/* -------------------------------------------- */

/** The first option of every group the spell offers, by group id. */
const firstPicks = (ctx) =>
  Object.fromEntries((ctx.modes ?? []).flatMap((m) => (ctx.groups?.[m] ?? []).map((g) => [g.id, (g.options ?? g.rows.map((e) => ({ token: e.key })))[0]?.token ?? ""])));

/**
 * The state a fresh dialog starts on: the first form, the first option of each
 * group, the first kind, no weapon yet (a holder's pick starts on its default),
 * no typed split, no typed level, the save toggle off, the tradition's procedure
 * answering nothing yet. A context that carries
 * `initial` (a declaration reopened at the turn) starts on that answer instead,
 * each field it names: the answer is copied, so the stored record is never
 * written through.
 *
 * @param {object} ctx
 * @param {{visibility?: string}} [o]
 */
export function initialState(ctx, { visibility = "public" } = {}) {
  // The invocation level opens on the tradition's cap where there is one and the level is asked (R.1); with none it opens blank, never defaulted.
  const first = ctx.invocation?.[ctx.modes?.[0] ?? "normal"];
  const preset = first?.offered && invocationFigure(first.cap) !== null ? String(first.cap) : "";
  const base = { mode: ctx.modes?.[0] ?? "normal", picks: firstPicks(ctx), pickKind: "", items: {}, allocation: {}, casterLevel: "", invocationLevel: preset, situational: "", saveMod: false, procedure: {}, visibility };
  const from = ctx.initial;
  if (!from) return base;
  const given = Object.fromEntries(Object.keys(base).filter((key) => from[key] !== undefined && from[key] !== null).map((key) => [key, from[key]]));
  return {
    ...base,
    ...given,
    picks: { ...base.picks, ...(from.picks ?? {}) },
    items: { ...(from.items ?? {}) },
    // The procedure's answer is plain data, copied so the stored record is never written through.
    procedure: JSON.parse(JSON.stringify(from.procedure ?? {})),
    allocation: Object.fromEntries(Object.entries(from.allocation ?? {}).map(([row, split]) => [row, { ...split }])),
  };
}

/** The invocation level as the seat holds it, read by the cast (`ctx.invocationAt`): `{value, source, cap, reads, offered, ladder, classLevel}`; a context that reads none offers none. */
function invocationOf(ctx, state, mode) {
  if (ctx.invocationAt) return ctx.invocationAt(mode, state.invocationLevel) ?? {};
  // A context that reads the level only as it opened holds the level it stands at, and none where it is not asked.
  const held = ctx.invocation?.[mode] ?? {};
  return { ...held, value: held.offered === true ? (held.value ?? null) : null };
}

/** The pick groups of a mode at an invocation level: the cast's own reading at that level, else the groups it opened with. */
const groupsOf = (ctx, mode, inv) => (ctx.groupsAt ? ctx.groupsAt(mode, inv) : (ctx.groups?.[mode] ?? []));

/** The picks that stand for a mode: the state's, else each group's first option; a pick the level's groups no longer offer starts on the group's first again. */
function picksOf(ctx, state, mode = null, inv = null) {
  const held = { ...firstPicks(ctx), ...(state.picks ?? {}) };
  if (!ctx.groupsAt || !mode) return held;
  for (const group of groupsOf(ctx, mode, inv)) {
    const tokens = (group.options ?? group.rows.map((e) => ({ token: e.key }))).map((o) => o.token);
    if (!tokens.includes(held[group.id])) held[group.id] = tokens[0] ?? "";
  }
  return held;
}

/** The weapon this holder's pick stands on: the seat's pick where the holder still carries it, else the holder's default. */
const weaponOf = (holder, state) => {
  const asked = state.items?.[holder.uuid];
  return holder.weapons.some((w) => w.id === asked) ? asked : holder.pick;
};

/** The kinds a `pickKind` select offers for the rows that stand, and the one that stands (the seat's, else the first). */
const kindOf = (kept, state) => {
  const options = kindChoices(kept);
  return { options, value: options.includes(state.pickKind) ? state.pickKind : (options[0] ?? "") };
};

/**
 * What the seat answered, as the cast reads it. The weapon of a holder is
 * answered only where its pick was shown, and a throw split only where its row
 * was shown.
 *
 * @param {object} ctx
 * @param {object} state
 * @returns {{mode: string, picks: Record<string, string>, pickKind: string|null, items: Record<string, string>, allocation: Record<string, Record<string, string>>, casterLevel: string, situational: string, saveMod: boolean, procedure: object, visibility: string}}
 */
export function answerOf(ctx, state) {
  const mode = (ctx.modes ?? []).includes(state.mode) ? state.mode : (ctx.modes?.[0] ?? "normal");
  const inv = invocationOf(ctx, state, mode).value ?? null;
  const picks = picksOf(ctx, state, mode, inv);
  const kept = rowsForMode(ctx.rows ?? [], mode, picks, { invocationLevel: inv });
  const items = {};
  for (const holder of weaponHolders(ctx, kept)) if (holder.weapons.length) items[holder.uuid] = weaponOf(holder, state);
  const allocation = {};
  for (const item of ctx.instancesAt ? ctx.instancesAt(mode, inv) : (ctx.instances?.[mode] ?? [])) {
    if (item.pick && picks[item.pick] !== item.option) continue;
    allocation[item.key] = Object.fromEntries((ctx.targets ?? []).map((t) => [t.uuid, String(state.allocation?.[item.key]?.[t.uuid] ?? item.split?.[t.uuid] ?? 0)]));
  }
  const kind = kindOf(kept, state);
  return {
    mode,
    picks: Object.fromEntries(groupsOf(ctx, mode, inv).map((g) => [g.id, picks[g.id]])),
    pickKind: kind.options.length ? kind.value : null,
    items,
    allocation,
    casterLevel: String(state.casterLevel ?? ""),
    // The whole level the seat holds where the cast asks for one, else null: the cast reads it (`castSpellRun`) and a declaration stores it.
    invocationLevel: inv,
    situational: String(state.situational ?? ""),
    saveMod: state.saveMod === true,
    // The tradition's procedure answers its fields, its band's controls, its buckets and the pick of each; a cast whose tradition has none answers nothing.
    procedure: procedureOf(ctx, state, mode, inv)?.answer ?? {},
    visibility: state.visibility || "public",
  };
}

/** The tradition's procedure read against the seat's answer: its fields, the answer they coerce to (the band's controls and the buckets kept), and its band. Null where the tradition has none. */
export function procedureOf(ctx, state, mode, inv = null) {
  if (!ctx.procedure) return null;
  const level = ctx.levelAt ? ctx.levelAt(state.casterLevel) : ctx.level;
  return ctx.procedure.at(mode, state.procedure ?? {}, level?.value ?? null, inv);
}

/** The buckets the tradition's procedure asks for at the seat's answer: each with the rows it holds, the list that answers for it and the pick it stands on (`bucketStates`). Empty where the tradition has none. */
export function bucketsOf(ctx, state) {
  const mode = (ctx.modes ?? []).includes(state.mode) ? state.mode : (ctx.modes?.[0] ?? "normal");
  return procedureOf(ctx, state, mode, invocationOf(ctx, state, mode).value ?? null)?.buckets ?? [];
}

/** One procedure field as the template draws it: the input's name, its kind as a flag, and the value it stands on. */
function fieldView(spec, answer) {
  const value = answer[spec.key];
  return {
    key: spec.key,
    name: `procedure.${spec.key}`,
    label: spec.label || spec.key,
    hint: spec.hint ?? "",
    isNumber: spec.kind === FIELD_KIND.number,
    isText: spec.kind === FIELD_KIND.text,
    isCheck: spec.kind === FIELD_KIND.boolean,
    isSelect: spec.kind === FIELD_KIND.select,
    isProse: spec.kind === FIELD_KIND.prose,
    value: value ?? "",
    checked: value === true,
    hasMin: Number.isFinite(spec.min),
    min: Number.isFinite(spec.min) ? spec.min : "",
    hasMax: Number.isFinite(spec.max),
    max: Number.isFinite(spec.max) ? spec.max : "",
    choices: spec.kind === FIELD_KIND.select ? (spec.choices ?? []).map((c) => ({ value: c.value, label: c.label ?? c.value, selected: c.value === value })) : [],
  };
}

/** The holders whose weapon pick shows for these rows: every holder where a row destroys a weapon, the one holder where a row waits on a weapon. */
function weaponHolders(ctx, kept) {
  const holders = ctx.holders ?? [];
  if (kept.some(({ row }) => row.type === "destroyItem")) return holders;
  return needsBearer(kept) && holders.length === 1 ? holders : [];
}

/* -------------------------------------------- */
/*  The bucket                                  */
/* -------------------------------------------- */

/**
 * Which token a drop on the bucket targets. An Actor drop reads the actor's
 * tokens on the viewed scene: one is the answer, none says so, and several say
 * to target the one meant. A Token drop is that token. Anything else is no drop.
 *
 * @param {{type?: string, uuid?: string}|null} data  the drag event's data
 * @param {{fromUuid: (uuid: string) => Promise<object|null>}} deps
 * @returns {Promise<{token: object}|{notice: "noToken"|"manyTokens"|"noDrop", name?: string}>}
 */
export async function resolveDrop(data, { fromUuid }) {
  if (data?.type === "Token") {
    const token = await fromUuid(data.uuid);
    return token?.documentName === "Token" || token?.actor ? { token } : { notice: "noDrop" };
  }
  if (data?.type !== "Actor") return { notice: "noDrop" };
  const actor = await fromUuid(data.uuid);
  return resolveActor(actor);
}

/** The token an actor stands for in the bucket: its only token on the viewed scene, else the reason there is none. */
export function resolveActor(actor) {
  if (!actor) return { notice: "noDrop" };
  const tokens = actor.getActiveTokens?.(false, true) ?? [];
  if (tokens.length === 1) return { token: tokens[0] };
  return { notice: tokens.length ? "manyTokens" : "noToken", name: actor.name ?? "" };
}

/**
 * Take a token into the bucket: target it for this seat, keeping the others.
 * @param {object} token  a token document
 * @returns {boolean} whether there was a canvas token to target
 */
export function addTarget(token) {
  const object = token?.object;
  if (!object?.setTarget) return false;
  object.setTarget(true, { releaseOthers: false });
  return true;
}

/**
 * Take one token out of the bucket: release this seat's target on it, keeping
 * the others.
 *
 * @param {Iterable<object>} targets  `game.user.targets`
 * @param {string} uuid  the token document's uuid
 * @returns {boolean} whether a target was released
 */
export function untarget(targets, uuid) {
  for (const t of targets ?? []) {
    if ((t.document ?? t).uuid !== uuid) continue;
    t.setTarget?.(false, { releaseOthers: false });
    return true;
  }
  return false;
}

/* -------------------------------------------- */
/*  The invocation level and the buckets        */
/* -------------------------------------------- */

/**
 * The invocation-level control: one select over the levels 1 up to the top of the
 * tradition's cap ladder (or the cap, if higher), or a number box where the cast
 * offers the level and has no ladder to list. A level above the cap is disabled
 * for a Player and chosen, in the warn tone, by a Judge; with no cap read every
 * level is offered. Hidden where the cast asks for no level.
 *
 * @param {object} ctx
 * @param {object} st  the seat's state
 * @param {object} read  `ctx.invocationAt`'s answer for the mode
 */
export function levelView(ctx, st, read) {
  if (read?.offered !== true) return { show: false };
  const cap = invocationFigure(read.cap);
  const value = read.value ?? null;
  const top = Math.max(Number(read.ladder?.top) || 0, cap ?? 0);
  const judge = ctx.isGM === true;
  const over = value !== null && cap !== null && value > cap;
  const base = { show: true, label: loc("dialog.invocationLevel"), tone: over && judge ? "warn" : "", cap: cap === null ? "" : loc("dialog.invocationCap", { cap }) };
  if (top < 1) return { ...base, isSelect: false, value: st.invocationLevel ?? "", tip: loc("tip.invocation.hand", { value: value ?? "" }), hand: loc("dialog.invocationHand") };
  const options = Array.from({ length: top }, (_, i) => {
    const n = i + 1;
    const above = cap !== null && n > cap;
    return { value: n, selected: n === value, disabled: above && !judge, over: above, label: above ? loc(judge ? "dialog.invocationOver" : "dialog.invocationAbove", { n }) : cap === n ? loc("dialog.invocationAtCap", { n }) : loc("dialog.invocationOption", { n }) };
  });
  if (value === null) options.unshift({ value: "", selected: true, disabled: false, over: false, label: loc("dialog.invocationNone") });
  const tip = cap === null ? [read.ladder?.label, loc("tip.invocation.uncapped")].filter(Boolean).join(" · ") : loc("tip.invocation.cap", { cap, ladder: read.ladder?.label ?? "", level: read.classLevel ?? "" });
  return { ...base, isSelect: true, options, tip };
}

/**
 * Each bucket a procedure asks for, as lib's `bucketView` draws it: the entries
 * the window resolved (`entries[key]`, from `entriesFromAnswer`), the pick the
 * cast reads, and each row's caption, diamonds, dimming and reason from the
 * policy's `rowView`. The policy supplies its own heading, icon and wording,
 * already localized.
 *
 * @param {{buckets?: object[]}|null} proc  `procedureOf`'s view
 * @param {Record<string, object[]>} entries
 * @param {object} ctx
 */
export function bucketViews(proc, entries, ctx = {}) {
  const bucketLoc = makeLoc(BUCKET_LANG_PREFIX);
  return (proc?.buckets ?? []).map((s) => {
    const held = entries?.[s.key] ?? [];
    const rows = Object.fromEntries(held.map((entry) => [entry.uuid, s.policy.rowView?.(entry, s.rows.find((r) => r.uuid === entry.uuid) ?? null, ctx) ?? {}]));
    return bucketView(s.policy, held, { key: s.key, loc: bucketLoc, legend: s.policy.legend ?? s.key, icon: s.policy.icon ?? "", picked: s.picked, rows, dropText: s.policy.dropText ?? "", emptyText: s.policy.emptyText ?? "" });
  });
}

/* -------------------------------------------- */
/*  The view                                    */
/* -------------------------------------------- */

/**
 * The template's data from the cast's context and the seat's state.
 *
 * @param {object} ctx  the cast's context (`askContext` in `cast-spell.mjs`)
 * @param {object} [state]  the seat's answer so far; what it leaves out starts as `initialState` has it
 * @param {{modeLabel?: (key: string) => string, visibilityLabel?: (key: string) => string, statusImg?: (id: string) => string|null, visibility?: string}} [labels]
 */
export function dialogContext(ctx, state = {}, { modeLabel = (k) => k, visibilityLabel = (k) => k, statusImg = () => null, visibility = "public", entries = {} } = {}) {
  const st = { ...initialState(ctx, { visibility }), ...state };
  const mode = (ctx.modes ?? []).includes(st.mode) ? st.mode : (ctx.modes?.[0] ?? "normal");
  // The invocation level the seat holds: every question below is asked at it.
  const read = invocationOf(ctx, st, mode);
  const inv = read.value ?? null;
  const picks = picksOf(ctx, st, mode, inv);
  const kept = rowsForMode(ctx.rows ?? [], mode, picks, { invocationLevel: inv });
  const level = ctx.levelAt ? ctx.levelAt(st.casterLevel) : (ctx.level ?? {});
  const resolved = level?.value ?? null;
  const cite = ctx.cite ?? "";

  // The spell: each group's options as effect rows, the level field, the creature kind.
  const groups = groupsOf(ctx, mode, inv).map((group) => ({
    id: group.id,
    legend: loc("dialog.pickLegend"),
    label: loc("dialog.pick"),
    options: (group.options ?? group.rows.map((entry) => ({ token: entry.key, rows: [entry] }))).map(({ token, rows }) => ({
      key: token,
      selected: token === picks[group.id],
      rows: rows.map(({ row }) => effectRow(row, statusImg)),
      label: rows.map(({ row }) => describeSpellEffect(row).text).join(" · "),
    })),
  }));
  const kind = kindOf(kept, st);
  const stand = (ctx.level ?? {});
  // The tradition's procedure, and where the cast falls once the seat's answer to it is in (its casting time can make the cast `long`).
  const proc = procedureOf(ctx, st, mode, inv);
  const moment = ctx.momentAt ? ctx.momentAt(mode, resolved, st.procedure, inv) : ctx.moment;
  const verdicts = ctx.verdictsAt ? ctx.verdictsAt(mode, picks, resolved, st.allocation, inv, st.procedure) : (ctx.verdicts?.[mode] ?? []);
  const blocks = verdicts.some((v) => v.severity === "block");

  // The saves: the situational figure, ruling 126's toggle, and the parts that stand.
  const modifier = saveModifierOf({ modifier: ctx.saveModifier }, resolved);
  const unvalued = modifier == null;
  const applied = st.saveMod === true && !unvalued;
  const situationalNumber = Number(st.situational);
  const parts = [
    ...(String(st.situational ?? "").trim() !== "" && Number.isFinite(situationalNumber) && situationalNumber !== 0 ? [{ label: loc("dialog.situational"), value: signed(situationalNumber) }] : []),
    ...(applied ? [{ label: ctx.spell?.name ?? "", value: signed(modifier) }] : []),
    ...(ctx.saveParts ?? []).map((p) => ({ label: p.label, value: signed(p.value) })),
  ];

  // The bucket: one row per token, with what the seat answers for it folded in.
  const reach = ctx.reachAt ? ctx.reachAt(resolved, inv, mode) : null;
  const gates = ctx.gatesAt ? ctx.gatesAt(resolved, inv) : {};
  const pending = ctx.pendingAt ? ctx.pendingAt(mode, picks, resolved, inv) : {};
  const holders = new Map((ctx.holders ?? []).map((h) => [h.uuid, h]));
  const pickHolders = new Set(weaponHolders(ctx, kept).map((h) => h.uuid));
  const destroying = kept.some(({ row }) => row.type === "destroyItem");
  const shownSplits = (ctx.instancesAt ? ctx.instancesAt(mode, inv) : (ctx.instances?.[mode] ?? [])).filter((item) => !item.pick || picks[item.pick] === item.option);
  const rows = (ctx.targets ?? []).map((t) => {
    const gap = ctx.gaps?.[t.uuid];
    const gate = gates[t.uuid];
    const far = (reach?.range?.out ?? []).find((o) => o.key === t.uuid);
    const holder = holders.get(t.uuid);
    const on = holder ? weaponOf(holder, st) : "";
    return {
      uuid: t.uuid,
      name: t.name,
      img: t.img ?? "",
      off: gate?.affected === false,
      far: Boolean(far),
      line: Number.isFinite(gap) ? loc("dialog.gap", { gap: Math.round(gap * 10) / 10 }) : loc("dialog.gapUnknown"),
      tip:
        gate?.affected === false
          ? gateTip(gate.why, loc, { name: t.name, cite })
          : far
            ? rangeTip({ out: [far], limit: reach.range.limit, parts: reach.range.parts }, cite)
            : Number.isFinite(gap) ? loc("tip.gap", { name: t.name, gap: Math.round(gap * 10) / 10 }) : loc("dialog.rangeUnmeasured"),
      removeLabel: loc("dialog.remove", { name: t.name }),
      pills: pickHolders.has(t.uuid)
        ? holder.weapons.map((w) => ({ id: w.id, label: w.magic ? loc("dialog.weaponMagic", { name: w.name }) : w.name, on: w.id === on, magic: w.magic }))
        : [],
      noWeapon: pickHolders.has(t.uuid) && destroying && !holder.weapons.length,
      weaponLabel: loc("dialog.weapon"),
      splits: shownSplits.map((item) => ({
        key: item.key,
        label: describeSpellEffect(item.row).text,
        value: st.allocation?.[item.key]?.[t.uuid] ?? item.split?.[t.uuid] ?? 0,
        tip: instancesTip(item.count, cite, loc),
      })),
      chips: (pending[t.uuid] ?? []).length ? [{ text: loc("dialog.ownSavePending"), tip: pending[t.uuid].join("; ") }] : [],
    };
  });
  const max = reach?.count ?? null;
  const over = verdicts.some((v) => v.key === "tooManyTargets");

  return {
    header: {
      portrait: ctx.caster?.img ?? "",
      spell: ctx.spell?.name ?? loc("dialog.title"),
      caster: ctx.caster?.name ?? "",
      level: {
        line: resolved ? loc("dialog.levelLine", { value: resolved }) : "",
        tip: [stand.source ? "" : loc("tip.level.hand", { value: "" }), levelTip(level, loc)].filter(Boolean).join(" · "),
      },
      hasModes: (ctx.modes?.length ?? 0) > 1,
      modes: (ctx.modes ?? []).map((key) => ({ key, label: modeLabel(key), selected: key === mode })),
    },
    // At any moment of a begun fight but the caster's turn the button declares the spell.
    declaring: moment === "declare" ? loc("dialog.declaring", { name: ctx.caster?.name ?? "" }) : "",
    spell: {
      show: groups.length > 0 || kind.options.length > 0 || Boolean(ctx.levelNeeded && !stand.value),
      groups,
      level: { show: Boolean(ctx.levelNeeded && !stand.value), value: st.casterLevel, tip: [loc("tip.level.hand", { value: "" }), levelTip(level, loc)].filter(Boolean).join(" · ") },
      kind: { show: kind.options.length > 0, options: kind.options.map((key) => ({ key, selected: key === kind.value })), rows: kept.filter(({ row }) => row.pickKind === true).map(({ row }) => effectRow(row, statusImg)) },
    },
    // One band, between the spell and the saves: the procedure's fields, then its band. Its heading is the tradition's: the procedure's own label, else the tradition's name.
    invocation: (() => {
      const lvl = levelView(ctx, st, read);
      const buckets = bucketViews(proc, entries, ctx);
      return {
        show: lvl.show || Boolean(proc && (proc.specs.length || proc.band || buckets.length)),
        title: procedureHeading({ label: ctx.procedure?.label, traditionLabel: ctx.procedure?.traditionLabel ?? ctx.traditionLabel }, { localize: (key) => game.i18n.localize(key), fallback: loc("dialog.invocation") }),
        level: lvl,
        buckets,
        fields: (proc?.specs ?? []).map((spec) => fieldView(spec, proc.answer)),
        band: proc?.band ?? null,
      };
    })(),
    saves: {
      show: Boolean(ctx.saves),
      situational: st.situational,
      situationalTip: loc("tip.situational"),
      toggle: {
        checked: applied,
        disabled: unvalued,
        label: loc("dialog.saveModifier"),
        // A figure carries where it came from; with none imported the field stays blank and only the page reference shows.
        tip: unvalued ? cite : loc("tip.saveModifier", { figure: signed(modifier), cite }),
      },
      parts,
    },
    bucket: {
      count: { n: rows.length, max, over, text: max == null ? loc("dialog.countOnly", { n: rows.length }) : loc("dialog.count", { n: rows.length, max }), tip: cite ? loc("tip.cite", { cite }) : "" },
      rows,
      empty: !rows.length,
      rangeNote: ctx.rangeUnmeasured ? loc("dialog.rangeUnmeasured") : "",
    },
    footer: {
      visibility: VISIBILITY_MODES.map((key) => ({ key, label: visibilityLabel(key), selected: key === st.visibility })),
      capacity: (() => {
        const cap = ctx.capacity;
        return cap && cap.verdict !== "unknown" && cap.max != null
          ? { line: loc("dialog.capacity", { used: cap.used, max: cap.max, level: cap.spellLevel ?? "" }), tip: loc("tip.capacity", { source: loc(`tip.capacitySource.${cap.source}`) }) }
          : {};
      })(),
      verdicts: verdicts.map((v) => ({
        severity: v.severity,
        // A finding a procedure worded itself reads in its own words.
        text: v.notice || loc(`notice.${v.severity === "block" ? "blocked" : "verdict"}.${v.key}`, { name: ctx.caster?.name ?? "", names: (v.out ?? []).map((o) => o.name).join(", "), max: v.max ?? "", over: v.over ?? "" }),
        tip: v.key === "outOfRange" ? rangeTip(v, cite) : v.key === "tooManyTargets" && cite ? loc("tip.cite", { cite }) : "",
      })),
      blocked: blocks,
      cast: moment === "declare" ? loc("dialog.declare") : loc("dialog.cast"),
    },
  };
}
