/* global game, foundry, fromUuid, fromUuidSync, Item, RollTable, Folder, console */
/**
 * Template packages: a class's printed starting templates materialized as
 * repairable world documents.
 *
 * Each template row on a class may bind a core `bundle` Item — a container of
 * uuid links to REAL world documents: the abilities it grants (shared links,
 * or specialized copies), its gear as already-skinned items (the printed
 * descriptor over the base's mechanics), and its spells. Repairing one linked
 * document — retyping a mis-imported staff to a weapon, fixing its damage —
 * repairs every character generated from that template afterwards. A 3d6
 * RollTable per class links the bundles as a generated VIEW: nothing in code
 * reads it, so it cannot drift into a second authority.
 *
 * Ownership: the class row keeps the printed band, name, annotation, caste,
 * coin and encumbrance note; the bundle owns WHAT the package contains; each
 * linked item owns what one piece of gear IS. A materialized entry is removed
 * from the row's arrays, so the sheet, the preview and the grant all read one
 * list; printed cells that resolved to nothing stay on the row, visibly.
 *
 * Identity lives on the bundle (`flags["acks-extras"].templatePart`), not on
 * the row — an importer Update pass replaces the whole `system` object, so
 * the row's `bundle` uuid is a cache re-derived from that flag afterwards.
 * Documents this file creates carry an `asImported` snapshot; any pass that
 * would replace one compares the live document against it first, and an
 * edited document is skipped and reported, never clobbered.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_TEMPLATE_PART } from "./constants.mjs";
import { findByRef } from "./registry.mjs";
import { refOf } from "./grants.mjs";
import { ITEM_TYPE, selectionVocabFor, nameWithSelections } from "../lib/vocab.mjs";
import { equipmentClass } from "../equipment/profiles.mjs";

const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Flag key (under `flags["acks-extras"]`) naming what a document is a part of.
 *  Stated in `constants.mjs`, where every lookup that must tell a class's own
 *  copy from the definition it copied can reach it without importing this file. */
export const TEMPLATE_PART = FLAG_TEMPLATE_PART;

const partOf = (doc) => doc?.flags?.[MODULE_ID]?.[TEMPLATE_PART] ?? null;

const loc = (key, data) => game.i18n?.format?.(`${LANG_PREFIX}.${key}`, data) ?? null;

/* ------------------------------------------------------------------ */
/*  Pure resolution helpers (Foundry-free, tested offline)             */
/* ------------------------------------------------------------------ */

/**
 * Is the candidate name a whole WORD of the printed descriptor?
 *
 * The escape hatch that lets a short base name be found at all. A trailing
 * plural belongs to the word: a cell printing "torches" or "darts" names the
 * Torch and the Dart the world holds, and reading them as unknown gear left a
 * character carrying a bundle of sticks with no damage on it. Seams inside a
 * multi-word name are `\s*`, because real extraction welds words together.
 */
function wholeWordIn(candidateName, descriptor) {
  const body = String(candidateName).trim().split(/\s+/).map(escapeRe).join("\\s*");
  return !!body && new RegExp(`(^|[^a-z0-9])${body}(?:e?s)?([^a-z0-9]|$)`, "i").test(descriptor);
}

/**
 * Every way an imported item's name can be written.
 *
 * The books' own price list writes a name HEAD FIRST with its qualifier after
 * a comma — "Rations, Iron", "Rope, 50’", "Saddle and tack, Riding" — while a
 * template's printed descriptor writes the same thing as English: "1 week’s
 * iron rations". A slash names one row by either word ("Waterskin/Wineskin").
 * Both are conventions of the catalogue rather than facts about one entry, so
 * both are read here by rule.
 *
 * This is what an already-imported world's REPAIR pass matches against: a
 * document minted before its base existed carries only the printed descriptor,
 * so it is re-matched by name alone with no ref to help it.
 */
function nameVariants(raw) {
  const out = [];
  const add = (t) => {
    const v = String(t).replace(/\s+/g, " ").trim();
    if (v && !out.includes(v)) out.push(v);
  };
  for (const base of [raw, raw.replace(/\([^)]*\)/g, " ")]) {
    const segments = String(base).split(",").map((x) => x.trim()).filter(Boolean);
    for (const form of segments.length > 1 ? [base, [...segments].reverse().join(" ")] : [base]) {
      let combos = [[]];
      for (const options of String(form).trim().split(/\s+/).map((w) => w.split("/"))) {
        combos = combos.flatMap((prefix) => options.map((o) => [...prefix, o]));
        if (combos.length > 8) break;
      }
      for (const c of combos) add(c.join(" "));
    }
  }
  return out;
}

/**
 * The best base candidate a printed descriptor names, from a candidate list
 * (`{name}` objects). An exact folded match wins at any length; containment
 * requires a folded length of 6, or 4–5 as a whole word of the raw descriptor
 * — never a bare substring, which is how "mace" used to find nothing and
 * "grimace" would find too much. Every variant of the candidate's name is
 * tried (`nameVariants`), including its paren-stripped form: an embellished
 * instance contains "spellbook", never "(blank)".
 *
 * ACKS Importer applies the same rules when it resolves a printed descriptor
 * against the equipment menu (`parseEquipment` in its `cookbook.mjs`); the two
 * must agree, or a descriptor points at one base and skins itself over another.
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
 * descriptor with the base name (or its paren-stripped form) excised —
 * "Crudely-crafted shortbow" over Short Bow leaves "Crudely-crafted".
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
 * What one template equipment entry is CALLED.
 *
 * The count lives on the quantity field — "2 flasks of holy water" is two of
 * an item called "Flasks of holy water", never one item with a numeral in its
 * name. The page that lists a package and the grant that materializes it read
 * this one rule, so neither says "3 javelins ×3".
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

/** Index fields every pack lookup needs: the type, and the importer's stamp. */
const INDEX_FIELDS = ["type", "flags.acks-importer.cookbook.id"];

/** One pack's index, or null when it cannot be read (never fatal). */
async function packIndex(pack) {
  return pack.getIndex({ fields: INDEX_FIELDS }).catch((err) => {
    console.warn(`${MODULE_ID} | template packages: index of ${pack.metadata.id} unreadable`, err);
    return null;
  });
}

/**
 * The IMPORTS, in pack form — and nothing else.
 *
 * A package is built from what the GM imported from their own book, never
 * from the system's shipped compendium: a shipped "Staff" carries the
 * system's own values, and pulling one would put content into a template
 * that the reader's book never supplied. Extras already treats imported
 * documents as SUPERSEDING the shipped packs (`hideSupersededPacks`), and
 * this is the same rule at the resolution layer.
 *
 * The importer's compendium mode creates a **world-level** pack (its
 * `packFor`), so a qualifying source is a world-level Item pack whose index
 * actually carries the importer's stamp. Module- and system-level packs are
 * never read.
 */
async function importPacks() {
  const out = [];
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item" || pack.metadata?.packageType !== "world") continue;
    const index = await packIndex(pack);
    if (!index) continue;
    const rows = [...index];
    if (!rows.some((r) => r.flags?.["acks-importer"]?.cookbook?.id)) continue;
    out.push({ pack, rows });
  }
  return out;
}

/**
 * Find a definition among the imports: by the importer's cookbook stamp
 * first, then by exact folded name among the wanted types.
 *
 * The importer can be configured to import into a pack rather than the world,
 * and `findByRef` only ever looks at `game.items` — so without this a
 * compendium-mode world resolves no proficiency and no base item, and every
 * package materializes empty.
 */
async function findInPacks({ ref = "", name = "", types = [] }) {
  const wanted = fold(name);
  for (const { pack, rows } of await importPacks()) {
    let row = ref ? rows.find((r) => r.flags?.["acks-importer"]?.cookbook?.id === ref) : null;
    if (!row && wanted) row = rows.find((r) => (!types.length || types.includes(r.type)) && fold(r.name) === wanted);
    if (!row) continue;
    const doc = await pack.getDocument(row._id).catch(() => null);
    if (doc) return doc;
  }
  return null;
}

/**
 * Can this document stand as the SOURCE a package is built from?
 *
 * A part this module minted with nothing behind it — a placeholder
 * proficiency, a bare gear item — never can. It is a document with the
 * printed NAME and no content, so a search by name matches it, and cloning
 * it "resolves" the gap with the emptiness that defined it: the placeholder
 * is deleted, its replacement is flagged resolved, and the Judge's signal
 * that a real definition is still missing goes quiet without anyone having
 * repaired anything. A part that DID resolve stays usable, so a copy made
 * from a compendium on an earlier run is linked again rather than doubled.
 */
export const usableAsSource = (doc) => !doc?.flags?.[MODULE_ID]?.[TEMPLATE_PART]?.unresolved;

/**
 * The document a template entry names: the world's own first (`world: true`,
 * so a plain proficiency can simply be LINKED), then the imports held in a
 * pack — whose documents are copied into the world by the caller, because a
 * locked pack document is precisely what a Judge cannot repair.
 *
 * @param {object} [options]
 * @param {string[]} [options.exclude] uuids that may not answer — the
 *   document being upgraded names itself here, so a second pass can never
 *   close a gap with the placeholder that marks it.
 * @returns {Promise<{doc: object|null, world: boolean}>}
 */
export async function findSource({ ref = "", name = "", types = [], exclude = [] } = {}) {
  const allowed = (doc) => doc && usableAsSource(doc) && !exclude.includes(doc.uuid);
  if (ref) {
    const byRef = findByRef(ref);
    if (allowed(byRef)) return { doc: byRef, world: true };
  }
  const wanted = fold(name);
  if (wanted) {
    const byName = game.items?.find(
      (i) => (!types.length || types.includes(i.type)) && fold(i.name) === wanted && allowed(i),
    );
    if (byName) return { doc: byName, world: true };
  }
  return { doc: await findInPacks({ ref, name, types }), world: false };
}

/**
 * Resolve a template item entry to its BASE world item (null = no base).
 *
 * A base is something the world IMPORTED or a Judge made — never a document
 * this feature minted. Excluding its own parts stops two mistakes: a bare
 * placeholder exact-matching its own descriptor on a later pass and
 * "resolving" itself, and a finished skin being treated as the base for a
 * second skin of the same name.
 */
export function resolveBase(entry, { exclude = [] } = {}) {
  const eligible = (i) => GEAR_TYPES.includes(i.type) && !partOf(i) && !exclude.includes(i.uuid);
  if (entry.ref) {
    if (entry.ref.startsWith("name:")) {
      const name = entry.ref.slice(5);
      return game.items.find((i) => eligible(i) && i.name.toLowerCase() === name.toLowerCase()) ?? null;
    }
    const doc = findByRef(entry.ref);
    if (doc && usableAsSource(doc) && !exclude.includes(doc.uuid)) return doc;
  }
  return bestBaseMatch(entry.name, game.items.filter(eligible));
}

/**
 * The base a piece of gear is an instance of — the world's own imported gear
 * first, else the imports held in a pack (fuzzy-matched over its index the
 * same way, so a compendium-mode world resolves "staff tipped with glass
 * gemstone" to the imported Staff rather than minting a bare item). The
 * system's shipped equipment is never a base; see `importPacks`.
 */
export async function resolveBaseDoc(entry, { exclude = [] } = {}) {
  const world = resolveBase(entry, { exclude });
  if (world) return world;
  for (const { pack, rows } of await importPacks()) {
    let row = entry.ref ? rows.find((r) => r.flags?.["acks-importer"]?.cookbook?.id === entry.ref) : null;
    if (!row) row = bestBaseMatch(entry.name, rows.filter((r) => GEAR_TYPES.includes(r.type)));
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
 * from its stats), else a bare named `item` — visible and repairable, never
 * dropped.
 * @returns {Promise<{data: object, resolution: "base"|"root"|"bare"}>}
 */
export async function buildGearData(entry, { exclude = [] } = {}) {
  const skinName = templateItemName(entry);
  const base = await resolveBaseDoc(entry, { exclude });
  if (base) {
    const data = base.toObject();
    delete data._id;
    delete data.folder;
    delete data.sort;
    delete data.ownership;
    // A SKIN IS NOT THE IMPORT IT COPIES. `toObject` brings the base's whole
    // flag set with it, importer stamp included, so an unstripped skin
    // advertises itself as the definition and answers ref lookups meant for
    // the base — one template's "aged and dusty staff" standing in for Staff.
    // What this copy is is recorded on its own `skin` flag below.
    delete data.flags?.["acks-importer"];
    data.name = skinName;
    foundry.utils.setProperty(data, "system.quantity.value", entry.qty || 1);
    // A PRICE THE PAGE STATES ABOUT THIS PIECE OUTRANKS THE BASE'S. The cell
    // that says a staff is worth 45gp is describing the gemstone on this one,
    // not the shop list's plain staff.
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
  // WHAT THE PAGE DID SAY, EVEN WHEN NOTHING ANSWERS FOR WHAT IT IS. Most of
  // the gear that reaches this point is priced in the cell and nowhere else —
  // a bladedancer's head dress, a silver amulet, a crystal ball — because the
  // shop list has no row for it. Dropping the one number the page gave would
  // hand the Judge an item to repair with nothing to repair it from.
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
 * The proficiency a template names but nothing in this world defines yet.
 *
 * Minted so the package is a COMPLETE container a Judge can repair: an
 * unlinked name on the class row is invisible on the character and cannot be
 * dragged, retyped or replaced, which is the whole complaint this shape
 * exists to answer. It carries the printed name and NOTHING else — no
 * description, no rules text — and is flagged `unresolved` so a later
 * materialize run relinks it the moment the real definition arrives.
 */
export function buildPlaceholderAbility(entry) {
  return {
    name: entry.name || entry.ref || "—",
    type: ITEM_TYPE.ability,
    system: {},
    flags: { [MODULE_ID]: { ...(entry.ref ? { grantedFrom: entry.ref } : {}) } },
  };
}

/**
 * Build the specialized ability copy a template entry with a printed
 * selection needs ("Fighting Style Spec. (weapon & shield)"): the source's
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
 * synchronous) PLUS whatever printed entries the row still holds — the two
 * are disjoint, because materializing removes exactly what it bundled. A
 * bundle that is empty or gone leaves the row answering alone.
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

/** One itemList row linking a world document. */
const listRow = (doc, quantity = 1) => ({
  id: doc.id,
  uuid: doc.uuid,
  quantity,
  name: doc.name,
  img: doc.img,
  type: doc.type,
  inCompendium: false,
});

/**
 * Remove from a template row every printed entry its bundle already
 * represents — matched the way the materializer placed them: an ability by
 * its ref (the linked document's own ref, or the `grantedFrom` a specialized
 * copy or placeholder carries) or by name, gear by the skinned name or the
 * descriptor on its skin flag, a spell by uuid or folded name.
 *
 * ONE owner: what the bundle carries, the row no longer states. The safety
 * is that removal is per-entry and evidence-based — an entry the bundle does
 * NOT carry stays on the row and keeps applying the printed way, so a
 * partial package can never silently shorten a starting kit. Returns whether
 * anything was stripped. Mutates `row`.
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
 * table's cleared, so the class applies from its own printed entries again —
 * exactly as it did before packages existed. The documents are left in the
 * world unless `deleteDocuments`, because they may hold a Judge's repairs.
 *
 * **A package never consumes what it points at.** `deleteDocuments` removes
 * only documents carrying this module's own `templatePart` stamp — the
 * bundles, skins, copies and placeholders it minted. An IMPORT a package
 * links or was skinned from (the imported Sword a template names, the shared
 * Adventuring proficiency) carries no such stamp and is never touched: the
 * item library is a source, not a package's private contents.
 *
 * This is the way back. Adding containers must never be a one-way door.
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
  for (const doc of game.items.filter(mine)) {
    removed.push(doc.name);
    await doc.delete();
  }
  for (const table of game.tables?.filter(mine) ?? []) {
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
  return !foundry.utils.objectsEqual(live, snapshot);
}

/** The comparable creation snapshot for a payload: name, type and the system
 *  fields it set — the surface a Judge's repair would touch. */
const snapshotOf = (data) => ({
  name: data.name,
  type: data.type,
  system: foundry.utils.deepClone(data.system ?? {}),
});

/**
 * Where packages land when no caller supplies a folder (the sheet's own
 * build): one world folder per class under a shared root, so every
 * materialized document is findable — and therefore repairable — in the
 * sidebar instead of loose at the top of the Items directory. The importer
 * passes its own cookbook folder and never reaches this.
 */
async function defaultFolder(classItem) {
  const rootName = game.i18n?.localize?.(`${LANG_PREFIX}.templates.folder`) ?? "Class Templates";
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
 * into world items, and the class's 3d6 RollTable — idempotent, and driven by
 * the class DOCUMENT alone, so a world imported long ago upgrades with no
 * book connected.
 *
 * A row whose bundle already resolves is left alone (gear still flagged
 * unresolved is retried when it is unedited); a row with none gets one. Gear
 * is deduped per class by descriptor, so all bands share one repairable
 * document. The RollTable is rebuilt every run — it is a generated view.
 * Materialized entries are removed from the row arrays; what stays on a row
 * is what resolved to nothing.
 *
 * @param {object} [options]
 * @param {object} [options.stamp] opaque flags merged onto every created
 *   document (the importer's claim); this module never invents another
 *   module's flag itself
 * @param {string} [options.folder] folder id for bundles and gear
 * @param {string} [options.tableFolder] folder id for the RollTable
 * @param {boolean} [options.create] build packages for rows that have none.
 *   False is the RELINK-ONLY pass an import runs: it restores the bundle
 *   uuids its `system` rewrite wiped and never turns a world that asked for
 *   no packages into one that has them.
 * @returns {Promise<{created: string[], relinked: string[], skippedEdited: string[], unresolved: string[]}>}
 */
export async function materializeTemplates(
  classItem,
  { stamp = null, folder = null, tableFolder = null, create = true } = {},
) {
  const report = { created: [], relinked: [], skippedEdited: [], unresolved: [] };
  if (!game.user?.isGM || !classItem?.system?.templates?.length) return report;
  // World documents only: the registry (and therefore chargen) never reads a
  // compendium class, and a world bundle linked from a pack row helps nobody.
  if (classItem.pack) return report;
  const classKey = classItem.system.key || fold(classItem.name);
  const identity = { classUuid: classItem.uuid, classKey };
  const isMine = (doc) => {
    const part = partOf(doc);
    return part && (part.classUuid === classItem.uuid || part.classKey === classKey);
  };
  const worldGear = () => game.items.filter((i) => isMine(i) && partOf(i).kind === "gear");

  const worldAbilities = () => game.items.filter((i) => isMine(i) && partOf(i).kind === "ability");
  const shelf = folder ?? (await defaultFolder(classItem));

  /** The world gear document for one descriptor, created on first need. */
  const gearFor = async (entry) => {
    const nameKey = fold(templateItemName(entry));
    const existing = worldGear().find((g) => fold(g.name) === nameKey);
    if (existing) return existing;
    const { data, resolution } = await buildGearData(entry);
    foundry.utils.setProperty(data, "system.quantity.value", 1);
    stampPart(data, { ...identity, kind: "gear", unresolved: resolution === "bare" }, stamp);
    if (shelf) data.folder = shelf;
    const doc = await Item.implementation.create(data);
    if (doc) {
      report.created.push(doc.name);
      if (resolution === "bare") report.unresolved.push(entry.name);
    }
    return doc;
  };

  /**
   * The document one printed proficiency entry becomes.
   *
   * A plain proficiency the WORLD already defines is LINKED — one shared
   * document, no duplicate Adventuring per band. Anything else becomes a
   * world copy so it is repairable: a printed selection (the specialized
   * copy), a definition that exists only in a COMPENDIUM (a locked pack
   * document is exactly what a Judge cannot fix), and — flagged `unresolved`
   * — a name nothing defines yet, minted so the package is complete and the
   * gap is a document to repair rather than invisible text on the class.
   */
  const abilityFor = async (entry) => {
    const { doc: source, world } = await findSource({
      ref: entry.ref,
      name: entry.name,
      types: [ITEM_TYPE.ability],
    });
    if (source && world && !entry.selection) return source;
    const data = source
      ? (entry.selection ? buildProfData(entry, source) : copyOf(source))
      : buildPlaceholderAbility(entry);
    const nameKey = fold(data.name);
    const existing = worldAbilities().find((a) => fold(a.name) === nameKey);
    if (existing) return existing;
    stampPart(data, { ...identity, kind: "ability", unresolved: !source }, stamp);
    if (shelf) data.folder = shelf;
    const doc = await Item.implementation.create(data);
    if (doc) {
      report.created.push(doc.name);
      if (!source) report.unresolved.push(entry.name || entry.ref);
    }
    return doc;
  };

  /** The world spell for one spellbook entry: linked when the world holds it,
   *  copied when only a compendium does, null when nothing answers. */
  const spellFor = async (entry) => {
    if (entry.uuid) {
      const linked = await fromUuid(entry.uuid).catch(() => null);
      if (linked) return linked;
    }
    const f = fold(entry.name);
    const loose = f.length >= 6 ? game.items.find((i) => i.type === ITEM_TYPE.spell && fold(i.name).includes(f)) : null;
    if (loose) return loose;
    const { doc: source, world } = await findSource({ name: entry.name, types: [ITEM_TYPE.spell] });
    if (!source) return null;
    if (world) return source;
    const existing = game.items.find((i) => i.type === ITEM_TYPE.spell && fold(i.name) === fold(source.name));
    if (existing) return existing;
    const data = stampPart(copyOf(source), { ...identity, kind: "spell", unresolved: false }, stamp);
    if (shelf) data.folder = shelf;
    const doc = await Item.implementation.create(data);
    if (doc) report.created.push(doc.name);
    return doc;
  };

  /**
   * Second chances: a part minted before anything could define it — a bare
   * gear item, a placeholder proficiency — is REPLACED once the world or a
   * compendium can answer for it. The replacement is created, every bundle
   * row pointing at the old document is repointed, and the placeholder is
   * deleted. Replacing rather than retyping in place because an item's `type`
   * is what has to change (a plain item becoming a weapon), and a Judge's
   * repair is never overwritten: an edited placeholder is kept and reported.
   */
  const upgradeUnresolved = async (bundles) => {
    const swaps = new Map();
    const stale = [];
    for (const doc of [...worldGear(), ...worldAbilities()]) {
      const part = partOf(doc);
      if (!part?.unresolved) continue;
      if (editedSinceImport(doc)) {
        report.skippedEdited.push(doc.name);
        continue;
      }
      // The document being upgraded is never its own answer: it is the
      // placeholder that MARKS the gap, and cloning it would close the gap
      // with the emptiness that defined it.
      const exclude = [doc.uuid];
      let fresh = null;
      let replacement = { doc: null, world: false };
      if (part.kind === "gear") {
        const built = await buildGearData(
          {
            name: doc.flags?.[MODULE_ID]?.skin?.descriptor ?? doc.name,
            skinName: doc.name,
            qty: 1,
            // The placeholder holds the one number the page gave for it; a
            // replacement built from a base would otherwise arrive priced as
            // the shop list's plain version of the thing.
            cost: doc.system?.cost ?? 0,
          },
          { exclude },
        );
        if (built.resolution !== "bare") fresh = built.data;
      } else {
        replacement = await findSource({
          ref: doc.flags?.[MODULE_ID]?.grantedFrom ?? "",
          name: doc.name,
          types: [ITEM_TYPE.ability],
          exclude,
        });
        if (replacement.doc) fresh = copyOf(replacement.doc);
      }
      if (!fresh) {
        // Still nothing to answer with. Reported on EVERY pass, not only the
        // one that minted it: a gap the Judge has yet to fill is a standing
        // fact about the package, and a run that says nothing reads as a run
        // that found nothing wrong.
        report.unresolved.push(doc.name);
        continue;
      }
      // A proficiency the WORLD itself defines is LINKED, not copied — the
      // same rule the create path follows, so an upgrade does not leave the
      // world holding a redundant twin of an ability it already had. Gear is
      // always a copy, because a skin is by definition a copy of its base.
      const made =
        replacement.world && part.kind === "ability"
          ? replacement.doc
          : await (async () => {
              stampPart(fresh, { ...identity, kind: part.kind, unresolved: false }, stamp);
              if (shelf) fresh.folder = shelf;
              return Item.implementation.create(fresh);
            })();
      if (!made) continue;
      swaps.set(doc.uuid, made);
      stale.push(doc);
      report.created.push(`${made.name} (resolved)`);
    }
    if (!swaps.size) return;
    for (const bundle of bundles) {
      const rows = foundry.utils.deepClone(bundle.system.itemList ?? []);
      let dirty = false;
      for (const r of rows) {
        const made = swaps.get(r.uuid);
        if (!made) continue;
        Object.assign(r, listRow(made, r.quantity || 1));
        dirty = true;
      }
      if (dirty) await bundle.update({ "system.itemList": rows });
    }
    for (const doc of stale) await doc.delete();
  };

  const templates = foundry.utils.deepClone(classItem.system.toObject?.().templates ?? classItem.system.templates);
  const worldBundles = game.items.filter((i) => i.type === ITEM_TYPE.bundle && isMine(i) && partOf(i).kind === "bundle");
  await upgradeUnresolved(worldBundles);
  let changed = false;

  for (const row of templates) {
    let bundle = row.bundle ? fromUuidSync(row.bundle) : null;
    if (bundle?.type !== ITEM_TYPE.bundle) bundle = null;
    if (!bundle) {
      // The row's uuid is a cache; the flag on the bundle is the identity an
      // importer Update pass cannot wipe.
      bundle = worldBundles.find((b) => partOf(b).band === row.rollMin) ?? null;
      if (bundle) {
        row.bundle = bundle.uuid;
        changed = true;
        report.relinked.push(bundle.name);
      }
    }
    if (bundle) {
      // Contents already exist (unresolved parts were given their second
      // chance above, before any row was read). An importer Update rewrites
      // the whole `system`, putting the printed arrays back on a row whose
      // bundle already carries them — left there the package would be handed
      // over twice, so the represented entries go again.
      if (stripRepresented(row, bundle)) changed = true;
      continue;
    }
    if (!create) continue;

    const list = [];
    const keptAbilities = [];
    for (const entry of row.abilities ?? []) {
      // A rung the cell OFFERS rather than grants is a question for the
      // player, not a document — it stays on the row for chargen to ask.
      if (entry.choice?.from && !entry.ref && !entry.name) {
        keptAbilities.push(entry);
        continue;
      }
      const doc = await abilityFor(entry);
      if (doc) list.push(listRow(doc, Math.max(1, entry.rank || 1)));
      else keptAbilities.push(entry);
    }

    const keptItems = [];
    for (const entry of row.items ?? []) {
      const doc = await gearFor(entry);
      if (doc) list.push(listRow(doc, entry.qty || 1));
      else keptItems.push(entry);
    }

    const keptSpells = [];
    for (const entry of row.spells ?? []) {
      const doc = await spellFor(entry);
      if (doc) list.push(listRow(doc, 1));
      else {
        keptSpells.push(entry);
        if (entry.name) report.unresolved.push(entry.name);
      }
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
    const created = await Item.implementation.create(data);
    if (!created) continue;
    report.created.push(created.name);
    // One owner: what the bundle now carries leaves the row. What it could
    // NOT carry stays, and keeps applying the printed way.
    row.bundle = created.uuid;
    row.abilities = keptAbilities;
    row.items = keptItems;
    row.spells = keptSpells;
    changed = true;
  }

  const tableUuid = await syncTemplateTable(classItem, templates, { stamp, tableFolder });
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
async function syncTemplateTable(classItem, templates, { stamp = null, tableFolder = null } = {}) {
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
      game.tables?.find((t) => {
        const part = partOf(t);
        return part?.kind === "table" && (part.classUuid === classItem.uuid || part.classKey === classKey);
      }) ?? null;
  }
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
  const created = await RollTable.implementation.create(data);
  return created?.uuid ?? "";
}
