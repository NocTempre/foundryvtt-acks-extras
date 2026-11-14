/**
 * Cookbook runtime: variations, traps, spells and merchandise.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { bookText, entryText } from "../prose.mjs";
import { REPAIR, repairWrite, countRepair } from "../refresh.mjs";
import { BOOKS } from "../books.mjs";
import { executeEntry } from "../executor.mjs";
import { VARIATION_ITEM_TYPE } from "../../equipment/constants.mjs";
import { MERCHANDISE_TYPE } from "../../markets/constants.mjs";
import { DEMAND_AGE_HEADERS_SETTING } from "../../markets/merchandise-keys.mjs";
import { planMerchandise, bindMerchandiseRow, planDemand, describeUnmapped } from "../merchandise-binding.mjs";
import { TRAP_ITEM_TYPE } from "../../formation/constants.mjs";
import { TRAP_LEVELS } from "../../formation/trap-rules.mjs";
// The spell primitive's DataModel is not imported here: this file loads under
// plain Node in the offline harness, and the model needs `foundry`. The bind
// writes the plain shape `spellFromStat` returns; the model coerces on read.
import { SPELL_TYPE, FLAG_SPELL } from "../../magic/constants.mjs";
import { parseStatBlock, spellFromStat, reversedNameFrom, coreFieldsFrom } from "../../magic/spell-logic.mjs";
import {
  bookStamp, data, ctx, cookbookEntry, bookOf, merchandiseEntries, SIXTHS_PER_STONE, variationEntries, trapEntries,
  spellEntries,
} from "./state.mjs";
import { repairFromEntry, readForImport, passedOver } from "./read.mjs";
import { createDoc, claimImport, importedItem, ensureItemFolder } from "./target.mjs";

/* -------------------------------------------- */
/*  Merchandise (kind.merchandise → acks-extras.merchandise) */
/* -------------------------------------------- */

/**
 * Read one entry's grids off the seat's own book: the materialized node, or
 * `{ node: null, closed }` when nothing can be read (the book is not open
 * here, or the page no longer matches).
 */
async function readEntryGrids(id) {
  const found = cookbookEntry(id);
  const bookId = found ? bookOf(found) : null;
  const session = bookId ? ctx.sessionDocs.get(bookId) : null;
  const node = session ? await executeEntry(session.doc, found.cb, data.registers, id) : null;
  return node?.ok ? { node, closed: false } : { node: null, closed: !session };
}

/**
 * Import the printed merchandise, one ITEM per good, then append the demand
 * layers onto them.
 *
 * The dedup claim is per GOOD (`<entry id>.<key>`), not per entry: one entry
 * covers the whole table. A good the world already holds is passed over, or
 * with `repair` written over in place (`REPAIR.merchandise`). The demand
 * append runs whenever the goods do and rewrites the environment and racial
 * layers from the book each time; it is skipped, with a notice, when the book
 * that prints it is not open. A label or named good that maps to no key is
 * reported once at the end, on the console and in one GM notification, and
 * never dropped silently. The age-band header text lands in the world setting
 * `marketsDemandAgeHeaders`, which is read-only content and never ships.
 */
export async function importMerchandise({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[MERCHANDISE_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | the merchandise item type is not registered in this world.`);
    return [];
  }
  const made = [];
  const held = new Map(); // key -> the item a demand layer writes onto
  const unmapped = [];
  let skipped = 0;
  let ran = false;
  for (const [id, entry] of merchandiseEntries("kind.merchandise")) {
    if (only && !only.has(id)) continue;
    ran = true;
    const { node, closed } = await readEntryGrids(id);
    if (!node) {
      if (repair) countRepair(repair, closed ? "book-closed" : "no-match");
      continue;
    }
    const plan = planMerchandise(node.fields?.grids);
    unmapped.push(...plan.unmapped);
    for (const planned of plan.rows) {
      const rowId = `${id}.${planned.key}`;
      const built = bindMerchandiseRow(planned, entry, id);
      const have = await importedItem(rowId);
      if (have) {
        skipped++;
        held.set(planned.key, have);
        if (repair) countRepair(repair, await repairWrite(have, built, REPAIR.merchandise, repair));
        continue;
      }
      const doc = await claimImport(rowId, async () => {
        const folder = (await ensureItemFolder(id))?.id ?? null;
        return createDoc(Item, { ...built, folder });
      });
      if (doc) {
        made.push(doc);
        held.set(planned.key, doc);
      }
    }
  }

  if (ran && held.size) await appendDemand(held, unmapped);

  if (unmapped.length) {
    const lines = describeUnmapped(unmapped);
    console.warn(`${MODULE_ID} | merchandise: ${lines.length} printed name(s) map to no good and were left out:\n${lines.join("\n")}`);
    ui.notifications?.warn(
      game.i18n.format(`${LANG_PREFIX}.ui.merchUnmapped`, { n: lines.length, list: lines.join("; ") }),
    );
  }
  ui.notifications?.info(
    `${MODULE_ID} | merchandise: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}.`,
  );
  return made;
}

/**
 * Write each demand entry's environment and racial layers onto the goods in
 * `held`, and remember the age-band header text. `unmapped` collects what the
 * plan could not place, plus any good the grid names that this world holds no
 * item for.
 */
async function appendDemand(held, unmapped) {
  for (const [id] of merchandiseEntries("kind.merchandiseDemand")) {
    const { node, closed } = await readEntryGrids(id);
    if (!node) {
      ui.notifications?.info(
        game.i18n.format(`${LANG_PREFIX}.ui.${closed ? "merchDemandClosed" : "merchDemandNoMatch"}`, {
          book: BOOKS[bookOf(cookbookEntry(id))]?.label ?? id,
        }),
      );
      continue;
    }
    const plan = planDemand(node.fields?.grids);
    unmapped.push(...plan.unmapped);
    if (Object.keys(plan.ageHeaders).length) {
      try {
        const stored = game.settings.get(MODULE_ID, DEMAND_AGE_HEADERS_SETTING) ?? {};
        await game.settings.set(MODULE_ID, DEMAND_AGE_HEADERS_SETTING, { ...stored, ...plan.ageHeaders });
      } catch (err) {
        console.warn(`${MODULE_ID} | merchandise: the age-band headers could not be stored`, err);
      }
    }
    for (const [key, layers] of plan.byKey) {
      const doc = held.get(key);
      if (!doc) {
        unmapped.push({ where: "demand", label: key, reason: "no merchandise item to append to" });
        continue;
      }
      const update = {};
      if (Object.keys(layers.environment).length) update["system.environment"] = layers.environment;
      // Replaced whole, never merged: a race the book no longer names for
      // this good must not survive the write.
      if (Object.keys(layers.racial).length) update["system.racial"] = foundry.data.operators.ForcedReplacement.create(layers.racial);
      if (!Object.keys(update).length) continue;
      try {
        await doc.update(update);
      } catch (err) {
        console.error(`${MODULE_ID} | merchandise: the demand layers could not be written onto ${doc.name}`, err);
      }
    }
  }
}

/* -------------------------------------------- */
/*  Variations (kind.variation → acks-extras.*) */
/* -------------------------------------------- */

/**
 * Build one `acks-extras.variation` from an entry and its materialized
 * numbers. The register declares what kind of difference this is, what it
 * may go on, and what it supersedes; every number comes from
 * `node.fields.variation`, and a locator that did not match drops its whole
 * spec rather than defaulting.
 *
 * `deltas.stoneLighter` is the one unit translation: the located stone count
 * is negated and scaled to the sixths the schema counts in.
 */
export function bindVariation(entry, node, id) {
  const meta = entry.meta ?? {};
  const cite = entry.cite ?? "";
  const deltas = {};
  const cost = {};
  const data = {};
  for (const found of node?.fields?.variation ?? []) {
    const amount = Number(found?.amount);
    if (!Number.isFinite(amount)) continue;
    switch (found.field) {
      case "deltas.bonus":
      case "deltas.damage":
      case "deltas.ac":
        deltas[found.field.split(".")[1]] = amount;
        break;
      case "deltas.stoneLighter":
        deltas.weight6 = -amount * SIXTHS_PER_STONE;
        break;
      case "cost.add":
      case "cost.mul":
      case "cost.baseMul":
        cost[found.field.split(".")[1]] = amount;
        break;
      default:
        // `data.<key>` is the open half of the schema: what a variation records
        // about ITSELF, against the specs in `dataFields`. A shield's armour
        // class and encumbrance land here rather than in `deltas` because they
        // are not one number added to the item — they differ by how the shield
        // is being carried, and the consumer that will read them keys on the
        // enum rather than summing. Keyed so it can be read later; prose could
        // not be.
        if (found.field?.startsWith("data.")) data[found.field.slice(5)] = amount;
        break; // a field this version does not know is left for a later one
    }
  }
  return {
    name: entry.name,
    type: VARIATION_ITEM_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by; without it a world could
    // import these and never get them back out. `read` is the figures the page
    // gave, so a reader can tell a Judge's later edit from the import's own.
    flags: { [MODULE_ID]: { cookbook: { id, cite, ...bookStamp(entry.book), read: { deltas: { ...deltas }, cost: { ...cost } } } } },
    system: {
      key: meta.key ?? "",
      kind: meta.variationKind ?? "",
      appliesTo: meta.appliesTo ?? [],
      supersedes: meta.supersedes ?? [],
      ...(Object.keys(deltas).length ? { deltas } : {}),
      ...(Object.keys(cost).length ? { cost } : {}),
      // What this variation records about itself, and the specs to read it by.
      // `dataFields` is the SHAPE and ships from the register; `data` is the
      // page's numbers and does not.
      ...(Object.keys(data).length ? { data } : {}),
      ...(meta.dataFields?.length ? { dataFields: meta.dataFields } : {}),
      ...(Object.keys(data).length ? { data } : {}),
      ...(meta.dataFields ? { dataFields: meta.dataFields } : {}),
      source: { book: entry.book ?? "rr", cite, ref: id },
      description: entryText(node, id, cite),
    },
  };
}

/**
 * Import the published variations, one document per purchasable difference.
 *
 * Guarded twice for the same two reasons the traps are: a player pressing a GM
 * macro would mint a second set, and a world that has not registered the
 * variation sub-type has no data model to put them in.
 *
 * `repair`, a tally, writes each entry this world already holds over its
 * document in place (`REPAIR.variation`) instead of passing over it.
 */
export async function importVariations({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[VARIATION_ITEM_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | the variation item type is not registered in this world.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  const passed = passedOver();
  for (const [id, entry] of variationEntries()) {
    if (only && !only.has(id)) continue;
    const have = await importedItem(id);
    if (have) {
      skipped++;
      if (repair) countRepair(repair, await repairFromEntry(have, id, (node) => bindVariation(entry, node, id), REPAIR.variation, repair));
      continue;
    }
    const doc = await claimImport(id, async () => {
      const { node, reason } = await readForImport(id);
      if (!node) return passed.count(reason);
      const folder = (await ensureItemFolder(id))?.id ?? null;
      return createDoc(Item, { ...bindVariation(entry, node, id), folder });
    });
    if (doc) made.push(doc);
  }
  ui.notifications?.info(
    `${MODULE_ID} | variations: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}${passed.clause}.`,
  );
  return made;
}

/**
 * Where one printed level begins.
 *
 * The book sets each tier as "1st level:" inside one flowed paragraph, so the
 * split is the book's OWN numbering rather than a reading of what the sentence
 * means — the same kind of structural split `parseEquipment` makes on a
 * starting-equipment cell. The ordinal is a superscript run in the PDF and
 * survives extraction, so it anchors the split; the digit is what is captured,
 * because that is the level being stated.
 */
const TIER_RE = /(\d)\s*(?:st|nd|rd|th)\s*level\s*:\s*/gi;

/** First dice expression in a tier's sentence, or "" — the frozen `dice` shape. */
const TIER_DICE = /\b\d+d\d+(?:\s*[+-]\s*\d+)?\b/;

/**
 * Split a trap's materialized description into the part that describes the trap
 * and the six that describe its levels.
 *
 * Everything before the first tier marker is the trap; each marker opens a
 * level and runs to the next. A trap whose text carries no marker at all yields
 * six empty rows and keeps the whole passage as the description, which is the
 * right answer for a book that phrased one differently — nothing is dropped and
 * nothing is invented.
 *
 * @param {string[]} blocks the `text` op's paragraphs, in reading order
 * @returns {{description: string, levels: object[]}}
 */
export function splitTrapTiers(blocks = []) {
  const whole = blocks.map((b) => String(b ?? "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
  const marks = [...whole.matchAll(TIER_RE)];
  const levels = Array.from({ length: TRAP_LEVELS }, () => ({ text: "", damageFormula: "" }));
  if (!marks.length) return { description: whole, levels };

  const description = whole.slice(0, marks[0].index).trim();
  for (let i = 0; i < marks.length; i++) {
    const level = Number(marks[i][1]);
    if (!Number.isFinite(level) || level < 1 || level > TRAP_LEVELS) continue;
    const from = marks[i].index + marks[i][0].length;
    const text = whole.slice(from, marks[i + 1]?.index ?? whole.length).trim();
    // A book that states a level twice gets the LAST word, not a concatenation:
    // rewriting is what a reprint does, and two half-sentences would be neither.
    levels[level - 1] = { text, damageFormula: TIER_DICE.exec(text)?.[0]?.replace(/\s+/g, "") ?? "" };
  }
  return { description, levels };
}

/**
 * Build one `acks-extras.trap` from a trap entry and its materialized text.
 * Only two things are read out of the seat's prose: the tier split (the
 * book's own numbering) and the damage dice. Everything a Judge would have
 * to judge — the throw type, which save, the effect's reach — is left at its
 * default with the printed sentence sitting beside it on the sheet.
 */
export function bindTrap(entry, node, id) {
  const cite = entry.cite ?? "";
  const blocks = (node?.fields?.description ?? []).map((p) => (typeof p === "string" ? p : (p?.text ?? "")));
  const { description, levels } = splitTrapTiers(blocks);
  return {
    name: entry.name,
    type: TRAP_ITEM_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by; without it a world could
    // import these and never get them back out.
    flags: { [MODULE_ID]: { cookbook: { id, cite, ...bookStamp(entry.book) } } },
    system: {
      source: { book: entry.book ?? "jj", cite, ref: id },
      // The passage that precedes the first tier is the trap's description;
      // the plain split above is what fills the rows.
      description: bookText([description], cite, { id, book: entry.book, page: entry.pages?.[0] }),
      level: 1,
      levels: levels.map((row) => ({ text: row.text, damageFormula: row.damageFormula })),
    },
  };
}

/**
 * Import the printed traps, one document per trap, all six levels on it.
 *
 * Guarded twice, for the two ways this fails without one: a player pressing a
 * GM macro would mint a second set of thirteen, and a world that has not
 * registered the trap sub-type has no data model to put them in.
 *
 * `repair`, a tally, writes each entry this world already holds over its
 * document in place (`REPAIR.trap`) instead of passing over it.
 */
export async function importTraps({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[TRAP_ITEM_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | the trap item type is not registered in this world.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  const passed = passedOver();
  for (const [id, entry] of trapEntries()) {
    if (only && !only.has(id)) continue;
    const have = await importedItem(id);
    if (have) {
      skipped++;
      if (repair) countRepair(repair, await repairFromEntry(have, id, (node) => bindTrap(entry, node, id), REPAIR.trap, repair));
      continue;
    }
    const doc = await claimImport(id, async () => {
      const { node, reason } = await readForImport(id);
      if (!node) return passed.count(reason);
      const folder = (await ensureItemFolder(id))?.id ?? null;
      return createDoc(Item, { ...bindTrap(entry, node, id), folder });
    });
    if (doc) made.push(doc);
  }
  ui.notifications?.info(
    `${MODULE_ID} | traps: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}${passed.clause}.`,
  );
  return made;
}

/**
 * Build one core `spell` Item from a spell entry and its materialized text.
 * The stat block the seat read is parsed into the primitive (`spell-logic.mjs`
 * `spellFromStat`), core's own strings are written from it, and the prose
 * becomes the description. A heading that ends in the reversal marker makes
 * the spell reversible, and the reverse's name is read off the prose where it
 * states one. A row anchored by hash names the document from the heading the
 * seat read; with the book closed it keeps the row's numbered label.
 */
export function bindSpell(entry, node, id) {
  const cite = entry.cite ?? "";
  const heading = node?.fields?.name ?? {};
  const printed = (typeof heading.title === "string" && heading.title) || entry.name || "";
  const marker = /\*\s*$/.test(entry.anchor?.subheading ?? "") || /\*\s*$/.test(heading.found ?? "");
  const paras = (node?.fields?.description ?? []).map((p) => (typeof p === "string" ? p : (p?.text ?? ""))).filter(Boolean);
  const built = spellFromStat(parseStatBlock(typeof node?.fields?.stat === "string" ? node.fields.stat : ""));
  const extras = {
    ...built,
    reversible: marker,
    reversedName: marker ? reversedNameFrom(paras.join(" ")) : "",
    cite,
  };
  return {
    name: printed.replace(/\*\s*$/, "").trim(),
    type: SPELL_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by; without it a world could
    // import these and never get them back out.
    flags: { [MODULE_ID]: { cookbook: { id, cite, ...bookStamp(entry.book) }, [FLAG_SPELL]: extras } },
    system: {
      ...coreFieldsFrom(extras),
      description: bookText(paras, cite, { id, book: entry.book, page: entry.pages?.[0] }),
    },
  };
}

/**
 * Import the printed spells, one core spell Item per printed entry, its stat
 * block on the primitive and its prose as the description. GM only: a player
 * pressing the control would mint a second set.
 *
 * `repair`, a tally, writes each entry this world already holds over its
 * document in place (`REPAIR.spell`) instead of passing over it.
 */
export async function importSpells({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const made = [];
  let skipped = 0;
  const passed = passedOver();
  for (const [id, entry] of spellEntries()) {
    if (only && !only.has(id)) continue;
    const have = await importedItem(id);
    if (have) {
      skipped++;
      if (repair) countRepair(repair, await repairFromEntry(have, id, (node) => bindSpell(entry, node, id), REPAIR.spell, repair));
      continue;
    }
    const doc = await claimImport(id, async () => {
      const { node, reason } = await readForImport(id);
      if (!node) return passed.count(reason);
      const folder = (await ensureItemFolder(id))?.id ?? null;
      return createDoc(Item, { ...bindSpell(entry, node, id), folder });
    });
    if (doc) made.push(doc);
  }
  ui.notifications?.info(
    `${MODULE_ID} | spells: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}${passed.clause}.`,
  );
  return made;
}
