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

/** "kw:sensingevil" -> "Sensing Evil"-ish, for the system's requirements field. */
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
 * pack when it is installed, else `icon` from core. Referencing those paths
 * carries no licensing weight here — the art ships in that module under its
 * own terms, and nothing is copied. An item's img is set at creation and
 * never rewritten afterwards; Update Abilities leaves presentation alone, so
 * installing the pack later repaints only what is imported after it.
 */
export function abilityIcon(entry) {
  if (entry?.iconNiche && game.modules?.get?.(NICHE_ICON_MODULE)?.active) return entry.iconNiche;
  // Falls back to the generic book, so an entry nobody has picked an icon for
  // looks exactly as it did before rather than breaking.
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
  // An alias is a DISTINCT ability that shares another entry's rules text, not a
  // redirect to it. Two names for one capability do not stack, so the relation
  // ships as a real effect rather than a note the reader has to interpret.
  const aliasEffects = meta.notStacksWith?.length
    ? [{ type: "capability", ref: entry.aliasOf ?? meta.notStacksWith[0], notStacksWith: meta.notStacksWith }]
    : [];
  const extras = {
    category: abilityCategory(meta.category),
    general: !!meta.general,
    repeatable: !!meta.repeatable,
    // A retired entry is still imported — an older or converted source may name
    // it — but carries the flag and a pointer at whatever superseded it.
    deprecated: !!meta.deprecated,
    ...(meta.replacedBy ? { replacedBy: meta.replacedBy } : {}),
    // The build cost is READ FROM THE SEAT'S BOOK, never shipped — so it is
    // present only once someone with the book imports or updates, like every
    // other value. `meta.powerValue` remains only as the inherited value an
    // alias takes from its target.
    ...(node?.fields?.powerValue != null
      ? { powerValue: node.fields.powerValue }
      : meta.powerValue != null
        ? { powerValue: meta.powerValue }
        : {}),
    ...(meta.requires ? { requires: meta.requires } : {}),
    ...(entry.aliasOf ? { aliasOf: entry.aliasOf } : {}),
    // Capabilities this ability confers, so a prerequisite written against a
    // capability resolves no matter which of the same-capability entries the
    // character actually holds.
    ...(meta.provides?.length ? { provides: meta.provides } : {}),
    // Scan-classified mechanics still bind, but present as unverified until the
    // register entry gains its `audited` sign-off. Written EXPLICITLY either
    // way, never omitted: update() merges flags, so an omitted `false` would
    // leave a stale `true` once an entry is signed off.
    unaudited: !entry.audited,
    // Which reader produced `effects`: a register recipe ("recipe") or the
    // vocabulary scan ("scan"). Applied modifiers mark a scan's as unverified
    // (lib/typed-modifiers.mjs isUnverified). Written explicitly either way,
    // for the same merge reason as `unaudited`.
    effectsFrom: effectsOriginOf(entry),
    // Set when this reference arrived under an older/foreign name: the reader's
    // source calls it `conversionFrom`, ACKS II calls it `entry.name`.
    ...(opts.conversionStatus ? { conversionStatus: opts.conversionStatus } : {}),
    ...(opts.conversionFrom ? { conversionFrom: opts.conversionFrom } : {}),
    // Structured effects are CLASSIFIED from the seat's own prose (type, target
    // and value all materialize; the cookbook pre-declares none of them). An
    // alias reads the TARGET's prose through its pre-baked pointer. A
    // chef-authored spec with no `from` locator is pure structure (a
    // prerequisite, a companion slot) and applies without the book; anything
    // pointing at a number still waits for it.
    effects: [...aliasEffects, ...(node?.fields?.effects ?? materializeEffects(entry.fields?.effects?.specs, [])), ...limitRowsFor(entry.name, id)],
    // `rolls` is assembled below and assigned onto this same object, once the
    // throws are classified.
    // Materialized from the seat's OWN prose via the executor's vocabulary
    // scan — nothing about which is shipped.
    ...(node?.fields?.defenses ? { defenses: node.fields.defenses } : {}),
  };
  // EVERY throw the extract classified becomes a roll, not just the first. The
  // recipe's own `rolls` wins when present; otherwise the classified `throw`
  // effects are lifted in order. Ladders are carried WHOLE, resolved by
  // the abilities feature at render time rather than flattened here.
  // These go to the abilities flag and NOT to `system.roll` /
  // `system.rollTarget`: the core item can hold exactly one roll, so writing
  // there too would mean two stores for the same thing.
  // The abilities feature owns ability rolls and folds core's fields in on read
  // for items it has not written.
  // Throws from a class's published TABLE lead the list: the books
  // cross-reference the table first and roll whatever follows second.
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
          // The FRACTION of level, and which way it rounds, are printed beside
          // the rule; a spec that locates neither reads the table at the whole
          // level, which is what an unqualified power does.
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
      // `requirements` is plain descriptive text with no second store behind
      // it, so it still lands on the core field the sheet already shows.
      ...(gate.length ? { requirements: gate.map(capabilityLabel).join(", ").slice(0, 120) } : {}),
    },
    flags: {
      [MODULE_ID]: { cookbook: { id, cite, ...bookStamp(entry.book) }, minted: true, extras },
    },
  };
}

/**
 * The extras subkeys bindAbility emits only when the definition carries them —
 * the conditional spreads above, kept in one list because an UPDATE must
 * retract them: update() merges nested objects and never deletes an absent
 * key, so a rebuild that no longer emits one of these (an entry un-deprecated,
 * a prerequisite dropped) has to say so with an explicit forced deletion (`unset()`) or the
 * stale value survives every later run.
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
 *
 * Async because the pack has to be loaded; `game.items` alone would leave an
 * empty library for Update to walk. Actors stay a world read: a character is
 * not an import.
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
 * register — the printed name and the definition's own name are not always
 * the same name. A name several definitions answer to resolves to NOTHING
 * rather than a guess. Built once and memoised on the register.
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
 * again with a trailing throw value stripped: a stat block writes its
 * proficiencies as "climbing 6+", which is the same proficiency as "Climbing"
 * with its target number attached. Without this, every monster-embedded
 * proficiency fails to match and never gets adopted.
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
 * Folded name -> every definition id printing that name.
 *
 * The books reuse names across categories: 14 of them, "Alertness" and
 * "Climbing" among them, are both a proficiency and a class power. A name is
 * therefore only a guess at identity, and the index keeps ALL the candidates so
 * the caller can choose deliberately instead of silently taking the first.
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
 * Definition id -> the item already standing for it.
 *
 * Doubles as the "which definitions does this world hold" signal that settles a
 * name collision without guessing. First one wins: duplicates are a world the
 * GM built by hand, and picking the earliest is at least stable across runs.
 *
 * SYNCHRONOUS, so it can only see a compendium library through the warm
 * `importedIndex()` cache — `bindMonster` is sync and calls this, and making it
 * async would thread a promise through the whole monster bind. Async callers
 * should `await importedIndex()` (below) instead; this form falls back to the
 * world so a cold session still resolves whatever is loose there.
 */
export function loadedAbilityIndex() {
  if (importedCache) return importedCache;
  const byId = new Map();
  for (const item of game.items) {
    // Never a template skin: it carries the id of the definition it was copied
    // from, and answering with one hands a monster a class's engraved silver
    // waterskin in place of the shared item.
    if (item.flags?.[MODULE_ID]?.templatePart) continue;
    const id = item.getFlag(MODULE_ID, "cookbook")?.id;
    if (id && !byId.has(id)) byId.set(id, item);
  }
  return byId;
}

/**
 * Pick among same-named definitions.
 *
 * A collision stops being a guess when only ONE of the candidates is actually
 * available — a world that imported the proficiency list but not the powers has
 * already answered the question. So candidates present in the world win outright,
 * and only when that leaves the choice open (none present, or several) does the
 * category preference apply: a stat block's proficiency list and a hand-made
 * ability both far more often mean the PROFICIENCY than the same-named class
 * power. `ranked` reports a pick the category ranking settled; `ambiguous`
 * reports a real guess, a tie inside the best-ranked category.
 */
const CATEGORY_RANK = ["def.prof.", "def.skill.", "def.power.", "def.drawback."];
const categoryRank = (id) => {
  const i = CATEGORY_RANK.findIndex((p) => id.startsWith(p));
  return i === -1 ? CATEGORY_RANK.length : i;
};
/** The id whose category ranks first. */
export const byCategory = (ids) => [...ids].sort((a, b) => categoryRank(a) - categoryRank(b))[0];

/** Picks one id among same-name candidates, preferring one already present, then the best-ranked category, and flags whether the pick was ambiguous or ranked. */
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
