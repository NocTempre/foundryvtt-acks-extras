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
import { DEFAULT_CHOICES, sidesOf } from "./encounter-recipe.mjs";
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
 * What a Roll of the recipe will make, read and never rolled: the encounter line for the
 * place and the state, then a row for each part that applies, with the expression it is
 * rolled with, its chance and its page reference. A branch group lists only the part
 * chosen. A figure the import left blank stays blank.
 *
 * @param {object} args
 * @param {object[]} args.recipe
 * @param {object|null} args.encounter `extras.encounter`
 * @param {"dungeon"|"wilderness"} [args.context]
 * @param {"wandering"|"lair"|"chance"} [args.state] `chance` reads the lair line, the side the chance throw lands on
 * @param {object} [args.chosen] the branch choices (`chosen.branch`)
 * @returns {{line: {noun: string, number: string, unit: string}|null, rows: {key: string, role: string, label: string, formula: string, chance: number|null, cite: string, perUnit: string}[]}}
 */
export function willMake({ recipe = [], encounter = null, context = "wilderness", state = "wandering", chosen = {} } = {}) {
  const side = state === "chance" ? "lair" : state;
  const found = sidesOf(recipe, encounter).find((s) => s.place === context && s.state === side) ?? null;
  const members = new Map();
  for (const p of recipe ?? []) if (p?.branch?.group) members.set(p.branch.group, [...(members.get(p.branch.group) ?? []), p]);
  const chosenOf = (group) => {
    const list = members.get(group) ?? [];
    return list.find((m) => m.key === chosen.branch?.[group])?.key ?? list[0]?.key;
  };
  const rows = (recipe ?? [])
    .filter((p) => p && !isSize(p) && !(p.branch?.group && p.key !== chosenOf(p.branch.group)))
    .map((p) => ({ key: p.key, role: p.role ?? "", label: p.label ?? "", formula: formulaOf(p), chance: p.chance ?? null, cite: p.cite ?? "", perUnit: p.count?.perUnit ?? "" }));
  return { line: found ? { noun: found.noun, number: found.number, unit: found.childWord } : null, rows };
}

/**
 * The slots a unit's row can carry that a Roll reads as `inherit`: the shares a unit's kind
 * is picked from (the split parts, each the recipe's own key and label) and whether a troop
 * pick is honoured. A troop is read only where the troops rule is on and the unit's share is
 * the special one, so it is offered under exactly that condition and nowhere else.
 *
 * @param {object} args
 * @param {object[]} args.recipe
 * @param {boolean} [args.troops] the troops rule is on
 * @param {string} [args.share] the share picked or already on the row
 * @returns {{shares: {key: string, label: string}[], troopApplies: boolean}}
 */
export function slotOptions({ recipe = [], troops = false, share = "" } = {}) {
  return {
    shares: splitParts(recipe).map((p) => ({ key: p.key, label: p.label || p.key })),
    troopApplies: !!troops && share === SPECIAL,
  };
}
