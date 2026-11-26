/**
 * What the organisation chart's Roll panel asks of the generating feature, registered with
 * lib's service registry as `org-roll` so lib never learns what a recipe, a share or a troop
 * is: the choices the page leaves to the Judge that the picked variant can reach, what a Roll
 * of it will make, and the options of a unit's slots. Everything is read from the family
 * template and the pure readers in `organisation-preview.mjs`; nothing is rolled and nothing
 * is written. Every string it returns is worded here, from imported labels and lang keys.
 */
import { MODULE_ID } from "./constants.mjs";
import { RECIPE_BODIES } from "./config.mjs";
import { makeLoc } from "../lib/util.mjs";
import { registryBands } from "../lib/template-bands.mjs";
import { splitShares } from "./organisation-logic.mjs";
import { importedOrganisation } from "./organisation.mjs";
import { troopOptions } from "./org-chart-logic.mjs";
import { silentChoices, slotOptions, slotUnit, willMake } from "./organisation-preview.mjs";

const loc = makeLoc("ACKS-MONSTERS");

/** The family's `variant` axis option for a key, with the encounter line it carries (or null). */
function encounterOf(family, variant) {
  const axes = family?.system?.toObject?.().axes ?? family?.system?.axes ?? [];
  const option = (axes.find((a) => a.key === "variant")?.options ?? []).find((o) => o.key === variant);
  return option?.flags?.[MODULE_ID]?.extras?.encounter ?? null;
}

/** The service lib's Roll panel draws through. */
export const orgRollService = {
  /**
   * The panel's two sections and the unit slots for a variant at the picks made so far.
   * `slots` are the empty unit rows a Design panel lists, each its key, its depth below the chart's top
   * and the word the top row holds; `slotUnits` answers each the unit word a Roll of that row rolls.
   * @param {{family: Actor, variant: string, context?: string, state?: string, rules?: object, chosen?: object, slots?: {key: string, depth: number, topKind?: string}[]}} args
   * @returns {{choices: object[], make: {line: object|null, rows: object[]}, shares: object[], troops: object[], special: string, slotUnits: Object<string, {word: string, sure: boolean}>}|null} `shares` are the ones the evaluator splits by in this state and under these rules, `special` the share a troop pick is read for (blank where none is); null where the variant carries no encounter line
   */
  describe({ family, variant, context = "wilderness", state = "wandering", rules = {}, chosen = {}, slots = [] } = {}) {
    const encounter = encounterOf(family, variant);
    if (!encounter) return null;
    const recipe = encounter.recipe ?? [];
    const org = importedOrganisation();
    const { shares: imported } = splitShares({ org, rules });
    const { shares, troopShare } = slotOptions({ recipe, encounter, context, state, shares: imported });
    const choices = silentChoices({ recipe, rules, chosen, splitting: shares.length > 0 }).map((c) => ({
      name: c.group ? `branch:${c.group}` : c.key,
      label: c.group ? loc("organisation.choice.branch", { group: c.group }) : loc(`organisation.choice.${c.key}`),
      tip: loc(c.group ? "organisation.choice.branchTip" : `organisation.choice.${c.key}Tip`),
      options: c.options.map((o) => ({ key: o.key, label: o.label ?? loc(`organisation.choiceOption.${c.key}.${o.key}`), selected: o.key === c.current })),
    }));
    const made = willMake({ recipe, encounter, context, state, chosen, shares: imported, shareCite: org.organisation?.cite ?? "" });
    // What a for-every row counts: the label of the part its key names, every body of the unit where the key is `RECIPE_BODIES`, else the key as printed.
    const countedOf = (key) => recipe.find((p) => p?.key === key)?.label || (key === RECIPE_BODIES ? loc("organisation.willMake.ofBodies") : key);
    const rows = made.rows.map((r) => {
      const formula = r.forEvery ? loc("organisation.willMake.every", { formula: r.formula, n: r.forEvery, of: countedOf(r.of) }) : r.formula;
      return {
        label: r.label,
        formula,
        chance: r.chance == null ? "" : loc("organisation.willMake.chance", { n: r.chance }),
        // A for-every row's tip names its parts (the die, the block size, what is counted) beside the page.
        tip: loc("organisation.willMake.rowTip", { label: r.forEvery ? `${r.label} (${formula})` : r.label, cite: r.cite }),
      };
    });
    const line = made.line ? { text: `${made.line.noun} ${made.line.number}`, tip: loc("organisation.willMake.lineTip", { where: `${variant}, ${context}, ${state}` }) } : null;
    const slotUnits = Object.fromEntries(slots.map((s) => [s.key, slotUnit({ recipe, encounter, context, state, topKind: s.topKind ?? "", depth: s.depth })]));
    const system = family?.system?.toObject?.() ?? family?.system;
    return { choices, make: { line, rows }, shares, troops: troopOptions({ system, variant, bandOf: registryBands() }), special: troopShare, slotUnits };
  },
};
