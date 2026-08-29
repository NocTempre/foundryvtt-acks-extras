/* global game, canvas */
/**
 * The episode: one place that knows the ledger, the shadow and the fog.
 *
 * Each of the three below it is deliberately ignorant of the others —
 * [lost.mjs](./lost.mjs) is pure bookkeeping, [shadow.mjs](./shadow.mjs) owns a
 * token, [lost-fog.mjs](./lost-fog.mjs) owns bitmaps — so this is the only
 * file that has to know the ORDER things happen in, and the order is what the
 * feature gets wrong if nobody owns it.
 *
 * Two orderings matter and both are load-bearing:
 *
 *  - **The fog snapshot is taken before the first fake.** Once anything is
 *    faked there is no longer a record of what was truly earned, and a revert
 *    would restore a lie.
 *  - **Faked ground is closed before anything is credited.** A re-anchor that
 *    committed first would briefly show the true track and the false one at
 *    once, which is the single most confusing frame the feature could draw.
 */
import { patchFormation } from "./formation-model.mjs";
import { travelOf } from "./travel.mjs";
import { beginLost, walkBelieving, discoverLost, reanchorLost, lostOf, driftSummary } from "./lost.mjs";
import { placeShadow, clearShadow } from "./shadow.mjs";
import { snapshotFog, restoreFog, paintFakeReveal, announceDiscovery, canFake } from "./lost-fog.mjs";

/** The scene an episode runs on: the one the Judge is looking at. */
function sceneFor() {
  return canvas?.scene ?? null;
}

/**
 * The throw failed and the party does not know it.
 *
 * The shadow is placed at the truth, the fog is captured as it honestly
 * stands, and the ledger opens. Nothing is faked yet — the party has not moved
 * since the failure.
 */
export async function beginEpisode(formation, { day, anchor, trueOffset, judgeNote = "" } = {}) {
  if (!game.user?.isGM) return null;
  const scene = sceneFor();
  if (!scene) return null;
  const fogSnapshot = snapshotFog(scene.id);
  await placeShadow(scene, formation, trueOffset ?? anchor);
  await patchFormation(formation.id, (record) => {
    const t = travelOf(record);
    record.travel = { ...t, lost: beginLost(t.lost, { day, anchor, fogSnapshot, judgeNote }) };
  });
  return { snapshotted: !!fogSnapshot };
}

/**
 * A day walked astray: the party believes it reached one hex and really
 * reached another.
 *
 * The shadow follows the truth, the ledger records the pair, and the believed
 * hex is uncovered for the players — the ground only. Everything the party
 * actually saw is kept as an observation so a later re-anchor can put it where
 * it belongs.
 */
export async function walkAstray(formation, { believedOffset, trueOffset } = {}) {
  if (!game.user?.isGM) return null;
  const scene = sceneFor();
  if (!scene) return null;
  if (trueOffset) await placeShadow(scene, formation, trueOffset);
  let faked = [];
  await patchFormation(formation.id, (record) => {
    const t = travelOf(record);
    const next = walkBelieving(t.lost, believedOffset, trueOffset);
    faked = next.faked;
    record.travel = { ...t, lost: next };
  });
  if (canFake(scene.id) && faked.length) await paintFakeReveal(scene.id, faked);
  return { faked };
}

/**
 * The throw succeeded: the party learns it is lost.
 *
 * Strict RAW — it learns nothing else. The faked ground closes, the
 * observations go with it, and the shadow stays exactly where it is because
 * the party is still standing there and still does not know where that is.
 */
export async function discoverEpisode(formation) {
  if (!game.user?.isGM) return null;
  const scene = sceneFor();
  const t = travelOf(formation);
  const summary = driftSummary(t.lost, t.dayCount);
  const { lost, revert, discovered } = discoverLost(t.lost);
  if (!discovered) return null;
  if (revert?.fogSnapshot && scene) await restoreFog(scene.id, revert.fogSnapshot);
  await patchFormation(formation.id, (record) => {
    const cur = travelOf(record);
    record.travel = { ...cur, lost };
  });
  announceDiscovery({ days: summary?.days ?? null, fakedHexes: summary?.fakedHexes ?? 0 });
  return { discovered: true, closed: revert?.faked?.length ?? 0 };
}

/**
 * The party found its last known landmark, or the Judge ruled it recognises
 * the ground.
 *
 * The only ending that credits anything: the false ground closes FIRST, then
 * every observation is re-placed at the hex it was really made in. The shadow
 * is retired here and only here — the party knows where it is again, so the
 * truth and the token agree once more.
 */
export async function reanchorEpisode(formation) {
  if (!game.user?.isGM) return null;
  const scene = sceneFor();
  const t = travelOf(formation);
  const { lost, commit, revert, reanchored } = reanchorLost(t.lost);
  if (!reanchored) return null;
  if (revert?.fogSnapshot && scene) await restoreFog(scene.id, revert.fogSnapshot);
  // Now, and only now, the ground the party really crossed becomes theirs.
  if (commit.length && scene && canFake(scene.id)) await paintFakeReveal(scene.id, commit);
  await clearShadow(scene, formation.id);
  await patchFormation(formation.id, (record) => {
    const cur = travelOf(record);
    record.travel = { ...cur, lost };
  });
  return { reanchored: true, committed: commit.length };
}

/**
 * Whether this formation is astray.
 *
 * `lostOf` takes the TRAVEL object and reads `.lost` off it — handing it the
 * lost object directly reads `undefined` and answers a confident "not lost".
 */
export function isAstray(formation) {
  return lostOf(travelOf(formation)).active;
}
