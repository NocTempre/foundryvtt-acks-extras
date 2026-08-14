/* global game, foundry, Hooks, CONFIG, Actor */
/**
 * ACKS II — Full Monster Sheet.
 *
 * At ready we resolve the system's own registered monster sheet and register a
 * SUBCLASS of it — adding tabs for the extended stat block — as the DEFAULT
 * sheet for `monster` and for the library's `animal` sub-type. No new document
 * sub-type; nothing mutates the acks system. Extended data lives in
 * `flags["acks-extras"].extras`.
 *
 * Safe to default: the subclass keeps every tab the system's sheet defines, so
 * enabling this module adds the extended stat block and takes nothing away. The
 * system's plain sheet stays selectable per-actor from Sheet Configuration.
 *
 * The animal borrows this sheet for the same reason it borrows the system's:
 * its combat block mirrors the monster's field paths exactly (lib/data/
 * animal-data.mjs), so a monster sheet reads an animal unchanged. lib registers
 * the system's plain sheet for `animal` first; this registration runs later
 * (monsters is imported last) and takes the default over from it.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, FLAG_EXTRAS, MONSTER_TYPE } from "./constants.mjs";
import { createFullMonsterSheet } from "./monster-sheet.mjs";
import MonsterExtras from "./monster-extras.mjs";
import { registerItemAnnotations } from "./item-annotations.mjs";
import * as config from "./config.mjs";

/** The dynamically-created sheet class (base is resolved at init). */
let FullMonsterSheet = null;

/** The actor types the sheet was actually registered for (resolved at ready). */
let sheetTypes = [MONSTER_TYPE];

/** Register the module's Handlebars helpers. */
function registerHelpers() {
  const Handlebars = globalThis.Handlebars;
  if (!Handlebars) return;
  // Value-or-dash that treats a real 0 as a value (only null/""/undefined dash).
  Handlebars.registerHelper("acksExtrasVal", (value, dash) => {
    const fallback = typeof dash === "string" ? dash : "—";
    return value === null || value === undefined || value === "" ? fallback : value;
  });
  // Membership test for <multi-checkbox> option `selected` state.
  Handlebars.registerHelper("acksExtrasHas", (list, key) => Array.isArray(list) && list.includes(key));
}

/**
 * Resolve the system's default monster sheet class (our base to extend).
 *
 * Only the SYSTEM's sheets are candidates — registry keys are `<scope>.<class>`
 * and only scope `acks` qualifies. This module registers into the same map (this
 * sheet, and lib's Follower Card), and a resolution that accepted one of ours
 * would subclass this module's own output, growing a fresh layer on every
 * reload; a third party's sheet is just as wrong a base. Never widen this to
 * the whole registry. Absence returns null, and the caller skips registration.
 */
function resolveMonsterSheetBase() {
  const registered = CONFIG.Actor?.sheetClasses?.monster ?? {};
  const entries = Object.entries(registered)
    .filter(([key]) => key.startsWith("acks."))
    .map(([, entry]) => entry);
  const defaulted = entries.find((e) => e.default) ?? null;
  const chosen = defaulted ?? entries[0] ?? null;
  // Registry order is not a choice: when several candidates remain and none is
  // flagged default, name the class adopted so a wrong base is diagnosable from
  // the console. A lone candidate is unambiguous — this module's own later
  // makeDefault registrations legitimately clear the system entry's flag, and
  // warning on that expected state would cry wolf every load.
  if (!defaulted && entries.length > 1) {
    console.warn(`${MODULE_ID} | no acks monster sheet is flagged default; extending ${chosen.cls?.name} by registry order.`);
  }
  return chosen?.cls ?? null;
}

Hooks.once("init", () => {
  registerHelpers();
  registerItemAnnotations();

  // Public API for consumer modules (which add behavior on this stored data).
  const api = {
    MODULE_ID,
    FLAG_EXTRAS,
    get FullMonsterSheet() {
      return FullMonsterSheet;
    },
    MonsterExtras,
    config,
    /** Read the extended stat block for an actor (a MonsterExtras instance). */
    getExtras: (actor) => MonsterExtras.fromActor(actor),
  };
  acksExtras.monsters = api;

  // Best-effort template preload (added tabs; base tabs preload with the system).
  try {
    const T = `modules/${MODULE_ID}/templates/monsters`;
    foundry.applications.handlebars.loadTemplates([
      `${T}/tab-classification.hbs`,
      `${T}/tab-attacks.hbs`,
      `${T}/tab-abilities.hbs`,
      `${T}/tab-inventory.hbs`,
      `${T}/tab-spoils.hbs`,
      `${T}/tab-defenses.hbs`,
      `${T}/tab-ecology.hbs`,
      `${T}/tab-henchman.hbs`,
      `${T}/tab-description.hbs`,
    ]);
  } catch (err) {
    console.warn(`${MODULE_ID} | template preload skipped`, err);
  }
});

/*
 * Sheet registration happens at READY, not init: Foundry v14 defers every
 * DocumentSheetConfig.registerSheet call made before `game.ready` into a
 * pending queue that is only flushed by DocumentSheetConfig.initializeSheets()
 * (late in setupGame). CONFIG.Actor.sheetClasses is therefore EMPTY during
 * init/setup and the system's monster sheet — our base class — can only be
 * resolved here. Registering at ready takes the immediate (non-queued) path.
 */
Hooks.once("ready", () => {
  if (!assertAcksSystem("the Full Monster sheet expects acks monster actors.")) return;
  const Base = resolveMonsterSheetBase();
  if (!Base) {
    console.error(`${MODULE_ID} | could not resolve the acks monster sheet; Full Monster sheet NOT registered.`);
    return;
  }
  FullMonsterSheet = createFullMonsterSheet(Base);
  // The `animal` sub-type belongs to lib; read it off the published API rather
  // than importing lib here, so an absent library degrades to monsters alone
  // instead of throwing.
  const animalType = acksExtras.lib?.ANIMAL_TYPE;
  sheetTypes = animalType ? [MONSTER_TYPE, animalType] : [MONSTER_TYPE];
  const label = game.i18n.localize("ACKS-MONSTERS.sheet.full");

  // A MONSTER lands on lib's Follower Card and expands to this — so this sheet is
  // registered for the type but does not claim the default. Claiming it here as
  // well would make the landing sheet depend on which subsystem's `ready` handler
  // ran last, which is not a thing to leave to import order.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FullMonsterSheet, {
    types: [MONSTER_TYPE],
    makeDefault: false,
    label,
  });
  if (animalType) {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FullMonsterSheet, {
      types: [animalType],
      makeDefault: true,
      label,
    });
  }
  console.log(`${MODULE_ID} | Full Monster sheet registered for ${sheetTypes.join("/")} (default for ${animalType ?? "none"}).`);

  // One-time GM sweep: pre-4.0 defence bands stored `effects` as free prose and
  // had no `conditions` set. Shape-gated — it fires only for an actor whose
  // band still holds a STRING there, and the write it makes no longer matches,
  // so it cannot fire twice. Prose tokens that name a known effect or condition
  // become set members; what does not parse is prepended to the band's note, so
  // nothing printed is lost.
  if (game.user.isGM) migrateDefenseBands().catch((err) => console.error(`${MODULE_ID} | defence-band migration failed`, err));
});

/** Parse one legacy free-prose effects string into the closed sets. */
function parseLegacyEffects(prose) {
  const effects = new Set();
  const conditions = new Set();
  const leftovers = [];
  for (const token of String(prose).split(",").map((t) => t.trim()).filter(Boolean)) {
    const lower = token.toLowerCase();
    const eff = Object.entries(config.EFFECT_KEYS).find(([k, v]) => lower === k.toLowerCase() || lower === v.label.toLowerCase());
    const cond = Object.entries(config.CONDITION_KEYS).find(([k, v]) => lower === k.toLowerCase() || lower === v.label.toLowerCase());
    if (eff) effects.add(eff[0]);
    else if (cond) conditions.add(cond[0]);
    else leftovers.push(token);
  }
  return { effects: [...effects], conditions: [...conditions], leftover: leftovers.join(", ") };
}

async function migrateDefenseBands() {
  const updates = [];
  for (const actor of game.actors) {
    const defenses = actor.flags?.[MODULE_ID]?.[FLAG_EXTRAS]?.defenses;
    if (!defenses) continue;
    const patch = {};
    for (const band of ["immunities", "resistances", "susceptibilities"]) {
      const old = defenses[band];
      if (typeof old?.effects !== "string" || old.effects === "") {
        // An empty-string legacy field still needs its type moved.
        if (typeof old?.effects === "string") patch[`${band}.effects`] = [];
        continue;
      }
      const { effects, conditions, leftover } = parseLegacyEffects(old.effects);
      patch[`${band}.effects`] = effects;
      patch[`${band}.conditions`] = conditions;
      if (leftover) patch[`${band}.note`] = old.note ? `${leftover}; ${old.note}` : leftover;
    }
    if (Object.keys(patch).length) {
      const flat = {};
      for (const [k, v] of Object.entries(patch)) flat[`flags.${MODULE_ID}.${FLAG_EXTRAS}.defenses.${k}`] = v;
      updates.push({ _id: actor.id, ...flat });
    }
  }
  if (!updates.length) return;
  await Actor.updateDocuments(updates);
  console.log(`${MODULE_ID} | defence bands migrated on ${updates.length} actor(s): prose effects became sets, remainders kept in notes.`);
}

/* Actor-directory convenience: open the Full Monster sheet directly. */
Hooks.on("getActorContextOptions", (_directory, options) => {
  const findActor = (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
    return id ? game.actors.get(id) : null;
  };
  options.push({
    label: "ACKS-MONSTERS.context.openFull",
    icon: '<i class="fa-solid fa-dragon"></i>',
    visible: (li) => !!FullMonsterSheet && sheetTypes.includes(findActor(li)?.type),
    onClick: (_event, li) => {
      const actor = findActor(li);
      if (actor && FullMonsterSheet) new FullMonsterSheet({ document: actor }).render(true);
    },
  });
});
