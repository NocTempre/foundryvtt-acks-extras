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
 * build's fields the document keeps anyway. A forced repair (`repairTally({force:
 * true})`, `policyFor`) lifts the hand-written prose guard and nothing else.
 */
import { MODULE_ID } from "./constants.mjs";
import { blockSums, editedInBlocks, stripBookText } from "./prose.mjs";
import { keepUnrenderedFields } from "../lib/sheet-rows.mjs";
import { coversFigure, decides, heldEdit } from "./held-edits.mjs";

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

/** Write `value` at a dotted path, creating the objects along it. */
function setPath(node, keys, value) {
  const [head, ...rest] = keys;
  if (!rest.length) {
    node[head] = value;
    return;
  }
  if (node[head] === null || typeof node[head] !== "object") node[head] = {};
  setPath(node[head], rest, value);
}

/**
 * Does this description hold something this module cannot prove it wrote?
 *
 * The test is never "is this worth keeping", it is "is this ours": a stamped
 * block of imported book text, or its `@PdfText` tag form, and nothing else. Structure-only markup (the empty paragraph an editor leaves
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
  "ac.value",
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
  "attack.throw",
  "attacks",
  "damage.mod.melee",
  "damage.mod.missile",
]);

/** Where the Full Monster Sheet keeps a monster's prose, one stamped block per field. */
const MONSTER_PROSE = ["appearance", "combat", "ecology", "encounterText", "lore", "notes"].map(
  (field) => `extras.description.${field}`,
);

/** The `system` fields that hold a stamped block of imported text, by their path under `system`. */
const STAMPED_SYSTEM = ["description", "details.biography", "notes"];

/** The digests of the stamped blocks in the fields of `node` at `paths`, keyed as `blockSums` keys them under `prefix`. */
function fieldSums(node, paths, prefix) {
  const out = {};
  for (const path of paths) {
    const text = getPath(node, path);
    if (typeof text === "string") Object.assign(out, blockSums(text, `${prefix}.${path}`));
  }
  return out;
}

/**
 * Creation data with the digests of the stamped blocks it holds recorded in
 * its cookbook stamp (`cookbook.sums`), so the first repair or re-import can
 * tell an edit inside a block from the block as written. The fields are
 * `system.description`, `system.details.biography`, `system.notes`, a
 * monster's prose flags and a roll table's `description`. Data with no
 * cookbook stamp is returned as it came.
 * @param {object} data a document's creation data
 * @returns {object} `data`, or a copy carrying the sums
 */
export function withBlockSums(data) {
  const mine = data?.flags?.[MODULE_ID];
  if (!mine?.cookbook) return data;
  const sums = {
    ...fieldSums(data.system, STAMPED_SYSTEM, "system"),
    ...fieldSums(mine, MONSTER_PROSE, "flags"),
    ...(typeof data.description === "string" ? blockSums(data.description, "description") : {}),
  };
  if (!Object.keys(sums).length) return data;
  return { ...data, flags: { ...data.flags, [MODULE_ID]: { ...mine, cookbook: { ...mine.cookbook, sums: { ...mine.cookbook.sums, ...sums } } } } };
}

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
 * - `keepFlags` — paths under the module's flags that keep their stored value
 *   when the build leaves them empty (an empty array or an absent key): what
 *   a Judge authored where the page gave the binder nothing.
 */
export const REPAIR = Object.freeze({
  trap: { keep: ["level"], prose: ["description"] },
  variation: { prose: ["description"] },
  // The table's own figures are rewritten; the demand layers, aliases, loot
  // kinds and categories are not built by a table row and so are left alone.
  merchandise: { prose: ["description"] },
  vehicle: { keep: ["crew", "shp.value", "speeds.tiers.*.team"], prose: ["description"] },
  equipment: {
    keep: ["quantity", "equipped", "subtype", "melee", "missile"],
    prose: ["description"],
    // `gear` carries only what the page states of the item (how much it
    // holds); the rest of the stored declaration is merged, not replaced.
    flags: ["light", "shieldVariant", "gear"],
  },
  animal: { prose: ["details.biography"], flags: ["extras"] },
  // An item a book introduces: the place it is worn and its magic mark are
  // the binder's flags, its cost is the page's; how many a Judge holds is play's.
  adventureItem: { keep: ["quantity"], prose: ["description"], flags: ["gear", "markets"] },
  monster: {
    retract: REFILL_STAT_PATHS,
    proseFlags: MONSTER_PROSE,
    flags: ["extras", "moraleNA"],
    top: ["prototypeToken"],
    minted: ["items"],
  },
  // A class is rewritten whole, as Update Classes always has; only a
  // description a Judge wrote, an effect a Judge took over, and a level's
  // experience or title the build could not read and a Judge typed stay.
  class: {
    prose: ["description"],
    flags: ["tongues", "xpBuild"],
    minted: ["effects"],
    name: true,
    rows: "replace",
    fillUnread: [{ path: "levels", key: "level", fields: ["xp", "title"] }],
  },
  // A spell's cast counter, memorized mark and favourite star are play's;
  // the primitive is rewritten from the page, except effect rows a Judge
  // authored on a spell whose build carries none.
  spell: {
    keep: ["cast", "memorized", "favorite"],
    prose: ["description"],
    flags: ["spell"],
    keepFlags: ["spell.effects"],
  },
  // The rows a printed table builds: its figures, its page reference and the
  // structured modes the module reads are rewritten; what is worn, carried or
  // spent is play's.
  weapon: { keep: ["equipped"], prose: ["description"], flags: ["weapon"] },
  armor: { keep: ["equipped"], prose: ["description"], flags: ["armor"] },
  // The equipment annotation layer settles an ammunition stack's subtype.
  ammunition: { keep: ["quantity", "subtype"], prose: ["description"], flags: ["ammunition"] },
  priced: { keep: ["quantity"], flags: ["gear"] },
  // A language's place in the taxonomy; its description is the library's or the
  // Judge's, since the import writes none.
  language: { flags: ["language"] },
});

/**
 * The policy for an actor kind that is written whole from its build (a
 * template, a family, a person, a legacy block), derived from
 * what the build carries: the flags it stamps, its token, its embedded items,
 * and the biography it writes. Everything the build leaves out stays as the
 * document holds it.
 *
 * @param {object} built the kind's creation data
 * @returns {object} a policy `refreshPlan` takes
 */
export function actorPolicy(built) {
  const mine = built?.flags?.[MODULE_ID] ?? {};
  const flags = Object.keys(mine).filter((key) => key !== "cookbook" && key !== "minted");
  return {
    rows: "replace",
    prose: getPath(built?.system, "details.biography") !== undefined ? ["details.biography"] : [],
    proseFlags: flags.includes("extras") ? MONSTER_PROSE : [],
    flags,
    top: built?.prototypeToken ? ["prototypeToken"] : [],
    minted: Array.isArray(built?.items) && built.items.length ? ["items"] : [],
  };
}

/** A build's embedded document, stamped as the module's so the next repair replaces it. */
export const asMinted = (doc) => ({
  ...doc,
  flags: { ...(doc.flags ?? {}), [MODULE_ID]: { ...(doc.flags?.[MODULE_ID] ?? {}), minted: true } },
});

/**
 * The stored embedded documents with no `minted` stamp that are the build's
 * own: each has a build document of the same type and name whose `system` it
 * still holds (`coversFigure`). Stamped, a repair replaces them like any other
 * minted document; a document a Judge edited, or made under a name the build
 * does not use, differs or has no twin and is never returned.
 * @param {object[]} have the stored documents (`toObject()` of the embedded collection)
 * @param {object[]} built the build's documents for the same collection
 * @returns {string[]} the `_id`s to stamp
 */
export function unstampedTwins(have = [], built = []) {
  return have
    .filter((d) => !d?.flags?.[MODULE_ID]?.minted && built.some((b) => b.type === d.type && b.name === d.name && coversFigure(d.system, b.system)))
    .map((d) => d._id);
}

/**
 * What one repair writes, as data. Foundry-free; `refreshImported` performs it.
 *
 * @param {object} source the document's stored data (`toObject()`), embedded
 *   documents included; not changed
 * @param {object} built a fresh build of its entry — the binder's creation data
 * @param {object} [policy] one of `REPAIR`; with `force` set (`policyFor`) a
 *   description or prose field a Judge wrote is rewritten like any other, and
 *   `keptProse` stays empty. Everything else the policy keeps is unchanged:
 *   fields the build does not produce, the play state in `keep`, and the
 *   embedded documents a Judge made.
 * @returns {{refused?: "type", update: object, retract: string[],
 *   replace: Object<string, {remove: string[], add: object[]}>, keptProse: string[]}}
 *   `update` is a document update; `retract` the `system` paths to reset to
 *   their initial value; `replace` the embedded documents to delete and create
 *   per collection; `keptProse` the prose paths left as a Judge wrote them.
 *   `refused` when the build is another document type, which no update can
 *   change.
 */
export function refreshPlan(source, built, policy = {}) {
  const { keep = [], prose = [], proseFlags = [], retract = [], flags = [], top = [], minted = [], keepFlags = [] } = policy;
  const keptProse = [];
  if (built?.type && source?.type && built.type !== source.type) {
    return { refused: "type", update: {}, retract: [], replace: {}, keptProse };
  }
  const stored = source?.system ?? {};
  const system = structuredClone(built?.system ?? {});
  for (const path of keep) dropPath(system, path.split("."));
  const sums = source?.flags?.[MODULE_ID]?.cookbook?.sums;
  // Prose a Judge wrote beside the block, or inside it since the import wrote it.
  const judged = (have, page, path) => handWrittenProse(have) || (have !== page && editedInBlocks(sums, path, have));
  for (const path of policy.force ? [] : prose) {
    const page = getPath(system, path);
    if (page === undefined || !judged(getPath(stored, path), page, `system.${path}`)) continue;
    dropPath(system, path.split("."));
    keptProse.push(path);
  }
  // An array row is written whole, so a row field the build leaves out would
  // reset to its schema initial: the stored row at the same index fills it.
  if (policy.rows !== "replace") keepUnrenderedFields(system, stored);
  // A row field the build could not read (null or "") keeps the stored row's
  // value, matched by the row's key: a figure a Judge typed from the page
  // survives the repair, and one the build does read replaces it.
  for (const { path, key, fields } of policy.fillUnread ?? []) {
    const rows = getPath(system, path);
    const have = getPath(stored, path);
    if (!Array.isArray(rows) || !Array.isArray(have)) continue;
    const byKey = new Map(have.map((r) => [r?.[key], r]));
    const unread = (v) => v === null || v === undefined || v === "";
    for (const row of rows) {
      const old = byKey.get(row?.[key]);
      if (!old) continue;
      for (const field of fields) if (unread(row[field]) && !unread(old[field])) row[field] = old[field];
    }
  }

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
  for (const path of policy.force ? [] : proseFlags) {
    const page = getPath(flagUpdate, path);
    if (page === undefined || !judged(getPath(source?.flags?.[MODULE_ID], path), page, `flags.${path}`)) continue;
    dropPath(flagUpdate, path.split("."));
    keptProse.push(`flags.${path}`);
  }
  for (const path of keepFlags) {
    const built = getPath(flagUpdate, path);
    const empty = built === undefined || built === null || (Array.isArray(built) && built.length === 0);
    if (!empty) continue;
    const stored = getPath(source?.flags?.[MODULE_ID], path);
    if (stored === undefined) continue;
    setPath(flagUpdate, path.split("."), structuredClone(stored));
  }
  // What the write carries is what the stamp records: a field kept above was
  // dropped from the payload and keeps the sum of what the import last wrote.
  const sumsWritten = { ...fieldSums(system, STAMPED_SYSTEM, "system"), ...fieldSums(flagUpdate, MONSTER_PROSE, "flags") };
  if (Object.keys(sumsWritten).length) flagUpdate.cookbook = { ...(flagUpdate.cookbook ?? {}), sums: sumsWritten };
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
 *
 * `force` makes the run a forced repair: every policy it writes under skips
 * the hand-written prose guard (`policyFor`), and `handMade` counts the
 * documents the import did not make that it left alone by name.
 *
 * A run that repairs the printed-table rows also carries `tables`, a Set of the
 * table importers (`weapons`, `armor`, `priced`) the equipment import runs in
 * repair mode; the run adds it, the tally starts without it.
 *
 * @param {{force?: boolean}} [options]
 */
export const repairTally = ({ force = false } = {}) => ({ replaced: 0, keptProse: 0, refused: 0, handMade: 0, force, seen: new Set() });

/**
 * The tally of the merged repair: no force, and a `decision` every writer
 * asks of a Judge's edit (`decides`; "keep" writes none over), the edits it
 * kept listed in `edits`, and `recreated` counting documents made again
 * under their id as another type.
 */
export const mergedTally = (decision = "keep") => ({ ...repairTally(), decision, edits: [], recreated: 0 });

/** A tally's counts alone, for a report or a result; a forced run adds `handMade`, a merged one `held` and `recreated`. */
export const repairCounts = (tally) => ({
  replaced: tally.replaced,
  keptProse: tally.keptProse,
  refused: tally.refused,
  ...(tally.force ? { handMade: tally.handMade } : {}),
  ...("decision" in tally ? { held: tally.edits?.length ?? 0, recreated: tally.recreated ?? 0 } : {}),
});

/** The policy a run writes under: `policy`, forced when the tally is. */
export const policyFor = (policy, tally) => (tally?.force ? { ...policy, force: true } : policy);

/**
 * The policy a write runs under once a caller's decision has met the Judge's
 * edits: every prose field the unforced plan would keep as hand-written is an
 * edit (`heldEdit`), and stays guarded unless `decision` takes it (`decides`;
 * none keeps). The prose guard is the edit a whole-build write can detect: the
 * other figures it writes carry no read stamp to compare with.
 *
 * @param {object} source the document's stored data (`toObject()`)
 * @param {object} built a fresh build of its entry
 * @param {object} policy the kind's policy (`REPAIR`, `actorPolicy`)
 * @param {{decision?: Parameters<typeof decides>[0], uuid?: string, cite?: string}} [opts]
 * @returns {{policy: object, edits: ReturnType<typeof heldEdit>[]}} `policy` unforced, its guard
 *   narrowed to the kept edits; `edits` the edits left standing
 */
export function decidedPolicy(source, built, policy, { decision = null, uuid = "", cite = "" } = {}) {
  const unforced = { ...policy, force: false };
  const taken = new Set();
  const edits = [];
  for (const path of refreshPlan(source, built, unforced).keptProse) {
    const flag = path.startsWith("flags.");
    const rest = flag ? path.slice("flags.".length) : path;
    const [stored, page] = flag
      ? [source?.flags?.[MODULE_ID], built?.flags?.[MODULE_ID]]
      : [source?.system, built?.system];
    const edit = heldEdit({
      uuid, name: source?.name ?? "", path: flag ? `flags.${MODULE_ID}.${rest}` : `system.${rest}`,
      current: getPath(stored, rest), page: getPath(page, rest), cite,
    });
    if (decides(decision, edit.key) === "take") taken.add(path);
    else edits.push(edit);
  }
  return {
    policy: {
      ...unforced,
      prose: (policy.prose ?? []).filter((p) => !taken.has(p)),
      proseFlags: (policy.proseFlags ?? []).filter((p) => !taken.has(`flags.${p}`)),
    },
    edits,
  };
}

/**
 * Write a fresh build over a held document under a repair's tally. A tally
 * that carries a `decision` writes through `decidedPolicy` and lists the
 * edits it keeps in `tally.edits`; one without writes under `policyFor`. A
 * build of another document type is handed to `tally.recreate` where the
 * tally carries one (the document made again under its id), and is a refusal
 * otherwise.
 *
 * @param {object} doc the held document
 * @param {object} built a fresh build of its entry
 * @param {object} policy the kind's policy (`REPAIR`, `actorPolicy`)
 * @param {object|null} tally a `repairTally`, or null for an unforced write
 * @returns {Promise<object>} the written plan, as `refreshImported` returns it
 */
export async function repairWrite(doc, built, policy, tally) {
  let plan;
  if (!tally || !("decision" in tally)) plan = await refreshImported(doc, built, policyFor(policy, tally));
  else {
    const decided = decidedPolicy(doc.toObject(), built, policy, {
      decision: tally.decision,
      uuid: doc.uuid ?? "",
      cite: built?.flags?.[MODULE_ID]?.cookbook?.cite ?? doc.flags?.[MODULE_ID]?.cookbook?.cite ?? "",
    });
    if (decided.edits.length) (tally.edits ??= []).push(...decided.edits);
    plan = await refreshImported(doc, built, decided.policy);
  }
  if (plan?.refused === "type" && typeof tally?.recreate === "function") return tally.recreate(doc, built);
  return plan;
}

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
