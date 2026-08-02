/* global game, ui, foundry */
/**
 * "What do you want to leave here?" — the picker in front of `acksLib.storage.stash`.
 *
 * Stackables get a quantity box (blank means the whole stack); a container is
 * flagged so nobody is surprised that its contents travel with it. Everything
 * picked moves in ONE transfer call, because a single move that fails halfway is
 * far easier to reason about than twenty that each might.
 */
import { makeLoc, libStorage as storage } from "../../lib/util.mjs";
import { LANG_PREFIX } from "../constants.mjs";

const loc = makeLoc(LANG_PREFIX);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/** Worth offering: things, and coin (which the system does not call "physical"). */
const stowable = (actor) => actor.items.filter((i) => globalThis.acksExtras?.lib.itemModel.isPhysical(i) || i.type === "money");

/** Is this one of acks-equipment's containers? Read the documented flag, never import. */
const isContainer = (item) => !!item.getFlag?.("acks-extras", "container");

function rowHTML(item) {
  const qty = storage().quantityOf(item.toObject())?.value ?? null;
  const holds = isContainer(item) ? ` <em class="acks-location-hint">${loc("storage.takesContents")}</em>` : "";
  return `<li class="acks-location-pick">
    <label>
      <input type="checkbox" name="pick_${item.id}" />
      <img src="${esc(item.img)}" alt="" />
      <span class="acks-location-pick-name">${esc(item.name)}</span>
      ${qty == null ? "" : `<span class="acks-location-pick-qty">&times;${qty}</span>`}
    </label>
    ${qty == null ? "" : `<input type="number" class="acks-location-qty" name="qty_${item.id}" min="1" max="${qty}" placeholder="${qty}" />`}
    ${holds}
  </li>`;
}

const listHTML = (actor) => {
  const items = stowable(actor);
  return items.length
    ? `<ul class="acks-location-picks">${items.map(rowHTML).join("")}</ul>`
    : `<p class="acks-location-empty">${loc("storage.nothingToStore")}</p>`;
};

/**
 * Open the picker. `sources` is one character or several — the location sheet's
 * own button does not know which of your characters you meant.
 * @returns {Promise<boolean>} whether anything was stored
 */
export async function openStashDialog(sources, provider) {
  const characters = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  if (!characters.length || !provider) return false;
  const pick = (id) => characters.find((c) => c.id === id) ?? characters[0];

  const chooser =
    characters.length > 1
      ? `<div class="acks-location-pick-actor"><label>${loc("storage.fromCharacter")}
           <select name="source">${characters.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
         </label></div>`
      : "";

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("storage.stashTitle") },
    classes: ["acks-extras"],
    content: `<div class="acks-location-stash-dialog">
        <p>${loc("storage.stashInto", { place: esc(provider.name) })}</p>
        ${chooser}
        <div class="acks-location-pick-list">${listHTML(characters[0])}</div>
      </div>`,
    render: (_event, dialog) => {
      // Switching character rebuilds the list: the picks belong to one actor.
      const root = dialog?.element;
      root?.querySelector("select[name=source]")?.addEventListener("change", (event) => {
        root.querySelector(".acks-location-pick-list").innerHTML = listHTML(pick(event.currentTarget.value));
      });
    },
    ok: {
      label: loc("storage.stashConfirm"),
      callback: (_event, button) => {
        const form = button.form;
        const actor = pick(form.elements.source?.value);
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
  const outcome = await storage().stash(pick(result.actorId), provider, result.spec);
  if (outcome?.ok) {
    ui.notifications.info(loc("storage.stashed", { count: outcome.manifest.length, place: provider.name }));
  }
  return !!outcome?.ok;
}
