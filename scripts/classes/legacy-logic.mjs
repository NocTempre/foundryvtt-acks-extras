/**
 * A player's experience that outlives a character (RR ch. 6, Experience): the
 * reserve XP fund, heroic funerals, and a will's bequest to an heir. Pure — the
 * percentages are passed in from the imported `experience` tables, and
 * `legacy.mjs` does every write.
 *
 * The ledger is the PLAYER's, never a character's: a reserve entry adds to a
 * fund every later character of that player starts from, and using the fund
 * never spends it. A funeral entry is one character's send-off and is claimed
 * once, by the next character that starts. Either way a new character enters
 * play with no more experience than the character before.
 */

/** Ledger entry kinds. */
export const LEGACY_KIND = Object.freeze({ reserve: "reserve", funeral: "funeral" });

/** Experience that `gp` spent is worth at `rate` percent, rounded down. */
export const xpForGp = (gp, rate) => Math.floor(((Number(gp) || 0) * (Number(rate) || 0)) / 100);

/**
 * The ledger's standing totals.
 * @param {{entries?: object[]}} ledger
 * @returns {{fund: number, funerals: number, open: object[]}}
 *   `fund` the reserve's XP, `funerals` the unclaimed funeral XP, `open` the
 *   unclaimed funeral entries.
 */
export function legacyTotals(ledger) {
  const entries = ledger?.entries ?? [];
  const fund = entries.filter((e) => e.kind === LEGACY_KIND.reserve).reduce((s, e) => s + (Number(e.xp) || 0), 0);
  const open = entries.filter((e) => e.kind === LEGACY_KIND.funeral && !e.claimedBy);
  return { fund, funerals: open.reduce((s, e) => s + (Number(e.xp) || 0), 0), open };
}

/**
 * What a new character starts with: the fund plus every unclaimed funeral,
 * capped at the prior character's experience.
 * @param {{entries?: object[]}} ledger
 * @param {number} priorXp - the prior character's experience
 * @returns {{xp: number, fund: number, funerals: number, capped: boolean, claims: string[]}}
 *   `claims` the funeral entry ids the start uses up.
 */
export function startingXp(ledger, priorXp) {
  const { fund, funerals, open } = legacyTotals(ledger);
  const cap = Math.max(0, Number(priorXp) || 0);
  const want = fund + funerals;
  return { xp: Math.min(want, cap), fund, funerals, capped: want > cap, claims: open.map((e) => e.id) };
}

/**
 * A will's bequest after the bank's charge.
 * @returns {{fee: number, net: number}} both in gp, the fee rounded up so the
 *   heir never receives a fraction the bank did not charge for.
 */
export function settleEstate(estateGp, feePct) {
  const gross = Math.max(0, Number(estateGp) || 0);
  const fee = Math.ceil((gross * (Number(feePct) || 0)) / 100);
  return { fee, net: gross - fee };
}
