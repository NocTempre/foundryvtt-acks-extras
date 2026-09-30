/**
 * The pure halves of the identification ladder (JJ ch.4): which rarity tiers a
 * proficiency reaches, read out of the imported prose window, and whether a
 * die falls in a printed backfire band. Every figure and word is the Judge's
 * own imported text; this module only knows how to read it.
 */

/** "veryRare" → "very rare": the phrase a rarity key is printed as. */
const phraseOf = (key) => key.replace(/([A-Z])/g, " $1").toLowerCase();

/**
 * The rarity tiers a prose window names, matched longest phrase first so
 * "very rare" is never read as "rare" and "uncommon" never as "common".
 *
 * @param {string} text - the imported window (any case)
 * @param {readonly string[]} rarities - the module's rarity keys
 * @returns {Set<string>|null} the keys named; null when the window names none
 */
export function tiersNamed(text, rarities) {
  let rest = ` ${String(text ?? "").toLowerCase()} `;
  const found = new Set();
  const phrases = rarities.map((key) => ({ key, phrase: phraseOf(key) })).sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { key, phrase } of phrases) {
    const at = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "g");
    if (at.test(rest)) {
      found.add(key);
      rest = rest.replace(at, " ");
    }
  }
  return found.size ? found : null;
}

/**
 * Whether an unmodified die falls in a backfire band.
 * @param {number} natural
 * @param {[number, number]|null} band - the printed [min, max]
 */
export const inBackfireBand = (natural, band) => Array.isArray(band) && natural >= band[0] && natural <= band[1];
