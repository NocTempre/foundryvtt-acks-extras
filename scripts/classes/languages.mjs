/* global game, foundry */
/**
 * Who speaks what (RR §I.10).
 *
 * THE AWARDS, as the book states them:
 *  - every character begins knowing their native language AND at least one
 *    more (for a human of the Empire: their homeland's tongue and Common);
 *  - a demi-human begins with its racial language, the local human tongue,
 *    and whatever else its race prints — so the class's list and the race's
 *    list ADD rather than replace;
 *  - an Intellect BONUS buys that many more, and they may be left OPEN, to be
 *    filled during play — which is why a slot is a real thing here and not
 *    just a number on a sheet;
 *  - an Intellect PENALTY means illiterate — a spoken tongue is still spoken,
 *    but nothing is read or written;
 *  - average Intellect and up reads and writes everything it speaks.
 *
 * A KNOWN TONGUE IS A DOCUMENT, never a string in a flag. The system owns the
 * `language` item type: it declares it, files it in its own section of the
 * character sheet, and reads it in the Polyglot provider it registers, whose
 * `getUserLanguages` scans an actor for `type === "language"` and sees nothing
 * else. Anything this module records privately is invisible to all of it, so
 * what a character speaks is written where the system already looks.
 *
 * WHAT STAYS OURS is the OPEN SLOT — "may still choose two more". The system
 * has no way to say that and the rules require it, so one carrier ability per
 * character holds the count and remembers which languages were chosen against
 * it. The documents remain the truth: a slot whose language has been deleted
 * off the sheet is free again, with nothing to reconcile.
 *
 * FIND BEFORE MINTING. A tongue named by a class, a race or a player is looked
 * for before it is built — on the actor, then among the world's languages,
 * then in the system's own compendium — so a character ends up holding the
 * world's document rather than a bare namesake of it.
 *
 * WHICH languages exist is SETTING-DEFINED and never shipped: the Auran
 * Empire's are a campaign's answer, not the rules'. They arrive from the GM's
 * own books through acks-importer, or a Judge writes their own. This module
 * only ever counts slots and fills them with whatever documents the world
 * holds.
 *
 * THE DESCENT TREE IS TRIVIA — but understanding an unknown tongue is NOT.
 * Appendix A prints a family tree of languages with their real-world
 * counterparts (Classical Auran → Common Auran, as Latin → Vulgate), and
 * nothing reads it: no rule anywhere grants partial comprehension of a parent
 * tongue or a bonus for a sibling, so a language may record its parent for
 * flavour and nothing here branches on it.
 *
 * What DOES let a character get sense out of a language they do not speak is
 * a power, not a relationship: **Deciphering** (JJ ch. 12) reads a page of
 * text — ciphers, treasure maps and DEAD LANGUAGES, never magical writing —
 * in one turn on a throw of 4+, and **Loremastery** (RR ch. 3) deciphers
 * occult runes at 18+ improving by level. Both are WRITTEN-word powers that a
 * character either has or lacks; neither is a slot, and neither cares which
 * tongue descends from which. They belong to the ability model like any other
 * power, so nothing about them lives here.
 */
import { MODULE_ID } from "./constants.mjs";
import { abilityMod } from "../lib/actor-read.mjs";

/** The system's item type for a language. */
export const LANGUAGE_TYPE = "language";

/** Where the system keeps its printed languages, for adoption. */
const SYSTEM_PACK = "acks.acks-languages";

/** The flag an ability carries when it IS a set of open language slots. */
export const SLOT_FLAG = "languageSlots";

/** Literacy states, in the order Intellect produces them. */
export const LITERACY = Object.freeze({
  ILLITERATE: "illiterate", // INT penalty
  LITERATE: "literate", // INT 9+
});

/**
 * How many tongues a character is owed and from where, given the documents
 * that grant them. Pure counting — the caller supplies the class and race
 * data, so this is testable without a world.
 *
 * @param {object} opts
 * @param {number} opts.intMod           the character's Intellect modifier
 * @param {object} [opts.classLanguages] `{granted: string[], count: number}`
 * @param {object} [opts.raceLanguages]  same shape, from the race document
 * @returns {{granted: string[], openSlots: number, fromInt: number,
 *            fromClass: number, fromRace: number, literacy: string}}
 */
export function languageGrant({ intMod = 0, classLanguages = null, raceLanguages = null } = {}) {
  const named = [...(classLanguages?.granted ?? []), ...(raceLanguages?.granted ?? [])]
    .map((n) => String(n).trim())
    .filter(Boolean);
  // Two sources may print the same tongue (a dwarven class and the dwarf race
  // both say Dwarven); a character does not learn it twice.
  const granted = [...new Set(named)];
  const fromClass = Number(classLanguages?.count) || 0;
  const fromRace = Number(raceLanguages?.count) || 0;
  // Only a BONUS buys languages. A penalty costs literacy, not tongues.
  const fromInt = Math.max(0, Number(intMod) || 0);
  return {
    granted,
    fromClass,
    fromRace,
    fromInt,
    openSlots: fromClass + fromRace + fromInt,
    literacy: (Number(intMod) || 0) < 0 ? LITERACY.ILLITERATE : LITERACY.LITERATE,
  };
}

/* ------------------------------------------------------------------ */
/*  Finding a language before building one                             */
/* ------------------------------------------------------------------ */

/** Every language document the world holds, newest lookup first by name. */
export function worldLanguages() {
  const seen = new Map();
  for (const item of game.items ?? []) {
    if (item.type !== LANGUAGE_TYPE) continue;
    const key = item.name.toLowerCase();
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The document a granted entry names, or null.
 *
 * A class or race records what the book PRINTS, and a Judge types into the
 * same field, so an entry may be a plain name or a ref (`uuid:…`, or an
 * importer cookbook id). Both are tried, then the world, then the system's own
 * compendium — the last so a world that has imported nothing still hands a
 * character the furnished document instead of a bare namesake.
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
    const byId = (game.items ?? []).find((i) => i.flags?.["acks-importer"]?.cookbook?.id === raw);
    if (byId) return byId;
  }

  const key = raw.toLowerCase();
  const worldLangs = (game.items ?? []).filter((i) => i.type === LANGUAGE_TYPE);
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
 * The book calls its own tongues by more than one length: the chargen chapter
 * and the class spreads grant "Common", and the taxonomy the same world
 * imported prints it in full. A grant that matches exactly one candidate at a
 * word boundary is that tongue and adopts it; anything ambiguous — zero or
 * two-plus candidates — returns null and lets the caller mint what was
 * actually printed, because guessing between two languages is how a character
 * ends up speaking the wrong one.
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
 * Idempotent by name: applying a class again, or filling a slot with something
 * already spoken, hands back what is already there rather than a second copy.
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

  // Carry the found document across whole — its description and its art are
  // the reason finding it beat minting one.
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
 * A recorded id whose document is gone is simply absent — a player who deletes
 * a language off the sheet gets the slot back, and no reconciliation pass has
 * to notice. The documents are the truth; this list only remembers which of
 * them came out of these slots.
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
 * A full carrier refuses rather than silently dropping the pick, and a tongue
 * the character already speaks is not learned twice.
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
 * Empty one slot again — a tongue recorded by mistake, or a Judge's change.
 * The document goes with it: the slot was what created it, and leaving an
 * orphan behind would keep the character speaking a language they just gave up.
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
 * REFRESHES rather than duplicates. Applying a class again — the family's
 * repair path for everything else — must not leave two carriers or two copies
 * of a tongue: a granted language the character already speaks is left alone,
 * and an existing carrier has its capacity brought up to date while every
 * choice already made against it is KEPT.
 *
 * Capacity never shrinks below what has already been spent. A character whose
 * Intellect fell does not un-learn a language they chose while it was high.
 *
 * @param {Actor} actor
 * @param {Item} classItem
 * @param {Array<{ref: string|null, name: string}>} [log] the receipt its caller
 *   is collecting. Entries are the SAME shape `grantAbility` pushes — both
 *   callers read `.name` off every line and print it, so a bare string arrives
 *   as "undefined" in the chat a player reads.
 */
export async function grantLanguages(actor, classItem, log = []) {
  const { raceForClass } = await import("./builder.mjs");
  const race = raceForClass(classItem);
  const grant = languageGrant({
    intMod: abilityMod(actor, "int"),
    classLanguages: classItem?.system?.languages ?? null,
    raceLanguages: race?.system?.languages ?? null,
  });

  // What the class and race simply KNOW becomes documents, because that is
  // what knowing a language is to the system and to everything reading it.
  for (const entry of grant.granted) {
    const { item, created } = await ensureLanguage(actor, entry);
    if (created && item) log.push({ ref: null, name: item.name });
  }

  await refreshOpenSlots(actor, grant, log);
  return grant;
}

/**
 * Bring the character's one open-slot carrier up to what they are owed.
 *
 * Only ever ONE carrier: the tongues a character was handed are documents now,
 * so the pair of carriers this model used to keep has nothing left to hold
 * apart.
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
 * The open-slot carrier as ability data, ready to create.
 *
 * Returned as data rather than written here so the grant path stays the one
 * place that touches an actor's items.
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
