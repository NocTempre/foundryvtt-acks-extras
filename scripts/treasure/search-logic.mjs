/**
 * "Search the fallen" on plain data, Foundry-free: which combatants of a fight
 * that ended count as fallen, the record built of them, what staging that
 * record into a pot asks for, and which goods an opened pot takes off the
 * bodies (JJ ch. 4; RR, Adventures chapter, for the procedure; this file holds
 * no figure from either).
 *
 * The record is built from facts read off the combatants (`CombatantFacts`)
 * and snapshots of what they carry, so it holds after the bodies are gone. It
 * is display-level storage, not a secret: a chat flag reaches every client the
 * message reaches, and the card is whispered to the Judges.
 *
 * @typedef {object} CombatantFacts
 * @property {string} id the combatant's id
 * @property {string} name
 * @property {string|null} actorUuid uuid of the actor behind the token, null when there is none
 * @property {number|null} disposition the token's disposition, null with no token
 * @property {boolean} flagged the tracker marks the combatant defeated
 * @property {boolean} dead the creature carries the dead status
 * @property {number|null} hp hit points read through the token, null when it has none
 */
import { MODULE_ID, PHASE, POT_FLAG } from "./constants.mjs";

/** Flag key, under the module's scope, of the chat card that carries a fight's record. */
export const SEARCH_FLAG = "treasureSearch";

/** `origin.kind` of a pot staged from a fight's record. */
export const ORIGIN_KIND = "combat";

/** The options a linked table is drawn with: the Judge's client only, nothing posted to the table. */
export const DRAW_REQUEST = Object.freeze({ displayChat: false });

const text = (v) => (typeof v === "string" ? v.trim() : "");

/** Whether `disposition` is the hostile one. `hostile` is the system's constant, passed in. */
export const isHostile = (disposition, hostile) => disposition != null && hostile != null && disposition === hostile;

/**
 * Whether a combatant is defeated: the tracker marks it, it carries the dead
 * status, or its hit points read zero or below. No hit points to read is not
 * defeat.
 * @param {Pick<CombatantFacts, "flagged"|"dead"|"hp">} facts
 */
export function isDefeated({ flagged = false, dead = false, hp = null } = {}) {
  return !!flagged || !!dead || (typeof hp === "number" && Number.isFinite(hp) && hp <= 0);
}

/**
 * The combatants that count as fallen: defeated, hostile, and standing on an
 * actor. A defeated friend, a hostile still on its feet, and a combatant with
 * no token or no actor are left out.
 * @param {CombatantFacts[]} facts
 * @param {{hostile: number}} opts the system's hostile disposition
 * @returns {CombatantFacts[]}
 */
export function fallenOf(facts, { hostile }) {
  return (Array.isArray(facts) ? facts : []).filter((f) => f?.actorUuid && isDefeated(f) && isHostile(f.disposition, hostile));
}

/**
 * Whether an item is the creature's own body rather than something it carries:
 * a weapon the monster sheet marks as a natural weapon
 * (`flags["acks-extras"].naturalWeapon`), or, on a monster, a weapon that
 * states no cost, since an imported attack row carries no flag and taking it
 * off a linked actor would strip the creature's attack. Such an item never
 * becomes a card and is never taken off its owner.
 * @param {object} item
 * @param {{ownerType?: string}} [o] the owning actor's type
 */
export const isNaturalWeapon = (item, { ownerType = null } = {}) =>
  item?.type === "weapon" && (!!item.flags?.[MODULE_ID]?.naturalWeapon || (ownerType === "monster" && !(Number(item.system?.cost) > 0)));

/** The uuid inside a `@UUID[...]{label}` link string, or null. */
export function uuidOfLink(link) {
  return String(link ?? "").match(/@UUID\[([^\]]+)\]/)?.[1] ?? null;
}

/** The creature's treasure letter, or null where it carries none ("none" and blank are none). */
export function letterOf(raw) {
  const letter = text(raw);
  return letter && letter.toLowerCase() !== "none" ? letter : null;
}

/**
 * One fallen creature's entry: its goods as snapshot truths (each good
 * `{itemId, truths}`), its letter, and its linked table's uuid.
 * @param {CombatantFacts} facts
 * @param {{goods?: Array<{itemId: string, truths: object[]}>, treasure?: {type?: string, table?: string}}} read
 */
export function entryOf(facts, { goods = [], treasure = {} } = {}) {
  return {
    combatantId: facts.id,
    name: facts.name,
    actorUuid: facts.actorUuid,
    letter: letterOf(treasure.type),
    tableUuid: uuidOfLink(treasure.table),
    goods: goods.filter((g) => g?.itemId && Array.isArray(g.truths) && g.truths.length),
  };
}

/** Whether an entry holds anything a pot could be staged from. */
export const holdsAnything = (entry) => !!(entry.goods.length || entry.letter || entry.tableUuid);

/**
 * The record of a fight: its entries that hold something. Null when none does,
 * so a fight whose fallen carried nothing posts no card.
 * @returns {{combatId: string, sceneId: string|null, fallen: object[], stagedPot: null, drawnText: string[]}|null}
 */
export function recordOf({ combatId, sceneId = null, entries }) {
  const fallen = (Array.isArray(entries) ? entries : []).filter(holdsAnything);
  return fallen.length ? { combatId, sceneId, fallen, stagedPot: null, drawnText: [] } : null;
}

/** A record read back from a flag, every key present. */
export function normalizeRecord(flag) {
  const f = flag && typeof flag === "object" ? flag : {};
  return {
    combatId: typeof f.combatId === "string" ? f.combatId : "",
    sceneId: typeof f.sceneId === "string" ? f.sceneId : null,
    fallen: Array.isArray(f.fallen) ? f.fallen.filter((e) => e && typeof e === "object") : [],
    stagedPot: typeof f.stagedPot === "string" && f.stagedPot ? f.stagedPot : null,
    drawnText: Array.isArray(f.drawnText) ? f.drawnText.map(String) : [],
  };
}

/**
 * What the card shows: a row per fallen creature, with how many items it
 * carried, its letter and whether a table is linked.
 */
export function cardRows(record) {
  const r = normalizeRecord(record);
  return r.fallen.map((e) => ({
    name: String(e.name ?? ""),
    items: Array.isArray(e.goods) ? e.goods.length : 0,
    letter: letterOf(e.letter),
    hasTable: !!e.tableUuid,
  }));
}

/**
 * What staging a record into a pot asks for. Goods go in as the cards they
 * already are, each with the `{actorUuid, itemId}` of the body that carries it;
 * a linked table is drawn once per creature, quietly; a letter is listed and
 * deals nothing until the treasure tables seam (`dealLetter` in `search.mjs`)
 * is filled.
 * @returns {{goods: Array<{owner: {actorUuid: string, itemId: string}, truth: object}>, draws: Array<{name: string, tableUuid: string, request: object}>, letters: Array<{name: string, letter: string}>}}
 */
export function planStaging(record) {
  const r = normalizeRecord(record);
  const goods = [];
  const draws = [];
  const letters = [];
  for (const e of r.fallen) {
    for (const g of Array.isArray(e.goods) ? e.goods : []) {
      for (const truth of g.truths ?? []) goods.push({ owner: { actorUuid: e.actorUuid, itemId: g.itemId }, truth });
    }
    if (e.tableUuid) draws.push({ name: String(e.name ?? ""), tableUuid: e.tableUuid, request: { ...DRAW_REQUEST } });
    if (letterOf(e.letter)) letters.push({ name: String(e.name ?? ""), letter: letterOf(e.letter) });
  }
  return { goods, draws, letters };
}

/**
 * What a drawn table result becomes: an item the result points at, or a line of
 * text. Null for an empty result. A text result has no card shape that a claim
 * can deliver, so the Judge reads it instead.
 * @param {{type?: string, documentUuid?: string, name?: string, text?: string, description?: string}} result
 * @returns {{kind: "item", uuid: string, label: string}|{kind: "text", label: string}|null}
 */
export function specOfResult(result) {
  if (!result) return null;
  const label = text(result.name) || text(result.text) || text(String(result.description ?? "").replace(/<[^>]*>/g, ""));
  const uuid = text(result.documentUuid);
  if (uuid) return { kind: "item", uuid, label };
  return label ? { kind: "text", label } : null;
}

/**
 * The `origin` a staged pot carries. `carried` stays empty until the cards
 * exist and `carriedMap` fills it.
 */
export function originOf({ record, messageId = null }) {
  const r = normalizeRecord(record);
  return {
    kind: ORIGIN_KIND,
    combatId: r.combatId,
    sceneId: r.sceneId,
    messageId,
    fallen: r.fallen.map((e) => ({ name: String(e.name ?? ""), actorUuid: e.actorUuid ?? null })),
    carried: {},
    takenOff: false,
  };
}

/**
 * Which body's item each goods card stands for: card id to `{actorUuid,
 * itemId}`. The two lists run in the order the cards were made; when their
 * lengths disagree nothing is mapped, so nothing is ever taken off on a guess.
 * @param {Array<{actorUuid: string, itemId: string}>} owners
 * @param {string[]} cardIds
 */
export function carriedMap(owners, cardIds) {
  if (!Array.isArray(owners) || !Array.isArray(cardIds) || owners.length !== cardIds.length) return {};
  return Object.fromEntries(cardIds.map((id, i) => [id, { actorUuid: owners[i].actorUuid, itemId: owners[i].itemId }]));
}

/** Whether a pot update's diff turned the pot open. */
export const openedNow = (changes) => changes?.flags?.[MODULE_ID]?.[POT_FLAG]?.phase === PHASE.open;

/** Whether an origin is a fight's, still owes its take-off and has goods mapped. */
export const needsTakeOff = (origin) =>
  origin?.kind === ORIGIN_KIND && !origin.takenOff && !!origin.carried && Object.keys(origin.carried).length > 0;

/**
 * The items an opened pot takes off the bodies. Only a goods card still in the
 * pot's `order` counts (a card the Judge removed leaves its item where it is),
 * one item is taken once however many cards it made, and a body that no longer
 * exists is nothing to take from: its card stays, built from the snapshot.
 * @param {{carried: object, order: string[], exists: (actorUuid: string, itemId: string) => boolean}} args
 * @returns {{take: Array<{actorUuid: string, itemId: string}>, gone: string[]}} `gone` are the card ids whose body no longer holds the item
 */
export function planTakeOff({ carried, order, exists }) {
  const inPot = new Set(Array.isArray(order) ? order : []);
  const take = [];
  const gone = [];
  const seen = new Set();
  for (const [cardId, own] of Object.entries(carried ?? {})) {
    if (!inPot.has(cardId) || !own?.actorUuid || !own?.itemId) continue;
    if (!exists(own.actorUuid, own.itemId)) {
      gone.push(cardId);
      continue;
    }
    const key = JSON.stringify([own.actorUuid, own.itemId]);
    if (seen.has(key)) continue;
    seen.add(key);
    take.push({ actorUuid: own.actorUuid, itemId: own.itemId });
  }
  return { take, gone };
}
