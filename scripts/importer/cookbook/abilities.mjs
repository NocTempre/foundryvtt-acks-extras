/**
 * Cookbook runtime: binding an executor ability to its document, the ability name index, same-name reconciliation.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, ITEM_TYPE, DEFAULT_IMG } from "../constants.mjs";
import { entryText } from "../prose.mjs";
import { printedNameOf, printKey } from "../printed-name.mjs";
import { materializeEffects } from "../executor.mjs";
import { effectsOriginOf } from "../effects-origin.mjs";
import { slug, ABILITY_CATEGORIES } from "../../lib/vocab.mjs";
import { limitRowsFor } from "../../equipment/armour-limits.mjs";
import { bookStamp, data, warnedAmbiguous, abilityEntries } from "./state.mjs";
import { importedCache, importedDocs } from "./target.mjs";

/** A capability token ("kw:<name>") → the name of the ability it stands for, else the bare token; for the system's requirements field. */
const capabilityLabel = (token) => {
  const slug = String(token).replace(/^kw:/, "");
  for (const [id, e] of abilityEntries()) {
    if (id.split(".").slice(2).join("").toLowerCase() === slug) return e.name;
  }
  return slug;
};

/** The optional icon pack whose niche art beats core for several abilities. */
const NICHE_ICON_MODULE = "game-icons-net";

/**
 * Which picture this ability gets: `iconNiche` from the optional game-icons.net
 * pack when it is installed, else `icon` from core. An item's img is set at
 * creation and never rewritten by an update, so installing the pack later
 * repaints only what is imported after it.
 */
export function abilityIcon(entry) {
  if (entry?.iconNiche && game.modules?.get?.(NICHE_ICON_MODULE)?.active) return entry.iconNiche;
  // An entry with no icon takes the generic book.
  return entry?.icon || DEFAULT_IMG.ABILITY;
}

/**
 * `meta.category` lands in a CONSTRAINED choice field on the ability model.
 * This clamp stands behind the register lint for whatever it never saw, and
 * falls back to the model's own default so the item stays valid. See
 * docs/importer/DECISIONS.md, "A kind says what it binds to, and the lint
 * holds its categories to the vocabulary".
 */
function abilityCategory(value) {
  if (!value) return "proficiency";
  if (!(value in ABILITY_CATEGORIES)) {
    console.warn(`${MODULE_ID} | "${value}" is not an ability category; storing "proficiency".`);
    return "proficiency";
  }
  return value;
}

/** Binds an executed ability entry to its ability document data. */
export function bindAbility(entry, node, id, opts = {}) {
  const meta = entry.meta ?? {};
  const cite = entry.cite ?? "";
  // An alias is a distinct ability sharing another entry's text; the
  // not-stacking relation ships as a `capability` effect.
  const aliasEffects = meta.notStacksWith?.length
    ? [{ type: "capability", ref: entry.aliasOf ?? meta.notStacksWith[0], notStacksWith: meta.notStacksWith }]
    : [];
  const extras = {
    category: abilityCategory(meta.category),
    general: !!meta.general,
    repeatable: !!meta.repeatable,
    // A retired entry is still imported, flagged, with a pointer at its successor.
    deprecated: !!meta.deprecated,
    ...(meta.replacedBy ? { replacedBy: meta.replacedBy } : {}),
    // The build cost is read from the seat's book; `meta.powerValue` is only the
    // value an alias inherits from its target.
    ...(node?.fields?.powerValue != null
      ? { powerValue: node.fields.powerValue }
      : meta.powerValue != null
        ? { powerValue: meta.powerValue }
        : {}),
    ...(meta.requires ? { requires: meta.requires } : {}),
    ...(entry.aliasOf ? { aliasOf: entry.aliasOf } : {}),
    // Capabilities this ability confers, so a prerequisite written against a
    // capability resolves whichever same-capability entry the character holds.
    ...(meta.provides?.length ? { provides: meta.provides } : {}),
    // Scan-classified mechanics present as unverified until the entry gains its
    // `audited` sign-off. Written either way: update() merges flags, so an
    // omitted `false` would leave a stale `true`.
    unaudited: !entry.audited,
    // Which reader produced `effects`: a register recipe ("recipe") or the
    // vocabulary scan ("scan"); written either way, for the same merge reason.
    effectsFrom: effectsOriginOf(entry),
    // Set when the reference arrived under a converted name: the reader's source
    // calls it `conversionFrom`, ACKS II calls it `entry.name`.
    ...(opts.conversionStatus ? { conversionStatus: opts.conversionStatus } : {}),
    ...(opts.conversionFrom ? { conversionFrom: opts.conversionFrom } : {}),
    // Structured effects are classified from the seat's own prose; an alias
    // reads its target's prose. A spec with no `from` locator is pure structure
    // (a prerequisite, a companion slot) and applies without the book.
    effects: [...aliasEffects, ...(node?.fields?.effects ?? materializeEffects(entry.fields?.effects?.specs, [])), ...limitRowsFor(entry.name, id)],
    // `rolls` is assembled below and assigned onto this object.
    // Materialized from the seat's own prose by the executor's vocabulary scan.
    ...(node?.fields?.defenses ? { defenses: node.fields.defenses } : {}),
  };
  // Every throw the extract classified becomes a roll. The recipe's own `rolls`
  // win when present; otherwise the classified `throw` effects are lifted in
  // order, ladders carried whole for the abilities feature to resolve at render.
  // Rolls go to the abilities flag, never `system.roll` / `system.rollTarget`:
  // the abilities feature owns ability rolls and folds core's fields in on read.
  // Throws borrowed from a class's published table lead the list. See
  // docs/importer/DECISIONS.md, "A borrowed throw is a recipe, and a typed row names its mode".
  const fromLadders = (entry.fields?.rolls?.specs ?? []).filter((sp) => sp?.fromLadders);
  const borrowed = [];
  for (const sp of fromLadders) {
    for (const ladder of opts.ladders?.[sp.key ?? "ladders"] ?? []) {
      borrowed.push({
        key: `${sp.key ?? "t"}${ladder.key.replace(/[^A-Za-z0-9]/g, "")}`,
        label: ladder.label,
        formula: sp.formula ?? "1d20",
        rollType: sp.rollType ?? "above",
        scale: "level",
        target: {
          kind: "progression",
          as: sp.fromLadders.as,
          table: ladder.key,
          // The fraction of level and its rounding are located on the page; a spec
          // that locates neither reads the table at the whole level.
          ...(sp.fromLadders.atLevelNum ? { atLevelNum: sp.fromLadders.atLevelNum } : {}),
          ...(sp.fromLadders.atLevelDen ? { atLevelDen: sp.fromLadders.atLevelDen } : {}),
          ...(sp.fromLadders.round ? { round: sp.fromLadders.round } : {}),
        },
      });
    }
  }

  const gate = extras.effects.filter((e) => e.type === "requires").flatMap((e) => e.refs ?? []);
  const thrown = extras.effects.filter((e) => e.type === "throw");
  extras.rolls = [
    ...borrowed,
    ...(node?.fields?.rolls?.length
      ? node.fields.rolls
      : thrown.map((t, i) => ({
          key: t.key || `throw${i + 1}`,
          label: t.forWhat || "",
          formula: t.roll || "1d20",
          rollType: t.rollType || "above",
          target: t.value ?? { kind: "flat", flat: 0 },
          scale: t.value?.on || "level",
          condition: t.condition || "",
        }))),
  ];

  return {
    name: printedNameOf(node, entry.name),
    type: "ability",
    img: abilityIcon(entry),
    system: {
      description: entryText(node, id, cite),
      proficiencytype: meta.general ? "general" : "class",
      // `requirements` is plain text with no second store, so it lands on the core field.
      ...(gate.length ? { requirements: gate.map(capabilityLabel).join(", ").slice(0, 120) } : {}),
    },
    flags: {
      [MODULE_ID]: { cookbook: { id, cite, ...bookStamp(entry.book) }, minted: true, extras },
    },
  };
}

/**
 * The extras subkeys `bindAbility` emits only when the definition carries
 * them. An update must retract them explicitly (`unset()`): update() merges
 * nested objects and never deletes an absent key.
 */
export const ABILITY_EXTRAS_OPTIONAL = [
  "replacedBy",
  "powerValue",
  "requires",
  "aliasOf",
  "provides",
  "conversionStatus",
  "conversionFrom",
  "defenses",
];


/**
 * Every ability item the library holds — loose in the pack and on actors alike.
 * Async because the pack has to be loaded; actors stay a world read.
 */
export async function allAbilities() {
  const extrasOf = (doc) => doc.getFlag(MODULE_ID, "extras") ?? {};
  const out = [];
  for (const item of await importedDocs("Item")) {
    if (item.type === ITEM_TYPE.ABILITY) out.push({ doc: item, extras: extrasOf(item), on: null });
  }
  for (const actor of game.actors) {
    for (const item of actor.items) {
      if (item.type === ITEM_TYPE.ABILITY) out.push({ doc: item, extras: extrasOf(item), on: actor });
    }
  }
  return out;
}


/**
 * Folded printed name -> the definition it means, from the `powerSource`
 * register. A name several definitions answer to resolves to nothing. Built
 * once and memoised on the register.
 *
 * A row that withholds the printed name carries `nameKey`, the `printKey` of
 * it, instead: the row is then indexed under that key as well, in the same map
 * behind a `#` no folded name holds.
 * See docs/importer/DECISIONS.md, "The printed name and the defined name are two different names".
 */
function printedNameIndex() {
  if (data.registers?.__printedNames) return data.registers.__printedNames;
  const index = new Map();
  const ambiguous = new Set();
  for (const rows of Object.values(data.registers?.tables?.powerSource ?? {})) {
    for (const row of rows ?? []) {
      if (!row?.ref) continue;
      for (const key of [slug(row.name), row.nameKey ? `#${row.nameKey}` : ""]) {
        if (!key) continue;
        const seen = index.get(key);
        if (seen && seen !== row.ref) ambiguous.add(key);
        else index.set(key, row.ref);
      }
    }
  }
  for (const key of ambiguous) index.delete(key);
  if (data.registers) {
    Object.defineProperty(data.registers, "__printedNames", { value: index, enumerable: false });
  }
  return index;
}

/**
 * The definition id a printed power name means, or null when the register
 * does not name it (or names it ambiguously).
 *
 * The folded name is tried first, then its `printKey` against the rows that
 * carry a `nameKey`.
 *
 * @param {string} name the name as a class or race spread prints it
 * @returns {string|null} a `def.*` cookbook id
 */
export const refForPrintedName = (name) => {
  const index = printedNameIndex();
  const keyed = printKey(name);
  return index.get(slug(name)) ?? (keyed ? index.get(`#${keyed}`) : undefined) ?? null;
};

/**
 * Resolve an item name to a definition id. Tries the name as printed, then
 * again with a trailing throw value ("<name> N+") stripped, which is how a
 * stat block writes a proficiency.
 */
export function idForName(index, name, present) {
  let ids = index.get(slug(name));
  if (!ids) {
    const bare = String(name ?? "").replace(/\s*\d+\s*\+?\s*$/, "");
    ids = bare && bare !== name ? index.get(slug(bare)) : undefined;
  }
  if (!ids?.length) return null;
  return preferredId(ids, present);
}

/**
 * Folded name -> every definition id printing that name. The books reuse names
 * across categories, so the index keeps all the candidates for the caller to
 * choose among (`preferredId`).
 */
export function abilityNameIndex() {
  const index = new Map();
  const add = (name, id) => {
    const key = slug(name);
    if (!key) return;
    const list = index.get(key) ?? index.set(key, []).get(key);
    if (!list.includes(id)) list.push(id);
  };
  for (const [id, e] of abilityEntries()) {
    add(e.name, id);
    for (const a of e.aliases ?? []) add(a, id);
  }
  return index;
}

/**
 * Definition id -> the item already standing for it; the first one wins.
 * Settles a name collision by which definitions this world holds.
 *
 * Synchronous (`bindMonster` calls it), so it sees a compendium library only
 * through the warm `importedIndex()` cache and otherwise falls back to the
 * world. Async callers should `await importedIndex()` instead.
 */
export function loadedAbilityIndex() {
  if (importedCache) return importedCache;
  const byId = new Map();
  for (const item of game.items) {
    // Never a template skin: it carries the id of the definition it was copied from.
    if (item.flags?.[MODULE_ID]?.templatePart) continue;
    const id = item.getFlag(MODULE_ID, "cookbook")?.id;
    if (id && !byId.has(id)) byId.set(id, item);
  }
  return byId;
}

/** Category prefixes in preference order for same-name candidates: a proficiency beats a same-named class power. */
const CATEGORY_RANK = ["def.prof.", "def.skill.", "def.power.", "def.drawback."];
const categoryRank = (id) => {
  const i = CATEGORY_RANK.findIndex((p) => id.startsWith(p));
  return i === -1 ? CATEGORY_RANK.length : i;
};
/** The id whose category ranks first. */
export const byCategory = (ids) => [...ids].sort((a, b) => categoryRank(a) - categoryRank(b))[0];

/**
 * Picks one id among same-named definitions. A candidate present in the world
 * wins outright; only when that leaves the choice open does the category
 * ranking apply. `ranked` reports a pick the ranking settled; `ambiguous`
 * reports a tie inside the best-ranked category.
 */
export function preferredId(ids, present) {
  if (ids.length === 1) return { id: ids[0], ambiguous: false, ranked: false };
  const here = ids.filter((id) => present.has(id));
  if (here.length === 1) return { id: here[0], ambiguous: false, ranked: false };
  const pool = here.length ? here : ids;
  const best = Math.min(...pool.map(categoryRank));
  const top = pool.filter((id) => categoryRank(id) === best);
  return { id: top[0], ambiguous: top.length > 1, ranked: top.length === 1 };
}

/**
 * Report how a printed name was resolved when resolving it was a choice, once
 * per name and pick in a session: a guess warns, a pick the category ranking
 * settled logs at debug.
 */
export function reportGuess(text, guess) {
  if (!guess?.ambiguous && !guess?.ranked) return;
  const key = `${text}>${guess.id}`;
  if (warnedAmbiguous.has(key)) return;
  warnedAmbiguous.add(key);
  if (guess.ambiguous) console.warn(`${MODULE_ID} | "${text}" matches several definitions; adopted ${guess.id}.`);
  else console.debug(`${MODULE_ID} | "${text}" names definitions in several categories; ranked to ${guess.id}.`);
}
