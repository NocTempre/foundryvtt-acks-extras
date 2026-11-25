/* global game, fromUuidSync, ui */
/**
 * The Foundry half of an item's row on a sheet (`item-run-row.mjs` decides what
 * the row says): it reads the item, the reach it names, its raised card and its
 * ring, and runs the two presses a row carries.
 *
 * - `itemRunRowFor(item)` is the sheet's context entry: the row model, or null
 *   for an item with no row to draw. A press is offered to an owner of the item
 *   by Foundry's own test, never by role.
 * - `pressItemRun(button)` calls `Item#use`, so the one door stays: the carrier's
 *   claimant takes it, relays it from a Player's seat, and the presenter posts
 *   its card. `openItemRunCard(button)` shows a raised item's card in the chat log.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { engagedStateOf } from "./aura-reach.mjs";
import { readReach } from "./aura-reach-logic.mjs";
import { itemCite, itemRunOf, itemRunRowsOf, itemRunUsedUp } from "./item-run-logic.mjs";
import { hasRunRow, itemRunRowModel } from "./item-run-row.mjs";
import { cardOfActivation, hasActivationRunner } from "./item-run.mjs";
import { radiusFigure } from "./item-run-strip.mjs";
import { refusal } from "./item-run-presenter.mjs";
import { ITEM_RUN_ACTIVATIONS } from "./vocab.mjs";
import { makeLoc } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);
const say = (key, data) => loc(`itemRun.${key}`, data);

/** The bearer's token on the scene this window views: a synthetic actor's own, else the first on the canvas. */
const viewedToken = (actor) => (actor?.isToken ? actor.token : (actor?.getActiveTokens?.(false, true)?.[0] ?? null));

/** The pulses a toggle and a once-only use act on, as the carrier's runners read them. */
const KIND_PULSES = Object.freeze({ toggle: ["turnStart+moveIn", "standing"], once: ["action"] });

/** The item's rows that name a readable reach, as `{row, reach}`. */
function reachRowsOf(item) {
  return itemRunRowsOf(item).map((row) => ({ row, reach: readReach(row?.reach) })).filter((r) => r.reach);
}

/** The row a kind draws: the one its runner acts on, else (for an always-on item) the engaged one, else the first that names a reach. */
function chooseRow(rows, kind) {
  const pulses = KIND_PULSES[kind] ?? [];
  return rows.find((r) => pulses.includes(r.reach.pulse)) ?? (kind ? null : rows.find((r) => r.reach.engaged)) ?? rows[0] ?? null;
}

/** Whether the seat owns a token, by Foundry's own test. */
const owns = (uuid) => fromUuidSync(uuid)?.testUserPermission?.(game.user, "OWNER") === true;

/** How many bodies the raised card lists in reach for this seat: the rows of the tokens the seat owns, as the card itself shows them. Null where the card is gone. */
function inRangeOn(activationId) {
  const { card } = cardOfActivation(activationId);
  if (!card || card.lowered === true) return null;
  return Object.values(card.subjects ?? {}).filter((s) => s?.state === "in" && owns(s.uuid)).length;
}

/**
 * The row an item draws on a sheet, or null where it has none: an item with an
 * activation, or with no activation and at least one row that names a reach
 * (always on). Each press carries the item's uuid.
 *
 * @param {Item} item
 * @returns {object|null} an `itemRunRowModel`
 */
export function itemRunRowFor(item) {
  if (!item) return null;
  const run = itemRunOf(item);
  const rows = reachRowsOf(item);
  if (!hasRunRow({ run, reaches: rows })) return null;
  const kind = run?.activation.kind ?? "";
  const chosen = chooseRow(rows, kind);
  const owner = item.isOwner === true;
  let reach = null;
  if (chosen?.reach.engaged) reach = { engaged: true, feet: null, tip: "", cite: "" };
  else if (chosen) {
    const { radius, tip } = radiusFigure(chosen.reach, item);
    reach = { engaged: false, feet: radius, tip, cite: itemCite(item) };
  }
  const active = run?.activation.state.active === true;
  const token = viewedToken(item.actor);
  const model = itemRunRowModel({
    kind,
    active,
    stocked: !itemRunUsedUp(item),
    runnable: hasActivationRunner(kind),
    owner,
    reach,
    engaged: !kind && chosen?.reach.engaged ? engagedStateOf(token, item, chosen.row) : null,
    card: owner && active ? { inRange: inRangeOn(run.activation.state.activationId) } : null,
    use: kind ? (ITEM_RUN_ACTIVATIONS[kind]?.label ?? "") : "",
    say,
  });
  return { ...model, itemUuid: item.uuid, presses: model.presses.map((p) => ({ ...p, itemUuid: item.uuid })) };
}

/** The item a press button names, where the seat owns it; otherwise the refusal is told and null answers. */
function itemOfPress(button) {
  const item = fromUuidSync(button?.dataset?.itemUuid ?? "");
  if (!item || item.isOwner !== true) {
    refusal(item ? "notOwner" : "gone");
    return null;
  }
  return item;
}

/**
 * A row's Raise, Lower or Use, from the sheet: `Item#use`, the door the hotbar
 * macro goes through. A press that is off does nothing; the button is held off
 * while the use runs, so a double press is one.
 */
export async function pressItemRun(button) {
  if (button?.getAttribute?.("aria-disabled") === "true" || button?.dataset?.busy === "1") return null;
  const item = itemOfPress(button);
  if (!item) return null;
  button.dataset.busy = "1";
  try {
    return await item.use();
  } finally {
    if (button.isConnected) delete button.dataset.busy;
  }
}

/** A raised row's Card: the chat log opens and scrolls to the card posted for the item's activation, and says so where it is gone. */
export function openItemRunCard(button) {
  const item = itemOfPress(button);
  if (!item) return null;
  const { message } = cardOfActivation(itemRunOf(item)?.activation.state.activationId ?? "");
  if (message) ui.sidebar?.changeTab?.("chat", "primary");
  const at = message ? (ui.chat?.element?.querySelector?.(`[data-message-id="${message.id}"]`) ?? null) : null;
  if (!at) {
    refusal("noCard");
    return null;
  }
  at.scrollIntoView({ block: "center" });
  return message;
}
