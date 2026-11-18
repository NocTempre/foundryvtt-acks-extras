/**
 * The castable-spell register: ONE answer to "what can this character cast,
 * and what would a cast on itself write on it". Nothing here knows a spell's
 * rows or a tradition's pools; those belong to the providers.
 *
 * A SOURCE (`registerSpellSource`) is a kind of place a character gets a spell
 * from: magic's repertoire registers one, magic items' scrolls and a
 * monster's spell-like abilities register theirs. It answers what it holds
 * for an actor. The REACH (`registerSpellReach`) has one owner, magic, and
 * decides what a cast of one of those spells writes on its caster. The
 * register merges one spell seen through two sources, asks the reach once per
 * merged spell, and hands readers the result: `castableSpells` for a sheet,
 * `availableRollMods` for `recordParts`' `entries` option, so an available
 * grant is narrowed, tested and stacked exactly as a recorded one is.
 *
 * Nothing reads a seat: `viewer` is passed to a source, which decides what a
 * non-GM viewer may be told (an unidentified scroll names no spell).
 * Foundry-free.
 */
import { MODULE_ID } from "./constants.mjs";
import { cookbookId } from "./library.mjs";
import { actorAlignment } from "./actor-read.mjs";

/** A name's folded form for matching: lower case, letters and digits only. */
export const foldName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The verdicts a source gives of whether a spell can be cast now, best first. */
export const SPELL_CAPACITY = Object.freeze({ ok: "ok", unknown: "unknown", none: "none" });

/** How much a capacity is worth when two sources see one spell: the better one speaks for the spell. */
const CAPACITY_RANK = Object.freeze({ ok: 2, unknown: 1, none: 0 });

/**
 * The identity of a spell, in the order a row names it: the cookbook id (the
 * copy's own, else its library twin's), then the uuids (its own, the compendium
 * document it was copied from, the twin's), then the folded name.
 *
 * @param {object} spell
 * @param {object|null} [twin]  the library document the spell is a copy of, where the caller has read it
 * @returns {{cookbookId: string, uuid: string, uuids: string[], name: string, key: string}}
 *   `name` is the spell's own, `key` its folded form
 */
export function spellRefOf(spell, twin = null) {
  const uuids = [spell?.uuid, spell?._stats?.compendiumSource, twin?.uuid].map((u) => String(u ?? "")).filter(Boolean);
  return {
    cookbookId: cookbookId(spell) || cookbookId(twin),
    uuid: String(spell?.uuid ?? ""),
    uuids: [...new Set(uuids)],
    name: String(spell?.name ?? ""),
    key: foldName(spell?.name),
  };
}

/** Whether two refs are one spell, by the same order a row names one: cookbook id, else uuid, else folded name. */
function sameSpell(a, b) {
  if (a.cookbookId && b.cookbookId) return a.cookbookId === b.cookbookId;
  if (a.uuids.length && b.uuids.length) return a.uuids.some((u) => b.uuids.includes(u));
  return Boolean(a.key) && a.key === b.key;
}

/* -------------------------------------------- */
/*  The registry                                 */
/* -------------------------------------------- */

const sources = new Map();
let reach = null;

/** A provider's call, with a throw reported and its answer left out. */
function attempt(what, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.error(`${MODULE_ID} | a spell ${what} failed; it is left out`, err);
    return fallback;
  }
}

/**
 * Register a kind of place a character gets spells from. `source(actor,
 * {viewer, call})` answers `[{spell, itemId, casterLevel, capacity, cite?,
 * twin?}]`: `spell` the document, `itemId` the item that holds it,
 * `casterLevel` `{value, source, parts}` or null where none resolves,
 * `capacity` `"ok"`, `"none"` or `"unknown"` (what a cast would find now), `cite`
 * the spell's page reference and `twin` its library document where the source
 * has read it. `call` is one object shared by every source and the reach for the
 * duration of one `castableSpells` call, for a provider's per-call scratch.
 * Registering a kind again replaces its source. A source that throws is
 * reported and contributes nothing. Returns the function that removes it.
 *
 * @param {string} kind
 * @param {(actor: object, options: {viewer: object|null, call: object}) => object[]} source
 * @returns {() => void}
 */
export function registerSpellSource(kind, source) {
  if (!kind || typeof source !== "function") return () => {};
  sources.set(kind, source);
  return () => {
    if (sources.get(kind) === source) sources.delete(kind);
  };
}

/**
 * Register the reach: what a cast of an entry would write on its own caster.
 * `reach(actor, entry, call)` answers `{onSelf, selfParts}`: `onSelf` true where
 * a cast lands on the caster, false where it does not and null where that cannot
 * be told, and `selfParts` the lib roll-mod parts that cast would write there,
 * `[]` where none. The register has one reach; registering again replaces it.
 * Returns the function that removes it.
 *
 * @param {(actor: object, entry: object, call: object) => {onSelf: boolean|null, selfParts: object[]}} fn
 * @returns {() => void}
 */
export function registerSpellReach(fn) {
  if (typeof fn !== "function") return () => {};
  reach = fn;
  return () => {
    if (reach === fn) reach = null;
  };
}

/** A capacity word the register knows, else `unknown`. */
const capacityOf = (value) => (value in CAPACITY_RANK ? value : SPELL_CAPACITY.unknown);

/**
 * Every spell the actor can cast, from every registered source, one entry per
 * spell. A spell two sources both hold is one entry: the source with the better
 * capacity speaks for it (the first registered on a tie) and the others are
 * named in `sources`. Each entry's reach is asked once, of the entry that
 * speaks, at that source's caster level.
 *
 * `capacity` is `"none"` where the actor knows the spell and has nothing left
 * to cast it with; the entry is kept, since the spell is castable again once a
 * slot returns. A spell the actor cannot cast at all is never returned: its
 * source leaves it out.
 *
 * @param {object} actor
 * @param {object} [options]
 * @param {object|null} [options.viewer]  who is asking; a source decides what that seat may be told
 * @param {string[]} [options.kinds]  only these sources
 * @returns {Array<{key: string, spellRef: {cookbookId: string, uuid: string, name: string}, source: string, sources: string[], itemId: string|null, casterLevel: object|null, capacity: string, cite: string, onSelf: boolean|null, selfParts: object[]}>}
 */
export function castableSpells(actor, { viewer = null, kinds = null } = {}) {
  const call = {};
  const groups = [];
  for (const [kind, source] of sources) {
    if (kinds && !kinds.includes(kind)) continue;
    const answered = attempt(`source (${kind})`, () => source(actor, { viewer, call }), []);
    for (const raw of Array.isArray(answered) ? answered : []) {
      if (!raw?.spell) continue;
      const ref = spellRefOf(raw.spell, raw.twin ?? null);
      const entry = {
        kind,
        ref,
        spell: raw.spell,
        itemId: raw.itemId ?? null,
        casterLevel: raw.casterLevel ?? null,
        capacity: capacityOf(raw.capacity),
        cite: String(raw.cite ?? ""),
      };
      const group = groups.find((g) => sameSpell(g.ref, ref));
      if (group) group.members.push(entry);
      else groups.push({ ref, members: [entry] });
    }
  }
  return groups.map(({ members }) => {
    const winner = members.reduce((best, m) => (CAPACITY_RANK[m.capacity] > CAPACITY_RANK[best.capacity] ? m : best));
    const asked = reach
      ? attempt("reach", () => reach(actor, { spell: winner.spell, itemId: winner.itemId, casterLevel: winner.casterLevel, capacity: winner.capacity, source: winner.kind, cite: winner.cite }, call), null)
      : null;
    const onSelf = asked?.onSelf === true ? true : asked?.onSelf === false ? false : null;
    return {
      key: winner.ref.cookbookId || winner.ref.uuid || winner.ref.key,
      spellRef: { cookbookId: winner.ref.cookbookId, uuid: winner.ref.uuid, name: winner.ref.name },
      source: winner.kind,
      sources: [...new Set(members.map((m) => m.kind))],
      itemId: winner.itemId,
      casterLevel: winner.casterLevel,
      capacity: winner.capacity,
      cite: winner.cite,
      onSelf,
      selfParts: onSelf === true && Array.isArray(asked?.selfParts) ? asked.selfParts : [],
    };
  });
}

/**
 * The parts a cast on itself would write on the actor, for every castable spell
 * that lands there, in `rollModsOf`'s entry shape (`effect` null, since no
 * record exists) with the `source` kind added. Hand it to `recordParts` as
 * `entries` after the recorded ones: a record that exists wins a tie, and an
 * available part never displaces one.
 *
 * @param {object} actor
 * @param {{viewer?: object|null, kinds?: string[]}} [options]
 * @returns {Array<{effect: null, id: string|null, label: string, cite: string, sourceAlignment: string|null, part: object, source: string}>}
 */
export function availableRollMods(actor, { viewer = null, kinds = null } = {}) {
  const sourceAlignment = actorAlignment(actor) || null;
  return castableSpells(actor, { viewer, kinds })
    .filter((entry) => entry.onSelf === true)
    .flatMap((entry) =>
      entry.selfParts.map((part) => ({
        effect: null,
        id: entry.spellRef.cookbookId || null,
        label: entry.spellRef.name,
        cite: entry.cite,
        sourceAlignment,
        part,
        source: entry.source,
      })),
    );
}
