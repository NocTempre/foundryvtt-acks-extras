/**
 * Overhead token art from an installed third-party Actor compendium: the plan,
 * as data. Foundry-free; `token-art.mjs` reads the world and performs it.
 *
 * A source package's monster rows are indexed by their folded name and kept
 * only where the token art lives under that package's own path (a core icon or
 * another package's placeholder is no art). A subject, an imported monster, is
 * matched by exact folded name; a name that more than one row's art answers is
 * counted as ambiguous and a name no row answers as unmatched, and neither is
 * guessed. A subject is written only where its token still shows what the
 * import left (its portrait) or what this feature last wrote; a token a Judge
 * set is theirs and is counted and left. The token's size and scale stay the
 * module's: only the image and the wildcard mark are written, and the fit is
 * set to contain so the third-party art sits inside the kept scale.
 */
import { slug } from "../lib/vocab.mjs";

/** The fit the art is written with: the whole image inside the token's kept scale. */
export const ART_FIT = "contain";

/** A name as the match reads it: diacritics stripped, then the family's folded slug. */
export const foldName = (name) => slug(String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""));

/** Whether a token path is a wildcard (a set of images Foundry picks from). */
export const isWildcardPath = (path) => String(path ?? "").includes("*");

/** Whether `path` lies under `modules/<packageId>/`, the package's own art. */
export const isPackageArt = (path, packageId) => !!packageId && String(path ?? "").startsWith(`modules/${packageId}/`);

/**
 * Index a source package's Actor rows.
 *
 * @param {Array<{name: string, type: string, tokenSrc: string, randomImg?: boolean, uuid?: string}>} rows
 *   one per actor in the package's Actor packs
 * @param {string} packageId the package the art must lie under
 * @returns {{art: Map<string, Array<{src: string, randomImg: boolean, uuid: string|null}>>, noArt: Set<string>, count: number}}
 *   `art` maps a folded name to the distinct token art its monster rows carry;
 *   `noArt` holds the folded names of monster rows whose token is not the
 *   package's own art; `count` is the number of names with art.
 */
export function indexSource(rows, packageId) {
  const art = new Map();
  const noArt = new Set();
  for (const row of rows ?? []) {
    if (row?.type !== "monster") continue;
    const key = foldName(row.name);
    if (!key) continue;
    if (!isPackageArt(row.tokenSrc, packageId)) {
      noArt.add(key);
      continue;
    }
    const list = art.get(key) ?? [];
    if (!list.some((c) => c.src === row.tokenSrc)) {
      list.push({ src: row.tokenSrc, randomImg: !!row.randomImg || isWildcardPath(row.tokenSrc), uuid: row.uuid ?? null });
    }
    art.set(key, list);
  }
  return { art, noArt, count: art.size };
}

/** A subject's token as it stands: `{src, randomImg, fit}` read off its stored prototype. */
const tokenOf = (subject) => ({ src: subject.tokenSrc ?? "", randomImg: !!subject.randomImg, fit: subject.fit ?? "" });

/** Whether the subject's token shows what the import left or what this feature last wrote. */
const writable = (subject) => {
  const src = subject.tokenSrc ?? "";
  return !src || src === (subject.img ?? "") || src === subject.flag?.src;
};

/**
 * What applying a source does to each subject.
 *
 * @param {Array<{uuid: string, name: string, img: string, tokenSrc: string, randomImg?: boolean, fit?: string, flag?: {src?: string, was?: object}|null}>} subjects
 * @param {ReturnType<typeof indexSource>} index
 * @param {{from?: string|null}} [opts] the source's label, recorded in the flag
 * @returns {{changes: Array<{uuid: string, name: string, src: string, randomImg: boolean, from: string|null, was: object}>,
 *   counts: {change: number, current: number, kept: number, noArt: number, ambiguous: number, noMatch: number}}}
 */
export function planApply(subjects, index, { from = null } = {}) {
  const counts = { change: 0, current: 0, kept: 0, noArt: 0, ambiguous: 0, noMatch: 0 };
  const changes = [];
  for (const subject of subjects ?? []) {
    const key = foldName(subject.name);
    const found = index.art.get(key) ?? [];
    if (!found.length) {
      counts[index.noArt.has(key) ? "noArt" : "noMatch"]++;
      continue;
    }
    if (found.length > 1) {
      counts.ambiguous++;
      continue;
    }
    if (!writable(subject)) {
      counts.kept++;
      continue;
    }
    const [pick] = found;
    if (subject.tokenSrc === pick.src && !!subject.randomImg === pick.randomImg && subject.flag?.src === pick.src) {
      counts.current++;
      continue;
    }
    // A subject already carrying our write keeps the first token it had: the original is what Restore returns.
    const was = subject.flag?.src && subject.tokenSrc === subject.flag.src && subject.flag.was ? subject.flag.was : tokenOf(subject);
    changes.push({ uuid: subject.uuid, name: subject.name, src: pick.src, randomImg: pick.randomImg, from: pick.uuid ?? from, was });
    counts.change++;
  }
  return { changes, counts };
}

/**
 * What restoring does: each subject carrying this feature's flag whose token
 * still shows the flag's art gets its recorded token back; one whose token a
 * Judge has changed since is counted and left.
 *
 * @param {Array<{uuid: string, name: string, tokenSrc: string, flag?: {src?: string, was?: object}|null}>} subjects
 * @returns {{restores: Array<{uuid: string, name: string, was: object}>, counts: {restore: number, kept: number}}}
 */
export function planRestore(subjects) {
  const restores = [];
  let kept = 0;
  for (const subject of subjects ?? []) {
    if (!subject.flag?.src) continue;
    if (subject.tokenSrc !== subject.flag.src) {
      kept++;
      continue;
    }
    restores.push({ uuid: subject.uuid, name: subject.name, was: subject.flag.was ?? { src: "", randomImg: false, fit: "" } });
  }
  return { restores, counts: { restore: restores.length, kept } };
}

/**
 * The placed tokens a change moves: an unlinked token whose image is the old
 * prototype path becomes the new one. A linked token follows its actor and
 * needs no write.
 *
 * @param {Array<{uuid: string, actorLink?: boolean, src: string, randomImg?: boolean}>} tokens
 * @param {string} from the prototype path being replaced
 * @param {string} to the path replacing it
 * @returns {Array<{uuid: string, src: string}>}
 */
export function planPlaced(tokens, from, to) {
  if (!from || !to || from === to) return [];
  return (tokens ?? []).filter((t) => !t.actorLink && t.src === from).map((t) => ({ uuid: t.uuid, src: to }));
}
