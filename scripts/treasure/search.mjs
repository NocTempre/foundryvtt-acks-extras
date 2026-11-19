/* global Hooks, game, foundry, fromUuid, fromUuidSync, ChatMessage, CONST, ui */
/**
 * Search the fallen: the post-battle way into a scene search. When a fight ends
 * the primary Judge's client records what its defeated hostile combatants
 * carried and posts a Judge-only card; its Search the scene button opens the
 * scene search (`acksExtras.sceneSearch.searchHere`) with that record, which
 * turns the fallen into the scene's bodies. The rules are `search-logic.mjs`'s;
 * this file reads and writes documents for them and owns the two hooks
 * (`deleteCombat` and the card's render). Nothing reaches a player until the
 * Judge shows the scene.
 *
 * The record is built synchronously inside `deleteCombat`, before the first
 * await, because the bodies' tokens may be removed the moment after. It is
 * kept on the card's flag, which is display-level storage like every card flag.
 * Carried goods are moved, not copied: the scene search calls `takeOffBodies`
 * for the lots a check has just found, so a good leaves its body when its lot
 * is found, and only from a body that still exists.
 */
import { gmIds, isPrimaryGM, makeLoc } from "../lib/util.mjs";
import { tokenHasStatus, tokenHitPoints } from "../lib/hp-logic.mjs";
import { isGoods } from "../lib/item-model.mjs";
import { drawQuietly } from "../lib/roll-audience.mjs";
import { STATUS_DEAD } from "../lib/status-effects.mjs";
import { acksExtras } from "../namespace.mjs";
import { LANG, MODULE_ID, POT_FLAG } from "./constants.mjs";
import { potOf, truthsFromItem } from "./pot.mjs";
import {
  DRAW_REQUEST, SEARCH_FLAG, bodyActorOf, cardRows, entryOf, fallenOf, heldDraw, isNaturalWeapon, needsTakeOff, normalizeRecord, planTakeOff, recordOf, settleSheetButtons,
  specOfResult,
} from "./search-logic.mjs";

const loc = makeLoc(LANG);
const originPath = `flags.${MODULE_ID}.${POT_FLAG}.origin`;
const TEMPLATE = `modules/${MODULE_ID}/templates/treasure/search-card.hbs`;

/** The actor a uuid names: a world actor, or the actor behind an unlinked token's uuid. Null once it is gone. */
function actorOfUuid(uuid) {
  try {
    const doc = uuid ? fromUuidSync(uuid) : null;
    if (doc?.documentName === "Token") return doc.actor ?? null;
    return doc?.documentName === "Actor" ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Whether a fallen body's uuid still names an actor to open, for a control that
 * is drawn disabled where it does not.
 * @param {string|null} uuid the fallen's actor uuid
 */
export function bodySheetExists(uuid) {
  return !!bodyActorOf(uuid, fromUuidSync);
}

/**
 * Open the sheet of the actor a fallen body stands for (an unlinked token's own
 * actor where the body has a token). A body whose actor and token are gone
 * opens nothing, says nothing and throws nothing. Reads only: nothing is taken
 * from the sheet.
 * @param {string|null} uuid the fallen's actor uuid
 * @returns {boolean} whether a sheet was asked to open
 */
export function openBodySheet(uuid) {
  const sheet = bodyActorOf(uuid, fromUuidSync)?.sheet;
  if (!sheet) return false;
  sheet.render({ force: true });
  return true;
}

/* -------------------------------------------- */
/*  The record                                   */
/* -------------------------------------------- */

/** What the tracker and the token say of one combatant, as `CombatantFacts`. */
function factsOf(combatant) {
  const token = combatant.token ?? null;
  const actor = combatant.actor ?? null;
  return {
    id: combatant.id,
    name: combatant.name ?? actor?.name ?? "",
    actorUuid: actor?.uuid ?? null,
    disposition: token ? (token.disposition ?? null) : null,
    flagged: !!(combatant.defeated || combatant.isDefeated),
    dead: actor ? tokenHasStatus(token, actor, STATUS_DEAD) : false,
    hp: actor ? (tokenHitPoints(token, actor)?.value ?? null) : null,
  };
}

/** The goods a body carries as snapshot truths, `[{itemId, truths}]`. Synchronous. */
function goodsOf(actor) {
  return (actor.items?.contents ?? [])
    .filter((item) => isGoods(item) && !isNaturalWeapon(item, { ownerType: actor.type }))
    .map((item) => ({ itemId: item.id, truths: truthsFromItem(item) }));
}

/**
 * The record of a combat that ended, or null when no fallen creature held
 * anything. Reads every document before returning and awaits nothing.
 */
export function recordCombat(combat) {
  const hostile = CONST.TOKEN_DISPOSITIONS.HOSTILE;
  const byId = new Map(combat.combatants.map((c) => [c.id, c]));
  const entries = fallenOf(combat.combatants.map(factsOf), { hostile }).map((facts) => {
    const actor = byId.get(facts.id).actor;
    return entryOf(facts, { goods: goodsOf(actor), treasure: actor.system?.details?.treasure ?? {} });
  });
  return recordOf({ combatId: combat.id, sceneId: combat.scene?.id ?? combat.sceneId ?? null, entries });
}

/** Post the Judge-only card carrying a record. */
async function postSearchCard(record) {
  const rows = cardRows(record);
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, { rows });
  return ChatMessage.create({ content, whisper: gmIds(), flags: { [MODULE_ID]: { [SEARCH_FLAG]: record } } });
}

/* -------------------------------------------- */
/*  Drawing                                      */
/* -------------------------------------------- */

/** Draw each linked table quietly and sort its results into item truths and lines of text. */
async function drawTables(draws) {
  const truths = [];
  const lines = [];
  for (const draw of draws) {
    const table = await fromUuid(draw.tableUuid);
    if (!table?.draw) {
      ui.notifications?.warn(loc("search.noTable", { name: draw.name }));
      continue;
    }
    const drawn = await drawQuietly(table, draw.request);
    for (const result of drawn?.results ?? []) {
      const spec = specOfResult(result);
      if (!spec) continue;
      const item = spec.kind === "item" ? await fromUuid(spec.uuid) : null;
      if (item?.documentName === "Item") truths.push(...truthsFromItem(item));
      else if (spec.label) lines.push(spec.label);
    }
  }
  return { truths, lines };
}

/**
 * Draw one fallen creature's linked table quietly, for the scene search that
 * is opening from a card. A result that points at an item is made into the
 * truths of its cards; a result that is only text is kept on the card for the
 * Judge to read (the card's `drawnText`, shown by its render hook). The truths
 * are kept on the card by combatant, and a later press for the same body takes
 * them from there without rolling again (`heldDraw`).
 * @param {{messageId: string|null, combatantId?: string|null, name: string, tableUuid: string}} draw the card the record is on, the fallen's combatant, the creature, and its table
 * @returns {Promise<object[]>} the truths the table dealt
 */
export async function drawFallenTable({ messageId, combatantId = null, name, tableUuid }) {
  const message = messageId ? game.messages?.get(messageId) : null;
  const flag = message?.flags?.[MODULE_ID]?.[SEARCH_FLAG] ?? null;
  const held = combatantId ? heldDraw(flag, combatantId) : null;
  if (held) return held;
  const drawn = await drawTables([{ name, tableUuid, request: { ...DRAW_REQUEST } }]);
  if (message) {
    const update = {};
    if (combatantId) update[`flags.${MODULE_ID}.${SEARCH_FLAG}.drawnBy.${combatantId}`] = drawn.truths;
    if (drawn.lines.length) update[`flags.${MODULE_ID}.${SEARCH_FLAG}.drawnText`] = [...normalizeRecord(flag).drawnText, ...drawn.lines];
    if (Object.keys(update).length) await message.update(update);
  }
  return drawn.truths;
}

/** The fight's record on a card's message, or null where the message is gone or carries none. */
export function recordOfMessage(messageId) {
  return game.messages?.get(messageId)?.flags?.[MODULE_ID]?.[SEARCH_FLAG] ?? null;
}

/**
 * Mark a card's record as opened, so the card deals once, and keep what the
 * opening made: the pot, the place it opened at and each dealt lot's key, entry
 * and layer. A Judge's later press on the card reopens the scene from these
 * without dealing again; a player's is refused.
 * @param {string} messageId
 * @param {{potUuid?: string|null, placeUuid?: string|null, lots?: Array<{key: string, thing: string, layer: string}>}} [made] what the opening made
 */
export async function markCardOpened(messageId, { potUuid = null, placeUuid = null, lots = [] } = {}) {
  const base = `flags.${MODULE_ID}.${SEARCH_FLAG}`;
  await game.messages?.get(messageId)?.update({
    [`${base}.opened`]: true,
    [`${base}.potUuid`]: potUuid,
    [`${base}.placeUuid`]: placeUuid,
    [`${base}.lots`]: lots.map(({ key, thing, layer }) => ({ key, thing, layer })),
  });
}

/** Open the scene search for a card's record. The scene search says why it refuses. */
async function searchFromCard(message) {
  const searchHere = acksExtras.sceneSearch?.searchHere;
  if (typeof searchHere !== "function") return;
  await searchHere({ recordMessageId: message.id });
}

/* -------------------------------------------- */
/*  The take-off                                 */
/* -------------------------------------------- */

/**
 * Take the goods of these cards off the bodies that still carry them, where the
 * pot's origin asks for it (`takeOff`). The scene search calls it with the cards
 * a check has just found, so a good leaves its body when its lot is found and
 * never before. The cards are recorded in the origin's `taken` first, so a
 * second call for the same card (a reopened search, a repeated find) takes
 * nothing; a body that is gone leaves its card standing on the snapshot.
 * @param {Cards} pile the scene's pot
 * @param {{cardIds?: string[]|null}} [options] `cardIds`: the cards to take for, every mapped card where null
 * @returns {Promise<number>} the items deleted
 */
export async function takeOffBodies(pile, { cardIds = null } = {}) {
  const pot = potOf(pile);
  if (!needsTakeOff(pot.origin, cardIds)) return 0;
  const has = (actorUuid, itemId) => !!actorOfUuid(actorUuid)?.items?.get(itemId);
  const plan = planTakeOff({ carried: pot.origin.carried, order: pot.order, exists: has, taken: pot.origin.taken, only: cardIds });
  if (!plan.settled.length) return 0;
  await pile.update({ [`${originPath}.taken`]: [...(Array.isArray(pot.origin.taken) ? pot.origin.taken : []), ...plan.settled] });
  let removed = 0;
  for (const { actorUuid, itemId } of plan.take) {
    try {
      await actorOfUuid(actorUuid)?.items?.get(itemId)?.delete();
      removed++;
    } catch (err) {
      console.error(`${MODULE_ID} | search the fallen could not take an item off a body`, err);
    }
  }
  return removed;
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

Hooks.on("deleteCombat", (combat) => {
  if (!isPrimaryGM()) return;
  let record;
  try {
    record = recordCombat(combat);
  } catch (err) {
    console.error(`${MODULE_ID} | search the fallen could not read the fight`, err);
    return;
  }
  if (record) {
    postSearchCard(record).catch((err) => console.error(`${MODULE_ID} | search the fallen could not post its card`, err));
  }
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  const flag = message.flags?.[MODULE_ID]?.[SEARCH_FLAG];
  if (!flag) return;
  // The open-sheet buttons are a Judge's: removed here for any other seat, never hidden by the template.
  const sheetButtons = [...html.querySelectorAll('[data-action="openSheet"]')];
  settleSheetButtons(sheetButtons, { isGM: game.user.isGM, record: flag, resolve: fromUuidSync });
  if (!game.user.isGM) return;
  const record = normalizeRecord(flag);
  for (const sheetButton of sheetButtons) {
    sheetButton.addEventListener("click", () => {
      const row = record.fallen.find((e) => e.combatantId === sheetButton.dataset.combatant);
      openBodySheet(row?.actorUuid ?? null);
    });
  }
  const button = html.querySelector('[data-action="searchScene"]');
  if (record.opened && button) button.textContent = loc("search.open");
  // The block is hidden here, never by the template: a chat card's stored content loses its `hidden` attribute.
  const wrap = html.querySelector('[data-field="textWrap"]');
  const list = html.querySelector('[data-field="text"]');
  if (wrap) wrap.hidden = !(list && record.drawnText.length);
  if (list && record.drawnText.length) {
    list.replaceChildren(
      ...record.drawnText.map((line) => {
        const li = list.ownerDocument.createElement("li");
        li.textContent = line;
        return li;
      }),
    );
  }
  button?.addEventListener("click", () => {
    searchFromCard(message).catch((err) => {
      console.error(`${MODULE_ID} | search the fallen could not open the scene search`, err);
      ui.notifications?.error(loc("search.failed"));
    });
  });
});
