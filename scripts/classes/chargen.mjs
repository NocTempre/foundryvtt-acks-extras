/* global game, foundry, ui, Hooks, Actor, Roll, ChatMessage */
/**
 * Chargen: applying a starting template — the printed selection rule and the
 * named-item skinning layer.
 *
 * RAW (RR p.23): roll 3d6, then take the rolled template or any template
 * from a LOWER band, never a higher one; a Judge may allow a straight pick.
 * The wizard rolls, offers exactly the legal set, and applies the bundle:
 * proficiencies as owned abilities (a printed rank N grants N copies — the
 * family's taken-multiple-times convention), equipment as SKINS — the
 * printed descriptor becomes the item's name over the base item's mechanics
 * — coin as a money item, and the Intellect bonus general picks.
 *
 * Base resolution for a skin: an explicit ref (cookbook id / `name:<Item>` /
 * `uuid:`), else the longest world-item name contained in the descriptor.
 * What resolves to nothing imports as a bare named item — visible, never
 * dropped.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { classForActor, classItems, findByRef } from "./registry.mjs";
import { applyClass } from "./apply.mjs";

const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Resolve a template item entry to its BASE world item (null = no base). */
export function resolveBase(entry) {
  if (entry.ref) {
    if (entry.ref.startsWith("name:")) {
      const name = entry.ref.slice(5);
      return game.items.find((i) => ["weapon", "armor", "item"].includes(i.type) && i.name.toLowerCase() === name.toLowerCase()) ?? null;
    }
    const doc = findByRef(entry.ref);
    if (doc) return doc;
  }
  const f = fold(entry.name);
  let best = null;
  for (const i of game.items) {
    if (!["weapon", "armor", "item"].includes(i.type)) continue;
    const nf = fold(i.name);
    if (nf.length >= 6 && f.includes(nf) && (!best || nf.length > fold(best.name).length)) best = i;
  }
  return best;
}

/** Build the embedded-item payload for one template item entry (skinned). */
function skinPayload(entry) {
  const base = resolveBase(entry);
  const skinName = entry.skinName || entry.name.replace(/^\w/, (c) => c.toUpperCase());
  if (!base) {
    return {
      name: skinName,
      type: "item",
      system: { quantity: { value: entry.qty || 1, max: 0 } },
      flags: { [MODULE_ID]: { skin: { base: null, descriptor: entry.name } } },
    };
  }
  const data = base.toObject();
  delete data._id;
  data.name = skinName;
  foundry.utils.setProperty(data, "system.quantity.value", entry.qty || 1);
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { skin: { base: entry.ref || `uuid:${base.uuid}`, descriptor: entry.name } } };
  return data;
}

/** INT-based bonus general picks per the RR sidebar (13–15/16–17/18). */
export function intBonusPicks(intScore) {
  if (intScore >= 18) return 3;
  if (intScore >= 16) return 2;
  if (intScore >= 13) return 1;
  return 0;
}

/** Grant one ability ref N times (rank N = N copies, the family convention). */
async function grantRanked(actor, entry, report) {
  const source = findByRef(entry.ref);
  if (!source) {
    report.unresolved.push(entry.name || entry.ref);
    return;
  }
  const data = source.toObject();
  delete data._id;
  if (entry.selection) data.name = `${data.name} (${entry.selection})`;
  const copies = Array.from({ length: Math.max(1, entry.rank || 1) }, () => foundry.utils.deepClone(data));
  await actor.createEmbeddedDocuments("Item", copies);
  report.granted.push(copies.length > 1 ? `${data.name} ×${copies.length}` : data.name);
}

/** Apply one template's full bundle to the actor. */
export async function applyTemplate(actor, classItem, template, { generalRefs = [] } = {}) {
  const report = { granted: [], items: [], unresolved: [], gp: template.gp || 0 };
  for (const entry of template.abilities ?? []) {
    if (entry.ref) await grantRanked(actor, entry, report);
    else if (entry.name) report.unresolved.push(entry.name);
  }
  const payloads = (template.items ?? []).map(skinPayload);
  if (payloads.length) {
    await actor.createEmbeddedDocuments("Item", payloads);
    report.items = payloads.map((p) => (p.system?.quantity?.value > 1 ? `${p.name} ×${p.system.quantity.value}` : p.name));
  }
  if (template.gp) {
    await actor.createEmbeddedDocuments("Item", [
      { name: "Gold Pieces", type: "money", system: { quantity: template.gp } },
    ]);
  }
  for (const ref of generalRefs) await grantRanked(actor, { ref, rank: 1 }, report);
  return report;
}

/** The templates a 3d6 roll legally offers: the rolled band and every lower one. */
export const legalTemplates = (templates, roll) =>
  templates.filter((t) => t.rollMin <= roll).sort((a, b) => a.rollMin - b.rollMin);

/** Run the chargen wizard for one character. */
export async function openChargen(actor) {
  const classItem = classForActor(actor) ?? null;
  const classes = classItems().sort((a, b) => a.name.localeCompare(b.name));
  if (!classes.length) {
    ui.notifications?.info(game.i18n.localize(`${LANG_PREFIX}.pick.empty`));
    return;
  }
  const roll = await new Roll("3d6").evaluate();
  const intScore = Number(actor.system?.scores?.int?.value) || 0;
  const bonusPicks = intBonusPicks(intScore);
  const generals = (game.items ?? [])
    .filter((i) => i.type === "ability" && i.system.proficiencytype === "general")
    .sort((a, b) => a.name.localeCompare(b.name));
  const generalOptions = generals
    .map((i) => {
      const ref = i.flags?.["acks-importer"]?.cookbook?.id ?? `uuid:${i.uuid}`;
      return `<option value="${foundry.utils.escapeHTML(ref)}">${foundry.utils.escapeHTML(i.name)}</option>`;
    })
    .join("");
  const classOptions = classes
    .map((c) => `<option value="${c.uuid}"${classItem?.uuid === c.uuid ? " selected" : ""}>${foundry.utils.escapeHTML(c.name)}</option>`)
    .join("");
  const bonusBlocks = Array.from({ length: bonusPicks }, (_, i) =>
    `<div class="form-group"><label>${game.i18n.format(`${LANG_PREFIX}.chargen.bonusPick`, { n: i + 1 })}</label><select name="bonus-${i}">${generalOptions}</select></div>`,
  ).join("");

  const content = `
    <p>${game.i18n.format(`${LANG_PREFIX}.chargen.prompt`, { name: actor.name, roll: roll.total })}</p>
    <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.pick.class`)}</label>
      <select name="uuid">${classOptions}</select></div>
    <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.chargen.template`)}</label>
      <select name="template"></select></div>
    ${bonusBlocks}
    <p class="hint">${game.i18n.localize(`${LANG_PREFIX}.chargen.rule`)}</p>`;

  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format(`${LANG_PREFIX}.chargen.title`, { name: actor.name }) },
    content,
    render: (_event, dialog) => {
      const form = dialog.element.querySelector("form") ?? dialog.element;
      const classSel = form.querySelector('select[name="uuid"]');
      const tplSel = form.querySelector('select[name="template"]');
      const refresh = () => {
        const cls = classes.find((c) => c.uuid === classSel.value);
        const legal = legalTemplates(cls?.system.templates ?? [], roll.total);
        tplSel.innerHTML = legal
          .map(
            (t, i) =>
              `<option value="${t.rollMin}"${i === legal.length - 1 ? " selected" : ""}>${foundry.utils.escapeHTML(
                t.name + (t.annotation ? ` (${t.annotation})` : ""),
              )} [${t.rollMin}–${t.rollMax}]</option>`,
          )
          .join("");
      };
      classSel.addEventListener("change", refresh);
      refresh();
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.chargen.apply`),
      callback: (_event, button) => ({
        uuid: button.form.elements.uuid?.value,
        rollMin: Number(button.form.elements.template?.value),
        bonus: Array.from({ length: bonusPicks }, (_, i) => button.form.elements[`bonus-${i}`]?.value).filter(Boolean),
      }),
    },
    rejectClose: false,
  });
  if (!picked?.uuid) return;
  const cls = classes.find((c) => c.uuid === picked.uuid);
  const template = (cls.system.templates ?? []).find((t) => t.rollMin === picked.rollMin);
  if (!template) return;

  await applyClass(actor, cls, { level: 1, confirm: false });
  const report = await applyTemplate(actor, cls, template, { generalRefs: picked.bonus });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.chargen.chat`, {
      name: actor.name,
      class: cls.name,
      template: template.name,
      roll: roll.total,
    })}</p><p>${[...report.granted, ...report.items].map((n) => foundry.utils.escapeHTML(n)).join(", ")}${
      report.gp ? ` — ${report.gp} gp` : ""
    }</p>${report.unresolved.length ? `<p><em>?</em> ${report.unresolved.map((n) => foundry.utils.escapeHTML(n)).join(", ")}</p>` : ""}`,
  });
}

/** Inject the chargen control beside the picker for fresh characters. */
function onRenderCharacterSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const doc = app.document;
  if (!(doc instanceof Actor) || doc.type !== "character" || !doc.isOwner) return;
  if ((Number(doc.system?.details?.level) || 1) > 1) return;
  const pick = root.querySelector(".acks-extras-classes-pick");
  if (!pick || pick.parentElement.querySelector(".acks-extras-classes-chargen")) return;
  const btn = document.createElement("a");
  btn.className = "acks-extras-classes-chargen";
  btn.dataset.tooltip = game.i18n.localize(`${LANG_PREFIX}.chargen.tooltip`);
  btn.innerHTML = '<i class="fa-solid fa-dice"></i>';
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    openChargen(doc);
  });
  pick.insertAdjacentElement("afterend", btn);
}

/** Register the chargen sheet control (called once from classes/module.mjs). */
export function registerChargen() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
}
