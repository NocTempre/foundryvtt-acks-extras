/* global game, foundry, ui */
/**
 * Foundry-side face of the class builder (advanced mode): resolves what the
 * pure engine cannot — the ruledata document, the bound race Item, the
 * progenitor classes' casting grids — runs the derivation, and writes the
 * plan onto the class document after showing what will change.
 *
 * The write keeps applyClass's contract: a field the tables could not answer
 * is SKIPPED, never zeroed, and the whole write is one update.
 */
import { getDoc, hasDoc, expectTables } from "../lib/tables.mjs";
import { BUILDER_DOC_ID, BUILDER_TABLE_IDS, derivePlan } from "./builder-logic.mjs";
import { classByKey, findByRef, effectiveAttack } from "./registry.mjs";
import { LANG_PREFIX, RACE_TYPE, CHASSIS_KEYS } from "./constants.mjs";

/** Every race Item in the world directory. */
export function raceItems() {
  return game.items?.filter((i) => i.type === RACE_TYPE) ?? [];
}

/** The race Item a class names (by cookbook ref, uuid:…, or key), or null. */
export function raceForClass(classItem) {
  const ref = classItem?.system?.race;
  if (!ref) return null;
  const direct = findByRef(ref);
  if (direct?.type === RACE_TYPE) return direct;
  const k = String(ref).toLowerCase();
  return raceItems().find((i) => (i.system.key || "").toLowerCase() === k) ?? null;
}

/** The builder ruledata tables, or null when no world layer carries them. */
export function builderTables() {
  return hasDoc(BUILDER_DOC_ID) ? (getDoc(BUILDER_DOC_ID).tables ?? null) : null;
}

/**
 * Progenitor casting grids for every magic value on the builder: magic type
 * key → the tradition object off the progenitor class's document (the grid
 * the value's fraction scales). A type whose progenitor names no world class
 * simply stays absent — the engine reports it.
 */
export function progenitorGrids(builder, tables) {
  const out = new Map();
  for (const m of builder?.magic ?? []) {
    const typeDef = tables?.magicTypes?.[m.type];
    if (!typeDef?.progenitor) continue;
    const progenitor = classByKey(typeDef.progenitor);
    if (!progenitor) continue;
    const casting = progenitor.system.casting ?? [];
    const grid = casting.find((t) => t.key === (typeDef.progenitorTradition || t.key)) ?? casting[0] ?? null;
    if (grid) out.set(m.type, grid);
  }
  return out;
}

/** The four chassis classes' printed attack bands, as the engine wants them. */
export function chassisAttackMap() {
  const out = new Map();
  for (const key of CHASSIS_KEYS) {
    const item = classByKey(key);
    if (!item) continue;
    const bands = effectiveAttack(item);
    if (bands.length) out.set(key, bands.map((b) => ({ minLevel: b.min, maxLevel: b.max, throw: b.throw })));
  }
  return out;
}

/** The fighter chassis's ladders, keyed ({damageBonus} is what derive borrows). */
export function fighterLadderMap() {
  const fighter = classByKey("fighter");
  const out = {};
  for (const ladder of fighter?.system.ladders ?? []) {
    if (ladder.key) out[ladder.key] = { key: ladder.key, label: ladder.label, values: ladder.values ?? [] };
  }
  return out;
}

/**
 * Thief-skill ladders for the chosen skills: skill ref → the progenitor
 * thief's ladder for it, matched through its own inventory.skills binding.
 */
export function skillLadderMap(builder) {
  const out = new Map();
  const thief = classByKey("thief");
  if (!thief) return out;
  const bindings = thief.system.inventory?.skills ?? [];
  const ladders = thief.system.ladders ?? [];
  for (const ref of builder?.thievery?.skills ?? []) {
    const bound = bindings.find((row) => row.ref === ref);
    const ladder = bound?.ladderKey ? ladders.find((l) => l.key === bound.ladderKey) : null;
    if (ladder) out.set(ref, { key: ladder.key, label: ladder.label, values: ladder.values ?? [] });
  }
  return out;
}

/** Run the derivation for one class document (no writes). */
export function planFor(classItem) {
  const sys = classItem.system;
  const tables = builderTables();
  const race = raceForClass(classItem)?.system ?? null;
  return derivePlan({
    builder: sys.builder,
    tables,
    race,
    progenitors: progenitorGrids(sys.builder, tables),
    chassisAttack: chassisAttackMap(),
    fighterLadders: fighterLadderMap(),
    skillLadders: skillLadderMap(sys.builder),
    titles: sys.levels ?? [],
  });
}

/** One human line per derived field, for the confirm dialog. */
function planLines(plan) {
  const L = (k, data) => game.i18n.format(`${LANG_PREFIX}.builder.derived.${k}`, data ?? {});
  const u = plan.update;
  const lines = [];
  if (u.maximumLevel != null) lines.push(L("maximumLevel", { value: u.maximumLevel }));
  if (u.hitDie) lines.push(L("hitDie", { value: u.hitDie }));
  if (u.levels) lines.push(L("levels", { count: u.levels.length, base: plan.summary.baseXp }));
  if (u.attack) lines.push(L("attack", { count: u.attack.length }));
  if (u.saveChassis) lines.push(L("saveChassis", { value: u.saveChassis }));
  if (u.cleaves) lines.push(L("cleaves"));
  if (u.casting) lines.push(L("casting", { count: u.casting.length }));
  if (u["inventory.skills"]) lines.push(L("skills", { count: u["inventory.skills"].length }));
  if (u.racialTraits) lines.push(L("racialTraits", { count: u.racialTraits.length }));
  if (u.ladders) lines.push(L("ladders", { keys: u.ladders.map((l) => l.key).join(", ") }));
  if (u.requirements) lines.push(L("requirements", { count: u.requirements.length }));
  return lines;
}

/** Localize one engine issue. */
export function issueLabel(issue) {
  return game.i18n.format(`${LANG_PREFIX}.builder.issues.${issue.key}`, issue);
}

/**
 * Derive and write: shows the plan (every field it will set, every issue the
 * tables left open) and applies it as one update on confirm.
 * @returns {Promise<boolean>} whether the write happened
 */
export async function applyBuilder(classItem) {
  const plan = planFor(classItem);
  const lines = planLines(plan);
  const issues = plan.issues.map(issueLabel);
  const esc = foundry.utils.escapeHTML;
  const content = [
    `<p>${esc(game.i18n.localize(`${LANG_PREFIX}.builder.confirmIntro`))}</p>`,
    `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`,
    issues.length
      ? `<p><strong>${esc(game.i18n.localize(`${LANG_PREFIX}.builder.issuesHead`))}</strong></p><ul>${issues.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
      : "",
  ].join("");
  if (!lines.length) {
    ui.notifications.warn(game.i18n.localize(`${LANG_PREFIX}.builder.nothingDerived`));
    return false;
  }
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.builder.confirmTitle`) },
    content,
    modal: true,
  });
  if (!ok) return false;
  const update = {};
  for (const [path, value] of Object.entries(plan.update)) update[`system.${path}`] = value;
  await classItem.update(update);
  return true;
}

/** Declare the tables the builder reads, so import UX can name a gap. */
export function registerBuilderExpectations() {
  expectTables(BUILDER_DOC_ID, BUILDER_TABLE_IDS);
}
