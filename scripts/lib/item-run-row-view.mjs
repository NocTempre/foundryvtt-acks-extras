/* global game, fromUuidSync, ui */
/**
 * The Foundry half of an item's row on a sheet (`item-run-row.mjs` decides what
 * the row says): it reads the item, the reach it names, its raised card and its
 * ring, and runs the two presses a row carries and the write of its swigs-left box.
 *
 * - `itemRunRowFor(item)` is the sheet's context entry: the row model, or null
 *   for an item with no row to draw. A press is offered to an owner of the item
 *   by Foundry's own test, never by role.
 * - `pressItemRun(button)` calls `Item#use`, so the one door stays: the carrier's
 *   claimant takes it, relays it from a Player's seat, and the presenter posts
 *   its card. `writeRunLeft(input)` writes a consume row's "Swigs left" box to the
 *   item for an owner, and `bindItemRunRows(root)` wires every such box a sheet drew. `openItemRunCard(button)` shows a raised item's card in the chat log.
 */
import { FLAG_ITEM_RUN, LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { engagedStateOf } from "./aura-reach.mjs";
import { readReach } from "./aura-reach-logic.mjs";
import { itemCite, itemRunOf, itemRunRowsOf, itemRunUsedUp, litCountOf, litStateOf } from "./item-run-logic.mjs";
import { stackCountOf } from "./item-model.mjs";
import { roundSeconds } from "./time-unit.mjs";
import { hasRunRow, itemRunRowModel, parseRunLeft } from "./item-run-row.mjs";
import { cardOfActivation, hasActivationRunner } from "./item-run.mjs";
import { radiusFigure } from "./item-run-strip.mjs";
import { refusal } from "./item-run-presenter.mjs";
import { ITEM_RUN_ACTIVATIONS } from "./vocab.mjs";
import { elementOf, makeLoc } from "./util.mjs";

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
 * A fuse item's lit state on its actor, `{n}` the rounds its soonest fuse has
 * left, or null where none is lit. On the combat clock `n` is the bearer's turns
 * left; on the world clock it is the rounds to the due moment, at least one.
 */
function litOf(item) {
  const lit = litStateOf(item.actor?.effects, item.uuid);
  if (!lit) return null;
  if (lit.combat) return { n: lit.roundsLeft };
  return { n: Math.max(1, Math.ceil((lit.dueAt - game.time.worldTime) / roundSeconds())) };
}

/**
 * The row an item draws on a sheet, or null where it has none: an item with an
 * activation, or with no activation and at least one row that names a reach
 * (always on). Each press carries the item's uuid. A fuse item reads its lit
 * state off its actor's effects and offers Light while lit only where the stack
 * holds more than it has lit; a `consume` item carries its swigs left and where
 * that count came from.
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
  const lit = kind === "fuse" ? litOf(item) : null;
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
    lit,
    spare: lit ? (stackCountOf(item) ?? 1) > litCountOf(item.actor?.effects, item.uuid) : true,
    left: kind === "consume" ? { value: run.activation.left ?? null, from: run.activation.leftFrom ?? null, cite: itemCite(item) } : null,
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

/**
 * A consume row's "Swigs left" box, from the sheet: the item named by
 * `data-item-uuid`, written only where the seat owns it (Foundry's own test). A
 * blank box clears the count and its provenance; a whole number writes the count
 * with `leftFrom` as `{by: "hand"}`; any other entry writes nothing. The box is
 * set back to the stored count after a refusal or an invalid entry.
 *
 * @param {HTMLInputElement} input
 * @returns {Promise<Item|null>} the updated item, or null where nothing was written
 */
export async function writeRunLeft(input) {
  const item = fromUuidSync(input?.dataset?.itemUuid ?? "");
  const run = item ? itemRunOf(item) : null;
  const stored = run?.activation.kind === "consume" ? (run.activation.left ?? null) : null;
  const restore = () => {
    if (input) input.value = stored === null ? "" : String(stored);
  };
  if (!item || item.isOwner !== true) {
    refusal(item ? "notOwner" : "gone");
    restore();
    return null;
  }
  const parsed = parseRunLeft(input?.value);
  if (!parsed.ok || run?.activation.kind !== "consume") {
    restore();
    return null;
  }
  const base = `flags.${MODULE_ID}.${FLAG_ITEM_RUN}.activation`;
  return item.update({ [`${base}.left`]: parsed.left, [`${base}.leftFrom`]: parsed.left === null ? null : { by: "hand" } });
}

/**
 * Wire each unwired "Swigs left" box under a sheet's root: a change on it is
 * stopped from reaching the sheet's own form handler and written by
 * `writeRunLeft`. A box is wired once, however often the sheet renders.
 *
 * @param {HTMLElement|object} root the sheet's element
 */
export function bindItemRunRows(root) {
  const element = elementOf(root);
  if (!element) return;
  for (const input of element.querySelectorAll("input[data-acks-extras-run-left]")) {
    if (input.dataset.wired === "1") continue;
    input.dataset.wired = "1";
    input.addEventListener("change", (event) => {
      event.stopPropagation();
      void writeRunLeft(input);
    });
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
