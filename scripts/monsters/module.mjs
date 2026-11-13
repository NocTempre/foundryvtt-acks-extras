/* global game, foundry, Hooks, CONFIG, Actor */
/**
 * ACKS II — Full Monster Sheet.
 *
 * At ready we resolve the system's own registered monster sheet and register a
 * SUBCLASS of it — the lib's sheet frame around the extended stat block — for
 * `monster` and as the DEFAULT sheet for the library's `animal` sub-type. No
 * new document sub-type; nothing mutates the acks system. Extended data lives
 * in `flags["acks-extras"].extras`.
 *
 * See docs/monsters/DECISIONS.md for why this sheet defaults on both types.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, FLAG_EXTRAS, MONSTER_TYPE } from "./constants.mjs";
import { createFullMonsterSheet, MONSTER_SHEET_TEMPLATES } from "./monster-sheet.mjs";
import MonsterExtras from "./monster-extras.mjs";
import { registerItemAnnotations } from "./item-annotations.mjs";
import * as config from "./config.mjs";
import { escape, findActor, makeLoc, primaryGMSettled } from "../lib/util.mjs";
import { FOLLOWER_CARD_HOOK } from "../lib/follower-card.mjs";
import { expectTables } from "../lib/tables.mjs";
import { TEMPLATE_HOOKS } from "../lib/constants.mjs";
import { applyGeneratedKit, importedKits } from "./kits.mjs";

const loc = makeLoc("ACKS-MONSTERS");

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
 * Only entries keyed `acks.*` qualify — this module registers into the same
 * registry (this sheet, and lib's Follower Card), so an unfiltered lookup
 * could pick one of ours and subclass its own output. Absence returns null,
 * and the caller skips registration.
 */
function resolveMonsterSheetBase() {
  const registered = CONFIG.Actor?.sheetClasses?.monster ?? {};
  const entries = Object.entries(registered)
    .filter(([key]) => key.startsWith("acks."))
    .map(([, entry]) => entry);
  const defaulted = entries.find((e) => e.default) ?? null;
  const chosen = defaulted ?? entries[0] ?? null;
  // A lone candidate is unambiguous even though nothing flagged it default —
  // this module's own later makeDefault registrations clear the system
  // entry's flag as expected. Only warn when the pick among several is a
  // guess, so the console names which class a wrong base would be.
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

  // The figures a leader and a ladder row are worked out from are imported;
  // the import names these tables as missing until the Judge's books supply
  // them. The ids are `importer/leader-roles.mjs` THROW_LADDER_TABLE,
  // `leader-derive.mjs` LEADER_TABLES and `kits.mjs` KIT_TABLES, written as
  // literals because the producers gate reads this call from source. Guarded:
  // a throw in `init` leaves the rest of the hook dead.
  try {
    expectTables("monsters", ["attackThrowByHd", "leaderLadder", "leaderSteps", "beastmanTroops", "beastmenByType", "damageDieConversion"]);
  } catch (err) {
    console.warn(`${MODULE_ID} | monster tables not declared`, err);
  }

  // A generated creature in a kit takes the armour class worked out for a
  // kit no page prints, and the kit's own words in its notes, before it is
  // written.
  Hooks.on(TEMPLATE_HOOKS.RESOLVED, ({ resolved }) => {
    try {
      applyGeneratedKit(resolved, { kits: importedKits(), noteLine: (kit) => `<p>${loc("kit.note", { label: escape(kit.label ?? ""), note: escape(kit.note || "—"), cite: escape(kit.cite || "—") })}</p>` });
    } catch (err) {
      console.warn(`${MODULE_ID} | kit not applied`, err);
    }
  });

  // Best-effort preload of every partial the body includes: the sheet's own
  // tabs and the system's Spells and Effects, which the body includes as
  // partials rather than rendering as parts. The frame's partials preload
  // with the lib.
  try {
    foundry.applications.handlebars.loadTemplates([...MONSTER_SHEET_TEMPLATES]);
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
  // The `animal` sub-type belongs to lib; its id is read off the published API.
  const animalType = acksExtras.lib?.ANIMAL_TYPE;
  sheetTypes = animalType ? [MONSTER_TYPE, animalType] : [MONSTER_TYPE];
  const label = game.i18n.localize("ACKS-MONSTERS.sheet.full");

  // Registered for `monster` without claiming the default — a MONSTER lands
  // on lib's Follower Card, which expands into this sheet.
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

  // The import writes a band's `effects` as a joined string; the sweep turns
  // each into the closed sets the data model stores. Run by the one seat that
  // automates, shape-gated on a band whose `effects` is still a STRING, so a
  // later load finds nothing to do. See docs/monsters/DECISIONS.md, "Defence
  // bands adopt the shared shape; capacity answers once".
  primaryGMSettled()
    .then((primary) => primary && migrateDefenseBands())
    .catch((err) => console.error(`${MODULE_ID} | defence-band effects sweep failed`, err));
});

/** Parse one comma-joined effects string into the closed sets. */
function parseEffectsText(prose) {
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

/** Convert every actor's string-valued band `effects` into sets; unmatched words go to the band's note. */
async function migrateDefenseBands() {
  const updates = [];
  for (const actor of game.actors) {
    const defenses = actor.flags?.[MODULE_ID]?.[FLAG_EXTRAS]?.defenses;
    if (!defenses) continue;
    const patch = {};
    for (const band of ["immunities", "resistances", "susceptibilities"]) {
      const stored = defenses[band];
      if (typeof stored?.effects !== "string" || stored.effects === "") {
        // An empty string still needs its type moved.
        if (typeof stored?.effects === "string") patch[`${band}.effects`] = [];
        continue;
      }
      const { effects, conditions, leftover } = parseEffectsText(stored.effects);
      patch[`${band}.effects`] = effects;
      patch[`${band}.conditions`] = conditions;
      if (leftover) patch[`${band}.note`] = stored.note ? `${leftover}; ${stored.note}` : leftover;
    }
    if (Object.keys(patch).length) {
      const flat = {};
      for (const [k, v] of Object.entries(patch)) flat[`flags.${MODULE_ID}.${FLAG_EXTRAS}.defenses.${k}`] = v;
      updates.push({ _id: actor.id, ...flat });
    }
  }
  if (!updates.length) return;
  await Actor.updateDocuments(updates);
  console.log(`${MODULE_ID} | defence-band effects read into sets on ${updates.length} actor(s); remainders kept in notes.`);
}

/* The Follower Card asks what a feature knows of the actor: a creature's
 * saves-as class and level, which live on this feature's extras. */
Hooks.on(FOLLOWER_CARD_HOOK, (actor, ctx) => {
  if (!sheetTypes.includes(actor?.type)) return;
  const saveAs = MonsterExtras.fromActor(actor)?.saveAs ?? {};
  if (!saveAs.class) return;
  const cls = game.i18n.localize(config.SAVE_CLASSES[saveAs.class]?.label ?? saveAs.class);
  const level = saveAs.levelMax != null && saveAs.levelMax !== saveAs.level ? `${Number(saveAs.level) || 0}–${Number(saveAs.levelMax) || 0}` : `${Number(saveAs.level) || 0}`;
  ctx.savesAs = game.i18n.format("ACKS-MONSTERS.frame.art.savesAs", { cls, level });
});

/* Actor-directory convenience: open the Full Monster sheet directly. */
Hooks.on("getActorContextOptions", (_directory, options) => {
  options.push({
    label: "ACKS-MONSTERS.context.openFull",
    icon: '<i class="fa-solid fa-dragon"></i>',
    visible: (li) => !!FullMonsterSheet && sheetTypes.includes(findActor(li)?.type),
    onClick: (_event, li) => {
      const actor = findActor(li);
      if (!actor || !FullMonsterSheet) return;
      // A second instance over the same actor carries the first's frame id and
      // replaces its element, stranding it; an open one is raised instead.
      const open = Object.values(actor.apps ?? {}).find((app) => app.constructor === FullMonsterSheet);
      if (open) {
        open.render(true);
        open.bringToFront?.();
        return;
      }
      new FullMonsterSheet({ document: actor }).render(true);
    },
  });
});
