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
 * id, with no chat notification; a seat the Judge has made OWNER of the pile
 * closes it through the relay.
 */
import { ITEM_FLAGS } from "../equipment/constants.mjs";
import { disguiseData } from "../equipment/disguise-logic.mjs";
import { makeLoc } from "../lib/util.mjs";
import { executeAsGM } from "../lib/sockets.mjs";
import { listsGoods, deliverItems, droppedGoods } from "../lib/bundles.mjs";
import { HOUSE_OWNER, coinTemplate, creditCoin, mintCoin, mintedWeights6 } from "../lib/money.mjs";
import { isProvider, stockProvider } from "../lib/storage.mjs";
import { magicKnowledge, physicalItems } from "../lib/item-model.mjs";
import { capacity6, load6 } from "../lib/capacity.mjs";
import * as services from "../lib/services.mjs";
import { ARMS_LAST_FLAG, CARD_FLAG, LANG, MODULE_ID, PHASE, POOL, POT_FLAG, POT_HANDLER, POT_SHEET_KEY, REFUSAL } from "./constants.mjs";
import {
  buildCard, claimCoinCredits, claimItemData, flipUpdate, goodsWeights6, haulOf, normalizePot, normalizeTruth, planClose, planFound, planOpen, seatCards, addHand, addMonster, removeRow, setDealChoice, setMetInLair, setMonsters, stepRow, setToggle,
  stage, turnedOf, unstage, cardView,
} from "./pot-logic.mjs";
import { mayStartGrab, ownsAnyMember, resolveParty, splitCoin } from "./grab-pot.mjs";
import { createRelay } from "./pot-relay.mjs";

const loc = makeLoc(LANG);
const gpText = (gp) => (Math.round(gp * 100) / 100).toLocaleString(game.i18n.lang);

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
 * `deal` is the staged deal state the pot is created with (the monster rows a
 * sheet or the selected tokens open it with), written in the create itself. A
 * pot whose `deal` names no arms column opens with the one this Judge last chose
 * on any pot (`setDealOption`), blank where none was.
 * @param {{name?: string, render?: boolean, deal?: object}} [opts]
 * @returns {Promise<Cards|null>}
 */
export async function newPot({ name = "", render = true, deal = undefined } = {}) {
  if (!game.user.isGM) {
    ui.notifications?.warn(loc("refuse.judgeOnly"));
    return null;
  }
  const pile = await foundry.documents.Cards.implementation.create({
    name: name || loc("pot.defaultName"),
    type: "pile",
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { core: { sheetClass: POT_SHEET_KEY }, [MODULE_ID]: { [POT_FLAG]: normalizePot({ deal: { armsSetting: game.user.getFlag?.(MODULE_ID, ARMS_LAST_FLAG) ?? "", ...deal } }) } },
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
  const goods = droppedGoods(item);
  const weights = goodsWeights6(goods);
  return goods.map((data, i) => {
    const live = i === 0 ? item : null;
    const disguise = data.flags?.[MODULE_ID]?.[ITEM_FLAGS.DISGUISE];
    const known = live ? magicKnowledge(live, { isGM: false }) : { magical: false, detected: true, identified: "none" };
    const base = { source: { uuid: item.uuid, data }, weight6: weights[i] };
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

/**
 * Set who rolls. Judge-only. Opening reads it (`deal-logic.mjs` `planTableOpen`),
 * and a change withdraws an offer the pot stands under, since the offer is
 * Table mode's.
 */
export const setMode = (pile, mode) =>
  game.user.isGM ? pile.update({ [`${potPath}.mode`]: mode, [`${potPath}.offered`]: false, [`${potPath}.offeredLair`]: false }) : null;

/** Record the key of the deal list a deal just rolled (`deal-logic.mjs` `dealKey`). Judge-only. */
export const markDealt = (pile, key) => (game.user.isGM ? pile.update({ [`${potPath}.dealt`]: key }) : null);

/** Set one deal toggle (`DEAL_TOGGLE`) on a staged pot. Stored only; opening applies it. Judge-only. */
export async function setDealToggle(pile, key, on) {
  const pot = setToggle(potOf(pile), key, on);
  if (!game.user.isGM || !pot) return null;
  return pile.update({ [`${potPath}.deal.toggles`]: pot.deal.toggles });
}

/** Set the Judge's "Met in their lair" state on a staged pot. Stored only; the lair warning reads it. Judge-only. */
export async function setDealMetInLair(pile, on) {
  const pot = setMetInLair(potOf(pile), on);
  if (!game.user.isGM || !pot) return null;
  return pile.update({ [`${potPath}.deal.metInLair`]: pot.deal.metInLair });
}

/** Replace the staged pot's monster rows. Stored only. Judge-only. */
export async function setDealMonsters(pile, rows) {
  const pot = setMonsters(potOf(pile), rows);
  if (!game.user.isGM || !pot) return null;
  return pile.update({ [`${potPath}.deal.monsters`]: pot.deal.monsters });
}

/** Add a monster to the staged pot's deal list, or raise the hoards of the row already standing for it. Stored only. Judge-only. */
export async function addDealMonster(pile, row) {
  const pot = addMonster(potOf(pile), row);
  if (!game.user.isGM || !pot) return null;
  return pile.update({ [`${potPath}.deal.monsters`]: pot.deal.monsters });
}

/** Add one hoard of a by-hand treasure type to the staged pot's deal list. Stored only. Judge-only. */
export async function addDealHand(pile, letter) {
  const pot = addHand(potOf(pile), letter);
  if (!game.user.isGM || !pot) return null;
  return pile.update({ [`${potPath}.deal.hand`]: pot.deal.hand });
}

/** Move one deal-list row's hoards by `delta` (`list` is `DEAL_LIST`'s `monsters` or `hand`; a step down from one removes the row). Stored only. Judge-only. */
export async function stepDealRow(pile, list, index, delta) {
  const pot = stepRow(potOf(pile), list, index, delta);
  if (!game.user.isGM || !pot) return null;
  return pile.update({ [`${potPath}.deal.${list}`]: pot.deal[list] });
}

/** Remove one deal-list row (`list` as in `stepDealRow`). Stored only. Judge-only. */
export async function removeDealRow(pile, list, index) {
  const pot = removeRow(potOf(pile), list, index);
  if (!game.user.isGM || !pot) return null;
  return pile.update({ [`${potPath}.deal.${list}`]: pot.deal[list] });
}

/**
 * Set one deal choice (`style`, `special` or the `armsSetting` column) on a staged pot. Stored only. Judge-only. A column is
 * also kept on the Judge's user, as the default the next new pot opens with.
 */
export async function setDealOption(pile, key, value) {
  const pot = setDealChoice(potOf(pile), key, value);
  if (!game.user.isGM || !pot) return null;
  const written = await pile.update({ [`${potPath}.deal.${key}`]: pot.deal[key] });
  if (key === "armsSetting") await game.user.setFlag(MODULE_ID, ARMS_LAST_FLAG, pot.deal.armsSetting);
  return written;
}

/* -------------------------------------------- */
/*  Opening and closing                          */
/* -------------------------------------------- */

/**
 * Open a staged pot to the table: the buckets fold into `order`, every seat
 * but the Judge's gets LIMITED sight, and the doorway card is posted unless
 * `doorway` is false (a scene's pot is reached from its own tray, and a pot
 * whose lots are not yet found has nothing to announce). A pot offered to the
 * table already carries its doorway, which opening keeps rather than posting a
 * second.
 * @param {Cards} pile
 * @param {{doorway?: boolean}} [opts]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function openPot(pile, { doorway = true } = {}) {
  if (!game.user.isGM) return { ok: false, reason: REFUSAL.notAllowed };
  const audience = audienceIds();
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
  const prior = potOf(pile).messageId;
  const message = doorway ? await doorwayOf(pile) : null;
  plan.flag.messageId = message?.id ?? prior ?? null;
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const id of audience) ownership[id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
  await pile.update({ [potPath]: plan.flag, ownership });
  if (plan.audit.length) await postDealAudit(pile, plan.audit);
  if (plan.warning) ui.notifications?.warn(loc("audit.warnShort", { seeds: plan.warning.seeds.join(", "), worth: gpText(plan.warning.worthGp) }));
  return { ok: true };
}

/** The seats a pot is opened or offered to: every user who is not a Judge. */
const audienceIds = () => game.users.filter((u) => !u.isGM).map((u) => u.id);

/**
 * Offer a staged pot to the table (Table mode, a list to deal): the pot stays
 * in staging and unrolled, its audience gets LIMITED sight as opening gives it,
 * and the doorway card is posted once. `lair` records that the Judge confirmed
 * the lair warning, which the seat's deal carries. Judge-only.
 * @param {Cards} pile
 * @param {{lair?: boolean}} [opts]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function offerPot(pile, { lair = false } = {}) {
  if (!game.user.isGM) return { ok: false, reason: REFUSAL.notAllowed };
  if (potOf(pile).phase !== PHASE.staging) return { ok: false, reason: REFUSAL.phase };
  const message = await doorwayOf(pile);
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const id of audienceIds()) ownership[id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
  await pile.update({ [`${potPath}.offered`]: true, [`${potPath}.offeredLair`]: lair === true, [`${potPath}.messageId`]: message?.id ?? null, ownership });
  return { ok: true };
}

/**
 * The pot's one line in chat when the table deals it: who dealt, how many
 * hoards, into which pot, spoken as the seat that pressed (a Judge's client may
 * author a message for another user). Counts only; no letter and no card.
 */
export async function postTableLine(pile, user, hoards) {
  const esc = foundry.utils.escapeHTML;
  const name = user.character?.name || user.name;
  return ChatMessage.create({
    author: user.id,
    speaker: { alias: name },
    content: `<p>${esc(loc(hoards === 1 ? "table.dealtOne" : "table.dealt", { name, n: hoards, pot: pile.name }))}</p>`,
  });
}

/**
 * The pot's doorway message: the one it already carries while that message
 * stands, else a new one. A pot offered and then opened has one doorway.
 */
async function doorwayOf(pile) {
  const prior = potOf(pile).messageId;
  return (prior && game.messages?.get(prior)) || postDoorway(pile);
}

/**
 * The Judge's audit card: a whisper to every Judge listing, for each deal
 * toggle that was on, the cards it changed by their true names. Posted only
 * when a toggle was on, and never to a player.
 */
async function postDealAudit(pile, audit) {
  const esc = foundry.utils.escapeHTML;
  const rows = audit.map((row) => {
    if (row.lines) {
      const lines = row.lines.map((l) => {
        if (l.shortGp !== null) return esc(loc("audit.replaceShort", { seed: l.seed, short: gpText(l.shortGp) }));
        if (!l.lots.length) return esc(loc("audit.replaceNone", { seed: l.seed }));
        return esc(loc("audit.replaceTook", { seed: l.seed, lots: l.lots.join(", "), over: gpText(l.overGp) }));
      });
      return `<li><strong>${esc(loc("toggle.replace"))}</strong>: ${lines.join("; ")}</li>`;
    }
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

/** Ask the Judge's client, through the pot relay, to close a pot for this seat. */
const requestClose = (pile, placeUuid) => executeAsGM(POT_HANDLER, { potId: pile.id, op: "close", placeUuid });

/**
 * Close a pot: what is unclaimed goes to `placeUuid` (a storage provider) when
 * one is named, the doorway card is rewritten as the record of the haul, and
 * the pile is deleted by its own id with no chat notification. The writes run
 * on a Judge's client; any other seat's call is forwarded to the relay, which
 * admits the pile's owner and, for a named place, that place's owner. The
 * forward answers nothing when no Judge is connected.
 * @returns {Promise<{ok: boolean, reason?: string, filed?: number}|undefined>}
 */
export async function closePot(pile, { placeUuid = null } = {}) {
  if (!game.user.isGM) return requestClose(pile, placeUuid);
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
  const views = seatCards(fresh).map((c) => cardView(c, { isGM: false }));
  const haul = haulOf(views);
  const rows = views.map(recordRow);
  const message = plan.flag.messageId ? game.messages.get(plan.flag.messageId) : null;
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
/*  The party                                    */
/* -------------------------------------------- */

const roster = () => services.get("party-roster");

/** The id of the party a pot answers to (`resolveParty`), or null with no roster or no party. */
export const potPartyId = (pile) => resolveParty(potOf(pile), roster()?.list?.() ?? []);

/**
 * The pot's party as the planner and the window read it, from the roster
 * contract alone: each member's actor uuid and figures, and `paceWith`, the
 * rank a member would pace at bearing `adding6` more. A member whose document
 * is missing or whose sheet lists no goods has no uuid and no figures, so it
 * is shown and takes nothing. A member at or below zero hit points is a
 * casualty (the contract carries no casualty flag).
 * @returns {{partyId: string, members: object[], paceWith: (id: string, adding6?: number) => number|null}|null}
 */
export function partyFigures(pile) {
  const party = roster();
  const partyId = potPartyId(pile);
  if (!party || !partyId) return null;
  const members = (party.members(partyId) ?? []).map((row) => {
    const doc = row.document ?? null;
    const carries = !!doc && listsGoods(doc);
    const hp = row.hp?.value;
    return {
      id: row.actorId,
      uuid: carries ? doc.uuid : null,
      name: row.name,
      capacity6: carries ? capacity6(doc) : null,
      load6: carries ? load6(doc) : null,
      casualty: typeof hp === "number" && hp <= 0,
      hasDocument: carries,
      items: carries ? physicalItems(doc).length : null,
    };
  });
  return { partyId, members, paceWith: (id, adding6 = 0) => party.pace?.(partyId, id, { adding6 })?.rank ?? null };
}

/**
 * Move `count` coins of a coin card onto a new turned card placed after it,
 * and leave the rest on the original. The new card exists before the original
 * is reduced, so a failure part-way strands no coin: the worst it leaves is a
 * card outside `order`, which nothing shows or acts on.
 * @returns {Promise<string|null>} the new card's id, or null where it did not split
 */
async function splitCard(pile, cardId, count) {
  const card = pile?.cards.get(cardId);
  if (!card) return null;
  const split = splitCoin(normalizeTruth(card.flags?.[MODULE_ID]?.[CARD_FLAG]), count, { text: (n) => n.toLocaleString(game.i18n.lang) });
  if (!split) return null;
  const { faces, face } = flipUpdate(cardId, split.taken);
  const [made] = await pile.createEmbeddedDocuments("Card", [{ ...buildCard(split.taken, { band: card.value, poolLabel }), faces, face }]);
  if (!made) return null;
  await card.update({ [cardPath]: split.rest });
  const order = [...potOf(pile).order];
  order.splice(order.indexOf(cardId) + 1, 0, made.id);
  await pile.update({ [`${potPath}.order`]: order });
  return made.id;
}

/* -------------------------------------------- */
/*  The relay                                    */
/* -------------------------------------------- */

/** The world's actor a uuid names, or null. */
const actorOf = (uuid) => {
  try {
    const doc = fromUuidSync(uuid);
    return doc?.documentName === "Actor" ? doc : null;
  } catch {
    return null;
  }
};

/**
 * Whether the user may start a Quick grab on the pot, read the way the relay
 * reads it (`mayStartGrab`), so the window offers the button to exactly the
 * seats the relay will answer.
 */
export function mayGrab(pile, user) {
  const figures = partyFigures(pile);
  const ownsMember = ownsAnyMember(figures?.members, (uuid) => !!actorOf(uuid)?.testUserPermission(user, "OWNER"));
  return mayStartGrab({ sender: user, ownsMember, seated: !!pile.testUserPermission(user, "LIMITED") });
}

/**
 * The relay over the world's documents (`pot-relay.mjs` holds the rules).
 * `dealOffered(pile, sender, how)` is the Judge's client's deal of an offered
 * pot, supplied by the feature's module since dealing is `deal.mjs`'s.
 */
export function createPotRelay({ dealOffered } = {}) {
  return createRelay({
    dealOffered: dealOffered ? (id, sender, how) => dealOffered(findPot(id), sender, how) : undefined,
    user: (id) => game.users.get(id) ?? null,
    self: () => game.user,
    readPot: (id) => {
      const pile = findPot(id);
      return pile ? viewOf(pile) : null;
    },
    writeFlip: async (id, update) => {
      await findPot(id)?.updateEmbeddedDocuments("Card", [update]);
    },
    seated: (id, user) => !!findPot(id)?.testUserPermission(user, "LIMITED"),
    ownsPot: (id, user) => !!findPot(id)?.testUserPermission(user, "OWNER"),
    closePot: (id, placeUuid) => closePot(findPot(id), { placeUuid }),
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
    party: (id) => {
      const pile = findPot(id);
      return pile ? partyFigures(pile) : null;
    },
    splitCard: (id, cardId, count) => splitCard(findPot(id), cardId, count),
    valueWeights6: mintedWeights6,
    setGrab: async (id, grab) => {
      await findPot(id)?.update({ [`${potPath}.grab`]: grab });
    },
  });
}

/** What the doorway card and the window say of the pot's progress. */
export function progressOf(pile) {
  const view = viewOf(pile);
  const { turned, count } = turnedOf(view);
  const haul = haulOf(seatCards(view).map((c) => cardView(c, { isGM: false })));
  return { turned, count, haul, view };
}

/**
 * Mark the lots carrying these keys found on a pot (`planFound`), in one write
 * of the cards' own flags. Judge-only: a scene's check runs on a Judge's client.
 * @param {Cards} pile
 * @param {string[]} keys lot keys
 * @returns {Promise<{ok: boolean, reason?: string, ids?: string[], already?: string[], missing?: string[]}>}
 */
export async function markLotsFound(pile, keys) {
  if (!game.user.isGM) return { ok: false, reason: REFUSAL.notAllowed };
  const plan = planFound(viewOf(pile), keys);
  if (!plan.ok) return plan;
  if (plan.ids.length) await pile.updateEmbeddedDocuments("Card", plan.ids.map((id) => ({ _id: id, [`${cardPath}.found`]: true })));
  return { ok: true, ids: plan.ids, already: plan.already, missing: plan.missing };
}
