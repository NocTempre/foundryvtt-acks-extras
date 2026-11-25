/**
 * What a Roll's panel shows before anything is rolled (docs/monsters/MODEL.md, "The
 * organisation roll"): the choices the page leaves to the Judge that this recipe can
 * reach, what a Roll of it will make, and the slots a unit's row can carry. Pure and
 * Foundry-free, read from the recipe parts and the encounter lines as imported: it
 * rolls nothing, throws no die and writes nothing, so a figure that depends on a throw
 * is shown as the die expression it is rolled with (tools/test-organisation-preview.mjs
 * runs it with a Math.random that throws). Nothing here names a unit, creature or rank:
 * every label, formula and page reference is the imported part's own, and an absent
 * figure stays blank.
 */
import { DEFAULT_CHOICES, appliesTo, reachedWords, sidesOf, splitUnitsOf, unitWord } from "./encounter-recipe.mjs";
import { SPECIAL } from "./organisation-logic.mjs";

const isSize = (p) => String(p?.key ?? "").startsWith("size-");

/** The split parts of a recipe: the shares a unit's kind is picked from. */
const splitParts = (recipe) => (recipe ?? []).filter((p) => p?.role === "body" && p.count?.ratioOf === "unit");

/** The expression a part's count is rolled with: dice, a figure, or a percentage of what it counts. */
const formulaOf = (p) => (p.count?.dice ? String(p.count.dice) : p.count?.literal != null ? String(p.count.literal) : p.count?.percent != null ? `${p.count.percent}%` : "");

/**
 * The choices where the page is silent that a Roll of this recipe can reach, each with the
 * options it takes and the one it takes now. A rounding is reachable where a part counts a
 * percentage with no rounding printed or the troops rule makes its own shares; the two
 * choices of a split where a split part exists or the troops rule is on; a branch group
 * where a recipe holds alternatives of one group.
 *
 * @param {object} args
 * @param {object[]} args.recipe the variant's recipe parts
 * @param {{troops?: boolean}} [args.rules] the optional rules switched on
 * @param {object} [args.chosen] the choices recorded or picked: `unprintedRound`, `loneSplit`, `remainder`, `branch`
 * @returns {{key: string, group?: string, options: {key: string, label?: string}[], current: string}[]} `label` of a branch option is the part's own; the others carry keys the caller words
 */
export function silentChoices({ recipe = [], rules = {}, chosen = {} } = {}) {
  const out = [];
  const parts = (recipe ?? []).filter((p) => p && !isSize(p));
  const pick = (key) => chosen[key] ?? DEFAULT_CHOICES[key];
  if (rules.troops || parts.some((p) => p.count?.percent != null && !p.count?.round)) {
    out.push({ key: "unprintedRound", options: ["nearest", "up", "down"].map((key) => ({ key })), current: pick("unprintedRound") });
  }
  if (rules.troops || splitParts(recipe).length) {
    out.push({ key: "loneSplit", options: ["printed", "roll"].map((key) => ({ key })), current: pick("loneSplit") });
    out.push({ key: "remainder", options: ["largest", "none"].map((key) => ({ key })), current: pick("remainder") });
  }
  const groups = new Map();
  for (const p of parts) if (p.branch?.group) groups.set(p.branch.group, [...(groups.get(p.branch.group) ?? []), p]);
  for (const [group, members] of groups) {
    if (members.length < 2) continue;
    const named = chosen.branch?.[group];
    out.push({ key: "branch", group, options: members.map((m) => ({ key: m.key, label: m.label || m.key })), current: members.some((m) => m.key === named) ? named : members[0].key });
  }
  return out;
}

/**
 * The unit words a Roll in a state stands on, top first: the evaluator's own walk
 * (`reachedWords`) for the side, and for `chance`, whose throw lands on either side, both.
 */
function reachFor({ recipe, encounter, context, state }) {
  const sides = state === "chance" ? ["lair", "wandering"] : [state];
  return sides.map((side) => reachedWords({ recipe, encounter, context, state: side }));
}

/** The shares the evaluator splits by: the imported ones where the rule supplied them, else the recipe's split parts, each with the figure it is divided by. */
const sharesOf = (recipe, shares) => (shares
  ? shares.map((x) => ({ key: x.key, label: x.label || x.key, percent: x.percent }))
  : splitParts(recipe).map((p) => ({ key: p.key, label: p.label || p.key, percent: p.count.percent, cite: p.cite ?? "" })));

/** Does the evaluator split any level of the tree the state reaches? It does where a share exists and a level's units are the ones the shares name. */
function splits({ recipe, shares, reached }) {
  const named = splitUnitsOf(recipe);
  return sharesOf(recipe, shares).length > 0 && reached.some((chain) => chain.some((w) => !named.size || named.has(w.word)));
}

/**
 * What a Roll of the recipe will make, read and never rolled: the encounter line for the
 * place and the state, then a row for each part the evaluator would make, with the expression
 * it is rolled with, its chance and its page reference. A part is listed only where the
 * evaluator would make it: it applies to a unit word the state's tree stands on, a branch
 * group lists only the part chosen, and the split shares are the imported ones where the
 * troops rule supplied them and none where no level is one they name. A figure the import
 * left blank stays blank. The `chance` state's throw lands on either side, so it lists what
 * either side could make, and its line is the lair line.
 *
 * @param {object} args
 * @param {object[]} args.recipe
 * @param {object|null} args.encounter `extras.encounter`
 * @param {"dungeon"|"wilderness"} [args.context]
 * @param {"wandering"|"lair"|"chance"} [args.state]
 * @param {object} [args.chosen] the branch choices (`chosen.branch`)
 * @param {{key: string, percent: number}[]|null} [args.shares] the imported shares (`splitShares`), null where the recipe's own apply
 * @param {string} [args.shareCite] the page the imported shares were read from
 * @returns {{line: {noun: string, number: string, unit: string}|null, rows: {key: string, role: string, label: string, formula: string, chance: number|null, cite: string, perUnit: string}[]}}
 */
export function willMake({ recipe = [], encounter = null, context = "wilderness", state = "wandering", chosen = {}, shares = null, shareCite = "" } = {}) {
  const side = state === "chance" ? "lair" : state;
  const found = sidesOf(recipe, encounter).find((s) => s.place === context && s.state === side) ?? null;
  const reached = reachFor({ recipe, encounter, context, state });
  const words = new Set(reached.flatMap((chain) => chain.map((w) => w.word)));
  const members = new Map();
  for (const p of recipe ?? []) if (p?.branch?.group) members.set(p.branch.group, [...(members.get(p.branch.group) ?? []), p]);
  const chosenOf = (group) => {
    const list = members.get(group) ?? [];
    return list.find((m) => m.key === chosen.branch?.[group])?.key ?? list[0]?.key;
  };
  const isSplit = (p) => p.role === "body" && p.count?.ratioOf === "unit";
  const rows = (recipe ?? [])
    .filter((p) => p && !isSize(p) && !isSplit(p) && !(p.branch?.group && p.key !== chosenOf(p.branch.group)) && [...words].some((w) => appliesTo(p, w)))
    .map((p) => ({ key: p.key, role: p.role ?? "", label: p.label ?? "", formula: formulaOf(p), chance: p.chance ?? null, cite: p.cite ?? "", perUnit: p.count?.perUnit ?? "" }));
  const split = splits({ recipe, shares, reached })
    ? sharesOf(recipe, shares).map((x) => ({ key: x.key, role: "body", label: x.label, formula: `${x.percent}%`, chance: null, cite: shares ? shareCite : x.cite, perUnit: "" }))
    : [];
  const order = new Map((recipe ?? []).map((p, i) => [p.key, i]));
  const all = [...rows, ...split].sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity));
  return { line: found ? { noun: found.noun, number: found.number, unit: found.childWord } : null, rows: all };
}

/**
 * The slots a unit's row can carry that a Roll reads as `inherit`: the shares the evaluator
 * splits by in this state and under these rules (the imported three with the troops rule on
 * and every figure imported, else the recipe's split parts; none where no level of the tree
 * is one they name), and the share a troop pick is read for. A troop is read only for the
 * special share, which only the imported shares carry, so `troopShare` is blank otherwise.
 *
 * @param {object} args
 * @param {object[]} args.recipe
 * @param {object|null} args.encounter
 * @param {"dungeon"|"wilderness"} [args.context]
 * @param {"wandering"|"lair"|"chance"} [args.state]
 * @param {{key: string, percent: number}[]|null} [args.shares] `splitShares`'s imported shares
 * @param {string} [args.special] the key the troop rolls are for
 * @returns {{shares: {key: string, label: string}[], troopShare: string}}
 */
export function slotOptions({ recipe = [], encounter = null, context = "wilderness", state = "wandering", shares = null, special = SPECIAL } = {}) {
  const on = splits({ recipe, shares, reached: reachFor({ recipe, encounter, context, state }) });
  const list = on ? sharesOf(recipe, shares).map((x) => ({ key: x.key, label: x.label })) : [];
  return { shares: list, troopShare: shares && list.some((x) => x.key === special) ? special : "" };
}

/**
 * The unit word a slot at a depth below the chart's top stands on, and whether a Roll of it is
 * sure. The chain is the evaluator's, started at the word the chart's top row already holds (the
 * top of an unrolled chart is the side's own noun). A depth with no word (the tree ends in bodies
 * above it), a word whose line states no count, and, in the `chance` state, a depth the two sides
 * word differently, are not sure: the slot is listed, not drawn.
 *
 * @param {object} args
 * @param {object[]} args.recipe
 * @param {object|null} args.encounter
 * @param {"dungeon"|"wilderness"} [args.context]
 * @param {"wandering"|"lair"|"chance"} [args.state]
 * @param {string} [args.topKind] the word the chart's top row holds, blank before a roll
 * @param {number} args.depth rows between the slot and the chart's top
 * @returns {{word: string, sure: boolean}}
 */
export function slotUnit({ recipe = [], encounter = null, context = "wilderness", state = "wandering", topKind = "", depth = 1 } = {}) {
  const at = reachFor({ recipe, encounter, context, state }).map((chain) => {
    const start = Math.max(0, chain.findIndex((w) => w.word === unitWord(topKind)));
    const hit = chain[start + depth];
    return hit ? { word: hit.word, rolls: !!hit.line } : null;
  });
  const [first] = at;
  const agreed = !!first && at.every((x) => x && x.word === first.word && x.rolls);
  return { word: agreed ? first.word : "", sure: agreed };
}
