/* global foundry */
/**
 * The power ledger on the casting strip: one icon button for each power the
 * character has. A power is shown, to every seat alike, where the character's
 * class casts that kind, where its ledger holds entries of it, or, for arcane,
 * where the sacrifice record marks the class power (`magic/power-ledger-live.mjs`
 * `chipModelFor` reads all three); a character with none draws nothing. The icon
 * is the disclosure of that power's panel, and while the balance is above zero
 * the balance rides over the icon as a badge. The panel's head names the power
 * with its balance as text, and the panel holds the entries as rows and, for a
 * seat that can edit the character (Foundry's own `isOwner`, true for a GM), the
 * controls: a Fades / Stays switch, an amount box, an Add and a Remove, an Undo
 * on each entry the model calls undoable, and, on the arcane panel, the arcane
 * lifetime's count. A row the model refuses Undo says why in a line of its own. A
 * seat that cannot edit the character reads the icon, the badge and the rows.
 *
 * Add and Remove act with the typed amount in one request. The switch sets what
 * that panel's pair does: on Fades the Add writes a point that fades after the
 * lifetime and the Remove spends fading points first; on Stays the Add writes a
 * point that stays until removed and the Remove removes one.
 *
 * The blood sacrifice's button (`openerHtml`) is drawn in each shown panel's
 * head under the sacrifice's own seat rule (`magic/sacrifice-record.mjs`
 * `openerVisible`): a Judge's seat for every caster and a Player's for the
 * casters that rule names. Where that rule allows it and no power is shown the
 * strip draws neither the section nor the button, and the window stays open to
 * `acksExtras.magic.sacrifice.open(actor)`.
 *
 * What a window keeps (`powerSwitchOf(app)`): per kind, the switch, whether the
 * panel is open and the typed amount, plus the base of the panel ids. Every
 * render of the strip reads it and the wiring writes it, so it survives the
 * re-render each write causes; the panels start closed, the amount starts at one
 * and the switch on Fades; it ends when its window closes (`forgetPowerSwitch`)
 * and is never written to the actor. The classes feature hosts the chip; the
 * ledger is magic's, read and written through `magic/power-ledger-live.mjs`.
 */
import { chipModelFor, powerApi, announce } from "../magic/power-ledger-live.mjs";
import { openerFor, openSacrifice } from "../magic/sacrifice-record-live.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Each window's record, held by the window itself so that it ends with it. */
const SWITCHES = new WeakMap();

/** The count that numbers the panel ids of windows that carry no id of their own. */
let anonymous = 0;

/** A record in its starting state: Fades, both panels closed, an amount of one. */
function freshState(base) {
  return { divine: false, arcane: false, open: { divine: false, arcane: false }, amount: { divine: "1", arcane: "1" }, base };
}

/**
 * The record of one window: `divine` and `arcane` are true where that power's switch is on
 * Stays, `open[kind]` is whether its panel is open, `amount[kind]` is the text
 * in its amount box, and `base` is what the panel ids are built from (the
 * window's own id). The window is the application that hosts the strip, so two
 * windows on one actor hold two records, and a window that never set anything
 * reads Fades, closed and one. With no window to key on the record is a fresh
 * one that nothing keeps.
 */
export function powerSwitchOf(app) {
  const base = (a) => (typeof a?.id === "string" && a.id ? a.id : `acks-extras-power-${++anonymous}`);
  if (!app || (typeof app !== "object" && typeof app !== "function")) return freshState(base(null));
  let state = SWITCHES.get(app);
  if (!state) SWITCHES.set(app, (state = freshState(base(app))));
  return state;
}

/**
 * Drop a window's record, so that the same window opened again reads Fades with
 * its panels closed. A document keeps one sheet instance for as long as the world
 * runs, so closing the window is the end of the record, not the instance's lifetime.
 */
export function forgetPowerSwitch(app) {
  if (app && (typeof app === "object" || typeof app === "function")) SWITCHES.delete(app);
}

/** The id of one kind's panel, built from the window's own id. */
const panelId = (state, kind) => `${state.base}-power-${kind}`;

/** A seat's Fades / Stays switch for one power: two pills, the one in `onStays`'s state pressed. */
function stayHtml(k, onStays) {
  const pill = (stays, label, tip) =>
    `<button type="button" class="acks-extras-classes-powerpill" data-power-stay="${stays ? 1 : 0}" data-power-kind="${k.kind}" aria-pressed="${stays === onStays ? "true" : "false"}" data-tooltip-text="${esc(tip)}">${esc(label)}</button>`;
  return `<span class="acks-extras-classes-powerstay" role="group" aria-label="${esc(k.stay.group)}">${pill(false, k.stay.fades, k.stay.fadesTip)}${pill(true, k.stay.stays, k.stay.staysTip)}</span>`;
}

/** The glyph of each power's icon. */
const GLYPH = { divine: "fa-hands-praying", arcane: "fa-hat-wizard" };

/** One power's icon, which is the button that opens its panel, with the balance as a badge over it while the balance is above zero. The badge is hidden from assistive technology: the button's own name carries the balance. */
function chipHtml(k, state) {
  const open = state.open?.[k.kind] === true;
  const badge = k.balance > 0 ? `<span class="acks-extras-classes-powerbadge acks-nums" data-power-badge="${k.kind}" aria-hidden="true">${k.balance}</span>` : "";
  return `<button type="button" class="acks-extras-classes-powerdisc" data-power-toggle="1" data-power-kind="${k.kind}" aria-expanded="${open}" aria-controls="${esc(panelId(state, k.kind))}" aria-label="${esc(k.disclosureLabel)}" data-tooltip-text="${esc(k.tip)}"><i class="fa-solid ${GLYPH[k.kind] ?? "fa-bolt"}" inert></i>${badge}</button>`;
}

/** One entry's row: the source's art, its name and caption (a pin before a lot that stays), the line that says why Undo is refused, the figure, and an owner's Undo. */
function rowHtml(row) {
  const art = row.img ? `<img src="${esc(row.img)}" alt="" inert>` : `<i class="fa-solid ${row.glyph}" inert></i>`;
  const undo = row.undoable
    ? `<button type="button" class="acks-btn acks-btn--quiet acks-btn--sm acks-extras-classes-poweract" data-power-undo="${esc(row.id)}" data-power-kind="${row.kind}" aria-label="${esc(row.undoLabel)}" data-tooltip="">${esc(row.undoText)}</button>`
    : "";
  const refused = row.undoRefused ? `<span class="acks-extras-classes-powerline is-refused">${esc(row.undoRefused)}</span>` : "";
  return (
    `<li class="acks-extras-classes-powerrow${row.off ? " is-off" : ""}">` +
    `<span class="acks-extras-classes-powerart">${art}</span>` +
    `<span class="acks-extras-classes-powertext"><span class="acks-extras-classes-powername">${esc(row.name)}</span>${row.caption ? `<span class="acks-extras-classes-powerline">${row.pinned ? '<i class="fa-solid fa-thumbtack" inert></i> ' : ""}${esc(row.caption)}</span>` : ""}${refused}</span>` +
    `<span class="acks-extras-classes-powerfig acks-nums${row.spent ? " is-spent" : ""}" data-tooltip-text="${esc(row.tip)}">${esc(row.tag)}</span>` +
    undo +
    `</li>`
  );
}

/** An owner's control line for one kind: the switch, the amount box, Add and Remove, and on arcane the lifetime count. */
function controlsHtml(k, state) {
  const onStays = state[k.kind] === true;
  const amount = state.amount?.[k.kind] ?? "1";
  const count = k.count
    ? `<input type="number" min="1" step="1" class="acks-input acks-input--num acks-extras-classes-powercount acks-nums" data-power-count value="${esc(k.count.value)}" aria-label="${esc(k.count.label)}" data-tooltip-text="${esc(k.count.tip)}">`
    : "";
  return (
    `<div class="acks-extras-classes-powerctl">` +
    (k.stay ? stayHtml(k, onStays) : "") +
    `<input type="number" min="1" step="1" inputmode="numeric" class="acks-input acks-input--num acks-extras-classes-poweramount acks-nums" data-power-amount data-power-kind="${k.kind}" value="${esc(amount)}" aria-label="${esc(k.amountLabel)}" data-tooltip="">` +
    `<button type="button" class="acks-btn acks-btn--secondary acks-btn--sm acks-extras-classes-poweract" data-power-adjust="1" data-power-kind="${k.kind}" aria-label="${esc(k.addLabel)}" data-tooltip="">${esc(k.addText)}</button>` +
    `<button type="button" class="acks-btn acks-btn--secondary acks-btn--sm acks-extras-classes-poweract" data-power-adjust="-1" data-power-kind="${k.kind}" data-power-label="${esc(k.removeLabel)}" data-power-label-stays="${esc(k.removeStaysLabel)}" aria-label="${esc(onStays ? k.removeStaysLabel : k.removeLabel)}" data-tooltip="">${esc(k.removeText)}</button>` +
    count +
    `</div>`
  );
}

/** One kind's panel: its heading with the balance as text, an owner's controls, the Sacrifice button where this seat has one (`opener`) and its entry rows, hidden until the window's record opens it. */
function panelHtml(model, k, state, opener) {
  const open = state.open?.[k.kind] === true;
  const list = k.rows.length
    ? `<ul class="acks-extras-classes-powerlist">${k.rows.map(rowHtml).join("")}</ul>`
    : `<span class="acks-extras-classes-powerempty">${esc(model.emptyText)}</span>`;
  return (
    `<div class="acks-extras-classes-powerpanel" id="${esc(panelId(state, k.kind))}" data-power-panel="${k.kind}"${open ? "" : " hidden"}>` +
    `<div class="acks-extras-classes-powerhead"><span class="acks-label acks-extras-classes-powerheadtext">${esc(k.label)} <span class="acks-nums acks-extras-classes-powerbal" data-power-balance="${k.kind}" data-tooltip-text="${esc(k.tip)}">${k.balance}</span></span>${model.owns ? controlsHtml(k, state) : ""}${opener}</div>` +
    list +
    `</div>`
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
 * The ledger's markup for the strip, or "" where there is nothing to draw: no
 * power is shown for the character (it casts none of them, holds no entries and
 * has no class power marked), whatever the seat and whatever the Sacrifice
 * button's own rule says.
 * @param {Actor} actor
 * @param {boolean} casts whether the actor has any casting pool to draw, which the Sacrifice button's rule reads
 * @param {object} [state] the window's record (`powerSwitchOf`): each panel is drawn open or closed, each switch pressed and each amount box filled to match
 */
export function powerSectionHtml(actor, casts, state = powerSwitchOf(null)) {
  let model = null;
  try {
    model = chipModelFor(actor);
  } catch (err) {
    console.error("acks-extras | the power ledger could not be read", err);
  }
  const shown = model ? model.kinds.filter((k) => k.shown) : [];
  if (!shown.length) return "";
  const opener = openerHtml(actor, casts);
  return `<div class="acks-extras-classes-power"><div class="acks-extras-classes-powerchips">${shown.map((k) => chipHtml(k, state)).join("")}</div>${shown.map((k) => panelHtml(model, k, state, opener)).join("")}</div>`;
}

/**
 * Wire the ledger's controls on a strip: the icon that opens a panel, an owner's Add, Remove,
 * Fades / Stays switch and Undo, the arcane count, and the Sacrifice button. The
 * switch and the amount are read at the press: Add and Remove send the typed
 * amount in one request, and a panel set to Stays writes its Add as a lot that
 * stays and its Remove as a removal from the lots that stay. A press of the
 * icon or the switch, and a keystroke in the amount box, write nothing to
 * the actor; they set `state`, the window's record (`powerSwitchOf`), which a
 * render of the strip reads back.
 * @param {Element} strip
 * @param {Actor} actor
 * @param {object} [state] the window's record; a fresh one when none is passed
 */
export function wirePowerChip(strip, actor, state = powerSwitchOf(null)) {
  strip.addEventListener("click", (event) => {
    if (event.target.closest("[data-sacrifice-open]")) {
      event.preventDefault();
      void openSacrifice(actor);
      return;
    }
    const toggle = event.target.closest("[data-power-toggle]");
    if (toggle) {
      event.preventDefault();
      const kind = toggle.dataset.powerKind;
      const open = state.open?.[kind] !== true;
      (state.open ??= {})[kind] = open;
      toggle.setAttribute("aria-expanded", String(open));
      const panel = strip.querySelector?.(`[data-power-panel="${kind}"]`);
      if (panel) panel.hidden = !open;
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
      const args = { amount: Number(state.amount?.[kind] ?? 1), by: "judge" };
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
  const rememberAmount = (event) => {
    const box = event.target.closest("[data-power-amount]");
    if (!box) return false;
    (state.amount ??= {})[box.dataset.powerKind] = String(box.value);
    return true;
  };
  strip.addEventListener("input", rememberAmount);
  strip.addEventListener("change", (event) => {
    if (rememberAmount(event)) return;
    const box = event.target.closest("[data-power-count]");
    if (!box) return;
    void powerApi.setCount(actor, box.value).then(announce);
  });
}
