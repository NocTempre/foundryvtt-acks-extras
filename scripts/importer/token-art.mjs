/* global game, foundry, ui */
/**
 * Overhead token art from an installed third-party Actor compendium: the
 * Foundry side of the Tools tab's Apply and Restore. The plan is
 * `token-art-logic.mjs`; this reads the world, asks, and performs it.
 *
 * A source is discovered at runtime: any active package, other than this
 * module, whose Actor packs hold monster rows with token art under the
 * package's own path. Its title is read from the package. Nothing in this
 * module names a package or a pack. The art is the package's, referenced by
 * path and never copied.
 *
 * Every write goes to the imported monsters (the library's, and the world
 * copies made from them) as `prototypeToken.texture.src`, the wildcard mark and
 * the fit, with `flags["acks-extras"].tokenArt` recording the source and the
 * token that stood before, which is all Restore reads. `img`, the token's size
 * and its scale are never written.
 */
import { MODULE_ID, LANG_PREFIX, ACTOR_TYPE } from "./constants.mjs";
import { libraryActors, cookbookId, whenReady } from "../lib/library.mjs";
import { unset, escape } from "../lib/util.mjs";
import { ART_FIT, indexSource, planApply, planRestore, planPlaced, isWildcardPath } from "./token-art-logic.mjs";

const FLAG = "tokenArt";
const FIELDS = ["type", "img", "prototypeToken.texture.src", "prototypeToken.randomImg"];
const loc = (key, data) => (data ? game.i18n.format(`${LANG_PREFIX}.manager.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.manager.${key}`));

/** The Actor packs of one active package other than this module. */
const packsOf = (packageId) => [...game.packs].filter((p) => p.documentName === "Actor" && p.metadata?.packageType === "module" && p.metadata?.packageName === packageId);

/** The index rows of a source's packs, as `indexSource` reads them. */
async function sourceRows(packs) {
  const rows = [];
  for (const pack of packs) {
    const index = await pack.getIndex({ fields: FIELDS });
    for (const row of index) {
      rows.push({
        name: row.name,
        type: row.type,
        tokenSrc: row.prototypeToken?.texture?.src ?? "",
        randomImg: !!row.prototypeToken?.randomImg,
        uuid: row.uuid ?? `Compendium.${pack.collection}.Actor.${row._id}`,
      });
    }
  }
  return rows;
}

/**
 * The installed packages offering monster token art, each with its index.
 *
 * @returns {Promise<Array<{id: string, title: string, packs: object[], index: object}>>} empty when none
 */
export async function tokenArtSources() {
  const ids = new Set([...game.packs].filter((p) => p.documentName === "Actor" && p.metadata?.packageType === "module").map((p) => p.metadata.packageName));
  ids.delete(MODULE_ID);
  const out = [];
  for (const id of ids) {
    if (!game.modules.get(id)?.active) continue;
    const packs = packsOf(id);
    const index = indexSource(await sourceRows(packs), id);
    if (index.count) out.push({ id, title: game.modules.get(id)?.title ?? id, packs, index });
  }
  return out;
}

/** The imported monsters this feature writes: the library's and the world copies made from them. */
const monstersOf = () => libraryActors().filter((a) => a.type === ACTOR_TYPE.MONSTER && cookbookId(a));

/** The same, once the shelves are loaded. */
async function subjectActors() {
  await whenReady();
  return monstersOf();
}

/** A subject as the plan reads it. */
const subjectOf = (actor) => ({
  uuid: actor.uuid,
  name: actor.name,
  img: actor.img ?? "",
  tokenSrc: actor.prototypeToken?.texture?.src ?? "",
  randomImg: !!actor.prototypeToken?.randomImg,
  fit: actor.prototypeToken?.texture?.fit ?? "",
  flag: actor.flags?.[MODULE_ID]?.[FLAG] ?? null,
});

/** The tokens placed from a world actor, as `planPlaced` reads them. */
function placedTokens(actor) {
  if (actor.pack) return [];
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const t of scene.tokens) if (t.actorId === actor.id) out.push({ uuid: t.uuid, actorLink: t.actorLink, src: t.texture?.src ?? "", scene, id: t.id });
  }
  return out;
}

/** One report line per count, in the order a Judge reads them. */
function countLines(c) {
  return ["change", "current", "kept", "noArt", "ambiguous", "noMatch", "restore"].filter((k) => c[k]).map((k) => `<li>${loc(`tokenArt.count.${k}`, { n: c[k] })}</li>`);
}

/** Ask before applying: the counts and the placed-tokens tick. Resolves `{placed}` on yes, null otherwise. */
async function confirmApply(source, counts, placedCount) {
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("tokenArt.confirmTitle") },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-importer-dialog"],
    content: `<p>${escape(loc("tokenArt.confirmBody", { title: source.title }))}</p><ul>${countLines(counts).join("")}</ul>
      <label class="acks-extras-importer-tick"><input type="checkbox" name="placed"> ${loc("tokenArt.placedTick", { n: placedCount })}</label>`,
    buttons: [
      { action: "apply", label: loc("tokenArt.apply"), default: true, callback: (_event, button) => ({ placed: !!button.form?.elements?.placed?.checked }) },
      { action: "cancel", label: loc("tokenArt.cancel"), callback: () => false },
    ],
    rejectClose: false,
  });
  return result && typeof result === "object" ? result : null;
}

/** Update the placed tokens of one actor off the old prototype path. */
async function movePlaced(actor, from, to) {
  if (isWildcardPath(to)) return 0;
  const moves = planPlaced(placedTokens(actor), from, to);
  const byScene = new Map();
  for (const t of placedTokens(actor)) {
    const move = moves.find((m) => m.uuid === t.uuid);
    if (move) byScene.set(t.scene, [...(byScene.get(t.scene) ?? []), { _id: t.id, "texture.src": move.src }]);
  }
  for (const [scene, updates] of byScene) await scene.updateEmbeddedDocuments("Token", updates);
  return moves.length;
}

/**
 * Apply a source's token art to the imported monsters, after a confirm that
 * counts what will change and what is left. Cancel writes nothing.
 *
 * @param {{id: string, title: string, index: object}} source one of `tokenArtSources()`
 * @returns {Promise<object|null>} the counts and `placed`, or null when cancelled
 */
export async function applyTokenArt(source) {
  if (!game.user?.isGM) return null;
  const actors = new Map((await subjectActors()).map((a) => [a.uuid, a]));
  const plan = planApply([...actors.values()].map(subjectOf), source.index, { from: source.title });
  const placedCount = plan.changes.reduce((n, c) => n + (actors.get(c.uuid)?.pack ? 0 : placedTokens(actors.get(c.uuid)).filter((t) => !t.actorLink && t.src === c.was.src).length), 0);
  const asked = await confirmApply(source, plan.counts, placedCount);
  if (!asked) return null;
  const done = { ...plan.counts, change: 0, refused: 0, placed: 0 };
  for (const change of plan.changes) {
    const actor = actors.get(change.uuid);
    try {
      await actor.update({
        "prototypeToken.texture.src": change.src,
        "prototypeToken.randomImg": change.randomImg,
        "prototypeToken.texture.fit": ART_FIT,
        [`flags.${MODULE_ID}.${FLAG}`]: { from: change.from, src: change.src, was: change.was },
      });
      done.change++;
      if (asked.placed) done.placed += await movePlaced(actor, change.was.src, change.src);
    } catch (err) {
      console.warn(`${MODULE_ID} | token art: ${change.name} refused`, err);
      done.refused++;
    }
  }
  ui.notifications.info(loc("tokenArt.done", { n: done.change, refused: done.refused }));
  return done;
}

/**
 * Put back the token every flagged monster stood on before it was written, for
 * each whose token still shows the written art. Needs no source.
 *
 * @returns {Promise<object|null>} the counts, or null for a seat that is not a GM
 */
export async function restoreTokenArt() {
  if (!game.user?.isGM) return null;
  const actors = new Map((await subjectActors()).map((a) => [a.uuid, a]));
  const plan = planRestore([...actors.values()].map(subjectOf));
  const done = { restore: 0, kept: plan.counts.kept, refused: 0 };
  for (const r of plan.restores) {
    const actor = actors.get(r.uuid);
    try {
      await actor.update({
        "prototypeToken.texture.src": r.was.src ?? "",
        "prototypeToken.randomImg": !!r.was.randomImg,
        "prototypeToken.texture.fit": r.was.fit || ART_FIT,
        [`flags.${MODULE_ID}.${FLAG}`]: unset(),
      });
      done.restore++;
    } catch (err) {
      console.warn(`${MODULE_ID} | token art: ${r.name} refused`, err);
      done.refused++;
    }
  }
  ui.notifications.info(loc("tokenArt.restored", { n: done.restore, kept: done.kept, refused: done.refused }));
  return done;
}

/** Whether any imported monster carries this feature's flag, so Restore is offered. */
export const hasTokenArtFlag = () => monstersOf().some((a) => a.flags?.[MODULE_ID]?.[FLAG]);
