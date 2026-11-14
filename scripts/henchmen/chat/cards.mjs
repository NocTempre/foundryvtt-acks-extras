/* global game, foundry, ChatMessage, CONST */
/**
 * Chat cards. Every roll explains itself: formula, each applied modifier by
 * name, natural roll, adjusted total, outcome. Secret throws whisper the full
 * card to GMs; a [Reveal] button on the GM card posts a sanitized public card
 * (outcome text only, no numbers).
 */
import { MODULE_ID } from "../constants.mjs";
import { gmIds } from "../acks-adapter.mjs";
import { postToJudges } from "../../lib/roll-audience.mjs";
import { elementOf, locOr } from "../../lib/util.mjs";

const T = `modules/${MODULE_ID}/templates/henchmen/chat`;

function outcomeText(outcome) {
  if (!outcome) return null;
  return locOr(`ACKS-HENCHMEN.outcome.${outcome}`, outcome);
}

/**
 * Post a throw card: the secret ones whisper to the Judges, the rest go to chat.
 * @param {object} o - { def, title, roll, natural, parts, total, outcome,
 *                       secret, speaker, actor }
 */
export async function postThrowCard(o) {
  const content = await foundry.applications.handlebars.renderTemplate(`${T}/throw-card.hbs`, {
    title: o.title,
    formula: o.def.formula,
    natural: o.natural,
    adjusted: o.roll.total,
    total: o.total >= 0 ? `+${o.total}` : `${o.total}`,
    parts: (o.parts ?? []).map((p) => ({ ...p, display: p.value >= 0 ? `+${p.value}` : `${p.value}` })),
    outcome: o.outcome,
    outcomeText: outcomeText(o.outcome),
    outcomeHint: locOr(`ACKS-HENCHMEN.outcomeHint.${o.outcome}`, null),
    secret: !!o.secret,
  });
  const message = {
    content,
    rolls: [o.roll],
    speaker: o.speaker ?? ChatMessage.getSpeaker({ actor: o.actor }),
    style: CONST.CHAT_MESSAGE_STYLES?.OTHER,
    flags: { [MODULE_ID]: { throwCard: true, throwId: o.def.label, outcome: o.outcome, title: o.title } },
  };
  return o.secret ? postToJudges(message) : ChatMessage.create(message);
}

/** Sanitized public reveal of a secret throw: outcome only, no numbers. */
export async function postRevealCard({ title, outcome, actor }) {
  const content = await foundry.applications.handlebars.renderTemplate(`${T}/reveal-card.hbs`, {
    title,
    outcomeText: outcomeText(outcome),
  });
  return ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [MODULE_ID]: { revealCard: true } },
  });
}

/**
 * GM event card with action buttons (calamity detected, level gained, wages
 * due…). Buttons carry data-action + data payload; a delegated click handler
 * in module.mjs routes them (engine/events.mjs registers the handlers).
 * @param {object} o - { titleKey, bodyKey, data, buttons: [{action,label,icon,payload}], actor }
 */
export async function postEventCard(o) {
  const content = await foundry.applications.handlebars.renderTemplate(`${T}/event-card.hbs`, {
    title: game.i18n.format(o.titleKey, o.data ?? {}),
    body: o.bodyKey ? game.i18n.format(o.bodyKey, o.data ?? {}) : null,
    buttons: (o.buttons ?? []).map((b) => ({
      ...b,
      label: locOr(b.label, b.label),
      tooltip: b.tooltip ?? null,
      payload: JSON.stringify(b.payload ?? {}),
    })),
  });
  return ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor: o.actor }),
    whisper: gmIds(),
    flags: { [MODULE_ID]: { eventCard: true } },
  });
}

/** Handlers for event-card button actions, keyed by action name. */
const _handlers = new Map();

/** Register the handler `bindCardListeners` calls (with the button's payload and the click event) for a card button's action. */
export function registerCardAction(action, handler) {
  _handlers.set(action, handler);
}

/** Wire the click handlers of the event-card buttons under a rendered message's HTML. */
export function bindCardListeners(html) {
  const root = elementOf(html);
  if (!root) return;
  root.querySelectorAll(`[data-${MODULE_ID}-action]`).forEach((el) => {
    el.addEventListener("click", async (event) => {
      event.preventDefault();
      const action = el.dataset[`${MODULE_ID.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Action`];
      const handler = _handlers.get(action);
      if (!handler) return;
      let payload = {};
      try {
        payload = JSON.parse(el.dataset.payload ?? "{}");
      } catch {
        /* leave empty */
      }
      await handler(payload, event);
    });
  });
}
