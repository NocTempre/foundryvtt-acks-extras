/* global game, foundry, Actor, ChatMessage */
/**
 * Writing what a filled official sheet says onto a character.
 *
 * The order is forced. The class goes first, because binding one writes the
 * values a class decides (saves, attack throw, title, hit die) and the sheet's
 * copies of those become checks rather than writes. Abilities, languages,
 * gear and spells come next, because their Active Effects are what the sheet's
 * totals already include. Only then are the plain values written, and any one
 * an effect now touches is reported — "sheet X, in force Y" — and never
 * written as a base it would be added to again (docs/character-sheet/DECISIONS.md,
 * 2026-09-16). Checks are read off the prepared character last.
 *
 * Re-importing onto the same character adds what is missing and doubles
 * nothing: abilities count the copies held, gear and spells are matched by
 * name, coin is only ever credited up to the sheet's count.
 */
import { MODULE_ID } from "../../lib/constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { ACTOR_TYPE, ALIGNMENTS, ITEM_TYPE, SLOT, slug } from "../../lib/vocab.mjs";
import { savesUpdateData } from "../../lib/actor-compat.mjs";
import { slotsOf } from "../../lib/item-model.mjs";
import { whenReady } from "../../lib/library.mjs";
import { goodsForRow } from "../../lib/bundles-logic.mjs";
import { deliverItems } from "../../lib/bundles.mjs";
import { coinTemplate, creditCoin, ownCoin } from "../../lib/money.mjs";
import { applyClass } from "../../classes/apply.mjs";
import { FLAG_CLASSES } from "../../classes/constants.mjs";
import { normalizeHd } from "../../classes/hitpoints.mjs";
import { rankedCopies } from "../../classes/grants.mjs";
import { ensureLanguage } from "../../classes/languages.mjs";
import { buildGearData } from "../../classes/template-packages.mjs";
import { HAND_PLACES, placeItem } from "../../equipment/placement.mjs";
import { wearLocation } from "../../equipment/wear.mjs";
import { isContainer, storeIn } from "../../equipment/containers.mjs";
import { rollsOf, targetOf } from "../../abilities/ability-rolls.mjs";
import { enrollHenchman } from "../../henchmen/engine/hire.mjs";
import { LANG, PDF_RECORD_FLAG as RECORD_FLAG } from "../constants.mjs";
import { saveLabel } from "../snapshot.mjs";
import { filledValues } from "./form.mjs";
import { diceText, numbers } from "./parse.mjs";
import { weaponThrow } from "./export.mjs";
import { ADVENTURING_KEYS, COIN_KEYS, MOVE_KEYS, SAVE_BOOK_KEYS, SCORE_KEYS, buildPlan } from "./plan.mjs";
import { COIN_METALS, coinsHeld, isCoinOf, matchAbility, matchClass, matchHenchman, matchLanguage, matchSpell, ownedCopies, ownedNamed } from "./match.mjs";
import { notesBlock, replaceNotesBlock } from "./notes.mjs";

const loc = makeLoc(LANG);

/** The update paths a bound class writes; with a class bound the sheet's copy is checked, not written. */
const CLASS_PATHS = new Set(["system.details.title", "system.details.xp.next", "system.hp.hd", "system.thac0.throw", "system.fight.cleaves"]);
const isClassPath = (path) => CLASS_PATHS.has(path) || path.startsWith("system.saves.") || /^system\.spells\.\d\.max$/.test(path);

/** Where each sheet place puts what it lists; `worn` asks the item first. */
const PLACE_SLOT = Object.freeze({ armor: SLOT.body, mainHand: SLOT.mainHand, offHand: SLOT.offHand, head: SLOT.head, back: SLOT.back, belt: SLOT.belt, worn: SLOT.worn });
/** The sheet places that are a container, by the word its name carries. */
const PLACE_CONTAINER = Object.freeze({ backpack: ["backpack", "rucksack", "pack"], sack: ["sack"], pouch: ["pouch", "purse"] });
/** The item types a gear line can name. */
const GEAR_TYPES = [ITEM_TYPE.item, ITEM_TYPE.weapon, ITEM_TYPE.armor];

const finite = (n) => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const same = (a, b) => String(a ?? "").replace(/\s+/g, "").toLowerCase() === String(b ?? "").replace(/\s+/g, "").toLowerCase();

/** A label for a field of the sheet, in this module's words. */
export function fieldLabel(key) {
  const [root, sub] = key.split(".");
  if (root === "save") return saveLabel(sub);
  if (root === "saveMod" && sub) return loc("pdf.field.saveModOf", { save: saveLabel(sub) });
  if (root === "score") return loc(`pdf.score.${sub}`);
  if (root === "scoreMod") return loc("pdf.field.scoreMod", { score: loc(`pdf.score.${sub}`) });
  if (root === "adventuring") return game.i18n.localize(`ACKS.adventuring.${sub}`);
  if (root === "move") return loc("pdf.field.move", { mode: loc(`pdf.move.${sub}`) });
  if (root === "attack") return loc("pdf.field.attackVs", { ac: sub });
  if (root === "coin") return loc(`pdf.coin.${sub}`);
  if (root === "spells") return loc("pdf.field.perDay", { level: key.split(".")[2] });
  return loc(`pdf.field.${key}`);
}

/**
 * The report an import builds as it goes, shown in the window afterwards.
 * A `checks` row carries `keep: {path, value}` where the sheet's value may
 * still be written over the class's, by the reader's choice, and `effect`
 * where an Active Effect holds the value and writing it would double it.
 */
function newReport(actor) {
  return { actor, created: false, written: [], checks: [], unmatched: [], notes: [], henchmen: [], granted: [] };
}

/* -------------------------------------------- */
/*  Matching and granting                        */
/* -------------------------------------------- */

/**
 * Bind `cls` at `level`, unless the character already holds that class at
 * that level. Binding again rewrites the class's values over any the reader
 * kept, and recreates its training, which the loadout reads as untrained
 * until it is back.
 * @returns {Promise<{bound: boolean, applied: boolean}>} `applied` when this call bound it
 */
async function bindClass(actor, cls, level) {
  const held = actor.getFlag(MODULE_ID, FLAG_CLASSES);
  const key = cls.system?.key || cls.name.toLowerCase();
  const sameClass = held?.uuid === cls.uuid || held?.key === key;
  if (sameClass && (!finite(level) || Number(actor.system?.details?.level) === Number(level))) return { bound: true, applied: false };
  const result = await applyClass(actor, cls, { level: finite(level) ? level : undefined, confirm: false });
  return { bound: !!result.applied, applied: !!result.applied };
}

/** Grant every proficiency and class feature the sheet lists, to its written rank. */
async function grantAbilities(actor, abilities, report, { verifyThrows = true } = {}) {
  for (const entry of abilities) {
    const match = matchAbility(entry);
    if (!match) {
      report.unmatched.push({ kind: entry.kind, name: entry.selection ? `${entry.name} (${entry.selection})` : entry.name });
      continue;
    }
    const missing = entry.rank - ownedCopies(actor, match).length;
    if (missing > 0) {
      const copies = rankedCopies(match.doc, { rank: missing, selection: match.selection, ref: match.ref });
      await actor.createEmbeddedDocuments("Item", copies);
      report.granted.push(missing > 1 ? `${copies[0].name} ×${missing}` : copies[0].name);
    }
    if (!verifyThrows || entry.throw === null) continue;
    const owned = ownedCopies(actor, match)[0];
    const roll = owned ? rollsOf(owned)[0] : null;
    const target = roll ? targetOf(roll, actor, owned) : null;
    if (finite(target) && Number(target) !== entry.throw) {
      report.checks.push({ label: owned.name, sheet: entry.throwText, inForce: `${target}+` });
    }
  }
}

/** Every language the sheet lists that the world knows; the rest go to notes. */
async function grantLanguages(actor, names, report) {
  for (const name of names) {
    const doc = await matchLanguage(name);
    if (!doc) {
      report.unmatched.push({ kind: "language", name });
      continue;
    }
    const { created } = await ensureLanguage(actor, doc.name);
    if (created) report.granted.push(doc.name);
  }
}

/** The actor's container a sheet place stores into: one whose name carries the place's word. */
function containerFor(actor, place) {
  const words = PLACE_CONTAINER[place] ?? [];
  return actor.items.find((i) => isContainer(i) && words.some((w) => slug(i.name).includes(w))) ?? null;
}

/** Whether one item of this kind is a stack rather than one of several copies. */
const stacks = (item) => item.type !== ITEM_TYPE.weapon && item.type !== ITEM_TYPE.armor;

/**
 * Land every gear line on the actor and put it where the sheet lists it. An
 * item the actor already carries under that name answers the line, so a
 * second import lands nothing twice; one item answers one line, so two lines
 * naming a dagger are two daggers. A stack whose count differs from the
 * sheet's is reported, never changed.
 */
async function landGear(actor, gear, report) {
  const claimed = new Set();
  const placed = [];
  for (const line of gear) {
    const have = actor.items.filter((i) => GEAR_TYPES.includes(i.type) && slug(i.name) === slug(line.name) && !claimed.has(i.id));
    if (have.length && stacks(have[0])) {
      claimed.add(have[0].id);
      const held = Number(have[0].system?.quantity?.value ?? 1) || 1;
      if (held !== line.qty) report.checks.push({ label: have[0].name, sheet: String(line.qty), inForce: String(held) });
      placed.push({ line, item: have[0] });
      continue;
    }
    const copies = have.slice(0, line.qty);
    for (const copy of copies) claimed.add(copy.id);
    let item = copies[0] ?? null;
    const count = line.qty - copies.length;
    if (count > 0) {
      const { data } = await buildGearData({ name: line.name, qty: 1 });
      const { created, updated } = await deliverItems(actor, goodsForRow(data, count));
      for (const i of [...created, ...updated]) claimed.add(i.id);
      report.granted.push(count > 1 ? `${data.name} ×${count}` : data.name);
      item ??= created[0] ?? updated[0] ?? null;
    }
    if (item) placed.push({ line, item });
  }
  // Everything is put on the body before anything is packed, so a backpack
  // on the back is there to take the backpack's list.
  for (const { line, item } of placed) {
    const slot = line.place === "worn" ? (slotsOf(item)[0] ?? PLACE_SLOT.worn) : PLACE_SLOT[line.place];
    if (!slot) continue;
    // A weapon is drawn only into a hand. One listed at the belt or on the back
    // stays carried, sheathed; drawing it would take a hand, and with it the
    // shield the sheet lists there.
    if (item.type === ITEM_TYPE.weapon && !HAND_PLACES.includes(slot)) continue;
    // Already there: a wear that writes nothing answers false, which is not a refusal.
    if (wearLocation(actor, item) === slot) continue;
    if (!(await placeItem(actor, item, slot))) report.checks.push({ label: item.name, sheet: loc(`pdf.place.${line.place}`), inForce: loc("pdf.check.notWorn") });
  }
  for (const { line, item } of placed) {
    if (!PLACE_CONTAINER[line.place]) continue;
    const box = containerFor(actor, line.place);
    if (!box) {
      report.checks.push({ label: item.name, sheet: loc(`pdf.place.${line.place}`), inForce: loc("pdf.check.loose") });
      continue;
    }
    if (box.id !== item.id) await storeIn(actor, item, box);
  }
  const hidden = placed.filter((p) => p.line.place === "hidden").map((p) => p.item.name);
  if (hidden.length) report.notes.push({ label: loc("pdf.place.hidden"), text: hidden.join(", ") });
}

/** The weapons table: matched to the weapons now carried, the rest landed loose. */
async function landWeapons(actor, weapons, report) {
  for (const row of weapons) {
    let item = ownedNamed(actor, row.name, [ITEM_TYPE.weapon]);
    if (!item) {
      const { data, resolution } = await buildGearData({ name: row.name, qty: 1 });
      // A weapon nothing in the library answers for takes its numbers from the sheet.
      if (resolution !== "base" && data.type === ITEM_TYPE.weapon) {
        if (row.damage) foundry.utils.setProperty(data, "system.damage", row.damage);
        for (const band of ["short", "medium", "long"]) if (finite(row.range[band])) foundry.utils.setProperty(data, `system.range.${band}`, row.range[band]);
      }
      const { created } = await deliverItems(actor, goodsForRow(data, 1));
      item = created[0] ?? null;
      if (item) report.granted.push(item.name);
    }
    if (item?.type === ITEM_TYPE.weapon && row.damage && item.system?.damage && !same(diceText(item.system.damage), row.damage)) {
      report.checks.push({ label: loc("pdf.field.weaponDamage", { name: item.name }), sheet: row.damageText, inForce: item.system.damage });
    }
  }
}

/**
 * The coin a box's credit is copied from: the actor's own row of that coin,
 * else the world's coin named for the metal, else any money item whose name
 * starts with it. A coin is never built from a rate this module would have to
 * state.
 */
async function coinSourceFor(actor, box) {
  const own = ownCoin(actor).find((row) => isCoinOf(row, box));
  if (own) return typeof own.toObject === "function" ? own.toObject() : own;
  return (await coinTemplate({ name: COIN_METALS[box] })) ?? game.items?.find((i) => i.type === ITEM_TYPE.money && isCoinOf(i, box))?.toObject() ?? null;
}

/** Coin up to each box's count; a box counting fewer than are carried is reported, never taken. */
async function landCoin(actor, coins, report) {
  for (const box of COIN_KEYS) {
    const { count, text } = coins[box] ?? {};
    if (!finite(count)) {
      if (text) report.notes.push({ label: fieldLabel(`coin.${box}`), text });
      continue;
    }
    if (text && String(count) !== text.replace(/[,\s]/g, "")) report.notes.push({ label: fieldLabel(`coin.${box}`), text });
    const held = coinsHeld(actor, box);
    if (count > held) {
      const source = await coinSourceFor(actor, box);
      if (!source) {
        report.unmatched.push({ kind: "coin", name: `${fieldLabel(`coin.${box}`)} ${count}`, box });
        continue;
      }
      await creditCoin(actor, [{ source, count: count - held }]);
      report.written.push({ label: fieldLabel(`coin.${box}`), value: String(count) });
    } else if (count < held) {
      report.checks.push({ label: fieldLabel(`coin.${box}`), sheet: String(count), inForce: String(held) });
    }
  }
}

/** Spells the sheet lists by level, and the rituals; what the library lacks goes to notes. */
async function landSpells(actor, spells, report) {
  const entries = [...spells.known, ...spells.rituals.map((name) => ({ level: null, name }))];
  for (const { level, name } of entries) {
    const doc = matchSpell(name);
    if (!doc) {
      report.unmatched.push({ kind: "spell", name });
      continue;
    }
    if (finite(level) && Number(doc.system?.lvl) !== level) {
      report.checks.push({ label: doc.name, sheet: loc("pdf.check.level", { level }), inForce: loc("pdf.check.level", { level: doc.system?.lvl }) });
    }
    if (ownedNamed(actor, doc.name, [ITEM_TYPE.spell])) continue;
    const data = doc.toObject();
    delete data._id;
    delete data.folder;
    await actor.createEmbeddedDocuments("Item", [data]);
    report.granted.push(doc.name);
  }
}

/* -------------------------------------------- */
/*  Plain values                                 */
/* -------------------------------------------- */

/** An alignment as the system writes it, when the sheet's names one of the three. */
function alignmentOf(text) {
  const hit = Object.values(ALIGNMENTS).find((a) => slug(a.label) === slug(text));
  return hit?.label ?? text;
}

/** The single modifier every save box agrees on, or null when they differ or are empty. */
function sharedSaveMod(plan) {
  const mods = SAVE_BOOK_KEYS.map((s) => plan.saveMods[s]);
  return finite(mods[0]) && mods.every((m) => m === mods[0]) ? mods[0] : null;
}

/** Every plain value the sheet sets, as `{key, path, value, sheet}`. */
function plainWrites(plan, { bound }) {
  const out = [];
  const add = (key, path, value, sheet = value) => {
    if (value === null || value === undefined || value === "") return;
    out.push({ key, path, value, sheet: String(sheet) });
  };
  add("alignment", "system.details.alignment", plan.alignment ? alignmentOf(plan.alignment) : null, plan.alignment);
  add("age", "system.details.age", plan.age);
  add("title", "system.details.title", plan.title || null);
  if (!bound) {
    add("class", "system.details.class", plan.className || null);
    add("level", "system.details.level", plan.level);
  }
  add("xp", "system.details.xp.value", plan.xp);
  add("xpNext", "system.details.xp.next", plan.xpNext);
  add("xpBonus", "system.details.xp.bonus", plan.xpBonus);
  add("hitDie", "system.hp.hd", plan.hitDie ? normalizeHd(plan.hitDie) : null, plan.hitDie);
  for (const s of SCORE_KEYS) add(`score.${s}`, `system.scores.${s}.value`, plan.scores[s]);
  add("hp.max", "system.hp.max", plan.hp.max, plan.hp.maxText);
  add("hp.value", "system.hp.value", plan.hp.value, plan.hp.valueText);
  for (const s of SAVE_BOOK_KEYS) {
    if (!finite(plan.saves[s])) continue;
    const [[path, value] = []] = Object.entries(savesUpdateData({ [s]: plan.saves[s] }));
    if (path) add(`save.${s}`, path, value, `${value}+`);
  }
  add("saveMod", "system.save.mod", sharedSaveMod(plan));
  if (finite(plan.attack[0])) add("attack.0", "system.thac0.throw", plan.attack[0], `${plan.attack[0]}+`);
  add("surprise", "system.surprise.surpriseothers", plan.surprise);
  add("avoidSurprise", "system.surprise.avoidsurprise", plan.avoidSurprise);
  for (const a of ADVENTURING_KEYS) if (finite(plan.adventuring[a])) add(`adventuring.${a}`, `system.adventuring.${a}`, plan.adventuring[a], `${plan.adventuring[a]}+`);
  add("mortalWounds", "system.fight.mortalwounds", plan.mortalWounds);
  add("cleaves", "system.fight.cleaves", plan.cleaves);
  for (let n = 1; n <= 6; n++) add(`spells.perDay.${n}`, `system.spells.${n}.max`, plan.spells.perDay[n]);
  return out;
}

/**
 * Write the plain values: with a class bound its own values become checks,
 * and any value an Active Effect touches now is reported rather than written.
 */
async function writePlain(actor, plan, report, { bound }) {
  const update = {};
  for (const w of plainWrites(plan, { bound })) {
    const label = fieldLabel(w.key);
    const now = foundry.utils.getProperty(actor, w.path);
    if (bound && isClassPath(w.path)) {
      if (!same(now, w.value)) report.checks.push({ label, sheet: w.sheet, inForce: String(now ?? "—"), keep: { path: w.path, value: w.value } });
      continue;
    }
    if (foundry.utils.getProperty(actor.overrides ?? {}, w.path) !== undefined) {
      if (!same(now, w.value)) report.checks.push({ label, sheet: w.sheet, inForce: String(now ?? "—"), effect: true });
      continue;
    }
    if (same(foundry.utils.getProperty(actor._source, w.path), w.value)) continue;
    update[w.path] = w.value;
    report.written.push({ label, value: w.sheet });
  }
  if (!bound && Object.values(plan.spells.perDay).some((n) => finite(n) && n > 0)) update["system.spells.enabled"] = true;
  if (Object.keys(update).length) await actor.update(update);
}

/* -------------------------------------------- */
/*  Checks read off the prepared character       */
/* -------------------------------------------- */

/** Compare what the sheet says with what the system works out for itself. */
function verify(actor, plan, report) {
  const sys = actor.system ?? {};
  const check = (key, sheet, inForce) => {
    if (!finite(sheet) || !finite(inForce) || Number(sheet) === Number(inForce)) return;
    report.checks.push({ label: fieldLabel(key), sheet: String(sheet), inForce: String(inForce) });
  };
  for (const s of SCORE_KEYS) check(`scoreMod.${s}`, plan.scoreMods[s], sys.scores?.[s]?.mod);
  const T = Number(sys.thac0?.throw);
  for (let n = 1; n <= 10; n++) check(`attack.${n}`, plan.attack[n], finite(sys.thac0?.throw) ? T + n : null);
  const ac = sys.aac ?? {};
  check("ac.shield", plan.ac.shield, ac.value);
  check("ac.armour", plan.ac.armour, finite(ac.value) ? Number(ac.value) - (Number(ac.shield) || 0) : null);
  check("ac.naked", plan.ac.naked, ac.naked);
  if (sys.config?.movementAuto !== false) for (const m of MOVE_KEYS) check(`move.${m}`, plan.move[m], sys.movementacks?.[m]);
  check("initiative", plan.initiative, sys.initiative?.value);
  check("encumbrance", plan.encumbrance, finite(sys.encumbrance?.value6) ? Math.floor(Number(sys.encumbrance.value6) / 6) : null);
  for (const row of plan.weapons) {
    const item = ownedNamed(actor, row.name, [ITEM_TYPE.weapon]);
    const inForce = item ? weaponThrow(actor, item) : null;
    if (finite(row.attack) && finite(inForce) && Number(row.attack) !== inForce) {
      report.checks.push({ label: loc("pdf.field.weaponAttack", { name: item.name }), sheet: row.attackText, inForce: `${inForce}+` });
    }
  }
  const bhr = sys.hp?.bhr ?? sys.fight?.healingrate;
  if (plan.healingRate && bhr && !same(diceText(bhr) ?? bhr, plan.healingRate)) {
    report.checks.push({ label: fieldLabel("healingRate"), sheet: plan.healingRate, inForce: String(bhr) });
  }
}

/* -------------------------------------------- */
/*  Notes                                        */
/* -------------------------------------------- */

/** What the sheet says that this module keeps no field for, as label / text rows. */
function unmodelledNotes(plan) {
  const rows = [];
  const add = (label, text) => {
    if (text !== null && text !== undefined && String(text).trim()) rows.push({ label, text: String(text) });
  };
  for (const [k, text] of Object.entries(plan.unmodelled)) add(fieldLabel(k), text);
  if (plan.ageText && !finite(plan.age)) add(fieldLabel("age"), plan.ageText);
  if (plan.hp.valueText && String(plan.hp.value) !== plan.hp.valueText) add(fieldLabel("hp.value"), plan.hp.valueText);
  if (plan.hp.maxText && String(plan.hp.max) !== plan.hp.maxText) add(fieldLabel("hp.max"), plan.hp.maxText);
  if (sharedSaveMod(plan) === null) {
    add(fieldLabel("saveMod"), SAVE_BOOK_KEYS.filter((s) => finite(plan.saveMods[s])).map((s) => `${saveLabel(s)} ${plan.saveMods[s]}`).join(", "));
  }
  add(fieldLabel("gems"), plan.gems);
  add(fieldLabel("classProfGained"), plan.classProfGained);
  for (const [grid, counts] of Object.entries(plan.ticks)) {
    const ticked = counts.map((n, row) => (n ? loc("pdf.note.tickRow", { row: row + 1, count: n }) : "")).filter(Boolean);
    if (ticked.length) add(loc(`pdf.field.ticks.${grid}`), ticked.join(", "));
  }
  for (const [k, text] of Object.entries(plan.spells.magic)) add(loc(`pdf.field.magic.${k}`), text);
  if (plan.spells.formulae.length) add(loc("pdf.field.formulae"), plan.spells.formulae.join(", "));
  for (const w of plan.weapons) if (finite(w.init)) add(loc("pdf.field.weaponInit", { name: w.name }), w.init);
  return rows;
}

/* -------------------------------------------- */
/*  Henchmen                                     */
/* -------------------------------------------- */

/** The plain values of one henchman slot, as an actor update. Loyalty is the roster's, never written here. */
function henchmanUpdate(h) {
  const update = {};
  if (h.className) update["system.details.class"] = h.className;
  if (finite(h.level)) update["system.details.level"] = h.level;
  if (finite(h.xp)) update["system.details.xp.value"] = h.xp;
  if (h.alignment) update["system.details.alignment"] = alignmentOf(h.alignment);
  // "5/8" is five of eight; a single number is both.
  const hp = numbers(h.hpText);
  if (hp.length) {
    update["system.hp.value"] = hp[0];
    update["system.hp.max"] = hp.at(-1);
  }
  for (const s of SCORE_KEYS) if (finite(h.scores[s])) update[`system.scores.${s}.value`] = h.scores[s];
  if (finite(h.morale)) update["system.details.morale"] = Math.max(-4, Math.min(4, Math.round(h.morale)));
  return update;
}

/** One henchman slot written out whole, for notes. */
function henchmanText(h) {
  const parts = [h.name, h.className, finite(h.level) ? loc("pdf.check.level", { level: h.level }) : ""];
  const scores = SCORE_KEYS.filter((s) => finite(h.scores[s])).map((s) => `${loc(`pdf.score.${s}`)} ${h.scores[s]}`);
  if (scores.length) parts.push(scores.join(" "));
  if (h.hpText) parts.push(`${fieldLabel("hp.value")} ${h.hpText}`);
  if (h.powers.length) parts.push(h.powers.join(", "));
  if (h.equipment.length) parts.push(h.equipment.map((g) => (g.qty > 1 ? `${g.qty} ${g.name}` : g.name)).join(", "));
  const rest = Object.entries(h.rest).filter(([, t]) => t);
  if (rest.length) parts.push(rest.map(([k, t]) => `${loc(`pdf.field.hench.${k}`)}: ${t}`).join("; "));
  return parts.filter(Boolean).join(" · ");
}

/** Bring one henchman up to their slot: class, values, abilities and equipment. */
async function fillHenchman(hench, h, report) {
  const cls = matchClass(h.className);
  const update = henchmanUpdate(h);
  if (cls) {
    delete update["system.details.class"];
    delete update["system.details.level"];
    await bindClass(hench, cls, h.level);
  }
  if (Object.keys(update).length) await hench.update(update);
  const sub = newReport(hench);
  await grantAbilities(hench, h.powers.map((p) => ({ name: p, selection: null, rank: 1, kind: "power", throw: null })), sub, { verifyThrows: false });
  await landGear(hench, h.equipment.map((g) => ({ ...g, place: "loose" })), sub);
  report.unmatched.push(...sub.unmatched.map((u) => ({ ...u, name: `${u.name} (${hench.name})` })));
  report.granted.push(...sub.granted.map((g) => `${g} (${hench.name})`));
  if (finite(h.ac) && finite(hench.system?.aac?.value) && Number(hench.system.aac.value) !== h.ac) {
    report.checks.push({ label: loc("pdf.field.henchAc", { name: hench.name }), sheet: String(h.ac), inForce: String(hench.system.aac.value) });
  }
  const rest = Object.entries(h.rest).filter(([, t]) => t);
  if (rest.length) report.notes.push({ label: hench.name, text: rest.map(([k, t]) => `${loc(`pdf.field.hench.${k}`)}: ${t}`).join("; ") });
}

/**
 * Every henchman slot: a roster member of that name is brought up to the
 * sheet; one not on the roster is made and enrolled where `createHenchmen` is
 * on and the seat may create actors, and goes to notes otherwise.
 */
async function landHenchmen(employer, henchmen, report, { createHenchmen = false } = {}) {
  for (const h of henchmen) {
    const label = h.name || loc("pdf.note.henchSlot", { slot: h.slot + 1 });
    const toNotes = () => {
      report.henchmen.push({ name: label, outcome: "notes" });
      report.notes.push({ label, text: henchmanText(h) });
    };
    const hench = h.name ? matchHenchman(employer, h.name) : null;
    if (hench) {
      if (!hench.isOwner) {
        toNotes();
        continue;
      }
      await fillHenchman(hench, h, report);
      const loyalty = hench.system?.retainer?.loyalty;
      if (finite(h.loyalty) && finite(loyalty) && Number(loyalty) !== h.loyalty) {
        report.checks.push({ label: loc("pdf.field.henchLoyalty", { name: hench.name }), sheet: String(h.loyalty), inForce: String(loyalty) });
      }
      report.henchmen.push({ name: hench.name, outcome: "updated", uuid: hench.uuid });
      continue;
    }
    if (!createHenchmen || !h.name || !game.user.can("ACTOR_CREATE")) {
      toNotes();
      continue;
    }
    const made = await Actor.create({ name: h.name, type: ACTOR_TYPE.character }, { renderSheet: false });
    if (!made) {
      toNotes();
      continue;
    }
    // Enrolled last, so the record's starting level and the wage read the
    // henchman the sheet describes rather than a blank first-level actor.
    await fillHenchman(made, h, report);
    await enrollHenchman(employer, made, { loyalty: h.loyalty, morale: h.morale });
    report.henchmen.push({ name: made.name, outcome: "created", uuid: made.uuid });
  }
}

/* -------------------------------------------- */
/*  The import                                   */
/* -------------------------------------------- */

/**
 * Import a read form onto `actor`, or onto a new character when none is given.
 * @param {object} options
 * @param {Actor|null} [options.actor] the character to update; null makes one (needs `ACTOR_CREATE`)
 * @param {Record<string, string|boolean>} options.values what the form holds (`readForm`)
 * @param {boolean} [options.createHenchmen] make and enroll henchmen the roster lacks
 * @returns {Promise<object>} the report: `{actor, created, written, checks, unmatched, notes, henchmen, granted}`
 */
export async function importSheet({ actor = null, values, createHenchmen = false } = {}) {
  await whenReady();
  const plan = buildPlan(values);
  let target = actor;
  let created = false;
  if (!target) {
    if (!game.user.can("ACTOR_CREATE")) throw new Error(loc("pdf.error.cannotCreate"));
    target = await Actor.create({ name: plan.name || loc("pdf.unnamed"), type: ACTOR_TYPE.character }, { renderSheet: false });
    if (!target) throw new Error(loc("pdf.error.createFailed"));
    created = true;
  } else if (target.type !== ACTOR_TYPE.character) throw new Error(loc("pdf.error.notCharacter"));
  if (!target.isOwner) throw new Error(loc("pdf.error.notOwner", { name: target.name }));
  const report = newReport(target);
  report.created = created;

  if (plan.name && target.name !== plan.name) {
    await target.update({ name: plan.name });
    report.written.push({ label: fieldLabel("name"), value: plan.name });
  }
  const cls = matchClass(plan.className);
  let bound = false;
  if (cls) {
    const result = await bindClass(target, cls, plan.level);
    bound = result.bound;
    if (result.applied) report.written.push({ label: fieldLabel("class"), value: `${cls.name} ${target.system?.details?.level ?? ""}`.trim() });
  } else if (plan.className) report.unmatched.push({ kind: "className", name: plan.className });

  await grantAbilities(target, plan.abilities, report);
  await grantLanguages(target, plan.languages, report);
  await landGear(target, plan.gear, report);
  await landWeapons(target, plan.weapons, report);
  await landCoin(target, plan.coins, report);
  await landSpells(target, plan.spells, report);
  await writePlain(target, plan, report, { bound });
  verify(target, plan, report);
  // What the character's own boxes named and the world could not answer; an
  // export writes these back, since the character never received them.
  const unanswered = report.unmatched.filter((u) => u.kind !== "className").map(({ kind, name, box }) => (box ? { kind, name, box } : { kind, name }));

  await landHenchmen(target, plan.henchmen, report, { createHenchmen });
  const rows = [...report.unmatched.map((u) => ({ label: loc(`pdf.unmatched.${u.kind}`), text: u.name })), ...unmodelledNotes(plan), ...report.notes];
  const block = notesBlock({ rows, domain: plan.domain });
  const previous = target.getFlag(MODULE_ID, RECORD_FLAG)?.notes ?? "";
  // The record is replaced whole, so a box this sheet leaves empty does not
  // keep the last sheet's value. An update expands dotted keys, so the boxes
  // are stored expanded and read back flat (`recordedFields`).
  await target.update({
    "system.details.notes": replaceNotesBlock(target._source.system?.details?.notes ?? "", previous, block),
    [`flags.${MODULE_ID}.${RECORD_FLAG}`]: foundry.data.operators.ForcedReplacement.create({
      importedAt: Date.now(),
      fields: foundry.utils.expandObject(filledValues(values)),
      unmatched: unanswered,
      notes: block,
    }),
  });
  // What a character was handed is a record, in the place chargen and a class
  // apply put theirs.
  if (report.granted.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: target }),
      content: `<p>${loc("pdf.grantedChat", { name: foundry.utils.escapeHTML(target.name) })}</p><p>${report.granted.map((g) => foundry.utils.escapeHTML(g)).join(", ")}</p>`,
    });
  }
  return report;
}

/** Write the sheet's value over the one in force, for a check the reader chose to keep. */
export async function keepSheetValue(actor, { path, value } = {}) {
  if (!actor?.isOwner || !path) return false;
  await actor.update({ [path]: value });
  return true;
}
