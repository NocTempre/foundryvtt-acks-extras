/* global game, foundry, fromUuid, fromUuidSync, Item, RollTable, Folder, console */
/**
 * Template packages: a class's printed starting templates materialized as
 * repairable documents on the class's own shelf (docs/classes/MODEL.md,
 * "Template packages").
 *
 * Each template row on a class may bind a core `bundle` Item holding uuid links
 * to real documents: the abilities it grants (shared links, or specialized
 * copies), its gear as already-skinned items (the printed descriptor over the
 * base's mechanics), and its spells. A 3d6 RollTable per class links the
 * bundles as a generated view; nothing in code reads it.
 *
 * A package lands beside its class: a class held on one of the library's
 * shelves writes its parts to that line's Item and RollTable shelves, filed
 * `Class Templates / <Class>`; a class in the sidebar keeps its parts in the
 * sidebar, out of Remove Imports' reach. See docs/classes/DECISIONS.md,
 * "a package lands beside its class".
 *
 * Ownership: the class row keeps the printed band, name, annotation, caste,
 * coin and encumbrance note; the bundle owns what the package contains; each
 * linked item owns what one piece of gear is. A materialized entry is removed
 * from the row's arrays; printed cells that resolved to nothing stay on the row.
 *
 * Identity lives on the bundle (`flags["acks-extras"].templatePart`), not on
 * the row: an importer Update pass replaces the whole `system` object, so the
 * row's `bundle` uuid is a cache re-derived from that flag. Documents this
 * file creates carry an `asImported` snapshot; a pass that would replace one
 * compares the live document against it first, and an edited document is
 * skipped and reported.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_TEMPLATE_PART } from "./constants.mjs";
import { findByRef, templatePartOf as partOf } from "./registry.mjs";
import { refOf } from "./grants.mjs";
import { ITEM_TYPE, selectionVocabFor, nameWithSelections, nameVariants } from "../lib/vocab.mjs";
import { libraryItems, libraryDocs, cookbookId, isLibraryPack, lineOfPack } from "../lib/library.mjs";
import { ensureLibraryPack, ensureFolderIn } from "../lib/library-target.mjs";
import { equipmentClass, isUnidentifiedWeapon } from "../equipment/profiles.mjs";
import { isOffer } from "./pending-choices.mjs";

const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Flag key (under `flags["acks-extras"]`) naming what a document is a part of; defined in `constants.mjs`. */
export const TEMPLATE_PART = FLAG_TEMPLATE_PART;

const loc = (key, data) => game.i18n?.format?.(`${LANG_PREFIX}.${key}`, data) ?? null;

/* ------------------------------------------------------------------ */
/*  Pure resolution helpers (Foundry-free, tested offline)             */
/* ------------------------------------------------------------------ */

/**
 * Is the candidate name a whole WORD of the printed descriptor?
 *
 * A trailing plural belongs to the word, and seams inside a multi-word name
 * are `\s*`, because real extraction welds words together. See
 * docs/classes/DECISIONS.md, "a short base name is a whole word, and a plural
 * is part of it".
 */
function wholeWordIn(candidateName, descriptor) {
  const body = String(candidateName).trim().split(/\s+/).map(escapeRe).join("\\s*");
  return !!body && new RegExp(`(^|[^a-z0-9])${body}(?:e?s)?([^a-z0-9]|$)`, "i").test(descriptor);
}

/**
 * The best base candidate a printed descriptor names, from a candidate list
 * (`{name}` objects). An exact folded match wins at any length; containment
 * requires a folded length of 6, or 4–5 as a whole word of the raw descriptor
 * — never a bare substring, which would find nothing for "mace" and too much
 * for "grimace". Every variant of the candidate's name is
 * tried (`nameVariants`), including its paren-stripped form.
 *
 * The importer applies the same rules when it resolves a printed descriptor
 * against the equipment menu (`parseEquipment` in `importer/cookbook/classes.mjs`);
 * the two must agree.
 */
export function bestBaseMatch(name, candidates) {
  const f = fold(name);
  if (!f) return null;
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const raw = String(candidate?.name ?? "");
    for (const variant of nameVariants(raw)) {
      const nf = fold(variant);
      if (!nf) continue;
      let score = 0;
      if (nf === f) score = nf.length + 1000;
      else if (f.includes(nf)) {
        if (nf.length >= 6) score = nf.length;
        else if (nf.length >= 4 && wholeWordIn(variant, name)) score = nf.length;
      }
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * The embellishment a printed descriptor adds over its base's name: the
 * descriptor with the base name (or its paren-stripped form) excised.
 * Empty when the base's folded name is under 4 characters or never appears.
 */
export function parseEmbellishment(entryName, baseName) {
  const words = String(entryName).split(/\s+/);
  const baseFolds = [fold(baseName), fold(String(baseName).replace(/\([^)]*\)/g, " "))].filter((x) => x.length >= 4);
  for (let start = 0; start < words.length; start++) {
    for (let end = words.length; end > start; end--) {
      const seg = fold(words.slice(start, end).join(""));
      if (baseFolds.some((b) => seg === b)) {
        return [...words.slice(0, start), ...words.slice(end)].join(" ").replace(/^[\s,-]+|[\s,-]+$/g, "");
      }
    }
  }
  return "";
}

/**
 * Drop what an Intellect shortfall removes from an ORDERED content list
 * (`{type, name}` rows): the bonus proficiency is the ability listed LAST,
 * the bonus spell is the spell listed SECOND — the first spell is the one
 * every character of the class begins with.
 * @returns {{kept: object[], dropped: string[]}}
 */
export function applyShortfall(rows, short = { profs: 0, spells: 0 }) {
  const kept = [...rows];
  const dropped = [];
  for (let n = 0; n < (short.profs || 0); n++) {
    const idx = kept.map((r) => r.type).lastIndexOf(ITEM_TYPE.ability);
    if (idx < 0) break;
    dropped.push(kept[idx].name);
    kept.splice(idx, 1);
  }
  for (let n = 0; n < (short.spells || 0); n++) {
    const spellAt = kept.map((r, i) => (r.type === ITEM_TYPE.spell ? i : -1)).filter((i) => i >= 0);
    if (spellAt.length < 2) break;
    dropped.push(kept[spellAt[1]].name);
    kept.splice(spellAt[1], 1);
  }
  return { kept, dropped };
}

/**
 * What one template equipment entry is called.
 *
 * The count lives on the quantity field, never as a numeral in the name (RR
 * p. 46). The page that lists a package and the grant that materializes it
 * both read this rule.
 */
export function templateItemName(entry) {
  const printed = (entry.qty > 1 ? String(entry.name ?? "").replace(/^\d+\s+/, "") : String(entry.name ?? "")).replace(
    /^\w/,
    (c) => c.toUpperCase(),
  );
  return entry.skinName || printed;
}

/* ------------------------------------------------------------------ */
/*  Resolution — the world first, then the compendia                   */
/* ------------------------------------------------------------------ */

/** The three item types a piece of starting gear can be. */
const GEAR_TYPES = [ITEM_TYPE.weapon, ITEM_TYPE.armor, ITEM_TYPE.item];

/** Index fields every pack lookup needs: the type, the importer's stamp, and
 *  this module's own part stamp, so a row says whether it is a part or an import. */
const INDEX_FIELDS = ["type", `flags.${MODULE_ID}.cookbook.id`, `flags.${MODULE_ID}.${TEMPLATE_PART}`];

/** One pack's index, or null when it cannot be read (never fatal). */
async function packIndex(pack) {
  return pack.getIndex({ fields: INDEX_FIELDS }).catch((err) => {
    console.warn(`${MODULE_ID} | template packages: index of ${pack.metadata.id} unreadable`, err);
    return null;
  });
}

/**
 * The imports held in packs, and nothing else: a world-level Item pack whose
 * index carries the importer's stamp. Module- and system-level packs are never
 * read. See docs/classes/DECISIONS.md, "a package resolves through the
 * IMPORTS, and mints what it cannot find".
 */
async function importPacks() {
  const out = [];
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item" || pack.metadata?.packageType !== "world") continue;
    const index = await packIndex(pack);
    if (!index) continue;
    const rows = [...index];
    if (!rows.some((r) => cookbookId(r))) continue;
    out.push({ pack, rows });
  }
  return out;
}

/**
 * Find a definition among the imports: by the importer's cookbook stamp
 * first, then by exact folded name among the wanted types. `findByRef` reads
 * only `game.items`, so a world importing into packs resolves through this.
 */
async function findInPacks({ ref = "", name = "", types = [] }) {
  const wanted = fold(name);
  for (const { pack, rows } of await importPacks()) {
    let row = ref ? rows.find((r) => cookbookId(r) === ref) : null;
    if (!row && wanted) {
      row = rows.find((r) => (!types.length || types.includes(r.type)) && fold(r.name) === wanted);
    }
    if (!row) continue;
    const doc = await pack.getDocument(row._id).catch(() => null);
    if (doc) return doc;
  }
  return null;
}

/**
 * The document a template entry names, and whether a package may LINK it.
 *
 * `linkable: true` means the caller may point at it — a document the sidebar
 * or one of the library's own shelves holds. A document in any other
 * compendium is copied onto the class's shelf instead.
 *
 * Read off the document (`doc.pack`), never assumed from which search found it.
 *
 * @param {object} [options]
 * @returns {Promise<{doc: object|null, linkable: boolean}>}
 */
export async function findSource({ ref = "", name = "", types = [] } = {}) {
  const found = (doc) => ({ doc, linkable: !doc.pack || isLibraryPack(doc.pack) });
  if (ref) {
    const byRef = findByRef(ref);
    if (byRef) return found(byRef);
  }
  const wanted = fold(name);
  if (wanted) {
    const byName = libraryItems().find((i) => (!types.length || types.includes(i.type)) && fold(i.name) === wanted);
    if (byName) return found(byName);
  }
  // The pack INDEX, for a library this session has not instantiated: the
  // searches above see only loaded documents.
  const indexed = await findInPacks({ ref, name, types });
  return indexed ? found(indexed) : { doc: null, linkable: false };
}

/**
 * Resolve a template item entry to its BASE world item (null = no base).
 *
 * A base is something the world imported or a Judge made, never a document
 * this feature minted.
 */
export function resolveBase(entry) {
  const eligible = (i) => GEAR_TYPES.includes(i.type) && !partOf(i);
  if (entry.ref) {
    if (entry.ref.startsWith("name:")) {
      const name = entry.ref.slice(5);
      return libraryItems().find((i) => eligible(i) && i.name.toLowerCase() === name.toLowerCase()) ?? null;
    }
    const doc = findByRef(entry.ref);
    if (doc) return doc;
  }
  return bestBaseMatch(entry.name, libraryItems().filter(eligible));
}

/**
 * The base a piece of gear is an instance of — the world's own imported gear
 * first, else the imports held in a pack (fuzzy-matched over its index the
 * same way). The system's shipped equipment is never a base; see `importPacks`.
 */
export async function resolveBaseDoc(entry) {
  const world = resolveBase(entry);
  if (world) return world;
  for (const { pack, rows } of await importPacks()) {
    // The same exclusion `resolveBase` applies: a part is never a base.
    const imports = rows.filter((r) => !partOf(r));
    let row = entry.ref ? imports.find((r) => cookbookId(r) === entry.ref) : null;
    if (!row) row = bestBaseMatch(entry.name, imports.filter((r) => GEAR_TYPES.includes(r.type)));
    if (!row) continue;
    const doc = await pack.getDocument(row._id).catch(() => null);
    if (doc) return doc;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Payload builders                                                   */
/* ------------------------------------------------------------------ */

/**
 * Build the item payload for one template equipment entry, skinned with the
 * printed descriptor. Resolution ladder: the entry's ref / a base item from
 * the world or the compendia (a copy inheriting its type and mechanics),
 * else the equipment root's strict name classification (a typed item built
 * from its stats), else a bare named `item`.
 * @returns {Promise<{data: object, resolution: "base"|"root"|"bare"}>}
 */
export async function buildGearData(entry) {
  const skinName = templateItemName(entry);
  const base = await resolveBaseDoc(entry);
  if (base) {
    const data = base.toObject();
    delete data._id;
    delete data.folder;
    delete data.sort;
    delete data.ownership;
    // `toObject` carries the importer stamp, which would make the skin answer
    // ref lookups meant for the base. Only the importer's keys under
    // `flags[MODULE_ID]` (`cookbook`, `minted`) are stripped.
    if (data.flags?.[MODULE_ID]) {
      delete data.flags[MODULE_ID].cookbook;
      delete data.flags[MODULE_ID].minted;
    }
    data.name = skinName;
    foundry.utils.setProperty(data, "system.quantity.value", entry.qty || 1);
    // A price the template cell prints outranks the base's own. See
    // docs/classes/DECISIONS.md, "a template item carries the price its page printed for it".
    if (entry.cost > 0) foundry.utils.setProperty(data, "system.cost", entry.cost);
    const embellishment = parseEmbellishment(entry.name, base.name);
    data.flags = {
      ...(data.flags ?? {}),
      [MODULE_ID]: {
        ...(data.flags?.[MODULE_ID] ?? {}),
        skin: {
          base: entry.ref || `uuid:${base.uuid}`,
          baseName: base.name,
          descriptor: entry.name,
          ...(embellishment ? { embellishment } : {}),
        },
      },
    };
    return { data, resolution: "base" };
  }
  const klass = equipmentClass(entry.name) ?? equipmentClass(skinName);
  const skinFlags = { [MODULE_ID]: { skin: { base: null, descriptor: entry.name } } };
  // The cell's price is kept even when no base answers for the item.
  const priced = entry.cost > 0 ? { cost: entry.cost } : {};
  if (klass) {
    const system =
      klass.type === ITEM_TYPE.weapon
        ? {
            damage: klass.damage || "1d6",
            melee: klass.melee ?? true,
            missile: klass.missile ?? false,
            bonus: 0,
            ...priced,
          }
        : { quantity: { value: entry.qty || 1, max: 0 }, ...priced };
    return { data: { name: skinName, type: klass.type, system, flags: skinFlags }, resolution: "root" };
  }
  return {
    data: {
      name: skinName,
      type: ITEM_TYPE.item,
      system: { quantity: { value: entry.qty || 1, max: 0 }, ...priced },
      flags: skinFlags,
    },
    resolution: "bare",
  };
}

/** A copy of a source document, stripped of what belongs to the original. */
function copyOf(source) {
  const data = source.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  return data;
}

/**
 * Build the specialized ability copy a template entry with a printed
 * selection needs (RR p. 25): the source's
 * data with the selection written where every consumer reads it and stamped
 * `grantedFrom`, so `ownsRef` recognises the copy against the base ref.
 * Null when the entry has no selection, or when neither the passed source nor
 * the entry's ref resolves.
 */
export function buildProfData(entry, sourceDoc = null) {
  if (!entry.selection) return null;
  const source = sourceDoc ?? (entry.ref ? findByRef(entry.ref) : null);
  if (!source) return null;
  const data = copyOf(source);
  const mine = data.flags?.[MODULE_ID] ?? {};
  data.flags = {
    ...(data.flags ?? {}),
    [MODULE_ID]: {
      ...mine,
      grantedFrom: entry.ref || refOf(source),
      extras: { ...(mine.extras ?? {}), selections: [entry.selection] },
    },
  };
  const vocab = selectionVocabFor(source, mine.extras?.category);
  data.name = vocab ? nameWithSelections(data.name, [entry.selection], vocab) : `${data.name} (${entry.selection})`;
  return data;
}

/* ------------------------------------------------------------------ */
/*  Reading a package                                                  */
/* ------------------------------------------------------------------ */

/**
 * A template's contents as the row-entry shapes the panels label.
 *
 * The bundle's cached itemList (no document resolution, so the preview stays
 * synchronous) plus whatever printed entries the row still holds; the two are
 * disjoint. A bundle that is empty or gone leaves the row answering alone.
 */
export function templateContents(template) {
  const bundle = template?.bundle ? fromUuidSync(template.bundle) : null;
  const list = bundle?.system?.itemList ?? null;
  if (!list?.length) {
    return {
      source: "row",
      abilities: template?.abilities ?? [],
      items: template?.items ?? [],
      spells: template?.spells ?? [],
    };
  }
  const abilities = [];
  const items = [];
  const spells = [];
  for (const row of list) {
    if (row.type === ITEM_TYPE.ability) abilities.push({ name: row.name, rank: row.quantity || 1 });
    else if (row.type === ITEM_TYPE.spell) spells.push({ name: row.name });
    else items.push({ name: row.name, skinName: row.name, qty: row.quantity || 1 });
  }
  abilities.push(...(template?.abilities ?? []));
  items.push(...(template?.items ?? []));
  spells.push(...(template?.spells ?? []));
  return { source: "bundle", abilities, items, spells };
}

/**
 * The keys a pick list is matched against to keep a package's own abilities
 * off it: `refs` from row entries, and `names` (lowercased), the only key a
 * bundled row and a row entry always share.
 */
export function templateGrantKeys(template) {
  const names = new Set();
  const refs = new Set();
  for (const entry of (template ? templateContents(template).abilities : null) ?? []) {
    if (entry?.ref) refs.add(entry.ref);
    const name = String(entry?.name ?? "").trim().toLowerCase();
    if (name) names.add(name);
  }
  return { names, refs };
}

/**
 * Resolve a template's bundle rows to documents, in the bundle's own order.
 * A row whose document no longer exists lands on `missing`, never silently
 * dropped — the missing name is what the chat card reports.
 * @returns {Promise<{bundle: object|null, rows: {doc, quantity, type, name}[], missing: string[]}>}
 */
export async function expandTemplate(template) {
  const bundle = template?.bundle ? await fromUuid(template.bundle).catch(() => null) : null;
  const rows = [];
  const missing = [];
  for (const row of bundle?.system?.itemList ?? []) {
    const doc = await fromUuid(row.uuid).catch(() => null);
    if (doc) rows.push({ doc, quantity: row.quantity || 1, type: row.type, name: row.name });
    else missing.push(row.name);
  }
  return { bundle, rows, missing };
}

/* ------------------------------------------------------------------ */
/*  Materializing                                                      */
/* ------------------------------------------------------------------ */

/** One itemList row linking a document, wherever it sits. */
const listRow = (doc, quantity = 1) => ({
  id: doc.id,
  uuid: doc.uuid,
  quantity,
  name: doc.name,
  img: doc.img,
  type: doc.type,
  inCompendium: !!doc.pack,
});

/**
 * Remove from a template row every printed entry its bundle already
 * represents — matched the way the materializer placed them: an ability by
 * its ref (the linked document's own ref, or the `grantedFrom` a specialized
 * copy carries) or by name, gear by the skinned name or the
 * descriptor on its skin flag, a spell by uuid or folded name.
 *
 * Removal is per-entry and evidence-based: an entry the bundle does not carry
 * stays on the row. Returns whether anything was stripped. Mutates `row`.
 */
export function stripRepresented(row, bundle) {
  const list = (bundle?.system?.itemList ?? []).map((r) => ({ row: r, doc: fromUuidSync(r.uuid) }));
  const before = (row.abilities?.length ?? 0) + (row.items?.length ?? 0) + (row.spells?.length ?? 0);
  const grantedFrom = (doc) => doc?.flags?.[MODULE_ID]?.grantedFrom ?? "";
  row.abilities = (row.abilities ?? []).filter((entry) => {
    const named = fold(entry.name);
    return !list.some(({ row: r, doc }) => {
      if (r.type !== ITEM_TYPE.ability) return false;
      if (entry.ref && doc && (refOf(doc) === entry.ref || grantedFrom(doc) === entry.ref)) return true;
      // A name-only cell is represented by the part minted FROM that name.
      return !!named && (fold(r.name) === named || fold(grantedFrom(doc)) === named);
    });
  });
  row.items = (row.items ?? []).filter((entry) => {
    const key = fold(templateItemName(entry));
    return !list.some(
      ({ row: r, doc }) =>
        r.type !== ITEM_TYPE.ability &&
        r.type !== ITEM_TYPE.spell &&
        (fold(r.name) === key || (entry.name && fold(doc?.flags?.[MODULE_ID]?.skin?.descriptor ?? "") === fold(entry.name))),
    );
  });
  row.spells = (row.spells ?? []).filter((entry) => {
    const f = fold(entry.name);
    return !list.some(
      ({ row: r }) =>
        r.type === ITEM_TYPE.spell &&
        ((entry.uuid && r.uuid === entry.uuid) || (f && fold(r.name) === f) || (f.length >= 6 && fold(r.name).includes(f))),
    );
  });
  return (row.abilities.length + row.items.length + row.spells.length) !== before;
}

/**
 * Detach every package from a class: the rows' `bundle` links and the
 * table's are cleared, so the class applies from its own printed entries
 * again. The documents stay on their shelf unless `deleteDocuments`.
 *
 * `deleteDocuments` removes only documents carrying this module's own
 * `templatePart` stamp (the bundles, skins and copies it minted); an import a
 * package links or was skinned from is never touched.
 */
export async function detachTemplatePackages(classItem, { deleteDocuments = false } = {}) {
  const removed = [];
  if (!classItem?.system?.templates?.length) return removed;
  const templates = foundry.utils.deepClone(classItem.system.toObject().templates ?? []);
  for (const row of templates) row.bundle = "";
  await classItem.update({ "system.templates": templates, "system.templateTable": "" });
  if (!deleteDocuments) return removed;
  const classKey = classItem.system.key || fold(classItem.name);
  const mine = (doc) => {
    const part = partOf(doc);
    return part && (part.classUuid === classItem.uuid || part.classKey === classKey);
  };
  // The whole library: the parts sit in the sidebar or on a pack shelf.
  for (const doc of libraryItems().filter(mine)) {
    removed.push(doc.name);
    await doc.delete();
  }
  for (const table of libraryDocs("RollTable").filter(mine)) {
    removed.push(table.name);
    await table.delete();
  }
  return removed;
}

/**
 * Has a document this module created been edited by hand since? Compared
 * against its `asImported` snapshot — the payload fields set at creation.
 * A document with no snapshot is treated as edited: it is someone's work.
 */
export function editedSinceImport(doc) {
  const snapshot = doc?.flags?.[MODULE_ID]?.asImported;
  if (!snapshot) return true;
  const live = foundry.utils.filterObject(doc.toObject(), snapshot);
  return !(foundry.utils.equals ?? foundry.utils.objectsEqual)(live, snapshot);
}

/** The comparable creation snapshot for a payload: name, type and the system
 *  fields it set — the surface a Judge's repair would touch. */
const snapshotOf = (data) => ({
  name: data.name,
  type: data.type,
  system: foundry.utils.deepClone(data.system ?? {}),
});

/**
 * The shelves a class's package is written to: the caller's, else the library
 * shelves of the line the class itself sits on, else none — a Judge's own
 * sidebar class keeps its parts in the sidebar. A shelf the line lacks yet
 * (a RollTable pack for a line that has only imported Items) is opened here.
 * @returns {Promise<{items: string|null, tables: string|null}>} pack
 *   collection ids, null for the sidebar
 */
async function shelvesFor(classItem, { pack = null, tablePack = null } = {}) {
  const shelved = isLibraryPack(classItem?.pack);
  const line = shelved ? lineOfPack(classItem.pack) : null;
  const open = async (type) => (shelved ? ((await ensureLibraryPack(type, line))?.collection ?? null) : null);
  return { items: pack ?? (await open("Item")), tables: tablePack ?? (await open("RollTable")) };
}

/** The root every package folder hangs from, in the reader's language. */
const templatesRootName = () => game.i18n?.localize?.(`${LANG_PREFIX}.templates.folder`) ?? "Class Templates";

/**
 * Where packages land when no caller supplies a folder (the sheet's own
 * build): `Class Templates / <Class>` on the shelf the parts are written to,
 * inside the pack when there is one, else in the sidebar. The importer passes
 * its own cookbook folder and never reaches this.
 */
async function defaultFolder(classItem, packId = null) {
  const rootName = templatesRootName();
  const pack = packId ? game.packs?.get(packId) : null;
  if (pack) return (await ensureFolderIn(pack, "Item", [rootName, classItem.name]).catch(() => null))?.id ?? null;
  const isItemFolder = (f, name, parent) => f.type === "Item" && f.name === name && (f.folder?.id ?? null) === parent;
  const root =
    game.folders?.find((f) => isItemFolder(f, rootName, null)) ??
    (await Folder.implementation.create({ name: rootName, type: "Item" }).catch(() => null));
  const parent = root?.id ?? null;
  const existing = game.folders?.find((f) => isItemFolder(f, classItem.name, parent));
  if (existing) return existing.id;
  const made = await Folder.implementation
    .create({ name: classItem.name, type: "Item", folder: parent })
    .catch(() => null);
  return made?.id ?? null;
}

/** The table's folder when no caller supplies one: the `Class Templates` root
 *  of the table shelf; a table written to the sidebar stays unfiled. */
async function defaultTableFolder(packId = null) {
  const pack = packId ? game.packs?.get(packId) : null;
  if (!pack) return null;
  return (await ensureFolderIn(pack, "RollTable", [templatesRootName()]).catch(() => null))?.id ?? null;
}

/** Stamp identity, snapshot and the caller's opaque flags onto a payload. */
function stampPart(data, part, stamp) {
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, {
    [MODULE_ID]: { [TEMPLATE_PART]: part, asImported: snapshotOf(data) },
    ...(stamp ?? {}),
  });
  return data;
}

/**
 * Materialize a class's template rows into bundle documents, their contents
 * into items, and the class's 3d6 RollTable — idempotent, and driven by the
 * class DOCUMENT alone, so it runs with no book connected.
 *
 * A row whose bundle already resolves is left alone; a row with none gets
 * one. Gear is deduped per class by descriptor, so all bands share one
 * document. The RollTable is rebuilt every run. Materialized entries are
 * removed from the row arrays; what stays on a row is what resolved to nothing.
 *
 * @param {object} [options]
 * @param {object} [options.stamp] opaque flags merged onto every created
 *   document (the importer's claim); this module never invents another
 *   module's flag itself
 * @param {string} [options.folder] folder id for bundles and gear — inside
 *   `pack` when one is given
 * @param {string} [options.tableFolder] folder id for the RollTable
 * @param {string} [options.pack] collection id of the Item shelf the parts
 *   are written to; omitted, the class's own shelf (`shelvesFor`)
 * @param {string} [options.tablePack] collection id of the RollTable shelf
 * @param {boolean} [options.create] build packages for rows that have none.
 *   False is the RELINK-ONLY pass an import runs: it restores the bundle
 *   uuids its `system` rewrite wiped and never turns a world that asked for
 *   no packages into one that has them.
 * @returns {Promise<{created: string[], relinked: string[], skippedEdited: string[], unresolved: string[], unidentified: string[]}>}
 */
export async function materializeTemplates(
  classItem,
  { stamp = null, folder = null, tableFolder = null, pack = null, tablePack = null, create = true } = {},
) {
  const report = { created: [], relinked: [], skippedEdited: [], unresolved: [], unidentified: [] };
  if (!game.user?.isGM || !classItem?.system?.templates?.length) return report;
  // A class row in a compendium builds its package on that same shelf. See
  // docs/classes/DECISIONS.md, "a class row in a compendium still builds its package".
  const classKey = classItem.system.key || fold(classItem.name);
  const identity = { classUuid: classItem.uuid, classKey };
  const isMine = (doc) => {
    const part = partOf(doc);
    return part && (part.classUuid === classItem.uuid || part.classKey === classKey);
  };
  const shelves = await shelvesFor(classItem, { pack, tablePack });
  const itemOpts = shelves.items ? { pack: shelves.items } : {};
  // Read across the whole library, never one collection: the parts sit in the
  // sidebar or on a pack shelf.
  const ownGear = () => libraryItems().filter((i) => isMine(i) && partOf(i).kind === "gear");
  const ownAbilities = () => libraryItems().filter((i) => isMine(i) && partOf(i).kind === "ability");
  const shelf = folder ?? (await defaultFolder(classItem, shelves.items));

  /**
   * The gear document for one descriptor, created on first need.
   *
   * A descriptor nothing can answer for yields no document; the caller keeps
   * such an entry on the row, printed.
   */
  const planGear = async (entry) => {
    const nameKey = fold(templateItemName(entry));
    const existing = ownGear().find((g) => fold(g.name) === nameKey);
    if (existing) return { doc: existing };
    const { data, resolution } = await buildGearData(entry);
    if (resolution === "bare") {
      report.unresolved.push(entry.name);
      return {};
    }
    // A weapon that resolved to a document but not to a weapon-table row is
    // reported here, where the descriptor and the base are both in hand.
    if (isUnidentifiedWeapon(data)) report.unidentified.push(templateItemName(entry));
    foundry.utils.setProperty(data, "system.quantity.value", 1);
    stampPart(data, { ...identity, kind: "gear" }, stamp);
    if (shelf) data.folder = shelf;
    return { data, nameKey };
  };

  /**
   * The document one printed proficiency entry becomes.
   *
   * A definition that already exists is linked, wherever it lives: one shared
   * document, no second copy of an ability the GM imported.
   *
   * A printed selection becomes its own copy (JJ p. 450), since writing it onto
   * the shared definition would specialize it for everybody.
   *
   * A name nothing defines yields no document; the caller keeps the entry on
   * the row, printed.
   */
  const planAbility = async (entry) => {
    const { doc: source } = await findSource({
      ref: entry.ref,
      name: entry.name,
      types: [ITEM_TYPE.ability],
    });
    if (!source) {
      report.unresolved.push(entry.name || entry.ref);
      return {};
    }
    if (!entry.selection) return { doc: source };
    const data = buildProfData(entry, source);
    const nameKey = fold(data.name);
    const existing = ownAbilities().find((a) => fold(a.name) === nameKey);
    if (existing) return { doc: existing };
    stampPart(data, { ...identity, kind: "ability" }, stamp);
    if (shelf) data.folder = shelf;
    return { data, nameKey };
  };

  /** The spell for one spellbook entry: linked when the library holds it,
   *  copied onto the shelf when only a foreign compendium does, null when
   *  nothing answers. */
  const planSpell = async (entry) => {
    if (entry.uuid) {
      const linked = await fromUuid(entry.uuid).catch(() => null);
      if (linked) return { doc: linked };
    }
    const f = fold(entry.name);
    const spells = libraryItems().filter((i) => i.type === ITEM_TYPE.spell);
    // The printed name whole before a looser read, so a prefix does not win by sort order.
    const exact = f ? spells.find((i) => fold(i.name) === f) : null;
    const loose = exact ?? (f.length >= 6 ? spells.find((i) => fold(i.name).includes(f)) : null);
    if (loose) return { doc: loose };
    const { doc: source, linkable } = await findSource({ name: entry.name, types: [ITEM_TYPE.spell] });
    if (!source) return {};
    if (linkable) return { doc: source };
    const existing = libraryItems().find((i) => i.type === ITEM_TYPE.spell && fold(i.name) === fold(source.name));
    if (existing) return { doc: existing };
    const data = stampPart(copyOf(source), { ...identity, kind: "spell" }, stamp);
    if (shelf) data.folder = shelf;
    return { data, nameKey: fold(source.name) };
  };

  /**
   * Write one row's new documents in a single call, and hand each plan its
   * document back. A batch that fails is written singly. See
   * docs/classes/DECISIONS.md, "a template row resolves everything, then writes once".
   *
   * Plans are deduplicated by name key first: two entries on one row can name
   * the same thing, and deferred writes mean neither sees the other's document.
   */
  const writeRow = async (plans) => {
    const pending = [];
    const byKey = new Map();
    for (const plan of plans) {
      if (!plan.data) continue;
      const seen = plan.nameKey ? byKey.get(plan.nameKey) : null;
      if (seen) {
        plan.shareWith = seen;
        continue;
      }
      plan.at = pending.length;
      pending.push(plan.data);
      if (plan.nameKey) byKey.set(plan.nameKey, plan);
    }
    if (!pending.length) return;
    const made = await Item.implementation.createDocuments(pending, itemOpts).catch((err) => {
      console.warn(`${MODULE_ID} | template row: batched create failed, writing singly`, err);
      return null;
    });
    for (const plan of plans) {
      if (plan.at == null) continue;
      plan.doc = made ? made[plan.at] : await Item.implementation.create(plan.data, itemOpts).catch(() => null);
      if (plan.doc) report.created.push(plan.doc.name);
    }
    for (const plan of plans) if (plan.shareWith) plan.doc = plan.shareWith.doc;
  };

  /**
   * Relink the printed spells a row still states because no document answered
   * for them when the bundle was built. Each named, non-offer entry with no
   * document is planned again; what resolves is written (a copy only when
   * `create` allows one) and listed on the bundle, and the entry takes the
   * document's uuid so the represented pass strips it. A bundle a Judge
   * edited is left as it is and reported. Returns whether the row changed.
   */
  const relinkSpells = async (row, bundle) => {
    const pending = (row.spells ?? []).filter((e) => !isOffer(e) && e.name && !e.uuid);
    if (!pending.length) return false;
    if (editedSinceImport(bundle)) {
      report.skippedEdited.push(bundle.name);
      return false;
    }
    const plans = [];
    for (const entry of pending) plans.push({ entry, ...(await planSpell(entry)) });
    if (create) await writeRow(plans);
    const rows = foundry.utils.deepClone(bundle.system.itemList ?? []);
    const listed = new Set(rows.map((r) => r.uuid));
    let changed = false;
    const names = [];
    for (const plan of plans) {
      if (!plan.doc) {
        if (!plan.data) report.unresolved.push(plan.entry.name);
        continue;
      }
      plan.entry.uuid = plan.doc.uuid;
      changed = true;
      if (!listed.has(plan.doc.uuid)) {
        rows.push(listRow(plan.doc));
        listed.add(plan.doc.uuid);
      }
      names.push(plan.doc.name);
    }
    if (names.length) {
      // The snapshot follows the list, so a relink does not read as a Judge's edit.
      await bundle.update({
        "system.itemList": rows,
        [`flags.${MODULE_ID}.asImported.system.itemList`]: rows,
      });
      report.relinked.push(`${bundle.name} (${names.length} spell${names.length === 1 ? "" : "s"})`);
    }
    return changed;
  };

  const templates = foundry.utils.deepClone(classItem.system.toObject?.().templates ?? classItem.system.templates);
  const ownBundles = libraryItems().filter((i) => i.type === ITEM_TYPE.bundle && isMine(i) && partOf(i).kind === "bundle");
  let changed = false;

  for (const row of templates) {
    // Loaded, never read off the index: an unloaded shelf answers
    // `fromUuidSync` with an entry that can be neither compared nor written.
    let bundle = row.bundle ? await fromUuid(row.bundle).catch(() => null) : null;
    if (bundle?.type !== ITEM_TYPE.bundle) bundle = null;
    if (!bundle) {
      // The row's uuid is a cache; the flag on the bundle is the identity an
      // importer Update pass cannot wipe.
      bundle = ownBundles.find((b) => partOf(b).band === row.rollMin) ?? null;
      if (bundle) {
        row.bundle = bundle.uuid;
        changed = true;
        report.relinked.push(bundle.name);
      }
    }
    if (bundle) {
      // Contents already exist. An importer Update rewrites the whole `system`,
      // putting the printed arrays back on a row whose bundle carries them, so
      // the represented entries are stripped again.
      if (await relinkSpells(row, bundle)) changed = true;
      if (stripRepresented(row, bundle)) changed = true;
      continue;
    }
    if (!create) continue;

    const list = [];
    const keptAbilities = [];
    // Every entry on this row is resolved first and written once at the end.
    const plans = [];
    for (const entry of row.abilities ?? []) {
      // An offered rung is a question for the player, not a document: it
      // stays on the row for chargen to ask.
      if (isOffer(entry)) {
        keptAbilities.push(entry);
        continue;
      }
      plans.push({ ...(await planAbility(entry)), entry, qty: Math.max(1, entry.rank || 1), kept: keptAbilities });
    }

    const keptItems = [];
    for (const entry of row.items ?? []) {
      plans.push({ ...(await planGear(entry)), entry, qty: entry.qty || 1, kept: keptItems });
    }

    const keptSpells = [];
    for (const entry of row.spells ?? []) {
      // An offered spell is a pick and is never resolved to a document.
      if (isOffer(entry)) {
        keptSpells.push(entry);
        continue;
      }
      const plan = { ...(await planSpell(entry)), entry, qty: 1, kept: keptSpells };
      if (!plan.doc && !plan.data && entry.name) report.unresolved.push(entry.name);
      plans.push(plan);
    }

    // Resolution is done; one write for the whole row.
    await writeRow(plans);
    for (const plan of plans) {
      if (plan.doc) list.push(listRow(plan.doc, plan.qty));
      else plan.kept.push(plan.entry);
    }

    const bundleName =
      loc("templates.bundleName", {
        class: classItem.name,
        template: row.name + (row.annotation ? ` (${row.annotation})` : ""),
      }) ?? `${classItem.name} — ${row.name}`;
    const noteBits = [row.caste, row.enc, row.alt].filter(Boolean);
    const data = stampPart(
      {
        name: bundleName,
        type: ITEM_TYPE.bundle,
        img: classItem.img,
        system: { itemList: list, ...(noteBits.length ? { description: `<p>${noteBits.join("</p><p>")}</p>` } : {}) },
        flags: {},
      },
      { ...identity, kind: "bundle", band: row.rollMin },
      stamp,
    );
    if (shelf) data.folder = shelf;
    const created = await Item.implementation.create(data, itemOpts);
    if (!created) continue;
    report.created.push(created.name);
    // What the bundle now carries leaves the row; what it could not carry stays.
    row.bundle = created.uuid;
    row.abilities = keptAbilities;
    row.items = keptItems;
    row.spells = keptSpells;
    changed = true;
  }

  const tableUuid = await syncTemplateTable(classItem, templates, {
    stamp,
    tableFolder: tableFolder ?? (await defaultTableFolder(shelves.tables)),
    tablePack: shelves.tables,
  });
  if (tableUuid !== classItem.system.templateTable) changed = true;
  if (changed) {
    await classItem.update({ "system.templates": templates, "system.templateTable": tableUuid });
  }
  return report;
}

/**
 * Rebuild the class's 3d6 template RollTable from its rows — the generated
 * view of the bands. Replaces results wholesale on a table this module
 * created; a table it did not create (or a class with no bundles) is left
 * alone and the existing uuid kept.
 */
async function syncTemplateTable(classItem, templates, { stamp = null, tableFolder = null, tablePack = null } = {}) {
  const rows = templates.filter((t) => t.bundle);
  if (!rows.length) return classItem.system.templateTable ?? "";
  const results = rows.map((t) => {
    const doc = fromUuidSync(t.bundle);
    return {
      type: "document",
      documentUuid: t.bundle,
      name: doc?.name ?? t.name,
      ...(doc?.img ? { img: doc.img } : {}),
      range: [t.rollMin, t.rollMax],
    };
  });
  let table = classItem.system.templateTable ? fromUuidSync(classItem.system.templateTable) : null;
  if (!table) {
    const classKey = classItem.system.key || fold(classItem.name);
    table =
      libraryDocs("RollTable").find((t) => {
        const part = partOf(t);
        return part?.kind === "table" && (part.classUuid === classItem.uuid || part.classKey === classKey);
      }) ?? null;
  }
  // An unloaded shelf answers `fromUuidSync` with its index entry, which lacks
  // the results and not always the flags, so load the table before asking whose it is.
  if (table && !table.results) table = await fromUuid(table.uuid);
  if (table && !partOf(table)) return table.uuid;
  const name = loc("templates.tableName", { class: classItem.name }) ?? `${classItem.name} Templates`;
  if (table) {
    const stale = table.results.map((r) => r.id);
    if (stale.length) await table.deleteEmbeddedDocuments("TableResult", stale);
    await table.createEmbeddedDocuments("TableResult", results);
    if (table.name !== name) await table.update({ name });
    return table.uuid;
  }
  const data = {
    name,
    formula: "3d6",
    img: classItem.img,
    replacement: true,
    displayRoll: true,
    results,
    flags: foundry.utils.mergeObject(
      { [MODULE_ID]: { [TEMPLATE_PART]: { classUuid: classItem.uuid, classKey: classItem.system.key || fold(classItem.name), kind: "table" } } },
      stamp ?? {},
    ),
  };
  if (tableFolder) data.folder = tableFolder;
  const created = await RollTable.implementation.create(data, tablePack ? { pack: tablePack } : {});
  return created?.uuid ?? "";
}
