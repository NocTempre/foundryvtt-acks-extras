/* global game, CONFIG, foundry, ui */
/**
 * The UI preset: whose defaults a world opens on — Foundry's, the system's,
 * or this module's — chosen once by the Judge and holding for every seat.
 *
 * A preset is two things. The world's default LOOK: `lib/module.mjs` reads
 * `effectiveLook` wherever it used to read the client's `look` setting, and a
 * client whose `look` says `world` draws what the preset says. And the world's
 * default SHEET for every Actor and Item type, resolved by the ladder in
 * ui-preset-logic.mjs and written into
 * `CONFIG.<Document>.sheetClasses[type][id].default` — the flag
 * `ClientDocument#_getSheetClass` reads — by `applySheetLadder`.
 *
 * Two things outrank the ladder, both a Judge's explicit act through Foundry's
 * own UI: a type pinned in `core.sheetClasses` (Configure Default Sheets)
 * keeps its pin, and a document carrying a `core.sheetClass` flag keeps its
 * sheet. Applying a preset from the prompt or the setting drops the pins that
 * name a ladder sheet so the ladder governs again; a third-party pin stays.
 *
 * The ladder runs from a `ready` hook registered during `init`, which places it
 * after every ready-time registration in this module (those hooks are all
 * registered at import time, before init), and again on every client when the
 * preset changes.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { makeLoc, isPrimaryGM } from "./util.mjs";
import { UI_PRESET, RUNG, presetLook, chooseDefault, declaredDefaults } from "./ui-preset-logic.mjs";

export { UI_PRESET, presetLook };

const loc = makeLoc(LANG_PREFIX);

/** The world setting holding the preset. */
export const PRESET_SETTING = "uiPreset";
/** The world setting recording that the prompt has been answered. */
export const PROMPTED_SETTING = "uiPresetPrompted";

const PROMPT_TEMPLATE = `modules/${MODULE_ID}/templates/lib/ui-preset-prompt.hbs`;

/** The documents both this module and the system register sheets for. */
const LADDER_DOCUMENTS = Object.freeze(["Actor", "Item"]);

/** Each type's rung-declared defaults, captured before the first re-flag moves them. */
const declared = new Map();

function rungOf(id) {
  if (id.startsWith(`${MODULE_ID}.`)) return RUNG.extras;
  if (id.startsWith(`${game.system.id}.`)) return RUNG.core;
  if (id.startsWith("core.")) return RUNG.foundry;
  return null;
}

/** The world's preset; this module's sheets before the setting is registered. */
export function uiPreset() {
  try {
    return game.settings.get(MODULE_ID, PRESET_SETTING);
  } catch {
    return UI_PRESET.extras;
  }
}

/** The look this client draws: its own `look` setting, or the preset's when that says `world`. */
export function effectiveLook() {
  const own = game.settings.get(MODULE_ID, "look");
  return own === "world" ? presetLook(uiPreset()) : own;
}

function sheetsOf(entries) {
  return Object.entries(entries).map(([id, e]) => ({
    id,
    rung: rungOf(id),
    default: !!e.default,
    canBeDefault: e.canBeDefault !== false,
  }));
}

/**
 * Flag each Actor and Item type's default sheet from the preset.
 * @returns {string[]} the document names whose flags moved.
 */
export function applySheetLadder(preset = uiPreset()) {
  const stored = game.settings.get("core", "sheetClasses") ?? {};
  const moved = new Set();
  for (const doc of LADDER_DOCUMENTS) {
    for (const [type, entries] of Object.entries(CONFIG[doc]?.sheetClasses ?? {})) {
      const pin = stored?.[doc]?.[type];
      if (pin && entries[pin]) continue;
      const sheets = sheetsOf(entries);
      const key = `${doc}:${type}`;
      if (!declared.has(key)) declared.set(key, declaredDefaults(sheets));
      const id = chooseDefault(sheets, preset, declared.get(key));
      if (!id || entries[id].default) continue;
      for (const [eid, e] of Object.entries(entries)) e.default = eid === id;
      moved.add(doc);
    }
  }
  return [...moved];
}

/** Close and forget every world document's sheet in `docs`, as core does when a default changes. */
function resheet(docs) {
  for (const doc of docs) {
    for (const document of CONFIG[doc]?.collection?.instance ?? []) {
      for (const app of Object.values(document.apps ?? {})) app.close();
      document._sheet = null;
    }
  }
}

/** Apply the ladder for `preset` and re-sheet what moved. */
export function refreshSheetDefaults(preset = uiPreset()) {
  const moved = applySheetLadder(preset);
  if (moved.length) resheet(moved);
  return moved;
}

/**
 * Set the world's preset. Drops the `core.sheetClasses` pins naming a ladder
 * sheet so the ladder governs again; the preset's own onChange re-flags every
 * other client, and this one is re-flagged here because onChange fires only on
 * a changed value while dropped pins alone still move a default.
 * @returns {Promise<boolean>} whether anything a sheet reads changed.
 */
export async function applyUiPreset(preset) {
  const stored = foundry.utils.deepClone(game.settings.get("core", "sheetClasses") ?? {});
  let unpinned = false;
  for (const doc of LADDER_DOCUMENTS) {
    for (const [type, id] of Object.entries(stored[doc] ?? {})) {
      if (typeof id === "string" && rungOf(id)) {
        delete stored[doc][type];
        unpinned = true;
      }
    }
  }
  if (unpinned) await game.settings.set("core", "sheetClasses", stored);
  const was = uiPreset();
  await game.settings.set(MODULE_ID, PRESET_SETTING, preset);
  await game.settings.set(MODULE_ID, PROMPTED_SETTING, true);
  const moved = refreshSheetDefaults(preset);
  return unpinned || was !== preset || moved.length > 0;
}

/**
 * Register the two world settings.
 * @param {{onLookChange?: Function}} hooks `onLookChange` re-dresses this client when the preset moves.
 */
export function registerUiPresetSettings({ onLookChange } = {}) {
  game.settings.register(MODULE_ID, PRESET_SETTING, {
    name: `${LANG_PREFIX}.settings.uiPreset.name`,
    hint: `${LANG_PREFIX}.settings.uiPreset.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      [UI_PRESET.foundry]: `${LANG_PREFIX}.settings.uiPreset.foundry`,
      [UI_PRESET.core]: `${LANG_PREFIX}.settings.uiPreset.acksCore`,
      [UI_PRESET.extras]: `${LANG_PREFIX}.settings.uiPreset.acksExtras`,
    },
    default: UI_PRESET.extras,
    requiresReload: true,
    onChange: (preset) => {
      refreshSheetDefaults(preset);
      onLookChange?.();
    },
  });
  game.settings.register(MODULE_ID, PROMPTED_SETTING, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
}

/**
 * The startup prompt: once per world, to the primary GM, until a choice is
 * made or the Judge asks not to be asked. Closing the window without choosing
 * asks again at the next launch.
 */
export async function promptUiPreset() {
  if (!isPrimaryGM()) return;
  if (game.settings.get(MODULE_ID, PROMPTED_SETTING)) return;
  const current = uiPreset();
  const options = [UI_PRESET.foundry, UI_PRESET.core, UI_PRESET.extras].map((value) => ({
    value,
    checked: value === current,
    name: loc(`settings.uiPreset.${value}`),
    hint: loc(`uiPreset.prompt.${value}`),
  }));
  const content = await foundry.applications.handlebars.renderTemplate(PROMPT_TEMPLATE, { options });
  const choice = await foundry.applications.api.DialogV2.wait({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("uiPreset.prompt.title"), icon: "fa-solid fa-palette" },
    position: { width: 560 },
    content,
    buttons: [
      {
        action: "apply",
        label: loc("uiPreset.prompt.apply"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (_ev, button) => button.form?.elements?.preset?.value || current,
      },
      { action: "keep", label: loc("uiPreset.prompt.keep"), icon: "fa-solid fa-bell-slash" },
    ],
    rejectClose: false,
  });
  if (!choice) return;
  if (choice === "keep") {
    await game.settings.set(MODULE_ID, PROMPTED_SETTING, true);
    return;
  }
  const changed = await applyUiPreset(choice);
  ui.notifications.info(loc("uiPreset.applied", { preset: loc(`settings.uiPreset.${choice}`) }));
  if (changed) await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
}
