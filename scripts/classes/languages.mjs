/* global game, foundry */
/**
 * Who speaks what (RR §I.10): the tongues a class, a race, an Intellect bonus
 * and the language abilities owe a character, and the open slots left to fill
 * in play.
 *
 * A known tongue is a `language` item on the actor, the type the system owns
 * and reads. The one thing kept here is the open slot: one carrier ability per
 * character holds a count and the ids of the languages chosen against it, and
 * the documents stay the truth. Which languages exist is the world's (the
 * importer, or a Judge); this file only counts slots and fills them. No rule
 * branches on a language's parent, so nothing here reads one; written-word
 * powers belong to the ability model.
 *
 * See docs/classes/DECISIONS.md, "a language is the system's document, not our
 * private string".
 */
import { MODULE_ID } from "./constants.mjs";
import { abilityMod } from "../lib/actor-read.mjs";
import { libraryItems, cookbookId } from "../lib/library.mjs";

/** The system's item type for a language. */
export const LANGUAGE_TYPE = "language";

/** Where the system keeps its printed languages, for adoption. */
const SYSTEM_PACK = "acks.acks-languages";

/** The flag an ability carries when it IS a set of open language slots. */
export const SLOT_FLAG = "languageSlots";

/** Literacy states, in the order Intellect produces them. */
export const LITERACY = Object.freeze({
  ILLITERATE: "illiterate", // Intellect penalty
  LITERATE: "literate", // otherwise
});

/**
 * How many extra tongues this actor's abilities buy, over class, race and
 * Intellect.
 *
 * An ability buys what its own `flags["acks-extras"].languageGrant` says: the
 * importer reads that count off the ability's page, and a Judge may set or
 * clear it on the ability sheet. Summing per item multiplies by rank, since
 * rank is the count of same-named items. An ability with no figure buys none.
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function languagesFromAbilities(actor) {
  let n = 0;
  for (const item of actor?.items ?? []) {
    const declared = Number(item.flags?.[MODULE_ID]?.languageGrant);
    if (declared > 0) n += declared;
  }
  return n;
}

/**
 * How many tongues a character is owed and from where, given the documents
 * that grant them. Pure counting — the caller supplies the class, race and
 * ability figures, so this is testable without a world.
 *
 * @param {object} opts
 * @param {number} opts.intMod           the character's Intellect modifier
 * @param {object} [opts.classLanguages] `{granted: string[], count: number}`
 * @param {object} [opts.raceLanguages]  same shape, from the race document
 * @param {number} [opts.fromAbilities]  slots bought by proficiencies/powers
 * @returns {{granted: string[], openSlots: number, fromInt: number,
 *            fromClass: number, fromRace: number, fromAbilities: number,
 *            literacy: string}}
 */
export function languageGrant({
  intMod = 0,
  classLanguages = null,
  raceLanguages = null,
  fromAbilities = 0,
} = {}) {
  // A sheet row never named is stored null; it must not become a tongue "null".
  const named = [...(classLanguages?.granted ?? []), ...(raceLanguages?.granted ?? [])]
    .map((n) => String(n ?? "").trim())
    .filter(Boolean);
  // A class and a race may grant the same tongue; it is learned once.
  const granted = [...new Set(named)];
  const fromClass = Number(classLanguages?.count) || 0;
  const fromRace = Number(raceLanguages?.count) || 0;
  // Only a bonus buys languages; a penalty costs literacy, not tongues.
  const fromInt = Math.max(0, Number(intMod) || 0);
  // Never gated on the Intellect bonus.
  const fromAbility = Math.max(0, Number(fromAbilities) || 0);
  return {
    granted,
    fromClass,
    fromRace,
    fromInt,
    fromAbilities: fromAbility,
    openSlots: fromClass + fromRace + fromInt + fromAbility,
    literacy: (Number(intMod) || 0) < 0 ? LITERACY.ILLITERATE : LITERACY.LITERATE,
  };
}

/* ------------------------------------------------------------------ */
/*  Finding a language before building one                             */
/* ------------------------------------------------------------------ */

/** Every language document the library holds, one per name, sorted by name. */
export function worldLanguages() {
  const seen = new Map();
  for (const item of libraryItems()) {
    if (item.type !== LANGUAGE_TYPE) continue;
    const key = item.name.toLowerCase();
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The document a granted entry names, or null.
 *
 * An entry is a plain name or a ref (`uuid:…`, or an importer cookbook id).
 * Refs are tried first, then the world, then the system's own compendium.
 *
 * @param {string} entry a name or a ref
 * @returns {Promise<Document|null>}
 */
export async function resolveLanguage(entry) {
  const raw = String(entry ?? "").trim();
  if (!raw) return null;

  if (raw.startsWith("uuid:")) {
    const doc = await fromUuid(raw.slice(5)).catch(() => null);
    if (doc) return doc;
  }
  if (raw.includes(".")) {
    const byId = libraryItems().find((i) => cookbookId(i) === raw);
    if (byId) return byId;
  }

  const key = raw.toLowerCase();
  const worldLangs = libraryItems().filter((i) => i.type === LANGUAGE_TYPE);
  const local =
    worldLangs.find((i) => i.name.toLowerCase() === key) ??
    wordPrefixMatch(
      raw,
      worldLangs.map((i) => i.name),
      (name) => worldLangs.find((i) => i.name === name),
    );
  if (local) return local;

  const pack = game.packs?.get(SYSTEM_PACK);
  if (!pack) return null;
  const index = await pack.getIndex().catch(() => null);
  const names = (index ?? []).map((e) => e.name).filter(Boolean);
  const hit =
    index?.find((e) => e.name?.toLowerCase() === key) ??
    wordPrefixMatch(raw, names, (name) => index.find((e) => e.name === name));
  return hit ? await pack.getDocument(hit._id).catch(() => null) : null;
}

/**
 * The one candidate the granted name is a word-prefix of, or null.
 *
 * A grant that matches exactly one candidate at a word boundary adopts it;
 * zero or several return null, so the caller mints what was printed rather than
 * guess between two languages.
 *
 * @param {string} name       the granted name
 * @param {string[]} names    candidate names
 * @param {(name: string) => any} [pick] maps the winning name to a result
 */
export function wordPrefixMatch(name, names, pick = (n) => n) {
  const key = String(name ?? "").toLowerCase();
  if (!key) return null;
  const hits = (names ?? []).filter((n) => {
    const cand = String(n ?? "").toLowerCase();
    return cand.startsWith(key) && (cand.length === key.length || cand[key.length] === " ");
  });
  return hits.length === 1 ? pick(hits[0]) : null;
}

/** The name a granted entry should end up displaying. */
const displayName = (entry, doc) => doc?.name ?? String(entry ?? "").trim();

/**
 * The language item on this actor for a named tongue, creating it from the
 * best source available if the actor does not have it yet.
 *
 * Idempotent by name: an already-held tongue is returned, never copied.
 *
 * @returns {Promise<{item: Item|null, created: boolean}>}
 */
export async function ensureLanguage(actor, entry) {
  const source = await resolveLanguage(entry);
  const name = displayName(entry, source);
  if (!actor || !name) return { item: null, created: false };

  const key = name.toLowerCase();
  const have = actor.items.find((i) => i.type === LANGUAGE_TYPE && i.name.toLowerCase() === key);
  if (have) return { item: have, created: false };

  // The found document is carried across whole, description and art included.
  const data = source ? source.toObject() : { name, type: LANGUAGE_TYPE };
  delete data._id;
  delete data.folder;
  data.name = name;
  data.type = LANGUAGE_TYPE;

  const [made] = await actor.createEmbeddedDocuments("Item", [data]);
  return { item: made ?? null, created: !!made };
}

/* ------------------------------------------------------------------ */
/*  The open-slot carrier                                              */
/* ------------------------------------------------------------------ */

/** The slot record on an ability item: how many are owed, and what spent them. */
export const slotsOf = (item) => {
  const flag = item?.getFlag?.(MODULE_ID, SLOT_FLAG) ?? item?.flags?.[MODULE_ID]?.[SLOT_FLAG];
  if (!flag) return null;
  return {
    capacity: Math.max(0, Number(flag.capacity) || 0),
    filled: (flag.filled ?? []).map((id) => String(id)).filter(Boolean),
    source: flag.source ?? "open",
  };
};

/** Is this item a language-slot carrier? */
export const isLanguageSlots = (item) => slotsOf(item) !== null;

/**
 * The language documents this carrier's slots were spent on, live.
 *
 * A recorded id whose document is gone is absent, which frees its slot.
 */
export function filledLanguages(item) {
  const s = slotsOf(item);
  const actor = item?.parent;
  if (!s || !actor?.items) return [];
  return s.filled.map((id) => actor.items.get(id)).filter((i) => i && i.type === LANGUAGE_TYPE);
}

/** Room left in a carrier. */
export function freeSlots(item) {
  const s = slotsOf(item);
  return s ? Math.max(0, s.capacity - filledLanguages(item).length) : 0;
}

/**
 * Spend one slot on a language: the tongue becomes a document on the carrier's
 * actor, and the carrier remembers that this slot paid for it.
 *
 * A full carrier refuses, and a tongue the character already speaks is not
 * learned twice.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function fillSlot(item, { name, uuid = "" } = {}) {
  const s = slotsOf(item);
  if (!s) return { ok: false, reason: "notACarrier" };
  const actor = item.parent;
  // A carrier sitting in the world sidebar has no one to teach.
  if (!actor?.items) return { ok: false, reason: "noActor" };

  const entry = uuid ? `uuid:${uuid}` : String(name ?? "").trim();
  if (!entry) return { ok: false, reason: "unnamed" };
  if (freeSlots(item) <= 0) return { ok: false, reason: "full" };

  const { item: lang, created } = await ensureLanguage(actor, entry);
  if (!lang) return { ok: false, reason: "unnamed" };
  // Already spoken — from a grant, or from another slot. Nothing is spent.
  if (!created) return { ok: false, reason: "duplicate" };

  await item.setFlag(MODULE_ID, SLOT_FLAG, { ...s, filled: [...s.filled, lang.id] });
  return { ok: true };
}

/**
 * Empty one slot again. The language document is deleted with it.
 */
export async function clearSlot(item, index) {
  const s = slotsOf(item);
  const live = filledLanguages(item);
  if (!s || !(index >= 0 && index < live.length)) return { ok: false };
  const doc = live[index];
  await doc.delete();
  await item.setFlag(MODULE_ID, SLOT_FLAG, { ...s, filled: s.filled.filter((id) => id !== doc.id) });
  return { ok: true };
}

/**
 * Give a character the tongues their class and race owe them, and the empty
 * slots their Intellect buys.
 *
 * Re-applying refreshes: a tongue already spoken is left alone, and an existing
 * carrier has its capacity updated with its choices kept. Capacity never
 * shrinks below what is spent.
 *
 * @param {Actor} actor
 * @param {Item} classItem
 * @param {Array<{ref: string|null, name: string}>} [log] the caller's receipt;
 *   entries take the shape `grantAbility` pushes, since callers print `.name`.
 */
export async function grantLanguages(actor, classItem, log = []) {
  const { raceForClass } = await import("./builder.mjs");
  const race = raceForClass(classItem);
  const grant = languageGrant({
    intMod: abilityMod(actor, "int"),
    classLanguages: classItem?.system?.languages ?? null,
    raceLanguages: race?.system?.languages ?? null,
    fromAbilities: languagesFromAbilities(actor),
  });

  // What the class and race grant outright becomes documents.
  for (const entry of grant.granted) {
    const { item, created } = await ensureLanguage(actor, entry);
    if (created && item) log.push({ ref: null, name: item.name });
  }

  await refreshOpenSlots(actor, grant, log);
  return grant;
}

/**
 * Bring the character's one open-slot carrier up to what they are owed.
 */
async function refreshOpenSlots(actor, grant, log) {
  const existing = actor.items.find((i) => i.type === "ability" && isLanguageSlots(i));

  if (!existing) {
    if (grant.openSlots <= 0) return;
    await actor.createEmbeddedDocuments("Item", [openCarrierData(grant.openSlots)]);
    log.push({
      ref: null,
      name: `${game.i18n.localize("ACKS-CLASSES.languages.openName")} ×${grant.openSlots}`,
    });
    return;
  }

  const now = slotsOf(existing);
  const spent = filledLanguages(existing).length;
  const capacity = Math.max(grant.openSlots, spent);
  if (capacity === now.capacity) return;
  await existing.setFlag(MODULE_ID, SLOT_FLAG, { ...now, capacity });
  log.push({ ref: null, name: `${existing.name} → ${spent}/${capacity}` });
}

/**
 * The open-slot carrier as ability data, ready to create. The grant path is
 * the one place that writes an actor's items.
 */
export function openCarrierData(openSlots) {
  return {
    name: game.i18n.localize("ACKS-CLASSES.languages.openName"),
    type: "ability",
    img: "icons/svg/book.svg",
    system: { description: game.i18n.localize("ACKS-CLASSES.languages.openHint") },
    flags: {
      [MODULE_ID]: {
        extras: { category: "language" },
        [SLOT_FLAG]: { capacity: openSlots, filled: [], source: "open" },
      },
    },
  };
}
