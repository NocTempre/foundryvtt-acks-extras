/* global foundry, game, CONFIG, Handlebars, Hooks, console */
/**
 * This module's sub-types answer to this module's sheets, whatever a world
 * has stored.
 *
 * A stored default outranks `makeDefault` permanently: Foundry's
 * `DocumentSheetConfig.#registerSheet` reads `core.sheetClasses` and, where
 * that setting names a sheet for a type, uses it INSTEAD of the registration's
 * own claim — for every registration made afterwards, forever. A world whose
 * setting names a foreign sheet for one of this module's sub-types therefore
 * opens that sheet however many times this module registers its own.
 *
 * For these sub-types that is never a preference, because no foreign sheet can
 * render one: the system's item sheet builds its details partial from the
 * document's type (`details-<type>.hbs`), and no such file exists outside the
 * module that defines the type. The render throws, the window never opens, and
 * nothing says why. So the default is taken back on every client, the stored
 * pin is cleared once by the primary GM, and a partial is registered under the
 * name the system's sheet asks for so the remaining routes to a foreign sheet
 * — a single document pinned through its own `core.sheetClass` flag — degrade
 * to a note instead of a thrown render.
 *
 * Runs LAST: it is imported at the end of `scripts/module.mjs`, so its ready
 * hook is registered after every feature's and fires after the ready-time sheet
 * registrations it has to outlast.
 */
import { MODULE_ID } from "./constants.mjs";
import { isPrimaryGM } from "./util.mjs";

/** The document collections whose sub-types this module defines. */
const DOCUMENT_NAMES = ["Actor", "Item"];

/** Every sheet id this module registers starts with the module id. */
const ours = (id) => typeof id === "string" && id.startsWith(`${MODULE_ID}.`);

/**
 * Take the default back for each of this module's sub-types that a stored
 * preference handed to a foreign sheet, and drop the sheets already built from
 * it. Client-side only — a player's seat repairs itself without waiting for a
 * GM.
 * @returns {Array<{documentName: string, type: string, from: string|null, to: string}>}
 *   One entry per sub-type reclaimed.
 */
export function reclaimSubtypeSheets() {
  const reclaimed = [];
  for (const documentName of DOCUMENT_NAMES) {
    const classes = CONFIG[documentName]?.sheetClasses ?? {};
    for (const [type, sheets] of Object.entries(classes)) {
      if (!type.startsWith(`${MODULE_ID}.`)) continue;
      const registered = Object.values(sheets ?? {});
      const mine = registered.filter((sheet) => ours(sheet.id));
      if (!mine.length) {
        console.error(
          `${MODULE_ID} | no sheet is registered for the ${documentName} sub-type ${type}; ` +
            `it cannot be opened. Something threw while this module loaded — the first error above is the cause.`,
        );
        continue;
      }
      if (mine.some((sheet) => sheet.default)) continue;
      const held = registered.find((sheet) => sheet.default);
      registered.forEach((sheet) => {
        sheet.default = false;
      });
      mine[0].default = true;
      reclaimed.push({ documentName, type, from: held?.id ?? null, to: mine[0].id });
    }
  }
  if (!reclaimed.length) return reclaimed;

  // A document that already cached a sheet built from the displaced default
  // keeps rendering it. Same treatment core gives a default it changes itself.
  for (const { documentName, type } of reclaimed) {
    const collection = CONFIG[documentName]?.collection?.instance ?? [];
    for (const document of collection) {
      if (document.type !== type) continue;
      for (const app of Object.values(document.apps ?? {})) app.close();
      document._sheet = null;
    }
  }
  for (const { documentName, type, from, to } of reclaimed) {
    console.warn(
      `${MODULE_ID} | ${documentName} sub-type ${type} was set to open on ${from ?? "no sheet"}, ` +
        `which cannot render it; opening on ${to}.`,
    );
  }
  return reclaimed;
}

/**
 * Remove the stored pins that caused it, so the sheet configuration window
 * agrees with what actually opens. Only this module's sub-types, only where the
 * stored sheet is not one of this module's — a GM who picked between two sheets
 * of ours keeps that choice, and the choice is offered again on every sheet's
 * own configuration.
 * @returns {Promise<string[]>} The pins removed, as `Document.type → sheet id`.
 */
export async function clearForeignSheetPins() {
  if (!isPrimaryGM()) return [];
  const stored = game.settings.get("core", "sheetClasses") ?? {};
  const next = foundry.utils.deepClone(stored);
  const cleared = [];
  for (const documentName of DOCUMENT_NAMES) {
    const pins = next[documentName];
    if (!pins) continue;
    for (const [type, id] of Object.entries(pins)) {
      if (!type.startsWith(`${MODULE_ID}.`) || ours(id)) continue;
      delete pins[type];
      cleared.push(`${documentName}.${type} → ${id}`);
    }
  }
  if (!cleared.length) return cleared;
  await game.settings.set("core", "sheetClasses", next);
  console.log(`${MODULE_ID} | cleared stored sheet choices that no sheet can render: ${cleared.join(", ")}.`);
  return cleared;
}

/**
 * Register a fallback under the partial name the system's item sheet builds
 * from a document's type, for every item sub-type this module defines.
 *
 * The system's description tab renders `{{> (getDetailsPartialPath) }}`, which
 * resolves to `systems/<system>/templates/items/v2/details/details-<type>.hbs`.
 * A name Handlebars cannot resolve throws and takes the whole window with it,
 * so the name resolves — to a note saying where the type's fields are. Never
 * overwrites a partial that already exists: a system that ships one for a type
 * has answered the question itself.
 */
export async function registerForeignDetailsFallback() {
  const types = Object.keys(CONFIG.Item?.dataModels ?? {}).filter((type) => type.startsWith(`${MODULE_ID}.`));
  if (!types.length) return;
  const template = await foundry.applications.handlebars.getTemplate(
    `modules/${MODULE_ID}/templates/lib/foreign-details.hbs`,
  );
  for (const type of types) {
    const name = `systems/${game.system.id}/templates/items/v2/details/details-${type}.hbs`;
    if (Handlebars.partials[name]) continue;
    Handlebars.registerPartial(name, template);
  }
}

Hooks.once("ready", async () => {
  try {
    await registerForeignDetailsFallback();
  } catch (err) {
    console.error(`${MODULE_ID} | the details fallback could not be registered`, err);
  }
  try {
    if (reclaimSubtypeSheets().length) await clearForeignSheetPins();
  } catch (err) {
    console.error(`${MODULE_ID} | this module's sub-type sheets could not be reclaimed`, err);
  }
});
