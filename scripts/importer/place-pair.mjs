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
import { blockDigest, blockSums, bookTextBlock, insertBookTextAfter, keepParagraphs, sumKey, swapBookText } from "./prose.mjs";
import { heldErratumNotes, marketEntryId } from "./market-profile-binding.mjs";
import { decides, heldEdit } from "./held-edits.mjs";
import { handWrittenProse } from "./refresh.mjs";

/** A stamped block's opening tag: notes that carry one hold some row's text. */
const BLOCK_MARK = /data-acks-entry=/i;

/** Every id a stamped document answers for: its own, then those merged into it. */
export const claimIds = (flag) => [flag?.id, ...(flag?.merged ?? [])].filter(Boolean);

/** Whether a stamped document answers for `id`, as its own or a merged one. */
export const answersFor = (flag, id) => !!id && claimIds(flag).includes(id);

/**
 * The place pairs the cookbooks declare, reachable from either row's id. A
 * pair is declared on the earlier book's row, so the later row's cookbook need
 * not be loaded for its own side to be found. A market grid declares its
 * columns' pairs in `meta.markets`; the earlier side is the market id the
 * column is claimed under (`marketEntryId`), and it prints no paragraphs.
 * @param {Iterable<[string, {entries?: object}]>} books each book's compiled cookbook, by book id
 * @returns {Map<string, {earlier: string, later: string, unique: number[]}>}
 */
export function placePairs(books) {
  const out = new Map();
  const add = (earlier, later, unique = []) => {
    const pair = Object.freeze({ earlier, later, unique: Object.freeze([...unique]) });
    out.set(earlier, pair);
    out.set(later, pair);
  };
  for (const [bookId, cb] of books) {
    for (const [id, e] of Object.entries(cb?.entries ?? {})) {
      if (e?.meta?.sameAs) add(id, e.meta.sameAs, e.meta.unique ?? []);
      for (const [market, col] of Object.entries(e?.meta?.markets ?? {})) {
        if (col?.sameAs) add(marketEntryId(bookId, market), col.sameAs);
      }
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
  // The two blocks it wrote are stamped as written, so the earlier id's old sum
  // does not read the kept block as an edit.
  for (const [key, sum] of Object.entries(blockSums(`${later.notes ?? ""}${kept}`, "system.notes"))) patch[`flags.${MODULE_ID}.cookbook.sums.${key}`] = sum;
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
    for (const [key, sum] of Object.entries(blockSums(earlier.notes, "system.notes"))) patch[`flags.${MODULE_ID}.cookbook.sums.${key}`] = sum;
  }
  if (earlier.parentUuid && !sys.parentUuid && earlier.parentUuid !== target?.uuid) patch["system.parentUuid"] = earlier.parentUuid;
  if (isPlaceRole(earlier.role) && !sys.role) patch["system.role"] = earlier.role;
  if (earlier.roster?.length && !sys.roster?.length) patch["system.roster"] = earlier.roster;
  return patch;
}

/**
 * One row's text written over in place on a place it shares: a place two
 * books print, a market or settlement a site is bound onto, a quarter or
 * region its overview describes. Entry `row.id`'s stamped block is replaced by
 * the fresh `row.notes`, every other byte of the notes kept (the other book's
 * block, an erratum note, a Judge's text); a row with no block yet has it set
 * after `row.after`'s block, else the place's own, else leading. Where the
 * row is the place's own (`flags.cookbook.id`), its read name becomes
 * `printed`, and the place's name follows only while it is still the printed
 * one. The id, `merged`, parent, role, roster and every play field are never
 * written.
 *
 * Each block written records its digest (`blockDigest`) in the stamp's
 * `sums`, the read stamp a later write compares the stored block with. A
 * block that no longer digests to its stamp, and a name that is no longer the
 * printed one, are a Judge's edits: each is reported in `edits` and written
 * only where `decision` takes it (`decides`; none keeps). A block that digests
 * as the page's reads as unedited whatever markup the editor gave it, and so
 * does a block with no digest recorded: it is written and stamped.
 * A missing block is an edit where a stamp is recorded (the Judge took it out), or where the notes hold
 * anything but erratum notes: the Judge's own text, or another row's block,
 * beside which the import writes nothing. Notes empty but for erratum notes
 * take it.
 *
 * @param {object} target the held place's stored data (`toObject()`), with its `uuid`
 * @param {{id: string, notes?: string, name?: string, after?: string, cite?: string}} row the row's
 *   fresh build, an earlier pair row's block already kept to its unique paragraphs (`keepParagraphs`)
 * @param {{decision?: Parameters<typeof decides>[0]}} [opts]
 * @returns {{update: object, edits: ReturnType<typeof heldEdit>[]}} `update` is empty when the
 *   place already holds the build or every difference is a kept edit
 */
export function rowBlockPatch(target, row, { decision = null } = {}) {
  const flag = target?.flags?.[MODULE_ID]?.cookbook ?? {};
  const stored = String(target?.system?.notes ?? "");
  const uuid = String(target?.uuid ?? "");
  const update = {};
  const edits = [];
  const held = (path, current, page) => {
    const edit = heldEdit({ uuid, name: target?.name ?? "", path, current, page, cite: row.cite ?? "" });
    if (decides(decision, edit.key) === "take") return false;
    edits.push(edit);
    return true;
  };
  if (row.notes) {
    const block = bookTextBlock(stored, row.id);
    const key = sumKey("system.notes", row.id);
    const sum = flag.sums?.[key];
    const page = blockDigest(row.notes);
    // Without a block, what the notes hold besides their erratum notes decides:
    // the Judge's text, or another row's block, which the import never writes beside.
    const beside = block ? "" : heldErratumNotes(stored, claimIds(flag)).rest;
    const here = block ? blockDigest(block) : "";
    // A block with no digest recorded reads as unedited.
    const unedited = !sum || here === sum || here === page;
    const edited = block ? !unedited : !!sum || handWrittenProse(beside) || BLOCK_MARK.test(beside);
    if (!(edited && held(`system.notes#${row.id}`, block ?? "", row.notes))) {
      const notes = block ? swapBookText(stored, row.id, row.notes) : insertBookTextAfter(stored, row.after ?? flag.id, row.notes);
      if (notes !== stored) update["system.notes"] = notes;
      if (sum !== page) update[`flags.${MODULE_ID}.cookbook.sums.${key}`] = page;
    }
  }
  if (row.name && row.id === flag.id && flag.printed !== row.name) {
    // A held rename leaves `printed` as it was, so the next run still meets
    // the read name as new and can write it once a decision takes it.
    const renamed = flag.printed !== undefined && target?.name !== flag.printed;
    if (!renamed || !held("name", target?.name ?? "", row.name)) {
      update[`flags.${MODULE_ID}.cookbook.printed`] = row.name;
      if (flag.printed !== undefined) update.name = row.name;
    }
  }
  return { update, edits };
}

/**
 * What a region site writes of a market place's name, where the place is the
 * market's own (`id` is its claim): its read heading, and only while the place
 * still holds the neutral label `placeholder` the market step falls back to,
 * unrenamed. A name the market step read from its page (a record's heading, a
 * column's header) is never overwritten, and neither is a Judge's: whichever
 * of the two steps runs first, the market step's read name is the one that
 * stands, and the site's heading stands where the market step read none.
 * `printed` follows, so the market step's own write (`rowBlockPatch`) still
 * finds the name as the import's.
 *
 * @param {object} target the held place's stored data (`toObject()`)
 * @param {{id: string, name: string, placeholder: string}} site `id` the market claim the site is bound onto,
 *   `name` the site's read heading, `placeholder` the market step's neutral label
 * @returns {object} an update payload, empty when nothing is owed
 */
export function siteNamePatch(target, { id, name, placeholder }) {
  const flag = target?.flags?.[MODULE_ID]?.cookbook ?? {};
  if (!name || !placeholder || name === placeholder || flag.id !== id) return {};
  if (flag.printed !== placeholder || target?.name !== placeholder) return {};
  return { name, [`flags.${MODULE_ID}.cookbook.printed`]: name };
}
