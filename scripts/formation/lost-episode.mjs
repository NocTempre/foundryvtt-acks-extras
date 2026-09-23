/* global game, ui */
/**
 * The episode: the one place that knows the order the ledger, the shadow and
 * the fog move in — snapshot before the first fake, faked ground closed
 * before anything is credited, shadows cleared on every ending. Every fog
 * write goes to the scene and level the episode began on, never to whatever
 * the Judge is looking at. See docs/formation/MODEL.md, "Lost".
 */
import { makeLoc } from "../lib/util.mjs";
import { getFormation, patchFormation } from "./formation-model.mjs";
import { seatJourneyHex, travelOf } from "./travel.mjs";
import { beginLost, walkBelieving, discoverLost, reanchorLost, endLost, lostOf, driftSummary } from "./lost.mjs";
import { placeShadow, clearShadows, shadowFor, TRUTH_MOVE_OPTION } from "./shadow.mjs";
import { snapshotFog, restoreFog, paintFakeReveal, announceDiscovery, canFake } from "./lost-fog.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** The scene an episode runs on: the one it began on, else the party's own. */
export function episodeScene(formation, lost = lostOf(travelOf(formation))) {
  return game.scenes?.get(lost.sceneId ?? formation?.sceneId) ?? null;
}

/**
 * The throw failed and the party does not know it: the shadow is placed at
 * the truth, the fog is captured as it honestly stands, and the ledger opens
 * on the party's own scene. Refused, with a warning, unless the Judge is
 * viewing that scene — the faked reveal can only be drawn where it is seen.
 */
export async function beginEpisode(formation, { day, anchor, trueOffset, judgeNote = "" } = {}) {
  if (!game.user?.isGM) return null;
  const scene = game.scenes?.get(formation?.sceneId) ?? null;
  if (!scene || !canFake(scene.id)) {
    ui.notifications?.warn(loc("lost.viewScene"));
    return null;
  }
  const level = scene._view ?? undefined;
  const fogSnapshot = await snapshotFog(scene.id, level);
  await placeShadow(scene, formation, trueOffset ?? anchor);
  await patchFormation(formation.id, (record) => {
    const t = travelOf(record);
    record.travel = {
      ...t,
      lost: beginLost(t.lost, { day, anchor, fogSnapshot, fogSnapshotComplete: true, judgeNote, sceneId: scene.id, level }),
    };
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
  const lost = lostOf(travelOf(formation));
  const scene = episodeScene(formation, lost);
  if (!scene) return null;
  if (trueOffset) await placeShadow(scene, formation, trueOffset);
  let faked = [];
  await patchFormation(formation.id, (record) => {
    const t = travelOf(record);
    const next = walkBelieving(t.lost, believedOffset, trueOffset);
    faked = next.faked;
    record.travel = { ...t, lost: next };
  });
  if (faked.length) await paintFakeReveal(scene.id, faked, lost.level, { complete: lost.fogSnapshotComplete });
  return { faked };
}

/**
 * The throw succeeded: the party learns it is lost, and nothing else. The
 * faked ground closes on the episode's own scene, the observations go with
 * it, and the shadow stays exactly where it is — the episode turns aware.
 */
export async function discoverEpisode(formation) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  const summary = driftSummary(t.lost, t.dayCount);
  const { lost, revert, discovered } = discoverLost(t.lost);
  if (!discovered) return null;
  const scene = episodeScene(formation, t.lost);
  if (revert?.fogSnapshot && scene) await restoreFog(scene.id, revert.fogSnapshot, t.lost.level, { complete: revert.complete });
  await patchFormation(formation.id, (record) => {
    const cur = travelOf(record);
    record.travel = { ...cur, lost };
  });
  announceDiscovery({ days: summary?.days ?? null, fakedHexes: summary?.fakedHexes ?? 0 });
  return { discovered: true, closed: revert?.faked?.length ?? 0 };
}

/**
 * Put the party token where its shadow stands, centred on the same point.
 * Only on the shadow's own scene: a token cannot be moved across scenes.
 * The movement hook skips the write; the clock's baseline and the journey's
 * hex move with it, and no hex is counted as entered.
 */
async function moveToShadow(formation, scene) {
  const shadow = shadowFor(scene, formation.id);
  const party = formation.sceneId === scene?.id ? scene.tokens.get(formation.tokenId) : null;
  if (!shadow || !party) return false;
  const gs = scene.grid.size;
  const cx = shadow.x + (shadow.width * gs) / 2;
  const cy = shadow.y + (shadow.height * gs) / 2;
  const x = Math.round(cx - (party.width * gs) / 2);
  const y = Math.round(cy - (party.height * gs) / 2);
  await party.update({ x, y }, { animate: false, [TRUTH_MOVE_OPTION]: true });
  await patchFormation(formation.id, (rec) => {
    rec.clock = { ...(rec.clock ?? {}), lastPosition: { x: party.x, y: party.y } };
  });
  await seatJourneyHex(party, formation.id);
  return true;
}

/**
 * The party found its last known landmark, or the Judge ruled it recognises
 * the ground: the false ground closes FIRST, then every observation is
 * re-placed at the hex it was really made in, the party token optionally
 * steps onto its shadow, and every shadow retires. Refused, with a warning,
 * when there is ground to credit and the Judge is not viewing the episode's
 * scene, since crediting paints its fog.
 *
 * With no episode open, a shadow an earlier ending left behind is still
 * retired, and the party still steps onto it when asked.
 */
export async function reanchorEpisode(formation, { moveToTruth = true } = {}) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  const scene = episodeScene(formation, t.lost);
  const { lost, commit, revert, reanchored } = reanchorLost(t.lost);
  if (reanchored && commit.length && !(scene && canFake(scene.id, t.lost.level))) {
    ui.notifications?.warn(loc("lost.viewScene"));
    return null;
  }
  const complete = lostOf(t).fogSnapshotComplete;
  if (revert?.fogSnapshot && scene) await restoreFog(scene.id, revert.fogSnapshot, t.lost.level, { complete });
  // Now, and only now, the ground the party really crossed becomes theirs.
  if (commit.length) await paintFakeReveal(scene.id, commit, t.lost.level, { complete });
  const moved = moveToTruth ? await moveToShadow(getFormation(formation.id) ?? formation, scene) : false;
  const cleared = await clearShadows(formation.id);
  if (reanchored) {
    await patchFormation(formation.id, (record) => {
      const cur = travelOf(record);
      record.travel = { ...cur, lost };
    });
  }
  return { reanchored, committed: commit.length, moved, cleared };
}

/**
 * The party retreats, or the Judge closes the episode: the faked ground
 * closes on the episode's scene, nothing is credited, the party token stays
 * where it stands, and every shadow retires — a leftover one included when no
 * episode is open.
 */
export async function endEpisode(formation) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  const scene = episodeScene(formation, t.lost);
  const { lost, revert, ended } = endLost(t.lost);
  if (revert?.fogSnapshot && scene) await restoreFog(scene.id, revert.fogSnapshot, t.lost.level, { complete: revert.complete });
  const cleared = await clearShadows(formation.id);
  if (ended) {
    await patchFormation(formation.id, (record) => {
      const cur = travelOf(record);
      record.travel = { ...cur, lost };
    });
  }
  return { ended, cleared };
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
