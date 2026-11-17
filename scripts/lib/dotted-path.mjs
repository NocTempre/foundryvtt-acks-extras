/**
 * Write a value at a dotted path on a plain object. Every segment but the last
 * must be a plain object: a missing, null, primitive or array intermediate is
 * REPLACED by a fresh object, so a write never throws on what a path crosses.
 * Pass the path as a dotted string or as its segments. Foundry-free.
 */
export function setPath(obj, path, value) {
  const keys = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] === null || typeof cur[key] !== "object" || Array.isArray(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[keys.at(-1)] = value;
  return obj;
}
