/* global game */
/**
 * Racial & cross-species reaction support (docs/influence/DECISIONS.md,
 * "Racial and cross-species reactions ship strict-RAW"):
 *  - kind typing: what races/categories an actor belongs to, read from the
 *    classes feature (characters) or the Full Monster Sheet (monsters), through
 *    lib's creature-kind reader;
 *  - the asymmetric campaign race-relations registry (world setting + api);
 *  - the RAW hard-hatred pairs (chat notes only, never forced results);
 *  - optional-rule gating for compendium effects (BTA dwarven caste).
 */
import { MODULE_ID } from "./constants.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
import { DEMI_HUMAN_RACES, creatureKinds, kindToken, raceOfCharacter } from "../lib/actor-read.mjs";

/** Parse a comma-separated kind list into slug tokens. */
export function parseKindList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw.map(kindToken).filter(Boolean);
}

// Specific beastman kinds a monster's typing can name; each also counts as the beastman category.
const BEASTMAN_KINDS = ["hobgoblin", "goblin", "kobold", "orc", "gnoll", "bugbear", "ogre", "troll"];

/**
 * The race and category tokens an actor belongs to, for `vs`-scoped effects,
 * the race-relations registry, and the hard-hatred notes. The tokens are lib's
 * `creatureKinds` reading, so what a creature is typed as here is what every
 * other kind-scoped reader sees: nothing is guessed from a name.
 *
 * Characters: the race key their class answers through the classes feature
 * (`raceOfCharacter`) and its category; a class that names no race carries
 * neither (empty `race`, no categories). Monsters: `monster`, the enhanced-sheet
 * types and the subtype (`flags.acks-extras.extras`), the first subtype word
 * as the race, and the umbrella categories a typed kind falls under (the
 * beastman kinds, `demi-human` for the demi-human races).
 *
 * @returns {{race: string, categories: Set<string>}}
 */
export function kindOf(actor) {
  const categories = new Set();
  if (!actor) return { race: "", categories };
  const kinds = creatureKinds(actor);

  if (actor.type === ACTOR_TYPE.character) {
    kinds.delete("character");
    for (const kind of kinds) categories.add(kind);
    const race = raceOfCharacter(actor);
    if (race === "beastman") categories.add("beastman");
    return { race, categories };
  }

  // Monster (or any non-character actor).
  categories.add("monster");
  for (const kind of kinds) categories.add(kind);
  const race = kindToken(String(actor.getFlag?.(MODULE_ID, "extras")?.subtype ?? "").split(",")[0]);

  // Umbrella categories derived from specific kinds.
  for (const kind of BEASTMAN_KINDS) if (categories.has(kind)) categories.add("beastman");
  for (const kind of DEMI_HUMAN_RACES) if (categories.has(kind)) categories.add("demi-human");

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
    const from = kindToken(row?.from);
    const to = kindToken(row?.to);
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
        from: kindToken(row?.from),
        to: kindToken(row?.to),
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
