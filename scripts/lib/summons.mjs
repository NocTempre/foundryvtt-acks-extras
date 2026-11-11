/* global game, ui, foundry, canvas, CONST, Actor, Folder, fromUuid, fromUuidSync */
/**
 * Player summons — the Foundry half. A character's owner summons creatures
 * from the monster library onto the scene they are looking at; each one is an
 * UNLINKED token of a world copy of the creature, owned through its own delta
 * by the summoner's owners and by nobody else, and carrying the summoner's
 * uuid and a record of its cast in that delta (`summons-logic.mjs`).
 *
 * Only the GM's client creates documents. The seat picks the creature and
 * clicks the places through core's placement (`placeTokens` with
 * `create: false`, so nothing is made), then sends the positions to the GM's
 * client, which authorizes the request, finds or makes the ONE world copy of
 * that creature (in a folder a player cannot open, owned by nobody but the
 * GM), creates the tokens and answers with their uuids. A dismissal runs the
 * same way: the seat confirms, the GM deletes the tokens the module made for
 * that summoner and no others. The world copy stays.
 *
 * A summoning is tied to the spell that calls it: a request names the
 * summoner's spell item, and only a seat `bareSummonAllowed` answers true for
 * may name none. Feature rules over a spell's creature and count arrive as
 * policies (`registerSummonPolicy`), which this file never imports.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { makeLoc } from "./util.mjs";
import { libraryPacks } from "./library.mjs";
import {
  SUMMON_COPY_FLAG,
  MAX_SUMMONS,
  summonerOf,
  summonRecordOf,
  summonFlags,
  summonOwnership,
  validCastId,
  previewTokenData,
  placedPositions,
  checkPlaceRequest,
  checkDismissRequest,
  summonEntries,
  bareSummonAllowed,
  registerSummonPolicy,
} from "./summons-logic.mjs";

export { summonerOf, registerSummonPolicy };

const libLoc = makeLoc(LANG_PREFIX);

/** A string of this file's lang group, under the lib root. */
const loc = (key, data) => libLoc(`summons.${key}`, data);

/** The socket handler the GM's client answers. */
const SUMMON_HANDLER = "summonRelay";

/** The flag stamped on the Actor folder the world copies are filed in. */
const SUMMON_FOLDER_FLAG = "summonFolder";

/** The most tokens a dismissal request may name. */
const MAX_DISMISS = 200;

/** The socket transport, loaded when a call needs it so this file evaluates without a Foundry session. */
const transport = () => import("./sockets.mjs");

/** A document by uuid, or null — never a throw for a stale pointer. */
function resolveSync(uuid) {
  try {
    return uuid ? (fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
}

/** The scene the seat summons on: the one on the canvas, else the world's active one. */
const sceneNow = () => canvas?.scene ?? game.scenes?.active ?? null;

/* -------------------------------------------- */
/*  Reads                                        */
/* -------------------------------------------- */

/**
 * The tokens on a scene whose creature names this character as its summoner.
 * @param {Actor} summoner
 * @param {{scene?: Scene}} [o]  the scene to read; omitted, the one on the canvas
 * @returns {TokenDocument[]}
 */
export function summonsOf(summoner, { scene = sceneNow() } = {}) {
  if (!summoner?.uuid) return [];
  return [...(scene?.tokens ?? [])].filter((t) => summonerOf(t.actor) === summoner.uuid);
}

/**
 * The creatures this seat may summon, by pack: the module's imported Actor
 * shelves and the system's Actor compendia, each as far as the seat can open
 * the pack. Read off the pack indexes, so nothing is loaded to list it.
 * @returns {{label: string, entries: {uuid: string, name: string}[]}[]}
 */
export function summonShelves() {
  const system = (game.packs ?? []).filter((p) => p.documentName === "Actor" && p.metadata?.packageType === "system");
  const seen = new Set();
  const shelves = [];
  for (const pack of [...libraryPacks("Actor"), ...system]) {
    if (seen.has(pack.collection) || !pack.visible) continue;
    seen.add(pack.collection);
    const entries = summonEntries(pack.index.values());
    if (entries.length) shelves.push({ label: pack.metadata.label, entries });
  }
  return shelves;
}

/* -------------------------------------------- */
/*  The GM's half                                */
/* -------------------------------------------- */

/** One copy per source at a time: a second request for the same creature waits for the first. */
const copying = new Map();

/** The Actor folder the world copies are filed in: found by its stamp, else made. */
async function summonFolder() {
  const stamped = game.folders.find((f) => f.type === "Actor" && f.getFlag(MODULE_ID, SUMMON_FOLDER_FLAG));
  if (stamped) return stamped;
  return Folder.create({ name: loc("folder"), type: "Actor", flags: { [MODULE_ID]: { [SUMMON_FOLDER_FLAG]: true } } }).catch(() => null);
}

/**
 * Make the world actor a summoned token needs, from the library's creature:
 * its stat block and embedded items, owned by nobody but the GM, with its
 * token unlinked. It sheds the library's own marks, so removing the imports
 * never takes it, and the pack's folder, which names nothing in the world.
 */
async function createCopy(source) {
  const data = source.toObject();
  for (const key of ["_id", "folder", "sort", "_stats", "ownership"]) delete data[key];
  if (data.flags?.[MODULE_ID]) {
    delete data.flags[MODULE_ID].cookbook;
    delete data.flags[MODULE_ID].templatePart;
  }
  const folder = await summonFolder();
  return Actor.create(
    foundry.utils.mergeObject(
      data,
      {
        folder: folder?.id ?? null,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
        prototypeToken: { actorLink: false },
        flags: { [MODULE_ID]: { [SUMMON_COPY_FLAG]: { sourceUuid: source.uuid } } },
      },
      { inplace: false },
    ),
  );
}

/** The world copy of a source creature: the one already made, or a new one. */
function worldCopy(source) {
  const key = source.uuid;
  const found = game.actors.find((a) => a.getFlag(MODULE_ID, SUMMON_COPY_FLAG)?.sourceUuid === key);
  if (found) return Promise.resolve(found);
  if (!copying.has(key)) copying.set(key, createCopy(source).finally(() => copying.delete(key)));
  return copying.get(key);
}

/** Refusal in the shape every answer takes. */
const refused = (reason) => ({ ok: false, reason });

/**
 * Create the tokens of one summoning, one after another so each is numbered
 * against the ones already placed.
 * @returns {Promise<string[]>} the created tokens' uuids
 */
async function createTokens({ copy, scene, positions, flags, ownership }) {
  const uuids = [];
  for (const p of positions) {
    const place = { x: p.x, y: p.y, actorLink: false, hidden: false, delta: { ownership, flags } };
    for (const key of ["elevation", "rotation", "level"]) if (p[key] !== undefined) place[key] = p[key];
    const doc = await copy.getTokenDocument(place, { parent: scene });
    const data = doc.toObject();
    delete data._id;
    const [made] = await scene.createEmbeddedDocuments("Token", [data]);
    if (made) uuids.push(made.uuid);
  }
  return uuids;
}

/** Place summons: authorize, find or make the copy, create the tokens. */
async function placeOp({ summonerUuid, sourceUuid, sceneId, positions, count, spellId = "", castId = "", user }) {
  const summoner = await fromUuid(summonerUuid);
  const source = await fromUuid(sourceUuid);
  const scene = game.scenes.get(sceneId);
  const verdict = checkPlaceRequest({ user, summoner, source, scene, count, positions, spellId });
  if (!verdict.ok) return refused(verdict.reason);
  const copy = await worldCopy(source);
  if (!copy) return refused("noCopy");
  const cast = validCastId(castId) ? castId : foundry.utils.randomID();
  // The spell's name is read here, from the summoner's own item, never taken from the payload.
  const spellName = spellId ? (summoner.items.get(spellId)?.name ?? "") : "";
  const flags = summonFlags(summoner.uuid, { sourceUuid: source.uuid, name: source.name, spellId, spellName, castId: cast, at: game.time.worldTime });
  const ownership = summonOwnership(summoner.ownership, [user.id], (id) => !!game.users.get(id)?.isGM);
  const tokenUuids = await createTokens({ copy, scene, positions, flags, ownership });
  return { ok: true, castId: cast, tokenUuids };
}

/** Dismiss summons: authorize, then delete the tokens the module made for this summoner. */
async function dismissOp({ summonerUuid, tokenUuids, user }) {
  const summoner = await fromUuid(summonerUuid);
  const tokens = [...new Set(tokenUuids ?? [])].slice(0, MAX_DISMISS).map(resolveSync).filter((t) => t?.documentName === "Token");
  const verdict = checkDismissRequest({ user, summoner, tokens });
  if (!verdict.ok) return refused(verdict.reason);
  const byScene = new Map();
  for (const t of verdict.tokens) byScene.set(t.parent, [...(byScene.get(t.parent) ?? []), t.id]);
  let deleted = 0;
  for (const [scene, ids] of byScene) deleted += (await scene.deleteEmbeddedDocuments("Token", ids)).length;
  return { ok: true, deleted, refused: verdict.refused };
}

/**
 * The GM's half of the relay. Authorizes on the SENDER (the transport stamps
 * `requestUserId`; none means a GM), never on what the payload claims: the
 * token data is rebuilt here from the world copy, the cast id is the sender's
 * only if it is well formed, and the time is the GM's clock.
 * @param {object} payload
 * @param {"place"|"dismiss"} payload.op
 * @param {string} payload.summonerUuid
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, tokenUuids?: string[], deleted?: number, refused?: number}>}
 */
export async function summonRelay({ op, requestUserId = null, ...rest } = {}) {
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!user) return refused("noUser");
  if (op === "place") return placeOp({ ...rest, user });
  if (op === "dismiss") return dismissOp({ ...rest, user });
  return refused("badOp");
}

/** Register the GM's half of the relay — once, at init. */
export async function registerSummons() {
  const { registerHandler } = await transport();
  registerHandler(SUMMON_HANDLER, summonRelay);
}

/** Send a request where documents can be made: handled here for a GM, relayed otherwise. */
async function send(payload) {
  const { executeAsGM } = await transport();
  return (await executeAsGM(SUMMON_HANDLER, payload)) ?? refused("noGm");
}

/* -------------------------------------------- */
/*  The seat's half                              */
/* -------------------------------------------- */

/** The preview data for each creature to place: its own look, one per creature. */
async function previewsFor(source, summoner, count) {
  const proto = source.prototypeToken.toObject();
  const images = proto.randomImg ? await source.getTokenImages().catch(() => []) : [];
  return Array.from({ length: count }, () => {
    const data = previewTokenData(proto, summoner.id);
    // A token is placed on a level, and core defaults one to the scene's first
    // rather than the one the seat is looking at.
    if (canvas.level?.id) data.level = canvas.level.id;
    if (images.length) data.texture = { ...(data.texture ?? {}), src: images[Math.floor(Math.random() * images.length)] };
    return data;
  });
}

/**
 * Summon creatures: the seat clicks where each goes, and the GM's client makes
 * the tokens. A placement the user cut short places the creatures chosen so
 * far; one cancelled outright places nothing.
 * @param {Actor} summoner  the character summoning
 * @param {object} o
 * @param {string} o.sourceUuid  the library creature
 * @param {number} [o.count=1]
 * @param {string} [o.spellId]  the spell item of the summoner this is cast from; empty is refused
 *   `spellRequired` unless the seat is `bareSummonAllowed`
 * @param {Function} [o.preConfirm]  core's placement hook, `({event, document, index, count}) => boolean|void`:
 *   returning false refuses that click, which is where a summoning that
 *   constrains where the creature appears states its constraint
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, tokenUuids?: string[]}>}
 */
export async function placeSummons(summoner, { sourceUuid, count = 1, spellId = "", preConfirm } = {}) {
  const scene = sceneNow();
  const source = sourceUuid ? await fromUuid(sourceUuid).catch(() => null) : null;
  const verdict = checkPlaceRequest({ user: game.user, summoner, source, scene, count, spellId });
  if (!verdict.ok) return refused(verdict.reason);
  if (!canvas?.ready || !scene) return refused("noCanvas");
  if (game.paused && !game.user.isGM) return refused("paused");
  let placed;
  try {
    placed = await canvas.tokens.placeTokens(await previewsFor(source, summoner, count), { create: false, preConfirm });
  } catch (err) {
    console.error(`${MODULE_ID} | summon placement failed`, err);
    return refused("placement");
  }
  const positions = placedPositions(placed);
  if (!positions.length) return refused("cancelled");
  return send({
    op: "place",
    summonerUuid: summoner.uuid,
    sourceUuid,
    sceneId: scene.id,
    positions,
    count: positions.length,
    spellId,
    castId: foundry.utils.randomID(),
  });
}

/**
 * Dismiss summons the module made: the requesting seat confirms, and the GM's
 * client deletes the tokens. A creature bound to the summoner by hand is not
 * dismissed here. The world copy stays.
 * @param {Actor} summoner
 * @param {object} [o]
 * @param {TokenDocument[]} [o.tokens]  the tokens to dismiss; omitted, the summoner's on the scene
 * @param {string} [o.castId]  restrict to one cast
 * @param {boolean} [o.confirm=true]  ask first; the prompt is kept unless a caller has already asked
 * @returns {Promise<{ok: boolean, reason?: string, deleted?: number, refused?: number}>}
 */
export async function dismissSummons(summoner, { tokens, castId = "", confirm = true } = {}) {
  let chosen = tokens ?? summonsOf(summoner);
  if (castId) chosen = chosen.filter((t) => summonRecordOf(t.actor)?.castId === castId);
  const verdict = checkDismissRequest({ user: game.user, summoner, tokens: chosen });
  if (!verdict.ok) return refused(verdict.reason);
  if (!verdict.tokens.length) return refused("none");
  if (confirm) {
    const yes = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("dismissTitle") },
      content: `<p>${foundry.utils.escapeHTML(loc("dismissConfirm", { n: verdict.tokens.length, name: summoner.name }))}</p>`,
      rejectClose: false,
    });
    if (yes !== true) return refused("declined");
  }
  return send({ op: "dismiss", summonerUuid: summoner.uuid, tokenUuids: verdict.tokens.map((t) => t.uuid) });
}

/** Say why a request was refused, in the seat's own words. */
function warnRefusal(reason) {
  if (reason === "cancelled" || reason === "declined" || reason === "noGm") return;
  ui.notifications.warn(loc(`refused.${reason}`));
}

/** The window classes every prompt here carries: the module's own and its scroll contract. */
const PROMPT_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];

/** The `<option>` markup of the seat's creature shelves, grouped by pack. */
function shelfOptionsHtml(shelves) {
  const esc = foundry.utils.escapeHTML;
  return shelves
    .map((s) => `<optgroup label="${esc(s.label)}">${s.entries.map((e) => `<option value="${esc(e.uuid)}">${esc(e.name)}</option>`).join("")}</optgroup>`)
    .join("");
}

/** Tell the seat there is no creature it can open, and offer nothing. */
async function promptNoMonsters(title) {
  await foundry.applications.api.DialogV2.prompt({
    classes: PROMPT_CLASSES,
    window: { title },
    content: `<p class="notes">${foundry.utils.escapeHTML(loc("noMonsters"))}</p>`,
    ok: { label: loc("close"), callback: () => false },
    rejectClose: false,
  });
}

/**
 * The creature and count prompt of a summoning cast from a spell. The spell's
 * own `options` (`summonOptionsOf` rows: `{ref, amount, ...}`) decide the
 * choices: each row whose `ref` the caller's `resolveRef` turns into a creature
 * is offered, the first one preselected, and its `amount` is the count the
 * field opens on; with no such row the seat picks from the shelves it can open.
 * `resolveRef` is passed in because lib imports no feature. The prompt only
 * asks: nothing is placed, and the answer goes to `placeSummons`.
 *
 * @param {Actor} summoner
 * @param {object} [o]
 * @param {{id: string, name: string}} [o.spell]  the summoner's spell item the cast is made from
 * @param {{ref?: string, amount?: number}[]} [o.options]
 * @param {(ref: string) => Promise<{uuid: string, name: string}|null>} [o.resolveRef]
 * @returns {Promise<{sourceUuid: string, count: number, spellId: string}|null>} null when the prompt was closed
 *   or there was no creature to choose
 */
export async function pickSummon(summoner, { spell, options = [], resolveRef } = {}) {
  const esc = foundry.utils.escapeHTML;
  const title = spell?.name || loc("title");
  const named = [];
  for (const row of options) {
    const ref = String(row?.ref ?? "").trim();
    if (!ref || !resolveRef) continue;
    const doc = await Promise.resolve(resolveRef(ref)).catch(() => null);
    if (doc?.uuid && !named.some((n) => n.uuid === doc.uuid)) named.push({ uuid: doc.uuid, name: String(doc.name ?? ""), amount: Number(row.amount) || 0 });
  }
  let choices;
  if (named.length) {
    choices = named.map((n) => `<option value="${esc(n.uuid)}" data-amount="${n.amount || ""}">${esc(n.name)}</option>`).join("");
  } else {
    const shelves = summonShelves();
    if (!shelves.length) {
      await promptNoMonsters(title);
      return null;
    }
    choices = shelfOptionsHtml(shelves);
  }
  const opening = Math.min(MAX_SUMMONS, Math.max(1, named[0]?.amount || 1));
  const form = await foundry.applications.api.DialogV2.prompt({
    classes: PROMPT_CLASSES,
    window: { title },
    content:
      `<div class="form-group"><label>${esc(loc("creature"))}</label><select name="source">${choices}</select></div>` +
      `<div class="form-group"><label>${esc(loc("count"))}</label><input type="number" name="count" value="${opening}" min="1" max="${MAX_SUMMONS}" step="1"></div>`,
    render: (_event, dialog) => {
      const root = dialog.element;
      const select = root?.querySelector?.('select[name="source"]');
      const count = root?.querySelector?.('input[name="count"]');
      select?.addEventListener("change", () => {
        const amount = Number(select.selectedOptions?.[0]?.dataset?.amount) || 0;
        if (amount && count) count.value = String(Math.min(MAX_SUMMONS, amount));
      });
    },
    ok: {
      label: loc("place"),
      callback: (_event, button) => ({
        sourceUuid: button.form.elements.source.value,
        count: Number(button.form.elements.count.value),
        spellId: spell?.id ?? "",
      }),
    },
    rejectClose: false,
  });
  return form && typeof form === "object" ? form : null;
}

/**
 * The bare Summon… prompt: the creature from the library this seat can read,
 * how many, and optionally the spell it is cast from, then the placement. It
 * is the spell-less path, so it answers `spellRequired` at once for a seat
 * `bareSummonAllowed` does not allow it. With no creature the seat can read,
 * the prompt says so and offers nothing.
 * @param {Actor} summoner
 * @returns {Promise<{ok: boolean, reason?: string}|null>} null when the prompt was closed
 */
export async function promptSummon(summoner) {
  const esc = foundry.utils.escapeHTML;
  const DialogV2 = foundry.applications.api.DialogV2;
  const classes = PROMPT_CLASSES;
  if (!bareSummonAllowed(game.user)) {
    warnRefusal("spellRequired");
    return refused("spellRequired");
  }
  const shelves = summonShelves();
  if (!shelves.length) {
    await promptNoMonsters(loc("title"));
    return null;
  }
  const options = shelfOptionsHtml(shelves);
  const spells = [...summoner.items].filter((i) => i.type === "spell").sort((a, b) => a.name.localeCompare(b.name));
  const spellField = spells.length
    ? `<div class="form-group"><label>${esc(loc("spell"))}</label><select name="spell"><option value="">—</option>${spells
        .map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`)
        .join("")}</select></div>`
    : "";
  const form = await DialogV2.prompt({
    classes,
    window: { title: loc("title") },
    content:
      `<div class="form-group"><label>${esc(loc("creature"))}</label><select name="source">${options}</select></div>` +
      `<div class="form-group"><label>${esc(loc("count"))}</label><input type="number" name="count" value="1" min="1" max="${MAX_SUMMONS}" step="1"></div>` +
      spellField,
    ok: {
      label: loc("place"),
      callback: (_event, button) => ({
        sourceUuid: button.form.elements.source.value,
        count: Number(button.form.elements.count.value),
        spellId: button.form.elements.spell?.value ?? "",
      }),
    },
    rejectClose: false,
  });
  if (!form || typeof form !== "object") return null;
  const result = await placeSummons(summoner, form);
  if (result.ok) ui.notifications.info(loc("placed", { n: result.tokenUuids?.length ?? 0 }));
  else warnRefusal(result.reason);
  return result;
}

/** Confirm and dismiss, then say how it went. */
export async function promptDismiss(summoner, options = {}) {
  const result = await dismissSummons(summoner, options);
  if (result.ok) ui.notifications.info(loc("dismissed", { n: result.deleted ?? 0 }));
  else warnRefusal(result.reason);
  return result;
}
