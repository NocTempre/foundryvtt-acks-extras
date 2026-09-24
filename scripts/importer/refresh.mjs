/**
 * Repair in place: an imported document written over from a fresh read of its
 * entry, keeping everything that makes it the Judge's.
 *
 * A rebuild deletes and imports again, which takes the document's id, folder,
 * ownership, name and every edit with it. A repair writes into the document
 * instead: the `system` fields its binder builds, the stamped prose block unless
 * a Judge wrote in it, the module flags its binder owns, and its minted embedded
 * documents. Whatever the build does not write stays as it is.
 * `refreshPlan` decides all of that and is Foundry-free, so the harness can
 * assert it; `refreshImported` performs it. `REPAIR` says, per kind, which of a
 * build's fields the document keeps anyway.
 */
import { MODULE_ID } from "./constants.mjs";
import { stripBookText } from "./prose.mjs";
import { keepUnrenderedFields } from "../lib/sheet-rows.mjs";

/** The value at a dotted path, or undefined. */
const getPath = (node, path) =>
  String(path)
    .split(".")
    .reduce((n, key) => (n !== null && typeof n === "object" ? n[key] : undefined), node);

/** Remove the key at a dotted path; `*` stands for every element of an array. */
function dropPath(node, keys) {
  if (node === null || typeof node !== "object") return;
  const [head, ...rest] = keys;
  if (head === "*") {
    if (Array.isArray(node)) for (const el of node) dropPath(el, rest);
    return;
  }
  if (!rest.length) delete node[head];
  else dropPath(node[head], rest);
}

/**
 * Does this description hold something this module cannot prove it wrote?
 *
 * The test is never "is this worth keeping", it is "is this ours": a stamped
 * block of imported book text, or the legacy `@PdfText` tag that preceded it,
 * and nothing else. Structure-only markup (the empty paragraph an editor leaves
 * behind) is empty; an image, a heading or a word of text is someone's work and
 * is never overwritten without being offered first.
 *
 * Every rewrite writes descriptions in exactly the stamped shape, which is what
 * lets a second run pass over everything the first run settled without asking
 * again.
 */
export function handWrittenProse(html) {
  return !!stripBookText(html)
    .replace(/<\/?(?:p|br|div|span)\b[^>]*>/gi, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();
}

/**
 * The stat leaves a monster's binder writes only when its page yields them.
 * An update merges nested objects, so a leaf the re-read no longer produces
 * keeps its stale value unless it is reset here. Only binder-owned leaves are
 * listed. See docs/importer/DECISIONS.md, "A refill retracts only what its
 * entry claimed to fill".
 */
export const REFILL_STAT_PATHS = Object.freeze([
  "aac.value",
  "hp.hd",
  "hp.value",
  "hp.max",
  "saves.paralysis.value",
  "saves.death.value",
  "saves.blast.value",
  "saves.implements.value",
  "saves.spell.value",
  "details.morale",
  "details.xp",
  "details.alignment",
  "details.treasure.type",
  "details.appearing.d",
  "details.appearing.w",
  "movement.base",
  "thac0.throw",
  "attacks",
]);

/** Where the Full Monster Sheet keeps a monster's prose, one stamped block per field. */
const MONSTER_PROSE = ["appearance", "combat", "ecology", "encounterText", "lore", "notes"].map(
  (field) => `extras.description.${field}`,
);

/**
 * What a repair keeps of each kind's build, and what it replaces beyond
 * `system`. Paths are under `system` unless named otherwise.
 *
 * - `keep` — fields the binder writes that are the Judge's once imported: a
 *   trap's level in force, a vehicle's crew and its damage taken, a stack's
 *   quantity. An equipment item's `subtype`, `melee` and `missile` are kept
 *   too: the equipment annotation layer (`annotateItem`) settles them after
 *   creation, and a repair does not run it again. `*` stands for each element
 *   of an array.
 * - `prose` / `proseFlags` — stamped prose blocks (`system` paths / paths under
 *   the module's flags), each kept whole when a Judge wrote in it.
 * - `retract` — leaves reset to their initial value when the build no longer
 *   yields them.
 * - `flags` — keys under the module's flags the binder owns.
 * - `top` — document-level keys the binder owns besides `system`.
 * - `minted` — embedded collections whose minted documents are replaced.
 * - `name` — write the build's name and image; every other kind keeps the
 *   document's own.
 * - `rows: "replace"` — write array rows as built, without filling their
 *   unbuilt fields from the stored rows.
 */
export const REPAIR = Object.freeze({
  trap: { keep: ["level"], prose: ["description"] },
  variation: { prose: ["description"] },
  vehicle: { keep: ["crew", "shp.value", "speeds.tiers.*.team"], prose: ["description"] },
  equipment: {
    keep: ["quantity", "equipped", "subtype", "melee", "missile"],
    prose: ["description"],
    flags: ["light", "shieldVariant"],
  },
  animal: { prose: ["details.biography"], flags: ["extras"] },
  monster: {
    retract: REFILL_STAT_PATHS,
    proseFlags: MONSTER_PROSE,
    flags: ["extras", "moraleNA"],
    top: ["prototypeToken"],
    minted: ["items"],
  },
  // A class is rewritten whole, as Update Classes always has; only a
  // description a Judge wrote and an effect a Judge took over stay.
  class: { prose: ["description"], flags: ["tongues"], minted: ["effects"], name: true, rows: "replace" },
});

/** A build's embedded document, stamped as the module's so the next repair replaces it. */
const asMinted = (doc) => ({
  ...doc,
  flags: { ...(doc.flags ?? {}), [MODULE_ID]: { ...(doc.flags?.[MODULE_ID] ?? {}), minted: true } },
});

/**
 * What one repair writes, as data. Foundry-free; `refreshImported` performs it.
 *
 * @param {object} source the document's stored data (`toObject()`), embedded
 *   documents included; not changed
 * @param {object} built a fresh build of its entry — the binder's creation data
 * @param {object} [policy] one of `REPAIR`
 * @returns {{refused?: "type", update: object, retract: string[],
 *   replace: Object<string, {remove: string[], add: object[]}>, keptProse: string[]}}
 *   `update` is a document update; `retract` the `system` paths to reset to
 *   their initial value; `replace` the embedded documents to delete and create
 *   per collection; `keptProse` the prose paths left as a Judge wrote them.
 *   `refused` when the build is another document type, which no update can
 *   change.
 */
export function refreshPlan(source, built, policy = {}) {
  const { keep = [], prose = [], proseFlags = [], retract = [], flags = [], top = [], minted = [] } = policy;
  const keptProse = [];
  if (built?.type && source?.type && built.type !== source.type) {
    return { refused: "type", update: {}, retract: [], replace: {}, keptProse };
  }
  const stored = source?.system ?? {};
  const system = structuredClone(built?.system ?? {});
  for (const path of keep) dropPath(system, path.split("."));
  for (const path of prose) {
    if (getPath(system, path) === undefined || !handWrittenProse(getPath(stored, path))) continue;
    dropPath(system, path.split("."));
    keptProse.push(path);
  }
  // An array row is written whole, so a row field the build leaves out would
  // reset to its schema initial: the stored row at the same index fills it.
  if (policy.rows !== "replace") keepUnrenderedFields(system, stored);

  const update = {};
  if (Object.keys(system).length) update.system = system;
  if (policy.name) {
    if (built?.name) update.name = built.name;
    if (built?.img) update.img = built.img;
  }
  for (const key of top) if (built?.[key] !== undefined) update[key] = structuredClone(built[key]);

  // The provenance stamp is refreshed around its identity: which entry the
  // document answers for (`id`, `merged`), under which printed name
  // (`printed`), and from which book (`book`) stay the library's record.
  const mine = built?.flags?.[MODULE_ID] ?? {};
  const stamp = { ...(mine.cookbook ?? {}) };
  for (const key of ["id", "merged", "printed", "book"]) delete stamp[key];
  const flagUpdate = {};
  if (Object.keys(stamp).length) flagUpdate.cookbook = stamp;
  for (const key of flags) if (mine[key] !== undefined) flagUpdate[key] = structuredClone(mine[key]);
  for (const path of proseFlags) {
    if (getPath(flagUpdate, path) === undefined) continue;
    if (!handWrittenProse(getPath(source?.flags?.[MODULE_ID], path))) continue;
    dropPath(flagUpdate, path.split("."));
    keptProse.push(`flags.${path}`);
  }
  if (Object.keys(flagUpdate).length) update.flags = { [MODULE_ID]: flagUpdate };

  const kept = new Set(keep);
  const retracted = retract.filter(
    (path) => !kept.has(path) && getPath(built?.system, path) === undefined && getPath(stored, path) !== undefined,
  );

  const replace = {};
  for (const collection of minted) {
    const have = source?.[collection] ?? [];
    const isMinted = (doc) => !!doc?.flags?.[MODULE_ID]?.minted;
    // A document without `minted` stays, and stands in for the build's
    // document it matches: an effect by the changes it carries (one a Judge
    // took over no longer carries `minted`, and a second effect carrying the
    // same changes would apply them twice), an embedded item by its type and
    // name (a second attack of one name is a twin).
    const kept = have.filter((d) => !isMinted(d));
    const keys = new Set(kept.flatMap((d) => (d.changes ?? []).map((c) => c.key)));
    const named = new Set(kept.filter((d) => d.type && d.name).map((d) => `${d.type}|${d.name}`));
    const standsIn = (d) =>
      (d.changes ?? []).some((c) => keys.has(c.key)) || (collection === "items" && named.has(`${d.type}|${d.name}`));
    replace[collection] = {
      remove: have.filter(isMinted).map((d) => d._id),
      add: (built?.[collection] ?? []).filter((d) => !standsIn(d)).map(asMinted),
    };
  }
  return { update, retract: retracted, replace, keptProse };
}

/** The Foundry document class name for an embedded collection. */
const EMBEDDED = { items: "Item", effects: "ActiveEffect" };

/**
 * Write a repair onto a document: the plan's update, each retracted leaf at its
 * schema's initial value, then the minted embedded documents replaced.
 *
 * @param {foundry.abstract.Document} doc an imported document, in a pack or in the world
 * @param {object} built a fresh build of its entry
 * @param {object} [policy] one of `REPAIR`
 * @returns {Promise<object>} the plan it wrote (`refreshPlan`'s shape); nothing
 *   is written when it is `refused`. A write Foundry rejects (a locked pack, an
 *   invalid value) is logged and answers `refused: "error"`, so one document
 *   never ends the run it is part of.
 */
export async function refreshImported(doc, built, policy = {}) {
  const plan = refreshPlan(doc.toObject(), built, policy);
  if (plan.refused) return plan;
  for (const path of plan.retract) {
    const field = doc.system?.schema?.getField?.(path);
    if (field) foundry.utils.setProperty(plan.update, `system.${path}`, field.getInitialValue());
  }
  try {
    if (Object.keys(plan.update).length) await doc.update(plan.update);
    for (const [collection, { remove, add }] of Object.entries(plan.replace)) {
      const type = EMBEDDED[collection];
      if (!type) continue;
      if (remove.length) await doc.deleteEmbeddedDocuments(type, remove);
      if (add.length) await doc.createEmbeddedDocuments(type, add);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | repair of ${doc.name} failed`, err);
    return { ...plan, refused: "error" };
  }
  return plan;
}

/**
 * A tally of what a repair run did, for its report: `replaced` documents
 * written over, `keptProse` of those that kept a description a Judge wrote,
 * `refused` documents left untouched (their book is not open, or the page no
 * longer matched, or the build became another document type). `seen` holds
 * the documents already met (`unrepaired`).
 */
export const repairTally = () => ({ replaced: 0, keptProse: 0, refused: 0, seen: new Set() });

/** A tally's counts alone, for a report or a result. */
export const repairCounts = (tally) => ({ replaced: tally.replaced, keptProse: tally.keptProse, refused: tally.refused });

/**
 * Is this the first time the tally meets `doc`? A document another entry was
 * merged into answers to both ids, and is written once. False without a tally.
 */
export function unrepaired(tally, doc) {
  const key = doc?.uuid ?? doc?.id;
  if (!tally || !key || tally.seen.has(key)) return false;
  tally.seen.add(key);
  return true;
}

/** Count one `refreshImported` result, or a refusal given as a string, into a tally. */
export function countRepair(tally, result) {
  if (!tally) return;
  if (!result || typeof result === "string" || result.refused) tally.refused++;
  else {
    tally.replaced++;
    if (result.keptProse?.length) tally.keptProse++;
  }
}
