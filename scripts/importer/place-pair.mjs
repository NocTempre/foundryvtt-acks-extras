/**
 * A place two books print, kept as one actor — the Foundry-free half.
 *
 * The earlier book's row names the later book's (`meta.sameAs`) and lists the
 * paragraphs only it prints (`meta.unique`, 1-based in printed order). Whichever
 * book lands second meets the place the other made: the later book takes it
 * over (`takeoverPatch`), the earlier one binds onto it (`bindPatch`). Both
 * orders end in the same place: the later book's id, book and read name, its
 * text block followed by the earlier book's unique paragraphs, and the earlier
 * id among those the place answers for. The rulings are docs/importer/DECISIONS.md,
 * "Later books supersede, by the year their printing carries" and "The
 * earlier printing's unique paragraphs follow the later one's".
 */
import { MODULE_ID } from "./constants.mjs";
import { isPlaceRole } from "../location/constants.mjs";
import { bookTextBlock, insertBookTextAfter, keepParagraphs, swapBookText } from "./prose.mjs";

/** Every id a stamped document answers for: its own, then those merged into it. */
export const claimIds = (flag) => [flag?.id, ...(flag?.merged ?? [])].filter(Boolean);

/** Whether a stamped document answers for `id`, as its own or a merged one. */
export const answersFor = (flag, id) => !!id && claimIds(flag).includes(id);

/**
 * The place pairs the cookbooks declare, reachable from either row's id. A
 * pair is declared on the earlier book's row, so the later row's cookbook need
 * not be loaded for its own side to be found.
 * @param {Iterable<[string, {entries?: object}]>} books each book's compiled cookbook, by book id
 * @returns {Map<string, {earlier: string, later: string, unique: number[]}>}
 */
export function placePairs(books) {
  const out = new Map();
  for (const [, cb] of books) {
    for (const [id, e] of Object.entries(cb?.entries ?? {})) {
      const later = e?.meta?.sameAs;
      if (!later) continue;
      const pair = Object.freeze({ earlier: id, later, unique: Object.freeze([...(e.meta.unique ?? [])]) });
      out.set(id, pair);
      out.set(later, pair);
    }
  }
  return out;
}

/**
 * What the later book writes onto the place the earlier book made. Its id,
 * book and read name become the place's; the earlier id joins `merged`, so a
 * lookup by it still finds the place. The name is written only while it is
 * still the one the earlier build printed: a Judge's rename stands. The
 * earlier block in the notes gives way to the later block followed by the
 * earlier block's unique paragraphs, and every byte outside it stays. The
 * parent and region follow the later build only while they still hold what the
 * earlier build wrote; a role is written only where none is set. Ownership,
 * folder, image, roster and every play field stay.
 *
 * @param {object} source the held place's stored data (`toObject()`)
 * @param {{id: string, book: string, name: string, notes: string, parentUuid?: string, region?: string, role?: string}} later
 *   the later row's build
 * @param {{id: string, parentUuid?: string, region?: string, unique?: number[]}} earlier
 *   the earlier row, what its build wrote for parent and region, and its unique paragraphs
 * @returns {object} an update payload
 */
export function takeoverPatch(source, later, earlier) {
  const flag = source?.flags?.[MODULE_ID]?.cookbook ?? {};
  const sys = source?.system ?? {};
  const merged = [...new Set([...claimIds(flag), earlier.id])].filter((id) => id !== later.id);
  const patch = {
    [`flags.${MODULE_ID}.cookbook.id`]: later.id,
    [`flags.${MODULE_ID}.cookbook.book`]: later.book,
    [`flags.${MODULE_ID}.cookbook.merged`]: merged,
  };
  if (later.name) {
    patch[`flags.${MODULE_ID}.cookbook.printed`] = later.name;
    if (flag.printed !== undefined && source.name === flag.printed) patch.name = later.name;
  }
  const kept = keepParagraphs(bookTextBlock(sys.notes, earlier.id), earlier.unique ?? []);
  patch["system.notes"] = swapBookText(sys.notes, earlier.id, `${later.notes ?? ""}${kept}`);
  const stillEarlier = (stored, built) => !stored || stored === (built ?? "");
  if (later.parentUuid && stillEarlier(sys.parentUuid, earlier.parentUuid) && later.parentUuid !== source?.uuid) {
    patch["system.parentUuid"] = later.parentUuid;
  }
  if (later.region && stillEarlier(sys.region, earlier.region)) patch["system.region"] = later.region;
  if (isPlaceRole(later.role) && !sys.role) patch["system.role"] = later.role;
  return patch;
}

/**
 * What the earlier book writes onto the place the later book made: its id
 * joins `merged`, and its unique paragraphs follow the later block. Nothing
 * else of the place is written over; a parent, role or roster is filled only
 * where the place holds none. A second run finds its block and adds nothing.
 *
 * @param {object} target the held place's stored data (`toObject()`)
 * @param {{id: string, notes: string, parentUuid?: string, role?: string, roster?: object[]}} earlier
 *   the earlier row, its block already kept to its unique paragraphs (`keepParagraphs`)
 * @returns {object} an update payload, empty when nothing is owed
 */
export function bindPatch(target, earlier) {
  const flag = target?.flags?.[MODULE_ID]?.cookbook ?? {};
  const sys = target?.system ?? {};
  const patch = {};
  if (!answersFor(flag, earlier.id)) patch[`flags.${MODULE_ID}.cookbook.merged`] = [...(flag.merged ?? []), earlier.id];
  if (earlier.notes && !bookTextBlock(sys.notes, earlier.id)) {
    patch["system.notes"] = insertBookTextAfter(sys.notes, flag.id, earlier.notes);
  }
  if (earlier.parentUuid && !sys.parentUuid && earlier.parentUuid !== target?.uuid) patch["system.parentUuid"] = earlier.parentUuid;
  if (isPlaceRole(earlier.role) && !sys.role) patch["system.role"] = earlier.role;
  if (earlier.roster?.length && !sys.roster?.length) patch["system.roster"] = earlier.roster;
  return patch;
}
