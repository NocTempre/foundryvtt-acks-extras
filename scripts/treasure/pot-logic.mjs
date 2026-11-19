/**
 * A pot's rules on plain data, Foundry-free. A pot is one core `pile` Cards
 * document; its flag (`normalizePot`) says where it is in its life and which
 * cards are in it, and each Card's flag (`normalizeTruth`) holds what the card
 * truly is. Everything the window shows, and every act the relay allows, is
 * decided here from a `PotView`: `{id, pot, cards: [{id, face, value, truth}]}`.
 *
 * `pot.order` is the authority on what is in the pot. Core lets any user create
 * a Card in a pile, so a Card whose id is not in `order` is never shown and
 * never acted on (`cardInPot`). The same holds for the seed buckets, which are
 * listed in `pot.buckets` and kept out of `order` until the pot opens.
 *
 * Hiding is display-level: every seat can read a Card's flag, so what a seat is
 * SHOWN is chosen here (`cardView`) and is never a security boundary.
 */
import { curseKnowledge, magicKnowledge, weight6Of } from "../lib/item-model.mjs";
import { BAND_COUNT, BUCKET, CARD_FLAG, MODE, MODULE_ID, PHASE, POOL, POOL_BACK_ICON, REFUSAL } from "./constants.mjs";
import { planReplace } from "./replace-logic.mjs";
import { letterOf } from "./search-logic.mjs";

const refuse = (reason) => ({ ok: false, reason });
const ids = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === "string" && x) : []);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** The deal toggles a Judge sets on a staged pot; each gates something when the pot opens. */
export const DEAL_TOGGLE = Object.freeze({ noMagic: "noMagic", forceCursed: "forceCursed" });

/**
 * The back icon of a card whose magic is detected or identified, from Foundry's
 * own image library. A card nobody has detected wears its displayed pool's icon.
 */
export const AURA_BACK_ICON = "icons/svg/aura.svg";

/** The table styles a letter deal can use, in the order the window lists them (the keys `hoard-map.mjs` `STYLE_TABLE` answers). */
export const DEAL_STYLE = Object.freeze(["classic", "heroic", "gritty"]);

/** The deal toggles with both keys present and nothing else kept. */
const normalizeToggles = (t) => Object.fromEntries(Object.values(DEAL_TOGGLE).map((k) => [k, t?.[k] === true]));

/**
 * The monster rows a pot is staged with: one per kind, its base actor's id (null
 * for a kind known by name alone), the name, how many tokens stand for it, the
 * treasure letter its sheet carries and whether the Judge ticked it. A row with
 * no letter can never be ticked, and a row is never given a count below one.
 */
function normalizeMonsters(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const letter = letterOf(x.letter);
      return {
        actorId: typeof x.actorId === "string" && x.actorId ? x.actorId : null,
        name: String(x.name ?? ""),
        count: Math.max(1, Math.floor(num(x.count, 1))),
        letter,
        on: x.on === true && !!letter,
      };
    });
}

/** Whether a value is a setting column's key in the arms grids (`s1` and on); a blank is no column. */
const isArmsSetting = (v) => typeof v === "string" && /^s\d+$/.test(v);

/** A staged pot's deal state with every key present: the toggles, the lair state, the monster rows, the by-hand letter, the table style, the special choice and the arms column (a setting key, or blank for none). */
function normalizeDeal(d) {
  return {
    toggles: normalizeToggles(d?.toggles),
    metInLair: d?.metInLair === true,
    monsters: normalizeMonsters(d?.monsters),
    letter: letterOf(d?.letter),
    style: DEAL_STYLE.includes(d?.style) ? d.style : DEAL_STYLE[0],
    special: d?.special === true,
    armsSetting: isArmsSetting(d?.armsSetting) ? d.armsSetting : "",
  };
}

/**
 * What each document a dropped item delivers weighs, in sixths of a stone, read
 * off that document's own data. A card is one document, so the weights that go
 * on a pot's cards sum to what the pot would put on an actor, and a grab can
 * place each card on its own member.
 * @param {object[]} goods plain item data, as `droppedGoods` returns it
 * @returns {number[]}
 */
export const goodsWeights6 = (goods) => (goods ?? []).map((data) => weight6Of(data));

/**
 * The result of the last Quick grab, as the window shows it: the cards no
 * member could take, each with the card's id, the coin count still unplaced
 * (null for a whole card) and the reason code. Null when no grab has run.
 */
function normalizeGrab(g) {
  if (!g || typeof g !== "object") return null;
  const left = Array.isArray(g.leftover) ? g.leftover : [];
  return {
    leftover: left
      .filter((x) => x && typeof x.cardId === "string" && x.cardId)
      .map((x) => ({
        cardId: x.cardId,
        count: Number(x.count) > 0 ? Math.floor(Number(x.count)) : null,
        code: typeof x.code === "string" ? x.code : "noRoom",
      })),
  };
}

/**
 * The record of what each replacing seed took when the pot opened: the seed's
 * card id, the lot ids it took (none for a shortfall or a seed worth nothing)
 * and, for a shortfall, the gp the free lots fell short by.
 */
function normalizeReplaced(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x.seedId === "string" && x.seedId)
    .map((x) => ({ seedId: x.seedId, struck: ids(x.struck), shortGp: x.shortGp == null ? null : num(x.shortGp) }));
}

/** A pot's flag with every key present and every id list clean. */
export function normalizePot(flag) {
  const f = flag && typeof flag === "object" ? flag : {};
  return {
    phase: Object.values(PHASE).includes(f.phase) ? f.phase : PHASE.staging,
    mode: f.mode === MODE.table ? MODE.table : MODE.judge,
    flippers: Array.isArray(f.flippers) ? ids(f.flippers) : null,
    audience: ids(f.audience),
    partyId: typeof f.partyId === "string" ? f.partyId : null,
    origin: f.origin ?? null,
    grab: normalizeGrab(f.grab),
    deal: normalizeDeal(f.deal),
    order: ids(f.order),
    buckets: { add: ids(f.buckets?.add), replace: ids(f.buckets?.replace) },
    replaced: normalizeReplaced(f.replaced),
    messageId: typeof f.messageId === "string" ? f.messageId : null,
  };
}

/**
 * A Card's truth flag with every key present. `found` is the scene-search mark:
 * a lot dealt behind an entry starts `false` and turns true when that entry's
 * check finds it, and a truth that states none reads as found, so a pot dealt
 * any other way shows everything it holds. `lot` is the key a scene's entry
 * lists the lot under (`yields.lots`), or null for a lot no entry holds.
 * `apparent` is what a rolled magic arm ranks by while undetected: its base's
 * cost and the masterwork cost, kept only when both are positive figures.
 */
export function normalizeTruth(flag) {
  const f = flag && typeof flag === "object" ? flag : {};
  const apparent = f.apparent && typeof f.apparent === "object" && num(f.apparent.baseGp) > 0 && num(f.apparent.masterworkGp) > 0
    ? { baseUuid: typeof f.apparent.baseUuid === "string" && f.apparent.baseUuid ? f.apparent.baseUuid : null, baseGp: num(f.apparent.baseGp), masterworkGp: num(f.apparent.masterworkGp) }
    : null;
  const coin = f.coin && typeof f.coin === "object"
    ? { name: String(f.coin.name ?? ""), cv: num(f.coin.cv, 1), count: Math.max(0, Math.floor(num(f.coin.count))) }
    : null;
  const mask = f.mask && typeof f.mask === "object" ? { ...f.mask } : null;
  return {
    source: { uuid: f.source?.uuid ?? null, data: f.source?.data ?? null },
    pool: Object.values(POOL).includes(f.pool) ? f.pool : POOL.item,
    label: String(f.label ?? ""),
    coin,
    valueGp: f.valueGp == null ? null : num(f.valueGp),
    weight6: Math.max(0, num(f.weight6)),
    mask,
    magical: !!f.magical,
    detected: f.detected !== false,
    identified: f.identified === "partial" || f.identified === "full" ? f.identified : "none",
    bucket: f.bucket === BUCKET.add || f.bucket === BUCKET.replace ? f.bucket : null,
    claimedBy: f.claimedBy && typeof f.claimedBy === "object" ? { ...f.claimedBy } : null,
    found: f.found !== false,
    lot: typeof f.lot === "string" && f.lot ? f.lot : null,
    apparent,
  };
}

const isUp = (card) => card?.face !== null && card?.face !== undefined;

/** The card with this id, only if the pot's `order` lists it. */
export function cardInPot(view, cardId) {
  if (!view || typeof cardId !== "string" || !view.pot.order.includes(cardId)) return null;
  return view.cards.find((c) => c.id === cardId) ?? null;
}

/** The pot's cards in `order`, skipping an id no Card answers. */
export function potCards(view) {
  return (view?.pot.order ?? []).map((id) => view.cards.find((c) => c.id === id)).filter(Boolean);
}

/** Whether a card carries no unfound mark (`normalizeTruth`'s `found`); a card with no mark is found. */
export const isFound = (card) => card?.truth?.found !== false;

/**
 * The pot's cards a seat is shown: a Judge's every card, a player's only the
 * found ones. This is a projection and not a secret: every seat can read every
 * Card's flag, so what is withheld is what the window, the doorway, the record
 * and the relay present or act on, never the data.
 */
export function seatCards(view, { isGM = false } = {}) {
  const cards = potCards(view);
  return isGM ? cards : cards.filter(isFound);
}

/** The cards of one bucket, in the order the Judge dropped them, skipping an id no Card answers. */
export function bucketCards(view, bucket) {
  return (view?.pot.buckets[bucket] ?? []).map((id) => view.cards.find((c) => c.id === id)).filter(Boolean);
}

/**
 * The pool a seat is shown. A Judge reads the truth. A player is told `magic`
 * only once the card's magic is identified in full; until then, recognized
 * (`partial`) included, it is an item, whether or not anyone has detected it.
 */
export function shownPool(truth, { isGM = false } = {}) {
  if (isGM || truth.pool !== POOL.magic) return truth.pool;
  return truth.identified === "full" ? POOL.magic : POOL.item;
}

/** The name a seat that has turned the card reads: the mask's, else the card's own. */
export const apparentName = (truth) => truth.mask?.name || truth.label;

/**
 * The picture a seat that has turned the card sees: the mask's, else the item's,
 * else its pool's. A mask that gives a name and no picture never falls through
 * to the item's own picture, which would show the true item behind the name.
 */
export const apparentImg = (truth) =>
  truth.mask?.img || (truth.mask ? null : truth.source?.data?.img) || POOL_BACK_ICON[shownPool(truth)] || POOL_BACK_ICON.item;

/** A card's worth in gp where it states one (coin by its count and rate, or a value card), else null. */
export function worthOf(truth) {
  if (truth.coin) return (truth.coin.count * truth.coin.cv) / 100;
  if (truth.valueGp != null) return truth.valueGp;
  return null;
}

/**
 * The worth a card is RANKED by: what a seat would take it to be worth. A card
 * that states a worth (coin by count and rate, a value card) ranks by it; an
 * item by its mask's cost, else the snapshot's `system.cost`. A magic item
 * nobody has detected never ranks by its own cost, which would give the seed
 * away: it ranks by its mask's cost (an intentional disguise), else by the
 * apparent value its snapshot carries (`apparentWorth`, the non-magical worth
 * the import reads from the Judge's own copy), else, for an arm, its base's cost
 * with the masterwork cost added (`armsWorth`), else as worth nothing.
 */
export function rankWorth(truth) {
  const stated = worthOf(truth);
  if (stated != null) return stated;
  const maskCost = truth.mask?.cost;
  if (maskCost != null && maskCost !== "" && Number.isFinite(Number(maskCost))) return Number(maskCost);
  if (truth.magical && !truth.detected) return apparentWorth(truth) ?? armsWorth(truth) ?? 0;
  return num(truth.source?.data?.system?.cost, 0);
}

/**
 * What a magic arm is taken to be worth at a glance, in gp: the cost of its
 * non-magical base plus the masterwork cost the deal stored beside it
 * (`apparent`), or null where either figure is missing or not positive. The
 * sum is read here and never stored, so no card carries it as a price.
 */
export function armsWorth(truth) {
  const base = num(truth?.apparent?.baseGp);
  const masterwork = num(truth?.apparent?.masterworkGp);
  return base > 0 && masterwork > 0 ? base + masterwork : null;
}

/**
 * The apparent value an item's snapshot carries in gp
 * (`flags.<module>.markets.apparentValueGp`, which the importer reads off the
 * item's entry, JJ ch.4), or null where it carries none: no snapshot, no
 * figure, a figure that is not a positive number.
 */
export function apparentWorth(truth) {
  const raw = truth?.source?.data?.flags?.[MODULE_ID]?.markets?.apparentValueGp;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The band of each worth, ranked within the list: the number of strictly lower
 * worths, over the list's length, spread across `BAND_COUNT` ranks. Equal
 * worths share a band, a list of one is band 0, and no band is out of range.
 * @param {Array<number|null>} worths
 * @returns {number[]}
 */
export function bandsOf(worths) {
  const v = worths.map((x) => num(x, 0));
  return v.map((x) => Math.min(BAND_COUNT - 1, Math.floor((BAND_COUNT * v.filter((y) => y < x).length) / v.length)));
}

/** A band clamped into the ranks that exist. */
export const clampBand = (v) => Math.min(BAND_COUNT - 1, Math.max(0, Math.floor(num(v))));

/**
 * A plain item shaped for `magicKnowledge` and `curseKnowledge`: the card's
 * own record of its magic (read from the live item at the deal, so a variation
 * inside the item counts) and the snapshot's curse marks.
 */
function knowledgeItem(truth) {
  const marks = truth.source?.data?.flags?.[MODULE_ID]?.markets ?? {};
  return {
    flags: {
      [MODULE_ID]: {
        markets: { magic: truth.magical, detected: truth.detected, identified: truth.identified, cursed: marks.cursed, curseKnown: marks.curseKnown },
      },
    },
  };
}

/**
 * The colour a card's face wears once a seat sees it: `cursed` where this seat
 * may be shown the curse, `magic` where the magic is known and identified in
 * full (recognized stays plain), else `plain`. A Judge's tiles always read the truth.
 */
export function faceLook(truth, { isGM = false } = {}) {
  const item = knowledgeItem(truth);
  if (curseKnowledge(item, { isGM }).showCurse) return "cursed";
  const magic = magicKnowledge(item, { isGM });
  if (isGM ? magic.magical : magic.known && magic.identified === "full") return "magic";
  return "plain";
}

/**
 * The icon on a card's back for a seat that has not turned it: the displayed
 * pool's, except that a magic card whose magic is detected (or identified)
 * wears the aura. An undetected magic card wears an item's icon, so its back
 * is its plain twin's.
 */
export function backIconOf(truth) {
  const pool = shownPool(truth);
  if (pool === POOL.magic || (truth.magical && truth.detected)) return AURA_BACK_ICON;
  return POOL_BACK_ICON[pool] ?? POOL_BACK_ICON.item;
}

/**
 * The data of a new Card for a truth. The card is face down: no faces, no
 * `face`. Its `suit` and back name the pool a seat is shown, so a core sheet
 * reading the Card tells a player nothing the window would not.
 * @param {object} truth a normalized truth
 * @param {{band?: number, poolLabel: (pool: string) => string}} opts
 */
export function buildCard(truth, { band = 0, poolLabel }) {
  const shown = shownPool(truth);
  const label = poolLabel(shown);
  return {
    name: label,
    type: "base",
    suit: shown,
    value: clampBand(band),
    back: { name: label, text: "", img: backIconOf(truth) },
    faces: [],
    face: null,
    flags: { [MODULE_ID]: { [CARD_FLAG]: truth } },
  };
}

/**
 * The one update that turns a card: its apparent face and `face: 0` together,
 * so no sheet reading the Card shows a face before it is turned.
 */
export function flipUpdate(cardId, truth) {
  return { _id: cardId, faces: [{ name: apparentName(truth), text: "", img: apparentImg(truth) }], face: 0 };
}

/** The cookbook id the item's snapshot carries (the key book art is looked up by), or null. */
const cookbookIdOf = (truth) => {
  const id = truth.source?.data?.flags?.[MODULE_ID]?.cookbook?.id;
  return typeof id === "string" && id ? id : null;
};

/**
 * What one seat is shown of one card. A player's view carries no name, weight
 * or worth until the card is turned, never says `magic` of a card whose magic
 * is not identified, and shows an aura only on a turned card whose magic has
 * been detected. A Judge's view carries the truth, a Seed mark, and a warning
 * where an undetected magic card has no mask to hide its name behind (`leaks`)
 * or a mask with no picture, so the item's true one shows (`leaksPicture`).
 * `kind` (the item's cookbook id) and `artSrc` feed the face's picture: a player
 * gets the kind only where the card is neither masked nor undetected magic, and
 * never the true picture behind a mask that names an item without one.
 * @param {{id: string, face: number|null, value: number, truth: object}} card
 * @param {{isGM?: boolean}} [seat]
 */
export function cardView(card, { isGM = false } = {}) {
  const { truth } = card;
  const up = isUp(card);
  const shows = isGM || up;
  return {
    id: card.id,
    up,
    down: !up,
    poolKey: shownPool(truth, { isGM }),
    backKey: shownPool(truth),
    backIcon: backIconOf(truth),
    auraBack: truth.magical && truth.detected && shownPool(truth) !== POOL.magic,
    look: shows ? faceLook(truth, { isGM }) : "plain",
    band: clampBand(card.value),
    name: !shows ? "" : isGM ? truth.label : apparentName(truth),
    maskName: isGM && truth.mask?.name ? truth.mask.name : "",
    img: shows ? (isGM ? truth.source?.data?.img || apparentImg(truth) : apparentImg(truth)) : "",
    kind: shows && (isGM || !(truth.mask?.name || (truth.magical && !truth.detected))) ? cookbookIdOf(truth) : null,
    artSrc: shows ? (isGM ? truth.source?.data?.img || "" : truth.mask?.img || (truth.mask?.name ? "" : truth.source?.data?.img) || "") : "",
    worthGp: shows ? worthOf(truth) : null,
    weight6: shows ? truth.weight6 : null,
    aura: isGM ? truth.magical : up && truth.magical && truth.detected,
    seed: isGM && !!truth.bucket,
    leaks: isGM && truth.magical && !truth.detected && !(truth.mask?.name && truth.mask?.img),
    leaksPicture: isGM && truth.magical && !truth.detected && !!truth.mask?.name && !truth.mask?.img,
    claimed: !!truth.claimedBy,
    found: isFound(card),
    claimedByName: truth.claimedBy?.actorName ?? truth.claimedBy?.placeName ?? "",
  };
}

/**
 * The total worth of the views' cards that state one, with each pool's part.
 * `all` counts face-down cards too (the Judge's pot value); otherwise only the
 * turned ones (the haul so far). A card that states no worth adds nothing.
 * @param {object[]} views `cardView` results
 * @returns {{totalGp: number, parts: Array<{poolKey: string, gp: number}>}}
 */
export function haulOf(views, { all = false } = {}) {
  const byPool = new Map();
  for (const v of views) {
    if (v.worthGp == null || !(all || v.up)) continue;
    byPool.set(v.poolKey, (byPool.get(v.poolKey) ?? 0) + v.worthGp);
  }
  const parts = [...byPool].map(([poolKey, gp]) => ({ poolKey, gp }));
  return { totalGp: parts.reduce((s, p) => s + p.gp, 0), parts };
}

/** How many of the pot's found cards are turned, and how many are found (a card dealt with no mark is found). */
export function turnedOf(view) {
  const cards = seatCards(view);
  return { turned: cards.filter(isUp).length, count: cards.length };
}

/* -------------------------------------------- */
/*  Acts a player asks for                       */
/* -------------------------------------------- */

/** Whether a sender may act on an open pot at all: a Judge, or a seat the pot opened to. */
const seated = (pot, sender) => !!sender?.isGM || pot.audience.includes(sender?.id);

/**
 * Turn a card. Refused unless the pot is open, the sender is the Judge or a
 * seat in the audience that may flip, and the card is in `order` and face down.
 * @returns {{ok: true, card: object, update: object}|{ok: false, reason: string}}
 */
export function planFlip(view, cardId, { sender }) {
  if (!view) return refuse(REFUSAL.noPot);
  const { pot } = view;
  if (pot.phase !== PHASE.open) return refuse(REFUSAL.phase);
  if (!seated(pot, sender)) return refuse(REFUSAL.notAllowed);
  if (!sender.isGM && pot.flippers && !pot.flippers.includes(sender.id)) return refuse(REFUSAL.notAllowed);
  const card = cardInPot(view, cardId);
  if (!card || !isFound(card)) return refuse(REFUSAL.notInPot);
  if (isUp(card)) return refuse(REFUSAL.alreadyUp);
  return { ok: true, card, update: flipUpdate(card.id, card.truth) };
}

/**
 * Take a card onto an actor. Refused unless the pot is open, the sender is the
 * Judge or in the audience, the card is in `order`, turned and unclaimed, the
 * target exists, and a player owns it. A Judge may give to any actor; `warn`
 * says the actor is one no seat at the table owns.
 * @param {object} view
 * @param {string} cardId
 * @param {{sender: object, hasTarget: boolean, owns: boolean, ownedByTable: boolean}} ctx
 * @returns {{ok: true, card: object, warn: boolean}|{ok: false, reason: string}}
 */
export function planClaim(view, cardId, { sender, hasTarget, owns, ownedByTable }) {
  if (!view) return refuse(REFUSAL.noPot);
  const { pot } = view;
  if (pot.phase !== PHASE.open) return refuse(REFUSAL.phase);
  if (!seated(pot, sender)) return refuse(REFUSAL.notAllowed);
  const card = cardInPot(view, cardId);
  if (!card || !isFound(card)) return refuse(REFUSAL.notInPot);
  if (!isUp(card)) return refuse(REFUSAL.faceDown);
  if (card.truth.claimedBy) return refuse(REFUSAL.claimed);
  if (!hasTarget) return refuse(REFUSAL.noTarget);
  if (!sender.isGM && !owns) return refuse(REFUSAL.notOwner);
  return { ok: true, card, warn: !!sender.isGM && !ownedByTable };
}

/* -------------------------------------------- */
/*  Acts the Judge makes                         */
/* -------------------------------------------- */

/**
 * Mark the lots carrying these keys found: a NEW view, the input untouched. A
 * key names a lot by its truth's `lot`, and only a card in `order` counts. `ids`
 * are the cards that turned from unfound to found, `already` the keys whose card
 * was found before, `missing` the keys no card in the pot carries. Refused on a
 * closed pot. Bands are not touched: they were ranked over every lot when the
 * pot opened.
 * @param {object} view a `PotView`
 * @param {string[]} keys lot keys, as a layer's `yields.lots` lists them
 * @returns {{ok: true, view: object, ids: string[], already: string[], missing: string[]}|{ok: false, reason: string}}
 */
export function planFound(view, keys) {
  if (!view) return refuse(REFUSAL.noPot);
  if (view.pot.phase === PHASE.closed) return refuse(REFUSAL.phase);
  const wanted = [...new Set((Array.isArray(keys) ? keys : []).filter((k) => typeof k === "string" && k))];
  const inPot = potCards(view);
  const ids = [];
  const already = [];
  const missing = [];
  for (const key of wanted) {
    const card = inPot.find((c) => c.truth.lot === key);
    if (!card) missing.push(key);
    else if (isFound(card)) already.push(key);
    else ids.push(card.id);
  }
  const turned = new Set(ids);
  const cards = view.cards.map((c) => (turned.has(c.id) ? { ...c, truth: { ...c.truth, found: true } } : c));
  return { ok: true, view: { ...view, cards }, ids, already, missing };
}

/** The pot with a card put in it (`order`) or in a bucket, during staging only. Returns the new pot, or null. */
export function stage(pot, id, { bucket = null } = {}) {
  if (pot.phase !== PHASE.staging || !id) return null;
  const next = normalizePot(pot);
  if (bucket) {
    if (!(bucket in next.buckets)) return null;
    next.buckets[bucket] = [...next.buckets[bucket].filter((x) => x !== id), id];
  } else {
    next.order = [...next.order.filter((x) => x !== id), id];
  }
  return next;
}

/** The pot with a card taken out of `order` and the buckets, during staging only. Returns the new pot, or null. */
export function unstage(pot, id) {
  if (pot.phase !== PHASE.staging) return null;
  const next = normalizePot(pot);
  next.order = next.order.filter((x) => x !== id);
  next.buckets.add = next.buckets.add.filter((x) => x !== id);
  next.buckets.replace = next.buckets.replace.filter((x) => x !== id);
  return next;
}

/**
 * `adds` placed into `order` at a random position each, the position drawn
 * from the injected `rng` (`() => [0, 1)`). Returns a new list.
 */
export function placeAdds(order, adds, rng) {
  const out = [...order];
  for (const id of adds) {
    const at = Math.min(out.length, Math.floor(rng() * (out.length + 1)));
    out.splice(at, 0, id);
  }
  return out;
}

/** The pot with one deal toggle set, during staging only. Returns the new pot, or null. */
export function setToggle(pot, key, on) {
  if (pot.phase !== PHASE.staging || !Object.values(DEAL_TOGGLE).includes(key)) return null;
  const next = normalizePot(pot);
  next.deal.toggles[key] = !!on;
  return next;
}

/**
 * The pot with the Judge's "Met in their lair" state set, during staging only.
 * Nothing infers it; the lair warning (`deal-logic.mjs`) reads this alone.
 * Returns the new pot, or null.
 */
export function setMetInLair(pot, on) {
  if (pot.phase !== PHASE.staging) return null;
  const next = normalizePot(pot);
  next.deal.metInLair = !!on;
  return next;
}

/**
 * The pot with its monster rows replaced, during staging only (a pot opened from
 * a sheet or from selected tokens). Rows are normalized: a row with no letter is
 * never ticked. Returns the new pot, or null.
 */
export function setMonsters(pot, rows) {
  if (pot.phase !== PHASE.staging) return null;
  const next = normalizePot(pot);
  next.deal.monsters = normalizeMonsters(rows);
  return next;
}

/** The pot with monster row `index` ticked or cleared, during staging only. Null for a pot that is not staging, a row that does not exist, or a ticking of a row with no letter. */
export function setMonsterOn(pot, index, on) {
  if (pot.phase !== PHASE.staging) return null;
  const next = normalizePot(pot);
  const row = Number.isInteger(index) ? next.deal.monsters[index] : null;
  if (!row || (on && !row.letter)) return null;
  row.on = !!on;
  return next;
}

/**
 * The pot with one deal choice set, during staging only: `style` (one of
 * `DEAL_STYLE`), `special` (a boolean), `letter` (the by-hand treasure type;
 * blank clears it) or `armsSetting` (the arms grids' column a rolled arm is typed
 * on; blank clears it). Returns the new pot, or null for a pot that is not
 * staging, a key that is not a choice, a style that is not listed, or an arms
 * column that is not a setting key.
 */
export function setDealChoice(pot, key, value) {
  if (pot.phase !== PHASE.staging) return null;
  const next = normalizePot(pot);
  if (key === "style") {
    if (!DEAL_STYLE.includes(value)) return null;
    next.deal.style = value;
  } else if (key === "special") next.deal.special = value === true;
  else if (key === "armsSetting") {
    if (value !== "" && value != null && !isArmsSetting(value)) return null;
    next.deal.armsSetting = isArmsSetting(value) ? value : "";
  } else if (key === "letter") next.deal.letter = letterOf(value);
  else return null;
  return next;
}

/**
 * The Judge's warning for a replace plan: the seeds the free lots could not
 * cover. Such a seed takes no lot and still lands, so the pot holds the seeds'
 * worth more than the table rolled. Null when every seed was covered, or there
 * were none.
 * @param {object[]} plans  `planReplace`'s `plans`
 * @param {function(string): string} label  a seed id's true name
 * @returns {{seeds: string[], worthGp: number, shortGp: number}|null} the names
 *   of the seeds that took no lots, their worth together, and the gp the lots
 *   fell short of it together
 */
export function replaceWarning(plans, label = (id) => id) {
  const short = (plans ?? []).filter((p) => !p.ok);
  if (!short.length) return null;
  const sum = (key) => Math.round(short.reduce((s, p) => s + p[key] * 100, 0)) / 100;
  return { seeds: short.map((p) => label(p.seedId)), worthGp: sum("worthGp"), shortGp: sum("shortGp") };
}

/**
 * What opening the pot does to its cards, before anything is written: the
 * toggles applied to every card the pot will hold (`order` and both buckets),
 * then each survivor's band ranked within the survivors.
 *
 * "No magic" strikes every card whose truth is magic, seeds included, since a
 * by-hand pot has no roll to skip. "Force cursed" marks the snapshot of every
 * remaining magic card cursed (`markets.cursed`), so an item created from it
 * is. A card whose magic is identified in full also gets `markets.curseKnown`,
 * since what a full identification reveals includes the curse; a card
 * identified in part or not at all is left with the curse unknown. `audit` has one row per toggle that is on, with the
 * true names of the cards it changed, for the Judge's whisper.
 *
 * The replace plan (`planReplace`) runs after the toggles, over the cards left
 * in `order` and the replace seeds left in the bucket, both by apparent worth
 * (`rankWorth`). A struck lot is in `struck`, never in `removed` (its Card is
 * kept), and bands are ranked over `held`: what the pot will hold, struck lots
 * out. `replace` is the plan's entries; `audit` ends with a `replace` row of
 * `{seed, lots, overGp, shortGp}` lines (true names) when a replace seed stands.
 * `warning` is `replaceWarning` over the plan.
 * @returns {{removed: string[], kept: string[], held: string[], struck: string[], replace: object[], warning: object|null, bands: Object<string, number>, forced: Array<{id: string, flags: object}>, audit: Array<{toggle: string, names: string[], lines?: object[]}>}}
 */
export function dealOf(view) {
  const { pot } = view;
  const byId = new Map(view.cards.map((c) => [c.id, c]));
  const listed = [...new Set([...pot.order, ...pot.buckets.replace, ...pot.buckets.add])].filter((id) => byId.has(id));
  const { noMagic, forceCursed } = pot.deal.toggles;
  const removed = noMagic ? listed.filter((id) => byId.get(id).truth.magical) : [];
  const kept = listed.filter((id) => !removed.includes(id));
  const forced = forceCursed
    ? kept
        .filter((id) => byId.get(id).truth.magical && byId.get(id).truth.source.data)
        .map((id) => {
          const flags = structuredClone(byId.get(id).truth.source.data.flags ?? {});
          flags[MODULE_ID] = { ...(flags[MODULE_ID] ?? {}) };
          flags[MODULE_ID].markets = { ...(flags[MODULE_ID].markets ?? {}), cursed: true };
          if (byId.get(id).truth.identified === "full") flags[MODULE_ID].markets.curseKnown = true;
          return { id, flags };
        })
    : [];
  const seedIds = pot.buckets.replace.filter((id) => kept.includes(id));
  const addIds = new Set(pot.buckets.add);
  const lotIds = pot.order.filter((id) => kept.includes(id) && !seedIds.includes(id) && !addIds.has(id));
  const worth = (id) => rankWorth(byId.get(id).truth);
  const { plans, struck } = planReplace({
    seeds: seedIds.map((id) => ({ id, worth: worth(id) })),
    lots: lotIds.map((id) => ({ id, worth: worth(id) })),
  });
  const held = kept.filter((id) => !struck.includes(id));
  const ranks = bandsOf(held.map(worth));
  const bands = Object.fromEntries(held.map((id, i) => [id, ranks[i]]));
  const label = (id) => byId.get(id).truth.label;
  const audit = [];
  if (noMagic) audit.push({ toggle: DEAL_TOGGLE.noMagic, names: removed.map(label) });
  if (forceCursed) audit.push({ toggle: DEAL_TOGGLE.forceCursed, names: forced.map((f) => label(f.id)) });
  if (plans.length) {
    audit.push({
      toggle: "replace",
      names: [],
      lines: plans.map((p) => ({ seed: label(p.seedId), lots: p.struck.map(label), overGp: p.ok ? p.overGp : null, shortGp: p.ok ? null : p.shortGp })),
    });
  }
  return { removed, kept, held, struck, replace: plans, warning: replaceWarning(plans, label), bands, forced, audit };
}

/**
 * A staged pot's view with each card's `value` set to the band opening would
 * give it, so the Judge's tiles never show a band that is only a placeholder.
 * A card the toggles will strike keeps its stored value. An open or closed pot
 * is returned as it is: its bands were frozen at open.
 */
export function withBands(view) {
  if (view.pot.phase !== PHASE.staging) return view;
  const { bands } = dealOf(view);
  return { ...view, cards: view.cards.map((c) => (c.id in bands ? { ...c, value: bands[c.id] } : c)) };
}

/**
 * Open a staged pot to the table: the deal toggles are applied, each replace
 * seed takes the slot of the first lot it strikes (`dealOf`'s plan; the struck
 * lots leave `order` and their Cards stay in the pile unshown), every seed with
 * no slot and every add seed land at random positions, and both buckets empty.
 * The plan is kept on the flag as `replaced`. Bands are ranked here and never
 * again. `audience` is who gets LIMITED sight.
 * `warning` is `dealOf`'s Judge warning for a seed no lot covered.
 * @returns {{ok: true, flag: object, bands: object, removed: string[], struck: string[], forced: object[], audit: object[], warning: object|null}|{ok: false, reason: string}}
 */
export function planOpen(view, { audience, rng }) {
  if (!view) return refuse(REFUSAL.noPot);
  const pot = view.pot;
  if (pot.phase !== PHASE.staging) return refuse(REFUSAL.phase);
  const known = new Set(view.cards.map((c) => c.id));
  const order = pot.order.filter((id) => known.has(id));
  const replace = pot.buckets.replace.filter((id) => known.has(id));
  const add = pot.buckets.add.filter((id) => known.has(id));
  if (!order.length && !replace.length && !add.length) return refuse(REFUSAL.empty);
  const deal = dealOf(view);
  if (!deal.kept.length) return refuse(REFUSAL.dealEmpty);
  const gone = new Set(deal.removed);
  const next = normalizePot(pot);
  next.phase = PHASE.open;
  next.audience = ids(audience);
  const struck = new Set(deal.struck);
  const slot = new Map();
  for (const p of deal.replace) if (p.struck.length) slot.set(order.find((id) => p.struck.includes(id)), p.seedId);
  const base = order.filter((id) => !gone.has(id) && (!struck.has(id) || slot.has(id))).map((id) => slot.get(id) ?? id);
  const placed = new Set(slot.values());
  const loose = [...replace, ...add].filter((id) => !gone.has(id) && !placed.has(id));
  next.order = placeAdds(base, loose, rng);
  next.buckets = { add: [], replace: [] };
  next.replaced = deal.replace.map((p) => ({ seedId: p.seedId, struck: p.struck, shortGp: p.ok ? null : p.shortGp }));
  return { ok: true, flag: next, bands: deal.bands, removed: deal.removed, struck: deal.struck, forced: deal.forced, audit: deal.audit, warning: deal.warning };
}

/**
 * Close a pot: what is still unclaimed in `order` is the leftovers, and the
 * record lists every card the pot held and where it went. A lot never found
 * is neither left to file nor listed: the table never saw it.
 * @returns {{ok: true, flag: object, left: object[], record: object[]}|{ok: false, reason: string}}
 */
export function planClose(view) {
  if (!view) return refuse(REFUSAL.noPot);
  if (view.pot.phase === PHASE.closed) return refuse(REFUSAL.phase);
  const cards = seatCards(view);
  const next = normalizePot(view.pot);
  next.phase = PHASE.closed;
  return {
    ok: true,
    flag: next,
    left: cards.filter((c) => !c.truth.claimedBy),
    record: cards.map((c) => cardView(c, { isGM: false })),
  };
}

/* -------------------------------------------- */
/*  What a claim delivers                        */
/* -------------------------------------------- */

/**
 * The item data a claim creates from a card's snapshot: the snapshot wearing
 * the card's mask (`disguise`, the equipment feature's `disguiseData`), and
 * marked undetected only where the card says it is. Never mutates the card.
 * @param {object} truth a normalized truth
 * @param {(data: object, apparent: object) => object} disguise
 * @returns {object|null} plain item data, or null when the card holds no item
 */
export function claimItemData(truth, disguise) {
  const snapshot = truth.source?.data;
  if (!snapshot || truth.coin || truth.valueGp != null) return null;
  const data = structuredClone(snapshot);
  delete data._id;
  const out = truth.mask ? disguise(data, truth.mask) : data;
  if (truth.detected === false) {
    out.flags = { ...(out.flags ?? {}) };
    out.flags[MODULE_ID] = { ...(out.flags[MODULE_ID] ?? {}) };
    out.flags[MODULE_ID].markets = { ...(out.flags[MODULE_ID].markets ?? {}), detected: false };
  }
  return out;
}

/**
 * The coin credits a claim lands for a coin card, in `creditCoin`'s shape: the
 * card's own snapshot says which coin it is, else `template` (the world's coin
 * of that name, looked up by the caller). Null where neither names a coin, so
 * nothing is written.
 * @param {object} truth a normalized truth
 * @param {object|null} [template] plain data of a coin row
 * @returns {Array<{source: object, count: number}>|null}
 */
export function claimCoinCredits(truth, template = null) {
  if (!truth.coin || !(truth.coin.count > 0)) return null;
  const snap = truth.source?.data;
  const source = snap?.type === "money" ? snap : template;
  return source ? [{ source, count: truth.coin.count }] : null;
}
