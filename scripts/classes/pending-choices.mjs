/* global game, foundry, ui, console, Hooks, fromUuid */
/**
 * A pick the character owes, as something they can see and act on.
 *
 * A printed package does not only hand over things; sometimes it hands over a
 * CHOICE — "and one spell of character's choice", a proficiency cell offering
 * a pick rather than naming one. Recorded as a sentence on a note, that choice
 * is invisible on the character sheet and is simply never made: the player
 * never learns they were owed it. So the offer is minted as an owned item that
 * says what it is and opens a chooser when clicked, and is REPLACED by the
 * document the player picks.
 *
 * WHY THIS IS NOT THE PLACEHOLDER MINTING 4.20.0 REMOVED. That ruling
 * (lib/DECISIONS.md) was about names a world could not resolve YET: an
 * unresolved name has a right answer, so a placeholder for it is a duplicate
 * waiting to happen — it answers its own name search, reads as real, and gets
 * dragged onto a character beside the real thing when the import finally
 * arrives. An open CHOICE has no right answer until a player makes one. The
 * distinction is where the document lives: nothing here is ever written to the
 * world library, only ever embedded on the actor who owes the pick. A
 * placeholder in the library is a lie about what the world contains; a
 * placeholder on a character is a true statement about what that character
 * owes.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_PENDING_CHOICE, FLAG_REDEEMED_CHOICES } from "./constants.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";
import { grantAbility, warmSpellPacks } from "./grants.mjs";
import { rungOptions, rungSelectHtml } from "./picks.mjs";

/**
 * Is this template row an OFFER rather than a grant?
 *
 * Read off the explicit flag and nothing else. An emptiness test would be
 * cheaper and is wrong: the class sheet's row-add builds a blank row, and a
 * blank row's ChoiceSpec initialises with a source, so "no name and a choice"
 * describes a Judge who has just pressed + as accurately as it describes an
 * offer — and would put a phantom pending pick on every character generated on
 * that band.
 */
export const isOffer = (entry) => entry?.offer === true;

/**
 * How one offer is remembered.
 *
 * NEVER an array index: materializing a template rewrites the row's arrays
 * (the represented entries are stripped out), and the non-bundle path grants
 * from a spliced copy, so the same printed offer sits at different positions on
 * different passes and an index-keyed marker would be minted twice. The
 * importer writes a stable `choice.key`; without one the offer is identified by
 * what it OFFERS, which is stable for the same printed cell.
 */
export function offerKey(entry, { classKey = "", band = "", kind = "" } = {}) {
  const c = entry?.choice ?? {};
  const own = String(c.key ?? "").trim();
  const what = own || [c.from, c.filter, c.count, c.label].map((x) => String(x ?? "")).join("|");
  return [classKey, band, kind, what].join("::");
}

/** Every un-redeemed pending choice the actor is carrying. */
export const pendingChoices = (actor) =>
  (actor?.items ?? []).filter((i) => i.getFlag?.(MODULE_ID, FLAG_PENDING_CHOICE));

/** Offer keys this actor has already answered or is already being asked. */
function settledKeys(actor) {
  const redeemed = actor?.getFlag?.(MODULE_ID, FLAG_REDEEMED_CHOICES) ?? [];
  const open = pendingChoices(actor).map((i) => i.getFlag(MODULE_ID, FLAG_PENDING_CHOICE)?.key);
  return new Set([...(Array.isArray(redeemed) ? redeemed : []), ...open].filter(Boolean));
}

/** Has this offer already been minted for, or answered by, this character? */
export const alreadySettled = (actor, key) => settledKeys(actor).has(key);

/**
 * The item data for one pending choice.
 *
 * Typed `ability` whatever it offers — including a spell — because it is not
 * the thing yet, and typing it `spell` would put an empty spell in the
 * character's repertoire with a casting time and no effect. What it becomes is
 * created fresh from the document the player picks.
 */
export function buildPendingChoice(entry, { key, classUuid = "" } = {}) {
  const label = String(entry?.choice?.label ?? "").trim();
  const name = label
    ? game.i18n?.format?.(`${LANG_PREFIX}.pending.namedOffer`, { label }) ?? `Choose: ${label}`
    : game.i18n?.localize?.(`${LANG_PREFIX}.pending.offer`) ?? "Choose";
  return {
    name,
    type: ITEM_TYPE.ability,
    img: "icons/svg/question.svg",
    system: {},
    flags: {
      [MODULE_ID]: {
        [FLAG_PENDING_CHOICE]: { key, classUuid, choice: foundry.utils.deepClone(entry?.choice ?? {}) },
      },
    },
  };
}

/**
 * Mint a marker for every offer among `rows` this character has not settled.
 *
 * Idempotent by construction: an offer whose key is already open or already
 * redeemed is skipped, so re-materializing, re-applying and re-running chargen
 * cannot double one, and a pick the player has already made never comes back.
 *
 * @returns {Promise<Array<{key: string, name: string}>>} what was minted
 */
export async function mintPendingChoices(actor, rows, { classKey = "", band = "", kind = "", classUuid = "" } = {}) {
  if (!actor) return [];
  const settled = settledKeys(actor);
  const data = [];
  const minted = [];
  for (const entry of rows ?? []) {
    if (!isOffer(entry)) continue;
    const key = offerKey(entry, { classKey, band, kind });
    if (settled.has(key)) continue;
    settled.add(key); // two identical offers in one cell are one pick, not two
    const item = buildPendingChoice(entry, { key, classUuid });
    data.push(item);
    minted.push({ key, name: item.name });
  }
  if (data.length) await actor.createEmbeddedDocuments("Item", data);
  return minted;
}

/**
 * Replace a pending choice with what the player picked.
 *
 * The grant comes first and the marker is deleted only if it landed: a failed
 * grant that had already removed the marker would lose the pick with nothing
 * on screen to say so.
 */
export async function redeemChoice(actor, item, ref) {
  const pending = item?.getFlag?.(MODULE_ID, FLAG_PENDING_CHOICE);
  if (!pending || !ref) return false;
  const grants = [];
  await grantAbility(actor, ref, grants);
  if (grants[0]?.missing) {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.pending.unresolved`, { ref }));
    return false;
  }
  const held = actor.getFlag(MODULE_ID, FLAG_REDEEMED_CHOICES) ?? [];
  const keys = [...new Set([...(Array.isArray(held) ? held : []), pending.key].filter(Boolean))];
  await actor.setFlag(MODULE_ID, FLAG_REDEEMED_CHOICES, keys);
  await item.delete();
  return true;
}

/** Ask the player which option this marker becomes, then redeem it. */
export async function openChoiceDialog(actor, item) {
  const pending = item?.getFlag?.(MODULE_ID, FLAG_PENDING_CHOICE);
  if (!pending) return false;
  const classItem = pending.classUuid ? await fromUuid(pending.classUuid).catch(() => null) : null;
  // Spells live in compendia that are cold until something loads them.
  if (pending.choice?.from === "spellList") await warmSpellPacks();
  const options = classItem ? rungOptions(pending.choice, classItem, actor) : [];
  if (!options.length) {
    ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.pending.noOptions`));
    return false;
  }
  const content = rungSelectHtml({
    name: "pick",
    label: pending.choice?.label || game.i18n.localize(`${LANG_PREFIX}.pending.offer`),
    options,
    // The "already on the sheet" and "leave open" answers are not ones this
    // dialog can honour — it redeems a marker or leaves it standing — so the
    // only way to close it without spending the pick is to cancel.
    offerAnswered: false,
    placeholder: true,
  });
  let ref = null;
  try {
    ref = await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: game.i18n.localize(`${LANG_PREFIX}.pending.title`) },
      content,
      modal: true,
      ok: { callback: (_event, button) => button.form.elements.pick.value },
      rejectClose: true,
    });
  } catch {
    return false; // dismissed
  }
  return ref ? redeemChoice(actor, item, ref) : false;
}

/** Open the chooser when a pending marker is clicked on a character sheet. */
function onRenderCharacterSheet(app, element) {
  try {
    const actor = app?.document;
    if (actor?.documentName !== "Actor" || actor.type !== ACTOR_TYPE.character) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;
    for (const item of pendingChoices(actor)) {
      for (const row of root.querySelectorAll(`[data-item-id="${item.id}"]`)) {
        row.classList.add("acks-extras-classes-pending");
        row.dataset.tooltip = game.i18n.localize(`${LANG_PREFIX}.pending.hint`);
        row.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openChoiceDialog(actor, item).catch((err) => {
            console.error(`${MODULE_ID} | opening a pending choice failed`, err);
            ui.notifications?.error(game.i18n.localize(`${LANG_PREFIX}.pending.failed`));
          });
        });
      }
    }
  } catch (err) {
    console.error(`${MODULE_ID} | pending-choice markers failed; the sheet stands`, err);
  }
}

/** Wire the sheet decoration. */
export function registerPendingChoices() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
  Hooks.on("renderActorSheetV2", onRenderCharacterSheet);
}
