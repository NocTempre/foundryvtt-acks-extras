/* global game, Hooks, ui, console, foundry, CONFIG */
/**
 * A book's Adventure's import, steered: an import adds what this world is
 * missing and writes to nothing it holds. Core's own import runs; this only
 * waits for the library before it, narrows what it was handed, and only for
 * an Adventure carrying one of `ADVENTURE_KINDS`: a book's, or a retired
 * per-map one that outlived its retirement. Every other Adventure imports as
 * core imports it. The arithmetic is `adventure-binding.mjs`; the step that
 * writes the Adventure is `cookbook.mjs` (`ensureBookAdventure`).
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { mirrorCreatedLinks } from "../location/scene-link.mjs";
import { byCookbookId, cookbookId, libraryCold, warmLibrary } from "../lib/library.mjs";
import {
  ADVENTURE_TYPE, ADVENTURE_KINDS, BOOK_ADVENTURE_KIND, fillPlan, includedKeys, applyFill, refsOf,
} from "./adventure-binding.mjs";

/** The cookbook kind an Adventure carries, or "". */
const kindOf = (adventure) => String(adventure?.flags?.[MODULE_ID]?.cookbook?.kind ?? "");

/** Whether this Adventure is one the importer wrote, of a kind the hooks steer. */
export const isCookbookAdventure = (adventure) => ADVENTURE_KINDS.includes(kindOf(adventure));

/**
 * A directory card with no picture reads as a scene that failed. Core draws
 * one at creation only when a canvas is up, so it is asked for here and
 * allowed to fail: the picture is already uploaded either way.
 */
export async function ensureSceneThumb(scene) {
  if (!scene || scene.thumb) return;
  const thumb = await scene.createThumbnail().catch(() => null);
  if (thumb?.thumb) await scene.update({ thumb: thumb.thumb });
}

/** Each import's fill report, keyed by the options object core hands to both hooks. */
const reports = new WeakMap();

/** The world collections an Adventure's documents are twinned in. */
const TWIN_TYPES = ["Actor", "Scene", "RollTable", "JournalEntry", "Item"];

/**
 * This world, as the fill asks about it. Twins are indexed once per import,
 * by cookbook id, over the collections an Adventure carries; a folder's twin
 * is found by type, name and parent. A library document is looked up in the
 * warmed library, synchronously.
 */
function worldLookups() {
  const twins = new Map();
  for (const type of TWIN_TYPES) {
    for (const doc of game.collections.get(type) ?? []) {
      const id = cookbookId(doc);
      if (!id || doc.flags?.[MODULE_ID]?.templatePart) continue;
      const key = `${type}|${id}`;
      if (!twins.has(key)) twins.set(key, doc.id);
    }
  }
  return {
    has: (type, id) => game.collections.get(type)?.has(id) ?? false,
    twinOf: (type, data, parentId = null) => {
      if (type === "Folder") {
        return game.folders.find((f) => f.type === data.type && f.name === data.name && (f.folder?.id ?? null) === parentId)?.id ?? null;
      }
      return twins.get(`${type}|${cookbookId(data)}`) ?? null;
    },
    shelfOf: (type, data) => byCookbookId(type, cookbookId(data))?.uuid ?? null,
    worldRefs: (type, id) => {
      const doc = game.collections.get(type)?.get(id);
      return doc ? refsOf(type, doc.toObject()) : [];
    },
    regionsOf: (scene, worldId) => {
      const world = game.scenes.get(worldId);
      const out = new Map();
      for (const region of scene.regions ?? []) {
        const place = region.flags?.[MODULE_ID]?.cookbook?.place;
        const twin = place ? world?.regions.find((r) => r.getFlag(MODULE_ID, "cookbook")?.place === place) : null;
        out.set(`Scene.${scene._id}.Region.${region._id}`, twin ? twin.uuid : "");
      }
      return out;
    },
  };
}

/**
 * The fill against this world, applied to core's lists in place. Synchronous
 * by necessity: core does not await the hook, so a promise here would leave
 * its lists whole and send the import into its overwrite.
 */
function fillImport(adventure, toCreate, toUpdate) {
  const src = adventure.toObject();
  const content = {};
  for (const [field, cls] of Object.entries(foundry.utils.getDocumentClass(ADVENTURE_TYPE).contentFields)) {
    if (src[field]?.length) content[cls.documentName] = src[field];
  }
  const book = kindOf(adventure) === BOOK_ADVENTURE_KIND;
  const plan = fillPlan({ content, book, included: includedKeys(toCreate, toUpdate), ...worldLookups() });
  applyFill(toCreate, toUpdate, plan.create);
  return plan;
}

/** `preImportAdventure`: narrow the import to the fill, or cancel it. Never async. */
function steerImport(adventure, options, toCreate, toUpdate) {
  if (!isCookbookAdventure(adventure)) return;
  const say = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.adventure.${key}`, { name: adventure.name, ...data });
  // A cold shelf answers the library lookups with nothing, which would read
  // every library document as missing and create a world twin of each.
  // `warmBeforePrepare` has waited for the library, so a shelf still cold
  // here is one that would not load.
  if (libraryCold()) {
    warmLibrary();
    ui.notifications.warn(say("libraryLoading"));
    return false;
  }
  try {
    const report = fillImport(adventure, toCreate, toUpdate);
    if (!report.added) {
      ui.notifications.info(say("nothingToAdd"));
      return false;
    }
    reports.set(options, report);
    // The progress bar's denominator is what core counted before the fill;
    // the caller's own array is left alone.
    options.preImport = [...(options.preImport ?? []), (importData) => { importData.documentCount = report.added; }];
  } catch (err) {
    // Falling through would hand core's overwrite the whole Adventure.
    console.error(`${MODULE_ID} | ${adventure.name}: import fill failed`, err);
    ui.notifications.error(say("fillFailed"));
    return false;
  }
}

/**
 * `importAdventure`: the mirrors and thumbnail of every map the import made,
 * and of a map it found held (a part-failed earlier import never reached
 * this hook), then the link pass, then the counts.
 */
function afterImport(adventure, options, created) {
  const report = reports.get(options);
  if (!report) return;
  reports.delete(options);
  (async () => {
    const scenes = [...(created?.Scene ?? [])];
    for (const id of report.heldScenes) {
      const scene = game.scenes.get(id);
      if (scene) scenes.push(scene);
    }
    for (const scene of scenes) {
      await mirrorCreatedLinks(scene);
      await ensureSceneThumb(scene);
    }
    // The import makes maps without the link pass, and a map the world held
    // still leads to the Regions its ends named before; the pass joins both.
    if (scenes.length) {
      const { cookbookImportLinks } = await import("./cookbook.mjs");
      await cookbookImportLinks({ quiet: true });
    }
    ui.notifications.info(
      game.i18n.format(`${LANG_PREFIX}.adventure.filled`, {
        name: adventure.name, added: report.added, held: report.held, shelved: report.shelved, skipped: report.skipped,
      }),
    );
  })().catch((err) => console.error(`${MODULE_ID} | ${adventure.name}: links after import`, err));
}

/** How many warms an import waits through before it leaves a cold shelf to the hook's refusal. */
const WARM_TRIES = 3;

/**
 * `Adventure#prepareImport`, wrapped: a cookbook Adventure's import waits for
 * the library before core lists what it would create, so the fill core runs
 * next, in a hook it does not await, reads every shelf whole. Core empties an
 * idle shelf (docs/lib/MODEL.md, "A warm shelf does not stay warm"), so this
 * is the common case and not a startup one. Each warm reads only the shelves
 * cold when it starts, so one emptied during it is warmed by the next; a
 * shelf that never loads is left to `steerImport`, which refuses.
 */
async function warmBeforePrepare(wrapped, ...args) {
  if (isCookbookAdventure(this) && libraryCold()) {
    ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.adventure.libraryWarming`, { name: this.name }));
    for (let n = 0; n < WARM_TRIES && libraryCold(); n++) await warmLibrary();
  }
  return wrapped(...args);
}

/** Wrap `prepareImport` on the configured Adventure class, through libWrapper where it is active. */
function wrapPrepareImport() {
  const proto = CONFIG.Adventure?.documentClass?.prototype;
  if (typeof proto?.prepareImport !== "function") {
    console.warn(`${MODULE_ID} | no Adventure#prepareImport to wrap; a book Adventure's import refuses while the library is cold.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.Adventure.documentClass.prototype.prepareImport", warmBeforePrepare, "WRAPPER");
    return;
  }
  const original = proto.prepareImport;
  proto.prepareImport = function (...args) {
    return warmBeforePrepare.call(this, (...a) => original.apply(this, a), ...args);
  };
}

/** Register both import hooks and the wait before them; called once, after the legacy-importer guard. */
export function registerBookAdventureHooks() {
  Hooks.on("preImportAdventure", steerImport);
  Hooks.on("importAdventure", afterImport);
  wrapPrepareImport();
}
