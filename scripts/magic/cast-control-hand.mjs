/* global game, ui, fromUuidSync */
/**
 * A Judge's hand on one cast's control end, after the fact. The two cards a
 * cast's end posts (concentration's, `cast-held.mjs`, and the clock's,
 * `cast-expiry.mjs`) record the outcome the end gave their creatures (`outcome`
 * in the card's flag). The render hook draws one select on each card from that
 * flag: Under control and the three ends (`CONTROL_PICKS`), the recorded outcome
 * selected, or an unpickable `Not recorded` where the flag records none. It
 * takes the outcome line's place, so a seat reads one of the two, and a line
 * under it says in field terms what the chosen value did to the creatures. A
 * value set by hand is recorded with the user's name (`setBy`) and read from the
 * card by every seat.
 *
 * The creatures the select acts on are the ones the card lists: the held-end
 * card keeps them in its flag (`summons`, a token by `tokenUuid`, a stashed one
 * by `held: {partyId, actorId}`), and the time-end card reads them live
 * (`castSummons`). The select is built here, from the flag, and not by the
 * cards' templates, so a card posted before this existed draws it too.
 *
 * Who is drawn it is Foundry's own answer on each creature: a seat whose
 * `isOwner` holds on every listed creature that still exists. A stashed creature
 * is asked through the roster row's world copy, which only a GM owns. A card
 * whose creatures are all gone asks the caster instead, a card that lists none
 * draws nothing, and a card whose outcome is `gone` draws none, since its
 * creatures were deleted. A pick goes to the GM's client as
 * `{op: "setControl", messageId, outcome}` through the held-end relay
 * (`HELD_END_HANDLER`), which reads the card and the creatures from the world,
 * re-tests the sender's ownership of each, and applies the outcome through lib's
 * `applyControlEnd`. It then writes the card's flag and its drawn content in one
 * update, so the card is a function of its flag.
 *
 * See docs/magic/DECISIONS.md, "What changes a conjuration's control end, and
 * the Judge's hand on it".
 */
import { MODULE_ID, LANG_PREFIX, HELD_END_HANDLER } from "./constants.mjs";
import { CONTROL_PICKS } from "../lib/summons-logic.mjs";
import { castSummons } from "../lib/summons.mjs";
import { unset, isUnset } from "../lib/util.mjs";
import * as services from "../lib/services.mjs";

export { CONTROL_PICKS, isUnset as isUnsetValue };

/** The wrapper carrying the select and its hint; the render hook adds it and a redraw replaces it. */
const CONTROL_CLASS = "acks-extras-cast-held__control";

/** The attribute the cards' outcome line carries, which the select replaces for a seat that gets it. */
export const CONTROL_LINE_ATTR = "data-acks-extras-control-line";

/** The lang key of the select's tooltip, which core localizes. */
const TIP_KEY = `${LANG_PREFIX}.castControl.tip`;

/** A string of this file's lang group, which both cards read. */
export const controlLoc = (key, data) => game.i18n.format(`${LANG_PREFIX}.castControl.${key}`, data ?? {});

/** The creatures a held-end card lists, as its flag keeps them. */
export const entriesOf = (flag) => (Array.isArray(flag?.summons) ? flag.summons : []);

/**
 * What the select draws, from a card's flag: its options in `CONTROL_PICKS`
 * order with the recorded outcome selected, or, where the flag records none (a
 * card posted before an outcome was kept, or an end no GM applied), a first
 * option `Not recorded` that is selected and cannot be picked. Also its label,
 * aria-label, tooltip key and the hint that says what the selected value did.
 *
 * @param {object} flag  a card's flag
 * @param {(key: string) => string} loc  this file's strings, `ACKS-MAGIC.castControl.<key>`
 * @returns {{value: string, options: {value: string, label: string, selected: boolean, disabled?: boolean}[], label: string, aria: string, tip: string, hint: string}}
 */
export function controlView(flag, loc) {
  const value = CONTROL_PICKS.includes(flag?.outcome) ? flag.outcome : "";
  const options = CONTROL_PICKS.map((pick) => ({ value: pick, label: loc(`option.${pick}`), selected: pick === value }));
  if (!value) options.unshift({ value: "", label: loc("option.unrecorded"), selected: true, disabled: true });
  return { value, options, label: loc("label"), aria: loc("aria"), tip: TIP_KEY, hint: value ? loc(`hint.${value}`) : "" };
}

/**
 * May the asker set this card's outcome? Not once the creatures are gone (the
 * outcome `gone`). Every creature the card lists that still exists must be the
 * asker's (`owns`); with none left the caster must be, and a card that lists no
 * creature is nobody's. Pure over what is passed.
 *
 * @param {object} flag  a card's flag
 * @param {object} world
 * @param {(flag: object) => object[]} [world.entries]  the creatures the card lists; its flag's `summons` where omitted
 * @param {(entry: object) => object|null} world.subject  the document ownership is asked of for a listed creature, null where it no longer exists
 * @param {(uuid: string) => object|null} world.caster  the caster's actor
 * @param {(doc: object) => boolean} world.owns  whether the asker owns a document
 * @returns {boolean}
 */
export function mayPickControl(flag, { entries = entriesOf, subject, caster, owns }) {
  if (flag?.outcome === "gone") return false;
  const listed = entries(flag);
  if (!listed.length) return false;
  const live = listed.map(subject).filter(Boolean);
  if (!live.length) {
    const who = caster(flag.casterUuid);
    return Boolean(who) && owns(who);
  }
  return live.every((doc) => owns(doc));
}

/**
 * The creatures a card lists for the ones `castSummons` found: a token by its
 * uuid, a stashed one by its party and row ids. Names and pictures are what the
 * card draws.
 *
 * @param {{tokens?: object[], held?: object[]}} found
 * @returns {object[]}
 */
export function creatureEntries(found) {
  return [
    ...(found?.tokens ?? []).map((t) => ({ name: String(t.name ?? t.actor?.name ?? ""), img: String(t.texture?.src || t.actor?.img || ""), tokenUuid: String(t.uuid ?? "") })),
    ...(found?.held ?? []).map((h) => ({ name: String(h.name ?? ""), img: String(h.img ?? ""), held: { partyId: String(h.partyId ?? ""), actorId: String(h.actorId ?? "") } })),
  ];
}

/**
 * A stashed creature that left its party is a token now, and what names it is
 * that token: its roster row is gone. Entries not named by `left` stay as they
 * are.
 *
 * @param {object[]} summons  a card's listed creatures
 * @param {{partyId: string, actorId: string, tokenUuid?: string|null}[]} left  what a control end answered
 * @returns {object[]}
 */
export function summonsAfterLeave(summons, left) {
  const tokenOf = new Map((left ?? []).filter((l) => l.tokenUuid).map((l) => [`${l.partyId}|${l.actorId}`, l.tokenUuid]));
  return (summons ?? []).map((s) => (s.held && tokenOf.has(`${s.held.partyId}|${s.held.actorId}`) ? { name: s.name, img: s.img, tokenUuid: tokenOf.get(`${s.held.partyId}|${s.held.actorId}`) } : s));
}

/**
 * A card's flag after an outcome was set by hand: the outcome recorded under its
 * own key (Under control is a value like the others), `setBy` the user who set
 * it, the listed creatures as the end left them, and who left the party and who
 * is kept on its roster as that end answered. Those who left stay listed as
 * having left, since they stand where they are whatever is set after; the kept
 * are replaced by what a hostile end answered and are otherwise as they were.
 *
 * @param {object} flag
 * @param {string} outcome  a `CONTROL_PICKS` value
 * @param {object|null} answer  `applyControlEnd`'s answer, null where nothing was applied
 * @param {string} [by]  the name of the user who set it
 * @returns {object}
 */
export function flagAfterPick(flag, outcome, answer, by) {
  const next = { ...flag, outcome, ...(by ? { setBy: by } : {}) };
  if (!answer) return next;
  if (flag.summons) next.summons = summonsAfterLeave(flag.summons, answer.left);
  if (answer.left?.length) {
    const names = new Set((flag.left ?? []).map((l) => l.name));
    next.left = [...(flag.left ?? []), ...answer.left.filter((l) => !names.has(l.name)).map((l) => ({ name: l.name }))];
  }
  if (outcome === "hostile") {
    if (answer.kept?.length) next.kept = answer.kept.map((k) => ({ name: k.name }));
    else delete next.kept;
  }
  return next;
}

/**
 * The update that turns a card's stored flag into `next`: each changed or new
 * key under `path`, and a forced deletion for each key that went, since an
 * update merges objects and would keep the old one.
 *
 * @param {string} path  `flags.<module>.<key>`
 * @param {object} old
 * @param {object} next
 * @returns {object}
 */
export function flagPatch(path, old, next) {
  const out = {};
  for (const [k, v] of Object.entries(next)) if (JSON.stringify(v) !== JSON.stringify(old?.[k])) out[`${path}.${k}`] = v;
  for (const k of Object.keys(old ?? {})) if (!(k in next)) out[`${path}.${k}`] = unset();
  return out;
}

/** A document looked up by uuid, null where it is gone or the uuid is not one. */
const lookup = (uuid) => {
  try {
    return uuid ? (fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
};

/**
 * The world as a card's creatures stand in it: the creatures it lists (a
 * held-end card's flag, or, for `live`, what `castSummons` finds standing now:
 * the time-end card keeps no list), a token's actor (ownership of a creature is
 * its actor's) or a stashed creature's roster row's world copy, and the caster.
 *
 * @param {{live?: boolean}} [o]
 * @returns {{entries: Function, subject: Function, caster: Function}}
 */
export function liveWorld({ live = false } = {}) {
  return {
    entries: live ? (flag) => creatureEntries(castSummons(lookup(flag.casterUuid), flag.castId, { scenes: game.scenes })) : entriesOf,
    subject: (entry) => {
      if (entry.tokenUuid) return lookup(entry.tokenUuid)?.actor ?? null;
      const rows = services.get("party-roster")?.members?.(entry.held?.partyId) ?? [];
      return rows.find((r) => r.actorId === entry.held?.actorId)?.actor ?? null;
    },
    caster: lookup,
  };
}

/**
 * Set one card's outcome, on the GM's client: validate it, re-test the sender's
 * ownership of every creature the card lists that still exists, apply it to
 * those creatures through `apply` (lib's `applyControlEnd`) unless none is left,
 * and write the card's flag and its drawn content in one update. A sender of
 * null is the Judge's own call and owns everything. Creatures that no longer
 * exist are skipped and counted. A card whose creatures were deleted (`gone`)
 * is refused.
 *
 * @param {object} o
 * @param {object} o.message  the card's chat message
 * @param {string} o.key  the flag key the card carries
 * @param {string} o.outcome  a `CONTROL_PICKS` value
 * @param {object|null} o.sender  the requesting user, null for a Judge's own call
 * @param {string} [o.by]  the name recorded as having set it
 * @param {(flag: object) => Promise<string>|string} o.render  the card's content for a flag
 * @param {boolean} [o.live]  the card lists no creatures itself (the time-end card)
 * @param {object} [o.world]  `entries(flag)`, `subject(entry)` and `caster(uuid)`, the live world unless a test hands its own
 * @param {(caster: object, request: {castId: string, outcome: string}) => Promise<object>} [o.apply]  lib's control end unless a test hands its own
 * @returns {Promise<{ok: true, outcome: string, skipped: number, none: boolean, changed: number}|{ok: false, reason: string}>}
 */
export async function setControlOnCard({ message, key, outcome, sender = null, by = "", render, live = false, world = liveWorld({ live }), apply }) {
  const flag = key ? message?.flags?.[MODULE_ID]?.[key] : null;
  if (!flag) return { ok: false, reason: "noCard" };
  if (!CONTROL_PICKS.includes(outcome)) return { ok: false, reason: "badOutcome" };
  if (flag.outcome === "gone") return { ok: false, reason: "gone" };
  const owns = sender ? (doc) => doc?.testUserPermission?.(sender, "OWNER") === true : () => true;
  if (!mayPickControl(flag, { ...world, owns })) return { ok: false, reason: "notOwner" };
  const entries = (world.entries ?? entriesOf)(flag);
  const standing = entries.filter((entry) => world.subject(entry));
  const skipped = entries.length - standing.length;
  let answer = null;
  if (standing.length) {
    const run = apply ?? (async (...args) => (await import("../lib/summons.mjs")).applyControlEnd(...args));
    answer = await run(world.caster(flag.casterUuid), { castId: flag.castId, outcome });
    if (!answer?.ok) return { ok: false, reason: answer?.reason ?? "refused" };
  }
  const next = flagAfterPick(flag, outcome, answer, by);
  await message.update({ content: await render(next), ...flagPatch(`flags.${MODULE_ID}.${key}`, flag, next) });
  const changed = answer ? ["stamped", "deleted", "released"].reduce((sum, k) => sum + (Number(answer[k]) || 0), 0) : 0;
  return { ok: true, outcome, skipped, none: !standing.length, changed };
}

/** The message a pick has asked to hold focus once its card is redrawn. */
let focusPending = null;

/**
 * A pick, from this seat: asked of the GM's client as `{op: "setControl",
 * messageId, outcome}` and nothing the seat could claim beside it (the GM's
 * client reads the card and the creatures itself), then the answer told. A
 * refusal is a warning; a card whose creatures are all gone, and one that
 * skipped some, are a notice.
 *
 * @param {object} message  the card's chat message
 * @param {string} outcome  a `CONTROL_PICKS` value
 * @param {object} [deps]  `relay(payload)`, `warn(text)` and `info(text)`, the live ones unless a test hands its own
 * @returns {Promise<object|null>} the answer, null where no GM answered
 */
export async function pressControl(message, outcome, deps = {}) {
  const relay = deps.relay ?? (async (payload) => (await import("../lib/sockets.mjs")).executeAsGM(HELD_END_HANDLER, payload));
  const warn = deps.warn ?? ((text) => ui.notifications.warn(text));
  const info = deps.info ?? ((text) => ui.notifications.info(text));
  const answer = await relay({ op: "setControl", messageId: message.id, outcome });
  if (!answer) return null;
  if (!answer.ok) warn(controlLoc(`refused.${answer.reason}`));
  else if (answer.none) info(controlLoc("notice.none"));
  else if (answer.skipped) info(controlLoc("notice.skipped", { n: answer.skipped }));
  return answer;
}

/**
 * Draw the select on a card for a seat that owns every creature the card lists,
 * and wire it. It takes the card's outcome line's place (`CONTROL_LINE_ATTR`),
 * so a seat reads the line or the select and never both; with no line it goes
 * before `anchor`, else last in the card. The elements are made by the card's own
 * document, so a card rendered into a window of its own has a select that window
 * built. Keyboard focus returns to the select once the card is redrawn from its
 * new flag.
 *
 * @param {object} message  the card's chat message
 * @param {HTMLElement} html  its rendered body
 * @param {{key: string, root: string, anchor?: string, live?: boolean}} where  the flag key, the selector of the card's own root, optionally the element the select goes before when no outcome line stands, and whether the card's creatures are read live
 */
export function bindControlSelect(message, html, { key, root, anchor, live = false }) {
  const flag = message?.flags?.[MODULE_ID]?.[key];
  const doc = html?.ownerDocument;
  if (!flag || !doc?.createElement) return;
  if (!mayPickControl(flag, { ...liveWorld({ live }), owns: (d) => d?.isOwner === true })) return;
  const view = controlView(flag, controlLoc);
  const wrap = doc.createElement("div");
  wrap.className = CONTROL_CLASS;
  const label = doc.createElement("label");
  const caption = doc.createElement("span");
  caption.textContent = view.label;
  const select = doc.createElement("select");
  select.setAttribute("aria-label", view.aria);
  select.setAttribute("data-tooltip", view.tip);
  for (const option of view.options) {
    const el = doc.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    el.selected = option.selected;
    if (option.disabled) el.disabled = true;
    select.append(el);
  }
  select.value = view.value;
  label.append(caption, select);
  const hint = doc.createElement("p");
  hint.className = "acks-extras-cast-held__hint";
  hint.textContent = view.hint;
  wrap.append(label, hint);
  const line = html.querySelector?.(`[${CONTROL_LINE_ATTR}]`);
  const before = anchor ? html.querySelector?.(anchor) : null;
  if (line?.before) {
    line.before(wrap);
    line.remove();
  } else if (before?.before) before.before(wrap);
  else (html.querySelector?.(root) ?? html).append(wrap);
  select.addEventListener("change", () => {
    if (!select.value || select.value === view.value) return;
    select.disabled = true;
    focusPending = message.id;
    pressControl(message, select.value)
      .then((answer) => {
        if (answer?.ok) return;
        focusPending = null;
        select.value = view.value;
        select.disabled = false;
        select.focus?.();
      })
      .catch((err) => {
        console.error(`${MODULE_ID} | a control end could not be set`, err);
        focusPending = null;
        select.disabled = false;
      });
  });
  if (focusPending === message.id) {
    focusPending = null;
    (globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 0)))(() => select.focus?.());
  }
}
