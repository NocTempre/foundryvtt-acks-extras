/* global ui */
/**
 * The Kit tab's "Cast a light spell" row: the offers a seat has among the
 * party's members (`magic/light-offers.mjs`), the context the template draws
 * from them, the pick's line that follows the select with no redraw, and the
 * press that opens the caster's own cast window. The cast itself is the Magic
 * tab's: the spell's `use`, with the list the offer stands under.
 */
import { lightOffersFor } from "../magic/light-offers.mjs";
import { skipDialogFor } from "../lib/roll-dialog.mjs";
import { getMemberActor, realMembers } from "./formation-model.mjs";

/** The select's `data-pick` key and the row's root attribute, as the template writes them. */
const PICK = "lightCast";
const ROOT = "[data-light-cast]";

/** The world actors behind the formation's real members, once each: the casters the offers are read from. */
export function lightCasterActors(formation) {
  const seen = new Set();
  const actors = [];
  for (const member of realMembers(formation)) {
    if (seen.has(member.actorId)) continue;
    seen.add(member.actorId);
    const actor = getMemberActor(member);
    if (actor) actors.push(actor);
  }
  return actors;
}

/**
 * The light spells the viewing seat can cast among the party's members. A read
 * that fails is an empty row, never a sheet that does not draw.
 *
 * @param {object} formation
 * @param {(actors: object[]) => Promise<object[]>} [read]  the offers reader, `lightOffersFor` unless a test passes its own
 */
export async function lightCastOffers(formation, read = lightOffersFor) {
  try {
    return await read(lightCasterActors(formation));
  } catch (err) {
    console.error("acks-extras | light cast: reading the offers failed", err);
    return [];
  }
}

/**
 * What the Kit template draws: `lightCasts`, each offer with `picked` true on the
 * one the select opens on, and `lightCastPicked`, that offer. The remembered key
 * is kept while its offer stands; otherwise the first offer is picked.
 */
export async function lightCastContext(formation, key, read) {
  const offers = await lightCastOffers(formation, read);
  const picked = offers.find((offer) => offer.key === key) ?? offers[0] ?? null;
  return { lightCasts: offers.map((offer) => ({ ...offer, picked: offer === picked })), lightCastPicked: picked };
}

/**
 * Draw the picked option's line into the row: the list part and the slots part
 * with their tooltips, the refusal sentence, and Cast's `disabled`. The option
 * carries each as a `data-*` attribute, so a pick needs no redraw.
 */
export function showLightPick(box, select) {
  const option = [...(select.options ?? [])].find((o) => o.value === select.value);
  if (!box || !option) return;
  const part = (name) => box.querySelector(`[data-light-cast-part="${name}"]`);
  const data = option.dataset ?? {};
  const fill = (el, text, tip) => {
    if (!el) return;
    el.textContent = text ?? "";
    if (tip) el.setAttribute("data-tooltip-text", tip);
    else el.removeAttribute("data-tooltip-text");
  };
  fill(part("list"), data.listText, data.listTip);
  fill(part("slots"), data.slotsText, data.slotsTip);
  const slotsWrap = part("slots-wrap");
  if (slotsWrap) slotsWrap.hidden = !data.slotsText;
  fill(part("refusal-text"), data.refusal);
  const refusal = part("refusal");
  if (refusal) refusal.hidden = !data.refusal;
  const button = box.querySelector("[data-action=castLightSpell]");
  if (button) button.disabled = data.blocked === "1";
}

/** The selects already carrying a listener, so a re-render that kept an element does not stack a second. */
const bound = new WeakSet();

/**
 * Bind the row's select: a pick is remembered on the sheet (`lightCastPick`) and
 * its line drawn with no redraw. The line is drawn from the select's own value on
 * every render too, since a restored pick fires no change event. The select is a
 * staging pick, so its change is no form submit.
 */
export function bindLightCast(app) {
  const select = app.element?.querySelector?.(`select[data-pick=${PICK}]`);
  if (!select) return;
  const box = select.closest?.(ROOT);
  showLightPick(box, select);
  if (bound.has(select)) return;
  bound.add(select);
  select.addEventListener("change", () => {
    app.lightCastPick = select.value;
    showLightPick(box, select);
  });
}

/**
 * The Cast press: the offers are read again, so a pick whose spell or slot has
 * gone since the draw is refused quietly. A seat that does not own the spell is
 * refused (Foundry's own ownership), and a blocked offer says its sentence. The
 * cast is the Magic tab's call and is not awaited: its window waits on the
 * player, and the sheet must not.
 *
 * @param {object} app  the party sheet: `formation`, `lightCastPick`, `element`
 * @param {object} event  the click, for the system's skip-dialog key
 * @param {object} target  the Cast button
 * @param {(actors: object[]) => Promise<object[]>} [read]  the offers reader
 */
export async function pressLightCast(app, event, target, read) {
  const formation = app.formation;
  if (!formation) return;
  const select = target?.closest?.(ROOT)?.querySelector?.(`select[data-pick=${PICK}]`);
  const key = select?.value || app.lightCastPick;
  if (!key) return;
  const offer = (await lightCastOffers(formation, read)).find((o) => o.key === key);
  if (!offer) return;
  const actor = lightCasterActors(formation).find((a) => a.id === offer.actorId);
  const item = actor?.items?.get?.(offer.itemId);
  if (!item || item.isOwner !== true) return;
  if (offer.blocked) {
    ui.notifications.warn(offer.refusal);
    return;
  }
  try {
    const used = item.use?.({ skipDialog: skipDialogFor(event), ...(offer.tradition ? { tradition: offer.tradition } : {}) });
    used?.catch?.((err) => console.error("acks-extras | light cast: the cast failed", err));
  } catch (err) {
    console.error("acks-extras | light cast: the cast failed", err);
  }
}
