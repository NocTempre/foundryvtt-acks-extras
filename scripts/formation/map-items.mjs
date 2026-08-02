/* global game, canvas, foundry, PIXI, ChatMessage, ui, Item, fromUuid, CONST */
import { MODULE_ID } from "./constants.mjs";
import {
  getMapperActor,
  getMemberActor,
  getPartyActor,
  mapperIsProficient,
  patchFormation,
} from "./formation-model.mjs";
import { getSocket, registerHandler } from "./socket.mjs";

/**
 * Maps as objects (FOG-DESIGN.md Phases 1–2).
 *
 * All live exploration belongs to a **map session** backed by a **Map item**
 * in the mapper's inventory — an ordinary item, so maps are carried, looted,
 * bought, and sold with no extra machinery.
 *
 * - **New map**: archive & close any current session, delete the scene's
 *   FogExploration documents (exploration restarts from black — no memory of
 *   the entrance after falling through a hole), create a fresh Map item.
 * - **Archive** (each dungeon turn + on close, while the GM views the scene):
 *   copy the current fog union into the item as a base64 bitmap. If the
 *   mapper lacks Mapping proficiency the bitmap is rendered through a hidden,
 *   per-item deterministic warp (scale/offset): *the record is wrong even
 *   though the live view was true*. Re-anchoring such a map later misaligns
 *   against the real dungeon — the RAW "vague measurements" failure mode.
 * - **Anchor** (GM-judged): composite a held Map item's bitmap into every
 *   user's FogExploration for the scene and tell clients to reload fog — the
 *   depicted areas light up as explored, merged with the live session.
 *
 * Everything runs on the primary GM client; archive/anchor additionally need
 * the GM to be viewing the scene (the fog texture and its configuration only
 * exist for the viewed scene).
 */

export const MAP_FLAG = "map";

function loc(key, data = {}) {
  return game.i18n.format(`ACKS-FORMATION.${key}`, data);
}

function gmIds() {
  return game.users.filter((u) => u.isGM).map((u) => u.id);
}

async function announce(formation, text, { whisper = false } = {}) {
  await ChatMessage.create({
    content: `<div class="acks-formation-card"><em>${text}</em></div>`,
    speaker: { alias: formation.name },
    whisper: whisper ? gmIds() : [],
  });
}

/* -------------------------------------------- */
/*  Deterministic warp                          */
/* -------------------------------------------- */

/** Deterministic PRNG from a string seed (mulberry32 over a simple hash). */
function seededRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A small hidden distortion: scale ±7%, offset up to ±2.5% of the map. */
function makeWarp(seed) {
  const rand = seededRandom(seed);
  return {
    sx: 0.93 + rand() * 0.14,
    sy: 0.93 + rand() * 0.14,
    dx: (rand() - 0.5) * 0.05,
    dy: (rand() - 0.5) * 0.05,
  };
}

/** Texture-space matrix for a warp: scale about the center, then offset. */
function warpMatrix(warp, width, height) {
  const m = new PIXI.Matrix();
  m.translate(-width / 2, -height / 2);
  m.scale(warp.sx, warp.sy);
  m.translate(width / 2 + warp.dx * width, height / 2 + warp.dy * height);
  return m;
}

/* -------------------------------------------- */
/*  Texture compositing                         */
/* -------------------------------------------- */

function fogTextureDims() {
  const cfg = canvas.visibility.textureConfiguration;
  return { width: cfg.width, height: cfg.height };
}

async function textureFromBase64(b64) {
  const baseTexture = new PIXI.BaseTexture(b64, { alphaMode: PIXI.ALPHA_MODES.NPM });
  const texture = new PIXI.Texture(baseTexture);
  if (!baseTexture.valid) await new Promise((resolve) => texture.once("update", resolve));
  return texture;
}

/**
 * Render layers (normalized to full-rect texture space, union via ADD on the
 * white-on-black exploration masks) into a render texture; return base64 webp.
 * @param {Array<{texture: PIXI.Texture, transform?: PIXI.Matrix, destroy?: boolean}>} layers
 */
async function compositeToBase64(layers, { width, height }) {
  const rt = PIXI.RenderTexture.create({ width, height });
  const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
  try {
    let first = true;
    for (const layer of layers) {
      if (!layer?.texture?.valid) continue;
      sprite.texture = layer.texture;
      sprite.position.set(0, 0);
      sprite.width = width;
      sprite.height = height;
      sprite.blendMode = first ? PIXI.BLEND_MODES.NORMAL : PIXI.BLEND_MODES.ADD;
      canvas.app.renderer.render(sprite, {
        renderTexture: rt,
        clear: first,
        transform: layer.transform ?? null,
      });
      first = false;
    }
    return await canvas.app.renderer.extract.base64(rt, "image/webp", 0.8);
  } finally {
    sprite.destroy({ children: false, texture: false, baseTexture: false });
    for (const layer of layers) if (layer?.destroy) layer.texture?.destroy(true);
    rt.destroy(true);
  }
}

/* -------------------------------------------- */
/*  Map session lifecycle                       */
/* -------------------------------------------- */

function viewingScene(formation) {
  return !!formation.sceneId && canvas?.scene?.id === formation.sceneId;
}

/** Create the working Map item and register the session on the formation. */
async function openSession(formation, mapper, scene) {
  const proficient = mapperIsProficient(formation);
  const [item] = await mapper.createEmbeddedDocuments("Item", [
    {
      name: loc("map.itemName", { scene: scene.name }),
      type: "item",
      img: "icons/sundries/documents/document-torn-diagram-tan.webp",
      system: {
        description: loc("map.itemDescription", { scene: scene.name, mapper: mapper.name }),
        quantity: { value: 1 },
      },
      flags: {
        [MODULE_ID]: {
          [MAP_FLAG]: {
            sceneId: formation.sceneId,
            sceneName: scene.name,
            explored: null,
            width: 0,
            height: 0,
            quality: proficient ? "accurate" : "distorted",
            warp: makeWarp(foundry.utils.randomID()),
            anchored: false,
            active: true,
          },
        },
      },
    },
  ]);
  // This runs from the environment sync, whose copy of the record can be
  // OLDER than saves made since (deploy's combat flag was being erased by
  // exactly this write). Patch the one field onto the fresh record, with the
  // guards re-checked against current reality; never write the stale copy.
  const patched = await patchFormation(formation.id, (rec) => {
    if (rec.mapSession || rec.combat?.active) return false;
    rec.mapSession = { itemUuid: item.uuid, sceneId: rec.sceneId };
  });
  if (!patched?.mapSession) return; // world moved on: leave the item inactive
  formation.mapSession = patched.mapSession;
  await announce(formation, loc("map.sessionStarted", { mapper: mapper.name }));
  if (!proficient) await announce(formation, loc("map.sessionUnproficient"), { whisper: true });
}

/**
 * Auto-start a session the moment a working mapper exists: assigning the
 * Mapper role IS the "start mapping" action. Unlike "New Map", this keeps the
 * scene's current fog — the mapper picks up from wherever the party stands.
 */
export async function ensureMapSession(formation) {
  if (!game.user.isGM || formation.mapSession) return;
  if (formation.combat?.active) return;
  if (!formation.sceneId || !formation.members.length) return;
  const scene = game.scenes.get(formation.sceneId);
  const mapper = getMapperActor(formation);
  if (!scene || !mapper) return;
  await openSession(formation, mapper, scene);
}

/** "New Map": archive & close the old session, wipe fog, start from black. */
export async function startMapSession(formation) {
  if (!game.user.isGM) return;
  if (!viewingScene(formation)) {
    ui.notifications.warn(loc("map.needsScene"));
    return;
  }
  const mapper = getMapperActor(formation);
  if (!mapper) {
    ui.notifications.warn(loc("map.needsMapper"));
    return;
  }

  if (formation.mapSession) await closeMapSession(formation, { silent: true });

  // Wipe the scene's exploration: the new map starts from black.
  game.socket.emit("resetFog", formation.sceneId);

  await openSession(formation, mapper, canvas.scene);
}

/**
 * Copy the current fog union into the session's Map item. Distorted mappers
 * bake the warp into the stored bitmap. Skips silently when the GM is not
 * viewing the scene or fog is not recording.
 */
export async function archiveSession(formation, { warn = false } = {}) {
  const session = formation.mapSession;
  if (!session || !game.user.isGM) return false;
  if (!viewingScene(formation)) {
    if (warn) ui.notifications.warn(loc("map.archiveNeedsScene"));
    return false;
  }

  const item = await fromUuid(session.itemUuid);
  if (!item) {
    // The working map left the party (traded, deleted): the session dies with
    // it. Patch, not whole-record write — this can run from the stale-copy
    // environment sync.
    formation.mapSession = null;
    await patchFormation(formation.id, (rec) => {
      rec.mapSession = null;
    });
    await announce(formation, loc("map.sessionLostItem"), { whisper: true });
    return false;
  }

  // Mapping is deactivated during combat (RR: you cannot map mid-battle).
  if (formation.combat?.active) return false;

  // Recording is paused (no working mapper → fog DISABLED): the live fog
  // texture is blank, and archiving it would erase the map's record.
  if (canvas.scene.fog.mode === CONST.FOG_EXPLORATION_MODES.DISABLED) return false;

  const fogTexture = canvas.fog.sprite?.texture;
  if (!fogTexture?.valid) return false;

  const dims = fogTextureDims();
  const map = foundry.utils.deepClone(item.getFlag(MODULE_ID, MAP_FLAG) ?? {});
  const distorted = !mapperIsProficient(formation);
  const transform = distorted ? warpMatrix(map.warp ?? makeWarp(item.id), dims.width, dims.height) : null;

  const b64 = await compositeToBase64([{ texture: fogTexture, transform }], dims);
  await item.setFlag(MODULE_ID, MAP_FLAG, {
    ...map,
    explored: b64,
    width: dims.width,
    height: dims.height,
    quality: distorted ? "distorted" : "accurate",
    updated: Date.now(),
  });

  // Keep a human-readable status line on the item so holders can see the
  // record is alive (the bitmap itself lives invisibly in the item's flags).
  const status = `<p data-acks-formation-status><em>${loc("map.statusLine", {
    turns: formation.clock.turnsTotal,
    scene: map.sceneName ?? "?",
  })}</em></p>`;
  const description = item.system?.description ?? "";
  const updated = /<p data-acks-formation-status>.*?<\/p>/.test(description)
    ? description.replace(/<p data-acks-formation-status>.*?<\/p>/, status)
    : description + status;
  if (updated !== description) await item.update({ "system.description": updated });
  return true;
}

/** End the session: final archive, mark the item inactive. */
export async function closeMapSession(formation, { silent = false } = {}) {
  const session = formation.mapSession;
  if (!session || !game.user.isGM) return;
  await archiveSession(formation);
  const item = await fromUuid(session.itemUuid);
  if (item) {
    const map = item.getFlag(MODULE_ID, MAP_FLAG) ?? {};
    await item.setFlag(MODULE_ID, MAP_FLAG, { ...map, active: false });
  }
  formation.mapSession = null;
  await patchFormation(formation.id, (rec) => {
    rec.mapSession = null;
  });
  if (!silent) await announce(formation, loc("map.sessionClosed"));
}

/* -------------------------------------------- */
/*  Anchoring                                   */
/* -------------------------------------------- */

/** All Map items held by members or the party actor. */
export function collectMapItems(formation) {
  const holders = formation.members.map((m) => getMemberActor(m)).filter(Boolean);
  const partyActor = getPartyActor(formation);
  if (partyActor) holders.push(partyActor);
  const maps = [];
  for (const holder of holders) {
    for (const item of holder.items) {
      const map = item.getFlag(MODULE_ID, MAP_FLAG);
      if (map) maps.push({ item, holder, map });
    }
  }
  return maps;
}

/**
 * Composite a Map item's bitmap into every user's FogExploration for the
 * viewed scene, then have all clients reload fog. GM-judged: only offer this
 * when the party has connected its position to territory the map depicts.
 */
export async function anchorMap(formation, itemUuid) {
  if (!game.user.isGM) return;
  const item = await fromUuid(itemUuid);
  const map = item?.getFlag(MODULE_ID, MAP_FLAG);
  if (!map) return;
  if (canvas?.scene?.id !== map.sceneId) {
    ui.notifications.warn(loc("map.wrongScene", { scene: map.sceneName ?? "?" }));
    return;
  }
  if (!map.explored) {
    ui.notifications.warn(loc("map.emptyMap"));
    return;
  }

  const dims = fogTextureDims();
  const mapTexture = await textureFromBase64(map.explored);
  const sceneId = canvas.scene.id;
  const level = canvas.scene._view ?? null;
  const fogCls = foundry.utils.getDocumentClass("FogExploration");
  const collection = game.collections.get("FogExploration");

  try {
    for (const user of game.users) {
      const doc = collection.find(
        (f) => ((f.scene?.id ?? f.scene) === sceneId) && ((f.user?.id ?? f.user) === user.id) && (f.level ?? null) === level,
      );
      const layers = [];
      if (doc?.explored) layers.push({ texture: await textureFromBase64(doc.explored), destroy: true });
      layers.push({ texture: mapTexture });
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
    mapTexture.destroy(true);
  }

  await item.setFlag(MODULE_ID, MAP_FLAG, { ...map, anchored: true });
  // Reload fog on every client (executeForEveryone runs here too, so the
  // guard inside reloadFog handles clients not viewing this scene).
  const socket = getSocket();
  if (socket) await socket.executeForEveryone("reloadFog", sceneId);
  else await reloadFog(sceneId);
  await announce(formation, loc("map.anchored", { name: item.name }));
  if (map.quality === "distorted") {
    await announce(formation, loc("map.anchoredDistorted"), { whisper: true });
  }
}

/* -------------------------------------------- */
/*  GM authoring                                */
/* -------------------------------------------- */

/** Snapshot the GM's current fog view of this scene into a new world Map item. */
export async function saveFogAsMapItem() {
  if (!game.user.isGM || !canvas?.scene) return;
  const fogTexture = canvas.fog.sprite?.texture;
  if (!fogTexture?.valid) {
    ui.notifications.warn(loc("map.emptyMap"));
    return;
  }
  const dims = fogTextureDims();
  const b64 = await compositeToBase64([{ texture: fogTexture }], dims);
  const item = await Item.implementation.create({
    name: loc("map.itemName", { scene: canvas.scene.name }),
    type: "item",
    img: "icons/sundries/documents/document-sealed-brown.webp",
    system: { description: loc("map.authoredDescription", { scene: canvas.scene.name }), quantity: { value: 1 } },
    flags: {
      [MODULE_ID]: {
        [MAP_FLAG]: {
          sceneId: canvas.scene.id,
          sceneName: canvas.scene.name,
          explored: b64,
          width: dims.width,
          height: dims.height,
          quality: "accurate",
          warp: makeWarp(foundry.utils.randomID()),
          anchored: false,
          active: false,
        },
      },
    },
  });
  ui.notifications.info(loc("map.authored", { name: item.name }));
  return item;
}

/* -------------------------------------------- */
/*  Socket                                      */
/* -------------------------------------------- */

async function reloadFog(sceneId) {
  if (canvas?.scene?.id !== sceneId) return;
  await canvas.fog.load({ preserve: true });
  canvas.perception.initialize();
}

/** Register the fog-reload handler with socketlib. */
export function registerMapSocket() {
  registerHandler("reloadFog", reloadFog);
}
