/* global game, ui, foundry, canvas, ChatMessage */
/**
 * The Judge's item-loss flow (JJ p. 398, the optional rule): ask for the hit
 * points after the attack, the damage type and the direction, plan the loss
 * with the figures the import read (`overlays/item-loss.mjs`), show what it
 * would do, and on a yes write it to the items' own condition.
 *
 * What a write is: a light item is marked destroyed (`setDestroyed`), and a
 * heavy armour takes the armour class its full stones of damage cost into its
 * own item-loss layer (`loseArmourClass`), which the item sheet's Durability
 * tab reads. Nothing else is stored: damage that has no effect (`marred`, and a
 * heavy item under one full stone) writes nothing.
 *
 * The overlay's setting gates the dialog and the write both. With the import
 * unread the dialog says what to import and offers no form, and the plan does
 * nothing.
 */
import { LANG } from "./constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { DAMAGE_TYPES } from "../lib/vocab.mjs";
import { damageTypeLabel } from "../lib/damage-type.mjs";
import { STONE } from "../lib/item-model.mjs";
import { citeOf } from "../lib/tables.mjs";
import { getLoadout } from "./loadout.mjs";
import { loseArmourClass, setItemLossAc, setDestroyed } from "./actions.mjs";
import { itemLossAcOf } from "./properties.mjs";
import { overlayEnabled, planItemLoss, itemLossFigures, itemLossMaterials, lossMissing, ITEM_LOSS_TABLES } from "./overlays/item-loss.mjs";
import { RULEDATA_DOC } from "./overlays/scavenged.mjs";

const loc = makeLoc(LANG);

/** The classes every window of this module names, so it is held to the scroll contract and gets its drag corner. */
const CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];

/** Text safe to put inside markup or an attribute. */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Stones with at most two decimals ("0.33", "2"). */
const stones = (weight6) => Math.round((weight6 / STONE) * 100) / 100;

/** The damage types a loss is asked about: the vocabulary's own, bar the one that defers to the weapon. */
export const ITEM_LOSS_DAMAGE_TYPES = Object.freeze(Object.keys(DAMAGE_TYPES).filter((key) => key !== "varies"));

/**
 * Apply a plan: mark each destroyed item and take armour class off each
 * damaged armour. Refuses while the overlay is off or the plan is not ready.
 * `damaged` counts the items whose armour class changed; an entry with nothing
 * to lose writes nothing and is not counted.
 * @returns {Promise<{applied: boolean, reason?: "off"|"notImported", destroyed?: number, damaged?: number, acLost?: number}>}
 */
export async function applyItemLoss(plan) {
  if (!overlayEnabled()) return { applied: false, reason: "off" };
  if (!plan?.ready) return { applied: false, reason: "notImported" };
  let acLost = 0;
  let damaged = 0;
  for (const d of plan.destroyed) await setDestroyed(d.item, true);
  for (const d of plan.damaged) {
    if (await loseArmourClass(d.item, d.acLost)) {
      acLost += d.acLost;
      damaged++;
    }
  }
  return { applied: true, destroyed: plan.destroyed.length, damaged, acLost };
}

/**
 * Give an armour the armour class item loss took from it, after a confirm. The
 * confirm names the item and the count, and a Cancel or a closed window changes
 * nothing. No callback is passed, so core's own yes (true) and no (false) stand.
 * @param {Item} item an armour
 * @returns {Promise<boolean>} whether the armour class was restored
 */
export async function restoreItemLoss(item) {
  const lost = itemLossAcOf(item);
  if (!(lost > 0)) return false;
  const go = await foundry.applications.api.DialogV2.confirm({
    classes: CLASSES,
    window: { title: loc("itemLoss.restore") },
    content: `<p>${esc(loc("itemLoss.restoreBody", { name: item.name, n: lost }))}</p>`,
    yes: { label: loc("itemLoss.restoreYes") },
    no: { label: loc("itemLoss.cancel") },
    rejectClose: false,
  });
  if (go !== true) return false;
  return setItemLossAc(item, 0);
}

/**
 * The plan as a card: what is at risk, then each item with where its fate came
 * from. Every figure carries a tooltip naming the parts and the page the
 * import read them from.
 * @param {object} plan a `planItemLoss` result that is ready
 * @param {{damageType: string, fromRear: boolean, figures?: object}} context
 * @returns {string} markup
 */
export function planMarkup(plan, { damageType, fromRear = false, figures = itemLossFigures() } = {}) {
  const cite = citeOf(RULEDATA_DOC, ITEM_LOSS_TABLES.figures) ?? loc("itemLoss.byHand");
  const tip = (key, data) => esc(loc(`itemLoss.${key}`, { cite, ...data }));
  const type = damageTypeLabel(damageType);
  const risk = tip("riskTip", { threshold: figures.threshold, step: figures.step });
  const rows = (list, line) => (list.length ? `<ul>${list.map(line).join("")}</ul>` : "");
  const destroyed = rows(plan.destroyed, (d) => `<li data-tooltip-text="${tip("destroyTip", { weight: stones(d.weight6), light: figures.lightMax })}"><b>${esc(d.item.name)}</b> <small>(${esc(d.material)})</small></li>`);
  const damaged = rows(plan.damaged, (d) => {
    const acTip = d.acLost ? ` data-tooltip-text="${tip("acTip", { stones: d.stones, per: figures.acPerStone })}"` : "";
    const ac = d.acLost ? `<span${acTip}>${esc(loc("itemLoss.acLost", { n: d.acLost }))}</span>` : "";
    const idle = d.stones ? "" : ` <em>${esc(loc("itemLoss.noEffect"))}</em>`;
    return `<li data-tooltip-text="${tip("damageTip", { weight: stones(d.weight6), heavy: figures.heavyMin })}"><b>${esc(d.item.name)}</b> <small>(${esc(d.material)})</small> ${esc(loc("itemLoss.damagedLine", { stones: stones(d.damage6) }))}${idle} ${ac}</li>`;
  });
  const marred = rows(plan.marred ?? [], (d) => `<li data-tooltip-text="${tip("marredTip", { weight: stones(d.weight6), left: stones(d.damage6), light: figures.lightMax })}"><b>${esc(d.item.name)}</b> <small>(${esc(d.material)})</small> ${esc(loc("itemLoss.damagedLine", { stones: stones(d.damage6) }))} <em>${esc(loc("itemLoss.noEffect"))}</em></li>`);
  const unplaced = rows(plan.unplaced, (d) => `<li data-tooltip-text="${tip("unplacedTip", { weight: stones(d.weight6), light: figures.lightMax, heavy: figures.heavyMin })}"><b>${esc(d.item.name)}</b> <small>(${esc(d.material)})</small></li>`);
  const section = (key, body) => (body ? `<h4>${esc(loc(`itemLoss.${key}`))}</h4>${body}` : "");
  const nothing = !plan.destroyed.length && !plan.damaged.length && !(plan.marred ?? []).length && !plan.unplaced.length ?`<p><em>${esc(loc("itemLoss.nothing"))}</em></p>` : "";
  const skipped = plan.survivors ? `<p><small>${esc(loc("itemLoss.skipped", { n: plan.survivors }))}</small></p>` : "";
  return `<div class="acks-extras-item-loss"><p><b data-tooltip-text="${risk}">${plan.stones}</b> ${esc(loc("itemLoss.atRisk", { type, rear: fromRear ? loc("itemLoss.fromRear") : "" }))}</p>`
    + `${section("destroyedHead", destroyed)}${section("damagedHead", damaged)}${section("marredHead", marred)}${section("unplacedHead", unplaced)}${nothing}${skipped}</div>`;
}

/** The notice a Judge gets while the import is unread: what to import, and no form. */
function notImportedNotice(missing) {
  return foundry.applications.api.DialogV2.prompt({
    classes: CLASSES,
    window: { title: loc("itemLoss.windowTitle") },
    content: `<p>${esc(loc("itemLoss.notImported", { tables: missing.join(", ") }))}</p>`,
    ok: { label: loc("itemLoss.close") },
    rejectClose: false,
  });
}

/** The token's actor, else the user's own character. */
const defaultActor = () => canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;

/**
 * Open the Judge's flow for an actor: the question, the plan, the confirm, the
 * write and the card. Resolves the plan, with the write's result when one was
 * made; null when the overlay is off, there is no actor or the window closed.
 * @param {Actor} [actor] the token's actor, else the user's character
 * @returns {Promise<{plan: object, result: object|null}|null>}
 */
export async function openItemLoss(actor = defaultActor()) {
  const dialogs = foundry.applications.api.DialogV2;
  if (!overlayEnabled()) {
    ui.notifications.warn(loc("itemLoss.off", { setting: game.i18n.localize(`${LANG}.settings.overlayItemLoss.name`) }));
    return null;
  }
  if (!actor) {
    ui.notifications.warn(loc("itemLoss.noActor"));
    return null;
  }
  const gaps = lossMissing({ figures: itemLossFigures(), materials: itemLossMaterials() });
  if (gaps.length) {
    await notImportedNotice(gaps);
    return null;
  }

  const options = ITEM_LOSS_DAMAGE_TYPES.map((key) => `<option value="${esc(key)}">${esc(damageTypeLabel(key))}</option>`).join("");
  const form = await dialogs.prompt({
    classes: CLASSES,
    window: { title: loc("itemLoss.title", { name: actor.name }) },
    content: `<div class="acks-extras-item-loss-form">
      <label>${esc(loc("itemLoss.hp"))} <input type="number" name="hp" value="${esc(actor.system?.hp?.value ?? 0)}"></label>
      <label>${esc(loc("itemLoss.damageType"))} <select name="dt">${options}</select></label>
      <label><input type="checkbox" name="rear"> ${esc(loc("itemLoss.rear"))}</label>
    </div>`,
    ok: { label: loc("itemLoss.resolve"), callback: (_event, button) => new FormData(button.form) },
    rejectClose: false,
  });
  if (!form) return null;

  const context = { damageType: String(form.get("dt")), fromRear: !!form.get("rear") };
  const plan = planItemLoss(actor, getLoadout(actor), { hp: Number(form.get("hp")), ...context });
  if (!plan.ready) {
    await notImportedNotice(plan.missing);
    return { plan, result: null };
  }
  if (!plan.stones) {
    ui.notifications.info(loc("itemLoss.notLowEnough"));
    return { plan, result: null };
  }

  const card = planMarkup(plan, context);
  const go = await dialogs.confirm({
    classes: CLASSES,
    window: { title: loc("itemLoss.title", { name: actor.name }) },
    content: card,
    yes: { label: loc("itemLoss.apply") },
    no: { label: loc("itemLoss.cancel") },
    rejectClose: false,
  });
  if (!go) return { plan, result: null };
  const result = await applyItemLoss(plan);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="acks-equipment-loadout"><h3>${esc(loc("itemLoss.title", { name: actor.name }))}</h3>${card}</div>`,
  });
  return { plan, result };
}
