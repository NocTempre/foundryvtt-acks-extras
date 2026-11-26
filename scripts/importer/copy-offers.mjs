/**
 * What a repair offers a copy dragged out of the library into the sidebar:
 * the fields of the library document the repair changed, on a copy that still
 * holds them as the library did. Pure, so it runs without Foundry.
 *
 * A copy's field is offered when its value equals the library document's value
 * from before the repair wrote it (the snapshot) and the repair changed that
 * value. A field the Judge changed on the copy, or one the repair left as it
 * was, is never offered. Only a copy's name, picture and `system` leaves are
 * read; its embedded documents and effects are not.
 */
import { sameValue } from "./held-edits.mjs";

/**
 * A document's name, picture and `system` leaves by dotted path. A leaf is any
 * value that is not a non-empty plain object (an array is one leaf); a key with
 * a dot in it names no path an update could write, so it is left out.
 * @param {{name?: string, img?: string, system?: object}} data a document's stored data (`toObject()`)
 * @returns {Map<string, unknown>}
 */
export function leafMap(data) {
  const out = new Map();
  for (const key of ["name", "img"]) if (typeof data?.[key] === "string") out.set(key, data[key]);
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      if (key.includes(".")) continue;
      const path = `${prefix}.${key}`;
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) walk(value, path);
      else out.set(path, value);
    }
  };
  walk(data?.system, "system");
  return out;
}

/**
 * The paths a copy is offered: its value equals the library document's `before`,
 * and `after` holds another. A leaf the library document no longer holds is not
 * offered, since an update cannot unset it.
 * @param {object} copy the copy's stored data
 * @param {object} before the library document's data before the repair wrote it
 * @param {object} after the library document's data now
 * @returns {string[]}
 */
export function sharedFields(copy, before, after) {
  const have = leafMap(copy);
  const was = leafMap(before);
  const now = leafMap(after);
  const paths = new Set([...was.keys(), ...now.keys()]);
  return [...paths].filter((path) => now.has(path) && !sameValue(was.get(path), now.get(path)) && sameValue(have.get(path), was.get(path)));
}

/**
 * The update that brings a copy up to the library document on `paths`.
 * @param {string[]} paths as `sharedFields` returns them
 * @param {object} after the library document's data now
 * @returns {Object<string, unknown>}
 */
export function copyUpdate(paths, after) {
  const now = leafMap(after);
  return Object.fromEntries(paths.map((path) => [path, structuredClone(now.get(path))]));
}
