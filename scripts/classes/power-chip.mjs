/* global foundry */
/**
 * The power ledger's chip on the casting strip: a tag for each power with the
 * balance on its face and the entries in its tooltip, the entries below it as
 * rows, and, for a Judge alone, a plus and a minus on each tag, a Fades / Stays
 * switch beside them and the arcane lifetime's count. The switch sets what that
 * tag's plus writes: a point that fades after the lifetime, or one that stays
 * until a minus takes it. Its state is a closure of `wirePowerChip`, so it lives
 * as long as the strip does and every render starts it on Fades; it is never
 * written to the actor. The classes feature hosts the chip; the ledger is
 * magic's, read and written through `magic/power-ledger-live.mjs`. A Player's
 * strip draws no buttons, no switch and no count, and never a kind with no
 * entries.
 */
import { chipModelFor, powerApi, announce } from "../magic/power-ledger-live.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** A Judge's Fades / Stays switch for one tag: two pills, one pressed, Fades first and pressed. */
function stayHtml(k) {
  const pill = (stays, label, tip) =>
    `<button type="button" class="acks-extras-classes-powerpill" data-power-stay="${stays ? 1 : 0}" data-power-kind="${k.kind}" aria-pressed="${stays ? "false" : "true"}" data-tooltip-text="${esc(tip)}">${esc(label)}</button>`;
  return `<span class="acks-extras-classes-powerstay" role="group" aria-label="${esc(k.stay.group)}">${pill(false, k.stay.fades, k.stay.fadesTip)}${pill(true, k.stay.stays, k.stay.staysTip)}</span>`;
}

/** One power's tag, with a Judge's controls beside it, all in one wrapping group. */
function chipHtml(model, k) {
  const buttons = model.judge
    ? `<button type="button" class="acks-extras-classes-powerbtn" data-power-adjust="1" data-power-kind="${k.kind}" aria-label="${esc(k.addLabel)}" data-tooltip=""><i class="fa-solid fa-plus" inert></i></button>` +
      `<button type="button" class="acks-extras-classes-powerbtn" data-power-adjust="-1" data-power-kind="${k.kind}" aria-label="${esc(k.removeLabel)}" data-tooltip=""><i class="fa-solid fa-minus" inert></i></button>`
    : "";
  const stay = model.judge && k.stay ? stayHtml(k) : "";
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

/**
 * The ledger's markup for the strip, or "" where there is nothing to draw: a
 * Player with no entries, or an actor that casts nothing and holds no power.
 * @param {Actor} actor
 * @param {boolean} casts whether the actor has any casting pool to draw
 */
export function powerSectionHtml(actor, casts) {
  let model;
  try {
    model = chipModelFor(actor);
  } catch (err) {
    console.error("acks-extras | the power ledger could not be read", err);
    return "";
  }
  if (!model.any || (!casts && !model.hasEntries)) return "";
  const shown = model.kinds.filter((k) => k.shown);
  const rows = shown.flatMap((k) => k.rows);
  const list = rows.length
    ? `<ul class="acks-extras-classes-powerlist">${rows.map(rowHtml).join("")}</ul>`
    : `<span class="acks-extras-classes-powerempty">${esc(model.emptyText)}</span>`;
  return `<div class="acks-extras-classes-power"><div class="acks-extras-classes-powerchips">${shown.map((k) => chipHtml(model, k)).join("")}</div>${list}</div>`;
}

/**
 * Wire the ledger's controls on a strip: a Judge's plus, minus, Fades / Stays
 * switch and Undo, and the arcane count. The switch is read at the plus: a tag
 * set to Stays writes its next gain as a lot that stays. A press of the switch
 * writes nothing; its state is this call's, per strip, and starts on Fades.
 */
export function wirePowerChip(strip, actor) {
  const stays = { divine: false, arcane: false };
  strip.addEventListener("click", (event) => {
    const pill = event.target.closest("[data-power-stay]");
    if (pill) {
      event.preventDefault();
      stays[pill.dataset.powerKind] = pill.dataset.powerStay === "1";
      for (const other of pill.parentElement?.querySelectorAll?.("[data-power-stay]") ?? []) other.setAttribute("aria-pressed", String(other === pill));
      return;
    }
    const adjust = event.target.closest("[data-power-adjust]");
    if (adjust) {
      event.preventDefault();
      const { powerKind: kind, powerAdjust } = adjust.dataset;
      const args = { amount: 1, by: "judge" };
      if (Number(powerAdjust) > 0 && stays[kind] === true) args.stays = true;
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
