/* global game, ui, foundry, ChatMessage */
/**
 * "What do you want to leave here?" — the picker in front of the lib storage `stash`.
 *
 * Stackables get a quantity box (blank means the whole stack); a container is
 * flagged because its contents travel with it. Everything picked moves in ONE
 * transfer call.
 * See docs/location/DECISIONS.md, "The stash picker moves everything in one transfer call".
 *
 * In `mode: "pay"` the same window is "Pay the house": it offers the chosen
 * character's coin rows only, each with a count box, and the picks move into
 * the place's own coin through the lib's `giveCoin`.
 * See docs/location/MODEL.md, "Paying the house".
 */
import { makeLoc, libStorage as storage, escape as esc, judgesAndOwners } from "../../lib/util.mjs";
import { gpText } from "../../lib/money-logic.mjs";
import { countView } from "../../lib/stack-count.mjs";
import { LANG_PREFIX } from "../constants.mjs";
import { payOffer, paySpec, payTotalCp, payParts } from "../pay-house-logic.mjs";

const loc = makeLoc(LANG_PREFIX);

/** Worth offering: things, and coin (which the system does not call "physical"). */
const stowable = (actor) => actor.items.filter((i) => !!globalThis.acksExtras?.lib.itemModel.isGoods(i));

/** The lib's money subsystem: where coin is paid and where a reach is read. */
const money = () => globalThis.acksExtras?.lib.money;

/** The coin a character can pay with: rows on hand that no lock shuts. */
const givable = (actor) => money()?.givableCoin(actor) ?? [];

/** Can gear go inside this? The lib subsystem owns the answer. */
const isContainer = (item) => !!globalThis.acksExtras?.lib.places.isContainerItem(item);

/**
 * One row of the picker. The count draws on `countView`'s rule (above one,
 * always for coin), the take-how-many box on `offersCount`: a row in use has
 * none, and a blank box means the whole stack.
 */
export function rowHTML(item) {
  const plain = item.toObject();
  const { qty: count, stack, countTip } = countView(plain);
  const qty = storage().offersCount(plain) ? (storage().quantityOf(plain)?.value ?? null) : null;
  const holds = isContainer(item) ? ` <em class="acks-location-hint">${loc("storage.takesContents")}</em>` : "";
  return `<li class="acks-location-pick">
    <label>
      <input type="checkbox" name="pick_${item.id}" />
      <img src="${esc(item.img)}" alt="" />
      <span class="acks-location-pick-name">${esc(item.name)}</span>
      ${stack ? `<span class="acks-location-pick-qty" data-tooltip-text="${esc(countTip)}">&times;${count ?? 0}</span>` : ""}
    </label>
    ${qty == null ? "" : `<input type="number" class="acks-location-qty" name="qty_${item.id}" min="1" max="${qty}" placeholder="${qty}" aria-label="${esc(loc("storage.quantityPrompt"))}" />`}
    ${holds}
  </li>`;
}

/**
 * One row of the pay picker: a coin row, what is held, and a count box capped
 * at what is held (blank pays the whole stack).
 */
export function payRowHTML(item) {
  const { qty: held, countTip } = countView(item.toObject());
  return `<li class="acks-location-pick">
    <label>
      <input type="checkbox" name="pick_${item.id}" />
      <img src="${esc(item.img)}" alt="" />
      <span class="acks-location-pick-name">${esc(item.name)}</span>
      <span class="acks-location-pick-qty" data-tooltip-text="${esc(countTip)}">&times;${held ?? 0}</span>
    </label>
    <input type="number" class="acks-location-qty" name="qty_${item.id}" min="1" max="${held ?? 0}" placeholder="${held ?? 0}" aria-label="${esc(loc("storage.quantityPrompt"))}" />
  </li>`;
}

const listHTML = (actor, paying) => {
  const items = paying ? givable(actor) : stowable(actor);
  if (!items.length) return `<p class="acks-location-empty">${loc(paying ? "storage.pay.nothingToPay" : "storage.nothingToStore")}</p>`;
  return `<ul class="acks-location-picks">${items.map(paying ? payRowHTML : rowHTML).join("")}</ul>`;
};

/** The pay picker's offer for a character and what its form's picks come to. */
function readPay(form, actor) {
  const offer = payOffer(givable(actor));
  const picks = offer.map((o) => ({ id: o.id, checked: !!form?.elements[`pick_${o.id}`]?.checked, raw: form?.elements[`qty_${o.id}`]?.value ?? "" }));
  return { offer, spec: paySpec(offer, picks) };
}

/**
 * Bring the pay picker's total, its tooltip, its reach line and its Pay button
 * up to the picks. A Player out of reach has the reason and a Pay that is off;
 * the Judge has the reason as a warning and a Pay that stays live.
 */
function refreshPay(root, form, actor, place) {
  const { offer, spec } = readPay(form, actor);
  const total = root.querySelector("[data-pay-total]");
  if (total) {
    total.textContent = loc("storage.pay.total", { gp: gpText(payTotalCp(offer, spec) / 100) });
    const parts = payParts(offer, spec).map((p) => loc("storage.coinPart", p)).join(" · ");
    if (parts) total.dataset.tooltipText = parts;
    else delete total.dataset.tooltipText;
  }
  const reach = money()?.coinReach(actor, place) ?? { can: true };
  const line = root.querySelector("[data-pay-reach]");
  if (line) {
    const reason = reach.can ? "" : money().reachRefusalText(reach, actor, place);
    line.hidden = reach.can;
    line.textContent = reach.can ? "" : game.user.isGM ? loc("storage.pay.judgeReach", { reason }) : reason;
  }
  const button = root.querySelector('button[data-action="ok"]');
  if (button) button.disabled = !spec.length || (!reach.can && !game.user.isGM);
}

/** The whispered line: who paid what to which place, to the Judges and the payer's owners. */
async function postPayReceipt(payer, place, outcome) {
  const parts = (outcome.parts ?? []).map((p) => loc("storage.coinPart", p)).join(" · ");
  const text = loc("storage.pay.receipt", { who: esc(payer.name), gp: gpText((outcome.paidCp ?? 0) / 100), place: esc(place.name), parts: esc(parts) });
  await ChatMessage.create({
    content: `<p class="acks-extras-pay-receipt">${text}</p>`,
    whisper: judgesAndOwners(payer),
    speaker: ChatMessage.getSpeaker({ actor: payer }),
  });
}

/**
 * Open the picker. `sources` is one character or several (the dialog then
 * offers a chooser). With `mode: "pay"` it pays the place coin instead of
 * leaving goods.
 * @returns {Promise<boolean>} whether anything was stored, or paid
 */
export async function openStashDialog(sources, provider, { mode = "stash" } = {}) {
  const characters = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  if (!characters.length || !provider) return false;
  const paying = mode === "pay";
  const pick = (id) => characters.find((c) => c.id === id) ?? characters[0];

  const chooser =
    characters.length > 1
      ? `<div class="acks-location-pick-actor"><label>${loc("storage.fromCharacter")}
           <select name="source">${characters.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
         </label></div>`
      : "";
  const payLines = paying
    ? `<p class="acks-extras-pay-total" data-pay-total>${loc("storage.pay.total", { gp: gpText(0) })}</p>
       <p class="acks-extras-pay-reach" data-pay-reach role="status" hidden></p>`
    : "";

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc(paying ? "storage.pay.title" : "storage.stashTitle"), resizable: true },
    position: { width: 520 },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    content: `<div class="acks-location-stash-dialog">
        <p>${loc(paying ? "storage.pay.into" : "storage.stashInto", { place: esc(provider.name) })}</p>
        ${chooser}
        <div class="acks-location-pick-list">${listHTML(characters[0], paying)}</div>
        ${payLines}
      </div>`,
    render: (_event, dialog) => {
      // Switching character rebuilds the list: the picks belong to one actor.
      const root = dialog?.element;
      root?.querySelector("select[name=source]")?.addEventListener("change", (event) => {
        root.querySelector(".acks-location-pick-list").innerHTML = listHTML(pick(event.currentTarget.value), paying);
      });
      if (!paying || !root) return;
      // On the root, so it survives the list being rebuilt; the chooser's own
      // listener above runs first, and the figures follow the new list.
      const refresh = () => {
        const form = root.querySelector("form");
        refreshPay(root, form, pick(form?.elements.source?.value), provider);
      };
      root.addEventListener("input", refresh);
      root.addEventListener("change", refresh);
      refresh();
    },
    ok: {
      label: loc(paying ? "storage.pay.confirm" : "storage.stashConfirm"),
      callback: (_event, button) => {
        const form = button.form;
        const actor = pick(form.elements.source?.value);
        if (paying) return { actorId: actor.id, spec: readPay(form, actor).spec };
        const spec = [];
        for (const item of stowable(actor)) {
          if (!form.elements[`pick_${item.id}`]?.checked) continue;
          const raw = form.elements[`qty_${item.id}`]?.value ?? "";
          spec.push({ id: item.id, quantity: raw === "" ? null : Number(raw) });
        }
        return { actorId: actor.id, spec };
      },
    },
  }).catch(() => null);

  if (!result?.spec?.length) return false;
  if (paying) {
    const payer = pick(result.actorId);
    const outcome = await money().giveCoin({ from: payer, to: provider, coins: result.spec, judge: !!game.user?.isGM });
    if (outcome?.ok) await postPayReceipt(payer, provider, outcome);
    return !!outcome?.ok;
  }
  const outcome = await storage().stash(pick(result.actorId), provider, result.spec);
  if (outcome?.ok) {
    ui.notifications.info(loc("storage.stashed", { count: outcome.manifest.length, place: provider.name }));
  }
  return !!outcome?.ok;
}
