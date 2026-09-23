/**
 * Being lost: two positions, one of them a lie the party believes.
 *
 * A lost party is somewhere real and thinks it is somewhere else, and both
 * facts have to be kept. The party token stands at the BELIEVED position, the
 * one the table sees and the players move; the TRUE position is a shadow token
 * ([shadow.mjs](./shadow.mjs)), because every question worth asking about a lost
 * party — how far to another one, to the landmark, to a searching group — is a
 * distance Foundry already measures. The offsets recorded here are the
 * observations' provenance, not a position.
 *
 * The ledger here owns the episode: its phase, the scene and level it runs on,
 * where the lie started, which hexes the party has since walked believing
 * them, what it saw and where it really saw it, and the one fog snapshot taken
 * at the moment the lie began. It is pure — no canvas, no documents — so the
 * transitions can be tested.
 *
 * An episode has two phases. ASTRAY: the party does not know. AWARE: a
 * successful navigation throw told it so, and it still does not know where it
 * is. **Discovery is not rescue**: it hands back neither the position nor the
 * faked ground — the faked reveal is reverted whole, which is the moment the
 * players learn the last few days were not where they thought. Only re-anchor
 * (the landmark found) credits anything, and retreat (`endLost`) credits
 * nothing. Both close the episode from either phase.
 */

/** The phases of an open episode; a closed ledger's phase is null. */
export const LOST_PHASES = Object.freeze(["astray", "aware"]);

/** A formation with no lie in progress. */
export function freshLost() {
  return {
    phase: null,
    /** `phase === "astray"`, stored for the readers of the raw travel record. */
    active: false,
    /** The scene the episode runs on; its fog and shadow live there. */
    sceneId: null,
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
    /**
     * Whether the snapshot was read from every seat's stored fog, so a null
     * entry means that seat had none. A snapshot taken from the Judge's client
     * alone leaves it false, and its restore touches only what it saw.
     */
    fogSnapshotComplete: false,
  };
}

/**
 * Normalize whatever the record holds. A record from before phases were kept
 * reads as astray when it was active. `level` is the scene level the fog was
 * snapshotted on, and stays `undefined` for a record that never stored one,
 * which the fog code reads as "any level".
 */
export function lostOf(travel) {
  const l = travel?.lost ?? {};
  const fresh = freshLost();
  const phase = LOST_PHASES.includes(l.phase) ? l.phase : (l.active ? "astray" : null);
  return {
    ...fresh,
    ...l,
    phase,
    active: phase === "astray",
    sceneId: typeof l.sceneId === "string" ? l.sceneId : null,
    level: typeof l.level === "string" ? l.level : undefined,
    faked: Array.isArray(l.faked) ? l.faked.filter((k) => typeof k === "string") : [],
    observations: Array.isArray(l.observations)
      ? l.observations.filter((o) => o && typeof o.at === "string" && typeof o.shown === "string")
      : [],
    fogSnapshot: l.fogSnapshot && typeof l.fogSnapshot === "object" ? l.fogSnapshot : null,
    fogSnapshotComplete: l.fogSnapshotComplete === true,
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
 * fog as it truly stood before any of it was faked. An open episode, in either
 * phase, is returned unchanged.
 */
export function beginLost(lost, {
  day, anchor, fogSnapshot = null, fogSnapshotComplete = false, judgeNote = "", sceneId = null, level,
} = {}) {
  const l = lostOf({ lost });
  if (l.phase) return l;
  return {
    ...l,
    phase: "astray",
    active: true,
    sceneId: typeof sceneId === "string" ? sceneId : null,
    level: typeof level === "string" ? level : undefined,
    sinceDay: Number.isFinite(Number(day)) ? Number(day) : null,
    anchor: anchor ?? null,
    believed: anchor ?? null,
    faked: [],
    observations: [],
    fogSnapshot,
    fogSnapshotComplete: fogSnapshotComplete === true,
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
  if (l.phase !== "astray") return l;
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

/** The revert instruction for an astray ledger, or null when nothing was faked. */
function revertOf(l, discard) {
  return (l.faked.length || l.fogSnapshot)
    ? { faked: l.faked, fogSnapshot: l.fogSnapshot, complete: l.fogSnapshotComplete, anchor: l.anchor, discard }
    : null;
}

/** A closed ledger that keeps the Judge's note. */
const closed = (l) => ({ ...freshLost(), judgeNote: l.judgeNote });

/**
 * The throw succeeded: the party realises it is lost, and the episode turns
 * AWARE.
 *
 * Returns the aware ledger AND the revert instruction — the hexes to close and
 * the snapshot to write back — because the caller owns the canvas and this
 * file must not. A `null` return for `revert` means there was nothing faked to
 * undo, which is the case when the party notices on the very first day.
 *
 * Strict RAW: nothing here restores the party's knowledge of WHERE it is. The
 * believed marker is retired, not moved; the anchor, scene and shadow stay,
 * because a later re-anchor still needs them.
 */
export function discoverLost(lost) {
  const l = lostOf({ lost });
  if (l.phase !== "astray") return { lost: l, revert: null, discovered: false };
  const aware = {
    ...l, phase: "aware", active: false, believed: null, faked: [], observations: [], fogSnapshot: null, fogSnapshotComplete: false,
  };
  return { lost: aware, revert: revertOf(l, l.observations), discovered: true };
}

/**
 * The party re-establishes itself — it found its last known landmark, or the
 * Judge ruled it recognised the ground. Closes an episode in either phase.
 *
 * This is the ONLY transition that credits anything. Every observation is
 * re-keyed from where the party thought it was to where it really was, and the
 * caller commits those hexes as genuinely explored. An aware party has none
 * left to commit: discovery discarded them.
 *
 * Returns `commit` — the true hexes earned — and the cleared ledger. The faked
 * ground still has to be closed first, so `revert` rides along.
 */
export function reanchorLost(lost) {
  const l = lostOf({ lost });
  if (!l.phase) return { lost: l, commit: [], revert: null, reanchored: false };
  const commit = [...new Set(l.observations.map((o) => o.at))];
  return { lost: closed(l), commit, revert: revertOf(l, []), reanchored: true };
}

/**
 * The party retreats, or the Judge closes the episode: the faked ground
 * closes and nothing is credited. Closes an episode in either phase.
 */
export function endLost(lost) {
  const l = lostOf({ lost });
  if (!l.phase) return { lost: l, revert: null, ended: false };
  return { lost: closed(l), revert: revertOf(l, l.observations), ended: true };
}

/**
 * How far the lie has run, for the Judge's readout: the phase, days since the
 * episode began, and how many hexes of ground the party has drawn on a map
 * that is wrong. Null when no episode is open.
 */
export function driftSummary(lost, currentDay) {
  const l = lostOf({ lost });
  if (!l.phase) return null;
  const days = Number.isFinite(Number(currentDay)) && Number.isFinite(Number(l.sinceDay))
    ? Math.max(0, Number(currentDay) - Number(l.sinceDay))
    : null;
  return {
    phase: l.phase,
    days,
    fakedHexes: l.faked.length,
    observations: l.observations.length,
    anchor: l.anchor,
    believed: l.believed,
  };
}
