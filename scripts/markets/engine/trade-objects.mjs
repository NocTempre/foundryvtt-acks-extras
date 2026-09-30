/* global game, foundry, fromUuid, fromUuidSync, Actor, CONST, ui */
/**
 * The trade house: the one GM-designated location actor whose embedded Items
 * are every trade object a player owns, inspects or hands over (today, market
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
import { handVerdict, notesToHtml } from "../rules/reports.mjs";

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
 * @returns {{id: string, uuid: string, name: string, marketUuid: string, marketName: string, assessorUuid: string, partyId: string, time: number, outcome: string, beliefs: Array<{category: string, dm: number}>, notes: string, ownerUuid: string|null, ownerName: string}}
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
    beliefs: (system.beliefs ?? []).map((b) => ({ category: b.category, dm: Number(b.dm) || 0 })),
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
 * @param {Array<{category: string, dm: number}>} data.beliefs
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
        beliefs: (data.beliefs ?? []).map((b) => ({ category: b.category, dm: Math.round(Number(b.dm) || 0) })),
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

/* ------------------------------ migration ------------------------------ */

const plain = (row) => row?.toObject?.() ?? foundry.utils.deepClone(row);

/**
 * GM: move the per-party demand beliefs the markets used to keep on each
 * location (`system.market.goods.dmKnowledge`) into report Items. One report
 * per market and party, outcome `migrated`, stamped to the house itself, and
 * the rows cleared afterwards. Idempotent: a market and party that already
 * hold a migrated report are cleared without a second one, and a market with
 * no rows is not touched. Creates the house only when there is something to move.
 * @returns {Promise<{markets: number, reports: number}>}
 */
export async function migrateDmKnowledge() {
  const result = { markets: 0, reports: 0 };
  if (!game.user?.isGM) return result;
  const sources = game.actors.filter((a) => a.type === LOCATION_TYPE && (a.system?.market?.goods?.dmKnowledge?.length ?? 0) > 0);
  if (!sources.length) return result;
  const house = await tradeHouse({ create: true });
  if (!house) return result;
  for (const location of sources) {
    const rows = location.system.market.goods.dmKnowledge.map(plain);
    const byParty = new Map();
    for (const row of rows) {
      if (!row.category) continue;
      if (!byParty.has(row.partyId)) byParty.set(row.partyId, []);
      byParty.get(row.partyId).push(row);
    }
    for (const [partyId, held] of byParty) {
      const written = objectsAt(location.uuid).some((i) => i.system.outcome === "migrated" && i.system.partyId === partyId);
      if (written) continue;
      const made = await writeReport({
        ownerUuid: HOUSE_OWNER,
        marketUuid: location.uuid,
        marketName: location.name,
        assessorUuid: "",
        partyId,
        time: Math.max(...held.map((r) => Number(r.time) || 0)),
        outcome: "migrated",
        beliefs: held.map((r) => ({ category: r.category, dm: r.believed })),
      });
      if (made.error) throw new Error(`markets | migrating ${location.name}: ${made.error}`);
      result.reports += 1;
    }
    await location.update({ "system.market.goods.dmKnowledge": [] });
    result.markets += 1;
  }
  if (typeof ui !== "undefined") ui.notifications?.info(game.i18n.format(`${LANG}.report.migrated`, result));
  return result;
}
