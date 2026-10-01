/**
 * A creature's conditions on a page that rolls for it (RR 507-515).
 *
 * The lib's conditions model (`lib/conditions.mjs`) says what the subject's
 * statuses add to one of its own rolls. A page that names the roll it is
 * (`EXTERNAL_MODES[mode].conditions`) lists that answer as rows of its own,
 * so the figure the system's bare roll would take silently is named in the
 * dialog and on the card. Foundry-free: the caller localizes what comes back.
 */
import { rollMath } from "../lib/conditions.mjs";

/**
 * What the subject's conditions say about one roll, one entry per thing a
 * reader should see:
 *
 * - `applied`  a figure the roll takes
 * - `pending`  a figure bound to a circumstance the roll does not state, left
 *              out of the total for the Judge to add by hand
 * - `unpriced` a condition whose figure the world has not imported
 * - `exempt`   a condition under which the creature does not make this roll
 *
 * @param {"save"|"throw"|"morale"|"surprise"} on  the roll, as the conditions model names it
 * @param {import("../lib/conditions.mjs").ConditionSubject|null} subject
 * @param {object} [values]  the registered rows; the registry's when omitted
 * @returns {Array<{kind: "applied"|"pending"|"unpriced"|"exempt", condition: string, value?: number, when?: string}>}
 */
export function conditionEntries(on, subject, values) {
  if (!on || !subject) return [];
  const math = values === undefined ? rollMath(on, subject) : rollMath(on, subject, values);
  return [
    ...math.exempt.map((condition) => ({ kind: "exempt", condition })),
    ...math.parts.map(({ condition, value }) => ({ kind: "applied", condition, value })),
    ...math.pending.map(({ condition, value, when }) => ({ kind: "pending", condition, value, when })),
    ...math.unpriced.map((condition) => ({ kind: "unpriced", condition })),
  ];
}

/**
 * Those entries as rows for `HOOKS.INFLUENCE_MODIFIERS`: an applied figure is
 * a row with its value, and everything else is a note, which the roller draws
 * and never adds.
 *
 * @param {ReturnType<typeof conditionEntries>} entries
 * @param {(entry: object) => string} label  the row's wording for one entry
 * @returns {Array<{label: string, value?: number, note?: boolean}>}
 */
export function conditionRows(entries, label) {
  return entries.map((entry) =>
    entry.kind === "applied" ? { label: label(entry), value: entry.value } : { label: label(entry), note: true },
  );
}
