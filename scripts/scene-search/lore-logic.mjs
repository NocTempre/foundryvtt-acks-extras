/**
 * What a layer keyed to a proficiency (Theology, Loremastery, Naturalism,
 * Magical Engineering, Sensing Power, or any other the rail offers) needs from a
 * member's own abilities, as figures for `scene-logic.mjs`. Foundry-free: the
 * reads (a member's resolved throw, the page their ability item cites) arrive as
 * a function, and no throw, rank step or modifier is written here; every figure
 * is the member's own imported one.
 */
import { AUTOMATIC_SKILLS } from "./constants.mjs";

/**
 * The ad hoc party-check config for a named capability's skill check: it matches
 * the capability and nothing by name, allows no Adventuring stand-in, and takes
 * the ability's first throw (`rollKey: null`), since the layer names a
 * proficiency and not one of its throws.
 */
export const skillConfig = (capability) => ({ flagKey: capability, capability, advKey: null, pattern: /(?!)/, label: "", rollKey: null });

/**
 * The skill figures one member brings to the tokens a session's layers ask for.
 *
 * - `skillTargets`: the member's own target per token, or null where they have
 *   none read (no ability, no figure imported, or the page prints none).
 * - `skillCites`: the page the member's ability item cites, per token that has
 *   one, for the tooltip on a figure left blank.
 * - `skillAutomatic`: the tokens that need no throw for this member: listed in
 *   `AUTOMATIC_SKILLS` AND with no target read. A listed token whose ability
 *   carries a throw is thrown like any other, so an import that adds one wins;
 *   a token not listed is never automatic, however empty its figure.
 *
 * @param {string[]} tokens the capability tokens to read
 * @param {(token: string) => {target?: number|null, cite?: string}|null} read the member's resolved throw and cited page for a token
 * @returns {{skillTargets: Object<string, number|null>, skillCites: Object<string, string>, skillAutomatic: string[]}}
 */
export function skillFigures(tokens, read) {
  const skillTargets = {};
  const skillCites = {};
  const skillAutomatic = [];
  for (const token of tokens) {
    const got = read(token) ?? {};
    const target = Number.isFinite(Number(got.target)) && got.target !== null && got.target !== "" ? Number(got.target) : null;
    skillTargets[token] = target;
    const cite = typeof got.cite === "string" ? got.cite.trim() : "";
    if (cite) skillCites[token] = cite;
    if (target === null && AUTOMATIC_SKILLS.includes(token)) skillAutomatic.push(token);
  }
  return { skillTargets, skillCites, skillAutomatic };
}
