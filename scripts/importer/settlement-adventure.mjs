/* global game, Hooks, ui, console, foundry */
/**
 * A settlement Adventure's import, steered: an import adds what this world is
 * missing and writes to nothing it holds. Core's own import runs; this only
 * narrows what it was handed, and only for an Adventure carrying
 * `ADVENTURE_KIND`. Every other Adventure imports as core imports it. The
 * arithmetic is `adventure-binding.mjs`; the map step that writes the
 * Adventure is `cookbook.mjs` (`ensureSettlementAdventure`).
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { mirrorCreatedLinks } from "../location/scene-link.mjs";
import { byCookbookId, cookbookId } from "../lib/library.mjs";
import { ADVENTURE_TYPE, ADVENTURE_KIND, fillPlan, includedKeys, applyFill, refsOf, isShelvedKind } from "./adventure-binding.mjs";

/** Whether this Adventure is one the map step wrote. */
export const isSettlementAdventure = (adventure) => adventure?.flags?.[MODULE_ID]?.cookbook?.kind === ADVENTURE_KIND;

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

/**
 * This world, as the fill asks about it. Twins are indexed once per import,
 * by cookbook id, over the three collections an Adventure carries; a folder's
 * twin is found by type, name and parent. A shelved kind (a person, a list) is
 * looked up in the warmed library, synchronously.
 */
function worldLookups() {
  const twins = new Map();
  for (const [type, collection] of [["Actor", game.actors], ["Scene", game.scenes], ["RollTable", game.tables]]) {
    for (const doc of collection) {
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
    shelfOf: (type, data) => (isShelvedKind(type, data) ? (byCookbookId(type, cookbookId(data))?.uuid ?? null) : null),
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
  const plan = fillPlan({ content, included: includedKeys(toCreate, toUpdate), ...worldLookups() });
  applyFill(toCreate, toUpdate, plan.create);
  return plan;
}

/** `preImportAdventure`: narrow the import to the fill, or cancel it. Never async. */
function steerImport(adventure, options, toCreate, toUpdate) {
  if (!isSettlementAdventure(adventure)) return;
  const say = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.adventure.${key}`, { name: adventure.name, ...data });
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
 * this hook), then the counts.
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
    ui.notifications.info(
      game.i18n.format(`${LANG_PREFIX}.adventure.filled`, {
        name: adventure.name, added: report.added, held: report.held, skipped: report.skipped,
      }),
    );
  })().catch((err) => console.error(`${MODULE_ID} | ${adventure.name}: links after import`, err));
}

/** Register both import hooks; called once, after the legacy-importer guard. */
export function registerSettlementAdventureHooks() {
  Hooks.on("preImportAdventure", steerImport);
  Hooks.on("importAdventure", afterImport);
}
