/* global foundry */
/**
 * ChoiceSpec — the family's one "choose N from …" primitive.
 *
 * Every pick a rule offers reduces to the same shape: a source list, a count,
 * and constraints. The class award ladder ("select one class proficiency at
 * 3rd level"), a starting-template bundle's "one spell of the character's
 * choice", and a power that grants pick-N all configure THIS shape rather than
 * growing their own chooser.
 *
 * The spec models the OFFER only. Resolving what is actually offered (walking
 * world documents) and recording what was picked belong to the consumer — the
 * spec is pure data so recipes can materialize it and Node tests can build it.
 */
import { str, int, refList, choice } from "./fields.mjs";

/**
 * Where a chooser draws its options from.
 *
 * `classInventory` — the owning class document's ability inventory (the class
 *   proficiency list plus its powers); `filter` narrows within it.
 * `generalList` — every world ability on the general proficiency list.
 * `spellList` — the owning class's spell list (a casting tradition's refs).
 * `custom` — exactly the refs carried on the spec itself.
 */
export const CHOICE_SOURCES = {
  classInventory: { label: "Class Inventory" },
  generalList: { label: "General List" },
  spellList: { label: "Spell List" },
  custom: { label: "Listed Options" },
};

/** How `filter` narrows a classInventory source. */
export const CHOICE_FILTERS = {
  any: { label: "Anything" },
  proficiencies: { label: "Proficiencies" },
  powers: { label: "Powers" },
};

/**
 * The embedded chooser schema. `count` is how many picks the offer grants;
 * `refs` only feeds the `custom` source; `label` is what the picker dialog
 * calls the offer when the rule names it ("Expert Traveling choice").
 */
export function choiceSpecField() {
  return new (foundry.data.fields.SchemaField)({
    from: choice(CHOICE_SOURCES, { initial: "classInventory" }),
    filter: choice(CHOICE_FILTERS, { initial: "any" }),
    count: int(1, { min: 1 }),
    refs: refList(),
    label: str(),
    note: str(),
  });
}

/**
 * Pure option resolution: the refs this spec offers, given the consumer's
 * already-gathered context lists. Foundry-free — the consumer supplies
 * `{ inventory: {classProfs, powers}, generalRefs, spellRefs }` and gets back
 * a de-duplicated ref list; an unknown source resolves to [].
 *
 * @param {object} spec - a ChoiceSpec's plain data
 * @param {object} [ctx]
 * @returns {string[]} refs offered
 */
export function choiceOptions(spec, ctx = {}) {
  if (!spec) return [];
  let refs = [];
  switch (spec.from) {
    case "classInventory": {
      const inv = ctx.inventory ?? {};
      const profs = inv.classProfs ?? [];
      const powers = inv.powers ?? [];
      refs =
        spec.filter === "proficiencies" ? profs :
        spec.filter === "powers" ? powers :
        [...profs, ...powers];
      break;
    }
    case "generalList":
      refs = ctx.generalRefs ?? [];
      break;
    case "spellList":
      refs = ctx.spellRefs ?? [];
      break;
    case "custom":
      refs = spec.refs ?? [];
      break;
  }
  return [...new Set(refs)];
}
