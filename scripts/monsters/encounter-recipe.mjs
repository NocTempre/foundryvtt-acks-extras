/**
 * The encounter recipe evaluator: a variant's `extras.encounter.recipe` (docs/monsters/MODEL.md,
 * "The encounter recipe") rolled for one unit at a context and state into a tree
 * of units of units. Pure and Foundry-free; `rng` is injected, so a suite
 * supplies the dice. Nothing here names a unit, a rank or a creature: every unit
 * word, count, share, chance and rounding is read from the parts and the
 * encounter lines passed in, and a figure that is missing leaves its part blank
 * and is listed in `missing`, so nothing throws and no wrong figure is written.
 *
 * The tree. The unit an encounter line names (its noun) is the top; the line's
 * count is how many of the unit it counts (`unit`) it holds, or, where it counts
 * no unit, its bodies. A sub-unit is sized by whichever line carries its noun,
 * in either context. A node carries the parts that apply to its unit word:
 * `leaders` (a rank leads each unit of its word), `parts` (bodies, dependants,
 * guards, captives and casters, each with its rolled count and the roll that
 * made it), and `children`.
 *
 * Shares. The parts that split a unit's sub-units (`ratioOf: "unit"`, or the
 * `shares` an organisation rule hands in) divide the units of the first level,
 * going down from the top, that holds more than one unit and whose every unit
 * word the sentences name; a tree with no such level divides its deepest level.
 * Each share takes the sub-units its percent comes to, rounded as printed
 * (`apportion`), and every unit under a sub-unit takes its kind.
 *
 * Choices. Where the page is silent the evaluator takes a default and returns it
 * in `choices`, so the caller keeps it with the roll and a Judge's surface can
 * show and change it: it asks nothing. Rulings: docs/monsters/MODEL.md, "The
 * organisation roll".
 */
import { rollDice } from "../lib/template-logic.mjs";
import { singular } from "./outside-reference.mjs";

/** The Judge's choices where the page is silent, with the default each takes. */
export const DEFAULT_CHOICES = Object.freeze({
  /** A rounding the page does not print: `nearest` (half up), `up` or `down`. */
  unprintedRound: "nearest",
  /** A unit alone in its level, divided by shares: `printed` (the shares' own roundings) or `roll` (a percentile over the shares). */
  loneSplit: "printed",
  /** Sub-units the printed roundings leave unassigned: `largest` (the share with the largest dropped fraction) or `none` (they keep no kind). */
  remainder: "largest",
  /** Which alternative of a branch group is present: `{groupKey: partKey}`; a group not named takes its first part. */
  branch: Object.freeze({}),
});

/** The deepest unit chain the tree follows, so a recipe whose lines name each other cannot hang. */
const MAX_DEPTH = 8;

/** A unit word as a key: lowercase, singular. */
export const unitWord = (word) => singular(String(word ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());

/**
 * Roll a count formula: dice with a flat modifier ("2d4+1"), a figure, or either
 * under a multiplier ("(1d4+1)*10", "3*2"). Null where the formula does not read.
 * @param {string|number} formula
 * @param {() => number} rng
 * @returns {number|null}
 */
export function rollFormula(formula, rng = Math.random) {
  const s = String(formula ?? "").replace(/\s+/g, "");
  const times = /^\(?([^()*]+?)\)?\*(\d+)$/.exec(s);
  if (times) {
    const base = rollDice(times[1], rng);
    return base === null ? null : base * parseInt(times[2], 10);
  }
  return rollDice(s, rng);
}

const round = (x, how) => (how === "up" ? Math.ceil(x) : how === "down" ? Math.floor(x) : Math.floor(x + 0.5));

/**
 * Divide `n` units among shares. Each share takes `percent` of `n`, rounded as
 * the share prints (`up`, `down`) or as the caller's default where it prints none;
 * a share never takes more than is left, so the total never passes `n`. Units
 * the roundings leave over go, with `remainder: "largest"`, one each to the
 * shares in the order of the fraction their rounding dropped, largest first (a
 * tie goes to the earlier share); with `"none"` they are `left`.
 *
 * @param {number} n whole units to divide
 * @param {{key: string, percent: number, round?: string}[]} shares in the order printed
 * @param {{unprintedRound?: string, remainder?: string}} [options]
 * @returns {{counts: Object<string, number>, left: number}}
 */
export function apportion(n, shares, { unprintedRound = DEFAULT_CHOICES.unprintedRound, remainder = DEFAULT_CHOICES.remainder } = {}) {
  const counts = {};
  const drops = [];
  const whole = Math.max(0, Math.floor(n));
  let left = whole;
  for (const share of shares) {
    const exact = (whole * Number(share.percent)) / 100;
    const how = share.round || unprintedRound;
    const take = Math.min(left, Math.max(0, round(exact, how)));
    counts[share.key] = take;
    left -= take;
    drops.push({ key: share.key, drop: exact - take });
  }
  if (remainder === "largest") {
    for (const d of [...drops].sort((a, b) => b.drop - a.drop || drops.indexOf(a) - drops.indexOf(b))) {
      if (left <= 0) break;
      counts[d.key] += 1;
      left -= 1;
    }
  }
  return { counts, left };
}

/**
 * The sides of the encounter lines as the evaluator reads them: each
 * `{place, state, noun, word, number, childWord}`. A `size-*` part of the recipe
 * (the part a Judge may have corrected) stands in for the line it was read from.
 * @param {object[]} recipe
 * @param {object|null} encounter `extras.encounter`
 */
export function sidesOf(recipe, encounter) {
  const sides = new Map();
  const put = (place, state, noun, number, unit) => {
    if (!number) return;
    sides.set(`${place}|${state}`, { place, state, noun: String(noun ?? ""), word: unitWord(noun), number: String(number), childWord: unitWord(unit) });
  };
  for (const place of ["dungeon", "wilderness"]) {
    for (const state of ["wandering", "lair"]) {
      const s = encounter?.[place]?.[state];
      if (s?.number) put(place, state, s.noun, s.number, s.unit);
    }
  }
  for (const p of recipe ?? []) {
    if (!String(p?.key ?? "").startsWith("size-") || !p.when?.place || !p.when?.state) continue;
    const number = p.count?.dice || (p.count?.literal != null ? String(p.count.literal) : "");
    put(p.when.place, p.when.state, p.when.units?.[0] ?? p.label, number, p.role === "unit" ? p.source?.name : "");
  }
  return [...sides.values()];
}

const isSize = (p) => String(p?.key ?? "").startsWith("size-");
const appliesTo = (p, word) => (p.when?.units ?? []).some((u) => unitWord(u) === word);
/** The formula a part's count states, or "" where it states none a roll reads. */
const formulaOf = (p) => (p.count?.dice ? String(p.count.dice) : p.count?.literal != null ? String(p.count.literal) : "");

/**
 * Evaluate a recipe for one unit.
 *
 * @param {object} args
 * @param {object[]} args.recipe the parts
 * @param {object|null} [args.encounter] `extras.encounter` (its lines and `lairChance`)
 * @param {"dungeon"|"wilderness"} [args.context] which line
 * @param {"wandering"|"lair"|"chance"} [args.state] which side; `chance` throws the lair chance first
 * @param {string} [args.unit] roll this unit word instead of the side's own noun (an empty row of that kind)
 * @param {string} [args.kind] the share an ancestor's roll fixed for this unit: the unit and everything under it take it, and no split is made again
 * @param {() => number} [args.rng]
 * @param {{key: string, percent: number, round?: string}[]|null} [args.shares] shares that replace the recipe's own (the optional three-way split)
 * @param {object} [args.choices] the Judge's choices; the rest take `DEFAULT_CHOICES`
 * @returns {{ok: boolean, reason?: string, context?: string, state?: string, lair?: object, top?: object, choices?: object, missing?: object[], steps?: object[]}}
 *   `reason` is `side` (the line states no count for the unit) or `noChance`
 */
export function evaluateRecipe({ recipe = [], encounter = null, context = "wilderness", state = "wandering", unit = "", kind = "", rng = Math.random, shares = null, choices = {} } = {}) {
  const chosen = { ...DEFAULT_CHOICES, ...choices, branch: { ...DEFAULT_CHOICES.branch, ...(choices.branch ?? {}) } };
  const steps = [];
  const missing = [];
  const roll = (formula, why) => {
    const total = rollFormula(formula, rng);
    steps.push({ formula: String(formula), total, why });
    return total;
  };

  let found = state;
  let lair = null;
  if (state === "chance") {
    const chance = encounter?.lairChance;
    if (chance === null || chance === undefined || chance === "" || !Number.isFinite(Number(chance))) return { ok: false, reason: "noChance" };
    const die = roll("1d100", "lair chance");
    found = die <= Number(chance) ? "lair" : "wandering";
    lair = { chance: Number(chance), die, inLair: found === "lair" };
  }

  const sides = sidesOf(recipe, encounter);
  const own = sides.find((s) => s.place === context && s.state === found);
  const topWord = unit ? unitWord(unit) : own?.word;
  if (!topWord || (!unit && !own)) return { ok: false, reason: "side", lair };

  const lineFor = (word, top) => {
    if (top && own && own.word === word) return own;
    return sides.find((s) => s.word === word && s.place === context) ?? sides.find((s) => s.word === word) ?? null;
  };

  let serial = 0;
  const build = (word, parentKey, chain, top) => {
    const node = { key: `u${++serial}`, unit: word, parentKey, kind: "", count: null, bodies: 0, leaders: [], parts: [], children: [] };
    const line = lineFor(word, top);
    if (!line || chain.length > MAX_DEPTH) {
      missing.push({ what: "size", unit: word });
      return node;
    }
    const n = roll(line.number, `${word} size`);
    if (n === null) {
      missing.push({ what: "size", unit: word });
      return node;
    }
    node.count = { formula: line.number, total: n, unit: line.childWord };
    if (line.childWord && !chain.includes(line.childWord)) {
      for (let i = 0; i < n; i++) node.children.push(build(line.childWord, node.key, [...chain, word], false));
    } else if (!line.childWord) node.bodies = n;
    return node;
  };
  const root = build(topWord, null, [], true);

  const all = [];
  const collect = (node) => {
    all.push(node);
    node.children.forEach(collect);
  };
  collect(root);

  const splitParts = shares
    ? shares.map((s) => ({ key: s.key, percent: s.percent, round: s.round ?? "", units: null, label: s.label ?? s.key }))
    : (recipe ?? []).filter((p) => p?.role === "body" && p.count?.ratioOf === "unit").map((p) => ({ key: p.key, percent: p.count.percent, round: p.count.round ?? "", units: p.when?.units ?? [], label: p.label || p.key }));
  const sizeBodyKey = (recipe ?? []).find((p) => isSize(p) && p.role === "body" && p.when?.state === found && p.when?.place === context)?.key ?? "bodies";

  // The level the shares divide: the first with more than one unit, else the deepest, among levels whose words the shares name.
  const splitUnits = new Set((recipe ?? []).filter((p) => p?.role === "body" && p.count?.ratioOf === "unit").flatMap((p) => p.when?.units ?? []).map(unitWord));
  const named = (node) => !splitUnits.size || splitUnits.has(node.unit);
  if (kind) {
    for (const node of all) node.kind = kind;
  } else if (splitParts.length) {
    let level = [root];
    let pick = null;
    let deepest = null;
    while (level.length) {
      if (level.every(named)) {
        deepest = level;
        if (level.length > 1) {
          pick = level;
          break;
        }
      }
      level = level.flatMap((n) => n.children);
    }
    const group = pick ?? deepest;
    if (group?.length) {
      let counts;
      if (group.length === 1 && chosen.loneSplit === "roll") {
        const die = roll("1d100", "lone unit's share");
        let edge = 0;
        const hit = splitParts.find((s) => die <= (edge += Number(s.percent)));
        counts = Object.fromEntries(splitParts.map((s) => [s.key, s === hit ? 1 : 0]));
      } else counts = apportion(group.length, splitParts, chosen).counts;
      let at = 0;
      for (const s of splitParts) {
        for (let i = 0; i < (counts[s.key] ?? 0); i++) group[at++].kind = s.key;
      }
      const inherit = (node, kind) => {
        node.kind = node.kind || kind;
        node.children.forEach((c) => inherit(c, node.kind));
      };
      group.forEach((g) => inherit(g, g.kind));
    }
  }
  const labelOf = new Map(splitParts.map((s) => [s.key, s.label]));

  for (const node of all) {
    if (node.bodies > 0) {
      const key = node.kind || sizeBodyKey;
      node.parts.push({ part: key, role: "body", label: labelOf.get(key) ?? "", count: node.bodies, source: {}, chance: null, cite: "", basis: "page" });
    }
  }

  const evaluate = (list) => {
    const groups = new Map();
    for (const p of list) {
      const g = p.branch?.group;
      if (g && !groups.has(g)) groups.set(g, []);
      if (g) groups.get(g).push(p);
    }
    return groups;
  };
  const others = (recipe ?? []).filter((p) => p && !isSize(p) && !(p.role === "body" && p.count?.ratioOf === "unit"));
  const branches = evaluate(others);
  const passes = (p) => (p.chance === null || p.chance === undefined ? true : roll("1d100", `${p.key} chance`) <= Number(p.chance));

  const subtreeBodies = (node, partKey) => {
    let sum = 0;
    const walkNode = (n) => {
      for (const part of n.parts) if (part.role === "body" && part.part === partKey) sum += part.count;
      n.children.forEach(walkNode);
    };
    walkNode(node);
    return sum;
  };
  const unitsUnder = (node, word) => {
    let n = 0;
    const walkNode = (x) => {
      if (x !== node && x.unit === word) n += 1;
      x.children.forEach(walkNode);
    };
    walkNode(node);
    return n;
  };

  for (const node of all) {
    for (const p of others) {
      if (!appliesTo(p, node.unit)) continue;
      if (p.role === "leader") {
        const formula = formulaOf(p);
        const count = formula ? roll(formula, `${p.key} count`) : null;
        if (count === null) missing.push({ what: "count", part: p.key });
        node.leaders.push({ part: p.key, role: "leader", label: p.label ?? "", count: count ?? 0, source: p.source ?? {}, moraleWhileAlive: p.moraleWhileAlive ?? null, cite: p.cite ?? "", basis: p.basis ?? "page" });
        continue;
      }
      const group = p.branch?.group;
      if (group) {
        const members = branches.get(group);
        const pickKey = chosen.branch[group] && members.some((m) => m.key === chosen.branch[group]) ? chosen.branch[group] : members[0].key;
        if (p.key !== pickKey) continue;
      }
      if (!passes(p)) continue;

      let count = null;
      if (p.count?.ratioOf) {
        const base = subtreeBodies(node, p.count.ratioOf);
        count = round((base * Number(p.count.percent)) / 100, p.count.round || chosen.unprintedRound);
        steps.push({ formula: `${p.count.percent}% of ${base}`, total: count, why: p.key });
      } else {
        const formula = formulaOf(p);
        const times = p.count?.perUnit ? unitsUnder(node, unitWord(p.count.perUnit)) : 1;
        if (!formula) missing.push({ what: "count", part: p.key });
        else {
          count = 0;
          for (let i = 0; i < times; i++) count += roll(formula, `${p.key} count`) ?? 0;
        }
      }
      node.parts.push({ part: p.key, role: p.role, label: p.label ?? "", count: count ?? 0, source: p.source ?? {}, chance: p.chance ?? null, cite: p.cite ?? "", basis: p.basis ?? "page", branch: group ?? "", perUnit: p.count?.perUnit ?? "" });
    }
  }
  return { ok: true, context, state: found, requested: state, lair, top: root, choices: chosen, missing, steps };
}

/**
 * Every node of a tree, the top first and each unit before its sub-units.
 * @param {object} top
 * @returns {object[]}
 */
export function walk(top) {
  const out = [];
  const visit = (node) => {
    out.push(node);
    node.children.forEach(visit);
  };
  if (top) visit(top);
  return out;
}
