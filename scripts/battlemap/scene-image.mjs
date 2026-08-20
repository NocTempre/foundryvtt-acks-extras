/* global canvas, foundry */
/**
 * Which image the assistant calibrates against, and how to repoint it.
 *
 * A Scene's background lives on a Level in the scene's `levels` collection.
 * `Scene#background` survives as a DEPRECATED READ-ONLY getter: reading
 * through it works but logs a compatibility warning, and writing through it
 * is silently dropped. Every background read and write goes through this
 * file so that asymmetry is stated once and never re-learned at a keyboard.
 */

/**
 * The Level whose background is on screen for this scene: the level being
 * viewed when this is the active scene, else the scene's initial level.
 */
export function activeLevel(scene) {
  if (!scene?.levels) return null;
  const viewing = canvas?.scene?.id && canvas.scene.id === scene.id;
  return (viewing ? canvas.level : null) ?? scene.initialLevel ?? scene.firstLevel ?? null;
}

/** The background image path, or null. */
export function backgroundSrc(scene) {
  const level = activeLevel(scene);
  if (level) return level.background?.src ?? null;
  return scene?.background?.src ?? null;
}

/** The loaded background texture, or null when the scene has no image. */
export function backgroundTexture(scene) {
  const src = backgroundSrc(scene);
  return src ? foundry.canvas.getTexture(src) : null;
}

/**
 * Repoint the scene at a different background image. Writes the Level that
 * owns it; a scene with no levels collection takes the flat field.
 */
export async function setBackgroundSrc(scene, src) {
  const level = activeLevel(scene);
  if (level?.update) await level.update({ "background.src": src });
  else await scene.update({ "background.src": src });
}
