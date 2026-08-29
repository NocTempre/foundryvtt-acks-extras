/* global game, canvas, foundry, PIXI */
/**
 * The faked reveal, and its undoing.
 *
 * While a party is astray the ground it *believes* it has crossed is uncovered
 * for the players — the art under the fog and nothing else. It reveals no
 * authored content: tokens are gated by vision already, and pins, notes and
 * declared paths are filtered by the TRULY explored set, never by whether fog
 * happens to be lifted. A feature that reads fog to decide what a player may
 * see leaks straight through this, and that is a defect in that feature.
 *
 * The undoing is exact rather than reconstructed: each user's fog is captured
 * once, at the moment the lie begins, and written back whole on discovery.
 * Subtracting a faked area from a live bitmap drifts, and a map that drifts is
 * worse than one that is simply wrong.
 *
 * Everything here runs on the primary GM client, on the viewed scene, for the
 * same reason `map-items.mjs` does: a scene's fog documents are reachable
 * anywhere, but its fog TEXTURE only exists where it is drawn.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { getSocket, registerHandler } from "../lib/sockets.mjs";
import { makeLoc } from "../lib/util.mjs";
import { fogTextureDims, textureFromBase64, compositeToBase64 } from "./map-items.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** The FogExploration documents for one scene, one per user that has any. */
function fogDocsFor(sceneId) {
  const collection = game.collections.get("FogExploration");
  if (!collection) return [];
  return collection.filter((f) => (f.scene?.id ?? f.scene) === sceneId);
}

/**
 * Capture every user's fog for a scene, as it truly stands.
 *
 * Taken ONCE per episode, before anything is faked — `beginLost` refuses to
 * overwrite it — so this is the only record of what the party had really
 * earned. A user with no document yet snapshots as `null`, which restores by
 * DELETING their document rather than writing an empty one.
 */
export function snapshotFog(sceneId) {
  if (!game.user?.isGM) return null;
  const snap = {};
  for (const user of game.users) {
    const doc = fogDocsFor(sceneId).find((f) => (f.user?.id ?? f.user) === user.id);
    snap[user.id] = doc?.explored ?? null;
  }
  return Object.keys(snap).length ? snap : null;
}

/**
 * Write a snapshot back, closing everything faked since it was taken.
 *
 * A user whose snapshot is null had no exploration at all when the lie began,
 * so their document is removed — restoring an empty bitmap would leave the
 * scene "explored but black", which reads as a bug rather than as fog.
 */
export async function restoreFog(sceneId, snapshot) {
  if (!game.user?.isGM || !snapshot) return false;
  const docs = fogDocsFor(sceneId);
  for (const [userId, explored] of Object.entries(snapshot)) {
    const doc = docs.find((f) => (f.user?.id ?? f.user) === userId);
    if (explored) {
      if (doc) await doc.update({ explored, timestamp: Date.now() }, { loadFog: false });
    } else if (doc) {
      await doc.delete();
    }
  }
  await reloadEveryone(sceneId);
  return true;
}

/** Tell every client to re-pull the scene's fog, the way anchoring does. */
async function reloadEveryone(sceneId) {
  const socket = getSocket();
  if (socket) await socket.executeForEveryone("reloadFog", sceneId);
  else if (canvas?.scene?.id === sceneId) await canvas.fog?.load?.();
}

/**
 * Show one player the dialog that says the ground was never theirs.
 *
 * Runs on the PLAYER's client, which is the whole point: the Judge already
 * knows. It never awaits the click — a dialog nobody happens to be looking at
 * must not hold up the Judge's turn.
 */
function showDiscovery({ days = null, fakedHexes = 0 } = {}) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return;
  const content = `<p>${loc("lost.discovered.body")}</p>`
    + (days != null ? `<p>${loc("lost.discovered.drift", { days, hexes: fakedHexes })}</p>` : "")
    + `<p class="hint">${loc("lost.discovered.hint")}</p>`;
  DialogV2.prompt({
    window: { title: loc("lost.discovered.title"), icon: "fa-solid fa-compass-drafting" },
    content,
    ok: { label: loc("lost.discovered.ok") },
    rejectClose: false,
  }).catch(() => {});
}

/**
 * Tell the TABLE the ground it drew was never theirs.
 *
 * Deliberately blunt and deliberately after the revert: the players watch the
 * map lose the hexes, then read why. It names no direction and no position — a
 * successful throw reveals that the party was lost, never where it went.
 *
 * Broadcast to the other seats and NOT awaited. Awaiting a dialog would park
 * the Judge's turn on a click that may never come, and showing it to the Judge
 * would tell them something they already know.
 */
export function announceDiscovery(payload = {}) {
  const socket = getSocket();
  if (socket) socket.executeForOthers("lostDiscovered", payload);
  else showDiscovery(payload);
}

/** Register the player-side handler. Called once, beside the fog handler. */
export function registerLostSocket() {
  registerHandler("lostDiscovered", showDiscovery);
}

/**
 * A white-on-black mask of the given hexes, in the fog texture's own space.
 *
 * The exploration bitmaps are white-where-seen and unioned with ADD, so a mask
 * drawn the same way composites without any blend trickery. Hex vertices come
 * from the grid itself — the same call the terrain layer paints with — so the
 * faked ground lands exactly on the cells the ledger names and never a pixel
 * off.
 */
function hexMaskTexture(scene, hexKeys, dims) {
  const rect = canvas.dimensions.sceneRect;
  const g = new PIXI.Graphics();
  g.beginFill(0xffffff, 1);
  for (const key of hexKeys) {
    const [i, j] = String(key).split(":").map(Number);
    if (!Number.isFinite(i) || !Number.isFinite(j)) continue;
    const vertices = scene.grid.getVertices({ i, j });
    if (!vertices?.length) continue;
    g.drawPolygon(vertices.flatMap((v) => [v.x - rect.x, v.y - rect.y]));
  }
  g.endFill();
  const rt = PIXI.RenderTexture.create({ width: dims.width, height: dims.height });
  // Scene space is larger than the fog texture; the fog covers the scene rect,
  // so one scale takes the polygons into texture space.
  const transform = new PIXI.Matrix().scale(dims.width / rect.width, dims.height / rect.height);
  canvas.app.renderer.render(g, { renderTexture: rt, clear: true, transform });
  g.destroy(true);
  return rt;
}

/**
 * Uncover the believed hexes for the players: the ground, and only the ground.
 *
 * The mask is added to every user's exploration, so the art under the fog
 * shows and the party's map grows the way a true march would grow it. Nothing
 * else follows — tokens are gated by vision, and pins, notes and paths read the
 * ledger rather than the fog.
 *
 * GM-and-viewed-scene, for the reason archiving is: a scene's fog documents are
 * reachable anywhere, but its fog TEXTURE only exists where it is drawn.
 */
export async function paintFakeReveal(sceneId, hexKeys) {
  if (!canFake(sceneId) || !hexKeys?.length) return false;
  const scene = canvas.scene;
  const dims = fogTextureDims();
  const mask = hexMaskTexture(scene, hexKeys, dims);
  const fogCls = foundry.utils.getDocumentClass("FogExploration");
  const level = scene._view ?? null;
  try {
    for (const user of game.users) {
      // The Judge is not lied to: their own fog is left exactly as it is.
      if (user.isGM) continue;
      const doc = fogDocsFor(sceneId).find((f) => (f.user?.id ?? f.user) === user.id);
      const layers = [];
      if (doc?.explored) layers.push({ texture: await textureFromBase64(doc.explored), destroy: true });
      layers.push({ texture: mask });
      const b64 = await compositeToBase64(layers, dims);
      if (doc) await doc.update({ explored: b64, timestamp: Date.now() }, { loadFog: false });
      else {
        await fogCls.create(
          { scene: sceneId, user: user.id, level, explored: b64, timestamp: Date.now() },
          { loadFog: false },
        );
      }
    }
  } finally {
    mask.destroy(true);
  }
  await reloadEveryone(sceneId);
  return true;
}

/** Whether the faked reveal can actually be drawn on this client. */
export function canFake(sceneId) {
  return !!game.user?.isGM && canvas?.scene?.id === sceneId;
}

/** The flag a scene carries while a formation is astray on it. */
export const ASTRAY_FLAG = `${MODULE_ID}.astray`;
