/* global Hooks, foundry, Actor */
/**
 * The character sheet — this module's own window for `character` actors,
 * registered as this module's default for the type (DECISIONS 2026-09-03,
 * "The module's own character sheet, and it is the default"). Whether a
 * world opens on it is `lib/ui-preset.mjs`'s ladder; the system's own sheet
 * stays registered, and Sheet Config switches an actor back.
 *
 * Registered at `ready`, not `init`: Foundry flushes queued sheet
 * registrations late in setup, so a default claim has to land after the
 * system's own.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, LANG } from "./constants.mjs";
import { AcksCharacterSheet, CHARACTER_SHEET_TEMPLATES } from "./sheet.mjs";
import { rollInventory, rollById } from "./rolls.mjs";
import { snapshotFrame } from "./snapshot.mjs";
import { buildFrameModel } from "./view-model.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

Hooks.once("init", () => {
  try {
    foundry.applications.handlebars.loadTemplates([...CHARACTER_SHEET_TEMPLATES]);
  } catch (err) {
    console.warn(`${MODULE_ID} | character sheet template preload skipped`, err);
  }

  acksExtras.characterSheet = {
    /** The sheet class, for a macro that wants to open one directly. */
    Sheet: AcksCharacterSheet,
    /** Every throw the sheet lists for a character, with its stable id. */
    rollInventory,
    /** Make one of them by id — what the folded bar and the Rolls tab call. */
    rollById,
    /** The frame snapshot and the decisions made on it, for a live check. */
    snapshotFrame,
    buildFrameModel,
  };
});

Hooks.once("ready", () => {
  if (!assertAcksSystem("the character sheet expects acks character actors.")) return;
  try {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, AcksCharacterSheet, {
      types: [ACTOR_TYPE.character],
      makeDefault: true,
      label: `${LANG}.sheet.label`,
    });
    console.log(`${MODULE_ID} | character sheet registered (default for ${ACTOR_TYPE.character}).`);
  } catch (err) {
    console.error(`${MODULE_ID} | character sheet failed to register; the system's sheet stands`, err);
  }
});
