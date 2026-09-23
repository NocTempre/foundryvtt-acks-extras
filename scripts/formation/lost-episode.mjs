/* global game, canvas */
/**
 * The episode: the one place that knows the order the ledger, the shadow and
 * the fog move in — snapshot before the first fake, faked ground closed
 * before anything is credited. See docs/formation/MODEL.md, "Lost".
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
 * The throw failed and the party does not know it: the shadow is placed at
 * the truth, the fog is captured as it honestly stands, and the ledger opens.
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
 * reached another. The shadow follows the truth, the ledger records the
 * pair as an observation, and the believed hex is uncovered for the players
 * — the ground only.
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
 * The throw succeeded: the party learns it is lost, and nothing else. The
 * faked ground closes, the observations go with it, and the shadow stays
 * exactly where it is.
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
 * the ground: the false ground closes FIRST, then every observation is
 * re-placed at the hex it was really made in, and the shadow retires.
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
