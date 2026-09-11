/* global game, ui, foundry, fromUuid, fromUuidSync, Actor, Folder, Hooks, CONST */
/**
 * Companions — the creature an ability confers, chosen and kept as an
 * inventory slot.
 *
 * A companion effect on an ability (`{type: "companion"}` in the extras
 * model) is a SLOT: it exists the moment the character holds the ability,
 * whether or not a creature has been put in it. Two writers fill it. The
 * importer's fill pass writes `actorUuid` from a cookbook `ref`, for the
 * abilities whose creature the page NAMES. This file writes it from the
 * table, for the abilities whose creature is CHOSEN — which the page describes
 * only by a rule ("animals of less than 1 HD", RR p. 113) and leaves to the
 * reader.
 *
 * The choice is a picker over the imported library: the animals the rule
 * allows first, every other animal after them at the Judge's discretion, and
 * a typed name for a creature the library has not got, for which a blank
 * creature is made. The chosen creature becomes a WORLD actor of its own — a
 * copy of the library's, never the library's document — owned by whoever owns
 * the character, and the slot points at it. Releasing the slot clears the
 * pointer and leaves the creature in the world.
 *
 * A player seat may lack the permission to create actors; the creation then
 * runs on the GM's client through the module's socket, and only the pointer
 * is written from the player's seat.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_EXTRAS, ABILITY_TYPE } from "./constants.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
import { ANIMAL_TYPE } from "../lib/constants.mjs";
import { monsterHitDice } from "../lib/actor-read.mjs";
import { libraryActors, whenReady } from "../lib/library.mjs";
import { executeAsGM, registerHandler } from "../lib/sockets.mjs";

/** Flag on a companion actor and its folder: which character's slot it fills. */
export const FLAG_COMPANION = "companion";
/** The socket handler that creates the actor on the GM's client. */
const CREATE_HANDLER = "companionCreate";

/** The raw effects array on an ability — the shape a slot is written back in. */
const effectsOf = (item) => foundry.utils.deepClone(item?.getFlag?.(MODULE_ID, FLAG_EXTRAS)?.effects ?? []);

/** A world document by uuid, or null — never a throw for a stale pointer. */
function resolveSync(uuid) {
  try {
    return uuid ? (fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Every companion slot an actor's abilities confer, in item order. The
 * creature is resolved here, synchronously, because the sheet that lists the
 * slots cannot await; a pointer at a document that is gone reads as an empty
 * slot rather than a broken one.
 * @returns {{item: object, index: number, effect: object, actorUuid: string, companion: object|null}[]}
 */
export function companionSlots(actor) {
  const out = [];
  for (const item of actor?.items ?? []) {
    if (item.type !== ABILITY_TYPE) continue;
    const effects = item.getFlag?.(MODULE_ID, FLAG_EXTRAS)?.effects ?? [];
    effects.forEach((effect, index) => {
      if (effect?.type !== "companion") return;
      const actorUuid = String(effect.actorUuid ?? "");
      out.push({ item, index, effect, actorUuid, companion: resolveSync(actorUuid) });
    });
  }
  return out;
}

/** Is this creature an animal — by the importer's type record, or by being the animal sub-type? */
export function isAnimal(actor) {
  if (actor?.type === ANIMAL_TYPE) return true;
  const types = actor?.flags?.[MODULE_ID]?.extras?.types ?? [];
  return Array.isArray(types) && types.includes("animal");
}

/**
 * Hit Dice as the rule counts them: the importer's structured record when the
 * creature was imported, else the roll formula read back.
 * @returns {{count: number, bonus: number}}
 */
export function hitDiceOf(actor) {
  const hd = actor?.flags?.[MODULE_ID]?.extras?.hd;
  const count = Number(hd?.count);
  if (Number.isFinite(count) && count > 0) return { count, bonus: Number(hd.bonus) || 0 };
  return monsterHitDice(actor);
}

/**
 * Under one Hit Die: a fraction of a die, or one die with a penalty — the
 * "less than 1 HD" the familiar rule allows (RR p. 113). The rule is
 * structural; which animals satisfy it is read off the imported creatures.
 */
export const underOneHitDie = ({ count, bonus } = {}) => count > 0 && (count < 1 || (count === 1 && bonus < 0));

/**
 * The library's animals, by name, split into the rule's two groups. Awaits
 * the library so a cold shelf never offers half a list.
 * @returns {Promise<{eligible: object[], other: object[]}>}
 */
export async function companionCandidates() {
  await whenReady();
  const animals = libraryActors()
    .filter(isAnimal)
    .sort((a, b) => a.name.localeCompare(b.name));
  const eligible = animals.filter((a) => underOneHitDie(hitDiceOf(a)));
  return { eligible, other: animals.filter((a) => !eligible.includes(a)) };
}

const L = (key, data) =>
  data ? game.i18n.format(`${LANG_PREFIX}.companion.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.companion.${key}`);

/**
 * Offer the choice for one slot, and bind what is chosen.
 * @returns {Promise<object|null>} the companion actor, or null when nothing was chosen
 */
export async function openCompanionPicker(actor, item, index) {
  if (!actor?.isOwner || !item) return null;
  const { eligible, other } = await companionCandidates();
  const esc = foundry.utils.escapeHTML;
  const option = (a) => {
    const hd = a.system?.hp?.hd;
    return `<option value="${esc(a.uuid)}">${esc(a.name)}${hd ? ` (${esc(String(hd))})` : ""}</option>`;
  };
  const group = (label, list) => (list.length ? `<optgroup label="${esc(label)}">${list.map(option).join("")}</optgroup>` : "");
  const options = group(L("eligible"), eligible) + group(L("other"), other);
  const pick = options
    ? `<div class="form-group"><label>${L("fromLibrary")}</label><select name="uuid"><option value="">—</option>${options}</select></div>`
    : `<p class="notes">${L("noAnimals")}</p>`;
  const form = await foundry.applications.api.DialogV2.prompt({
    window: { title: L("pickTitle", { ability: item.name }) },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    content: `${pick}<div class="form-group"><label>${L("orName")}</label><input type="text" name="name" /></div>`,
    ok: {
      callback: (_event, button) => ({
        uuid: button.form.elements.uuid?.value ?? "",
        name: button.form.elements.name.value.trim(),
      }),
    },
  }).catch(() => null);
  if (!form || (!form.uuid && !form.name)) return null;
  return bindCompanion(actor, item, index, form);
}

/**
 * Put a creature in a slot: a world copy of the chosen library actor, or a
 * blank creature named as typed, owned like the character; then the slot's
 * pointer. The actor is made where actors can be made — here, or on the GM's
 * client when this seat may not create one.
 * @param {{uuid?: string, name?: string}} choice a library actor's uuid, or a name for a new creature
 * @returns {Promise<object|null>} the companion actor, or null when the slot is not a companion slot
 */
export async function bindCompanion(actor, item, index, { uuid = "", name = "" } = {}) {
  const effects = effectsOf(item);
  if (effects[index]?.type !== "companion") return null;
  const payload = { ownerUuid: actor.uuid, abilityId: item.id, index, uuid, name: String(name ?? "").trim() };
  const made = game.user.can("ACTOR_CREATE") ? await createCompanionActor(payload) : await executeAsGM(CREATE_HANDLER, payload);
  if (!made?.uuid) return null;
  effects[index] = { ...effects[index], actorUuid: made.uuid };
  await item.update({ [`flags.${MODULE_ID}.${FLAG_EXTRAS}.effects`]: effects });
  ui.notifications.info(L("chosen", { name: made.name, actor: actor.name }));
  return resolveSync(made.uuid);
}

/** Empty a slot: the pointer is cleared; the creature stays in the world. */
export async function releaseCompanion(actor, item, index) {
  if (!actor?.isOwner) return false;
  const effects = effectsOf(item);
  if (!effects[index]?.actorUuid) return false;
  effects[index] = { ...effects[index], actorUuid: "" };
  await item.update({ [`flags.${MODULE_ID}.${FLAG_EXTRAS}.effects`]: effects });
  return true;
}

/** The Actor folder companions are filed in — made once, found by its stamp, adopted by name. */
async function companionFolder() {
  const stamped = game.folders.find((f) => f.type === "Actor" && f.getFlag(MODULE_ID, FLAG_COMPANION));
  if (stamped) return stamped;
  const name = L("folder");
  return (
    game.folders.find((f) => f.type === "Actor" && f.name === name) ??
    Folder.create({ name, type: "Actor", flags: { [MODULE_ID]: { [FLAG_COMPANION]: true } } }).catch(() => null)
  );
}

/** OWNER on the companion for every user who owns the character, and nobody else by default. */
function ownershipLike(owner) {
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const out = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const [id, level] of Object.entries(owner?.ownership ?? {})) if (id !== "default" && level >= OWNER) out[id] = OWNER;
  return out;
}

/**
 * Make the world actor for a slot. A copy of a library creature keeps its stat
 * block and embedded items but sheds the library's own marks: the cookbook
 * stamp, so Remove ALL Imports never takes a character's companion with the
 * library it was copied from, and the pack folder, which names nothing in the
 * world. Runs on whichever client holds the permission.
 * @returns {Promise<{uuid: string, name: string}|null>}
 */
async function createCompanionActor({ ownerUuid, abilityId, index, uuid = "", name = "" }) {
  const owner = await fromUuid(ownerUuid);
  if (!owner) return null;
  const source = uuid ? await fromUuid(uuid) : null;
  if (!source && !name) return null;
  const data = source ? source.toObject() : { name, type: ACTOR_TYPE.monster };
  for (const key of ["_id", "folder", "sort", "_stats", "ownership"]) delete data[key];
  if (data.flags?.[MODULE_ID]) {
    delete data.flags[MODULE_ID].cookbook;
    delete data.flags[MODULE_ID].templatePart;
  }
  const folder = await companionFolder();
  const created = await Actor.create(
    foundry.utils.mergeObject(
      data,
      {
        name: source ? source.name : name,
        folder: folder?.id ?? null,
        ownership: ownershipLike(owner),
        prototypeToken: { actorLink: true },
        flags: { [MODULE_ID]: { [FLAG_COMPANION]: { ownerUuid, abilityId, index } } },
      },
      { inplace: false },
    ),
  );
  if (!created) return null;
  // The system unlinks a monster's token by default; a companion is one
  // creature, so its tokens share its sheet.
  if (!created.prototypeToken.actorLink) await created.update({ "prototypeToken.actorLink": true });
  return { uuid: created.uuid, name: created.name };
}

/**
 * The prompt: an ability that confers a chosen companion, added to a character
 * by this seat, opens the picker at once. A slot the page names by ref is the
 * importer's to fill, so it does not prompt; a slot left empty is still
 * offered on the Inventory tab. An actor in a compendium is a library document
 * being written, never a seat choosing, so it is passed over.
 */
function onCreateItem(item, _options, userId) {
  if (userId !== game.user.id) return;
  const actor = item.parent;
  if (actor?.documentName !== "Actor" || actor.pack || actor.type !== ACTOR_TYPE.character || item.type !== ABILITY_TYPE) return;
  const slot = companionSlots(actor).find((s) => s.item.id === item.id && !s.actorUuid && !s.effect.ref);
  if (!slot) return;
  openCompanionPicker(actor, item, slot.index).catch((err) => console.error(`${MODULE_ID} | companion picker failed`, err));
}

/** Register the socket handler and the prompt — once, at init. */
export function registerCompanions() {
  registerHandler(CREATE_HANDLER, createCompanionActor);
  Hooks.on("createItem", onCreateItem);
}
