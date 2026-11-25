/**
 * An encounter recipe read from a creature's own Combat and Ecology prose and
 * its encounter lines: the parts a group is made of, as data the recipe
 * engine evaluates (`extras.encounter.recipe`). Pure. The locators ship, every
 * figure and every creature word is read from the seat's own extracted prose,
 * and a sentence no locator reads adds no part. A creature whose prose yields
 * no part has no recipe at all: the unit sizes the encounter lines give join
 * only a recipe the prose started.
 *
 * Part shape (`monsters/monster-extras.mjs` declares it): `key`, `label` (the
 * word as printed), `role` (`RECIPE_ROLES`), `source` (the creature the part
 * is made of: `templateCell` names a Role cell of the family template, `name`
 * a creature as printed), `count` (`dice` or `literal`; `ratioOf` with
 * `percent` and `round` for a share of another part, `"unit"` being a share of
 * the units the sentence names, counted in whole units (the gangs of a
 * warband, the warbands of a lair or village) and rounded as printed;
 * `perUnit` for a count rolled once per unit),
 * `chance` (percent, null for always), `when` (the units, and state and place
 * where a line fixes them), `branch` (parts of one group are alternatives, a
 * band naming the share of a die where the page prints one), `moraleWhileAlive`
 * (a bonus while the part lives), `cite` and `basis` (`page`; `table` is the
 * evaluator's, for a printed table). A rounding the page does not print is
 * left blank. `origin` is `REGISTER_ORIGIN` on every part this reader writes: a
 * repair replaces a part that carries it and keeps one a hand changed (its
 * origin blank).
 *
 * Rulings and the part kinds: docs/monsters/MODEL.md, "The encounter recipe".
 */
import { roleKeyOf } from "./leader-roles.mjs";
import { REGISTER_ORIGIN } from "../lib/magic-vocab.mjs";

/** Where every part this reader writes was read from. */
export const RECIPE_BASIS = "page";

/** The unit words a sentence may name: a group the stat block's lines count. */
const UNIT = String.raw`(?:gang|warband|lair|village)`;
/** One or several units, joined by a comma, "or" or "and": "lairs and villages". */
const UNITS = String.raw`(${UNIT}s?(?:\s*(?:,|or|and)\s*${UNIT}s?)*)`;
/** A die, a sum on it, or a plain figure. */
const DICE = String.raw`(?:\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+)`;
/** A printed rank. */
const RANK = String.raw`(?:champion|sub-?\s?chieftain|chieftain)`;
/** A count word before a rank. */
const COUNT_WORD = String.raw`(?:an?|one|two|three|\d+)`;
/** A rounding note: "(round up)". */
const ROUND = /round(?:ed|ing)?\s+(up|down)/i;

const LEADER_RX = new RegExp(
  String.raw`\b(?:each|an?|the|every)\s+(?:[\p{L}'’-]+\s+){0,2}?${UNITS}\s+will\s+be\s+led\s+by\s+(?:(${COUNT_WORD})\s+)?(${RANK})s?\b`,
  "iu",
);
const MORALE_RX = new RegExp(
  String.raw`\bas\s+long\s+as\s+the\s+(${RANK})\s+is\s+(?:alive|living|not\s+slain)\s*,?\s+[^.]*?\b(?:gain|gains|receive|receives|have|has)\s+an?\s+([+-]\s*\d+)\s+(bonus|penalty)\s+to\s+morale`,
  "i",
);
const SPLIT_FIRST_RX = new RegExp(
  String.raw`(\d+)\s*%\s+of\s+(${UNIT}s?(?:\s*(?:,|or|and)\s*${UNIT}s?)*)\s+(?:\w+\s+)?will\s+be\s+(archers|warriors)\b(.*)$`,
  "i",
);
const SPLIT_NEXT_RX = /^\s*(?:\(\s*round[^)]*\))?\s*,?\s*(?:and\s+)?(\d+)\s*%\s+will\s+be\s+(archers|warriors)\b(.*)$/i;
const DEPENDANT_RX = new RegExp(
  String.raw`\b${UNITS}\s+will\s+have\s+(drudges?|whelps?)(?:\s*(?:,|and)\s*(drudges?|whelps?))?\s+equal\s+to\s+(\d+)\s*%(?:\s*(?:,|and)\s*(\d+)\s*%)?\s+of\s+(?:the\s+)?(?:number\s+of\s+)?(archers|warriors)\b(.*)$`,
  "i",
);
const GUARD_RX = new RegExp(
  String.raw`\bthere\s+is\s+an?\s+(\d+)\s*%\s+chance\s+(?:that\s+)?(?:an?|the)\s+(?:[\p{L}'’-]+\s+){0,2}?${UNITS}\s+will\s+be\s+(?:guarded|defended|protected)\s+by\s+(.+?)\s*\.?$`,
  "iu",
);
const GUARD_CLAUSE_RX = new RegExp(
  String.raw`^(?:(\d+)\s*%\s+chance\s+(?:for|of|(?:that\s+)?it\s+will\s+be\s+(?:guarded|defended|protected)\s+by|of\s+being\s+(?:guarded|defended|protected)\s+by)\s+)?(.+)$`,
  "i",
);
const BEAST_RX = new RegExp(String.raw`^(${DICE})\s+([\p{L}'’ -]+?)\s*$`, "iu");
const ESCORT_RX = new RegExp(
  String.raw`\bthe\s+(${RANK})\s+will\s+be\s+(?:defended|guarded|protected|attended)\s+by\s+(${DICE})\s+([\p{L}'’ -]+?)\s*(?:\(\s*equivalent\s+to\s+(${RANK})s?\s+statistically\s*\))?\s*\.?$`,
  "iu",
);
const CAPTIVE_RX = new RegExp(
  String.raw`\bthere\s+is\s+an?\s+(\d+)\s*%\s+chance\s+(?:for|of)\s+(${DICE})\s+([\p{L}'’ -]*?captives?)\s+per\s+(${UNIT})\b`,
  "iu",
);
const CASTER_RX = /(\d+)\s*%\s+chance\s+(?:of|to\s+have)\s+an?\s+(shaman|witch[\s-]*doctor)\b/gi;
const ENCOUNTERED_IN_RX = new RegExp(String.raw`\bencountered\s+in\s+an?\s+(${UNIT})\b`, "i");

/** A die or a figure with its spacing closed up, lowercase. */
const diceText = (s) => String(s).replace(/\s+/g, "").toLowerCase();

/** A count as the part's `count` object: a plain figure is a literal, anything else dice. */
const countOf = (s) => (/^\d+$/.test(diceText(s)) ? { literal: parseInt(diceText(s), 10) } : { dice: diceText(s) });

/** The unit nouns a phrase names, singular, in the order printed, each once. */
export function unitsIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(new RegExp(String.raw`\b(${UNIT})s?\b`, "gi"))) {
    const noun = m[1].toLowerCase();
    if (!out.includes(noun)) out.push(noun);
  }
  return out;
}

/** The leader count a word before a rank prints: an article or "one" is 1. */
function countWord(word) {
  const w = String(word ?? "").toLowerCase();
  if (!w || w === "a" || w === "an" || w === "one") return 1;
  if (w === "two") return 2;
  if (w === "three") return 3;
  return parseInt(w, 10) || 1;
}

/** The key a Role cell of the family template carries: `variant|role`, or the role alone with no variant. */
const cellOf = (variant, role) => (variant ? `${variant}|${role}` : role);

/** One part in the stored shape, every field present. `fixedHp` is always null here: only a Judge types one, and a stored figure then differs from the page's null. */
function part({ key, label = "", role, source = {}, count = {}, chance = null, units = [], state = "", place = "", branch = {}, moraleWhileAlive = null, cite = "" }) {
  return {
    key,
    origin: REGISTER_ORIGIN,
    label,
    role,
    source: { uuid: "", templateCell: "", stat: "", name: "", ...source },
    count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "", ...count },
    chance,
    when: { state, place, units: [...units] },
    branch: { group: "", band: "", ...branch },
    moraleWhileAlive,
    fixedHp: null,
    cite,
    basis: RECIPE_BASIS,
  };
}

/** Sentences of a paragraph, split where a full stop meets a capital or a bracket; the index a part's sentence report names. */
export const sentencesOf = (paragraph) =>
  String(paragraph ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[\p{Lu}(])/u)
    .filter(Boolean);

/** The parts the encounter lines' sizes make: a body count, or the units a side counts. */
function sizeParts(encounter, cite) {
  const out = [];
  for (const place of ["dungeon", "wilderness"]) {
    for (const state of ["wandering", "lair"]) {
      const side = encounter?.[place]?.[state];
      if (!side?.number) continue;
      const noun = String(side.noun ?? "").trim().toLowerCase();
      const unit = String(side.unit ?? "").trim().toLowerCase().replace(/s$/, "");
      out.push(
        part({
          key: `size-${place}-${state}`,
          label: noun,
          role: unit ? "unit" : "body",
          source: unit ? { name: unit } : {},
          count: countOf(side.number),
          units: noun ? [noun] : [],
          state,
          place,
          cite,
        }),
      );
    }
  }
  return out;
}

/** A creature word as a key segment: lowercase letters and digits, runs of anything else one hyphen. */
const wordKey = (word) =>
  String(word ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Every recipe part a creature's prose and encounter lines state. `combat` and
 * `ecology` are the creature's paragraphs of those sections, `encounter` its
 * parsed lines (`extras.encounter`), `variant` the key of the family variant
 * its Role cells are filed under, `cite` its page reference. An empty list
 * where no sentence is read.
 *
 * @param {{combat?: string[], ecology?: string[], encounter?: object|null, variant?: string, cite?: string}} [args]
 * @returns {object[]}
 */
export function readEcologyRecipe(args = {}) {
  return readEcologyRecipeWithSentences(args).parts;
}

/**
 * `readEcologyRecipe`'s parts, and beside them where each was read from:
 * `sentences` maps a part's key to every sentence that stated it, as
 * `{field, paragraph, sentence}` (`field` is `"combat"` or `"ecology"`,
 * `paragraph` the index in that argument's list, `sentence` the index among that
 * paragraph's `sentencesOf`). The first entry is the sentence that made the
 * part; a later one added a unit to it or its morale bonus. A part the
 * encounter lines made has no entry. The parts are the stored rows, so nothing
 * here changes what a recipe holds.
 *
 * @param {{combat?: string[], ecology?: string[], encounter?: object|null, variant?: string, cite?: string}} [args]
 * @returns {{parts: object[], sentences: Object<string, {field: string, paragraph: number, sentence: number}[]>}}
 */
export function readEcologyRecipeWithSentences({ combat = [], ecology = [], encounter = null, variant = "", cite = "" } = {}) {
  const parts = new Map();
  const sentences = {};
  let at = null;
  const touch = (key) => {
    const seen = (sentences[key] ??= []);
    if (!seen.some((r) => r.field === at.field && r.paragraph === at.paragraph && r.sentence === at.sentence)) seen.push({ ...at });
  };
  const add = (p) => {
    if (parts.has(p.key)) return;
    parts.set(p.key, p);
    touch(p.key);
  };
  const cell = (role) => ({ templateCell: cellOf(variant, role) });

  const paragraphs = [
    ...combat.map((text, paragraph) => ({ text, field: "combat", paragraph })),
    ...ecology.map((text, paragraph) => ({ text, field: "ecology", paragraph })),
  ];
  for (const { text: paragraph, field, paragraph: pi } of paragraphs) {
    let here = [];
    for (const [si, sentence] of sentencesOf(paragraph).entries()) {
      at = { field, paragraph: pi, sentence: si };
      const encountered = ENCOUNTERED_IN_RX.exec(sentence);
      if (encountered) here = [encountered[1].toLowerCase()];

      const split = SPLIT_FIRST_RX.exec(sentence);
      if (split) {
        const units = unitsIn(split[2]);
        add(part({ key: split[3].toLowerCase(), label: split[3], role: "body", count: { ratioOf: "unit", percent: parseInt(split[1], 10), round: ROUND.exec(split[4].split(",")[0])?.[1]?.toLowerCase() ?? "" }, units, cite }));
        const next = SPLIT_NEXT_RX.exec(split[4]);
        if (next) {
          add(part({ key: next[2].toLowerCase(), label: next[2], role: "body", count: { ratioOf: "unit", percent: parseInt(next[1], 10), round: ROUND.exec(next[3])?.[1]?.toLowerCase() ?? "" }, units, cite }));
        }
      }

      const lead = LEADER_RX.exec(sentence);
      if (lead) {
        const role = roleKeyOf(lead[3]);
        if (role) {
          const key = `leader-${role}`;
          const have = parts.get(key);
          if (have) {
            for (const u of unitsIn(lead[1])) {
              if (have.when.units.includes(u)) continue;
              have.when.units.push(u);
              touch(key);
            }
          } else {
            add(part({ key, label: lead[3], role: "leader", source: cell(role), count: { literal: countWord(lead[2]) }, units: unitsIn(lead[1]), cite }));
          }
        }
      }

      const morale = MORALE_RX.exec(sentence);
      if (morale) {
        const role = roleKeyOf(morale[1]);
        const holder = role ? parts.get(`leader-${role}`) : null;
        if (holder && holder.moraleWhileAlive == null) {
          holder.moraleWhileAlive = parseInt(morale[2].replace(/\s+/g, ""), 10);
          touch(holder.key);
        }
      }

      const dep = DEPENDANT_RX.exec(sentence);
      if (dep) {
        const words = [dep[2], dep[3]].filter(Boolean);
        const figures = [dep[4], dep[5]].filter(Boolean);
        const round = ROUND.exec(dep[7])?.[1]?.toLowerCase() ?? "";
        words.forEach((word, i) => {
          const role = word.toLowerCase().replace(/s$/, "");
          const percent = parseInt(figures[i] ?? figures[0], 10);
          if (!Number.isFinite(percent)) return;
          add(part({ key: `dependant-${role}`, label: word, role: "dependant", source: cell(role), count: { ratioOf: dep[6].toLowerCase(), percent, round }, units: unitsIn(dep[1]), cite }));
        });
      }

      const escort = ESCORT_RX.exec(sentence);
      if (escort) {
        const equal = escort[4] ? roleKeyOf(escort[4]) : null;
        add(part({ key: "chieftain-guard", label: escort[3].trim(), role: "guard", source: equal ? cell(equal) : { name: escort[3].trim() }, count: countOf(escort[2]), units: here, cite }));
      }

      const guard = GUARD_RX.exec(sentence);
      if (guard) {
        const units = unitsIn(guard[2]);
        const clauses = guard[3].split(/\s+(?:and|,)\s+(?:(?:another|an?)\s+)?(?=\d+\s*%\s+chance)/i);
        clauses.forEach((clause, ci) => {
          const m = GUARD_CLAUSE_RX.exec(clause.trim());
          if (!m) return;
          const chance = parseInt(m[1] ?? guard[1], 10);
          const alternatives = m[2].split(new RegExp(String.raw`\s+or\s+(?=${DICE}\b)`, "i"));
          alternatives.forEach((alt) => {
            const beast = BEAST_RX.exec(alt.trim());
            if (!beast) return;
            // Keyed by the creature word as printed, so a re-read keeps a part's key in any order; the same word again takes a numbered suffix.
            const base = `guard-${wordKey(beast[2])}`;
            let key = base;
            for (let n = 2; parts.has(key); n++) key = `${base}-${n}`;
            add(part({
              key, label: beast[2], role: "guard", source: { name: beast[2] }, count: countOf(beast[1]), chance, units,
              branch: alternatives.length > 1 ? { group: `guard-or-${ci + 1}` } : {}, cite,
            }));
          });
        });
      }

      const captive = CAPTIVE_RX.exec(sentence);
      if (captive) {
        add(part({ key: "captives", label: captive[3], role: "captive", source: { name: captive[3] }, count: { ...countOf(captive[2]), perUnit: captive[4].toLowerCase() }, chance: parseInt(captive[1], 10), units: here, cite }));
      }

      for (const m of sentence.matchAll(CASTER_RX)) {
        const role = /witch/i.test(m[2]) ? "witchDoctor" : "shaman";
        const before = unitsIn(sentence.slice(0, m.index));
        add(part({ key: `caster-${role}`, label: m[2], role: "caster", source: cell(role), count: { literal: 1 }, chance: parseInt(m[1], 10), units: before.length ? [before[before.length - 1]] : here, cite }));
      }
    }
  }
  if (!parts.size) return { parts: [], sentences: {} };
  return { parts: [...sizeParts(encounter, cite), ...parts.values()], sentences };
}

/** The part kinds the local check counts, by the key a reader gives each. */
export function partKind(p) {
  const key = String(p?.key ?? "");
  if (key.startsWith("size-")) return "size";
  if (key === "archers" || key === "warriors") return "split";
  if (key.startsWith("leader-")) return "leader";
  if (key.startsWith("dependant-")) return "dependant";
  if (key === "chieftain-guard") return "chieftainGuard";
  if (key.startsWith("guard-")) return "guard";
  if (key === "captives") return "captive";
  if (key.startsWith("caster-")) return "caster";
  return "other";
}

/**
 * `extras` with `encounter.recipe` set to `recipe`, or `extras` as it is when
 * there is none, so a creature whose prose yields no part is unchanged.
 */
export function attachRecipe(extras, recipe) {
  if (!recipe?.length) return extras;
  return { ...extras, encounter: { ...(extras?.encounter ?? {}), recipe } };
}

/**
 * The `cookbook` stamp's `read` node that keeps the recipe as the import read
 * it (`cookbook.read.recipe`), whole: the copy a held part is compared with and
 * reset from. `{}` where nothing was read, unless `replace` is set, which
 * writes an empty copy so a repair's update (it merges objects, replaces
 * arrays) clears one a former read left.
 * @param {object[]} recipe the parts `readEcologyRecipe` returned
 * @param {{replace?: boolean}} [options]
 * @returns {{read?: {recipe: object[]}}}
 */
export function recipeReadStamp(recipe, { replace = false } = {}) {
  const parts = Array.isArray(recipe) ? recipe : [];
  if (!parts.length && !replace) return {};
  return { read: { recipe: structuredClone(parts) } };
}

/**
 * The printed variant label a family declares for a member entry, or null for
 * an entry in no family. `cookbooks` are the loaded cookbooks; the caller
 * folds the label to the key the family template files its cells under.
 */
export function memberVariant(id, cookbooks) {
  for (const cb of cookbooks ?? []) {
    for (const fam of Object.values(cb?.families ?? {})) {
      const member = (fam.members ?? []).find((m) => m.id === id);
      if (member) return member.variant ?? null;
    }
  }
  return null;
}
