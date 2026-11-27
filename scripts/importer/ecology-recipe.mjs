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
 * `perUnit` for a count rolled once per unit; `forEvery` with `ratioOf` and a
 * `dice` or `literal` for a count thrown once for every so many of `ratioOf`,
 * `RECIPE_BODIES` naming every body of the unit),
 * `chance` (percent, null for always), `when` (the units, and state and place
 * where a line fixes them, or a guard sentence names its one place), `branch` (parts of one group are alternatives, a
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
import { RECIPE_BODIES } from "../monsters/config.mjs";

/** Where every part this reader writes was read from. */
export const RECIPE_BASIS = "page";

/** The unit words every creature's sentences may name: a group the stat block's lines count. */
const BASE_UNITS = ["gang", "warband", "lair", "village"];
/** A die, a sum on it, or a plain figure. */
const DICE = String.raw`(?:\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+)`;
/** A printed rank. */
const RANK = String.raw`(?:champion|sub-?\s?chieftain|chieftain)`;
/** A count word before a rank. */
const COUNT_WORD = String.raw`(?:an?|one|two|three|\d+)`;
/** A rounding note: "(round up)". */
const ROUND = /round(?:ed|ing)?\s+(up|down)/i;

const MORALE_RX = new RegExp(
  String.raw`\bas\s+long\s+as\s+the\s+(${RANK})\s+is\s+(?:alive|living|not\s+slain)\s*,?\s+[^.]*?\b(?:gain|gains|receive|receives|have|has)\s+an?\s+([+-]\s*\d+)\s+(bonus|penalty)\s+to\s+morale`,
  "i",
);
const SPLIT_NEXT_RX = /^\s*(?:\(\s*round[^)]*\))?\s*,?\s*(?:and\s+)?(\d+)\s*%\s+will\s+be\s+(archers|warriors)\b(.*)$/i;
/** What a guard sentence says its beasts do: they guard the place, or are kept in its kennel. */
const GUARDING = String.raw`(?:be\s+(?:guarded|defended|protected)\s+by|have\s+an?\s+kennel\s+(?:with|of))`;
const GUARD_CLAUSE_RX = new RegExp(
  String.raw`^(?:(\d+)\s*%\s+chance\s+(?:for|of|(?:that\s+)?it\s+will\s+be\s+(?:guarded|defended|protected)\s+by|of\s+being\s+(?:guarded|defended|protected)\s+by|(?:the|an?)\s+(?:[\p{L}'’-]+\s+){0,3}?will\s+${GUARDING})\s+)?(.+)$`,
  "iu",
);
/** The words a dependant share is written for, each singular or plural. */
const DEPENDANT_WORD = String.raw`(?:drudges?|whelps?|eggs?|children|child|females?|noncombatants?)(?:\s*\([^)]*\))?`;
/** The role a dependant word names: its singular, a bracketed note after it dropped. */
const dependantRole = (word) => String(word).toLowerCase().replace(/\s*\(.*$/, "").replace(/^children$/, "child").replace(/s$/, "");
/** The bodies a share may count: the rank and file, by the word the page uses for them. */
const SHARE_BASE = String.raw`(?:archers|warriors|males)`;
/** A rank that a leader sentence names, alone. */
const RANK_ALONE = new RegExp(String.raw`^${RANK}s?$`, "i");
/** A figure's word before a noun in a list: an article or a number word. */
const COUNT_ITEM = String.raw`(an?|one|two|three)`;
const BEAST_RX = new RegExp(String.raw`^(${DICE})\s+([\p{L}'’ -]+?)\s*$`, "iu");
const ESCORT_RX = new RegExp(
  String.raw`\bthe\s+(${RANK})\s+will\s+be\s+(?:defended|guarded|protected|attended)\s+by\s+(${DICE})\s+([\p{L}'’ -]+?)\s*(?:\(\s*equivalent\s+to\s+(${RANK})s?\s+statistically\s*\))?\s*\.?$`,
  "iu",
);
/** A rank's escort written as a list: "the chieftain will be accompanied by <item>, <item> and <item>". */
const ACCOMPANIED_RX = new RegExp(String.raw`\bthe\s+(${RANK})\s+will\s+be\s+(?:accompanied|escorted)\s+by\s+(.+?)\s*\.?$`, "iu");
/** One item of such a list: a die or a count word, a noun, and a unit it is counted for. */
const ESCORT_ITEM_RX = new RegExp(String.raw`^(?:(${DICE})|${COUNT_ITEM})\s+(?:(?:additional|extra)\s+)?([\p{L}'’ -]+?)(?:\s+for\s+every\s+([\p{L}'’-]+))?$`, "iu");
/** The place a sentence puts a group in, where it names one: the stat block's own two places. */
const PLACE_RX = /\b(dungeon|wilderness)\b/gi;
const CASTER_RX = /(\d+)\s*%\s+chance\s+(?:of|to\s+have)\s+an?\s+(shaman|witch[\s-]*doctor)\b/gi;

/**
 * The unit words an encounter's lines add to the fixed ones: the noun and the
 * unit of every side, singular, one plain word each. A creature whose lines
 * count in a group the fixed list lacks has its sentences read against that
 * word too, since the evaluator treats every word of the lines as a unit.
 * @param {object|null} encounter `extras.encounter`
 * @returns {string[]}
 */
export function unitWordsOf(encounter) {
  const out = [];
  for (const place of ["dungeon", "wilderness"]) {
    for (const state of ["wandering", "lair"]) {
      const side = encounter?.[place]?.[state];
      if (!side?.number) continue;
      for (const raw of [side.noun, side.unit]) {
        const word = String(raw ?? "").trim().toLowerCase().replace(/(?<!s)s$/, "");
        if (/^\p{L}[\p{L}-]{2,}$/u.test(word) && !BASE_UNITS.includes(word) && !out.includes(word)) out.push(word);
      }
    }
  }
  return out;
}

/** The locators that name a unit, built over the fixed unit words and any extra; one set per vocabulary. */
const LOCATORS = new Map();

/**
 * The regexes that read a unit word, over the fixed words and `extra`. `units`
 * is the capture of one or several units joined by a comma, "or" or "and"
 * ("lairs and villages"); `word` matches a single unit word.
 * @param {string[]} [extra]
 */
function locators(extra = []) {
  const words = [...new Set([...BASE_UNITS, ...extra])].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const id = words.join("|");
  const hit = LOCATORS.get(id);
  if (hit) return hit;
  const UNIT = `(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join("|")})`;
  const UNITS = String.raw`(${UNIT}s?(?:\s*(?:,|or|and)\s*${UNIT}s?)*)`;
  const built = {
    word: new RegExp(String.raw`\b(${UNIT})s?\b`, "gi"),
    leader: new RegExp(
      String.raw`\b(?:each|an?|the|every)\s+(?:[\p{L}'’-]+\s+){0,2}?${UNITS}\s+will\s+be\s+(?:led|ruled)\s+by\s+(?:(${COUNT_WORD})\s+)?(?:[\p{L}'’-]+,?\s+){0,3}?(${RANK})s?\b`,
      "iu",
    ),
    splitFirst: new RegExp(
      String.raw`(\d+)\s*%\s+of\s+(${UNIT}s?(?:\s*(?:,|or|and)\s*${UNIT}s?)*)\s+(?:\w+\s+)?will\s+be\s+(archers|warriors)\b(.*)$`,
      "i",
    ),
    dependant: new RegExp(
      String.raw`\b(?:${UNITS}\s+will\s+have|there\s+will\s+be)\s+(${DEPENDANT_WORD})(?:\s*(?:,|and)\s*(${DEPENDANT_WORD}))?\s+equal\s+to\s+(\d+)\s*%(?:\s*(?:,|and)\s*(\d+)\s*%)?\s+(?:of\s+)?(?:the\s+)?(?:number\s+of\s+)?(${SHARE_BASE})\b(.*)$`,
      "i",
    ),
    dependantEvery: new RegExp(
      String.raw`\b(?:([\p{L}'’-]+)\s+)?${UNITS}\s+will\s+have\s+(${DICE})\s+(drudges?|whelps?)(?:\s*(?:,|and)\s*(${DICE})\s+(drudges?|whelps?))?\s+for\s+every\s+(\d+)\s+([\p{L}'’-]+)\b(.*)$`,
      "iu",
    ),
    guard: new RegExp(
      String.raw`\bthere\s+is\s+an?\s+(\d+)\s*%\s+chance\s+(?:that\s+)?(?:an?|the)\s+(?:[\p{L}'’-]+\s+){0,2}?${UNITS}\s+will\s+${GUARDING}\s+(.+?)\s*\.?$`,
      "iu",
    ),
    captive: new RegExp(
      String.raw`\bthere\s+is\s+an?\s+(\d+)\s*%\s+chance\s+(?:for|of)\s+(${DICE})\s+([\p{L}'’ -]*?captives?)\s+per\s+(${UNIT})\b`,
      "iu",
    ),
    encounteredIn: new RegExp(String.raw`\bencountered\s+in\s+an?\s+(${UNIT})\b`, "i"),
  };
  LOCATORS.set(id, built);
  return built;
}

/** A die or a figure with its spacing closed up, lowercase. */
const diceText = (s) => String(s).replace(/\s+/g, "").toLowerCase();

/** A count as the part's `count` object: a plain figure is a literal, anything else dice. */
const countOf = (s) => (/^\d+$/.test(diceText(s)) ? { literal: parseInt(diceText(s), 10) } : { dice: diceText(s) });

/**
 * The unit nouns a phrase names, singular, in the order printed, each once.
 * `extra` are the words a creature's own lines add (`unitWordsOf`).
 */
export function unitsIn(text, extra = []) {
  const out = [];
  for (const m of String(text ?? "").matchAll(locators(extra).word)) {
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
    count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "", forEvery: null, ...count },
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

/** The letters of a word, lowercase: how a plural is compared with the name it pluralises. */
const letters = (w) => String(w ?? "").toLowerCase().replace(/[^\p{L}]+/gu, "");

/** Whether `word` is the plural (or the name itself) of the creature called `name`. */
function pluralOf(word, name) {
  const w = letters(word);
  const n = letters(name);
  if (!w || !n) return false;
  return [n, `${n}s`, `${n}es`, n.replace(/man$/, "men"), n.replace(/f$/, "ves"), n.replace(/y$/, "ies")].includes(w);
}

/**
 * What a for-every sentence counts, as a part's `count.ratioOf`: the printed
 * `archers` or `warriors` where the page names them, `RECIPE_BODIES` (every
 * body of the unit) where it names the creature's own kind, and "" where it
 * names anything else, so a count of something other than the creature's own
 * bodies adds no part. The creature's own name is any of `names`: the word the
 * sentence puts before its unit, and the entry's variant key.
 */
function ratioOfWord(word, names) {
  const w = String(word ?? "").toLowerCase();
  if (w === "archers" || w === "warriors") return w;
  return names.some((name) => pluralOf(w, name)) ? RECIPE_BODIES : "";
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
 * here changes what a recipe holds. A creature's recipe starts from the fixed
 * unit words alone; once they have started one, the unit words its own lines
 * name (`unitWordsOf`) scope its parts and add the parts only they reach.
 *
 * @param {{combat?: string[], ecology?: string[], encounter?: object|null, variant?: string, cite?: string}} [args]
 * @returns {{parts: object[], sentences: Object<string, {field: string, paragraph: number, sentence: number}[]>}}
 */
export function readEcologyRecipeWithSentences({ combat = [], ecology = [], encounter = null, variant = "", cite = "" } = {}) {
  const args = { combat, ecology, variant, cite };
  const started = readPass(args, []);
  if (!started.parts.size) return { parts: [], sentences: {} };
  const extra = unitWordsOf(encounter);
  const { parts, sentences } = extra.length ? readPass(args, extra) : started;
  return { parts: [...sizeParts(encounter, cite), ...parts.values()], sentences };
}

/** One read of the prose over the fixed unit words and `extra`: the parts by key, and each part's sentences. */
function readPass({ combat, ecology, variant, cite }, extra) {
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
  const rx = locators(extra);
  const unitsOf = (text) => unitsIn(text, extra);

  const paragraphs = [
    ...combat.map((text, paragraph) => ({ text, field: "combat", paragraph })),
    ...ecology.map((text, paragraph) => ({ text, field: "ecology", paragraph })),
  ];
  for (const { text: paragraph, field, paragraph: pi } of paragraphs) {
    let here = [];
    for (const [si, sentence] of sentencesOf(paragraph).entries()) {
      at = { field, paragraph: pi, sentence: si };
      const encountered = rx.encounteredIn.exec(sentence);
      if (encountered) here = [encountered[1].toLowerCase()];

      const split = rx.splitFirst.exec(sentence);
      if (split) {
        const units = unitsOf(split[2]);
        add(part({ key: split[3].toLowerCase(), label: split[3], role: "body", count: { ratioOf: "unit", percent: parseInt(split[1], 10), round: ROUND.exec(split[4].split(",")[0])?.[1]?.toLowerCase() ?? "" }, units, cite }));
        const next = SPLIT_NEXT_RX.exec(split[4]);
        if (next) {
          add(part({ key: next[2].toLowerCase(), label: next[2], role: "body", count: { ratioOf: "unit", percent: parseInt(next[1], 10), round: ROUND.exec(next[3])?.[1]?.toLowerCase() ?? "" }, units, cite }));
        }
      }

      const lead = rx.leader.exec(sentence);
      if (lead) {
        const role = roleKeyOf(lead[3]);
        if (role) {
          const key = `leader-${role}`;
          const have = parts.get(key);
          if (have) {
            for (const u of unitsOf(lead[1])) {
              if (have.when.units.includes(u)) continue;
              have.when.units.push(u);
              touch(key);
            }
          } else {
            add(part({ key, label: lead[3], role: "leader", source: cell(role), count: { literal: countWord(lead[2]) }, units: unitsOf(lead[1]), cite }));
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

      const dep = rx.dependant.exec(sentence);
      if (dep) {
        const words = [dep[2], dep[3]].filter(Boolean);
        const figures = [dep[4], dep[5]].filter(Boolean);
        const round = ROUND.exec(dep[7])?.[1]?.toLowerCase() ?? "";
        // Written as "there will be", the unit is the one the sentence ends on; a sentence that names none adds no part.
        const units = unitsOf(dep[1] ?? dep[7]);
        if (units.length) {
          words.forEach((word, i) => {
            const role = dependantRole(word);
            const percent = parseInt(figures[i] ?? figures[0], 10);
            if (!Number.isFinite(percent)) return;
            add(part({ key: `dependant-${role}`, label: word.replace(/\s*\(.*$/, ""), role: "dependant", source: cell(role), count: { ratioOf: dep[6].toLowerCase(), percent, round }, units, cite }));
          });
        }
      }

      // A die or a figure of each dependant word for every so many of the creature's own rank and file: a block count of the bodies, thrown once per block.
      const every = rx.dependantEvery.exec(sentence);
      if (every) {
        const ratioOf = ratioOfWord(every[8], [every[1], variant]);
        const per = parseInt(every[7], 10);
        const round = ROUND.exec(every[9])?.[1]?.toLowerCase() ?? "";
        if (ratioOf && per > 0) {
          for (const [dice, word] of [[every[3], every[4]], [every[5], every[6]]]) {
            if (!word) continue;
            const role = word.toLowerCase().replace(/s$/, "");
            add(part({ key: `dependant-${role}`, label: word, role: "dependant", source: cell(role), count: { ...countOf(dice), ratioOf, forEvery: per, round }, units: unitsOf(every[2]), cite }));
          }
        }
      }

      const escort = ESCORT_RX.exec(sentence);
      if (escort) {
        const equal = escort[4] ? roleKeyOf(escort[4]) : null;
        add(part({ key: "chieftain-guard", label: escort[3].trim(), role: "guard", source: equal ? cell(equal) : { name: escort[3].trim() }, count: countOf(escort[2]), units: here, cite }));
      }

      // An escort listed after "accompanied by" goes where the paragraph says the group is met, else where its rank's own leader part does: a part no unit holds is never rolled, so none is written for one.
      const accompanied = ACCOMPANIED_RX.exec(sentence);
      if (accompanied) {
        const rank = roleKeyOf(accompanied[1]);
        const units = here.length ? here : parts.get(`leader-${rank}`)?.when.units ?? [];
        if (rank && units.length) {
          for (const item of accompanied[2].split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)) {
            const m = ESCORT_ITEM_RX.exec(item.trim());
            if (!m) continue;
            const noun = m[3].trim();
            const perUnit = m[4] ? unitsOf(m[4])[0] : "";
            if (m[4] && !perUnit) continue;
            const equal = RANK_ALONE.test(noun) ? roleKeyOf(noun) : null;
            add(part({
              key: `escort-${wordKey(noun)}`, label: noun, role: "guard", source: equal ? cell(equal) : { name: noun },
              count: { ...(m[1] ? countOf(m[1]) : { literal: countWord(m[2]) }), perUnit }, units, cite,
            }));
          }
        }
      }

      const guard = rx.guard.exec(sentence);
      if (guard) {
        const units = unitsOf(guard[2]);
        // The place the sentence puts the group in, where it names exactly one.
        const places = [...new Set([...sentence.slice(0, guard.index).matchAll(PLACE_RX)].map((m) => m[1].toLowerCase()))];
        const place = places.length === 1 ? places[0] : "";
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
              key, label: beast[2], role: "guard", source: { name: beast[2] }, count: countOf(beast[1]), chance, units, place,
              branch: alternatives.length > 1 ? { group: `guard-or-${ci + 1}` } : {}, cite,
            }));
          });
        });
      }

      const captive = rx.captive.exec(sentence);
      if (captive) {
        add(part({ key: "captives", label: captive[3], role: "captive", source: { name: captive[3] }, count: { ...countOf(captive[2]), perUnit: captive[4].toLowerCase() }, chance: parseInt(captive[1], 10), units: here, cite }));
      }

      for (const m of sentence.matchAll(CASTER_RX)) {
        const role = /witch/i.test(m[2]) ? "witchDoctor" : "shaman";
        const before = unitsOf(sentence.slice(0, m.index));
        add(part({ key: `caster-${role}`, label: m[2], role: "caster", source: cell(role), count: { literal: 1 }, chance: parseInt(m[1], 10), units: before.length ? [before[before.length - 1]] : here, cite }));
      }
    }
  }
  return { parts, sentences };
}

/** The part kinds the local check counts, by the key a reader gives each. */
export function partKind(p) {
  const key = String(p?.key ?? "");
  if (key.startsWith("size-")) return "size";
  if (key === "archers" || key === "warriors") return "split";
  if (key.startsWith("leader-")) return "leader";
  if (key.startsWith("dependant-")) return "dependant";
  if (key === "chieftain-guard" || key.startsWith("escort-")) return "chieftainGuard";
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
