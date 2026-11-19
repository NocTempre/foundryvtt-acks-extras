/* global Hooks, game, foundry, fromUuid, fromUuidSync, ChatMessage, CONST, ui */
/**
 * Search the fallen: the post-battle way into a scene search. When a fight ends
 * the primary Judge's client records what its defeated hostile combatants
 * carried and posts a Judge-only card; its Search the scene button opens the
 * scene search (`acksExtras.sceneSearch.searchHere`) with that record, which
 * turns the fallen into the scene's bodies. The rules are `search-logic.mjs`'s;
 * this file reads and writes documents for them and owns the three hooks
 * (`deleteCombat`, the card's render, and the pot's `updateCards`). Nothing
 * reaches a player until the Judge shows the scene.
 *
 * The record is built synchronously inside `deleteCombat`, before the first
 * await, because the bodies' tokens may be removed the moment after. It is
 * kept on the card's flag, which is display-level storage like every card flag.
 * Carried goods are moved, not copied: the take-off runs when a pot whose origin
 * asks for it opens (`takeOffBodies`) and only from bodies that still exist.
 */
import { gmIds, isPrimaryGM, makeLoc } from "../lib/util.mjs";
import { tokenHasStatus, tokenHitPoints } from "../lib/hp-logic.mjs";
import { isGoods } from "../lib/item-model.mjs";
import { drawQuietly } from "../lib/roll-audience.mjs";
import { STATUS_DEAD } from "../lib/status-effects.mjs";
import { acksExtras } from "../namespace.mjs";
import { LANG, MODULE_ID, POT_FLAG } from "./constants.mjs";
import { findPot, potOf, truthsFromItem } from "./pot.mjs";
import {
  DRAW_REQUEST, SEARCH_FLAG, cardRows, entryOf, fallenOf, isNaturalWeapon, needsTakeOff, normalizeRecord, openedNow, planTakeOff, recordOf, specOfResult,
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
 * Judge to read (the card's `drawnText`, shown by its render hook).
 * @param {{messageId: string|null, name: string, tableUuid: string}} draw the card the record is on, the creature, and its table
 * @returns {Promise<object[]>} the truths the table dealt
 */
export async function drawFallenTable({ messageId, name, tableUuid }) {
  const drawn = await drawTables([{ name, tableUuid, request: { ...DRAW_REQUEST } }]);
  const message = messageId ? game.messages?.get(messageId) : null;
  if (message && drawn.lines.length) {
    const held = normalizeRecord(message.flags?.[MODULE_ID]?.[SEARCH_FLAG]).drawnText;
    await message.update({ [`flags.${MODULE_ID}.${SEARCH_FLAG}.drawnText`]: [...held, ...drawn.lines] });
  }
  return drawn.truths;
}

/** The fight's record on a card's message, or null where the message is gone or carries none. */
export function recordOfMessage(messageId) {
  return game.messages?.get(messageId)?.flags?.[MODULE_ID]?.[SEARCH_FLAG] ?? null;
}

/** Mark a card's record as opened, so the card deals once: a second search of the same fight is refused once its scene search has ended. */
export async function markCardOpened(messageId) {
  await game.messages?.get(messageId)?.update({ [`flags.${MODULE_ID}.${SEARCH_FLAG}.opened`]: true });
}

/** Open the scene search for a card's record. The scene search says why it refuses. */
async function searchFromCard(message) {
  const searchHere = acksExtras.sceneSearch?.searchHere;
  if (typeof searchHere !== "function") return;
  await searchHere({ recordMessageId: message.id });
}

/* -------------------------------------------- */
/*  Opening: the take-off                        */
/* -------------------------------------------- */

/**
 * Take the goods an opened pot holds off the bodies that still carry them, where
 * its origin asks for it (`takeOff`). The origin is marked first, so a second
 * update event cannot take twice; a body that is gone leaves its card standing
 * on the snapshot.
 * @returns {Promise<number>} the items deleted
 */
export async function takeOffBodies(pile) {
  const pot = potOf(pile);
  if (!needsTakeOff(pot.origin)) return 0;
  const has = (actorUuid, itemId) => !!actorOfUuid(actorUuid)?.items?.get(itemId);
  const plan = planTakeOff({ carried: pot.origin.carried, order: pot.order, exists: has });
  await pile.update({ [`${originPath}.takenOff`]: true });
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
  if (!flag || !game.user.isGM) return;
  const record = normalizeRecord(flag);
  const button = html.querySelector('[data-action="searchScene"]');
  if (record.opened && button) button.textContent = loc("search.open");
  const list = html.querySelector('[data-field="text"]');
  if (list && record.drawnText.length) {
    list.replaceChildren(
      ...record.drawnText.map((line) => {
        const li = list.ownerDocument.createElement("li");
        li.textContent = line;
        return li;
      }),
    );
    html.querySelector('[data-field="textWrap"]').hidden = false;
  }
  button?.addEventListener("click", () => {
    searchFromCard(message).catch((err) => {
      console.error(`${MODULE_ID} | search the fallen could not open the scene search`, err);
      ui.notifications?.error(loc("search.failed"));
    });
  });
});

// The client that opened the pot takes the goods off; opening is Judge-only.
Hooks.on("updateCards", (pile, changes, _options, userId) => {
  if (userId !== game.user?.id || !openedNow(changes) || !findPot(pile.id)) return;
  takeOffBodies(pile).catch((err) => console.error(`${MODULE_ID} | search the fallen could not take goods off the bodies`, err));
});
