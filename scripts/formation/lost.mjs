/**
 * Being lost: two positions, one of them a lie the party believes.
 *
 * A lost party is somewhere real and thinks it is somewhere else, and both
 * facts have to be kept. The TRUE position stays the party token's — every
 * derivation in the feature already reads it, and none of them may start
 * reading anything else — while the BELIEVED position is what the table sees
 * and what the players move.
 *
 * The ledger here owns the episode: where the lie started, which hexes the
 * party has since walked believing them, what it saw and where it really saw
 * it, and the one fog snapshot taken at the moment the lie began. It is pure —
 * no canvas, no documents — so the transitions can be tested.
 *
 * It does NOT own the true position. That is a shadow token
 * ([shadow.mjs](./shadow.mjs)), because a lost party is an object in space and
 * every question worth asking about one — how far to another lost party, to
 * the landmark, to a searching group — is a distance Foundry already measures.
 * The offsets recorded here are the observations' provenance, not a position.
 *
 * **Discovery is not rescue.** A successful navigation throw ends the episode
 * by telling the party it was lost. It does not hand back the position, and it
 * does not redraw the faked ground as though it had been earned — the faked
 * reveal is reverted whole, which is the moment the players learn the last few
 * days were not where they thought.
 */

/** A formation with no lie in progress. */
export function freshLost() {
  return {
    active: false,
    sinceDay: null,
    judgeNote: "",
    /** Where the party was last known — by everyone — to really be. */
    anchor: null,
    /** The hex the party BELIEVES it holds. Players' marker stands here. */
    believed: null,
    /**
     * What the party has actually SEEN while astray, as pairs. `at` is the hex
     * the observation was really made in; `shown` is where the party thinks it
     * was. Display uses `shown`; a re-anchor re-keys every pair to `at`.
     */
    observations: [],
    /** Hexes uncovered for the players while astray, to be closed on revert. */
    faked: [],
    /** Per-user fog, captured once when the lie began. `{userId: base64}`. */
    fogSnapshot: null,
  };
}

/** Normalize whatever the record holds. */
export function lostOf(travel) {
  const l = travel?.lost ?? {};
  const fresh = freshLost();
  return {
    ...fresh,
    ...l,
    active: !!l.active,
    faked: Array.isArray(l.faked) ? l.faked.filter((k) => typeof k === "string") : [],
    observations: Array.isArray(l.observations)
      ? l.observations.filter((o) => o && typeof o.at === "string" && typeof o.shown === "string")
      : [],
    fogSnapshot: l.fogSnapshot && typeof l.fogSnapshot === "object" ? l.fogSnapshot : null,
  };
}

/** A hex key from an offset, matching the terrain layer's identity exactly. */
export const hexKey = (offset) => `${offset?.i}:${offset?.j}`;

/**
 * Begin an episode: the throw failed, and the party does not know it.
 *
 * `anchor` is the last position everyone agrees on — the hex the party held
 * when the throw failed — and it is what the believed marker starts from and
 * what a revert winds back to. The snapshot is taken HERE and once: it is the
 * fog as it truly stood before any of it was faked.
 */
export function beginLost(lost, { day, anchor, fogSnapshot = null, judgeNote = "" } = {}) {
  const l = lostOf({ lost });
  if (l.active) return l;
  return {
    ...l,
    active: true,
    sinceDay: Number.isFinite(Number(day)) ? Number(day) : null,
    anchor: anchor ?? null,
    believed: anchor ?? null,
    faked: [],
    observations: [],
    fogSnapshot,
    judgeNote: String(judgeNote ?? ""),
  };
}

/**
 * A day walked while astray: the party believes it reached `believed`, and
 * that hex joins the faked reveal.
 *
 * Recording the hex is what makes the revert exact — the ledger, not the fog
 * bitmap, is the authority on what was faked. A repeat of the same hex adds
 * nothing.
 */
export function walkBelieving(lost, believedOffset, trueOffset = null) {
  const l = lostOf({ lost });
  if (!l.active) return l;
  const shown = hexKey(believedOffset);
  const at = trueOffset ? hexKey(trueOffset) : null;
  const seen = at && !l.observations.some((o) => o.at === at && o.shown === shown);
  return {
    ...l,
    believed: believedOffset ?? l.believed,
    faked: l.faked.includes(shown) ? l.faked : [...l.faked, shown],
    observations: seen ? [...l.observations, { at, shown }] : l.observations,
  };
}

/**
 * The throw succeeded: the party realises it is lost.
 *
 * Returns the cleared ledger AND the revert instruction — the hexes to close
 * and the snapshot to write back — because the caller owns the canvas and this
 * file must not. A `null` return for `revert` means there was nothing faked to
 * undo, which is the case when the party notices on the very first day.
 *
 * Strict RAW: nothing here restores the party's knowledge of WHERE it is. The
 * believed marker is retired, not moved.
 */
export function discoverLost(lost) {
  const l = lostOf({ lost });
  if (!l.active) return { lost: l, revert: null, discovered: false };
  const revert = (l.faked.length || l.fogSnapshot)
    ? { faked: l.faked, fogSnapshot: l.fogSnapshot, anchor: l.anchor, discard: l.observations }
    : null;
  return { lost: { ...freshLost(), judgeNote: l.judgeNote }, revert, discovered: true };
}

/**
 * The party re-establishes itself — it found its last known landmark, or the
 * Judge ruled it recognised the ground.
 *
 * This is the ONLY transition that credits anything. Every observation is
 * re-keyed from where the party thought it was to where it really was, and the
 * caller commits those hexes as genuinely explored. Discovery alone never
 * reaches here: a party can know it is lost for days and still not know where.
 *
 * Returns `commit` — the true hexes earned — and the cleared ledger. The faked
 * ground still has to be closed first, so `revert` rides along.
 */
export function reanchorLost(lost) {
  const l = lostOf({ lost });
  if (!l.active) return { lost: l, commit: [], revert: null, reanchored: false };
  const commit = [...new Set(l.observations.map((o) => o.at))];
  const revert = (l.faked.length || l.fogSnapshot)
    ? { faked: l.faked, fogSnapshot: l.fogSnapshot, anchor: l.anchor, discard: [] }
    : null;
  return { lost: { ...freshLost(), judgeNote: l.judgeNote }, commit, revert, reanchored: true };
}

/**
 * How far the lie has run, for the Judge's readout: days astray and how many
 * hexes of ground the party has drawn on a map that is wrong.
 */
export function driftSummary(lost, currentDay) {
  const l = lostOf({ lost });
  if (!l.active) return null;
  const days = Number.isFinite(Number(currentDay)) && Number.isFinite(Number(l.sinceDay))
    ? Math.max(0, Number(currentDay) - Number(l.sinceDay))
    : null;
  return {
    days,
    fakedHexes: l.faked.length,
    observations: l.observations.length,
    anchor: l.anchor,
    believed: l.believed,
  };
}
