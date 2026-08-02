/* global game */
/**
 * Racial & cross-species reaction support (docs/RACIAL_REACTIONS_PLAN.md):
 *  - kind typing: what races/categories an actor belongs to, read from the
 *    class name (characters) or the acks-monsters enhanced sheet (monsters);
 *  - the asymmetric campaign race-relations registry (world setting + api);
 *  - the RAW hard-hatred pairs (chat notes only, never forced results);
 *  - optional-rule gating for compendium effects (BTA dwarven caste).
 */
import { MODULE_ID } from "./constants.mjs";

/** Normalize a race/kind token to a lowercase slug ("Demi-Human " → "demi-human"). */
export function slugKind(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** Parse a comma-separated kind list into slug tokens. */
export function parseKindList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw.map(slugKind).filter(Boolean);
}

/** Infer race from the class name (ACKS has no race field); defaults to human. */
export function inferRace(actor) {
  const cls = String(actor?.system?.details?.class ?? "").toLowerCase();
  if (/dwarv|dwarf/.test(cls)) return "dwarf";
  if (/elv|elf/.test(cls)) return "elf";
  if (/gnom/.test(cls)) return "gnome";
  if (/nobiran/.test(cls)) return "nobiran";
  if (/zahar/.test(cls)) return "zaharan";
  if (/thrassian|lizard/.test(cls)) return "lizardman";
  if (/beastman|bugbear|gnoll|goblin|hobgoblin|kobold|orc/.test(cls)) return "beastman";
  return "human";
}

const DEMI_HUMAN_RACES = new Set(["dwarf", "elf", "gnome"]);
// Races of men (count as human for Inhumanity-style "humans and demi-humans").
const HUMAN_RACES = new Set(["human", "nobiran", "zaharan"]);
// Specific beastman kinds recognisable from a monster's name/subtype.
const BEASTMAN_KINDS = ["hobgoblin", "goblin", "kobold", "orc", "gnoll", "bugbear", "ogre", "troll"];

/** Name/subtype matchers for monsters without (or beyond) acks-monsters typing. */
const NAME_KIND_MATCHERS = [
  ["hobgoblin", /hobgoblin/],
  ["goblin", /(?:^|[^b])goblin/], // avoid matching "hobgoblin"
  ["kobold", /kobold/],
  ["orc", /\borc/],
  ["gnoll", /gnoll/],
  ["bugbear", /bugbear/],
  ["ogre", /\bogre/],
  ["troll", /\btroll/],
  ["lizardman", /lizard\s*m[ae]n|thrassian/],
  ["dwarf", /dwarv|dwarf/],
  ["elf", /\belv(?:es|en|ish)?\b|\belf\b/],
  ["gnome", /\bgnome/],
];

/**
 * The race and category tokens an actor belongs to, for `vs`-scoped effects,
 * the race-relations registry, and the hard-hatred notes.
 *
 * Characters: race inferred from class; dwarves/elves/gnomes also count as
 * `demi-human`, races of men as `human`. Monsters: `monster`, plus the
 * acks-monsters enhanced-sheet typing (`flags.acks-monsters.extras.types` and
 * `.subtype`) when present, plus name-recognised kinds (goblin, dwarf, …).
 *
 * @returns {{race: string, categories: Set<string>}}
 */
export function kindOf(actor) {
  const categories = new Set();
  if (!actor) return { race: "", categories };

  if (actor.type === "character") {
    const race = inferRace(actor);
    categories.add(race);
    if (DEMI_HUMAN_RACES.has(race)) categories.add("demi-human");
    if (HUMAN_RACES.has(race)) categories.add("human");
    if (race === "beastman") categories.add("beastman");
    return { race, categories };
  }

  // Monster (or any non-character actor).
  categories.add("monster");
  let race = "";

  // acks-monsters enhanced sheet typing, when the module is in use.
  const extras = actor.flags?.["acks-monsters"]?.extras ?? null;
  const types = extras?.types;
  const typeList = types instanceof Set ? [...types] : Array.isArray(types) ? types : [];
  for (const t of typeList) {
    const token = slugKind(t);
    if (token) categories.add(token);
  }
  const subtype = slugKind(extras?.subtype);
  if (subtype) {
    categories.add(subtype);
    race = subtype;
  }

  // Name/class recognition (covers un-typed monsters; MM dwarf/goblin actors).
  const name = `${actor.name ?? ""} ${actor.system?.details?.class ?? ""}`.toLowerCase();
  for (const [token, re] of NAME_KIND_MATCHERS) {
    if (re.test(name)) {
      categories.add(token);
      if (!race) race = token;
    }
  }

  // Umbrella categories derived from specific kinds.
  for (const kind of BEASTMAN_KINDS) if (categories.has(kind)) categories.add("beastman");
  if (categories.has("dwarf") || categories.has("elf") || categories.has("gnome")) categories.add("demi-human");

  return { race, categories };
}

/** True when any of the (already-slugged) `tokens` is among `categories`. */
export function matchesKind(categories, tokens) {
  if (!categories || !tokens?.length) return false;
  return tokens.some((t) => categories.has(t));
}

/* -------------------------------------------- */
/*  Campaign race-relations registry            */
/* -------------------------------------------- */

/**
 * Directional relation rows registered by modules/macros via
 * api.registerRaceRelations. World-setting rows take precedence over these on
 * an exact from+to collision. Rows: { from, to, value, label? } — `from` is the
 * influencer's race/category, `to` the target's; NOT symmetric.
 */
const registeredRelations = [];

/** Register campaign race-relation rows (e.g. from a setting module at ready). */
export function registerRaceRelations(rows, { source = "api" } = {}) {
  if (!Array.isArray(rows)) return 0;
  let added = 0;
  for (const row of rows) {
    const from = slugKind(row?.from);
    const to = slugKind(row?.to);
    const value = Number(row?.value) || 0;
    if (!from || !to || !value) continue;
    registeredRelations.push({ from, to, value, label: row.label ? String(row.label) : "", source });
    added++;
  }
  return added;
}

/** Rows from the GM-editable world setting (JSON array); tolerant of bad JSON. */
function settingRelations() {
  try {
    const raw = game.settings.get(MODULE_ID, "raceRelations");
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        from: slugKind(row?.from),
        to: slugKind(row?.to),
        value: Number(row?.value) || 0,
        label: row?.label ? String(row.label) : "",
        source: "setting",
      }))
      .filter((r) => r.from && r.to && r.value);
  } catch {
    return [];
  }
}

/**
 * Resolve the campaign relation modifier for influencer→target, best match
 * first: an exact race token scores over a category token on each side;
 * setting rows beat registered rows on equal score. Returns null when nothing
 * matches (never sums multiple rows — use the GM bucket for stacking cases).
 *
 * @param {{race: string, categories: Set<string>}} influencerKind
 * @param {{race: string, categories: Set<string>}} targetKind
 * @returns {{value: number, label: string}|null}
 */
export function relationFor(influencerKind, targetKind) {
  if (!influencerKind?.categories?.size || !targetKind?.categories?.size) return null;
  const score = (kind, token) => (token === kind.race ? 2 : kind.categories.has(token) ? 1 : 0);
  let best = null;
  let bestScore = 0;
  // Setting rows first: on equal score, the earlier candidate wins.
  for (const row of [...settingRelations(), ...registeredRelations]) {
    const sFrom = score(influencerKind, row.from);
    if (!sFrom) continue;
    const sTo = score(targetKind, row.to);
    if (!sTo) continue;
    const s = sFrom + sTo;
    if (s > bestScore) {
      best = row;
      bestScore = s;
    }
  }
  return best ? { value: best.value, label: best.label } : null;
}

/* -------------------------------------------- */
/*  RAW hard hatreds (notes only)               */
/* -------------------------------------------- */

/**
 * MM automatic-reaction pairs. Surfaced as chat-card notes when the two sides
 * match — never as forced results or modifiers (RAW-note policy).
 */
const RACIAL_HATREDS = [
  { a: "dwarf", b: "goblin", note: "ACKS-INFLUENCE.note.hatredDwarfGoblin" },
  { a: "gnome", b: "kobold", note: "ACKS-INFLUENCE.note.hatredGnomeKobold" },
];

/** Localization keys of hard-hatred notes that apply to this pairing. */
export function hatredNotes(influencerCategories, targetCategories) {
  const notes = [];
  for (const { a, b, note } of RACIAL_HATREDS) {
    const forward = influencerCategories?.has(a) && targetCategories?.has(b);
    const reverse = influencerCategories?.has(b) && targetCategories?.has(a);
    if (forward || reverse) notes.push(note);
  }
  return notes;
}

/* -------------------------------------------- */
/*  Optional-rule gating                        */
/* -------------------------------------------- */

/** Map of `optionalRule` effect-flag values to their world-setting keys. */
const OPTIONAL_RULE_SETTINGS = { btaCaste: "enableBtaCaste" };

/** Whether an optional rule (e.g. BTA dwarven caste) is enabled in this world. */
export function optionalRuleEnabled(rule) {
  const key = OPTIONAL_RULE_SETTINGS[String(rule)];
  if (!key) return true; // unknown rules are never silently disabled
  try {
    return game.settings.get(MODULE_ID, key) !== false;
  } catch {
    return true; // setting not registered (harness/tests) — default on
  }
}
