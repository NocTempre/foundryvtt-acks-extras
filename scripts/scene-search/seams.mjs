/**
 * The places scene search waits on work that has not landed. Each is one named
 * function so the wiring is a single edit when its owner arrives, and none edits
 * a document on its own.
 */

/**
 * A hidden exit was found: tell the map. The wall is the one a found check's
 * `wall:` reveal names (its id, without the prefix). The check has already
 * recorded the reveal in the exit thing's `state`; showing the wall itself is
 * the dungeon close-out's `revealSecretDoor(wall)`, which this calls when it is
 * passed one and does nothing without it. It never edits a wall.
 *
 * @param {Scene|null} scene the scene the wall is on
 * @param {string} wallId
 * @param {{reveal?: ((wall: WallDocument) => *)|null}} [seams] `reveal` is `revealSecretDoor` once it exists
 * @returns {Promise<boolean>} whether a wall was revealed
 */
export async function revealExit(scene, wallId, { reveal = null } = {}) {
  const wall = scene?.walls?.get?.(wallId) ?? null;
  if (!wall || typeof reveal !== "function") return false;
  await reveal(wall);
  return true;
}
