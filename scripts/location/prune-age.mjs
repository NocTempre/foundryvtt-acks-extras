/**
 * Which locations the world-start prune of empty places leaves alone for being
 * new. The sweep runs at the primary GM's ready, which settles seconds after
 * the world loads and may be a different Judge's seat from the one that made a
 * place meanwhile, so a place made since the world was launched is spared and
 * left for the next launch's sweep. The cut is the server's own clock on both
 * sides: the world's `lastPlayed`, which the server stamps at launch, against
 * a document's `_stats.createdTime`, which the server stamps on create. Pure,
 * so the decision runs without Foundry.
 */

/**
 * The launch time in milliseconds, read from the world's `lastPlayed` (a
 * `Date#toString` string, to the second). Null when it is absent or does not
 * parse, which leaves the sweep deciding by contents alone.
 *
 * @param {unknown} lastPlayed `game.world.lastPlayed`
 * @returns {number|null}
 */
export function launchTimeOf(lastPlayed) {
  if (typeof lastPlayed !== "string" || !lastPlayed) return null;
  const t = Date.parse(lastPlayed);
  return Number.isFinite(t) ? t : null;
}

/**
 * Whether a place's age spares it from the sweep: its creation time is a
 * number at or after `bornBefore`. A place with no creation time (made before
 * stats were kept) is not spared, and with no `bornBefore` nothing is.
 *
 * @param {unknown} createdTime the place's `_stats.createdTime`
 * @param {number|null} [bornBefore] the cut, in milliseconds
 * @returns {boolean}
 */
export function sparedByAge(createdTime, bornBefore = null) {
  if (!Number.isFinite(bornBefore)) return false;
  return typeof createdTime === "number" && createdTime >= bornBefore;
}
