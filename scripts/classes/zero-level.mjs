/* global game, foundry, ChatMessage */
/**
 * The 0th-level gate (RR ch. 6, 0th Level Characters and Experience from
 * Adventuring; JJ ch. 9, Advancement to 1st Level): the threshold a
 * 0th-level character's experience is held against, and what advancing does
 * to the proficiencies they already held.
 *
 * The advance itself is the class picker binding a class at 1st, because the
 * Judge chooses the class: `applyClass` keeps the hit points such a character
 * already had, grants Adventuring and the class's 1st-level awards, and leaves
 * the experience where it stands. `settleAdvance` runs once that bind lands.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { EXPERIENCE_DOC } from "./xp-bonus.mjs";
import { abilityBucket } from "./sheet-tabs.mjs";
import { findByRef } from "./registry.mjs";
import { ADVENTURING_REF } from "./grants.mjs";
import { PROFICIENCY_BUCKETS, SETTLE, foldName, generalLimit, settleProficiencies, zeroLevelThreshold } from "./zero-level-logic.mjs";
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { cookbookId } from "../lib/library.mjs";
import { ACTOR_TYPE, ITEM_TYPE } from "../lib/vocab.mjs";
import { earnsExperience } from "../lib/actor-read.mjs";

/** The item flag a proficiency marked to erode carries: `{since}`, the world time it was marked. */
export const FLAG_ERODES = "erodes";

/**
 * Is this a character standing at 0th level? Only a level written as 0
 * counts: core starts every character at 1st, so an unset level is not 0th.
 */
export function isZeroLevel(actor) {
  const level = actor?.system?.details?.level;
  return actor?.type === ACTOR_TYPE.character && level !== null && level !== "" && Number(level) === 0;
}

/** The imported tables of the experience document, empty where no book has been read. */
const experienceTables = () => (hasDoc(EXPERIENCE_DOC) ? (getDoc(EXPERIENCE_DOC)?.tables ?? {}) : {});

/** The ref an owned ability answers to: where it was granted from, else the importer's stamp. */
const heldRef = (item) => item.flags?.[MODULE_ID]?.grantedFrom ?? cookbookId(item) ?? "";

/** The proficiencies an actor holds, as plain rows `{id, name, ref, bucket}`. */
export function heldProficiencies(actor) {
  const none = new Set();
  return (actor?.items ?? [])
    .filter((item) => item.type === ITEM_TYPE.ability)
    .map((item) => ({ id: item.id, name: item.name, ref: heldRef(item), bucket: abilityBucket(item, none) }))
    .filter((p) => PROFICIENCY_BUCKETS.includes(p.bucket));
}

/** The experience a 0th-level character needs for 1st level, or null where nothing was imported. */
export const zeroLevelXp = (actor) => zeroLevelThreshold(experienceTables().zeroLevelXp ?? null, heldProficiencies(actor).length);

/** Has a 0th-level character whose experience is tracked reached 1st level's threshold? */
export function readyForFirst(actor) {
  if (!isZeroLevel(actor) || !earnsExperience(actor)) return false;
  const need = zeroLevelXp(actor);
  return need != null && (Number(actor.system?.details?.xp?.value) || 0) >= need;
}

/** A ref with the name of the document it resolves to. */
const named = (ref) => ({ ref, name: findByRef(ref)?.name ?? "" });

/**
 * Settle the proficiencies a character held at 0th level, once the class
 * picker has bound their class at 1st (RR ch. 6; JJ ch. 9). Each one the
 * character held is answered in a dialog, first answers from
 * `settleProficiencies`: kept; replaced by a class power, and deleted unless
 * the held one IS that power; lost; or marked to erode, which the Judge
 * resolves a month at a time. The general limit and how far past it the character stands head the
 * dialog. Nothing is written if the dialog is dismissed.
 * @param {Actor} actor
 * @param {Item} classItem the class just bound
 * @param {Array<{id: string, name: string, ref: string, bucket: string}>} before
 *   `heldProficiencies(actor)` read before the bind
 */
export async function settleAdvance(actor, classItem, before) {
  const ids = new Set(actor.items.map((i) => i.id));
  const held = before.filter((p) => ids.has(p.id));
  if (!held.length) return;
  const sys = classItem.system;
  const awards = (sys.awards ?? []).filter((a) => (a.atLevel ?? 1) <= 1);
  const powers = [ADVENTURING_REF, ...awards.filter((a) => a.kind === "fixed").map((a) => a.ref)].filter(Boolean).map(named);
  const classList = (sys.inventory?.classProfs ?? []).map(named);
  const levelPicks = awards
    .filter((a) => a.kind === "choice" && a.choice?.from === "generalList")
    .reduce((n, a) => n + (Number(a.choice?.count) || 1), 0);
  const intBonus = Number(actor.system?.scores?.int?.mod) || 0;
  const implicitSlots = experienceTables().implicitSlots ?? null;
  const limit = generalLimit({ levelPicks, intBonus, implicitSlots });
  const { rows, general, over } = settleProficiencies({ held, powers, classList, limit });

  const loc = (key, data) => (data ? game.i18n.format(`${LANG_PREFIX}.zero.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.zero.${key}`));
  const esc = foundry.utils.escapeHTML;
  const bucketLabel = (bucket) => game.i18n.localize(`${LANG_PREFIX}.cattabs.${bucket}`);
  const options = (answer) =>
    Object.values(SETTLE)
      .map((s) => `<option value="${s}"${s === answer ? " selected" : ""}>${esc(loc(`answer.${s}`))}</option>`)
      .join("");
  const count =
    limit == null
      ? loc("limitUnread", { general })
      : loc("limit", { general, limit, levelPicks, intBonus: Math.max(0, intBonus), implicitSlots, over });
  const content = `
    <div class="acks-extras-classes-levelup-body">
    <p>${esc(loc("prompt", { name: actor.name, class: classItem.name }))}</p>
    <p class="hint">${esc(count)}</p>
    ${rows
      .map(
        (r, index) => `<div class="form-group">
        <label>${esc(r.name)} <span class="acks-extras-classes-refname">${esc(bucketLabel(r.bucket))}</span></label>
        <select name="settle-${index}" aria-label="${esc(r.name)}">${options(r.answer)}</select>
      </div>`,
      )
      .join("")}
    </div>`;
  // One row per proficiency held, so the body grows with the character; the
  // scroll contract keeps the footer reachable (styles/lib.css).
  const answers = await foundry.applications.api.DialogV2.prompt({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("title"), resizable: true },
    content,
    ok: {
      label: loc("apply"),
      callback: (_event, button) => rows.map((_, index) => button.form.elements[`settle-${index}`]?.value ?? SETTLE.keep),
    },
    rejectClose: false,
  });
  if (!Array.isArray(answers)) return;

  const settled = rows.map((r, index) => ({ ...r, first: r.answer, answer: answers[index] }));
  // A replaced proficiency that shares the power's ref or name stays where the
  // grant found it already held, since it IS the power then; every other
  // replaced one goes, the Judge having named the power that covers it.
  const doomed = settled.filter(
    (r) => r.answer === SETTLE.lost || (r.answer === SETTLE.replaced && (r.first !== SETTLE.replaced || standsBeside(actor, r, held))),
  );
  const eroding = settled.filter((r) => r.answer === SETTLE.erodes);
  if (doomed.length) await actor.deleteEmbeddedDocuments("Item", doomed.map((r) => r.id));
  if (eroding.length) {
    const since = game.time?.worldTime ?? 0;
    await actor.updateEmbeddedDocuments(
      "Item",
      eroding.map((r) => ({ _id: r.id, [`flags.${MODULE_ID}.${FLAG_ERODES}`]: { since } })),
    );
  }

  const list = (rs) => rs.map((r) => esc(r.name)).join(", ");
  const lines = [
    [loc("chat.replaced"), settled.filter((r) => r.answer === SETTLE.replaced)],
    [loc("chat.lost"), settled.filter((r) => r.answer === SETTLE.lost)],
    [loc("chat.erodes"), eroding],
  ].filter(([, rs]) => rs.length);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${esc(loc("chat.title", { name: actor.name, class: classItem.name }))}</p>${lines
      .map(([label, rs]) => `<p><strong>${esc(label)}:</strong> ${list(rs)}</p>`)
      .join("")}`,
  });
}

/** Does an item other than this held one, and not one held before the bind, answer to its name or ref? */
function standsBeside(actor, row, held) {
  const before = new Set(held.map((p) => p.id));
  const name = foldName(row.name);
  const ref = held.find((p) => p.id === row.id)?.ref;
  return actor.items.some(
    (i) => i.id !== row.id && !before.has(i.id) && i.type === ITEM_TYPE.ability && (foldName(i.name) === name || (!!ref && heldRef(i) === ref)),
  );
}
