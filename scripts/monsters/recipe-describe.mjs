/**
 * One-line reading of an encounter recipe part, as a repair offers it when a
 * Judge's changed part and the import's differ. It names the part by its role
 * and label and gives the figures the part holds (count, chance, where it
 * applies), all read from the stored row. Foundry-free.
 */
import { RECIPE_ROLES } from "./config.mjs";

/** A part's count as text: its dice or figure, or a share of another part, per unit where it is rolled once per unit, for every so many of another part where it is thrown once per block. */
function countText(count = {}) {
  let text = "";
  if (count.dice) text = String(count.dice);
  else if (Number.isFinite(count.literal)) text = String(count.literal);
  else if (count.ratioOf) text = `${count.percent ?? ""}% of ${count.ratioOf}`;
  if (text && count.ratioOf && Number(count.forEvery) > 0 && (count.dice || Number.isFinite(count.literal))) text += ` for every ${count.forEvery} of ${count.ratioOf}`;
  if (text && count.round) text += ` (round ${count.round})`;
  if (text && count.perUnit) text += ` per ${count.perUnit}`;
  return text;
}

/**
 * The part as one line: `role: label` then its count, chance, morale bonus
 * and the state, place and units it applies to, each only where the part holds
 * one.
 * @param {object} part a stored `extras.encounter.recipe` row
 * @returns {string}
 */
export function describeRecipePart(part) {
  const role = RECIPE_ROLES[part?.role]?.label ?? part?.role ?? "";
  const name = part?.label || part?.key || "";
  const bits = [
    countText(part?.count),
    Number.isFinite(part?.chance) ? `${part.chance}% chance` : "",
    Number.isFinite(part?.moraleWhileAlive) ? `morale ${part.moraleWhileAlive >= 0 ? "+" : ""}${part.moraleWhileAlive}` : "",
    [part?.when?.state, part?.when?.place, ...(part?.when?.units ?? [])].filter(Boolean).join(" "),
  ].filter(Boolean);
  return `${[role, name].filter(Boolean).join(": ")}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}
