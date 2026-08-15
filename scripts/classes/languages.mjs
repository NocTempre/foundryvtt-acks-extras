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
 * WHICH languages exist is SETTING-DEFINED and never shipped: the Auran
 * Empire's are a campaign's answer, not the rules'. They arrive as language
 * abilities from the GM's own books through acks-importer, or a Judge writes
 * their own. This module only ever counts slots and fills them with whatever
 * documents the world holds.
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

/** The flag an ability carries when it IS a set of language slots. */
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

/** The slot record on an ability item: capacity, and what fills it. */
export const slotsOf = (item) => {
  const flag = item?.getFlag?.(MODULE_ID, SLOT_FLAG) ?? item?.flags?.[MODULE_ID]?.[SLOT_FLAG];
  if (!flag) return null;
  return {
    capacity: Math.max(0, Number(flag.capacity) || 0),
    entries: (flag.entries ?? []).map((e) => ({ name: String(e?.name ?? ""), uuid: e?.uuid ?? "" })),
    source: flag.source ?? "",
  };
};

/** Is this item a language-slot carrier? */
export const isLanguageSlots = (item) => slotsOf(item) !== null;

/** Room left in a carrier. */
export function freeSlots(item) {
  const s = slotsOf(item);
  return s ? Math.max(0, s.capacity - s.entries.length) : 0;
}

/**
 * Put a language in a slot. Idempotent per language: a tongue already in the
 * carrier is not learned twice, and a full carrier refuses rather than
 * silently dropping the pick.
 * @returns {{ok: boolean, reason?: string}}
 */
export async function fillSlot(item, { name, uuid = "" } = {}) {
  const s = slotsOf(item);
  if (!s) return { ok: false, reason: "notACarrier" };
  const label = String(name ?? "").trim();
  if (!label) return { ok: false, reason: "unnamed" };
  if (s.entries.some((e) => e.name.toLowerCase() === label.toLowerCase())) {
    return { ok: false, reason: "duplicate" };
  }
  if (s.entries.length >= s.capacity) return { ok: false, reason: "full" };
  await item.setFlag(MODULE_ID, SLOT_FLAG, { ...s, entries: [...s.entries, { name: label, uuid }] });
  return { ok: true };
}

/** Empty one slot again — a tongue recorded by mistake, or a Judge's change. */
export async function clearSlot(item, index) {
  const s = slotsOf(item);
  if (!s || !(index >= 0 && index < s.entries.length)) return { ok: false };
  const entries = s.entries.slice();
  entries.splice(index, 1);
  await item.setFlag(MODULE_ID, SLOT_FLAG, { ...s, entries });
  return { ok: true };
}

/**
 * Give a character the tongues their class and race owe them, and the empty
 * slots their Intellect buys.
 *
 * REFRESHES rather than duplicates. Applying a class again — the family's
 * repair path for everything else — must not leave two "Tongues": an existing
 * carrier has its capacity and granted list brought up to date, and every
 * entry a player already chose is KEPT. A character whose Intellect rose
 * gains the slots they are now owed; one whose granted list grew gains the
 * tongue without losing what they filled.
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

  const creates = [];
  for (const data of carrierData(grant)) {
    const source = data.flags[MODULE_ID][SLOT_FLAG].source;
    const existing = actor.items.find(
      (i) => i.type === "ability" && (i.getFlag(MODULE_ID, SLOT_FLAG)?.source ?? null) === source,
    );
    if (!existing) {
      creates.push(data);
      const n = data.flags[MODULE_ID][SLOT_FLAG].capacity;
      log.push({
        ref: null,
        name: source === "granted" ? `${data.name} (${grant.granted.join(", ")})` : `${data.name} ×${n}`,
      });
      continue;
    }
    const now = slotsOf(existing);
    const wanted = data.flags[MODULE_ID][SLOT_FLAG];
    // Keep every filled entry; add any newly-granted tongue that is missing.
    const kept = now.entries.slice();
    for (const entry of wanted.entries) {
      if (!kept.some((e) => e.name.toLowerCase() === entry.name.toLowerCase())) kept.push(entry);
    }
    const capacity = Math.max(wanted.capacity, kept.length);
    if (capacity !== now.capacity || kept.length !== now.entries.length) {
      await existing.setFlag(MODULE_ID, SLOT_FLAG, { ...now, capacity, entries: kept, source });
      log.push({ ref: null, name: `${existing.name} → ${kept.length}/${capacity}` });
    }
  }
  if (creates.length) await actor.createEmbeddedDocuments("Item", creates);
  return grant;
}

/**
 * The two carriers a character is owed, as ability data ready to create or
 * update: the tongues their class and race simply KNOW, and the open slots
 * their Intellect (and any class or racial allowance) lets them fill.
 *
 * Returned as data rather than written here so the grant path stays the one
 * place that touches an actor's items.
 */
export function carrierData(grant) {
  const carriers = [];
  if (grant.granted.length) {
    carriers.push({
      name: game.i18n.localize("ACKS-CLASSES.languages.knownName"),
      type: "ability",
      img: "icons/svg/book.svg",
      system: { description: game.i18n.localize("ACKS-CLASSES.languages.knownHint") },
      flags: {
        [MODULE_ID]: {
          extras: { category: "language" },
          [SLOT_FLAG]: {
            capacity: grant.granted.length,
            entries: grant.granted.map((name) => ({ name, uuid: "" })),
            source: "granted",
          },
        },
      },
    });
  }
  if (grant.openSlots > 0) {
    carriers.push({
      name: game.i18n.localize("ACKS-CLASSES.languages.openName"),
      type: "ability",
      img: "icons/svg/book.svg",
      system: { description: game.i18n.localize("ACKS-CLASSES.languages.openHint") },
      flags: {
        [MODULE_ID]: {
          extras: { category: "language" },
          [SLOT_FLAG]: { capacity: grant.openSlots, entries: [], source: "open" },
        },
      },
    });
  }
  return carriers;
}
