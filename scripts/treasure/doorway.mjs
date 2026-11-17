/* global document, game, Hooks, fromUuidSync, ui, CSS */
/**
 * The doorway: the chat card a pot posts when it opens. It carries only the
 * pot's uuid (`flags.acks-extras.treasure.uuid`); every seat's client fills the
 * count and the haul from the live pile when the message renders, and again
 * whenever a Card of that pile changes, so no message is ever rewritten for a
 * flip. Closing rewrites the message as the record, which clears the uuid, and
 * from then on there is nothing here to fill.
 */
import { makeLoc } from "../lib/util.mjs";
import { LANG, MODULE_ID, POT_FLAG } from "./constants.mjs";
import { findPot, progressOf } from "./pot.mjs";

const loc = makeLoc(LANG);
const ROOT = ".acks-extras-treasure-door";

/** The live pot a doorway element names, or null once it is gone. */
function potOfDoor(el) {
  try {
    const pile = fromUuidSync(el.dataset.potUuid ?? "");
    return pile && findPot(pile.id) ? pile : null;
  } catch {
    return null;
  }
}

/** Fill one doorway's count, haul and row of card backs from the live pot. */
function fill(el) {
  const pile = potOfDoor(el);
  if (!pile) return;
  const { turned, count, haul, view } = progressOf(pile);
  el.querySelector('[data-field="turned"]').textContent = loc("door.turned", { turned, count });
  el.querySelector('[data-field="haul"]').textContent = loc("door.gp", { gp: Math.round(haul.totalGp * 100) / 100 });
  const pips = el.querySelector('[data-field="pips"]');
  pips.replaceChildren(
    ...view.pot.order.map((id) => {
      const span = pips.ownerDocument.createElement("span");
      span.className = "acks-extras-treasure-door__pip";
      if (view.cards.find((c) => c.id === id)?.face != null) span.classList.add("is-up");
      return span;
    }),
  );
}

/** Refresh every rendered doorway for a pile. */
function refresh(pile) {
  if (!pile?.uuid) return;
  for (const el of document.querySelectorAll(`${ROOT}[data-pot-uuid="${CSS.escape(pile.uuid)}"]`)) fill(el);
}

/** Open the pot's window for this seat, or say why it cannot. */
function openTable(el) {
  const pile = potOfDoor(el);
  if (!pile || !pile.testUserPermission(game.user, "LIMITED")) {
    ui.notifications?.warn(loc("refuse.private"));
    return;
  }
  pile.sheet?.render(true);
}

/** Wire the doorway card on every seat. Called once from the feature's module. */
export function installDoorway() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!message.flags?.[MODULE_ID]?.[POT_FLAG]?.uuid) return;
    for (const el of html.querySelectorAll(ROOT)) {
      fill(el);
      el.querySelector('[data-action="openTable"]')?.addEventListener("click", () => openTable(el));
    }
  });
  Hooks.on("updateCard", (card) => refresh(card.parent));
  Hooks.on("updateCards", (pile) => refresh(pile));
}
