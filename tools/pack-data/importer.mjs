/**
 * Compendium document content for the importer subsystem, consumed by the
 * synced tools/build-packs.mjs harness. Registered as a feature in
 * tools/pack-data.mjs, whose aggregator concatenates this `macros` pack with
 * every other feature's into the one shared `macros` compendium.
 *
 * Macros wrap the importer's slice of the module api
 * (`globalThis.acksExtras.importer`) so a GM clicks instead of typing console
 * calls. Ids carry the declared "acksc" prefix and are exactly 16
 * alphanumerics; _stats timestamps are FIXED so rebuilds are byte-identical
 * (no pack churn).
 *
 * `_id` IS IDENTITY — never change one. A new id on an existing macro gives
 * every world that already imported the pack a duplicate. Rename freely; the id
 * stays. Dropping a macro from the pack is safe the same way: worlds that
 * imported it keep their copy, which keeps working through the api. `sort`
 * orders macros WITHIN their folder and is unique per folder — two equal keys
 * render in load order, which is no order at all.
 */

// Fixed epoch: 2026-07-17T00:00:00Z. Never change casually — churns packs.
const STATS = { coreVersion: "14", createdTime: 1784332800000, modifiedTime: 1784332800000 };

/**
 * Compendium folders. Same identity rule as macros: `_id` is forever (a new id
 * re-imports as a second folder), and it carries the "acksc" prefix the
 * namespacing gate enforces on every pack document.
 */
function folder(id, name, sort) {
  return {
    _id: id,
    _key: `!folders!${id}`,
    name,
    type: "Macro",
    folder: null,
    sorting: "m",
    sort,
    description: "",
    ownership: { default: 0 },
    flags: {},
    _stats: { ...STATS },
  };
}

const FOLDERS = {
  setup: "ackscFldSetup000",
  import: "ackscFldImport00",
};

function macro(id, name, img, command, sort = 0, folderId = null) {
  return {
    _id: id,
    _key: `!macros!${id}`,
    name,
    type: "script",
    img,
    scope: "global",
    command,
    folder: folderId,
    sort,
    ownership: { default: 2 },
    flags: {},
    _stats: { ...STATS },
  };
}

/**
 * Every macro command runs one api function behind the same two guards: the
 * importer's slice of the module api must be ready, and the function must
 * exist on this build. Macros arrive by compendium import and outlive the
 * build that shipped them, so an older module build says "needs a newer
 * build" instead of throwing. module.api is the whole module namespace, never
 * a single feature (docs/DECISIONS.md §9), so every command drills into
 * `.importer` before calling.
 */
function apiCommand(fn, name, args = "") {
  return `const api = globalThis.acksExtras?.importer;
if (!api) return ui.notifications.warn("ACKS Extras | the importer is not ready (is the module enabled?).");
if (typeof api.${fn} !== "function") return ui.notifications.warn("ACKS Extras | ${name} needs a newer build of this module.");
api.${fn}(${args});`;
}

const apiMacro = (id, name, img, fn, sort, folderId, args = "") => macro(id, name, img, apiCommand(fn, name, args), sort, folderId);

function buildMacros() {
  return [
    /* FOUR CONTROLS, and one of them is not a control.
       The pack shipped twenty-one macros. Nearly all were a single step of one
       larger job, on the shelf because it happened to be a function: import
       traps, import variations, import vehicles, import rules tables, build
       template packages, fill companion slots. A Judge does not choose those
       individually — they are what "import everything" is made of, they have a
       dependency order, and a list of them invites running them in the wrong
       one.
       What is left is what a Judge actually reaches for:
         - connect your books (the prerequisite, not a control)
         - import everything
         - delete everything
         - rebuild ONE shelf
       Everything dropped is still on the api and every world that imported the
       old pack keeps its copies working, because the functions all still
       resolve. Their ids are NOT reused: an id is identity, and re-issuing one
       would hand such a world a duplicate. Folder ids likewise. */
    folder(FOLDERS.setup, "Your Books", 100),
    folder(FOLDERS.import, "Import from your books", 200),

    apiMacro("ackscMacStatus00", "Your ACKS Books (this seat)", "icons/svg/book.svg", "bookStatus", 100, FOLDERS.setup),

    macro(
      "ackscMacImportAl",
      "Import Everything (GM)",
      "icons/svg/upgrade.svg",
      `const api = globalThis.acksExtras?.importer;
if (!api) return ui.notifications.warn("ACKS Extras | the importer is not ready (is the module enabled?).");
if (typeof api.importEverything !== "function") return ui.notifications.warn("ACKS Extras | Import Everything needs a newer build of this module.");
await api.importEverything();`,
      200,
      FOLDERS.import,
    ),
    apiMacro("ackscMacReimport", "Reimport One Shelf (GM)", "icons/svg/regen.svg", "cookbookReimportShelf", 210, FOLDERS.import),
    apiMacro("ackscMacRemoveAl", "Delete Everything Imported (GM)", "icons/svg/cancel.svg", "cookbookRemoveImports", 220, FOLDERS.import),
  ];
}

export const packs = {
  macros: buildMacros,
};
