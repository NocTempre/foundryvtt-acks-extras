/**
 * Cookbook runtime: equipment, vehicles, and the weapon and armour tables.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX, ITEM_TYPE } from "../constants.mjs";
import { bookText, entryText } from "../prose.mjs";
import { REPAIR, repairWrite, countRepair, unrepaired } from "../refresh.mjs";
import { BOOKS, citeFor, keptBook } from "../books.mjs";
import { executeEntry } from "../executor.mjs";
import { slugLabel } from "../table-extract.mjs";
import { pageItems } from "../extract.mjs";
import { WEAPON_TABLE, extractWeaponsFromDoc, bindWeaponRow, bindAmmoRow } from "../weapon-tables.mjs";
import { ARMOR_TABLE, extractArmorFromDoc, bindArmorRow } from "../armor-tables.mjs";
import { extractPriceMapFromDoc, extractPriceRowsFromDoc, priceFor, priceKey, capacityFor, PRICE_TABLES } from "../gear-prices.mjs";
import { progressBar } from "../progress.mjs";
import { priceStatedIn } from "../adventure-item-binding.mjs";
import { nameKeys, slug } from "../../lib/vocab.mjs";
import { VEHICLE_TYPE } from "../../vehicles/constants.mjs";
import { equipmentClass } from "../../equipment/profiles.mjs";
import { gearProfileFor } from "../../equipment/config.mjs";
import { annotateItem } from "../../equipment/api.mjs";
import { declaresSlots } from "../../lib/item-model.mjs";
import { ANIMAL_TYPE, FLAG_GEAR } from "../../lib/constants.mjs";
import {
  lineOfClaim, bookStamp, data, ctx, cookbookEntry, bookOf, vehicleEntries, SIXTHS_PER_STONE, canImportAnimals,
  isAnimalEntry, cookbookEquipmentIds,
} from "./state.mjs";
import { repairFromEntry, readForImport, passedOver } from "./read.mjs";
import {
  createDoc, rememberImported, claimImport, claimActorImport, importedDocs, importedItem, importedActor, actorFolderFor,
  ensureItemFolder, prepareItemShelves, libraryNameIndex, printedName,
} from "./target.mjs";
import { abilityIcon } from "./abilities.mjs";
import { weaponDamage } from "./monster.mjs";

/**
 * Does the document the library holds already say everything this import
 * would? DIRECTIONAL: only the keys the INCOMING data sets are checked,
 * against what the existing document holds for them — a live document's
 * `system` carries every schema field, defaults included, so comparing both
 * whole never matches. See docs/importer/DECISIONS.md, "Same name, two
 * books: merge unless they differ beyond their source".
 */
function sameMaterial(existing, data) {
  if ((existing?.type ?? null) !== (data?.type ?? null)) return false;
  for (const [key, value] of Object.entries(data?.system ?? {})) {
    if (key === "description") continue;
    const held = foundry.utils.getProperty(existing.system ?? {}, key);
    if (JSON.stringify(held ?? null) !== JSON.stringify(value ?? null)) return false;
  }
  return true;
}

/** Cross-book overlaps settled by name since the last report. */
const overlaps = { merged: 0, tagged: 0 };

/** Log what a run settled across books by name, once, and start the count again. */
function reportOverlaps() {
  const { merged, tagged } = overlaps;
  overlaps.merged = 0;
  overlaps.tagged = 0;
  if (merged || tagged) {
    console.info(`${MODULE_ID} | across books: ${merged} item(s) merged into the copy another book printed, ${tagged} tagged with their book.`);
  }
}

/**
 * Reconcile a document about to be imported against one the library already
 * holds under the same printed name. See docs/importer/DECISIONS.md, "Same
 * name, two books: merge unless they differ beyond their source". Merging
 * records the loser's id on the kept document rather than skipping silently,
 * so a merged-away id still resolves on a later run.
 *
 * @returns {Promise<{skip: true, doc: object} | {skip: false, name?: string}>}
 *   `skip` when the library already answers for this entry; otherwise the name
 *   to create it under, which is the printed one unless a tag was needed.
 */
async function reconcileByName(data, id, bookId) {
  if (!data?.name) return { skip: false };
  const keys = nameKeys(data.name);
  if (!keys.size) return { skip: false };

  // Reads an INDEX rather than the library — see docs/importer/DECISIONS.md,
  // "Same name, two books: merge unless they differ beyond their source".
  const index = await libraryNameIndex();
  const candidates = new Set();
  for (const k of keys) for (const doc of index.get(k) ?? []) candidates.add(doc);

  for (const other of candidates) {
    const otherId = other.getFlag(MODULE_ID, "cookbook")?.id;
    if (!otherId || otherId === id) continue;

    const otherBook = other.getFlag(MODULE_ID, "cookbook")?.book ?? bookOf(cookbookEntry(otherId));
    // Never across LINES.
    // See docs/importer/DECISIONS.md, "Reconciling is a claim about one game's library".
    if (lineOfClaim(otherId, otherBook) !== lineOfClaim(id, bookId)) continue;
    if (sameMaterial(other, data)) {
      // The same item, printed twice. Keep the printing `keptBook` names and
      // teach it this id; if it is THIS book's, the kept document takes this
      // entry's name and content instead.
      const incomingWins = bookId !== otherBook && keptBook(bookId, otherBook) === bookId;
      const merged = new Set([...(other.getFlag(MODULE_ID, "cookbook")?.merged ?? []), incomingWins ? otherId : id]);
      await other.update({
        ...(incomingWins ? { name: data.name, system: data.system } : {}),
        [`flags.${MODULE_ID}.cookbook.merged`]: [...merged],
        ...(incomingWins ? { [`flags.${MODULE_ID}.cookbook.id`]: id, [`flags.${MODULE_ID}.cookbook.book`]: bookId } : {}),
      });
      rememberImported(id, other);
      overlaps.merged++;
      return { skip: true, doc: other };
    }

    // Different things that share a name. Both are kept and both are tagged,
    // because tagging only the newcomer leaves the reader guessing which book
    // the untagged one came from.
    const tag = (b) => BOOKS[b]?.short ?? b;
    if (otherBook && bookId && otherBook !== bookId) {
      const otherPrinted = printedName(other);
      if (!other.name.endsWith(`(${tag(otherBook)})`)) {
        await other.update({
          name: `${otherPrinted} (${tag(otherBook)})`,
          [`flags.${MODULE_ID}.cookbook.printed`]: otherPrinted,
        });
      }
      overlaps.tagged++;
      return { skip: false, name: `${data.name} (${tag(bookId)})`, printed: data.name };
    }
    return { skip: false }; // same book, same name: distinct entries the book itself separates
  }
  return { skip: false };
}

/* -------------------------------------------- */
/*  Vehicles (kind.vehicle → the vehicle actor) */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  Traps (kind.trap → acks-extras.trap)        */
/* -------------------------------------------- */


/** The vehicle ACTOR sub-type — the vehicles feature's own constant, not an item. */
const VEHICLE_ACTOR_TYPE = VEHICLE_TYPE;

/**
 * "60’/30’" → [60, 30]; "12 / 6" → [12, 6]; "80" → [80].
 *
 * A segment carrying no digit yields NOTHING rather than zero. The table
 * prints "By creature" where a howdah's pace belongs, and an absent cell is
 * absent; reading either as 0 would give a vehicle a capacity of nought and a
 * speed of nought, both of which look like facts read off the page.
 */
const printedPair = (cell) =>
  String(cell ?? "")
    .split("/")
    .map((s) => String(s).replace(/[^\d.]/g, ""))
    .filter((s) => s !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n));

/**
 * One printed row of the vehicle table as an `acks-extras.vehicle`. A
 * movement/cargo pair becomes speed TIERS (normal encumbrance, then heavy);
 * a cargo figure in parentheses fills `cargo.passengers` instead (the
 * howdahs, whose pace is the creature's and so get no speed tiers). The
 * draft team is not read from this table.
 * See docs/importer/DECISIONS.md, "The vehicle table's pairs are speed tiers, and a howdah's cargo is a passenger count".
 */
export function bindVehicleRow(row, entry, id) {
  if (entry?.meta?.kindOfVehicle === "sea") return bindSeaVesselRow(row, entry, id);
  const cells = row?.cells ?? {};
  // Presentation only: the table sets each row's first letter as a small
  // capital, which extracts lowercase ("cart, Large"), and a comma at a line
  // break loses its following space ("Howdah,riding"). Neither is content.
  const label = String(row?.label ?? "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
  const cargoRaw = String(cells.cargo ?? "").trim();
  const trades = /^\(.*\)$/.test(cargoRaw);
  const cargo = printedPair(cargoRaw);
  const speeds = printedPair(cells.movement);
  const crewRaw = String(cells.crew ?? "").trim();

  const roles = [];
  let passengers = 0;
  const orChoice = /^(\d+)\s*or\s*(\d+)$/i.exec(crewRaw);
  const plus = /^(\d+)\s*\+\s*(\d+)$/.exec(crewRaw);
  if (orChoice) passengers = Number(orChoice[1]);
  else if (plus) {
    roles.push({ key: "driver", label: "Driver", required: Number(plus[1]), aboard: 0, motive: true });
    roles.push({ key: "warriors", label: "Warriors", required: Number(plus[2]), aboard: 0, motive: false });
  } else if (/^\d+$/.test(crewRaw)) {
    roles.push({ key: "driver", label: "Driver", required: Number(crewRaw), aboard: 0, motive: true });
  }

  const tiers = cargo
    .map((maxLoadStone, i) => ({ maxLoadStone, feetPerTurn: speeds[i] ?? speeds[0] ?? 0, team: 0 }))
    .filter((t) => t.maxLoadStone > 0);

  return {
    name: label,
    type: VEHICLE_ACTOR_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by. A row claims its own id
    // so removal is per vehicle, matching how they were created.
    flags: { [MODULE_ID]: { cookbook: { id: `${id}.${rowClaimKey(row)}`, cite: entry.cite ?? "" } } },
    system: {
      kind: "land",
      source: { book: entry.book ?? "rr", cite: entry.cite ?? "", ref: id },
      description: bookText([], entry.cite ?? "", { id, book: entry.book, page: entry.pages?.[0] }),
      ...(cargo.length ? { cargo: { capacityStone: cargo[0], ...(passengers ? { passengers } : {}) } } : {}),
      ...(roles.length ? { crew: { roles } } : {}),
      ...(tiers.length && !trades ? { speeds: { tiers } } : {}),
      ...(Number.isFinite(Number(cells.ac)) ? { ac: Number(cells.ac) } : {}),
      ...(Number.isFinite(Number(cells.shp)) ? { shp: { value: Number(cells.shp), max: Number(cells.shp) } } : {}),
    },
  };
}

/**
 * One printed row of the Sea Vessels table as a sea `acks-extras.vehicle`.
 * Its conventions differ from the land table's: three crew columns are three
 * ROLE complements (sailors and rowers motive, marines not); four combat
 * speeds and two voyage speeds land on the schema's named sea fields rather
 * than tiers; cargo is a single figure, never a pair. A dash is an absent
 * cell, not a zero. A parenthesised marines figure binds as a bench (the
 * schema's `required` on a non-motive role), not extra manpower. Cost is not
 * read.
 * See docs/importer/DECISIONS.md, "The vehicle table's pairs are speed tiers, and a howdah's cargo is a passenger count".
 */
function bindSeaVesselRow(row, entry, id) {
  const cells = row?.cells ?? {};
  // Same presentation repairs as the land binder, plus one of its own: this
  // table prints Title Case after the comma ("Boat, Row") and the small-cap
  // R extracts lowercase. The land table genuinely prints lowercase there
  // ("Howdah, riding"), so the repair stays sea-side.
  const label = String(row?.label ?? "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase())
    .replace(/, ([a-z])/g, (_m, c) => `, ${c.toUpperCase()}`);
  const num1 = (cell) => {
    const v = printedPair(cell);
    return v.length ? v[0] : null;
  };

  const roles = [];
  const complement = (key, label_, cell, motive) => {
    const n = num1(cell);
    if (n != null && n > 0) roles.push({ key, label: label_, required: n, aboard: 0, motive });
  };
  complement("sailors", "Sailors", cells.sailors, true);
  complement("rowers", "Rowers", cells.rowers, true);
  complement("marines", "Marines", cells.marines, false);

  const speeds = {};
  const speed = (key, cell) => {
    const n = num1(cell);
    if (n != null) speeds[key] = n;
  };
  speed("oarSprint", cells.oarSprint);
  speed("oarCruise", cells.oarCruise);
  speed("oarSlow", cells.oarSlow);
  speed("sail", cells.sail);
  speed("voyageOar", cells.voyageOar);
  speed("voyageSail", cells.voyageSail);

  const cargo = num1(cells.cargo);
  const shp = num1(cells.shp);
  return {
    name: label,
    type: VEHICLE_ACTOR_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    flags: { [MODULE_ID]: { cookbook: { id: `${id}.${rowClaimKey(row)}`, cite: entry.cite ?? "" } } },
    system: {
      kind: "sea",
      source: { book: entry.book ?? "rr", cite: entry.cite ?? "", ref: id },
      description: bookText([], entry.cite ?? "", { id, book: entry.book, page: entry.pages?.[0] }),
      ...(cargo != null ? { cargo: { capacityStone: cargo } } : {}),
      ...(roles.length ? { crew: { roles } } : {}),
      ...(Object.keys(speeds).length ? { speeds } : {}),
      ...(Number.isFinite(Number(cells.ac)) ? { ac: Number(cells.ac) } : {}),
      ...(shp != null ? { shp: { value: shp, max: shp } } : {}),
    },
  };
}

/**
 * What makes one table ROW distinct from its neighbours, for the dedup claim.
 *
 * NOT the grid's own row key, which is `slugLabel` of the label and therefore
 * drops the parenthetical: two cart rows differing only in the team named
 * in parentheses (RR pp. 134, 151, 161) both slug to one key, and a claim on that silently skips the second as
 * already imported. The table distinguishes those rows ONLY by the
 * parenthetical — it is the team, and it is what changes the cargo — so the
 * claim is folded from the whole printed label.
 */
export const rowClaimKey = (row) =>
  String(row?.label ?? row?.key ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || String(row?.key ?? "row");

/**
 * Import the printed vehicles, one ACTOR per table row.
 *
 * Unlike every other binding here this makes actors, because a vehicle is one:
 * it carries an inventory, a crew and a token. The dedup claim is per ROW and
 * not per entry — one register entry covers the whole table, so claiming the
 * entry id would make a second run skip every remaining vehicle because the
 * first row already existed.
 *
 * `repair`, a tally (`repairTally`), writes each row this world already holds
 * over its vehicle in place (`REPAIR.vehicle`) instead of passing over it, and
 * counts into the tally; an entry whose book is not open here counts refused.
 */
export async function importVehicles({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  if (!CONFIG.Actor.dataModels?.[VEHICLE_ACTOR_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | the vehicle actor type is not registered in this world.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  for (const [id, entry] of vehicleEntries()) {
    if (only && !only.has(id)) continue;
    const found = cookbookEntry(id);
    const bookId = found ? bookOf(found) : null;
    const session = bookId ? ctx.sessionDocs.get(bookId) : null;
    const node = session ? await executeEntry(session.doc, found.cb, data.registers, id) : null;
    // Nothing to read: the book is not connected, or its page no longer matches.
    if (!node?.ok) {
      if (repair) countRepair(repair, session ? "no-match" : "book-closed");
      continue;
    }
    for (const grid of Object.values(node.fields?.grids ?? {})) {
      for (const row of grid?.rows ?? []) {
        const rowId = `${id}.${rowClaimKey(row)}`;
        const have = await importedActor(rowId, { copies: false });
        if (have) {
          skipped++;
          if (repair) countRepair(repair, await repairWrite(have, bindVehicleRow(row, entry, id), REPAIR.vehicle, repair));
          continue;
        }
        const doc = await claimActorImport(rowId, async () => {
          // The ACTOR rule, like every other actor importer — a vehicle asking
          // for an Item folder got an Item-typed folder for an Actor, and every
          // row ended up loose at the top of the Actors tree.
          const folder = (await actorFolderFor(id, found))?.id ?? null;
          return createDoc(Actor, { ...bindVehicleRow(row, entry, id), folder });
        });
        if (doc) made.push(doc);
      }
    }
  }
  ui.notifications?.info(
    `${MODULE_ID} | vehicles: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}.`,
  );
  return made;
}


/* -------------------------------------------- */
/*  Equipment                                   */
/* -------------------------------------------- */

/**
 * The core item type an equipment entry becomes, from the register's own
 * group rather than a name scan. `animal` is deliberately NOT here: a mule
 * is a creature, not a thing, and imports as an actor. See importEquipment.
 */
const EQUIPMENT_TYPE = Object.freeze({
  weapon: "weapon",
  armor: "armor",
  shield: "armor", // the system models a shield as armour with type "shield"
});

/** The core item type for an entry, defaulting to plain inventory. */
export const equipmentTypeOf = (entry) => EQUIPMENT_TYPE[entry?.meta?.group] ?? "item";

/**
 * The numbers a `values` recipe located in the seat's own prose, as the flat
 * fields the binding reads (`aac`, `cost`, `weight6`). The recipe names the
 * field AND the unit the page states it in — encumbrance prints in stone or
 * in items, and `weight6` counts sixths of a stone — so this only converts
 * units, never values. A field this version does not know is skipped rather
 * than guessed at.
 */
export function locatedValues(node) {
  const out = {};
  for (const found of node?.fields?.values ?? []) {
    const amount = Number(found?.amount);
    if (!Number.isFinite(amount)) continue;
    switch (found.field) {
      case "aac":
      case "cost":
      case "weight6":
        out[found.field] = amount;
        break;
      case "weight6.stone":
        out.weight6 = amount * SIXTHS_PER_STONE;
        break;
      case "weight6.item":
        // An "item" IS the sixth-stone unit: the page's count is already the
        // number the schema wants.
        out.weight6 = amount;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Bind an equipment entry to the core item it should become. Mirrors
 * bindAbility's posture: the cookbook pre-declares NOTHING the page says —
 * name + citation always; the descriptor text is whatever the page yielded;
 * cost and weight materialize only when a chef-authored locator lands on the
 * register row (none ship yet, so they default to core's 0 and the printed
 * table governs — the entry says so via its unaudited marker).
 *
 * The TYPE-SPECIFIC fields follow the same rule. A weapon's damage and an
 * armour's AC are page values: absent a locator that read them from the seat's
 * own book, the item is created with the system's defaults and the printed
 * table governs. What the type buys even with nothing extracted is the
 * behaviour — a weapon can be equipped, attacks, and takes a fighting style;
 * armour can be worn and counts toward AC — which an `item` never could.
 */
export function bindEquipment(entry, node, id) {
  const cite = entry.cite ?? "";
  const meta = entry.meta ?? {};
  const f = { ...(node?.fields ?? {}), ...locatedValues(node) };
  let type = equipmentTypeOf(entry);

  // EQUIPMENT ROOT. The equipment feature owns the rule mapping a gear NAME to
  // the core item type and stats it should carry; the rules live there and are
  // never baked here. With no class for the name, the register's own type
  // stands. See docs/equipment/DECISIONS.md, "The equipment root".
  const klass = equipmentClass(entry.name) ?? null;
  if (klass?.type) type = klass.type;

  // Fields that exist only on the chosen type. `item` keeps subtype/quantity;
  // weapon and armor have neither and would fail validation if handed them.
  const typed = {};
  if (type === "item") {
    typed.subtype = meta.subtype === "clothing" ? "clothing" : "item";
    typed.quantity = { value: 1, max: 0 };
  } else if (type === "weapon") {
    // Prefer a page-extracted value; fall back to the equipment root's RAW stat
    // for gear the weapons table never listed (a torch's 1d4 is a rule, not a
    // table cell). melee/missile likewise.
    const damage = f.damage ?? (klass?.damage || undefined);
    if (damage) typed.damage = weaponDamage(damage);
    if (Number.isFinite(f.bonus)) typed.bonus = { attack: f.bonus, damage: 0 };
    const melee = typeof f.melee === "boolean" ? f.melee : klass?.melee;
    const missile = typeof f.missile === "boolean" ? f.missile : klass?.missile;
    if (typeof melee === "boolean") typed.melee = melee;
    if (typeof missile === "boolean") typed.missile = missile;
    if (f.range) typed.range = f.range;
    // NB: a weapon-torch is a SINGLE wielded torch — core weapons carry no
    // `quantity` field, so it cannot be a stack. It is "consumable" only in that
    // it burns out on its timer (the formation feature). A supply of torches is a
    // stackable `item`, which keeps its quantity and decrements when lit.
  } else if (type === "armor") {
    // The recipe's field is still spelled `aac`; the system's is `ac`.
    if (Number.isFinite(f.aac)) typed.ac = { value: f.aac };
    // The system's armour `type` choices are unarmored/veryLight/light/medium/
    // heavy/shield. A shield entry is that type by definition; anything else
    // waits for the page to say so rather than being guessed from its weight.
    if (meta.group === "shield") typed.type = "shield";
    else if (f.armorType) typed.type = f.armorType;
  }

  // What the extras layer is told about the document, in ITS scope (see the flags
  // block below). A shield FORM is one of these: the register names which form
  // the entry is, the overlay owns what the form does, and the item carries the
  // ordinary AC its own page states so the overlay has something to correct.
  const extras = {
    ...(klass?.light ? { light: true } : {}),
    ...(meta.shieldVariant ? { shieldVariant: meta.shieldVariant } : {}),
  };

  return {
    name: entry.name,
    type,
    img: abilityIcon(entry),
    system: {
      description: entryText(node, id, cite),
      ...typed,
      // Page values — present only when a locator materialized them from the
      // seat's own book. Absent locators leave core's defaults.
      ...(Number.isFinite(f.cost) ? { cost: f.cost } : {}),
      ...(Number.isFinite(f.weight6) ? { weight6: f.weight6 } : {}),
    },
    flags: {
      [MODULE_ID]: {
        // Our own provenance: bookkeeping for re-import, update and prune.
        cookbook: { id, cite, unaudited: !entry.audited, ...bookStamp(entry.book) },
        minted: true,
        // These markers are equipment's, not ours — it writes the SAME markers
        // in this scope (the light when it readies a torch, in
        // equipment/actions.mjs; the shield form when a Judge picks one off
        // the item sheet) and its sheets, overlays and formation layers read
        // them from here. Omitting them would leave an imported torch
        // invisible to both, and an imported shield form a plain shield. The
        // rule of WHICH names are lights is the equipment root's and WHAT a
        // form does is the overlay's; we only record the verdict.
        ...extras,
      },
    },
  };
}

/**
 * What a printed animal name says the creature is trained for.
 *
 * The RR prices animals BY ROLE, a species followed by a comma and a
 * qualifier (RR p. 130), so the qualifier in the name the book
 * printed IS its statement of training, and the words it uses are the same
 * set `ANIMAL_TRAINING` enumerates. Reading a qualifier out of a
 * name the seat's own book supplied is extraction like any other: no roster of
 * animals and no rate is shipped here, only the name-form rule.
 */
export function trainingFromName(name) {
  const n = String(name ?? "").toLowerCase();
  if (/\bwar\b/.test(n)) return "war";
  if (/\briding\b/.test(n)) return "riding";
  if (/\bdraft\b|\bdraught\b/.test(n)) return "draft";
  if (/\bhunting\b/.test(n)) return "hunting";
  if (/\bherding\b|\bshepherd\b/.test(n)) return "herding";
  return null;
}

/** The species a printed animal name heads with: the text before the first comma, lowercased (RR p. 130). */
export const animalSpecies = (name) => String(name ?? "").split(",")[0].trim().toLowerCase();

/**
 * Which species the reader's book prices in a RIDING form.
 *
 * Training and mountability are different questions and the book answers them
 * differently: a war DOG is trained for war and is still not a mount. What the
 * page states is that some species are sold to be ridden — so a species with a
 * riding row is mountable in every form it is sold in, and one without is not
 * marked either way. Computed from the entries actually loaded, so it says
 * what THIS book prints.
 */
export function mountableSpecies(entries) {
  const out = new Set();
  for (const e of entries ?? []) {
    if (e?.meta?.group !== "animal") continue;
    if (trainingFromName(e.name) === "riding") out.add(animalSpecies(e.name));
  }
  return out;
}

/**
 * The loads an animal's own printed description states, in SIXTHS of a stone
 * (the family's one weight unit) — its normal and maximum load, read out of
 * the same prose already imported as the creature's description. An animal
 * whose book says nothing simply arrives unstated.
 */
export function loadsFromText(text) {
  const t = String(text ?? "").toLowerCase().replace(/\s+/g, " ");
  const grab = (re) => {
    const m = re.exec(t);
    return m ? Number(m[1]) : null;
  };
  const normal = grab(/normal load of ([\d,]+) stones?/);
  const max = grab(/maximum load of ([\d,]+) stones?/);
  const six = (st) => (st == null ? null : Math.round(st * 6));
  return { unencumbered6: six(normal), capacity6: six(max) };
}

/**
 * The land speed an animal's description states, in feet per turn — the
 * first of the printed pair, which is the exploration figure every other
 * speed in the family derives from.
 */
export function speedFromText(text) {
  const m = /speed of ([\d,]+)\s*[’']/.exec(String(text ?? "").replace(/\s+/g, " "));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** Every animal-group entry the loaded cookbooks hold. */
export function loadedAnimalEntries() {
  const out = [];
  for (const store of [data.books, data.content]) {
    for (const cb of store.values()) {
      for (const e of Object.values(cb.entries ?? {})) if (e?.meta?.group === "animal") out.push(e);
    }
  }
  return out;
}

/**
 * Bind an `animal` equipment entry to an ACTOR instead of an item — a
 * creature fights, can be attacked, has morale and can be ridden, none of
 * which an inventory item has.
 *
 * Needs the `acks-extras.animal` sub-type. Where the world has no actor
 * collection there is nowhere for a creature to go, so the entry stays an
 * item rather than failing the import; the caller decides.
 */
export function bindAnimal(entry, node, id, { ridable = null } = {}) {
  const cite = entry.cite ?? "";
  const f = node?.fields ?? {};
  // A field the book supplied always wins; the name-form rule fills the gap
  // the animal entries leave, so an imported war horse arrives FLAGGED rather
  // than defaulting to untrained and unridable.
  const training = f.training ?? trainingFromName(entry.name);
  // The creature's own printed description states what it carries and how
  // fast it goes; a field the book supplied directly still wins.
  const prose = entryText(node, id, cite);
  const loads = loadsFromText(prose);
  const six = (v) => (Number.isFinite(v) ? v / 6 : null);
  const normalSt = Number.isFinite(f.unencumbered6) ? six(f.unencumbered6) : six(loads.unencumbered6);
  const capacitySt = Number.isFinite(f.capacity6) ? six(f.capacity6) : six(loads.capacity6);
  const loadFlags = normalSt == null && capacitySt == null
    ? null
    : {
        ...(normalSt != null ? { normal: normalSt } : {}),
        ...(capacitySt != null ? { capacity: capacitySt } : {}),
      };
  const movement = Number.isFinite(f.movement) ? f.movement : speedFromText(prose);
  const species = animalSpecies(entry.name);
  const mountable = typeof f.mountable === "boolean"
    ? f.mountable
    : (ridable ?? mountableSpecies(loadedAnimalEntries())).has(species) || null;
  return {
    name: entry.name,
    type: ANIMAL_TYPE,
    img: abilityIcon(entry),
    system: {
      // ONE details object. Spreading a second `details` later would replace
      // this one wholesale and silently drop the citation.
      details: {
        biography: prose,
        ...(Number.isFinite(f.morale) ? { morale: f.morale } : {}),
      },
      animal: {
        species: entry.name,
        // Everything below is a PAGE VALUE: present only if the seat's book
        // supplied it. Nothing about an animal's price, load or speed ships.
        ...(Number.isFinite(f.cost) ? { cost: f.cost } : {}),
        ...(typeof mountable === "boolean" ? { mountable } : {}),
        ...(training ? { training } : {}),
      },
      ...(Number.isFinite(movement) ? { movement: { base: movement } } : {}),
    },
    flags: {
      [MODULE_ID]: {
        cookbook: { id, cite, unaudited: !entry.audited, ...bookStamp(entry.book) },
        minted: true,
        // A creature's carrying capacity has ONE live store — the one
        // `capacity6()` reads and the monster sheet edits — so the loads read
        // off this animal's own description are written there, in the stone
        // the page prints, rather than to the animal sub-type's like-named
        // fields, which nothing consumes.
        ...(loadFlags ? { extras: { load: loadFlags } } : {}),
      },
    },
  };
}

/**
 * Import one equipment entry, deduped by cookbook id.
 *
 * Most entries become world ITEMS. An animal becomes an ACTOR — a mule is a
 * creature you buy, not a thing you carry — provided the world can hold
 * actors (`canImportAnimals`). Where it cannot, the animal falls back to an item
 * rather than failing the import, so the shop list still arrives.
 *
 * An entry whose book is not open on this seat, or whose page no longer
 * matches, is passed over (`readForImport`) and counted into `passed`, a
 * `passedOver` tally, where one is given; nothing is created from the entry's
 * shape alone.
 *
 * `repair`, a tally, writes the entry over a document this world already
 * holds for it, in place (`repairEquipment`), instead of returning it as is.
 */
export async function importEquipment(id, folderId, { repair = null, passed = null } = {}) {
  const found = cookbookEntry(id);
  if (!found) return null;

  const asActor = isAnimalEntry(found.entry) && canImportAnimals();
  // Ask the compendium imports actually land in, never `game.items`/
  // `game.actors` directly. An animal is an ACTOR, so it is asked of the
  // actor side of the same target.
  const existing = asActor ? await importedActor(id, { copies: false }) : await importedItem(id);
  if (existing) {
    if (unrepaired(repair, existing)) countRepair(repair, await repairEquipment(existing, id, asActor, repair));
    return existing;
  }

  const build = async () => {
    const { node, reason } = await readForImport(id);
    if (!node) passed?.count(reason);
    return node;
  };

  if (asActor) {
    const node = await build();
    if (!node) return null;
    // The one actor destination rule (actorFolderFor → the "Animals" home).
    const folder = (await actorFolderFor(id, found))?.id ?? null;
    return createDoc(Actor, { ...bindAnimal(found.entry, node, id), folder });
  }

  return claimImport(id, async () => {
    const node = await build();
    return node ? importEquipmentItem(found, id, folderId, node) : null;
  });
}

/**
 * Write one equipment entry over the document this world holds for it. A
 * document another book's printing was merged into answers for its OWN entry
 * (`cookbook.id`), so it is rebuilt from that one, never from the id it
 * absorbed. Resolves to `refreshImported`'s plan, or to why nothing was written.
 */
async function repairEquipment(doc, id, asActor, tally = null) {
  const own = doc.getFlag(MODULE_ID, "cookbook")?.id ?? id;
  const found = cookbookEntry(own);
  if (!found) return "no-match";
  if (asActor) return repairFromEntry(doc, own, (node) => bindAnimal(found.entry, node, own), REPAIR.animal, tally);
  return repairFromEntry(doc, own, (node) => buildEquipmentItem(found, own, node), REPAIR.equipment, tally);
}

/** Build and create the ITEM half of an equipment import (the claimed body). */
async function importEquipmentItem(found, id, folderId, node) {
  const folder = folderId ?? (await ensureItemFolder(id))?.id ?? null;
  const doc = await buildEquipmentItem(found, id, node);
  // Two books printing one thing is ONE document (see reconcileByName): merge
  // when nothing but the source differs, tag both when something does.
  const verdict = await reconcileByName(doc, id, bookOf(found));
  if (verdict.skip) return verdict.doc;
  const item = await createDoc(Item, {
    ...doc,
    folder,
    ...(verdict.name
      ? {
          name: verdict.name,
          flags: foundry.utils.mergeObject(doc.flags ?? {}, { [MODULE_ID]: { cookbook: { printed: verdict.printed } } }, { inplace: false }),
        }
      : {}),
  });
  // The equipment feature owns the RAW annotation layer (container capacities,
  // the harness, the bowquiver). Its profiles key off the printed name, so a
  // generated item annotates exactly like a core one. Reuse, never restate.
  try {
    await annotateItem(item);
  } catch (err) {
    console.warn(`${MODULE_ID} | equipment annotation skipped for ${item?.name}`, err);
  }
  return item;
}

/**
 * The creation data for one equipment ITEM: the binding, then the page values
 * the price grids and the entry's own paragraphs supply. Everything an import
 * does except deciding where the document goes and writing it, so a repair
 * builds exactly what an import would.
 */
async function buildEquipmentItem(found, id, node) {
  const doc = bindEquipment(found.entry, node, id);
  // Enrich gear/clothing with cost/weight from the RR price grids (p131/p132),
  // materialized per-seat. A general category with several priced variants
  // stays unpriced (priceFor returns null) rather than take a guessed variant.
  if (["gear", "clothing"].includes(found.entry.meta?.group)) {
    const priced = priceFor(await gearPriceMap(), found.entry.name);
    if (priced?.cost != null) doc.system.cost = priced.cost;
    if (priced?.weight6 != null) doc.system.weight6 = priced.weight6;
    const held = capacityFor(priced, found.entry.name);
    if (held != null) withCapacity(doc, held);
  }
  // What the grids do not price, the entry's own paragraphs often do — the
  // "Cost: 25gp" run-in, a stated stone weight, a stated damage die (the BTA
  // dwarven chapter prints all three in prose). Page values, per seat.
  if (node?.fields?.description) {
    const prose = node.fields.description.map((p) => p.text ?? "").join(" ");
    if (!doc.system.cost) {
      const stated = priceStatedIn(prose);
      if (stated != null) doc.system.cost = stated;
    }
    if (!doc.system.weight6) {
      const m = /weighs?\s+(?:about\s+)?(a half|half a|one|an|a|two|three|four|five|six|\d+(?:\/\d+)?)\s*stones?/i.exec(prose);
      if (m) {
        const words = { "a half": 0.5, "half a": 0.5, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
        const raw = m[1].toLowerCase();
        const w = words[raw] ?? (raw.includes("/") ? Number(raw.split("/")[0]) / Number(raw.split("/")[1]) : parseFloat(raw));
        if (Number.isFinite(w) && w > 0) doc.system.weight6 = w * 6;
      }
    }
    if (doc.type === ITEM_TYPE.WEAPON && !doc.system.damage) {
      const m = /deal(?:s|ing)?\s+(\d+d\d+(?:\s*[+-]\s*\d+)?)/i.exec(prose);
      if (m) doc.system.damage = m[1].replace(/\s+/g, "");
    }
  }
  return doc;
}

/**
 * Bulk import: every equipment entry, shared folder, dedup via importEquipment.
 * `repair`, a tally, writes each entry this world already holds over its
 * document in place instead of passing over it (`importEquipment`), and
 * `repair.tables`, a set of `weapons`, `armor` and `priced`, names the printed
 * tables it writes over as well.
 */
export async function importAllEquipment({ only = null, repair = null } = {}) {
  // Same reason as importClasses: the macro says "(GM)" but every seat can run
  // it, and a player who does adds a second shop list to the world.
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const ids = cookbookEquipmentIds().filter((id) => !only || only.has(id));
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressEquipment`), ids.length);
  let created = 0;
  let animals = 0;
  const passed = passedOver();
  try {
    await prepareItemShelves();
    const folder = null; // per-id shelf
    for (const id of ids) {
      const entry = cookbookEntry(id)?.entry;
      // An animal lands in the ACTOR collection, so "was it already here?" has
      // to be asked of the collection it actually goes to — asked of items, an
      // imported animal looks new on every run and the count lies. Asked of the
      // WORLD while imports go to a compendium, everything looks new and the
      // count lies the same way.
      const asActor = isAnimalEntry(entry) && canImportAnimals();
      const before = asActor ? await importedActor(id, { copies: false }) : await importedItem(id);

      const doc = await importEquipment(id, folder, { repair, passed });
      if (doc && !before) {
        created++;
        if (asActor) animals++;
      }
      bar.step(entry?.name ?? id);
    }
  } finally {
    bar.finish();
  }
  if (passed.lines.length) ui.notifications?.info(`${MODULE_ID} | equipment: ${passed.lines.join("; ")}.`);
  const over = { closed: passed.closed, unmatched: passed.unmatched };
  // The weapon, armour and price TABLES are no entry's, so a pass narrowed to
  // entries reaches only the tables its repair tally names (`tally.tables`, set
  // by the shelf or book repair that owns them); a whole import reaches all three.
  const tables = repair ? (repair.tables ?? new Set()) : only ? new Set() : new Set(["weapons", "armor", "priced"]);
  const weapons = tables.has("weapons") ? await importWeapons(undefined, { repair }) : null;
  const armor = tables.has("armor") ? await importArmor(undefined, { repair }) : null;
  // Last: it asks which price rows the entries above already claim, so it has
  // to run after they have had their chance at them.
  const priced = tables.has("priced") ? await importPricedGear(undefined, { repair }) : null;
  reportOverlaps();
  return { total: ids.length, created, animals, passed: over, weapons, armor, priced };
}


/* -------------------------------------------- */
/*  Weapon / armour TABLES → items (per-seat)   */
/* -------------------------------------------- */

/** camelCase cookbook id for a table-materialized weapon. */
const weaponId = (name) => `def.weapon.${slugLabel(name).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;

/**
 * Materialize the RR weapons TABLE into `weapon` items from the reader's own
 * book — the clean-break pipeline (see weapon-tables.mjs). Unlike the run-in
 * gear cookbook, a grid has no prose of its own, so a bookless seat gets
 * nothing here. Deduped by cookbook id; each item carries its full set of
 * attack/damage modes (weapon-tables `damageModes`), which the core
 * compendium could not express and split into separate items instead.
 * `repair`, a tally (`repairTally`), writes each row this world already holds
 * over its document in place (`rewriteRow`) instead of passing over it.
 * @param {string} [folderId]
 * @param {{repair?: object|null}} [opts]
 * @returns {Promise<{table:number, created:number}>}
 */
export async function importWeapons(folderId, { repair = null } = {}) {
  const session = ctx.sessionDocs.get(WEAPON_TABLE.book);
  if (!session?.doc) return { table: 0, created: 0, reason: "book not connected" };
  let rows;
  try {
    rows = await extractWeaponsFromDoc(session.doc, pageItems);
  } catch (err) {
    console.error(`${MODULE_ID} | weapon-table extraction failed`, err);
    return { table: 0, created: 0, reason: "extraction error" };
  }
  if (!rows.length) return { table: 0, created: 0, reason: "table not found in book" };
  const folder = folderId ?? (await ensureItemFolder("def.weapon."))?.id ?? null;
  let created = 0;
  // Which kind each row is cannot be asked here: the weapon rows are published
  // from the documents this loop makes, so before it ends every row would read
  // as unplaced. A row the lists cannot place says "not imported" on its own
  // sheet.
  for (const row of rows) {
    const id = weaponId(row.name);
    const cite = citeFor(WEAPON_TABLE.book, WEAPON_TABLE.page);
    // Whether an ammunition row names a carrying device is the equipment root's
    // question — it owns the gear profiles that answer it — so it is asked, not
    // restated here. A row the equipment root names no device for is a bare
    // stack, which is the shape that needs nothing of it.
    const build = () =>
      row.ammunition
        ? bindAmmoRow(row, id, cite, { device: !!gearProfileFor(row.name) })
        : bindWeaponRow(row, id, cite);
    const held = await importedItem(id);
    if (held) {
      await rewriteRow(held, build, row.ammunition ? REPAIR.ammunition : REPAIR.weapon, repair);
      continue;
    }
    const doc = build();
    const item = rememberImported(id, await createDoc(Item, { ...doc, folder }));
    // The RAW annotation layer belongs to the equipment feature, exactly as the gear
    // cookbook defers to it: a case rides on the belt and is free to draw from.
    if (row.ammunition) {
      try {
        await annotateItem(item);
      } catch (err) {
        console.warn(`${MODULE_ID} | equipment annotation skipped for ${item?.name}`, err);
      }
    }
    created++;
  }
  return { table: rows.length, created };
}

/** camelCase cookbook id for a table-materialized armour item. */
const armorId = (name) => `def.armor.${slugLabel(name).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;

/**
 * Cookbook id for an item materialized from a printed price row.
 *
 * Folds the WHOLE printed name, parenthetical included — `slugLabel` drops it,
 * and it is exactly what tells two rows of one thing apart (two rows of one
 * item differing only in the material named in parentheses; RR p. 129). The same distinction `rowClaimKey` keeps
 * for a vehicle whose team is its only difference.
 */
const pricedId = (name) =>
  `def.priced.${String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "row"}`;

/**
 * The core item subtype a printed price SECTION corresponds to, defaulting
 * to plain inventory. A described entry gets this from the register
 * (`bindEquipment`); a grid row has no entry, so the heading it was printed
 * under is the page's own answer. Which headings mean something is asked of
 * the SYSTEM's subtype vocabulary, by key and by localized label alike, so
 * no name off the page is written down here.
 * See docs/importer/DECISIONS.md, "A grid row is what the SECTION above it says, not what its name looks like".
 */
function subtypeForSection(section) {
  const want = slug(section);
  if (!want) return "item";
  for (const [key, label] of Object.entries(CONFIG.ACKS?.item_subtypes ?? {})) {
    if (slug(key) === want || slug(game.i18n?.localize?.(label) ?? label) === want) return key;
  }
  return "item";
}

/**
 * Write a table row's fresh build over the document this world holds for it,
 * under `policy`, and count it into `repair`. Nothing without a tally: an
 * import passes a held row over. `build` is called only when it writes.
 */
async function rewriteRow(held, build, policy, repair) {
  if (!repair || !unrepaired(repair, held)) return;
  countRepair(repair, await repairWrite(held, build(), policy, repair));
}

/**
 * The item a printed price row makes: the type the equipment root maps its
 * name to (plain inventory without it), the subtype its section heading names,
 * and its price and weight from the page.
 */
export function pricedDoc(row, id, cite) {
  // The equipment root owns the rule mapping a NAME to the item type it should
  // be, exactly as bindEquipment defers to it; a row it has no class for is
  // plain inventory.
  const klass = equipmentClass(row.name) ?? null;
  const type = klass?.type ?? "item";
  const subtype = subtypeForSection(row.section);
  const doc = {
    name: row.name,
    type,
    img: "icons/containers/bags/pouch-simple-brown.webp",
    system: {
      ...(type === "item" ? { subtype, quantity: { value: 1, max: 0 } } : {}),
      ...(row.cost != null ? { cost: row.cost } : {}),
      ...(row.weight6 != null ? { weight6: row.weight6 } : {}),
    },
    flags: { [MODULE_ID]: { cookbook: { id, cite }, minted: true } },
  };
  if (row.capacity != null) withCapacity(doc, row.capacity);
  return doc;
}

/**
 * Declare how much an item holds, in stone, where the page stated it: the
 * gear flag's `capacity`, the same field the item sheet's Construction tab
 * edits. Nothing is written for an item whose page states none.
 */
export function withCapacity(doc, stone) {
  const flags = (doc.flags[MODULE_ID] ??= {});
  flags[FLAG_GEAR] = { ...flags[FLAG_GEAR], capacity: stone };
  // The figure the page gave, beside the import's stamp, so a surface can tell
  // it from one a Judge typed or changed (`printed-layers.mjs` `capacitySource`).
  const cookbook = (flags.cookbook ??= {});
  cookbook.read = { ...cookbook.read, capacity: stone };
}

/**
 * Materialize the printed price rows that no cookbook entry of its own
 * claims. The gear cookbook is a list of things the book DESCRIBES; the
 * price grid is a list of things it SELLS, itemizing what a description
 * treats as one subject and pricing things no paragraph describes at all.
 *
 * A row an entry already resolves is left alone — that item exists and
 * carries the book's own description, which a grid row does not have.
 * Everything else becomes an item priced from the reader's own page.
 *
 * `repair`, a tally (`repairTally`), first writes each row this world already
 * made an item of over that item in place (`rewriteRow`).
 * @param {string} [folderId]
 * @param {{repair?: object|null}} [opts]
 */
export async function importPricedGear(folderId, { repair = null } = {}) {
  const session = ctx.sessionDocs.get(WEAPON_TABLE.book);
  if (!session?.doc) return { rows: 0, created: 0, reason: "book not connected" };
  let rows;
  try {
    rows = await extractPriceRowsFromDoc(session.doc, pageItems);
  } catch (err) {
    console.error(`${MODULE_ID} | price-row extraction failed`, err);
    return { rows: 0, created: 0, reason: "extraction error" };
  }
  if (!rows.length) return { rows: 0, created: 0, reason: "grid not found in book" };

  // A repair writes the rows this world already made items of; the loop below
  // then passes those over as claimed.
  if (repair) {
    const cite0 = citeFor(WEAPON_TABLE.book, PRICE_TABLES.gear.page);
    for (const row of rows) {
      const id = pricedId(row.name);
      const held = await importedItem(id);
      if (!held) continue;
      await rewriteRow(held, () => pricedDoc(row, id, cite0), REPAIR.priced, repair);
      // A row that declares no place to be worn is annotated; one that declares any — a Judge's, or Annotate's — keeps it.
      if (!declaresSlots(held)) await annotatePriced(held);
    }
  }

  // Exactly what priceFor resolves, asked once for the whole grid: a row is
  // claimed by an entry with its key, or by an entry whose key it alone
  // extends. A key several rows extend claims none of them — which is the
  // category whose variants this function is here to produce.
  const rowKeys = rows.map((r) => priceKey(r.name));
  const claimed = new Set();
  for (const id of cookbookEquipmentIds()) {
    const key = priceKey(cookbookEntry(id)?.entry?.name);
    if (!key) continue;
    if (rowKeys.includes(key)) claimed.add(key);
    else {
      const ext = rowKeys.filter((rk) => rk.startsWith(key) && rk.length > key.length);
      if (ext.length === 1) claimed.add(ext[0]);
    }
  }

  // And whatever the LIBRARY already holds, under either spelling — the loop
  // above only knows the equipment chapter's declared entries, not what the
  // weapon and armour tables mint from a grid at run time.
  // See docs/importer/DECISIONS.md, "One name has many printed forms, and the rule lives in lib".
  const libraryKeys = new Set();
  for (const doc of await importedDocs("Item")) for (const k of nameKeys(doc.name)) libraryKeys.add(k);
  rows.forEach((row, i) => {
    for (const k of nameKeys(row.name)) {
      if (libraryKeys.has(k)) {
        claimed.add(rowKeys[i]);
        break;
      }
    }
  });

  // Their own shelf under Equipment, beside the group shelves the described
  // entries file into. Dropped on the Equipment folder itself they sit loose
  // among those folders — a hundred-odd items with nothing holding them — and
  // they cannot join the group shelves either: a row's group is a fact the
  // register records about a described entry, and these rows have no entry.
  // Sorting them by the page they were printed on does not help, because the
  // clothing page carries the provisions and livestock too.
  const folder =
    folderId ?? (await ensureItemFolder("def.priced."))?.id ?? null;
  const cite = citeFor(WEAPON_TABLE.book, PRICE_TABLES.gear.page);
  let created = 0;
  const seen = new Set();
  for (const row of rows) {
    const key = priceKey(row.name);
    const id = pricedId(row.name);
    // Claiming asks the lookup key, which drops the parenthetical because a
    // reader looking a thing up does not type it. Deduping asks the id, which
    // keeps it — otherwise the second of two rows that differ ONLY by their
    // parenthetical is dropped as a repeat of the first.
    if (!key || claimed.has(key) || seen.has(id)) continue;
    seen.add(id);
    if (await importedItem(id)) continue;
    // The equipment root owns the rule mapping a NAME to the item type it
    // should be, exactly as bindEquipment defers to it; a row it has no class
    // for is plain inventory.
    const item = rememberImported(id, await createDoc(Item, { ...pricedDoc(row, id, cite), folder }));
    await annotatePriced(item);
    created++;
  }
  return { rows: rows.length, created };
}

/**
 * The equipment annotation layer over one price row, as the gear cookbook
 * runs it: where a garment is worn, what a pouch costs to reach into. A
 * template copy cut from the row carries the declaration with it.
 */
async function annotatePriced(item) {
  try {
    await annotateItem(item);
  } catch (err) {
    console.warn(`${MODULE_ID} | equipment annotation skipped for ${item?.name}`, err);
  }
}

/** The RR gear/clothing price map, built once per session from the reader's book. */
let _priceMap = null;
async function gearPriceMap() {
  if (_priceMap && _priceMap.size) return _priceMap;
  const session = ctx.sessionDocs.get(WEAPON_TABLE.book);
  if (!session?.doc) return new Map(); // bookless: gear stays unpriced
  try {
    _priceMap = await extractPriceMapFromDoc(session.doc, pageItems);
  } catch (err) {
    console.error(`${MODULE_ID} | gear price extraction failed`, err);
    _priceMap = new Map();
  }
  return _priceMap;
}

/**
 * Materialize the RR armour TABLE (suits, shields, helmets, barding) into
 * `armor` items from the reader's own book — the sibling of importWeapons.
 * AC, encumbrance and cost come from the seat's page; a bookless seat gets
 * nothing (a grid has no prose of its own). Deduped by cookbook id, into ACKS
 * Cookbook / Armor. `repair`, a tally (`repairTally`), writes each row this
 * world already holds over its document in place (`rewriteRow`).
 * @param {string} [folderId]
 * @param {{repair?: object|null}} [opts]
 * @returns {Promise<{table:number, created:number}>}
 */
export async function importArmor(folderId, { repair = null } = {}) {
  const session = ctx.sessionDocs.get(ARMOR_TABLE.book);
  if (!session?.doc) return { table: 0, created: 0, reason: "book not connected" };
  let rows;
  try {
    rows = await extractArmorFromDoc(session.doc, pageItems);
  } catch (err) {
    console.error(`${MODULE_ID} | armour-table extraction failed`, err);
    return { table: 0, created: 0, reason: "extraction error" };
  }
  if (!rows.length) return { table: 0, created: 0, reason: "table not found in book" };
  const folder = folderId ?? (await ensureItemFolder("def.armor."))?.id ?? null;
  let created = 0;
  for (const row of rows) {
    const id = armorId(row.name);
    const cite = citeFor(ARMOR_TABLE.book, ARMOR_TABLE.page);
    const held = await importedItem(id);
    if (held) {
      await rewriteRow(held, () => bindArmorRow(row, id, cite), REPAIR.armor, repair);
      continue;
    }
    rememberImported(id, await createDoc(Item, { ...bindArmorRow(row, id, cite), folder }));
    created++;
  }
  return { table: rows.length, created };
}
