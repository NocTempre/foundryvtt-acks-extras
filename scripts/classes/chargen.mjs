/* global game, foundry, ui, Hooks, Actor, Roll, ChatMessage, fromUuid */
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
import { offeredClasses } from "./assign.mjs";
import { grantAbility, optionsForChoice } from "./levelup.mjs";

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
  let bestLen = 0;
  for (const i of game.items) {
    if (!["weapon", "armor", "item"].includes(i.type)) continue;
    const nf = fold(i.name);
    const nfStripped = fold(i.name.replace(/\([^)]*\)/g, " "));
    // The paren-stripped name is what an embellished instance contains:
    // "iron-shod spellbook…" holds "spellbook", never "(blank)".
    const hit =
      (nf.length >= 6 && f.includes(nf) && nf.length) ||
      (nfStripped.length >= 6 && f.includes(nfStripped) && nfStripped.length) ||
      0;
    if (hit > bestLen) {
      best = i;
      bestLen = hit;
    }
  }
  return best;
}

/** Build the embedded-item payload for one template item entry (skinned). */
function skinPayload(entry) {
  const base = resolveBase(entry);
  // The count lives on the quantity field — "2 flasks of holy water" is two
  // of an item CALLED "Flasks of holy water", never one item with a numeral
  // in its name.
  const displayName = (entry.qty > 1 ? entry.name.replace(/^\d+\s+/, "") : entry.name).replace(/^\w/, (c) =>
    c.toUpperCase(),
  );
  const skinName = entry.skinName || displayName;
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
  // The instance layer: which generic this is an embellished example of, and
  // the embellishment on its own — the descriptor with the base's name (or
  // its paren-stripped form) excised: "Crudely-crafted shortbow" over Short
  // Bow leaves "Crudely-crafted".
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  let embellishment = "";
  {
    const words = String(entry.name).split(/\s+/);
    const baseFolds = [fold(base.name), fold(base.name.replace(/\([^)]*\)/g, " "))].filter((x) => x.length >= 4);
    // Drop the shortest run of trailing/leading words whose fold matches the
    // base; whatever remains is the embellishment.
    for (let start = 0; start < words.length && !embellishment; start++) {
      for (let end = words.length; end > start; end--) {
        const seg = fold(words.slice(start, end).join(""));
        if (baseFolds.some((b) => seg === b)) {
          embellishment = [...words.slice(0, start), ...words.slice(end)].join(" ").replace(/^[\s,-]+|[\s,-]+$/g, "");
          break;
        }
      }
    }
  }
  data.flags = {
    ...(data.flags ?? {}),
    [MODULE_ID]: {
      skin: {
        base: entry.ref || `uuid:${base.uuid}`,
        baseName: base.name,
        descriptor: entry.name,
        ...(embellishment ? { embellishment } : {}),
      },
    },
  };
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
  // The spells a spellbook carries land as spell ITEMS — a linked uuid first,
  // else the printed name matched against the world's spells; what no world
  // spell answers to stays visible on the unresolved list.
  for (const s of template.spells ?? []) {
    const name = s.name ?? "";
    let doc = null;
    if (s.uuid) doc = await fromUuid(s.uuid).catch(() => null);
    if (!doc && name) {
      const f = fold(name);
      doc =
        game.items.find((i) => i.type === "spell" && fold(i.name) === f) ??
        game.items.find((i) => i.type === "spell" && f.length >= 6 && fold(i.name).includes(f)) ??
        null;
    }
    if (doc) {
      const data = doc.toObject();
      delete data._id;
      await actor.createEmbeddedDocuments("Item", [data]);
      report.granted.push(doc.name);
    } else if (name) {
      report.unresolved.push(name);
    }
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
  if (!classItems().length) {
    ui.notifications?.info(game.i18n.localize(`${LANG_PREFIX}.pick.empty`));
    return;
  }
  let classes = offeredClasses(actor, false);
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
  const classOptionsHtml = (list) =>
    list
      .map((c) => `<option value="${c.uuid}"${classItem?.uuid === c.uuid ? " selected" : ""}>${foundry.utils.escapeHTML(c.name)}</option>`)
      .join("");
  const classOptions = classOptionsHtml(classes);
  const isGM = game.user.isGM;
  const bonusBlocks = Array.from({ length: bonusPicks }, (_, i) =>
    `<div class="form-group"><label>${game.i18n.format(`${LANG_PREFIX}.chargen.bonusPick`, { n: i + 1 })}</label><select name="bonus-${i}">${generalOptions}</select></div>`,
  ).join("");

  const content = `
    <p>${game.i18n.format(`${LANG_PREFIX}.chargen.prompt`, { name: actor.name, roll: roll.total })}</p>
    <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.pick.class`)}</label>
      <select name="uuid">${classOptions}</select></div>
    <div class="form-group">
      <label class="checkbox"><input type="checkbox" name="showAll" /> ${game.i18n.localize(`${LANG_PREFIX}.pick.showAll`)}</label>
    </div>
    <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.chargen.template`)}</label>
      <select name="template"></select></div>
    ${isGM ? `<div class="form-group"><label class="checkbox"><input type="checkbox" name="judge" /> ${game.i18n.localize(`${LANG_PREFIX}.chargen.judgeOverride`)}</label></div>` : ""}
    <div data-role="starting"></div>
    ${bonusBlocks}
    <p class="hint">${game.i18n.localize(`${LANG_PREFIX}.chargen.rule`)}</p>`;

  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format(`${LANG_PREFIX}.chargen.title`, { name: actor.name }) },
    content,
    render: (_event, dialog) => {
      const form = dialog.element.querySelector("form") ?? dialog.element;
      const classSel = form.querySelector('select[name="uuid"]');
      const tplSel = form.querySelector('select[name="template"]');
      const showAll = form.querySelector('input[name="showAll"]');
      const judge = form.querySelector('input[name="judge"]');
      const refresh = () => {
        const cls = classes.find((c) => c.uuid === classSel.value) ?? classes[0];
        // The Judge override lifts the at-or-below rule; players never see it.
        const offered =
          judge?.checked && isGM
            ? [...(cls?.system.templates ?? [])].sort((a, b) => a.rollMin - b.rollMin)
            : legalTemplates(cls?.system.templates ?? [], roll.total);
        tplSel.innerHTML = offered
          .map(
            (t, i) =>
              `<option value="${t.rollMin}"${i === offered.length - 1 ? " selected" : ""}>${foundry.utils.escapeHTML(
                t.name + (t.annotation ? ` (${t.annotation})` : ""),
              )} [${t.rollMin}–${t.rollMax}]</option>`,
          )
          .join("");
        // The class's own first-level picks (a dark path, a tradition, the
        // proficiency selections) re-render with the class: each choice award
        // at level 1 gets a select over its ChoiceSpec's options.
        const startBox = form.querySelector('[data-role="starting"]');
        if (startBox) {
          const choices = (cls?.system.awards ?? []).filter((a) => a.atLevel === 1 && a.kind === "choice");
          startBox.innerHTML = choices
            .map((a, i) => {
              const options = optionsForChoice(a.choice, cls)
                .map((o) => `<option value="${foundry.utils.escapeHTML(o.ref)}">${foundry.utils.escapeHTML(o.name)}</option>`)
                .join("");
              const label = a.choice.label || game.i18n.localize(`${LANG_PREFIX}.levelup.pick`);
              return `<div class="form-group"><label>${foundry.utils.escapeHTML(label)}</label><select name="award-${i}">${options}</select></div>`;
            })
            .join("");
        }
      };
      classSel.addEventListener("change", refresh);
      judge?.addEventListener("change", refresh);
      showAll?.addEventListener("change", () => {
        classes = offeredClasses(actor, showAll.checked);
        classSel.innerHTML = classOptionsHtml(classes);
        refresh();
      });
      refresh();
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.chargen.apply`),
      callback: (_event, button) => ({
        uuid: button.form.elements.uuid?.value,
        rollMin: Number(button.form.elements.template?.value),
        bonus: Array.from({ length: bonusPicks }, (_, i) => button.form.elements[`bonus-${i}`]?.value).filter(Boolean),
        awardPicks: Array.from(button.form.querySelectorAll('select[name^="award-"]'))
          .map((el) => el.value)
          .filter(Boolean),
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
  // The class's own first-level awards land with the template: every fixed
  // award granted, every pick taken above granted as chosen. grantAbility
  // dedupes by ref, so a power the template already carried is not doubled.
  const startingGrants = [];
  for (const a of (cls.system.awards ?? []).filter((x) => x.atLevel === 1 && x.kind === "fixed" && x.ref)) {
    await grantAbility(actor, a.ref, startingGrants);
  }
  for (const ref of picked.awardPicks ?? []) {
    await grantAbility(actor, ref, startingGrants);
  }
  report.granted.push(...startingGrants.filter((g) => !g.missing).map((g) => g.name));
  report.unresolved.push(...startingGrants.filter((g) => g.missing).map((g) => g.name));
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

/** A skinned item's sheet names what it is an instance of. */
function onRenderItemSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const doc = app.document;
  const skin = doc?.flags?.[MODULE_ID]?.skin;
  if (!skin?.baseName || root.querySelector(".acks-extras-classes-skinbadge")) return;
  const badge = document.createElement("p");
  badge.className = "acks-extras-classes-skinbadge hint";
  badge.textContent = skin.embellishment
    ? game.i18n.format(`${LANG_PREFIX}.skin.badgeEmbellished`, { embellishment: skin.embellishment, base: skin.baseName })
    : game.i18n.format(`${LANG_PREFIX}.skin.badge`, { base: skin.baseName });
  const anchor = root.querySelector(".sheet-header, header") ?? root.firstElementChild;
  anchor?.insertAdjacentElement("afterend", badge);
}

/** Register the chargen sheet control (called once from classes/module.mjs). */
export function registerChargen() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
  Hooks.on("renderApplicationV2", onRenderItemSheet);
}
