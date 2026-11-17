/* global Hooks, game, foundry, fromUuid, fromUuidSync, ChatMessage, CONST, ui */
/**
 * Search the fallen: the post-battle way into a pot. When a fight ends the
 * primary Judge's client records what its defeated hostile combatants carried
 * and posts a Judge-only card; clicking the card stages a pot from that record.
 * The rules are `search-logic.mjs`'s; this file reads and writes documents for
 * them and owns the three hooks (`deleteCombat`, the card's render, and the
 * pot's `updateCards`). Nothing reaches a player until the Judge opens the pot.
 *
 * The record is built synchronously inside `deleteCombat`, before the first
 * await, because the bodies' tokens may be removed the moment after. It is
 * kept on the card's flag, which is display-level storage like every card flag.
 * Carried goods are moved, not copied: the take-off runs when the pot opens
 * (`takeOffBodies`) and only from bodies that still exist.
 */
import { gmIds, isPrimaryGM, makeLoc } from "../lib/util.mjs";
import { tokenHasStatus, tokenHitPoints } from "../lib/hp-logic.mjs";
import { isGoods } from "../lib/item-model.mjs";
import { drawQuietly } from "../lib/roll-audience.mjs";
import { STATUS_DEAD } from "../lib/status-effects.mjs";
import { LANG, MODULE_ID, POT_FLAG } from "./constants.mjs";
import { addTruths, findPot, newPot, potOf, truthsFromItem } from "./pot.mjs";
import {
  SEARCH_FLAG, carriedMap, cardRows, entryOf, fallenOf, isNaturalWeapon, needsTakeOff, normalizeRecord, openedNow, originOf, planStaging, planTakeOff,
  recordOf, specOfResult,
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
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, { rows, hasLetters: rows.some((r) => r.letter) });
  return ChatMessage.create({ content, whisper: gmIds(), flags: { [MODULE_ID]: { [SEARCH_FLAG]: record } } });
}

/* -------------------------------------------- */
/*  Staging                                      */
/* -------------------------------------------- */

/**
 * The seam the treasure tables fill: the cards a creature's treasure letter
 * deals, as truths, behind the lair warning. Nothing deals them yet, so a
 * letter adds no card and the search card says so.
 * @param {Array<{name: string, letter: string}>} _letters
 * @param {{pile: object}} _ctx
 * @returns {Promise<object[]>}
 */
export async function dealLetter(_letters, _ctx) {
  return [];
}

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

/** Messages being staged, so a second click while the first runs does nothing. */
const staging = new Set();

/**
 * Stage a pot from a card's record: carried goods become cards, each linked
 * table is drawn quietly, and the pot opens in the Judge's window. A pot
 * already staged from the card is opened again, never made twice. Judge-only.
 * @param {ChatMessage} message the search card
 * @returns {Promise<Cards|null>}
 */
export async function stageFromCard(message) {
  if (!game.user.isGM) {
    ui.notifications?.warn(loc("refuse.judgeOnly"));
    return null;
  }
  const record = normalizeRecord(message?.flags?.[MODULE_ID]?.[SEARCH_FLAG]);
  if (record.stagedPot) {
    const existing = fromUuidSync(record.stagedPot);
    if (existing && findPot(existing.id)) {
      existing.sheet?.render(true);
      return existing;
    }
    ui.notifications?.warn(loc("search.potGone"));
    return null;
  }
  if (staging.has(message.id)) return null;
  staging.add(message.id);
  try {
    const plan = planStaging(record);
    const pile = await newPot({ name: loc("search.potName"), render: false });
    if (!pile) return null;
    // The card names the pot at once, so a failure partway never stages a second.
    await message.update({ [`flags.${MODULE_ID}.${SEARCH_FLAG}.stagedPot`]: pile.uuid });
    await pile.update({ [originPath]: originOf({ record, messageId: message.id }) });
    const goodsIds = await addTruths(pile, plan.goods.map((g) => g.truth));
    const carried = carriedMap(plan.goods.map((g) => g.owner), goodsIds);
    if (Object.keys(carried).length) await pile.update({ [`${originPath}.carried`]: carried });
    const drawn = await drawTables(plan.draws);
    if (drawn.truths.length) await addTruths(pile, drawn.truths);
    const letterTruths = await dealLetter(plan.letters, { pile });
    if (letterTruths.length) await addTruths(pile, letterTruths);
    if (drawn.lines.length) await message.update({ [`flags.${MODULE_ID}.${SEARCH_FLAG}.drawnText`]: drawn.lines });
    pile.sheet?.render(true);
    return pile;
  } finally {
    staging.delete(message.id);
  }
}

/* -------------------------------------------- */
/*  Opening: the take-off                        */
/* -------------------------------------------- */

/**
 * Take the goods an opened pot holds off the bodies that still carry them.
 * The origin is marked first, so a second update event cannot take twice; a
 * body that is gone leaves its card standing on the snapshot.
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
  const button = html.querySelector('[data-action="stagePot"]');
  if (record.stagedPot && button) button.textContent = loc("search.open");
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
    stageFromCard(message).catch((err) => {
      console.error(`${MODULE_ID} | search the fallen could not stage a pot`, err);
      ui.notifications?.error(loc("search.failed"));
    });
  });
});

// The client that opened the pot takes the goods off; opening is Judge-only.
Hooks.on("updateCards", (pile, changes, _options, userId) => {
  if (userId !== game.user?.id || !openedNow(changes) || !findPot(pile.id)) return;
  takeOffBodies(pile).catch((err) => console.error(`${MODULE_ID} | search the fallen could not take goods off the bodies`, err));
});
