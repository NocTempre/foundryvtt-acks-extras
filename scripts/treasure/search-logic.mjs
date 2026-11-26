/**
 * "Search the fallen" on plain data, Foundry-free: which combatants of a fight
 * that ended count as fallen, the record built of them, and which goods leave
 * the bodies once their lots are found (JJ ch. 4; RR, Adventures chapter, for the procedure; this file holds
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
import { MODULE_ID } from "./constants.mjs";

/** Flag key, under the module's scope, of the chat card that carries a fight's record. */
export const SEARCH_FLAG = "treasureSearch";

/** The options a linked table is drawn with: the Judge's client only, nothing posted to the table. */
export const DRAW_REQUEST = Object.freeze({ displayChat: false });

const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * The truths a fallen creature's linked table already drew for this card
 * (`drawnBy[combatantId]` on the card's raw record), or null where it has not
 * been drawn. A press after a refused open reuses them, so a table is rolled
 * once per card however many presses reach the draw.
 * @param {object|null} flag the card's raw record flag
 * @param {string} combatantId
 * @returns {object[]|null}
 */
export function heldDraw(flag, combatantId) {
  const held = flag?.drawnBy?.[combatantId];
  return Array.isArray(held) ? held.filter((t) => t !== null && typeof t === "object" && !Array.isArray(t)) : null;
}

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

/** Whether an entry holds anything a scene could deal a haul from. */
export const holdsAnything = (entry) => !!(entry.goods.length || entry.letter || entry.tableUuid);

/**
 * The record of a fight: its entries that hold something. Null when none does,
 * so a fight whose fallen carried nothing posts no card.
 * @returns {{combatId: string, sceneId: string|null, fallen: object[], opened: false, drawnText: string[]}|null}
 */
export function recordOf({ combatId, sceneId = null, entries }) {
  const fallen = (Array.isArray(entries) ? entries : []).filter(holdsAnything);
  return fallen.length ? { combatId, sceneId, fallen, opened: false, drawnText: [] } : null;
}

/** The lots a card remembers of its first opening, `{key, thing, layer}` each; a row with no key or no thing is dropped. */
const lotsOf = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((l) => l && typeof l === "object" && text(l.key) && text(l.thing))
    .map((l) => ({ key: text(l.key), thing: text(l.thing), layer: text(l.layer) || null }));

/**
 * The deal choices a card records (`{style, special, metInLair, armsSetting}`),
 * or null where it records none (a card posted before the choices were kept, or
 * a record built by hand). The values are the shapes a pot's `deal` stores, so
 * the pot the card opens reads them as written; a style or column the pot does
 * not list is dropped there, not here.
 * @param {*} raw the card's `deal` as the flag holds it
 * @returns {{style: string, special: boolean, metInLair: boolean, armsSetting: string}|null}
 */
export function dealChoicesOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return { style: text(raw.style), special: raw.special === true, metInLair: raw.metInLair === true, armsSetting: text(raw.armsSetting) };
}

/**
 * A record read back from a flag, every key present. `opened` is set once a
 * scene search has been opened from the card, so one card deals once; with it
 * the card keeps what that first opening made (`potUuid`, `placeUuid`, `lots`),
 * which a Judge's later press reattaches without dealing again. `deal` is the
 * choices the opening will deal on (`dealChoicesOf`), null for a card that
 * records none.
 */
export function normalizeRecord(flag) {
  const f = flag && typeof flag === "object" ? flag : {};
  return {
    combatId: typeof f.combatId === "string" ? f.combatId : "",
    sceneId: typeof f.sceneId === "string" ? f.sceneId : null,
    fallen: Array.isArray(f.fallen) ? f.fallen.filter((e) => e && typeof e === "object") : [],
    opened: f.opened === true,
    drawnText: Array.isArray(f.drawnText) ? f.drawnText.map(String) : [],
    potUuid: text(f.potUuid) || null,
    placeUuid: text(f.placeUuid) || null,
    lots: lotsOf(f.lots),
    deal: dealChoicesOf(f.deal),
  };
}

/**
 * What the card shows: a row per fallen creature, with how many items it
 * carried, its letter and whether a table is linked, and its combatant id,
 * which the open-sheet control carries to name the body it opens, and its
 * linked table's uuid, which the Table control carries to name the table it
 * opens.
 */
export function cardRows(record) {
  const r = normalizeRecord(record);
  return r.fallen.map((e) => ({
    combatantId: text(e.combatantId),
    name: String(e.name ?? ""),
    items: Array.isArray(e.goods) ? e.goods.length : 0,
    letter: letterOf(e.letter),
    hasTable: !!e.tableUuid,
    tableUuid: text(e.tableUuid),
  }));
}

/**
 * Whether a linked table's uuid still names a table to open, for a control
 * drawn disabled where it does not. The uuid has to end in a RollTable and the
 * resolver has to find something under it: a table in a compendium resolves
 * synchronously to its index entry, which is no document and says what it is
 * only by its uuid. A throwing resolver names nothing.
 * @param {string|null} uuid the fallen's linked table uuid
 * @param {(uuid: string) => object|null} resolve a synchronous resolver, `fromUuidSync` in the world
 */
export function tableExists(uuid, resolve) {
  if (typeof uuid !== "string" || !/(^|\.)RollTable\.[^.]+$/.test(uuid)) return false;
  try {
    return !!resolve(uuid);
  } catch {
    return false;
  }
}

/**
 * Disable the Table buttons of a fight-over card whose table no longer
 * resolves. The button's `data-table` carries the uuid the record held when the
 * card was posted.
 * @param {Array<{dataset?: {table?: string}, disabled?: boolean}>} buttons
 * @param {(uuid: string) => object|null} resolve a synchronous resolver, `fromUuidSync` in the world
 */
export function settleTableButtons(buttons, resolve) {
  for (const button of buttons) button.disabled = !tableExists(button.dataset?.table, resolve);
}

/**
 * The actor a document stands for: a token's actor, an actor itself, else null.
 * @param {object|null} doc a resolved document
 */
export function actorOfDoc(doc) {
  if (doc?.documentName === "Token") return doc.actor ?? null;
  return doc?.documentName === "Actor" ? doc : null;
}

/**
 * The actor a fallen body's uuid stands for, for the control that opens its
 * sheet: the token's actor where the uuid runs through a token (an unlinked
 * token's own synthetic actor), else the document the uuid names. A uuid whose
 * token is gone resolves to nothing, never to the world actor the token was made
 * from; a throwing resolver is nothing too.
 * @param {string|null} uuid the fallen's actor uuid
 * @param {(uuid: string) => object|null} resolve a synchronous resolver, `fromUuidSync` in the world
 * @returns {object|null}
 */
export function bodyActorOf(uuid, resolve) {
  if (typeof uuid !== "string" || !uuid) return null;
  const token = uuid.match(/^(.*?\.Token\.[^.]+)\./)?.[1] ?? null;
  for (const candidate of token ? [token, uuid] : [uuid]) {
    try {
      const actor = actorOfDoc(resolve(candidate));
      if (actor) return actor;
    } catch {
      /* a uuid that cannot be resolved names no body */
    }
  }
  return null;
}

/**
 * Settle the open-sheet buttons of a fight-over card for the seat drawing it:
 * a non-Judge's are removed (the card's stored content reaches every seat that
 * can read the message, and `hidden` does not survive it), a Judge's are
 * disabled where the body they name no longer resolves to an actor.
 * @param {Array<{dataset?: {combatant?: string}, disabled?: boolean, remove: () => void}>} buttons
 * @param {{isGM: boolean, record: object|null, resolve: (uuid: string) => object|null}} seat
 */
export function settleSheetButtons(buttons, { isGM, record, resolve }) {
  const fallen = normalizeRecord(record).fallen;
  for (const button of buttons) {
    if (!isGM) {
      button.remove();
      continue;
    }
    const row = fallen.find((e) => text(e.combatantId) === button.dataset?.combatant);
    button.disabled = !bodyActorOf(row?.actorUuid, resolve);
  }
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
 * Whether an origin still owes goods to the bodies: it asks for the take-off
 * (`takeOff: true`) and maps a card, among `cardIds` where they are given, that
 * has not been settled (`taken`). An origin that does not say so owes nothing,
 * whatever else it carries.
 * @param {object|null} origin the pot's origin
 * @param {string[]|null} [cardIds] the cards asked about, or null for every one
 */
export function needsTakeOff(origin, cardIds = null) {
  if (origin?.takeOff !== true || !origin.carried || typeof origin.carried !== "object") return false;
  const settled = new Set(Array.isArray(origin.taken) ? origin.taken : []);
  const asked = Array.isArray(cardIds) ? new Set(cardIds) : null;
  return Object.keys(origin.carried).some((id) => !settled.has(id) && (!asked || asked.has(id)));
}

/**
 * The items to take off the bodies for cards of a pot. Only a goods card still
 * in the pot's `order` counts (a card the Judge removed leaves its item where it
 * is), a card already settled is not looked at again, one item is taken once
 * however many cards it made, and a body that no longer exists is nothing to
 * take from: its card stays, built from the snapshot. `only` limits the plan to
 * the cards a find has just turned.
 * @param {{carried: object, order: string[], exists: (actorUuid: string, itemId: string) => boolean, taken?: string[], only?: string[]|null}} args
 * @returns {{take: Array<{actorUuid: string, itemId: string}>, gone: string[], settled: string[]}} `gone` are the card ids whose body no longer holds the item; `settled` is every card this plan answers for, to be recorded so none is planned twice
 */
export function planTakeOff({ carried, order, exists, taken = [], only = null }) {
  const inPot = new Set(Array.isArray(order) ? order : []);
  const done = new Set(Array.isArray(taken) ? taken : []);
  const asked = Array.isArray(only) ? new Set(only) : null;
  const take = [];
  const gone = [];
  const settled = [];
  const seen = new Set();
  for (const [cardId, own] of Object.entries(carried ?? {})) {
    if (done.has(cardId) || (asked && !asked.has(cardId))) continue;
    if (!inPot.has(cardId) || !own?.actorUuid || !own?.itemId) continue;
    settled.push(cardId);
    if (!exists(own.actorUuid, own.itemId)) {
      gone.push(cardId);
      continue;
    }
    const key = JSON.stringify([own.actorUuid, own.itemId]);
    if (seen.has(key)) continue;
    seen.add(key);
    take.push({ actorUuid: own.actorUuid, itemId: own.itemId });
  }
  return { take, gone, settled };
}
