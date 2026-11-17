/* global game, foundry, fromUuid, fromUuidSync, ChatMessage, CONST, ui */
/**
 * A pot's Foundry half: the pile document, the cards a Judge puts in it, what a
 * claim delivers, opening it to the table and closing it. The rules are
 * `pot-logic.mjs`'s and the relay's guards are `pot-relay.mjs`'s; this file
 * reads and writes documents for them.
 *
 * A pot is one core `pile` Cards document, GM-only through staging; opening
 * gives its audience LIMITED sight and never OWNER, so no seat can pass or
 * delete a card except through the relay. Closing deletes the pile by its own
 * id, with no chat notification.
 */
import { ITEM_FLAGS } from "../equipment/constants.mjs";
import { disguiseData } from "../equipment/disguise-logic.mjs";
import { makeLoc } from "../lib/util.mjs";
import { listsGoods, deliverItems, droppedGoods } from "../lib/bundles.mjs";
import { HOUSE_OWNER, coinTemplate, creditCoin, mintCoin } from "../lib/money.mjs";
import { isProvider, stockProvider } from "../lib/storage.mjs";
import { magicKnowledge, weight6Of } from "../lib/item-model.mjs";
import { CARD_FLAG, LANG, MODULE_ID, PHASE, POOL, POT_FLAG, POT_SHEET_KEY, REFUSAL } from "./constants.mjs";
import {
  buildCard, claimCoinCredits, claimItemData, haulOf, normalizePot, normalizeTruth, planClose, planOpen, potCards, setToggle, stage,
  turnedOf, unstage, cardView,
} from "./pot-logic.mjs";
import { createRelay } from "./pot-relay.mjs";

const loc = makeLoc(LANG);

const potPath = `flags.${MODULE_ID}.${POT_FLAG}`;
const cardPath = `flags.${MODULE_ID}.${CARD_FLAG}`;

/** A pile that is a pot: it carries the treasure flag. */
export const isPot = (pile) => pile?.documentName === "Cards" && pile.type === "pile" && !!pile.flags?.[MODULE_ID]?.[POT_FLAG];

/** The pot's flag, normalized. */
export const potOf = (pile) => normalizePot(pile?.flags?.[MODULE_ID]?.[POT_FLAG]);

/** The `PotView` of a pile: its flag and a plain row per Card. `cards` is an EmbeddedCollection, so `.contents`. */
export function viewOf(pile) {
  return {
    id: pile.id,
    pot: potOf(pile),
    cards: pile.cards.contents.map((c) => ({
      id: c.id,
      face: c.face,
      value: c.value,
      truth: normalizeTruth(c.flags?.[MODULE_ID]?.[CARD_FLAG]),
    })),
  };
}

const poolLabel = (pool) => loc(`pool.${pool}`);

/** The pot's pile, found by id, or null when the id names no pot. */
export const findPot = (id) => {
  const pile = game.cards?.get(id);
  return isPot(pile) ? pile : null;
};

/* -------------------------------------------- */
/*  Making a pot and putting cards in it         */
/* -------------------------------------------- */

/**
 * A new pot in staging, GM-only, with its own sheet chosen. Judge-only.
 * @param {{name?: string, render?: boolean}} [opts]
 * @returns {Promise<Cards|null>}
 */
export async function newPot({ name = "", render = true } = {}) {
  if (!game.user.isGM) {
    ui.notifications?.warn(loc("refuse.judgeOnly"));
    return null;
  }
  const pile = await foundry.documents.Cards.implementation.create({
    name: name || loc("pot.defaultName"),
    type: "pile",
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { core: { sheetClass: POT_SHEET_KEY }, [MODULE_ID]: { [POT_FLAG]: normalizePot({}) } },
  });
  if (pile && render) pile.sheet?.render(true);
  return pile;
}

/** The mask a dropped item already wears (the equipment feature's disguise), or null. */
function maskOf(item) {
  const flag = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE) ?? item?.flags?.[MODULE_ID]?.[ITEM_FLAGS.DISGUISE];
  const apparent = flag?.apparent;
  return apparent && (apparent.name || apparent.img) ? { ...apparent } : null;
}

/**
 * The truths a dropped item makes, one per document it delivers (a bundle is
 * several). Knowledge of its magic is read from the live item, since a
 * snapshot cannot see a variation applied inside it.
 */
export function truthsFromItem(item) {
  return droppedGoods(item).map((data, i) => {
    const live = i === 0 ? item : null;
    const disguise = data.flags?.[MODULE_ID]?.[ITEM_FLAGS.DISGUISE];
    const known = live ? magicKnowledge(live, { isGM: false }) : { magical: false, detected: true, identified: "none" };
    const base = { source: { uuid: item.uuid, data }, weight6: live ? weight6Of(live) : 0 };
    if (data.type === "money") {
      const count = Math.max(0, Math.floor(Number(data.system?.quantity) || 0));
      const cv = Number(data.system?.coppervalue) || 1;
      return normalizeTruth({
        ...base,
        pool: POOL.coins,
        label: `${count.toLocaleString(game.i18n.lang)} ${data.name}`,
        coin: { name: data.name, cv, count },
      });
    }
    return normalizeTruth({
      ...base,
      pool: known.magical ? POOL.magic : POOL.item,
      label: disguise?.true?.name ?? data.name,
      mask: maskOf(item),
      magical: known.magical,
      detected: known.detected,
      identified: known.identified,
    });
  });
}

/**
 * Put cards for `truths` in the pot, face down: into `order`, or into a seed
 * bucket. Staging only; Judge-only. The pile's `order` and bucket lists are
 * written in the same update that lists the new ids, after the Cards exist.
 * @returns {Promise<string[]>} the new card ids
 */
export async function addTruths(pile, truths, { bucket = null } = {}) {
  if (!game.user.isGM || potOf(pile).phase !== PHASE.staging || !truths.length) return [];
  const data = truths.map((t) => buildCard({ ...t, bucket }, { poolLabel }));
  const made = await pile.createEmbeddedDocuments("Card", data);
  let pot = potOf(pile);
  for (const c of made) pot = stage(pot, c.id, { bucket }) ?? pot;
  await pile.update({ [potPath]: pot });
  return made.map((c) => c.id);
}

/** Take a card out of a staged pot and delete it. Judge-only. */
export async function removeStaged(pile, cardId) {
  const pot = unstage(potOf(pile), cardId);
  if (!game.user.isGM || !pot) return;
  await pile.update({ [potPath]: pot });
  if (pile.cards.get(cardId)) await pile.deleteEmbeddedDocuments("Card", [cardId]);
}

/** Set who rolls. Stored only. Judge-only. */
export const setMode = (pile, mode) => (game.user.isGM ? pile.update({ [`${potPath}.mode`]: mode }) : null);

/** Set one deal toggle (`DEAL_TOGGLE`) on a staged pot. Stored only; opening applies it. Judge-only. */
export async function setDealToggle(pile, key, on) {
  const pot = setToggle(potOf(pile), key, on);
  if (!game.user.isGM || !pot) return null;
  return pile.update({ [`${potPath}.deal.toggles`]: pot.deal.toggles });
}

/* -------------------------------------------- */
/*  Opening and closing                          */
/* -------------------------------------------- */

/**
 * Open a staged pot to the table: the buckets fold into `order`, every seat
 * but the Judge's gets LIMITED sight, and the doorway card is posted.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function openPot(pile) {
  if (!game.user.isGM) return { ok: false, reason: REFUSAL.notAllowed };
  const audience = game.users.filter((u) => !u.isGM).map((u) => u.id);
  const plan = planOpen(viewOf(pile), { audience, rng: () => foundry.dice.MersenneTwister.random() });
  if (!plan.ok) return plan;
  // The cards are written before the pile opens, so no seat ever renders a band that is not final.
  const forced = new Map(plan.forced.map((f) => [f.id, f.flags]));
  const updates = Object.entries(plan.bands).map(([id, value]) => {
    const update = { _id: id, value };
    if (forced.has(id)) update[`${cardPath}.source.data.flags`] = forced.get(id);
    return update;
  });
  if (updates.length) await pile.updateEmbeddedDocuments("Card", updates);
  const gone = plan.removed.filter((id) => pile.cards.get(id));
  if (gone.length) await pile.deleteEmbeddedDocuments("Card", gone);
  const message = await postDoorway(pile);
  plan.flag.messageId = message?.id ?? null;
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const id of audience) ownership[id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
  await pile.update({ [potPath]: plan.flag, ownership });
  if (plan.audit.length) await postDealAudit(pile, plan.audit);
  return { ok: true };
}

/**
 * The Judge's audit card: a whisper to every Judge listing, for each deal
 * toggle that was on, the cards it changed by their true names. Posted only
 * when a toggle was on, and never to a player.
 */
async function postDealAudit(pile, audit) {
  const esc = foundry.utils.escapeHTML;
  const rows = audit.map((row) => {
    const what = row.names.length ? row.names.map(esc).join(", ") : esc(loc("audit.none"));
    return `<li><strong>${esc(loc(`toggle.${row.toggle}`))}</strong>: ${esc(loc(`audit.${row.toggle}`, { n: row.names.length }))} ${what}</li>`;
  });
  return ChatMessage.create({
    content: `<div class="acks-extras-treasure-record"><h3>${esc(loc("audit.title", { name: pile.name }))}</h3><ul>${rows.join("")}</ul></div>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
  });
}

/** The doorway card: a chat message carrying only the pot's uuid. */
async function postDoorway(pile) {
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/treasure/doorway.hbs`, {
    uuid: pile.uuid,
    name: pile.name,
  });
  return ChatMessage.create({ content, flags: { [MODULE_ID]: { [POT_FLAG]: { uuid: pile.uuid } } } });
}

/** One closed-pot record row, escaped: what a card was shown as and where it went. */
const recordRow = (v) => {
  const esc = foundry.utils.escapeHTML;
  const where = v.claimed ? loc("record.to", { name: v.claimedByName || "?" }) : loc("record.left");
  return `<li>${esc(poolLabel(v.poolKey))}: ${esc(v.name)} ${esc(where)}</li>`;
};

/** File one leftover card at a place, and mark it so a retry does not file it twice. */
async function fileAt(pile, place, card) {
  const { truth } = card;
  if (truth.coin) {
    const template = truth.source?.data?.type === "money" ? null : await coinTemplate({ name: truth.coin.name });
    const credits = claimCoinCredits(truth, template);
    if (credits) await creditCoin(place, credits, { ownerUuid: HOUSE_OWNER });
  } else if (truth.valueGp != null) {
    await mintCoin(place, truth.valueGp, { ownerUuid: HOUSE_OWNER });
  } else {
    const data = claimItemData(truth, disguiseData);
    if (data) await stockProvider(place, [data], { ownerUuid: HOUSE_OWNER });
  }
  await pile.cards.get(card.id)?.update({ [`${cardPath}.claimedBy`]: { placeUuid: place.uuid, placeName: place.name } });
}

/**
 * Close a pot: what is unclaimed goes to `placeUuid` (a storage provider) when
 * one is named, the doorway card is rewritten as the record of the haul, and
 * the pile is deleted by its own id with no chat notification. Judge-only.
 * @returns {Promise<{ok: boolean, reason?: string, filed?: number}>}
 */
export async function closePot(pile, { placeUuid = null } = {}) {
  if (!game.user.isGM) return { ok: false, reason: REFUSAL.notAllowed };
  const plan = planClose(viewOf(pile));
  if (!plan.ok) return plan;
  let filed = 0;
  if (placeUuid && plan.left.length) {
    const place = await fromUuid(placeUuid);
    if (!place || !isProvider(place)) return { ok: false, reason: REFUSAL.noTarget };
    for (const card of plan.left) {
      await fileAt(pile, place, card);
      filed++;
    }
  }
  const fresh = viewOf(pile);
  const views = potCards(fresh).map((c) => cardView(c, { isGM: false }));
  const haul = haulOf(views);
  const rows = views.map(recordRow);
  const message = game.messages.get(plan.flag.messageId);
  if (message) {
    const esc = foundry.utils.escapeHTML;
    await message.update({
      content: `<div class="acks-extras-treasure-record"><h3>${esc(loc("record.title", { name: pile.name }))}</h3><p>${esc(loc("record.haul", { gp: haul.totalGp }))}</p><ul>${rows.join("")}</ul></div>`,
      [`flags.${MODULE_ID}.${POT_FLAG}.uuid`]: null,
    });
  }
  await pile.delete({ chatNotification: false });
  return { ok: true, filed };
}

/* -------------------------------------------- */
/*  What a claim delivers                        */
/* -------------------------------------------- */

/**
 * Put a card's goods on an actor: an item built from the snapshot wearing its
 * mask (delivered through `deliverItems`), coin through `creditCoin`, a value
 * card as coin of that worth. Refuses an actor whose sheet lists no goods and
 * a coin nothing names.
 * @returns {Promise<{ok: boolean, name?: string, reason?: string}>}
 */
export async function deliverTruth(truth, actorUuid) {
  const actor = await fromUuid(actorUuid);
  if (!actor || actor.documentName !== "Actor") return { ok: false, reason: REFUSAL.noTarget };
  if (!listsGoods(actor)) return { ok: false, reason: REFUSAL.keepsNoGoods };
  if (truth.coin) {
    const template = truth.source?.data?.type === "money" ? null : await coinTemplate({ name: truth.coin.name });
    const credits = claimCoinCredits(truth, template);
    if (!credits) return { ok: false, reason: REFUSAL.noCoin };
    await creditCoin(actor, credits);
  } else if (truth.valueGp != null) {
    await mintCoin(actor, truth.valueGp);
  } else {
    const data = claimItemData(truth, disguiseData);
    if (!data) return { ok: false, reason: REFUSAL.failed };
    await deliverItems(actor, [data]);
  }
  return { ok: true, name: actor.name };
}

/* -------------------------------------------- */
/*  The relay                                    */
/* -------------------------------------------- */

/** The relay over the world's documents (`pot-relay.mjs` holds the rules). */
export function createPotRelay() {
  const actorOf = (uuid) => {
    try {
      const doc = fromUuidSync(uuid);
      return doc?.documentName === "Actor" ? doc : null;
    } catch {
      return null;
    }
  };
  return createRelay({
    user: (id) => game.users.get(id) ?? null,
    self: () => game.user,
    readPot: (id) => {
      const pile = findPot(id);
      return pile ? viewOf(pile) : null;
    },
    writeFlip: async (id, update) => {
      await findPot(id)?.updateEmbeddedDocuments("Card", [update]);
    },
    owns: (user, uuid) => !!actorOf(uuid)?.testUserPermission(user, "OWNER"),
    hasActor: (uuid) => !!actorOf(uuid),
    ownedByTable: (uuid) => {
      const actor = actorOf(uuid);
      return !!actor && game.users.some((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
    },
    deliver: deliverTruth,
    setClaim: async (id, cardId, claim) => {
      await findPot(id)?.cards.get(cardId)?.update({ [`${cardPath}.claimedBy`]: claim });
    },
  });
}

/** What the doorway card and the window say of the pot's progress. */
export function progressOf(pile) {
  const view = viewOf(pile);
  const { turned, count } = turnedOf(view);
  const haul = haulOf(potCards(view).map((c) => cardView(c, { isGM: false })));
  return { turned, count, haul, view };
}
