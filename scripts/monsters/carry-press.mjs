/* global game, fromUuidSync, ui */
/**
 * The press a generated stack's row on the group sheet carries for the item its
 * bodies carry (`carry-press-logic.mjs` decides what the row says and which body
 * acts). Registered with lib's `registerStackRowControl`; lib names no item.
 *
 * A press finds a carrier. One already out on the viewed scene acts at once; one
 * resting in the stack, or a body with a slot of the share still unspent, is sent
 * out by the group's own Deploy (`deploy` with the group sheet's placement, which
 * gives the item and stamps the record), and then acts. The press is `Item#use`
 * on the body's own copy, the door every other press goes through.
 */
import { MODULE_ID } from "./constants.mjs";
import { deploy, deployAnchor } from "../lib/group.mjs";
import { hasActivationRunner } from "../lib/item-run.mjs";
import { itemRunOf, itemRunUsedUp } from "../lib/item-run-logic.mjs";
import { makeLoc } from "../lib/util.mjs";
import { carriedGearItems, importedOrganisation } from "./organisation.mjs";
import { RUN_LANG_PREFIX, carryControls, chooseCarrier } from "./carry-press-logic.mjs";

/** lib's lang root; the carry prefix is built from it, since it names a group of keys and no key of its own. */
const LIB_ROOT = "ACKS-LIB";
const CARRY_LANG_PREFIX = `${LIB_ROOT}.group.carry`;
const say = makeLoc(RUN_LANG_PREFIX);
const tr = makeLoc(CARRY_LANG_PREFIX);

/** The cookbook id a minted gear item carries, which its copy on a body keeps. */
const cookbookId = (item) => item?.flags?.[MODULE_ID]?.cookbook?.id ?? item?.getFlag?.(MODULE_ID, "cookbook")?.id ?? "";

/**
 * What a `gen.carry` row's pressable item is: the item the imported row mints
 * that has a run activation (a toggle or a once), or null where it mints none.
 * `id` is the cookbook id its copy carries on a body. The row's page is the row's
 * own, else the table's.
 */
function resolveRow(rowKey, org) {
  const row = (org?.equipment?.rows ?? []).find((r) => r.key === rowKey);
  const item = (carriedGearItems(rowKey, org) ?? []).find((i) => itemRunOf(i));
  if (!row || !item) return null;
  return { label: row.label, cite: row.cite || org.equipment.cite || "", kind: itemRunOf(item).activation.kind, id: cookbookId(item) };
}

/** Where a deployed record's token is for the seat viewing: on the viewed scene, on another, or gone. */
function whereOf(record) {
  const token = record.tokenUuid ? fromUuidSync(record.tokenUuid) : null;
  if (!token) return "gone";
  return token.parent?.id && token.parent.id === game.scenes?.viewed?.id ? "here" : "elsewhere";
}

/** The copy of a row's pressable item on an actor, by the cookbook id and a run activation. */
const itemOn = (actor, id) => [...(actor?.items ?? [])].find((i) => cookbookId(i) === id && itemRunOf(i)) ?? null;

/** A carrier's own item as the row reads it: raised or not, used up or not. */
function liveOf(record, id) {
  const item = itemOn(fromUuidSync(record.tokenUuid)?.actor, id);
  return item ? { active: itemRunOf(item).activation.state.active === true, usedUp: itemRunUsedUp(item) } : null;
}

/**
 * Whether this seat would own the body a press acts through, by Foundry's own
 * test: the actor of a carrier already out, else the actor a sent-out body's
 * token is built from (the stack's world base actor, read and never made here; a
 * stack with none yet is a GM's to press, since the base is minted unowned). A
 * press is drawn and run only where this holds, so none sends a body it then
 * cannot act through.
 */
function ownsBody(stack, chosen) {
  if (chosen.mode === "out") return fromUuidSync(chosen.record.tokenUuid)?.actor?.isOwner === true;
  const uuid = stack?.template?.uuid;
  const base = uuid ? fromUuidSync(uuid) : null;
  return base?.documentName === "Actor" && !base.pack ? base.isOwner === true : game.user.isGM === true;
}

/**
 * The controls a stack's row carries for what its bodies carry, each with a
 * `press`. Registered as lib's stack-row control reader.
 *
 * @param {Actor} group
 * @param {object} stack
 * @returns {object[]|null}
 */
export function carryRowControls(group, stack) {
  if (!stack?.gen?.carry) return null;
  const org = importedOrganisation();
  const rows = new Map();
  const resolve = (rowKey) => (rows.has(rowKey) ? rows.get(rowKey) : rows.set(rowKey, resolveRow(rowKey, org)).get(rowKey));
  const controls = carryControls({
    stack,
    pristine: group.system.pristineCountOf(stack),
    resolve,
    where: whereOf,
    live: (record, rowKey) => liveOf(record, resolve(rowKey)?.id),
    owns: (chosen) => ownsBody(stack, chosen),
    runnable: hasActivationRunner,
    say,
    tr,
  });
  return controls.map((control) => ({ ...control, press: () => pressCarry(group, stack.key, control.rowKey) }));
}

/**
 * Press a stack row's item: act through the carrier out on the viewed scene, or
 * send one out with the group's own Deploy and act through it. With every slot of
 * the share spent on bodies that are not here, or where this seat would not own
 * the body that acts, nothing is sent and nothing acts.
 *
 * @param {Actor} group
 * @param {string} stackKey
 * @param {string} rowKey the `gen.carry` row
 * @returns {Promise<unknown>} what `Item#use` answered, or null where nothing acted
 */
export async function pressCarry(group, stackKey, rowKey) {
  const scene = game.scenes?.viewed;
  if (!scene) {
    ui.notifications.warn(game.i18n.localize("ACKS-LIB.group.warn.noScene"));
    return null;
  }
  const stack = group.system.stackOf(stackKey);
  const row = stack ? resolveRow(rowKey, importedOrganisation()) : null;
  if (!row) return null;
  const chosen = chooseCarrier({ roster: stack.roster, rowKey, share: stack.gen?.carry?.[rowKey], pristine: group.system.pristineCountOf(stack), where: whereOf });
  if (chosen.mode === "none" || !ownsBody(stack, chosen)) return null;
  let item = null;
  if (chosen.mode === "out") item = itemOn(fromUuidSync(chosen.record.tokenUuid)?.actor, row.id);
  else if (chosen.mode !== "none") {
    const made = await deploy(group, scene, { stackKey, count: 1, carrying: rowKey, ...deployAnchor(group, scene) });
    item = made.map((token) => itemOn(token.actor, row.id)).find(Boolean) ?? null;
    if (made.length && !item) ui.notifications.warn(tr("noItem", { item: row.label }));
  }
  if (!item) return null;
  return item.use();
}
