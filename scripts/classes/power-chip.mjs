/* global foundry */
/**
 * The power ledger's chip on the casting strip: a tag for each power with the
 * balance on its face and the entries in its tooltip, the entries below it as
 * rows, and, for a Judge alone, a plus and a minus on each tag, a Fades / Stays
 * switch beside them and the arcane lifetime's count. The switch sets what that
 * tag's pair does: on Fades the plus adds a point that fades after the lifetime
 * and the minus spends fading points first; on Stays the plus adds a point that
 * stays until removed and the minus removes one. Its state is a per-window
 * record, `powerSwitchOf(app)`, which every render of the strip reads and the
 * wiring writes, so it survives the re-render each write causes; it starts on
 * Fades, ends when its window closes (`forgetPowerSwitch`) and is never written
 * to the actor. The classes feature hosts the chip; the ledger is magic's, read and
 * written through `magic/power-ledger-live.mjs`. A Player's strip draws no
 * buttons, no switch and no count, and never a kind with no entries. The blood sacrifice's button sits beside the
 * tags (`openerHtml`): a Judge's seat draws it for every caster and a Player's for the casters the sacrifice's own
 * rule names (`magic/sacrifice-record.mjs` `openerVisible`), whether or not the ledger holds anything yet.
 */
import { chipModelFor, powerApi, announce } from "../magic/power-ledger-live.mjs";
import { openerFor, openSacrifice } from "../magic/sacrifice-record-live.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Each window's switch state, held by the window itself so that it ends with it. */
const SWITCHES = new WeakMap();

/**
 * The switch state of one window: `{divine, arcane}`, each true where that tag is
 * on Stays. The window is the application that hosts the strip, so two windows on
 * one actor hold two records, and a window that never set a tag reads it as Fades.
 * With no window to key on the record is a fresh one that nothing keeps.
 */
export function powerSwitchOf(app) {
  if (!app || (typeof app !== "object" && typeof app !== "function")) return { divine: false, arcane: false };
  let state = SWITCHES.get(app);
  if (!state) SWITCHES.set(app, (state = { divine: false, arcane: false }));
  return state;
}

/**
 * Drop a window's switch state, so that the same window opened again reads Fades.
 * A document keeps one sheet instance for as long as the world runs, so closing
 * the window is the end of the state, not the instance's lifetime.
 */
export function forgetPowerSwitch(app) {
  if (app && (typeof app === "object" || typeof app === "function")) SWITCHES.delete(app);
}

/** A Judge's Fades / Stays switch for one tag: two pills, the one in `onStays`'s state pressed. */
function stayHtml(k, onStays) {
  const pill = (stays, label, tip) =>
    `<button type="button" class="acks-extras-classes-powerpill" data-power-stay="${stays ? 1 : 0}" data-power-kind="${k.kind}" aria-pressed="${stays === onStays ? "true" : "false"}" data-tooltip-text="${esc(tip)}">${esc(label)}</button>`;
  return `<span class="acks-extras-classes-powerstay" role="group" aria-label="${esc(k.stay.group)}">${pill(false, k.stay.fades, k.stay.fadesTip)}${pill(true, k.stay.stays, k.stay.staysTip)}</span>`;
}

/** One power's tag, with a Judge's controls beside it, all in one wrapping group. */
function chipHtml(model, k, state) {
  const onStays = state[k.kind] === true;
  const buttons = model.judge
    ? `<button type="button" class="acks-extras-classes-powerbtn" data-power-adjust="1" data-power-kind="${k.kind}" aria-label="${esc(k.addLabel)}" data-tooltip=""><i class="fa-solid fa-plus" inert></i></button>` +
      `<button type="button" class="acks-extras-classes-powerbtn" data-power-adjust="-1" data-power-kind="${k.kind}" data-power-label="${esc(k.removeLabel)}" data-power-label-stays="${esc(k.removeStaysLabel)}" aria-label="${esc(onStays ? k.removeStaysLabel : k.removeLabel)}" data-tooltip=""><i class="fa-solid fa-minus" inert></i></button>`
    : "";
  const stay = model.judge && k.stay ? stayHtml(k, onStays) : "";
  const count = k.count
    ? `<input type="number" min="1" step="1" class="acks-input acks-extras-classes-powercount acks-nums" data-power-count value="${esc(k.count.value)}" aria-label="${esc(k.count.label)}" data-tooltip-text="${esc(k.count.tip)}">`
    : "";
  return (
    `<span class="acks-extras-classes-powerchip">` +
    `<span class="acks-extras-classes-powertag" data-power="${k.kind}" data-tooltip-text="${esc(k.tip)}"><i class="fa-solid fa-bolt" inert></i> ${esc(k.label)} <span class="acks-nums">${k.balance}</span></span>` +
    buttons +
    stay +
    count +
    `</span>`
  );
}

/** One entry's row: the source's art, its name and caption (a pin before a lot that stays), the figure, and a Judge's Undo on a spend. */
function rowHtml(row) {
  const art = row.img ? `<img src="${esc(row.img)}" alt="" inert>` : `<i class="fa-solid ${row.glyph}" inert></i>`;
  const undo = row.undoable
    ? `<button type="button" class="acks-extras-classes-powerbtn" data-power-undo="${esc(row.id)}" data-power-kind="${row.kind}" aria-label="${esc(row.undoLabel)}" data-tooltip=""><i class="fa-solid fa-rotate-left" inert></i></button>`
    : "";
  return (
    `<li class="acks-extras-classes-powerrow${row.off ? " is-off" : ""}">` +
    `<span class="acks-extras-classes-powerart">${art}</span>` +
    `<span class="acks-extras-classes-powertext"><span class="acks-extras-classes-powername">${esc(row.name)}</span>${row.caption ? `<span class="acks-extras-classes-powerline">${row.pinned ? '<i class="fa-solid fa-thumbtack" inert></i> ' : ""}${esc(row.caption)}</span>` : ""}</span>` +
    `<span class="acks-extras-classes-powerfig acks-nums${row.spent ? " is-spent" : ""}" data-tooltip-text="${esc(row.tip)}">${esc(row.tag)}</span>` +
    undo +
    `</li>`
  );
}

/** The Sacrifice button for a caster the strip draws for (`casts`), or "" where this seat sees none; a fault in reading the caster draws none rather than breaking the strip. */
export function openerHtml(actor, casts = false) {
  let opener = null;
  try {
    opener = openerFor(actor, casts);
  } catch (err) {
    console.error("acks-extras | the sacrifice button could not be read", err);
  }
  if (!opener) return "";
  return `<button type="button" class="acks-btn acks-extras-classes-sacrifice" data-sacrifice-open="1" data-tooltip-text="${esc(opener.tip)}"><i class="fa-solid fa-droplet" inert></i> ${esc(opener.label)}</button>`;
}

/**
 * The ledger's markup for the strip, or "" where there is nothing to draw: a
 * Player with no entries and no Sacrifice button, or an actor that casts nothing
 * and holds no power.
 * @param {Actor} actor
 * @param {boolean} casts whether the actor has any casting pool to draw
 * @param {{divine: boolean, arcane: boolean}} [state] the window's switch state (`powerSwitchOf`); each pill pair is drawn pressed to match
 */
export function powerSectionHtml(actor, casts, state = powerSwitchOf(null)) {
  const opener = openerHtml(actor, casts);
  let model = null;
  try {
    model = chipModelFor(actor);
  } catch (err) {
    console.error("acks-extras | the power ledger could not be read", err);
  }
  const chips = Boolean(model) && model.any && (casts || model.hasEntries);
  if (!chips && !opener) return "";
  const shown = chips ? model.kinds.filter((k) => k.shown) : [];
  const rows = shown.flatMap((k) => k.rows);
  const list = !chips ? "" : rows.length
    ? `<ul class="acks-extras-classes-powerlist">${rows.map(rowHtml).join("")}</ul>`
    : `<span class="acks-extras-classes-powerempty">${esc(model.emptyText)}</span>`;
  return `<div class="acks-extras-classes-power"><div class="acks-extras-classes-powerchips">${shown.map((k) => chipHtml(model, k, state)).join("")}${opener}</div>${list}</div>`;
}

/**
 * Wire the ledger's controls on a strip: a Judge's plus, minus, Fades / Stays
 * switch and Undo, the arcane count, and the Sacrifice button. The switch is read at the press: a tag
 * set to Stays writes its plus as a lot that stays and its minus as a removal
 * from the lots that stay. A press of the switch writes nothing to the actor; it
 * sets `state`, the window's record (`powerSwitchOf`), which a render of the strip
 * reads back, and relabels that tag's minus.
 * @param {Element} strip
 * @param {Actor} actor
 * @param {{divine: boolean, arcane: boolean}} [state] the window's switch state; a fresh one when none is passed
 */
export function wirePowerChip(strip, actor, state = powerSwitchOf(null)) {
  strip.addEventListener("click", (event) => {
    if (event.target.closest("[data-sacrifice-open]")) {
      event.preventDefault();
      void openSacrifice(actor);
      return;
    }
    const pill = event.target.closest("[data-power-stay]");
    if (pill) {
      event.preventDefault();
      const kind = pill.dataset.powerKind;
      const onStays = pill.dataset.powerStay === "1";
      state[kind] = onStays;
      for (const other of pill.parentElement?.querySelectorAll?.("[data-power-stay]") ?? []) other.setAttribute("aria-pressed", String(other === pill));
      const minus = strip.querySelector?.(`[data-power-adjust="-1"][data-power-kind="${kind}"]`);
      const label = minus?.dataset?.[onStays ? "powerLabelStays" : "powerLabel"];
      if (label) minus.setAttribute("aria-label", label);
      return;
    }
    const adjust = event.target.closest("[data-power-adjust]");
    if (adjust) {
      event.preventDefault();
      const { powerKind: kind, powerAdjust } = adjust.dataset;
      const args = { amount: 1, by: "judge" };
      const onStays = state[kind] === true;
      if (onStays) args[Number(powerAdjust) > 0 ? "stays" : "fromStays"] = true;
      void (Number(powerAdjust) > 0 ? powerApi.gain(actor, kind, args) : powerApi.spend(actor, kind, args)).then(announce);
      return;
    }
    const undo = event.target.closest("[data-power-undo]");
    if (undo) {
      event.preventDefault();
      void powerApi.undo(actor, undo.dataset.powerKind, undo.dataset.powerUndo).then(announce);
    }
  });
  strip.addEventListener("change", (event) => {
    const box = event.target.closest("[data-power-count]");
    if (!box) return;
    void powerApi.setCount(actor, box.value).then(announce);
  });
}
