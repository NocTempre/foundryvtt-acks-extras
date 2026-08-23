/* global game, foundry, document, Image, CONFIG */
/**
 * A map item — a chart drawn from the ground the party has explored.
 *
 * Dropping a Scene on an item binds the chart to it (`flags.acks-extras.chart`);
 * "Update From Exploration" captures the current fog of war for that scene,
 * reduced to a thumbnail, and records how much of the scene it covers. The
 * capture is a picture of what has been seen, not a live view: a chart drawn
 * on Tuesday shows Tuesday's exploration until somebody redraws it, which is
 * what a chart is.
 *
 * The capture is stored small on purpose. A scene's fog texture is the scene's
 * own size; a 320px reduction keeps the flag at a few kilobytes, and the sheet
 * only ever shows it at 16:9 inside a 600px window.
 */
import { MODULE_ID } from "../constants.mjs";

/** The chart record flag. */
export const CHART_FLAG = "chart";
/** Width of the stored capture, in pixels. */
const CAPTURE_WIDTH = 320;

/** The chart record on an item, or null. */
export const chartOf = (item) => item?.getFlag?.(MODULE_ID, CHART_FLAG) ?? null;

/** Is this item a chart of some scene? */
export const isChart = (item) => !!chartOf(item)?.sceneUuid;

/** The bound Scene document, or null when it no longer exists. */
export function chartScene(item) {
  const uuid = chartOf(item)?.sceneUuid;
  if (!uuid) return null;
  try {
    return foundry.utils.fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

/** Bind (or rebind) the item to a scene. The old capture is dropped — it drew another place. */
export async function bindScene(item, scene) {
  if (!scene?.uuid) return false;
  await item.setFlag(MODULE_ID, CHART_FLAG, { sceneUuid: scene.uuid, explored: null, pct: 0, capturedAt: null });
  return true;
}

/** Unbind the chart: the item is ordinary gear again. */
export async function unbindScene(item) {
  await item.unsetFlag(MODULE_ID, CHART_FLAG);
  return true;
}

/**
 * Count the explored share of a fog texture: explored ground is painted, the
 * rest is transparent. Returns the reduced PNG and the share.
 * @param {string} dataUrl the FogExploration's `explored` image
 * @returns {Promise<{explored:string, pct:number}>}
 */
export async function reduceFog(dataUrl) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("fog image failed to load"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, CAPTURE_WIDTH / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvasEl = document.createElement("canvas");
  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
  const pct = data.length ? lit / (data.length / 4) : 0;
  return { explored: canvasEl.toDataURL("image/png"), pct };
}

/**
 * Redraw the chart from the viewer's exploration of the bound scene.
 * @returns {Promise<{ok:boolean, reason?:string, pct?:number}>}
 */
export async function updateFromExploration(item) {
  const scene = chartScene(item);
  if (!scene) return { ok: false, reason: "noScene" };
  const Fog = CONFIG.FogExploration?.documentClass ?? foundry.documents?.FogExploration;
  const fog = await Fog?.load?.({ scene: scene.id, user: game.user });
  if (!fog?.explored) return { ok: false, reason: "noExploration" };
  const { explored, pct } = await reduceFog(fog.explored);
  await item.setFlag(MODULE_ID, CHART_FLAG, { ...chartOf(item), explored, pct, capturedAt: Date.now() });
  return { ok: true, pct };
}

/** The chart as the sheet snapshot wants it, or null. */
export function chartSnapshot(item) {
  const rec = chartOf(item);
  if (!rec?.sceneUuid) return null;
  const scene = chartScene(item);
  return {
    sceneUuid: rec.sceneUuid,
    sceneName: scene?.name ?? "?",
    sceneMissing: !scene,
    explored: rec.explored ?? null,
    pct: Number(rec.pct) || 0,
  };
}
