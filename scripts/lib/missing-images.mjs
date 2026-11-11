/**
 * The pure half of the missing-image repair check, with no Foundry globals:
 * which image fields a document kind carries, which of their paths are worth
 * asking the server about, the bounded probe over the distinct paths, and the
 * update that puts a default image where a file is gone. `repair-checks.mjs`
 * wires it to `game`, `CONFIG` and `fetch`.
 */

/**
 * The image fields of each document kind the check walks, as paths into the
 * document's source. An actor's prototype token art and a scene token's own
 * texture are tokens' fields; most of the rest are `img`. A scene's own field
 * is its thumbnail, its images are its levels' (`Level`), a journal image page
 * keeps its file in `src`, and a roll table's result has its own `img`.
 */
export const IMAGE_FIELDS = Object.freeze({
  Actor: Object.freeze(["img", "prototypeToken.texture.src"]),
  Item: Object.freeze(["img"]),
  ActiveEffect: Object.freeze(["img"]),
  Macro: Object.freeze(["img"]),
  RollTable: Object.freeze(["img"]),
  Token: Object.freeze(["texture.src"]),
  Scene: Object.freeze(["thumb"]),
  Level: Object.freeze(["background.src", "foreground.src", "fog.src"]),
  JournalEntryPage: Object.freeze(["src"]),
  TableResult: Object.freeze(["img"]),
});

/**
 * The kinds whose missing image is replaced: each has a default image of its
 * own class. The others are found and listed, never written.
 */
const REPAIRABLE = new Set(["Actor", "Item", "ActiveEffect", "Macro", "RollTable", "Token"]);

/** A path that names a file on another host or carries its own bytes. */
const NOT_LOCAL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * The path as the server is asked for it, or null when it is not worth asking:
 * empty, a `data:`/`blob:`/`http(s):` reference (a remote host cannot be probed
 * without its CORS grant, and an inline image cannot be missing), a `#` virtual
 * path (a name a texture field resolves itself), or a wildcard (a randomized
 * token image names a set of files, not one).
 */
export function checkablePath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || path.startsWith("#") || NOT_LOCAL.test(path) || path.includes("*")) return null;
  return path;
}

/** The value at a dotted path in a plain object, or undefined. */
function read(source, field) {
  let at = source;
  for (const part of field.split(".")) {
    if (at == null || typeof at !== "object") return undefined;
    at = at[part];
  }
  return at;
}

/**
 * Every checkable image a document's source holds, as `{field, path}`.
 * @param {string} kind a key of `IMAGE_FIELDS`
 * @param {object} source the document's source data
 */
export function imagesOf(kind, source) {
  const out = [];
  for (const field of IMAGE_FIELDS[kind] ?? []) {
    const path = checkablePath(read(source, field));
    if (path) out.push({ field, path });
  }
  return out;
}

/**
 * The distinct checkable paths over a list of entries `{kind, source}`, in
 * first-seen order, so each file is asked about once however many documents
 * name it.
 */
export function distinctPaths(entries) {
  const seen = new Set();
  for (const { kind, source } of entries) {
    for (const { path } of imagesOf(kind, source)) seen.add(path);
  }
  return [...seen];
}

/**
 * Probe each path, at most `concurrency` at a time, and return the set the
 * probe reports gone. `probe(path)` resolves true (found), false (gone) or
 * null (unknown); a probe that throws is unknown. Only false puts a path in
 * the set, so a network failure never reports a file as missing.
 * @returns {Promise<Set<string>>}
 */
export async function missingPaths(paths, probe, { concurrency = 8 } = {}) {
  const missing = new Set();
  const queue = [...paths];
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      let found = null;
      try {
        found = await probe(path);
      } catch {
        found = null;
      }
      if (found === false) missing.add(path);
    }
  };
  const width = Math.max(1, Math.min(Math.floor(concurrency) || 1, queue.length));
  await Promise.all(Array.from({ length: width }, worker));
  return missing;
}

/**
 * What to do about one entry `{kind, source, ownerImg?}` given the paths that
 * are gone: null when none of its images is, else `{paths, update}`. `update`
 * is the change set that replaces each missing image, or null when the kind has
 * no default image (a scene's images, a journal page's file and a roll-table
 * result's image are listed and never written). A missing `img` takes the kind's default. Token art takes
 * its actor's image once that is itself usable (present, or one the check
 * cannot probe), and the default otherwise. For an actor's prototype token the
 * image the actor will have after the same update counts; for a scene token
 * `ownerImg` is its base actor's image.
 * @param {(kind: string) => string|null} defaultImage the kind's default image
 */
export function planRepair(entry, missing, defaultImage) {
  const gone = imagesOf(entry.kind, entry.source).filter((i) => missing.has(i.path));
  if (!gone.length) return null;
  const paths = gone.map((i) => i.path);
  const fallback = REPAIRABLE.has(entry.kind) ? nonEmpty(defaultImage(entry.kind)) : null;
  if (!fallback) return { paths, update: null };
  const update = {};
  const imgGone = gone.some((i) => i.field === "img");
  for (const { field } of gone) {
    if (field === "img") {
      update.img = fallback;
      continue;
    }
    const owner = entry.kind === "Actor" ? (imgGone ? fallback : entry.source?.img) : entry.ownerImg;
    const usable = typeof owner === "string" && owner.trim() && !missing.has(owner.trim());
    update[field] = usable ? owner : fallback;
  }
  return { paths, update };
}

/** A non-empty string, trimmed, else null. */
function nonEmpty(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}
