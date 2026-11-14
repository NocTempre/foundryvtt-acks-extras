/* global game, foundry, fromUuid, fromUuidSync, Actor, CONST, ChatMessage */
/**
 * The trade house: the one GM-designated location actor whose embedded Items
 * are every trade object a player owns, inspects or hands over (market
 * reports). The house is a storage provider (`lib/storage`); each object is
 * stamped with its owner through the storage flag, and the readers here
 * filter the house's items by that stamp or by the market they are about.
 *
 * Players hold OBSERVER on the house and cannot write it. Every write is the
 * GM's: a player's action reaches it through the GM socket relay, and the
 * GM-side function re-checks who asked (`handVerdict`) — the stamp is a UI
 * convention, so the check is the only thing keeping a seat to its own goods.
 * Nothing secret goes in an object: a report holds only what its owner
 * believes. See docs/markets/MODEL.md, "Market reports".
 */
import { MODULE_ID, LANG, REPORT_TYPE, TRADE_HOUSE_SETTING } from "../constants.mjs";
import { LOCATION_TYPE } from "../../location/constants.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";
import { STORAGE_KEY, setProvider, storedItems, ownerOf, resolveActorSync } from "../../lib/storage.mjs";
import { HOUSE_OWNER } from "../../lib/money.mjs";
import { registerHandler, executeAsGM } from "../../lib/sockets.mjs";
import { gmIds, numOrNull } from "../../lib/util.mjs";
import { handVerdict, notesToHtml, chooseVerdict, isAwaiting, dmLabel, storedDm } from "../rules/reports.mjs";
import { trueDemand } from "../rules/demand.mjs";
import { merchandiseCatalog, merchandiseFor } from "./merchandise.mjs";

const err = (error, data = {}) => ({ error, ...data });

/** The icon a report item carries. */
const REPORT_ICON = "icons/svg/book.svg";

const setting = () => {
  try {
    return String(game.settings.get(MODULE_ID, TRADE_HOUSE_SETTING) ?? "");
  } catch {
    return "";
  }
};

/**
 * The trade house actor, read without awaiting (render paths cannot), or null
 * when none has been designated or the designated actor is gone.
 * @returns {Actor|null}
 */
export function tradeHouseSync() {
  const uuid = setting();
  if (!uuid) return null;
  try {
    const doc = fromUuidSync(uuid);
    return doc?.documentName === "Actor" ? doc : null;
  } catch {
    return null;
  }
}

/**
 * The trade house actor. With `create` set and a GM calling, a missing house is
 * made: a location actor named from the lang file, storage turned on, default
 * ownership OBSERVER, its uuid stored in the world setting.
 * @param {object} [options]
 * @param {boolean} [options.create=false]
 * @returns {Promise<Actor|null>}
 */
export async function tradeHouse({ create = false } = {}) {
  const existing = tradeHouseSync();
  if (existing || !create || !game.user?.isGM) return existing;
  const actor = await Actor.create({
    name: game.i18n.localize(`${LANG}.tradeHouse.name`),
    type: LOCATION_TYPE,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
  });
  if (!actor) return null;
  await setProvider(actor, true);
  await game.settings.set(MODULE_ID, TRADE_HOUSE_SETTING, actor.uuid);
  return actor;
}

/* ------------------------------ reading ------------------------------ */

const ofType = (type) => (item) => !type || item.type === type;

/**
 * The house's items stamped to one owner.
 * @param {string} ownerUuid
 * @param {object} [options]
 * @param {string} [options.type=REPORT_TYPE]  Item sub-type; null for every type.
 * @returns {Item[]}
 */
export function objectsOf(ownerUuid, { type = REPORT_TYPE } = {}) {
  const house = tradeHouseSync();
  return house && ownerUuid ? storedItems(house, { ownerUuid }).filter(ofType(type)) : [];
}

/**
 * The house's items about one market, whoever owns them.
 * @param {string} marketUuid
 * @param {object} [options]
 * @param {string} [options.type=REPORT_TYPE]  Item sub-type; null for every type.
 * @returns {Item[]}
 */
export function objectsAt(marketUuid, { type = REPORT_TYPE } = {}) {
  const house = tradeHouseSync();
  return house && marketUuid ? storedItems(house).filter(ofType(type)).filter((i) => i.system?.marketUuid === marketUuid) : [];
}

/** Every report on the house. */
export function allReports() {
  const house = tradeHouseSync();
  return house ? storedItems(house).filter(ofType(REPORT_TYPE)) : [];
}

/**
 * A report item as the plain record the pure rules read.
 * @param {Item} item
 * @returns {{id: string, uuid: string, name: string, marketUuid: string, marketName: string, assessorUuid: string, partyId: string, time: number, outcome: string, beliefs: Array<{category: string, dm: number|null}>, picks: number, notes: string, ownerUuid: string|null, ownerName: string}} a null `dm` is a good awaiting the Judge
 */
export function plainReport(item) {
  const system = item.system ?? {};
  const owner = ownerOf(item);
  return {
    id: item.id,
    uuid: item.uuid,
    name: item.name,
    marketUuid: system.marketUuid ?? "",
    marketName: system.marketName ?? "",
    assessorUuid: system.assessorUuid ?? "",
    partyId: system.partyId ?? "",
    time: Number(system.time) || 0,
    outcome: system.outcome ?? "",
    beliefs: (system.beliefs ?? []).map((b) => ({ category: b.category, dm: numOrNull(b.dm) })),
    picks: Math.max(0, Number(system.picks) || 0),
    notes: system.notes ?? "",
    ownerUuid: owner?.uuid ?? null,
    ownerName: owner?.name ?? "",
  };
}

/* ------------------------------ writing ------------------------------ */

/** Does the user own the actor this object is stamped to? */
function ownsStamp(item, user) {
  const stamp = ownerOf(item);
  const actor = stamp?.uuid ? resolveActorSync(stamp.uuid) : null;
  return !!(user && actor && (user.isGM || actor.testUserPermission(user, "OWNER")));
}

/** The user a GM-side write acts for: the relayed sender, else this client's user. */
const actingUser = (requestUserId) => (requestUserId ? game.users.get(requestUserId) : game.user);

/** An object is only handled while it is on the house and one of ours. */
const housed = (item) => !!item && item.parent?.id === tradeHouseSync()?.id && item.type === REPORT_TYPE;

/**
 * Create a report on the house, stamped to its owner. GM only: the house is
 * not writable by a player.
 * @param {object} data
 * @param {string} data.ownerUuid      The actor the report is stamped to (`HOUSE_OWNER` for the house's own).
 * @param {string} data.marketUuid
 * @param {string} data.marketName
 * @param {string} data.assessorUuid
 * @param {string} data.partyId
 * @param {number} data.time
 * @param {string} data.outcome
 * @param {Array<{category: string, dm: number|null}>} data.beliefs  A null `dm` stays null: that good awaits the Judge.
 * @param {number} [data.picks]  Goods the owner may still choose to learn.
 * @returns {Promise<{ok: true, item: Item}|{error: string}>}
 */
export async function writeReport(data) {
  if (!game.user?.isGM) return err("gmOnly");
  const house = await tradeHouse({ create: true });
  if (!house) return err("noHouse");
  const ownerName = data.ownerUuid === HOUSE_OWNER ? house.name : (resolveActorSync(data.ownerUuid)?.name ?? "");
  const [item] = await house.createEmbeddedDocuments("Item", [
    {
      name: game.i18n.format(`${LANG}.report.itemName`, { market: data.marketName || game.i18n.localize(`${LANG}.report.noMarket`) }),
      type: REPORT_TYPE,
      img: REPORT_ICON,
      system: {
        marketUuid: data.marketUuid ?? "",
        marketName: data.marketName ?? "",
        assessorUuid: data.assessorUuid ?? "",
        partyId: data.partyId ?? "",
        time: Math.round(Number(data.time) || 0),
        outcome: data.outcome,
        beliefs: (data.beliefs ?? []).map((b) => ({ category: b.category, dm: storedDm(b.dm) })),
        picks: Math.max(0, Math.floor(Number(data.picks) || 0)),
      },
      flags: { [MODULE_ID]: { [STORAGE_KEY]: { ownerUuid: data.ownerUuid, ownerName } } },
    },
  ]);
  // An empty result is the data model refusing the row, never a missing house.
  return item ? { ok: true, item } : err("notWritten");
}

/**
 * Hand a report to another character: the stamp moves, nothing else does.
 * Runs GM-side; a relayed call passes the seat that asked, and only a GM or
 * the owner of the stamped actor is served.
 * @param {Item} item
 * @param {Actor} toActor  A character.
 * @param {object} [options]
 * @param {string|null} [options.requestUserId]  The attested sender of a relayed call.
 * @returns {Promise<{ok: true}|{error: string}>}
 */
export async function give(item, toActor, { requestUserId = null } = {}) {
  if (!housed(item)) return err("notFound");
  const user = actingUser(requestUserId);
  const verdict = handVerdict({
    isGM: !!user?.isGM,
    ownsStamp: ownsStamp(item, user),
    stampUuid: ownerOf(item)?.uuid ?? null,
    targetUuid: toActor?.uuid ?? null,
    targetIsCharacter: toActor?.type === ACTOR_TYPE.character,
  });
  if (verdict.error) return verdict;
  await item.update({
    [`flags.${MODULE_ID}.${STORAGE_KEY}.ownerUuid`]: toActor.uuid,
    [`flags.${MODULE_ID}.${STORAGE_KEY}.ownerName`]: toActor.name,
  });
  return { ok: true };
}

/**
 * Delete a report. Same authority as `give`.
 * @param {Item} item
 * @param {object} [options]
 * @param {string|null} [options.requestUserId]
 * @returns {Promise<{ok: true}|{error: string}>}
 */
export async function retire(item, { requestUserId = null } = {}) {
  if (!housed(item)) return err("notFound");
  const user = actingUser(requestUserId);
  const verdict = handVerdict({ isGM: !!user?.isGM, ownsStamp: ownsStamp(item, user) });
  if (verdict.error) return verdict;
  await item.delete();
  return { ok: true };
}

/**
 * Replace a report's notes with what the owner typed. The text is escaped:
 * nothing a player types reaches the document as markup. Same authority as `give`.
 * @param {Item} item
 * @param {string} text
 * @param {object} [options]
 * @param {string|null} [options.requestUserId]
 * @returns {Promise<{ok: true}|{error: string}>}
 */
export async function saveNotes(item, text, { requestUserId = null } = {}) {
  if (!housed(item)) return err("notFound");
  const user = actingUser(requestUserId);
  const verdict = handVerdict({ isGM: !!user?.isGM, ownsStamp: ownsStamp(item, user) });
  if (verdict.error) return verdict;
  await item.update({ "system.notes": notesToHtml(text) });
  return { ok: true };
}

/** The goods record of the market a report is about, or null when the market is gone. */
async function marketGoods(marketUuid) {
  const doc = marketUuid ? await fromUuid(marketUuid).catch(() => null) : null;
  return (doc?.actor ?? doc)?.system?.market?.goods ?? null;
}

/**
 * Whisper the Judges one card about a choice a player made: who chose, which
 * goods, the stored outcome, each good's market figure, and a link to the
 * report whose sheet takes the answer.
 */
async function postAwaitingCard(item, report, categories, goods, user) {
  const escape = foundry.utils.escapeHTML;
  const trader = report.ownerName || user?.name || "";
  const head = game.i18n.format(`${LANG}.report.awaitingCard`, {
    trader: escape(trader),
    n: categories.length,
    outcome: game.i18n.localize(`${LANG}.report.outcome.${report.outcome}`),
    report: `@UUID[${item.uuid}]{${escape(item.name)}}`,
  });
  const lines = categories.map((category) =>
    game.i18n.format(`${LANG}.report.awaitingCardLine`, {
      good: escape(merchandiseFor(category)?.label ?? category),
      demand: dmLabel(trueDemand(goods, category)),
    })
  );
  const content = `<div class="acks-extras-markets-receipt"><p>${head}</p><ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul></div>`;
  try {
    await ChatMessage.create({ content, whisper: gmIds() });
  } catch (error) {
    console.warn(`${MODULE_ID} | the report's awaiting card could not be posted`, error);
  }
}

/**
 * The owner chooses goods to learn from the picks a partial assessment left
 * (`chooseVerdict`). Every chosen good is written awaiting the Judge (a null
 * modifier), whatever the stored outcome, so the two outcomes store the same
 * thing; the Judge fills it in on the report's sheet (`answerFromMarket`, or
 * by typing a figure). A relayed call also whispers the Judges one card. The
 * seat that asked sends only the keys. Same authority as `give`.
 * @param {Item} item
 * @param {string[]} categories  Catalogue keys.
 * @param {object} [options]
 * @param {string|null} [options.requestUserId]
 * @returns {Promise<{ok: true, chosen: number, left: number}|{error: string}>}
 */
export async function chooseGoods(item, categories, { requestUserId = null } = {}) {
  if (!housed(item)) return err("notFound");
  const user = actingUser(requestUserId);
  const verdict = handVerdict({ isGM: !!user?.isGM, ownsStamp: ownsStamp(item, user) });
  if (verdict.error) return verdict;
  const report = plainReport(item);
  const choice = chooseVerdict({
    picks: report.picks,
    chosen: Array.isArray(categories) ? categories.map(String) : [],
    believed: report.beliefs.map((b) => b.category),
    catalog: merchandiseCatalog().map((m) => m.key),
  });
  if (choice.error) return choice;
  const goods = await marketGoods(report.marketUuid);
  if (!goods) return err("noMarket");
  const beliefs = [...report.beliefs, ...choice.categories.map((category) => ({ category, dm: null }))];
  const left = report.picks - choice.categories.length;
  await item.update({ "system.beliefs": beliefs, "system.picks": left });
  if (requestUserId) await postAwaitingCard(item, report, choice.categories, goods, user);
  return { ok: true, chosen: choice.categories.length, left };
}

/**
 * Fill every good still awaiting the Judge with the market's demand now. GM
 * only, and refused on a false report: its figures are the Judge's to type,
 * since nothing printed gives a false assessment a number.
 * @param {Item} item
 * @returns {Promise<{ok: true, answered: number}|{error: string}>}
 */
export async function answerFromMarket(item) {
  if (!game.user?.isGM) return err("gmOnly");
  if (!housed(item)) return err("notFound");
  const report = plainReport(item);
  if (report.outcome === "false") return err("falseReport");
  if (!report.beliefs.some(isAwaiting)) return err("nonePending");
  const goods = await marketGoods(report.marketUuid);
  if (!goods) return err("noMarket");
  let answered = 0;
  const beliefs = report.beliefs.map((b) => {
    if (!isAwaiting(b)) return b;
    answered++;
    return { category: b.category, dm: storedDm(trueDemand(goods, b.category)) };
  });
  await item.update({ "system.beliefs": beliefs });
  return { ok: true, answered };
}

/* ------------------------------ relays ------------------------------ */

registerHandler("marketsReportGive", async ({ itemUuid, toUuid, requestUserId }) => {
  const item = await fromUuid(itemUuid).catch(() => null);
  const target = await fromUuid(toUuid).catch(() => null);
  return give(item, target?.actor ?? target, { requestUserId });
});

registerHandler("marketsReportRetire", async ({ itemUuid, requestUserId }) => {
  const item = await fromUuid(itemUuid).catch(() => null);
  return retire(item, { requestUserId });
});

registerHandler("marketsReportNotes", async ({ itemUuid, text, requestUserId }) => {
  const item = await fromUuid(itemUuid).catch(() => null);
  return saveNotes(item, String(text ?? ""), { requestUserId });
});

/** Hand a report over: directly from a GM seat, else through the GM relay. */
export async function performGive(item, toActor) {
  if (game.user.isGM) return give(item, toActor);
  return executeAsGM("marketsReportGive", { itemUuid: item.uuid, toUuid: toActor.uuid });
}

/** Discard a report: directly from a GM seat, else through the GM relay. */
export async function performRetire(item) {
  if (game.user.isGM) return retire(item);
  return executeAsGM("marketsReportRetire", { itemUuid: item.uuid });
}

/** Save a report's notes: directly from a GM seat, else through the GM relay. */
export async function performNotes(item, text) {
  if (game.user.isGM) return saveNotes(item, text);
  return executeAsGM("marketsReportNotes", { itemUuid: item.uuid, text });
}

registerHandler("marketsReportChoose", async ({ itemUuid, categories, requestUserId }) => {
  const item = await fromUuid(itemUuid).catch(() => null);
  return chooseGoods(item, categories, { requestUserId });
});

/** Choose goods to learn on a report: directly from a GM seat, else through the GM relay. */
export async function performChoose(item, categories) {
  if (game.user.isGM) return chooseGoods(item, categories);
  return executeAsGM("marketsReportChoose", { itemUuid: item.uuid, categories });
}
