/* global Hooks, game, ui, foundry */
/**
 * ACKS II — Equipment & Fighting Styles: bootstrap.
 *
 * init  — settings, public API, template preload.
 * setup — libWrapper roll wrap (Phase 3).
 * ready — system guard, socketlib, paper-doll wiring (Phase 4), initial
 *         loadout sync, equip-enforcement hooks.
 */
import { MODULE_ID, SETTINGS, LOADOUT_EFFECT_FLAG } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { buildApi } from "./api.mjs";
import { onPreUpdateItem, onUpdateItem, refreshLoadout, primaryResponder, managesLoadout } from "./enforce.mjs";
import { registerRollWrap } from "./roll-wrap.mjs";
import { registerSheet } from "./sheet.mjs";
import { registerEquipmentItemSheet } from "./item-sheet.mjs";
import { advanceWieldedOnLevelUp } from "./overlays/named.mjs";

/** True on exactly one client: the active GM responsible for automation. */
function isPrimaryGM() {
  return game.users.activeGM?.isSelf ?? false;
}

Hooks.once("init", () => {
  registerSettings();
  buildApi();

  try {
    foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/equipment/loadout-summary.hbs`]);
  } catch (err) {
    console.warn(`${MODULE_ID} | template preload skipped`, err);
  }
});

Hooks.once("setup", () => {
  if (!game.settings.get(MODULE_ID, SETTINGS.ROLL_AUTOMATION)) return;
  try {
    registerRollWrap();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register roll wrapper`, err);
  }
});

Hooks.once("ready", async () => {
  if (game.system?.id !== "acks") {
    console.warn(`${MODULE_ID} | Active system is not "acks"; equipment automation is inert.`);
    return;
  }

  // Wear-location buckets on the core character sheet. Independent of the Paper
  // Doll — the doll is an optional input device, the sheet is where every table
  // already reads its gear.
  try {
    registerSheet();
  } catch (err) {
    console.error(`${MODULE_ID} | sheet integration failed`, err);
  }

  // The equipment ITEM sheet — a subclass of the system's own item sheet (the
  // acks-abilities precedent) restructuring weapon/armor/item sheets into
  // Description / Rolls / Construction (/ Spells on a spell book) / Effects,
  // with the named-item and apparent-identity overlays on the header. At ready,
  // not init: CONFIG.Item.sheetClasses is empty until the pending registrations
  // flush, so the base class can only be resolved here.
  try {
    registerEquipmentItemSheet();
  } catch (err) {
    console.error(`${MODULE_ID} | equipment item sheet failed to register; core's item sheet stands`, err);
  }

  // A held light occupies a hand: when acks-formation lights/douses/burns out a
  // source, recompute that bearer's loadout so hands-used reflects it. The read
  // half is loadout.heldLightHands; this keeps it live. Optional — the hook
  // simply never fires without acks-formation.
  Hooks.on("acksFormation.lightChanged", (actor) => {
    if (actor?.type === "character" && actor.isOwner) {
      refreshLoadout(actor).catch((err) => console.error(`${MODULE_ID} | light-change loadout sync failed`, err));
    }
  });

  // Rebuild loadout effects for owned characters on load (repairs after config
  // changes, migrations, or a session where enforcement was off).
  const owned = game.actors.filter((a) => a.type === "character" && a.isOwner);
  for (const actor of owned) {
    refreshLoadout(actor).catch((err) => console.error(`${MODULE_ID} | initial loadout sync failed for ${actor.name}`, err));
  }

  // One-time hygiene: earlier builds (before the character-only guard) could
  // strand managed loadout effect(s) on a non-character actor — e.g. a monster
  // whose embedded items another module rewrote, sometimes several duplicates.
  // Remove every such stray in a single pass.
  for (const actor of game.actors.filter((a) => a.type !== "character" && a.isOwner)) {
    if (!primaryResponder(actor)) continue;
    const strays = actor.effects.filter((e) => e.getFlag?.(MODULE_ID, LOADOUT_EFFECT_FLAG) === true).map((e) => e.id);
    if (strays.length) {
      actor
        .deleteEmbeddedDocuments("ActiveEffect", strays)
        .then(() => console.log(`${MODULE_ID} | removed ${strays.length} stray loadout effect(s) from ${actor.name} (${actor.type}).`))
        .catch((err) => console.warn(`${MODULE_ID} | could not remove stray loadout effects on ${actor.name}`, err));
    }
  }
});

/* -------------------------------------------- */
/*  Equip-limit enforcement                      */
/* -------------------------------------------- */

Hooks.on("preUpdateItem", (item, changes) => {
  try {
    return onPreUpdateItem(item, changes);
  } catch (err) {
    console.error(`${MODULE_ID} | preUpdateItem enforcement failed`, err);
    return true;
  }
});

Hooks.on("updateItem", (item, changes) => {
  onUpdateItem(item, changes).catch((err) => console.error(`${MODULE_ID} | updateItem enforcement failed`, err));
});

/* Items that affect the loadout: worn gear (weapon/armor) and proficiencies
 * (ability items carrying flags.acks-equipment.* markers). */
const LOADOUT_ITEM_TYPES = ["weapon", "armor", "ability"];
function onLoadoutItemChange(item) {
  const actor = item?.parent;
  if (
    actor?.documentName === "Actor" &&
    managesLoadout(actor) &&
    primaryResponder(actor) &&
    LOADOUT_ITEM_TYPES.includes(item.type)
  ) {
    refreshLoadout(actor).catch((err) => console.error(`${MODULE_ID} | item loadout sync failed`, err));
  }
}
Hooks.on("createItem", onLoadoutItemChange);
Hooks.on("deleteItem", onLoadoutItemChange);

/* Proficiency/style config lives in actor flags — rebuild when it changes.
 * A level-up also advances any named item the actor is wielding: RAW counts
 * levels of experience EARNED while wielding, so it keys off the change itself
 * rather than the actor's absolute level. */
Hooks.on("updateActor", (actor, changes) => {
  if (!primaryResponder(actor)) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) {
    refreshLoadout(actor).catch((err) => console.error(`${MODULE_ID} | actor-flag loadout sync failed`, err));
  }
  if (foundry.utils.hasProperty(changes, "system.details.level")) {
    advanceNamedOnLevelUp(actor).catch((err) => console.error(`${MODULE_ID} | named-item advancement failed`, err));
  }
});

/** Unlock one further rung on each wielded named item (JJ p. 399). */
async function advanceNamedOnLevelUp(actor) {
  if (!game.settings.get(MODULE_ID, SETTINGS.OVERLAY_NAMED)) return;
  const advances = advanceWieldedOnLevelUp(actor);
  for (const { item, updates } of advances) {
    await item.update(updates);
    ui.notifications?.info(
      game.i18n.has("ACKS-EQUIPMENT.notify.namedAdvanced")
        ? game.i18n.format("ACKS-EQUIPMENT.notify.namedAdvanced", { item: item.name, name: actor.name })
        : `${item.name} reveals more of its power to ${actor.name}.`,
    );
  }
}

/* Toggling/editing a proficiency's Active Effect changes the loadout too.
 * Skip our OWN managed loadout effect to avoid a rebuild loop. */
function effectActor(effect) {
  const p = effect?.parent;
  if (p?.documentName === "Actor") return p;
  if (p?.documentName === "Item" && p.parent?.documentName === "Actor") return p.parent;
  return null;
}
for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, (effect) => {
    if (effect?.getFlag?.(MODULE_ID, LOADOUT_EFFECT_FLAG)) return; // our managed effect
    const actor = effectActor(effect);
    if (actor && primaryResponder(actor)) {
      refreshLoadout(actor).catch((err) => console.error(`${MODULE_ID} | effect loadout sync failed`, err));
    }
  });
}

export { isPrimaryGM };
