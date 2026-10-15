/* global game, foundry */
/**
 * A character written into the Judge's own blank copy of the official form.
 *
 * Every box the character has a field for is read off the prepared actor, so
 * the sheet shows what is in force — Active Effects included — and not the
 * stored base. A box the character keeps no field for (the domain page, the
 * tick grids, birthplace, a weapon's initiative bonus) comes back from the
 * last import's record, so a sheet that went in comes out holding what it
 * held; so do the names it listed that the world could not answer. A table
 * with more rows than the form prints is cut, and the export names what was
 * left off.
 */
import { MODULE_ID } from "../../lib/constants.mjs";
import { ITEM_TYPE, slug } from "../../lib/vocab.mjs";
import { cookbookId } from "../../lib/library.mjs";
import { isAdventuring } from "../../classes/grants.mjs";
import { rollsOf, throwText } from "../../abilities/ability-rolls.mjs";
import { bestAttackBonus, getLoadout } from "../../equipment/loadout.mjs";
import { wearLocation } from "../../equipment/wear.mjs";
import { containedIn, isConcealed, isContainer } from "../../equipment/containers.mjs";
import { WEAR } from "../../equipment/config.mjs";
import { PDF_RECORD_FLAG as RECORD_FLAG } from "../constants.mjs";
import { saveSystemKey, henchmanIds } from "../snapshot.mjs";
import { signedText } from "./parse.mjs";
import { ADVENTURING_KEYS, COIN_KEYS, GEAR_PLACES, MOVE_KEYS, SAVE_BOOK_KEYS, SCORE_KEYS, SHEET_ROWS, buildPlan } from "./plan.mjs";
import { coinsHeld, nameSlug } from "./match.mjs";
import { FORM_KEYS, fillForm, readForm } from "./form.mjs";

const finite = (n) => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const numText = (n) => (finite(n) ? String(Number(n)) : "");
const throwOf = (n) => (finite(n) ? `${Number(n)}+` : "");

/** The wear places the sheet's gear boxes gather, by sheet place. */
const PLACE_OF_WEAR = Object.freeze({
  [WEAR.body]: "armor",
  [WEAR.mainHand]: "mainHand",
  [WEAR.bothHands]: "mainHand",
  [WEAR.offHand]: "offHand",
  [WEAR.head]: "head",
  [WEAR.back]: "back",
  [WEAR.strapped]: "back",
  [WEAR.belt]: "belt",
});
/** The sheet's container places, by the word a container's name carries. */
const CONTAINER_PLACE = Object.freeze([
  ["backpack", ["backpack", "rucksack", "pack"]],
  ["sack", ["sack"]],
  ["pouch", ["pouch", "purse"]],
]);
/** Places the sheet writes one line to a thing; the rest take a comma list. */
const MULTI_LINE_PLACES = new Set(["worn", "backpack", "sack"]);
/** Places a weapon hangs at undrawn; an import leaves a weapon listed there carried. */
const SHEATHED_PLACES = new Set(["belt", "back", "worn"]);
/** Places an import leaves anything carried at: hidden, or packed where the character has no such container. */
const CARRIED_PLACES = new Set(["hidden", "backpack", "sack", "pouch"]);

/** The attack throw a weapon is rolled at: the character's throw less the weapon's bonus. */
export function weaponThrow(actor, item) {
  const T = Number(actor.system?.thac0?.throw);
  if (!finite(actor.system?.thac0?.throw)) return null;
  const missileOnly = !!item.system?.missile && !item.system?.melee;
  const bonus = bestAttackBonus(actor, missileOnly ? "missile" : "melee").total + (Number(item.system?.bonus) || 0);
  return T - bonus;
}

/** One gear line as the sheet writes it: "3 Torches", "Rope". */
function gearLine(item) {
  const qty = Number(item.system?.quantity?.value ?? 1) || 1;
  return qty > 1 ? `${qty} ${item.name}` : item.name;
}

/** The sheet place a container's contents are listed in, by its name; null for none. */
const placeOfContainer = (item) => CONTAINER_PLACE.find(([, words]) => words.some((w) => slug(item.name).includes(w)))?.[0] ?? null;

/**
 * The character's gear, gathered into the sheet's places. A thing in a
 * container the sheet has no box for, or carried loose, is listed with the
 * backpack's, and counted so the export can say so. A thing still carried
 * where `record` read it at a place an import leaves it carried — a weapon at
 * the belt, the hidden list, a container the character lacked — is listed
 * there again.
 */
function gearPlaces(actor, record) {
  const loadout = getLoadout(actor);
  const places = Object.fromEntries(GEAR_PLACES.map((p) => [p, []]));
  const recordedAt = new Map();
  for (const g of buildPlan(record).gear) recordedAt.set(slug(g.name), [...(recordedAt.get(slug(g.name)) ?? []), g.place]);
  const carriedAt = (item) =>
    (recordedAt.get(slug(item.name)) ?? []).find((p) => CARRIED_PLACES.has(p) || (item.type === ITEM_TYPE.weapon && SHEATHED_PLACES.has(p))) ?? null;
  let moved = 0;
  for (const item of actor.items) {
    if (![ITEM_TYPE.item, ITEM_TYPE.weapon, ITEM_TYPE.armor].includes(item.type)) continue;
    const box = containedIn(item) ? actor.items.get(containedIn(item)) : null;
    if (box) {
      if (isConcealed(box)) places.hidden.push(gearLine(item));
      else if (placeOfContainer(box)) places[placeOfContainer(box)].push(gearLine(item));
      else {
        places.backpack.push(gearLine(item));
        moved++;
      }
      continue;
    }
    const where = wearLocation(actor, item, loadout);
    if (PLACE_OF_WEAR[where]) places[PLACE_OF_WEAR[where]].push(gearLine(item));
    else if (where === WEAR.carried) {
      const at = carriedAt(item);
      if (at) {
        places[at].push(gearLine(item));
        continue;
      }
      // An unworn container is listed where it is carried: with the backpack's list.
      places.backpack.push(gearLine(item));
      if (!isContainer(item)) moved++;
    } else places.worn.push(gearLine(item));
  }
  return { places, moved };
}

/**
 * Which of the sheet's three ability boxes an ability is written in. A
 * proficiency the last import read from the class box goes back there; any
 * other is general or class by its own type; anything that is not a
 * proficiency is a feature. Null for a language carried as an ability.
 */
function abilityBox(item, recordedClass) {
  if (item.flags?.[MODULE_ID]?.extras?.category === "language") return null;
  const general = item.system?.proficiencytype === "general";
  const proficiency = general || cookbookId(item).startsWith("def.prof.");
  if (!proficiency) return "features";
  if (recordedClass.has(nameSlug(item.name))) return "classProf";
  return general ? "generalProf" : "classProf";
}

/**
 * Every box the last import read, as form key → value. The record stores
 * them expanded (`a.b.c` as nested objects); no form key is a prefix of
 * another, so flattening gives the keys back exactly.
 */
export function recordedFields(actor) {
  return foundry.utils.flattenObject(actor.getFlag(MODULE_ID, RECORD_FLAG)?.fields ?? {});
}

/** The proficiency box an ability entry of the plan was read from, by its kind. */
const BOX_OF_KIND = Object.freeze({ class: "classProf", general: "generalProf", feature: "features" });

/**
 * What the last import read in the character's own boxes and the world could
 * not answer: abilities, languages, spells and coin the character never
 * received, so an export can write them back where the sheet had them.
 */
function unanswered(actor, record) {
  const listed = actor.getFlag(MODULE_ID, RECORD_FLAG)?.unmatched ?? [];
  const names = new Set(listed.filter((u) => u.kind !== "coin").map((u) => nameSlug(u.name)));
  const left = (name) => names.has(nameSlug(name));
  const plan = buildPlan(record);
  return {
    abilities: plan.abilities
      .filter((a) => left(a.name))
      .flatMap((a) => {
        const name = a.selection ? `${a.name} (${a.selection})` : a.name;
        // A proficiency written twice is rank two; a feature is listed once.
        return Array.from({ length: a.kind === "feature" ? 1 : a.rank }, () => ({ box: BOX_OF_KIND[a.kind], name, throw: a.throwText ?? "" }));
      }),
    languages: plan.languages.filter(left),
    spells: plan.spells.known.filter((s) => left(s.name)),
    rituals: plan.spells.rituals.filter(left),
    coins: new Set(listed.filter((u) => u.kind === "coin").map((u) => u.box)),
  };
}

/** Rows of a table, cut to what the form prints, with what was cut. */
function cut(rows, max, table, overflow) {
  if (rows.length > max) overflow.push({ table, dropped: rows.slice(max).map((r) => r.name ?? r) });
  return rows.slice(0, max);
}

/**
 * Every box the form carries, as key → text or tick, for this character.
 * @returns {{values: Record<string, string|boolean>, overflow: Array<{table: string, dropped: string[]}>, moved: number}}
 */
export function sheetValues(actor) {
  const sys = actor.system ?? {};
  const record = recordedFields(actor);
  const values = {};
  const overflow = [];
  const set = (key, value) => {
    if (value === undefined || value === null || value === "") return;
    if (FORM_KEYS[key]) values[key] = value;
  };
  // What only the record holds: the boxes the character keeps no field for.
  for (const [key, value] of Object.entries(record)) {
    if (/^(domain|tick|magic|formula)\./.test(key) || ["birthplace", "size", "gender", "gems", "classProfGained", "hitDie"].includes(key)) set(key, value);
  }

  const details = sys.details ?? {};
  set("name", actor.name);
  set("class", details.class);
  set("title", details.title);
  set("alignment", details.alignment);
  set("age", numText(details.age) || details.age);
  set("level", numText(details.level));
  set("xp", numText(details.xp?.value));
  set("xpNext", numText(details.xp?.next));
  set("xpBonus", finite(details.xp?.bonus) && Number(details.xp.bonus) ? `${Number(details.xp.bonus)}%` : "");
  set("hitDie", sys.hp?.hd);
  set("hp.value", numText(sys.hp?.value));
  set("hp.max", numText(sys.hp?.max));
  for (const s of SCORE_KEYS) {
    set(`score.${s}`, numText(sys.scores?.[s]?.value));
    if (finite(sys.scores?.[s]?.mod)) set(`scoreMod.${s}`, signedText(sys.scores[s].mod));
  }
  const saveMod = Number(sys.save?.mod) || 0;
  const recordedMods = SAVE_BOOK_KEYS.map((s) => record[`saveMod.${s}`]);
  for (const s of SAVE_BOOK_KEYS) {
    set(`save.${s}`, throwOf(sys.saves?.[saveSystemKey(s)]?.value));
    // Save modifiers the record kept per save, where they disagreed, stay
    // as written: the character holds only one.
    if (recordedMods.some((m) => m && m !== recordedMods[0])) set(`saveMod.${s}`, record[`saveMod.${s}`]);
    else if (saveMod) set(`saveMod.${s}`, signedText(saveMod));
  }
  if (finite(sys.thac0?.throw)) for (let n = 0; n <= 10; n++) set(`attack.${n}`, throwOf(Number(sys.thac0.throw) + n));
  const ac = sys.aac ?? {};
  set("ac.shield", numText(ac.value));
  set("ac.armour", finite(ac.value) ? numText(Number(ac.value) - (Number(ac.shield) || 0)) : "");
  set("ac.naked", numText(ac.naked));
  for (const m of MOVE_KEYS) set(`move.${m}`, numText(sys.movementacks?.[m]));
  if (finite(sys.initiative?.value)) set("initiative", signedText(sys.initiative.value));
  if (finite(sys.surprise?.surpriseothers)) set("surprise", signedText(sys.surprise.surpriseothers));
  if (finite(sys.surprise?.avoidsurprise)) set("avoidSurprise", signedText(sys.surprise.avoidsurprise));
  if (finite(sys.encumbrance?.value6)) set("encumbrance", String(Math.floor(Number(sys.encumbrance.value6) / 6)));
  set("healingRate", String(sys.hp?.bhr ?? sys.fight?.healingrate ?? ""));
  set("mortalWounds", numText(sys.fight?.mortalwounds));
  set("cleaves", numText(sys.fight?.cleaves));
  for (const a of ADVENTURING_KEYS) set(`adventuring.${a}`, throwOf(sys.adventuring?.[a]));

  // Weapons, wielded first, as the Rolls tab orders them.
  const wielded = new Set(getLoadout(actor).weapons.map((w) => w.item.id));
  const weapons = actor.items
    .filter((i) => i.type === ITEM_TYPE.weapon)
    .sort((a, b) => Number(wielded.has(b.id)) - Number(wielded.has(a.id)) || a.name.localeCompare(b.name));
  const recordedInit = Object.fromEntries(
    Array.from({ length: SHEET_ROWS.weapon }, (_, i) => [slug(record[`weapon.${i}.name`]), record[`weapon.${i}.init`]]).filter(([k, v]) => k && v),
  );
  cut(weapons, SHEET_ROWS.weapon, "weapon", overflow).forEach((item, i) => {
    set(`weapon.${i}.name`, item.name);
    set(`weapon.${i}.init`, recordedInit[slug(item.name)]);
    set(`weapon.${i}.attack`, throwOf(weaponThrow(actor, item)));
    set(`weapon.${i}.damage`, item.system?.damage);
    for (const band of ["short", "medium", "long"]) set(`weapon.${i}.${band}`, numText(item.system?.range?.[band]) === "0" ? "" : numText(item.system?.range?.[band]));
  });

  // Proficiencies, class proficiencies, and features.
  const recordedClass = new Set(Array.from({ length: SHEET_ROWS.classProf }, (_, i) => nameSlug(record[`classProf.${i}.name`])).filter(Boolean));
  const rows = { classProf: [], generalProf: [], features: [] };
  for (const item of actor.items) {
    if (item.type !== ITEM_TYPE.ability || isAdventuring(item)) continue;
    const kind = abilityBox(item, recordedClass);
    if (!kind) continue;
    const roll = rollsOf(item)[0];
    rows[kind].push({ name: item.name, throw: roll ? throwText(roll, actor, item) : "" });
  }
  const left = unanswered(actor, record);
  for (const a of left.abilities) rows[a.box].push({ name: a.name, throw: a.throw });
  for (const kind of ["classProf", "generalProf"]) {
    cut(rows[kind], SHEET_ROWS[kind], kind, overflow).forEach((r, i) => {
      set(`${kind}.${i}.name`, r.name);
      set(`${kind}.${i}.throw`, r.throw);
    });
  }
  set("features", rows.features.map((r) => r.name).join(", "));
  const languages = actor.items.filter((i) => i.type === "language" || i.flags?.[MODULE_ID]?.extras?.category === "language").map((i) => i.name);
  set("languages", [...languages, ...left.languages].join(", "));

  for (const box of COIN_KEYS) {
    const held = coinsHeld(actor, box);
    if (held) set(`coin.${box}`, String(held));
    else if (left.coins.has(box)) set(`coin.${box}`, record[`coin.${box}`]);
  }
  const { places, moved } = gearPlaces(actor, record);
  for (const [place, lines] of Object.entries(places)) {
    if (!lines.length) continue;
    set(place === "worn" ? "gear.worn.list" : `gear.${place}.list`, lines.join(MULTI_LINE_PLACES.has(place) ? "\n" : ", "));
  }

  // Spells: levels one to six by level, anything higher with the rituals.
  for (let n = 1; n <= SHEET_ROWS.spellLevels; n++) if (finite(sys.spells?.[n]?.max) && Number(sys.spells[n].max)) set(`spells.perDay.${n}`, String(sys.spells[n].max));
  const spells = actor.items.filter((i) => i.type === ITEM_TYPE.spell).sort((a, b) => a.name.localeCompare(b.name));
  for (let n = 1; n <= SHEET_ROWS.spellLevels; n++) {
    const names = [...spells.filter((s) => Number(s.system?.lvl) === n).map((s) => s.name), ...left.spells.filter((s) => s.level === n).map((s) => s.name)];
    cut(names, SHEET_ROWS.spellsPerLevel, `spell.${n}`, overflow).forEach((name, i) => set(`spell.${n}.${i}`, name));
  }
  const rituals = [...spells.filter((s) => Number(s.system?.lvl) > SHEET_ROWS.spellLevels).map((s) => s.name), ...left.rituals];
  cut(rituals, SHEET_ROWS.rituals, "ritual", overflow).forEach((name, i) => set(`ritual.${i}`, name));

  // Henchmen, in roster order; what the system keeps no field for comes from
  // the record's slot of the same name.
  const henchmen = henchmanIds(actor)
    .map((id) => game.actors?.get(id))
    .filter(Boolean);
  const recordSlot = (name) => Array.from({ length: SHEET_ROWS.henchmen }, (_, s) => s).find((s) => slug(record[`hench.${s}.name`]) === slug(name));
  cut(henchmen, SHEET_ROWS.henchmen, "hench", overflow).forEach((h, slot) => {
    const hs = h.system ?? {};
    const k = (f) => `hench.${slot}.${f}`;
    set(k("name"), h.name);
    set(k("class"), hs.details?.class);
    set(k("level"), numText(hs.details?.level));
    set(k("xp"), numText(hs.details?.xp?.value));
    set(k("alignment"), hs.details?.alignment);
    set(k("ac"), numText(hs.aac?.value));
    const hp = hs.hp ?? {};
    set(k("hp"), finite(hp.value) && finite(hp.max) && Number(hp.value) !== Number(hp.max) ? `${hp.value}/${hp.max}` : numText(hp.value));
    for (const s of SCORE_KEYS) {
      set(k(`score.${s}`), numText(hs.scores?.[s]?.value));
      if (finite(hs.scores?.[s]?.mod)) set(k(`scoreMod.${s}`), signedText(hs.scores[s].mod));
    }
    if (finite(hs.details?.morale)) set(k("morale"), signedText(hs.details.morale));
    if (finite(hs.retainer?.loyalty)) set(k("loyalty"), signedText(hs.retainer.loyalty));
    set(k("powers"), h.items.filter((i) => i.type === ITEM_TYPE.ability && !isAdventuring(i)).map((i) => i.name).join(", "));
    set(k("equipment"), h.items.filter((i) => [ITEM_TYPE.item, ITEM_TYPE.weapon, ITEM_TYPE.armor].includes(i.type)).map(gearLine).join(", "));
    const was = recordSlot(h.name);
    if (was !== undefined) {
      for (const f of ["speedA", "speedB", "encumbrance", "attackMelee", "attackMissile", "damageMelee", "damageMissile", "notes"]) set(k(f), record[`hench.${was}.${f}`]);
    }
  });
  return { values, overflow, moved };
}

/**
 * Fill the Judge's blank form with this character.
 * @param {Actor} actor
 * @param {object} doc the blank form, open in pdf.js (`openBook`)
 * @returns {Promise<{bytes: Uint8Array, overflow: object[], moved: number}|{refused: true, share: number}>}
 *   `refused` when the file is not the official form
 */
export async function exportSheet(actor, doc) {
  const read = await readForm(doc);
  if (!read.isForm) return { refused: true, share: read.share };
  const { values, overflow, moved } = sheetValues(actor);
  const bytes = await fillForm(doc, values);
  return { bytes, overflow, moved };
}

/** The file name an export is saved under. */
export const exportFileName = (actor) => `${String(actor.name ?? "character").replace(/[\\/:*?"<>|]+/g, "").trim() || "character"}.pdf`;

/** Hand the filled form to the browser to save. */
export function saveExport(actor, bytes) {
  foundry.utils.saveDataToFile(bytes, "application/pdf", exportFileName(actor));
}
