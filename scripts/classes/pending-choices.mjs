/* global game, foundry, ui, console, Hooks, fromUuid */
/**
 * A pick the character owes, as something they can see and act on.
 *
 * A pick the character owes, as something they can see and act on: a package
 * that hands over a choice (a spell left to the pick, a proficiency cell
 * offering a pick, RR p. 35) is minted as an owned item that opens a chooser
 * when clicked and is replaced by the document the player picks.
 *
 * The marker is only ever embedded on the actor who owes the pick, never written
 * to the world library, which is what separates it from a placeholder minted for
 * an unresolved name. See docs/classes/DECISIONS.md, "a pick the character owes
 * is an item on the character".
 */
import { MODULE_ID, LANG_PREFIX, FLAG_PENDING_CHOICE, FLAG_REDEEMED_CHOICES } from "./constants.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";
import { grantAbility, warmSpellPacks } from "./grants.mjs";
import { whenReady } from "../lib/library.mjs";
import { rungOptions, rungSelectHtml } from "./picks.mjs";
import { elementOf } from "../lib/util.mjs";

/**
 * Is this template row an OFFER rather than a grant?
 *
 * Read off the explicit flag alone: a blank row the class sheet's row-add
 * builds also has a ChoiceSpec with a source, so an emptiness test would mint a
 * phantom pick.
 */
export const isOffer = (entry) => entry?.offer === true;

/**
 * How one offer is remembered.
 *
 * Never an array index: the same offer sits at different positions across
 * materializing and the non-bundle grant, so an index key would mint twice. The
 * importer writes a stable `choice.key`; without one the offer is identified by
 * what it offers.
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

/**
 * The item data for one pending choice.
 *
 * Typed `ability` whatever it offers, a spell included: typed `spell` it would
 * put an empty spell in the repertoire. What it becomes is created fresh from
 * the document the player picks.
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
 * Idempotent: an offer whose key is already open or redeemed is skipped.
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
 * The grant comes first; the marker is deleted only if it landed.
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
  // The options are read from the imported library; a shelf still warming would
  // read as no options.
  await whenReady();
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
    // This dialog redeems a marker or leaves it standing, so it offers no
    // "already on the sheet" or "leave open" answer.
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
    const root = elementOf(element);
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
