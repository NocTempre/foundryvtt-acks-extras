/**
 * Shared ACKS vocabulary — the family's canonical enums + the LevelValue
 * resolver. FOUNDRY-FREE and Node-importable (no `foundry.*`): offline tooling
 * (the importer's cookbook compiler/executor) imports this the same as the
 * Foundry runtime does. DataModel field-builders that consume these live in
 * `fields.mjs` (Foundry-only).
 *
 * The single source for the damage / movement / travel / vision / sense /
 * natural-weapon enums and for alignment; the monsters feature re-exports them
 * from its own `config.mjs` (formation's `travel.mjs` does the same for
 * `TRAVEL_MODES`) and nothing defines a second copy. `NATURAL_WEAPONS` is the
 * superset, carrying the monster sheet's extra entries. The ability-effect
 * enums are the shared target the abilities and monsters effect models build
 * from.
 */

// Pure modules only, so this file stays Node-importable.
import { getDoc, hasDoc } from "./tables.mjs";
import { cookbookId } from "./library.mjs";
import { CONDITIONS } from "./conditions.mjs";

// The magic families live in their own Foundry-free file, re-exported here.
export * from "./magic-vocab.mjs";

/** `{ key: { label, … } }` → `{ key: label }` for DataModel `choices`. */
export const choicesOf = (enumObj) =>
  Object.fromEntries(Object.entries(enumObj).map(([k, v]) => [k, v?.label ?? k]));

/**
 * Fold a name/key to a lowercase alphanumeric slug for MATCHING: `String(x)`
 * lowercased with every non-alphanumeric removed, so two human-written names
 * compare equal regardless of case, spacing or punctuation. Foundry-free.
 */
export const slug = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every way one printed item name can be written; the one reader of the
 * catalogue's name forms, shared by the importer's price-list claim and
 * `parseEquipment` and this module's `bestBaseMatch`.
 *
 * - **Head first, qualifier after a comma.** The price list writes the head
 *   noun first (RR p. 129); every other page writes the qualifier first.
 * - **A parenthetical unit or note** names the unit, not another item.
 * - **A slash offering either word** is one row naming two things.
 *
 * Combinations are capped so a name with many slashes cannot explode.
 * See docs/lib/DECISIONS.md, "2026-08-24 — the name-form rules live in
 * `lib/vocab.mjs`, once."
 */
export function nameVariants(raw) {
  const out = [];
  const add = (t) => {
    const v = String(t).replace(/\s+/g, " ").trim();
    if (v && !out.includes(v)) out.push(v);
  };
  for (const base of [raw, String(raw).replace(/\([^)]*\)/g, " ")]) {
    const segments = String(base).split(",").map((x) => x.trim()).filter(Boolean);
    for (const form of segments.length > 1 ? [base, [...segments].reverse().join(" ")] : [base]) {
      let combos = [[]];
      for (const options of String(form).trim().split(/\s+/).map((w) => w.split("/"))) {
        combos = combos.flatMap((prefix) => options.map((o) => [...prefix, o]));
        if (combos.length > 8) break;
      }
      for (const c of combos) add(c.join(" "));
    }
  }
  return out;
}

/** `nameVariants` as comparable keys: folded, punctuation and spacing gone. */
export const nameKeys = (raw) => new Set(nameVariants(raw).map(slug).filter(Boolean));

/** The singular forms an English plural may have stood for, the word itself first. */
function singularsOf(word) {
  const w = String(word ?? "");
  const out = [w];
  const add = (s) => s.length > 1 && !out.includes(s) && out.push(s);
  if (/men$/i.test(w)) add(w.replace(/men$/i, "man"));
  if (/ies$/i.test(w)) add(w.replace(/ies$/i, "y"));
  if (/ves$/i.test(w)) {
    add(w.replace(/ves$/i, "f"));
    add(w.replace(/ves$/i, "fe"));
  }
  if (/es$/i.test(w)) add(w.replace(/es$/i, ""));
  if (/s$/i.test(w) && !/ss$/i.test(w)) add(w.replace(/s$/i, ""));
  return out;
}

/**
 * `nameKeys` for a creature as a page labels it: the label as printed, and
 * every form of it with its last word made singular, so a plural label meets the
 * catalogue's singular name. A form no name holds matches nothing.
 */
export function creatureKeys(raw) {
  const base = String(raw ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const words = base.split(" ");
  const last = words.pop() ?? "";
  const keys = new Set();
  for (const form of singularsOf(last)) for (const k of nameKeys([...words, form].join(" "))) keys.add(k);
  return keys;
}

/** A creature name's words with its parentheticals dropped: `{ w, abbr }`, `abbr` when a period follows the word. */
const creatureWords = (raw) =>
  [...String(raw ?? "").replace(/\([^)]*\)/g, " ").toLowerCase().matchAll(/([\p{L}\p{N}]+)(\.?)/gu)].map((m) => ({ w: m[1], abbr: m[2] === "." }));

/** Whether a cell's words are the row's first words: each equal, or with `abbreviations` a cut-short word the row's begins with. */
const wordsStandFor = (cell, row, abbreviations) =>
  cell.length <= row.length &&
  cell.every((c, i) => c.w === row[i].w || (abbreviations && c.abbr && c.w.length > 1 && row[i].w.startsWith(c.w)));

/**
 * The closest catalogue name to a creature as a page labels it, when no name
 * holds the label's own keys: an index into `names`, or null. Tried in order,
 * each only after the one before finds nothing:
 *
 * 1. **Family head** — "Head, member" and "Head (member)" name a member of the
 *    family a row of the same name as the head stands for.
 * 2. **Number** — the label and the name differ only in the singular or plural
 *    of the last word (`creatureKeys`).
 * 3. **Abbreviation** — a word cut short with a period stands for the word of a
 *    same-length name it begins.
 * 4. **Truncation** — the label's words are the first words of a longer name,
 *    at least two of them; read word for word first, then with abbreviations.
 *
 * The last two answer only when exactly one distinct name fits, since a cut-off
 * form that fits two names names neither. Never builds a map of printed names,
 * and never returns a name an exact match would have found.
 */
export function looseCreatureName(raw, names) {
  const list = [...names].map((n) => String(n ?? ""));
  const cell = creatureWords(raw);
  if (!cell.length) return null;
  const headOf = String(raw).replace(/\([^)]*\)/g, " ").split(",")[0];
  const head = nameKeys(headOf);
  const family = String(raw).includes(",") || /\(/.test(String(raw));
  if (family) {
    const i = list.findIndex((n) => [...nameKeys(n)].some((k) => head.has(k)));
    if (i >= 0) return i;
  }
  const mine = new Set([...nameKeys(String(raw).replace(/\([^)]*\)/g, " ")), ...creatureKeys(raw)]);
  const number = list.findIndex((n) => [...creatureKeys(n)].some((k) => mine.has(k)));
  if (number >= 0) return number;
  for (const [whole, abbreviations] of [[true, true], [false, false], [false, true]]) {
    const fits = [];
    list.forEach((n, i) => {
      const row = creatureWords(n);
      if (!row.length || (whole ? cell.length !== row.length : cell.length < 2 || cell.length >= row.length)) return;
      if (wordsStandFor(cell, row, abbreviations)) fits.push(i);
    });
    if (new Set(fits.map((i) => slug(list[i]))).size === 1) return fits[0];
  }
  return null;
}

// No alignment normalizer lives here: influence keeps its own token set and
// translates at its boundary. See docs/influence/DECISIONS.md, "Alignment is
// translated at the boundary, not renamed".

/* ---------------------------------------------------------------- */
/*  Shared vocabulary — defined here, re-exported by monsters/config */
/* ---------------------------------------------------------------- */

/**
 * The core system's Item document sub-types, as named constants — write
 * `ITEM_TYPE.weapon`, never a bare `"weapon"`. Mirrors the system's own
 * `ITEM_TYPE` enum, which core does not publish on any API surface. Key equals
 * value (the `SLOT` convention below).
 *
 * DOCUMENT types only: what `Item#type` can be. `system.type` and every other
 * domain `.type` field keep their own vocabulary.
 */
export const ITEM_TYPE = Object.freeze({
  item: "item",
  weapon: "weapon",
  armor: "armor",
  spell: "spell",
  ability: "ability",
  language: "language",
  money: "money",
  bundle: "bundle",
});

/**
 * The core system's Actor document sub-types. The module's own sub-types embed
 * `MODULE_ID` and are named by `ANIMAL_TYPE` / `GROUP_TYPE` / `TEMPLATE_TYPE`
 * in lib/module.mjs, which this Foundry-free file does not re-export.
 */
export const ACTOR_TYPE = Object.freeze({
  character: "character",
  monster: "monster",
});

/** Damage types (MM Overview p.12; core system damage set). */
export const DAMAGE_TYPES = {
  acidic: { label: "Acidic" },
  arcane: { label: "Arcane" },
  bludgeoning: { label: "Bludgeoning" },
  cold: { label: "Cold" },
  electrical: { label: "Electrical" },
  fire: { label: "Fire" },
  luminous: { label: "Luminous" },
  necrotic: { label: "Necrotic" },
  piercing: { label: "Piercing" },
  poisonous: { label: "Poisonous" },
  seismic: { label: "Seismic" },
  slashing: { label: "Slashing" },
  varies: { label: "Varies by Weapon" },
};

/**
 * The natural weapons a monster's attack can be, by key and label (MM Overview
 * p. 12). The damage type each deals is the imported `naturalWeaponDamage`
 * table's (`monsters/natural-weapons.mjs`); nothing here states one.
 */
export const NATURAL_WEAPONS = {
  bite: { label: "Bite" },
  claw: { label: "Claw" },
  talon: { label: "Talon" },
  gore: { label: "Gore" },
  horn: { label: "Horn" },
  tusk: { label: "Tusk" },
  stinger: { label: "Stinger" },
  hoof: { label: "Hoof" },
  tail: { label: "Tail" },
  tentacle: { label: "Tentacle" },
  tongue: { label: "Tongue" },
  constriction: { label: "Constriction" },
  ram: { label: "Ram" },
  pincer: { label: "Pincer" },
  spine: { label: "Spine" },
  weapon: { label: "Weapon" },
  // The monster sheet offers these three beyond the list above. `sting` and
  // `stinger` are one concept under two keys, and a stored monster may hold either.
  sting: { label: "Sting" },
  feeler: { label: "Feeler" },
  envelopment: { label: "Envelopment" },
};

/** Vision capabilities (MM Overview pp.12–13). */
export const VISION_TYPES = {
  standard: { label: "Standard" },
  night: { label: "Night Vision" },
  lightless: { label: "Lightless Vision", ranged: true },
  acute: { label: "Acute Vision" },
  blind: { label: "Blind" },
};

/** Other special senses (MM Overview p.13). */
export const SENSE_TYPES = {
  acuteHearing: { label: "Acute Hearing" },
  acuteOlfaction: { label: "Acute Olfaction" },
  acuteVision: { label: "Acute Vision" },
  echolocation: { label: "Echolocation", ranged: true },
  mechAerial: { label: "Aerial Mechanoreception", ranged: true },
  mechAquatic: { label: "Aquatic Mechanoreception", ranged: true },
  mechTerrestrial: { label: "Terrestrial Mechanoreception", ranged: true },
  mechWebbed: { label: "Webbed Mechanoreception", ranged: true },
};

/** Alignment (MM Overview p.15; Creation p.398). */
export const ALIGNMENTS = {
  lawful: { label: "Lawful" },
  neutral: { label: "Neutral" },
  chaotic: { label: "Chaotic" },
};

/**
 * The six ability scores, keyed by the CORE system's own data paths so a
 * consumer can read `actor.system.scores[key].mod` straight from the key.
 *
 * The system stores Will under `wis`; the label carries the book's name.
 */
export const ATTRIBUTES = {
  str: { label: "STR" },
  int: { label: "INT" },
  wis: { label: "WIL" },
  dex: { label: "DEX" },
  con: { label: "CON" },
  cha: { label: "CHA" },
};

/** Movement types; the multi-row Speed table (MM Overview p.11). */
export const MOVEMENT_TYPES = {
  land: { label: "Land" },
  burrow: { label: "Burrow" },
  climb: { label: "Climb" },
  fly: { label: "Fly" },
  swim: { label: "Swim" },
  webcrawl: { label: "Webcrawl" },
};

/**
 * The three things a party can be doing, and the three kinds of map that put
 * them on the table: `delve` ticks dungeon turns, `journey` runs the day
 * board, `settlement` crosses a city. A scene declares which one applies on it
 * (the battlemap's setup tool) and the formation obeys, so the list is shared.
 */
export const TRAVEL_MODES = Object.freeze(["delve", "journey", "settlement"]);

/* ---------------------------------------------------------------- */
/*  Ability effect model — the shared binding target                  */
/* ---------------------------------------------------------------- */

/** Which flavour of `ability` item this is. */
export const ABILITY_CATEGORIES = {
  proficiency: { label: "Proficiency" },
  classPower: { label: "Class Power" },
  monsterAbility: { label: "Monster Ability" },
  skill: { label: "Skill" },
  drawback: { label: "Custom Drawback" }, // JJ: traded for build points
  weaponProficiency: { label: "Weapon Proficiency" },
  armorProficiency: { label: "Armor Proficiency" },
  fightingStyle: { label: "Fighting Style" },
  // A language a character speaks or reads: a category, so it reuses what the
  // ability model does for a proficiency (granting, counting, listing, importing).
  language: { label: "Language" },
};

/**
 * The canonical picks a proficiency of each category can select — the checkbox
 * vocabulary for an ability's `selections`.
 *
 * `selections` stays free text in the model; this is the shared shortlist for
 * the three categories with a fixed vocabulary (the class-build selections, JJ
 * pp. 290-291). A pick outside it goes in the free-text field instead of a box.
 * Keys match what the profile strips match on, so ticking a box lights the
 * matching pill.
 *
 * A vocabulary may carry META keys beside its entries (`VOCAB_META`): `open`
 * marks a shortlist a world extends, `exact` a family matched by key, alias and
 * label only. Enumerate entries through `selectionOptions()`, never through
 * `Object.entries`, so a meta key is never drawn as a box.
 *
 * WEAPONS carry the grant grammar of `equipment/proficiency.mjs`, and every key
 * is one of its tokens, so a stored pick goes to `classifyGrantToken` /
 * `grantMatches` unchanged. The family is `exact` because a pick may also be one
 * named weapon, which a substring match would widen to its whole group. Groups
 * are written in the plural. See docs/abilities/DECISIONS.md, "A weapon
 * proficiency's boxes are the grant grammar, and a weapon's name is not a group".
 */
export const SELECTION_VOCAB = {
  weaponProficiency: {
    exact: true,
    all: { label: "Any weapon", aliases: ["all weapons", "any weapons", "unrestricted"] },
    "missile:all": {
      label: "All missile weapons",
      aliases: ["missile", "missiles", "missile weapon", "missile weapons", "all missile weapons", "any missile weapons", "ranged", "ranged weapons"],
    },
    "melee:tiny": { label: "Tiny melee", aliases: ["tiny", "tiny melee weapon", "tiny melee weapons", "tiny weapons"] },
    "melee:small": { label: "Small melee", aliases: ["small", "small melee weapon", "small melee weapons", "small weapons"] },
    "melee:medium": { label: "Medium melee", aliases: ["medium", "medium melee weapon", "medium melee weapons", "medium weapons"] },
    "melee:large": { label: "Large melee", aliases: ["large", "large melee weapon", "large melee weapons", "large weapons"] },
    unarmed: { label: "Unarmed" },
    axe: { label: "Axes" },
    sworddagger: { label: "Swords & Daggers", aliases: ["swords", "daggers", "swords and daggers"] },
    flailhammermace: {
      label: "Flails, Hammers & Maces",
      aliases: ["flails", "hammers", "maces", "flails, hammers and maces", "maces, flails and hammers", "maces, flails & hammers"],
    },
    spearpolearm: { label: "Spears & Polearms", aliases: ["spears", "polearms", "spears and polearms"] },
    bowcrossbow: { label: "Bows & Crossbows", aliases: ["bows", "crossbows", "bows and crossbows"] },
    other: { label: "Other weapons", aliases: ["other weapons"] },
  },
  fightingStyle: {
    single: { label: "Single Weapon" },
    dual: { label: "Dual Weapon" },
    twohanded: { label: "Two-Handed Weapon" },
    weaponshield: { label: "Weapon & Shield" },
    missile: { label: "Missile" },
  },
  armorProficiency: {
    unarmored: { label: "Unarmoured" },
    verylight: { label: "Very Light" },
    light: { label: "Light" },
    medium: { label: "Medium" },
    heavy: { label: "Heavy" },
  },
};

/**
 * The definition slug an ability is known by: the importer's cookbook id where
 * it has one (its last segment, slugged), else its own name with any trailing
 * "(X)" pick suffix removed. The one identity the sheet's vocabulary and the
 * equipment bridge's picks are keyed by.
 */
export const abilitySlug = (item) => {
  const id = cookbookId(item);
  if (id) return slug(id.split(".").pop());
  return slug(String(item?.name ?? "").replace(/\([^)]*\)\s*$/, ""));
};

/**
 * The canonical picks for abilities whose selection is per-ABILITY rather than
 * per-category. `SELECTION_VOCAB` below is keyed by category and cannot express
 * these, since they share the one `proficiency` category.
 *
 * `open` marks a family a world extends: a shortlist, not a closed set, and the
 * sheet's free-text line takes anything outside it. `aliases` carry the
 * phrasings a template or an import writes (RR p. 25), so a pick ticks the box
 * the mechanics read. Fighting styles list only the five the mechanics resolve
 * (`equipment/config.mjs` STYLE). See docs/abilities/DECISIONS.md, "An open
 * family's entries are registered; a closed one's are code".
 */
export const SELECTION_VOCAB_BY_ABILITY = {
  // RR p. 121.
  weaponfocus: {
    axes: { label: "Axes" },
    macesflailshammers: { label: "Maces, Flails & Hammers", aliases: ["maces", "flails", "hammers"] },
    swordsdaggers: { label: "Swords & Daggers", aliases: ["swords", "daggers"] },
    bowscrossbows: { label: "Bows & Crossbows", aliases: ["bows", "crossbows"] },
    slingsthrown: { label: "Slings & Thrown", aliases: ["slings", "thrown"] },
    spearspolearms: { label: "Spears & Polearms", aliases: ["spears", "polearms"] },
  },
  // Martial Training (RR ch. 3) has no entry here: `weapons.mjs` registers its
  // picks (`registerSelectionVocab`).
  // RR p. 108 / JJ p. 291.
  fightingstylespecialization: {
    single: { label: "Single Weapon", aliases: ["single weapon", "one weapon"] },
    dual: { label: "Dual Weapon", aliases: ["two weapon", "two weapons", "dual wielding", "twoweapon"] },
    twohanded: { label: "Two-Handed Weapon", aliases: ["2-handed weapon", "two handed", "2 handed"] },
    weaponshield: { label: "Weapon & Shield", aliases: ["weapon+shield", "weapon and shield", "shield"] },
    missile: { label: "Missile", aliases: ["missile weapon", "ranged", "bow"] },
  },
  // RR Combat.
  combattrickery: {
    clamber: { label: "Clamber" },
    disarm: { label: "Disarm" },
    forceback: { label: "Force Back", aliases: ["force back"] },
    incapacitate: { label: "Incapacitate" },
    knockdown: { label: "Knock Down", aliases: ["knock down"] },
    overrun: { label: "Overrun" },
    sunder: { label: "Sunder" },
    wrestle: { label: "Wrestle" },
  },
  elementalism: {
    air: { label: "Air" },
    earth: { label: "Earth" },
    fire: { label: "Fire" },
    water: { label: "Water" },
  },
  // Open families ship no entries: their lists are the book's content, and
  // arrive by registration from the importer (`SELECTION_VOCAB_DOC` below).
  // Until something registers them the free-text line is the whole surface.
  artcraft: { open: true },
  profession: { open: true },
  labor: { open: true },
  performance: { open: true },
};

/** Is this vocabulary a shortlist rather than a closed set? */
export const isOpenVocab = (vocab) => vocab?.open === true;

/**
 * The ruledata document where a world's own entries for the open families
 * arrive: one table per ability slug, each `{key: {label, aliases}}`, through
 * the layered ruledata registry:
 *
 *   registerTable({ id: "acks.selectionVocab", tables: {
 *     profession: { myKey: { label: "…as the book prints it" } },
 *   }}, { priority: PRIORITY.WORLD });
 *
 * Nothing is required, so it is not declared through `expectTables`.
 */
export const SELECTION_VOCAB_DOC = "acks.selectionVocab";

/** A world's registered entries for one open family, or null. */
function registeredVocab(slug) {
  if (!slug || !hasDoc(SELECTION_VOCAB_DOC)) return null;
  const entries = getDoc(SELECTION_VOCAB_DOC).tables?.[slug];
  return entries && typeof entries === "object" ? entries : null;
}

/** The vocabulary providers, `{ abilitySlug → () => vocabulary }`. */
const PROVIDERS = new Map();

/**
 * Register the function that answers an ability's pick vocabulary at each call,
 * so the entries follow the imported lists and a Judge's override of them. `fn`
 * returns `{ [key]: { label, aliases? } }`, with the meta keys of `VOCAB_META`
 * where the family has them; an empty object where nothing is imported. A
 * provider replaces any entry the ability has in `SELECTION_VOCAB_BY_ABILITY`
 * and wins over the registry. Passing no function withdraws the provider.
 *
 * @param {string} abilitySlugKey the ability's `abilitySlug`
 * @param {(() => object)|null} fn
 */
export function registerSelectionVocab(abilitySlugKey, fn) {
  if (typeof fn === "function") PROVIDERS.set(abilitySlugKey, fn);
  else PROVIDERS.delete(abilitySlugKey);
}

/** Does a provider answer this ability's pick vocabulary? Then an empty one means "not imported". */
export const hasSelectionProvider = (item) => PROVIDERS.has(abilitySlug(item));

/**
 * The pick vocabulary for one ability: a registered provider's first, then its
 * own, else its category's. A closed family is returned as it stands; the
 * registry widens only the open ones.
 */
export function selectionVocabFor(item, category) {
  const slug = abilitySlug(item);
  const provided = PROVIDERS.get(slug);
  if (provided) {
    const vocab = provided();
    return vocab && typeof vocab === "object" ? vocab : {};
  }
  const own = SELECTION_VOCAB_BY_ABILITY[slug];
  if (own) {
    const { open, ...options } = own;
    if (!open) return options;
    return { ...options, ...(registeredVocab(slug) ?? {}) };
  }
  return SELECTION_VOCAB[category] ?? null;
}

/** Keys that describe a vocabulary rather than name a pick in it. */
const VOCAB_META = new Set(["open", "exact"]);

/**
 * A vocabulary's pick entries as `[key, {label, aliases}]` pairs, meta keys
 * left out — the one way to enumerate a vocabulary for display.
 */
export const selectionOptions = (vocab) => Object.entries(vocab ?? {}).filter(([k]) => !VOCAB_META.has(k));

/**
 * Which vocabulary entry a stored pick means, or null when it names something
 * the shortlist does not.
 *
 * Key and alias matches are tried across the whole vocabulary first, then label
 * matches, and only then anything loose, so a pick that names one entry outright
 * is never claimed by another's substring. A vocabulary marked `exact` stops
 * before the loose pass. Loose matching needs four characters.
 */
export function matchSelectionKey(vocab, pick) {
  const f = slug(pick);
  if (!f || !vocab) return null;
  const entries = selectionOptions(vocab);
  for (const [key, def] of entries) {
    if (f === slug(key) || (def.aliases ?? []).some((a) => slug(a) === f)) return key;
  }
  for (const [key, def] of entries) {
    if (f === slug(def.label)) return key;
  }
  if (vocab.exact === true) return null;
  for (const [key, def] of entries) {
    const label = slug(def.label);
    if (f.length >= 4 && (label.includes(f) || key.includes(f) || f.includes(key))) return key;
  }
  return null;
}

/** How one pick is written for a reader: its vocabulary label, else itself. */
export function selectionLabel(vocab, pick) {
  const key = matchSelectionKey(vocab, pick);
  return key ? vocab[key].label : String(pick ?? "").trim();
}

/**
 * An ability's name carrying its own picks — "Ability (Pick, Pick)" (JJ p. 451).
 *
 * The "(X)" suffix is derived from the picks: any existing suffix is replaced
 * rather than appended to, and a name with no picks left loses it. It carries
 * labels, not keys, and a pick the shortlist does not name is written as typed.
 */
export function nameWithSelections(baseName, picks, vocab) {
  const base = String(baseName ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const labels = (picks ?? []).map((p) => selectionLabel(vocab, p)).filter(Boolean);
  return labels.length ? `${base} (${labels.join(", ")})` : base;
}

/**
 * The picks an ability's name carries in its trailing "(X)", for an item that
 * stores none — the display convention `nameWithSelections` writes, read back.
 *
 * A fragment counts only when it names an entry of the ability's own
 * vocabulary outright (key, alias or label, never the loose substring pass), so
 * a parenthetical that merely ends a name is not a pick. An ability with no
 * vocabulary, or one whose list is not imported, has none. A read: the result
 * is never written back to the item.
 *
 * @param {object} item the ability
 * @param {string} category its stored category, which picks the vocabulary when it has no own
 * @returns {string[]} the fragments as written, in order
 */
export function namedPicks(item, category) {
  const m = /\(([^)]+)\)\s*$/.exec(item?.name ?? "");
  if (!m) return [];
  const vocab = selectionVocabFor(item, category);
  if (!vocab) return [];
  const closed = { ...vocab, exact: true };
  return m[1].split(",").map((s) => s.trim()).filter((s) => s && matchSelectionKey(closed, s));
}

/** Domains a `proficiencyGrant` effect covers (RR Combat: Combat Proficiencies). */
export const PROFICIENCY_DOMAINS = {
  weapon: { label: "Weapon" },
  armor: { label: "Armor" },
  fightingStyle: { label: "Fighting Style" },
};

/**
 * Breadth of a weapon/armor proficiency grant (custom-class selection tiers).
 * A class import parameterizes the grant with a tier; `group` holds the
 * specific selection, and `unrestricted` grants all and carries no selection.
 */
export const PROFICIENCY_BREADTH = {
  unrestricted: { label: "Unrestricted" },
  broad: { label: "Broad" },
  narrow: { label: "Narrow" },
  restricted: { label: "Restricted" },
};

/** The typed effect primitives an ability's `effects[]` may hold. */
export const EFFECT_TYPES = {
  modifier: { label: "Modifier" }, // flat/level-scaling bonus OR penalty to a target
  // One score used in place of another on a roll: not a modifier, since its
  // size is the difference between two of the character's own scores.
  // Stored as {attribute, insteadOf, target}.
  attributeSubstitution: { label: "Attribute Substitution" },
  throw: { label: "Proficiency Throw" }, // a target-number roll
  progressionAs: { label: "Progresses As Class" }, // a skill that advances as another class's
  proficiencyGrant: { label: "Proficiency Grant" }, // weapon/armor/fighting-style proficiency
  limitation: { label: "Limitation / Drawback" }, // a restriction or penalty — attaches to ANY ability
  // A consequence keyed to how the throw itself came up (`OUTCOME_TRIGGERS`).
  // The numbers (band edge, fraction) are page values and locate per seat.
  outcome: { label: "Roll Outcome" },
  // --- Relational: abilities that depend on, grant, or alter OTHER abilities ---
  requires: { label: "Requires" }, // prerequisite ability/abilities
  grants: { label: "Grants" }, // confers other abilities (optionally choose N)
  modifies: { label: "Modifies" }, // changes another ability's value/throw
  reroll: { label: "Reroll" }, // roll twice, keep the better/worse (resolvable — see resolveReroll)
  companion: { label: "Companion" }, // a creature the ability confers; links to a monster entry
  immunity: { label: "Immunity" },
  resistance: { label: "Resistance" },
  susceptibility: { label: "Susceptibility" },
  sense: { label: "Sense" },
  movement: { label: "Movement" },
  naturalAttack: { label: "Natural Attack" },
  spellLike: { label: "Spell-Like Ability" },
  spellcastingMod: { label: "Spellcasting Modifier" },
  resource: { label: "Resource" }, // spend/gain fate points, spell slots, etc.
  conditionGrant: { label: "Condition / Immunity" },
  // An ability that lifts a condition already in place; stored as `conditions`
  // + `appliesTo`, the same fields conditionGrant uses.
  conditionRemove: { label: "Removes Condition" },
  economic: { label: "Economic / Rate" },
  capability: { label: "Capability" }, // marker; detail lives in the (lazy) description
  // --- Spell effects: what a cast does to its targets. `domain: "spell"`
  // keeps a kind out of an ability's picker (`effectTypesFor`). A kind the cast
  // engine cannot compute is tracked with a duration and a card line.
  damage: { label: "Damage", domain: "spell" },
  heal: { label: "Healing", domain: "spell" }, // what it restores: HEAL_KINDS
  summon: { label: "Summon", domain: "spell" }, // SUMMON_FORMATS + CONTROL_KINDS
  control: { label: "Control", domain: "spell" }, // dominate, command, enslave
  transform: { label: "Transform", domain: "spell" },
  wall: { label: "Wall", domain: "spell" },
  detect: { label: "Detect", domain: "spell" },
  dispel: { label: "Dispel", domain: "spell" },
  ward: { label: "Ward", domain: "spell" },
  illusion: { label: "Illusion", domain: "spell" },
  light: { label: "Light", domain: "spell" },
  teleport: { label: "Teleport", domain: "spell" },
  createObject: { label: "Create Object", domain: "spell" },
  structural: { label: "Structural Damage", domain: "spell" },
  curse: { label: "Curse", domain: "spell" },
};

/**
 * The effect types a picker offers for one domain: `"ability"` is every kind
 * without a domain marker, `"spell"` is every kind. A stored row keeps its type
 * whatever a picker shows.
 */
export function effectTypesFor(domain) {
  return Object.fromEntries(Object.entries(EFFECT_TYPES).filter(([, v]) => !v.domain || v.domain === domain));
}

/**
 * WHOSE roll an effect modifies, so a penalty an ability imposes on its victims
 * is not stored as one the character suffers. Defaults to `self`.
 */
export const EFFECT_SUBJECTS = {
  self: { label: "The character" },
  opponent: { label: "The opponent" },
  ally: { label: "An ally" },
  // A spell's subjects are relative to the cast: `self` is the caster, and these
  // three name what it is aimed at (RR ch. 5 §V.8). `domain: "spell"` keeps them
  // out of an ability's picker (`effectSubjectsFor`).
  target: { label: "The target", domain: "spell" },
  recipient: { label: "The recipient", domain: "spell" },
  area: { label: "Everything in the area", domain: "spell" },
};

/** The subjects a picker offers for one domain, on the same rule as `effectTypesFor`. */
export function effectSubjectsFor(domain) {
  return Object.fromEntries(Object.entries(EFFECT_SUBJECTS).filter(([, v]) => !v.domain || v.domain === domain));
}

/** What a `modifier` effect adjusts. */
export const MODIFIER_TARGETS = {
  attackThrow: { label: "Attack Throw" },
  damage: { label: "Damage" },
  ac: { label: "Armor Class" },
  save: { label: "Saving Throw" },
  reaction: { label: "Reaction Roll" },
  initiative: { label: "Initiative" },
  surprise: { label: "Surprise" },
  morale: { label: "Morale" },
  loyalty: { label: "Loyalty" },
  // Its own d20 roll, not a saving throw, so it is not filed under `save`.
  mortalWounds: { label: "Mortal Wounds Throw" },
  speed: { label: "Speed" },
  proficiencyThrow: { label: "Proficiency Throw" },
  casterLevel: { label: "Caster Level" },
  hp: { label: "Hit Points" },
  research: { label: "Magic Research" },
  cleaves: { label: "Cleaves" },
  // A market's class as one trader deals in it (henchmen `effectiveMarketClass`),
  // and a venture's market impact (markets `engine/network.mjs`).
  marketClass: { label: "Market Class" },
  marketImpact: { label: "Market Impact" },
  // What a character's powers do for the hirelings serving them (henchmen
  // `effects.mjs`): their own targets, never `loyalty` or `morale`, which the
  // influence pages read as roll modifiers.
  retainBonus: { label: "Henchmen Allowed" },
  baseLoyalty: { label: "Henchmen's Base Loyalty" },
  henchmanMorale: { label: "Hirelings' Morale" },
};

/** Non-damage effect keywords (mirror the importer's `defenseEffect` register). */
export const EFFECT_KEYS = {
  enchantment: { label: "Enchantment" },
  charm: { label: "Charm" },
  sleep: { label: "Sleep" },
  hold: { label: "Hold" },
  paralysis: { label: "Paralysis" },
  petrification: { label: "Petrification" },
  death: { label: "Death" },
  poison: { label: "Poison" },
  disease: { label: "Disease" },
  energyDrain: { label: "Energy Drain" },
  fear: { label: "Fear" },
  gaze: { label: "Gaze" },
  illusion: { label: "Illusion" },
  mindAffecting: { label: "Mind-Affecting" },
  bleeding: { label: "Bleeding" },
  criticalHits: { label: "Critical Hits" },
  surprise: { label: "Surprise" },
};

/**
 * Conditions an ability can grant or make one immune to: the condition
 * catalogue, and three keys stored abilities already carry that name an
 * effect and no condition of their own.
 */
export const CONDITION_KEYS = {
  ...Object.fromEntries(Object.entries(CONDITIONS).map(([key, c]) => [key, { label: c.label }])),
  fear: { label: "Fear" },
  sleep: { label: "Sleep" },
  paralysis: { label: "Paralysis" },
};

/** Class progressions a `progressionAs` effect can borrow (thief skills etc.). */
export const PROGRESSION_CLASSES = {
  fighter: { label: "Fighter" },
  crusader: { label: "Crusader" },
  mage: { label: "Mage" },
  thief: { label: "Thief" },
};

/**
 * Shorthands for the class-level fraction a `progressionAs` effect or a
 * `progression` target reads at, kept so a stored one keeps resolving. Which
 * fraction a rule uses is printed, so it is carried by `atLevelNum` /
 * `atLevelDen` on the value itself, read from the reader's own book;
 * `levelFactor` reads both and prefers the data. See docs/abilities/DECISIONS.md,
 * "The level fraction is data, not a member of a shipped list".
 */
export const PROGRESSION_LEVELS = {
  full: { label: "Full Level", factor: 1 },
  half: { label: "Half Level", factor: 0.5 },
  third: { label: "One-Third Level", factor: 1 / 3 },
  quarter: { label: "One-Quarter Level", factor: 0.25 },
};

/**
 * The fraction of class level a borrowed table is read at, as a number.
 *
 * Reads the value's own numerator and denominator first, then the shorthand
 * key. A missing or nonsensical fraction is 1, the one answer that invents
 * nothing.
 *
 * @param {object|string} spec a LevelValue (or a bare legacy key)
 */
export function levelFactor(spec) {
  if (typeof spec === "string") return PROGRESSION_LEVELS[spec]?.factor ?? 1;
  const num = Number(spec?.atLevelNum);
  const den = Number(spec?.atLevelDen);
  if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) return num / den;
  return PROGRESSION_LEVELS[spec?.atLevel]?.factor ?? 1;
}

/**
 * A factor as the `atLevelNum` / `atLevelDen` pair a LevelValue stores: the
 * smallest denominator up to twelve that states it exactly. Null for a factor
 * that is not positive or that no such fraction states: a figure is never rounded.
 *
 * @param {number} factor
 * @returns {{num: number, den: number}|null}
 */
export function levelFraction(factor) {
  const f = Number(factor);
  if (!Number.isFinite(f) || f <= 0) return null;
  for (let den = 1; den <= 12; den++) {
    const num = Math.round(f * den);
    if (num > 0 && Math.abs(num / den - f) < 1e-6) return { num, den };
  }
  return null;
}

/** A fraction as it is written — "2/3", or the legacy shorthand's own label. */
export function levelFactorLabel(spec) {
  const num = Number(spec?.atLevelNum);
  const den = Number(spec?.atLevelDen);
  if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) return num === den ? "" : `${num}/${den}`;
  const key = typeof spec === "string" ? spec : spec?.atLevel;
  return key && key !== "full" ? (PROGRESSION_LEVELS[key]?.label ?? key) : "";
}

/**
 * What a ladder rung says when it is not a target number: reached without a
 * throw (`auto`), or not available yet (`none`). Blank means the rung is a target
 * number. These two structural states are all a machine acts on; what the cell
 * says rides the rung's `text`, from the reader's own book. See
 * docs/abilities/DECISIONS.md, "A rung may say something other than a number".
 */
export const RUNG_OUTCOMES = {
  auto: { label: "Automatic — no throw" },
  none: { label: "Not available yet" },
};

/** Resources an ability spends or grants. */
export const RESOURCE_KINDS = {
  fatePoint: { label: "Fate Point" },
  spellSlot: { label: "Spell Slot" },
  stigma: { label: "Stigma" },
  hp: { label: "Hit Points" },
};

/** How an effect combines with what it targets: added to it, replacing it, or setting it. */
export const EFFECT_MODES = {
  add: { label: "Add" },
  replace: { label: "Replace" },
  set: { label: "Set" },
};

/**
 * How a converted / retired thing is surfaced. All three are marked: content the
 * books removed deliberately is a caution; content merely omitted from ACKS II
 * is info. `tip` is a template: `{name}` interpolates the source name via
 * `conversionTip()`. Consumers read icon/severity/tip from here.
 */
export const CONVERSION_STATUS = {
  renamed: {
    label: "Renamed",
    severity: "note",
    icon: "fa-solid fa-tag",
    tip: "{name} has been renamed for ACKS II.",
  },
  deleted: {
    label: "Deleted",
    severity: "caution",
    icon: "fa-solid fa-triangle-exclamation",
    tip: "This content is not advised for a typical ACKS II campaign.",
  },
  absent: {
    label: "Absent",
    severity: "info",
    icon: "fa-solid fa-circle-info",
    tip: "This content has not been designed for ACKS II, use with care.",
  },
};

/**
 * The tooltip for a conversion status, with `{name}` filled in. `name` is the
 * pre-conversion name, as the older source called it. Returns "" for an unknown
 * status.
 */
export function conversionTip(status, name = "") {
  const tip = CONVERSION_STATUS[status]?.tip;
  if (!tip) return "";
  return tip.replace(/\{name\}/g, name || "This content");
}

/** Roll comparison (mirror core `CONFIG.ACKS.roll_type`). */
export const ROLL_TYPES = {
  result: { label: "=" },
  above: { label: "≥" },
  below: { label: "≤" },
};

/**
 * How an ability's throw is read: the three comparisons plus `measure`, a throw
 * with nothing to beat, where the dice are the answer. Separate from
 * `ROLL_TYPES` because core's own field would reject a fourth value; `measure`
 * lives only on this module's own throws, never in core's `system.rollType`.
 * See docs/abilities/DECISIONS.md, "A throw may have no target at all".
 */
export const THROW_TYPES = {
  ...ROLL_TYPES,
  measure: { label: "no target" },
};

/** A throw whose result stands on its own, with nothing to score it against. */
export const isMeasure = (rollType) => rollType === "measure";

/* ---------------------------------------------------------------- */
/*  Capabilities — the gate pattern                                  */
/* ---------------------------------------------------------------- */

/**
 * The prefix of a capability token. A capability is what an ability lets you
 * do, named independently of which ability grants it: abilities declare what
 * they `provide`, and prerequisites, gates and stacking rules are written
 * against the capability. Tokens: `def.<class>.<slug>` names one exact ability;
 * `kw:<slug>` names a capability. Anywhere a ref is accepted (`requires`,
 * `ifHas`, `stacksWith`, `notStacksWith`), either form works. See
 * docs/lib/DECISIONS.md, "A gate names a capability, and two providers of one do
 * not stack".
 */
export const CAPABILITY_PREFIX = "kw:";

/** Whether `token` is a `kw:` capability token rather than a definition id. */
export const isCapabilityToken = (token) => String(token ?? "").startsWith(CAPABILITY_PREFIX);

/** "def.prof.someName" → "kw:somename". Case- and separator-folded. */
export const capabilityForId = (id) =>
  CAPABILITY_PREFIX + slug(String(id ?? "").split(".").slice(2).join(""));

/**
 * Does a character holding `abilities` satisfy `token`?
 *
 * `abilities` is a list of `{ id, provides }`. A definition-id token needs that
 * exact ability; a `kw:` token is satisfied by any ability providing it, and an
 * ability always implicitly provides its own id's capability.
 */
export function satisfies(abilities, token) {
  if (!token) return true;
  const list = abilities ?? [];
  if (!isCapabilityToken(token)) return list.some((a) => a?.id === token);
  const want = token.toLowerCase();
  return list.some(
    (a) => capabilityForId(a?.id) === want || (a?.provides ?? []).some((p) => String(p).toLowerCase() === want),
  );
}

/** Every token in `tokens` satisfied (an ability's `requires` / `ifHas`). */
export const satisfiesAll = (abilities, tokens) => (tokens ?? []).every((t) => satisfies(abilities, t));

/**
 * Group abilities that provide the same capability. Returned as
 * `capability -> [ability ids]`, only for capabilities held more than once.
 */
export function nonStackingGroups(abilities) {
  const by = new Map();
  for (const a of abilities ?? []) {
    const caps = new Set([capabilityForId(a?.id), ...(a?.provides ?? []).map((p) => String(p).toLowerCase())]);
    for (const c of caps) {
      if (!c || c === CAPABILITY_PREFIX) continue;
      (by.get(c) ?? by.set(c, []).get(c)).push(a.id);
    }
  }
  return Object.fromEntries([...by].filter(([, ids]) => ids.length > 1));
}

/* ---------------------------------------------------------------- */
/*  Scoping — WHEN a modifier applies to a particular roll           */
/* ---------------------------------------------------------------- */

/** The three encounter tones (RR 84-87), shared by any consumer resolving a reaction roll. */
export const INFLUENCE_TONES = {
  diplomacy: { label: "Diplomacy" },
  intimidation: { label: "Intimidation" },
  seduction: { label: "Seduction" },
};

/**
 * How a target-alignment scope behaves: a `gate` applies only versus the named
 * alignment; a `sign` flips to a penalty versus everyone else. See
 * docs/lib/DECISIONS.md, "A target-alignment scope is a gate or a sign flip, and
 * they are different rules".
 */
export const SCOPE_ALIGNMENT_MODES = {
  gate: { label: "Only Versus This Alignment" },
  sign: { label: "Bonus Versus, Penalty Otherwise" },
};

/**
 * Does a scoped effect apply to this roll, and with which sign?
 *
 * The machine-decidable part of an effect's scope: which targets, which tone,
 * which optional rule (an effect's `condition` is free text for a human). Pure
 * and Foundry-free.
 *
 * `ctx` supplies what is known about the roll:
 *   kinds          Set|Array of the target's kind tokens (the consumer's own
 *                  vocabulary)
 *   alignment      the target's alignment (an ALIGNMENTS key)
 *   tone           the active INFLUENCE_TONES key, when it is an influence roll
 *   optionalRules  { [ruleName]: boolean } — absent means enabled
 *
 * Returns `{ applies, sign, undetermined }`. `undetermined` means a scope was
 * declared but `ctx` could not settle it, which is not a scope that failed:
 * callers offer an undetermined modifier as a manual toggle rather than
 * dropping or auto-applying it.
 */
export function scopeApplies(effect = {}, ctx = {}) {
  let sign = 1;
  let undetermined = false;

  const kinds = effect.vsKinds ?? [];
  if (kinds.length) {
    const have = ctx.kinds instanceof Set ? ctx.kinds : new Set(ctx.kinds ?? []);
    if (!have.size) undetermined = true;
    else if (![...kinds].some((k) => have.has(String(k).toLowerCase()))) return { applies: false, sign, undetermined: false };
  }

  if (effect.vsAlignment) {
    const mode = effect.vsAlignmentMode || "gate";
    if (!ctx.alignment) undetermined = true;
    else if (ctx.alignment !== effect.vsAlignment) {
      if (mode === "sign") sign = -1;
      else return { applies: false, sign, undetermined: false };
    }
  }

  const tones = effect.tones ?? [];
  if (tones.length) {
    if (!ctx.tone) undetermined = true;
    else if (!tones.includes(ctx.tone)) return { applies: false, sign, undetermined: false };
  }

  // An optional rule never registered is ON; only an explicit false switches it off.
  if (effect.optionalRule && ctx.optionalRules?.[effect.optionalRule] === false) {
    return { applies: false, sign, undetermined: false };
  }

  return { applies: !undetermined, sign, undetermined };
}

/**
 * What fires a Roll Outcome — the machine-decidable part of "on a roll of X".
 *
 * `naturalBand`   the unmodified die in 1..naturalMax; the band edge locates
 *                 per seat into `naturalMax`.
 * `belowFraction` the result below `belowFraction` × target; the fraction
 *                 locates per seat.
 * `failure`       the throw simply failed. No number: the target decides.
 *
 * One trigger per effect; a rule with two triggers is two outcome effects.
 */
export const OUTCOME_TRIGGERS = {
  naturalBand: { label: "Natural Roll In Band" },
  belowFraction: { label: "Result Below Fraction of Target" },
  failure: { label: "On Failure" },
};

/**
 * Does this outcome fire for the given roll? `null` when the effect is not an
 * outcome, when its trigger needs a number it does not carry, or when the caller
 * cannot supply what the trigger reads. A null is "cannot decide", never "no":
 * the consumer surfaces it rather than dropping the rule.
 */
export function outcomeFires(effect, { natural = null, total = null, target = null, success = null } = {}) {
  if (effect?.type !== "outcome") return null;
  switch (effect.trigger) {
    case "naturalBand":
      if (!Number.isFinite(effect.naturalMax) || !Number.isFinite(natural)) return null;
      return natural >= 1 && natural <= effect.naturalMax;
    case "belowFraction":
      if (!Number.isFinite(effect.belowFraction) || !Number.isFinite(total) || !Number.isFinite(target)) return null;
      return total < target * effect.belowFraction;
    case "failure":
      return typeof success === "boolean" ? !success : null;
    default:
      return null;
  }
}

/** Which of a reroll's results is kept. */
export const REROLL_KEEP = {
  better: { label: "Keep the Better" },
  worse: { label: "Keep the Worse" },
  latest: { label: "Keep the New Roll" }, // no choice — the reroll simply stands
};

/**
 * Resolve a reroll: given every result rolled, return the one that stands.
 *
 * "Better" follows the roll's direction: roll-high (`above`) keeps the maximum,
 * roll-low (`below`) the minimum, so pass the effect's own `rollType`.
 * Returns null on an empty result set. Pure and Foundry-free.
 */
export function resolveReroll(results, keep = "better", rollType = "above") {
  const vals = (results ?? []).filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!vals.length) return null;
  if (keep === "latest") return vals[vals.length - 1];
  const rollHigh = rollType !== "below";
  const wantMax = keep === "worse" ? !rollHigh : rollHigh;
  return wantMax ? Math.max(...vals) : Math.min(...vals);
}

/**
 * How many results a reroll effect produces in total (the original plus its
 * rerolls). `times` is the number of extra rolls and defaults to 1.
 */
export const rerollTotal = (effect) => 1 + Math.max(0, Math.trunc(effect?.times ?? 1));

/**
 * Scales a `conditional` value can key on, besides class level.
 *
 * `arcaneValue` / `divineValue` let a custom-class power state a cost that varies
 * by the class's spellcasting value. Nothing consumes them yet. See
 * docs/ROADMAP.md, "Spellcasting value as a conditional scale".
 */
export const VALUE_SCALES = {
  level: { label: "Class Level" },
  // How many times the proficiency has been taken, for those rated by rank
  // rather than by level.
  rank: { label: "Rank (times taken)" },
  arcaneValue: { label: "Arcane Value" },
  divineValue: { label: "Divine Value" },
  hitDice: { label: "Hit Dice" },
};

/**
 * The shapes a LevelValue can take — the discriminator every `levelValueField`
 * carries. `resolveLevelValue` (below) defines what each computes; the
 * field-builder and any editor offer this one list.
 */
export const VALUE_KINDS = {
  flat: { label: "Flat" },
  perLevel: { label: "Per Level" },
  breakpoints: { label: "Breakpoints" },
  progression: { label: "Progression" },
  conditional: { label: "Conditional on a Scale" },
};

/**
 * How a fractional level-scaled value is rounded. Absent means no rounding.
 */
export const VALUE_ROUNDING = {
  up: { label: "Round Up" },
  down: { label: "Round Down" },
};

/* ---------------------------------------------------------------- */
/*  Wear slots — where a piece of gear sits                          */
/* ---------------------------------------------------------------- */

/**
 * WEAR SLOTS — the canonical set of places a piece of gear can be worn or
 * wielded, and the family's single source for them (the equipment feature's
 * `WEAR` re-exports this).
 *
 * A slot is an exclusion: `capacity` is how many magic items the place takes,
 * which `item-model.mjs` `slotUse` counts against; what the body can physically
 * carry twice is a second count there. `capacity: null` means unlimited. See
 * docs/lib/DECISIONS.md, "A wear slot is an exclusion counted against magic
 * items".
 *
 * Keys are in display order, head to foot then off-body. Foundry-free: `icon`
 * is a Font Awesome class the sheet layers consume, and `label` is the English
 * fallback `choicesOf` feeds to DataModel `choices`. The displayed label is
 * localised from the key (`ACKS-EQUIPMENT.wear.<key>`, via `wearLabel`).
 */
export const WEAR_SLOTS = {
  head: { label: "Head", capacity: 1, icon: "fa-hat-wizard" }, // helmet, hat, crown
  neck: { label: "Neck", capacity: 1, icon: "fa-gem" }, // amulet, torc
  shoulders: { label: "Shoulders", capacity: 1, icon: "fa-user-tie" }, // cloak, cape, mantle
  body: { label: "Body", capacity: 1, icon: "fa-shirt" }, // the worn suit of armour
  worn: { label: "Worn", capacity: null, icon: "fa-mitten" }, // clothing and other worn-not-armour gear
  // Uncapped: several different forms hang from the belt, and from the back.
  belt: { label: "Belt", capacity: null, icon: "fa-grip-lines" }, // belt, girdle, sash — and the pouches on it
  ring: { label: "Ring", capacity: 2, icon: "fa-ring" },
  hands: { label: "Hands", capacity: 1, icon: "fa-hand-sparkles" }, // gloves, gauntlets, bracers
  feet: { label: "Feet", capacity: 1, icon: "fa-shoe-prints" }, // boots, sandals
  mainHand: { label: "Main Hand", capacity: 1, icon: "fa-hand-fist" },
  offHand: { label: "Off Hand", capacity: 1, icon: "fa-hand" },
  bothHands: { label: "Both Hands", capacity: 1, icon: "fa-hands" }, // one weapon wielded two-handed
  back: { label: "Back", capacity: null, icon: "fa-boxes-packing" }, // pack, rucksack, bowcase
  strapped: { label: "Strapped", capacity: 1, icon: "fa-shield-halved" }, // shield slung front or back
};

/** Display order for the worn slots, head to foot then off-body. */
export const WEAR_SLOT_ORDER = Object.freeze(Object.keys(WEAR_SLOTS));

/** The slot keys as named constants — `SLOT.mainHand` rather than "mainHand". */
export const SLOT = Object.freeze(Object.fromEntries(WEAR_SLOT_ORDER.map((k) => [k, k])));

/** Is this a slot key we know? */
export const isWearSlot = (key) => !!WEAR_SLOTS[key];

/**
 * How many items the slot holds. An unknown slot answers 1, neither 0 nor Infinity.
 */
export const slotCapacity = (key) => {
  if (!isWearSlot(key)) return 1;
  const cap = WEAR_SLOTS[key].capacity;
  return cap === null ? Infinity : cap;
};

/** Retrieval cost of a container's contents (RR pp. 293-294); per container, so it lives on the gear rather than the slot. */
export const ACCESS_COSTS = {
  free: { label: "Free" },
  action: { label: "Action in lieu of movement" },
};

/* ---------------------------------------------------------------- */
/*  LevelValue — the level-scaling spine                             */
/* ---------------------------------------------------------------- */

/**
 * A value that may be flat or a function of class level. Shapes:
 *   5                                  flat
 *   { kind:"perLevel", base, per }     base + per·(level-1)
 *   { kind:"breakpoints", breakpoints:[{atLevel,value}] }
 *   { kind:"progression", as, atLevel }   external class table
 *   { kind:"conditional", on, breakpoints:[{atLevel,value}] } keyed on a
 *                                      VALUE_SCALES scale instead of level
 *
 * A `conditional` reuses the breakpoint ladder verbatim, fed `scales[on]` in
 * place of class level, so `atLevel` reads "at this value of `on`".
 *
 * `round` ("up" | "down") applies to whatever the shape produces.
 *
 * `resolveLevelValue` returns the numeric value at `level`, or `null` when it
 * needs something the caller must supply — an external progression table (kind
 * "progression") or a scale absent from `scales` (kind "conditional"). Pure and
 * Foundry-free.
 */
export function resolveLevelValue(lv, level = 1, scales = {}) {
  if (lv == null) return null;
  if (typeof lv === "number") return lv;
  if (typeof lv !== "object") return null;
  const kind = lv.kind ?? inferLevelKind(lv);
  return applyRounding(rawLevelValue(lv, kind, level, scales), lv.round);
}

function rawLevelValue(lv, kind, level, scales) {
  switch (kind) {
    case "flat":
      return lv.flat ?? null;
    case "perLevel":
      return lv.base == null ? null : lv.base + (lv.per ?? 0) * (Math.max(1, level) - 1);
    case "breakpoints":
      return atBreakpoint(lv.breakpoints, level);
    case "conditional": {
      const at = lv.on === "level" ? level : scales?.[lv.on];
      return typeof at === "number" ? atBreakpoint(lv.breakpoints, at) : null;
    }
    case "progression":
      return null; // caller resolves via the referenced class table
    default:
      return null;
  }
}

/** Round as the page prints it. No `round` means the value is already exact. */
function applyRounding(value, round) {
  if (value == null || !Number.isFinite(value)) return value;
  if (round === "up") return Math.ceil(value);
  if (round === "down") return Math.floor(value);
  return value;
}

/** The last breakpoint value `at` reaches, or null below the first one. */
function atBreakpoint(breakpoints, at) {
  const rung = rungAt(breakpoints, at);
  return rung ? rung.value : null;
}

/** The last RUNG `at` reaches, whole — null below the first one. */
function rungAt(breakpoints, at) {
  let found = null;
  for (const bp of [...(breakpoints ?? [])].sort((a, b) => a.atLevel - b.atLevel)) {
    if (at >= bp.atLevel) found = bp;
  }
  return found;
}

/**
 * What a LevelValue comes to, as the whole answer rather than a number: the
 * rung's own verdict beside the target, where `resolveLevelValue`'s null cannot
 * tell no rung, an incomplete shape and a non-numeric rung apart.
 *
 * `outcome` is `"throw"` (roll against `target`), `"auto"` (it happens, no roll)
 * or `"none"` (not available at this rung). `text` is the cell as printed,
 * carried through for display. The numeric path still goes through
 * `resolveLevelValue`, so the two never disagree about a target. Pure and
 * Foundry-free; the classes registry completes the `progression` kind.
 *
 * @returns {{outcome: string, target: number|null, text: string}}
 */
export function resolveLevelOutcome(lv, level = 1, scales = {}) {
  const plain = (target) => ({ outcome: "throw", target, text: "" });
  if (lv == null || typeof lv !== "object") return plain(resolveLevelValue(lv, level, scales));
  const kind = lv.kind ?? inferLevelKind(lv);
  if (kind !== "breakpoints" && kind !== "conditional") return plain(resolveLevelValue(lv, level, scales));

  const at = kind === "conditional" ? (lv.on === "level" ? level : scales?.[lv.on]) : level;
  if (typeof at !== "number") return plain(null);
  const rung = rungAt(lv.breakpoints, at);
  // Below the first rung there is no cell, unlike a rung that says "not available".
  if (!rung) return plain(null);
  return rungOutcome(rung, applyRounding(rung.value, lv.round));
}

/**
 * One rung's verdict, with its own value already rounded. An outcome is
 * declared, never inferred from the cell's text; a rung that declares nothing is
 * a throw. See docs/abilities/DECISIONS.md, "A rung may say something other than
 * a number".
 */
function rungOutcome(rung, value) {
  const outcome = RUNG_OUTCOMES[rung?.outcome] ? rung.outcome : "throw";
  return { outcome, target: outcome === "throw" ? (value ?? null) : null, text: String(rung?.text ?? "") };
}

/**
 * A rung as a verdict, in the shape `resolveLevelOutcome` returns, for
 * consumers that find their own rung (the classes registry's published ladders).
 */
export const outcomeOfRung = (rung) => rungOutcome(rung, rung?.value ?? null);

function inferLevelKind(lv) {
  if (lv.on) return "conditional";
  if (lv.flat != null) return "flat";
  if (lv.base != null) return "perLevel";
  if (Array.isArray(lv.breakpoints)) return "breakpoints";
  if (lv.as || lv.progressionAs) return "progression";
  return "flat";
}
