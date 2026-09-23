/* global game, canvas, foundry, PIXI */
/**
 * The faked reveal, and its undoing: while a party is astray the ground it
 * *believes* it has crossed is uncovered for the players — the art under the
 * fog and nothing else. Tokens, pins, notes and paths are gated by vision and
 * the TRULY explored set, never by whether fog happens to be lifted, so a
 * feature that reads fog to decide what a player may see leaks straight
 * through this. See docs/formation/MODEL.md, "Lost". Runs on the primary GM
 * client, viewed scene, for the reason `map-items.mjs` does: a scene's fog
 * documents are reachable anywhere, but its fog TEXTURE only exists where it
 * is drawn.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { getSocket, registerHandler } from "../lib/sockets.mjs";
import { makeLoc } from "../lib/util.mjs";
import { fogTextureDims, textureFromBase64, compositeToBase64, exploredDocs, writeExplored, deleteExplored } from "./map-items.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * The FogExploration documents THIS client holds for one scene and level: the
 * Judge's own, and those it created this session; a document a player's client
 * made is never among them. Read only for an episode whose snapshot was taken
 * from them, which could not see a player's fog and so cannot restore one. An
 * `undefined` level (an episode recorded before levels were) matches every
 * level.
 */
function heldDocsFor(sceneId, level) {
  const collection = game.collections.get("FogExploration");
  if (!collection) return [];
  return collection.filter((f) => (f.scene?.id ?? f.scene) === sceneId && (level === undefined || (f.level ?? null) === level));
}

/** The documents an episode reads: the server's, or for an older snapshot the held ones. */
const docsFor = (sceneId, level, complete) => (complete ? exploredDocs(sceneId, level) : heldDocsFor(sceneId, level));

const userOf = (doc) => doc.user?.id ?? doc.user;

/**
 * Capture every user's fog for a scene level, as it truly stands, from the
 * server. Taken ONCE per episode, before anything is faked — `beginLost`
 * refuses to overwrite it. A user with no document snapshots as `null`.
 */
export async function snapshotFog(sceneId, level) {
  if (!game.user?.isGM) return null;
  const docs = await exploredDocs(sceneId, level);
  const snap = {};
  for (const user of game.users) snap[user.id] = docs.find((f) => userOf(f) === user.id)?.explored ?? null;
  return Object.keys(snap).length ? snap : null;
}

/**
 * Write a snapshot back to the scene level it was taken on, closing everything
 * faked since. A user whose snapshot is null, or who is not in it at all (a
 * seat created after it was taken), loses the document rather than keeping an
 * empty bitmap or a faked one. A snapshot with no recorded level writes each
 * user's first document only, as it was taken. A snapshot that is not
 * `complete` saw only the documents this client held, so it writes and deletes
 * only those.
 */
export async function restoreFog(sceneId, snapshot, level, { complete = false } = {}) {
  if (!game.user?.isGM || !snapshot || !sceneId) return false;
  const docs = await docsFor(sceneId, level, complete);
  const targets = level === undefined
    ? Object.keys(snapshot).map((userId) => docs.find((f) => userOf(f) === userId)).filter(Boolean)
    : docs;
  const gone = [];
  for (const doc of targets) {
    const explored = snapshot[userOf(doc)] ?? null;
    if (explored) await writeExplored(doc, explored);
    else gone.push(doc);
  }
  await deleteExplored(gone);
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
 * must not hold up the Judge's turn. A broadcast a player sent (`requestUserId`
 * set by `lib/sockets.mjs`) shows nothing, and the counts are numbers before
 * they reach the markup.
 */
function showDiscovery({ days = null, fakedHexes = 0, requestUserId = null } = {}) {
  if (requestUserId) return;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return;
  const content = `<p>${loc("lost.discovered.body")}</p>`
    + (days != null ? `<p>${loc("lost.discovered.drift", { days: Number(days) || 0, hexes: Number(fakedHexes) || 0 })}</p>` : "")
    + `<p class="hint">${loc("lost.discovered.hint")}</p>`;
  DialogV2.prompt({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("lost.discovered.title"), icon: "fa-solid fa-compass-drafting" },
    content,
    ok: { label: loc("lost.discovered.ok") },
    rejectClose: false,
  }).catch(() => {});
}

/**
 * Tell the TABLE the ground it drew was never theirs, after the revert and
 * naming no direction or position. Broadcast to the other seats and NOT
 * awaited — a dialog nobody is looking at must not hold up the Judge's turn.
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
 * Hex vertices come from the grid itself, the same call the terrain layer
 * paints with.
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
 * Uncover the given hexes for the players on the episode's scene level: the
 * ground, and only the ground. The mask is added to every user's exploration;
 * nothing else follows, since tokens, pins, notes and paths read the ledger
 * rather than the fog. Refused unless this client is drawing that level. An
 * episode whose snapshot is not `complete` paints what this client holds, so
 * its restore can close what it painted.
 */
export async function paintFakeReveal(sceneId, hexKeys, level, { complete = false } = {}) {
  if (!canFake(sceneId, level) || !hexKeys?.length) return false;
  const scene = canvas.scene;
  const dims = fogTextureDims();
  const mask = hexMaskTexture(scene, hexKeys, dims);
  const fogCls = foundry.utils.getDocumentClass("FogExploration");
  const docLevel = scene._view ?? null;
  const docs = await docsFor(sceneId, docLevel, complete);
  try {
    for (const user of game.users) {
      // The Judge is not lied to: their own fog is left exactly as it is.
      if (user.isGM) continue;
      const doc = docs.find((f) => userOf(f) === user.id);
      const layers = [];
      if (doc?.explored) layers.push({ texture: await textureFromBase64(doc.explored), destroy: true });
      layers.push({ texture: mask });
      const b64 = await compositeToBase64(layers, dims);
      if (doc) await writeExplored(doc, b64);
      else {
        await fogCls.create(
          { scene: sceneId, user: user.id, level: docLevel, explored: b64, timestamp: Date.now() },
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

/**
 * Whether this client can draw on a scene level's fog: a GM viewing that
 * scene, on that level when one is named. The fog TEXTURE exists only where
 * it is drawn.
 */
export function canFake(sceneId, level) {
  if (!game.user?.isGM || !sceneId || canvas?.scene?.id !== sceneId) return false;
  return level === undefined || (canvas.scene._view ?? null) === level;
}

/** The flag a scene carries while a formation is astray on it. */
export const ASTRAY_FLAG = `${MODULE_ID}.astray`;
