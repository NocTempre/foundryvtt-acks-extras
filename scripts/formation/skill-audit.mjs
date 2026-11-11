/* global game, foundry, fromUuidSync, Hooks, document */
import { elementOf, makeLoc } from "../lib/util.mjs";
import { MODULE_ID } from "./constants.mjs";
import {
  abilityKey,
  importedLadderFor,
  importedSkillKeys,
  ladderRows,
  overrideFor,
  refreshLadders,
  resetOverrides,
  setOverride,
} from "./ability-bridge.mjs";
import { getFormation, getMemberActor, realMembers } from "./formation-model.mjs";
import { PARTY_CHECKS, boundChecks, partText, resolveCheck, skillGateAllows } from "./party-rolls.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { rollAbilityForParty as rollForParty } from "./audit-roll.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Skill Audit (GM): full transparency into how every party roll resolves for
 * every member — which item or Adventuring target is used and the bonuses
 * applied. Also the editor for **custom skills**: any ability item can be
 * flagged to participate in a party roll (`checkKey`). How a skill scales
 * with level is the item's own throw, edited on its ability sheet.
 */
export default class SkillAuditApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #formationId;

  constructor(options = {}) {
    super(options);
    this.#formationId = options.formationId;
  }

  static DEFAULT_OPTIONS = {
    id: "acks-formation-skill-audit",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "skill-audit"],
    window: { resizable: true, title: "ACKS-FORMATION.audit.title" },
    position: { width: 640, height: 640 },
    actions: {
      /** Flip one ability's ruling: automatic → off → on → automatic. */
      async toggleAbility(event, target) {
        if (!game.user.isGM) return;
        const item = fromUuidSync(target.closest("[data-item-uuid]")?.dataset.itemUuid);
        if (!item) return;
        const current = overrideFor(item);
        // Cycle through the three real states rather than hiding "automatic"
        // behind a binary: a GM who overrode something must be able to hand it
        // back to automation without hunting for the global reset.
        const next = current === null ? false : current === false ? true : null;
        await setOverride(item, next);
        this.render();
      },

      /** Roll the row's ability for every member who holds it: one card to the Judges. */
      async rollAbilityForParty(event, target) {
        if (!game.user.isGM) return;
        const formation = this.formation;
        const row = target.closest("[data-ability-key]");
        if (!formation || !row) return;
        await rollForParty(formation, { key: row.dataset.abilityKey, name: row.dataset.abilityName });
      },

      /** Drop every ruling — back to what automation decides on its own. */
      async resetAbilityOverrides() {
        if (!game.user.isGM) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
          window: { title: game.i18n.localize("ACKS-FORMATION.audit.reset") },
          content: `<p>${game.i18n.localize("ACKS-FORMATION.audit.resetConfirm")}</p>`,
        });
        if (!confirmed) return;
        await resetOverrides();
        this.render();
      },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/formation/skill-audit.hbs`, scrollable: [""] },
  };

  get formation() {
    return getFormation(this.#formationId);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // The audit window is where a GM checks whether scaling is working, so it
    // reads the ladders fresh rather than trusting a cache invalidated by hooks.
    await refreshLadders();
    const formation = this.formation;
    context.formation = formation;
    if (!formation) return context;

    const checks = Object.entries(PARTY_CHECKS).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
    }));
    context.checkColumns = checks;

    const checkOptions = [
      { value: "", label: game.i18n.localize("ACKS-FORMATION.audit.flagNone") },
      ...Object.values(
        Object.entries(PARTY_CHECKS).reduce((acc, [key, cfg]) => {
          acc[cfg.flagKey] ??= { value: cfg.flagKey, label: game.i18n.localize(cfg.label) };
          return acc;
        }, {}),
      ),
    ];
    context.members = realMembers(formation)
      .map((member) => getMemberActor(member))
      .filter(Boolean)
      .map((actor) => ({
        name: actor.name,
        img: actor.img,
        level: actor.system?.details?.level ?? "—",
        resolutions: Object.entries(PARTY_CHECKS).map(([key, cfg]) => {
          const check = resolveCheck(actor, cfg);
          if (!check) return { label: "—", source: "" };
          // The parts are inside the target, so they are the source's detail.
          const detail = check.parts.map(partText).join(", ");
          return { label: `${check.target}+`, source: detail ? `${check.source}; ${detail}` : check.source };
        }),
        items: actor.items
          .filter((i) => i.type === ITEM_TYPE.ability)
          .map((item) => ({
            uuid: item.uuid,
            name: item.name,
            target: item.system?.rollTarget ?? 0,
            checkKey: item.getFlag(MODULE_ID, "checkKey") ?? "",
            checkOptions: checkOptions.map((o) => ({
              ...o,
              active: o.value === (item.getFlag(MODULE_ID, "checkKey") ?? ""),
            })),
          })),
      }));

    context.abilities = collectPartyAbilities(formation);
    context.progressionTable = importedSkillKeys().map((key) => ({
      key,
      values: ladderRows(importedLadderFor(key))
        .map((r) => r.value)
        .join(" / "),
    }));
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!game.user.isGM) return;
    for (const el of this.element.querySelectorAll("[data-item-uuid][data-field]")) {
      el.addEventListener("change", async (event) => {
        const { itemUuid, field } = event.currentTarget.dataset;
        const item = fromUuidSync(itemUuid);
        if (!item) return;
        const value = event.currentTarget.value;
        if (value === "" || value === null) await item.unsetFlag(MODULE_ID, field);
        else await item.setFlag(MODULE_ID, field, value);
        // Binding an item to a party roll makes it a skill (turns on its tab).
        if (field === "checkKey" && value) {
          await item.setFlag(MODULE_ID, "isSkill", true);
        }
        this.render();
      });
    }
  }
}

/* -------------------------------------------- */
/*  Party ability roster (the union's audit)    */
/* -------------------------------------------- */

/**
 * Every distinct ability in the party, once — the surface for auditing what the
 * candidate union actually caught.
 *
 * "Distinct" is by ability IDENTITY (register id, else folded name), so two
 * members carrying Searching are one row with one ruling. For each row we
 * report not just WHETHER automation uses it but by WHICH route, because a
 * name-matched binding is the fragile one a GM most wants to see: it is the one
 * that breaks on a rename and the one most likely to be a false positive.
 */
function collectPartyAbilities(formation) {
  const rows = new Map();
  for (const member of realMembers(formation)) {
    const actor = getMemberActor(member);
    if (!actor) continue;
    for (const item of actor.items) {
      if (item.type !== ITEM_TYPE.ability) continue;
      const key = abilityKey(item);
      let row = rows.get(key);
      if (!row) {
        // Which checks would take this item, and how it qualified for each.
        const bindings = boundChecks(item).map(({ cfg, route }) => ({
          label: game.i18n.localize(cfg.label),
          route,
          routeLabel: game.i18n.localize(`ACKS-FORMATION.audit.route.${route}`),
        }));
        const ruling = overrideFor(item);
        row = {
          key,
          uuid: item.uuid,
          name: item.name,
          img: item.img,
          holders: [],
          bindings,
          bound: bindings.length > 0,
          // Only a name-only binding is worth flagging; a capability match is
          // exactly what we want and needs no attention.
          nameOnly: bindings.length > 0 && bindings.every((b) => b.route === "name"),
          ruling,
          overridden: ruling !== null,
          // Default state = what automation would do unaided — through the
          // SAME gate rollPartyCheck applies, so a Skill-unchecked item never
          // reads as active here while the roll refuses it.
          active: ruling === null ? bindings.length > 0 && skillGateAllows(item) : ruling,
        };
        rows.set(key, row);
      }
      if (!row.holders.includes(actor.name)) row.holders.push(actor.name);
      row.holderList = row.holders.join(", ");
    }
  }
  return [...rows.values()].sort(
    (a, b) => Number(b.bound) - Number(a.bound) || a.name.localeCompare(b.name),
  );
}

/* -------------------------------------------- */
/*  Item-sheet Skill tab                        */
/* -------------------------------------------- */

const TAB_ID = "afmskill";

const loc = makeLoc("ACKS-FORMATION");

/**
 * An ability is "a skill" when explicitly checked on its sheet, or (for items
 * flagged before the checkbox existed) when it carries party-roll flags.
 */
export function isSkillItem(item) {
  const explicit = item.getFlag(MODULE_ID, "isSkill");
  if (explicit !== undefined) return !!explicit;
  return !!item.getFlag(MODULE_ID, "checkKey");
}

/**
 * Ability item sheets grow a "Skill" checkbox on the details pane; checking it
 * turns on a **Skill tab** showing the party-roll binding (Used for), the
 * Judge's Throw bonus, and the live resolved target with every stacked bonus
 * itemized. GMs edit; owners of a flagged skill see the tab read-only.
 */
export function registerSkillFlagEditor() {
  Hooks.on("renderApplicationV2", (app, element) => {
    try {
      const item = app?.document;
      if (item?.documentName !== "Item" || item.type !== ITEM_TYPE.ability) return;
      const root = elementOf(element);
      if (!root) return;
      injectSkillUI(app, root, item);
    } catch (err) {
      console.error(`${MODULE_ID} | skill tab injection failed`, err);
    }
  });
}

function injectSkillUI(app, root, item) {
  // Rebuild from scratch on every render: the injected tab section survives
  // part replacement (it is not an application part) while the nav anchor and
  // details checkbox do not, so removal + re-insertion keeps all three fresh.
  for (const el of root.querySelectorAll(".acks-formation-skill-anchor, .acks-formation-skill-tab, .acks-formation-skill-check")) el.remove();

  const gm = game.user.isGM;
  const skill = isSkillItem(item);

  // "Skill" checkbox on the details pane turns the tab on and off.
  const fieldSet = root.querySelector('.tab[data-tab="description"] .field-set');
  if (fieldSet && gm) {
    const group = document.createElement("div");
    group.className = "form-group form-group--row acks-formation-skill-check";
    group.innerHTML = `
      <label class="form-group__label" data-tooltip="${loc("audit.isSkillHint")}">${loc("audit.isSkill")}</label>
      <div class="form-group__fields"><input type="checkbox" ${skill ? "checked" : ""}/></div>`;
    group.querySelector("input").addEventListener("change", async (event) => {
      event.stopPropagation();
      await item.setFlag(MODULE_ID, "isSkill", event.currentTarget.checked);
    });
    fieldSet.appendChild(group);
  }

  const nav = root.querySelector("nav.tabs");
  const sections = root.querySelectorAll('section.tab[data-group="primary"]');
  if (!nav || !sections.length) return;

  if (!skill) {
    // The tab just disappeared while active: fall back to the description tab.
    if (app.tabGroups?.primary === TAB_ID) {
      try {
        app.changeTab("description", "primary", { force: true });
      } catch (err) {
        console.warn(`${MODULE_ID} | could not restore description tab`, err);
      }
    }
    return;
  }

  const active = app.tabGroups?.primary === TAB_ID;

  const anchor = document.createElement("a");
  anchor.className = `acks-formation-skill-anchor${active ? " active" : ""}`;
  anchor.dataset.action = "tab";
  anchor.dataset.group = "primary";
  anchor.dataset.tab = TAB_ID;
  anchor.innerHTML = `<i class="fa-solid fa-graduation-cap" inert></i><span>${loc("audit.tab")}</span>`;
  nav.appendChild(anchor);

  const section = document.createElement("section");
  section.className = `tab acks-formation-skill-tab${active ? " active" : ""}`;
  section.dataset.group = "primary";
  section.dataset.tab = TAB_ID;
  section.innerHTML = buildSkillTabHTML(item, gm);
  sections[sections.length - 1].after(section);

  for (const el of section.querySelectorAll("[data-field]")) {
    el.disabled = !gm;
    el.addEventListener("change", async (event) => {
      event.stopPropagation();
      const field = event.currentTarget.dataset.field;
      let value = event.currentTarget.value;
      // 0 means "no adjustment", which is the same as no flag at all.
      if (field === "targetMod") value = Number(value) || null;
      if (value === "" || value === null) await item.unsetFlag(MODULE_ID, field);
      else await item.setFlag(MODULE_ID, field, value);
    });
  }
}

function buildSkillTabHTML(item, gm) {
  const esc = foundry.utils.escapeHTML;
  const checkKey = item.getFlag(MODULE_ID, "checkKey") ?? "";
  const targetMod = item.getFlag(MODULE_ID, "targetMod") ?? 0;
  const dis = gm ? "" : "disabled";
  const owner = item.parent;

  const flagKeys = [...new Set(Object.values(PARTY_CHECKS).map((c) => c.flagKey))];
  const checkOpts = [`<option value="">${loc("audit.flagNone")}</option>`]
    .concat(flagKeys.map((k) => `<option value="${k}" ${k === checkKey ? "selected" : ""}>${k}</option>`))
    .join("");
  let html = `<div class="content">`;
  html += `<fieldset class="acks-formation-flags"><legend>${loc("audit.sheetSection")}</legend>
    <div class="acks-formation-flag-row">
      <label>${loc("audit.usedFor")}</label>
      <select data-field="checkKey" ${dis}>${checkOpts}</select>
      <label title="${loc("audit.throwBonusHint")}">${loc("audit.throwBonus")}</label>
      <input type="number" step="1" value="${targetMod}" data-field="targetMod" title="${loc("audit.throwBonusHint")}" ${dis}/>
    </div>
    ${checkKey ? "" : `<p class="hint">${loc("audit.tabNotSkill")}</p>`}
  </fieldset>`;

  // Live resolution for the owner: what the party roll actually uses,
  // including the full stacked-bonus breakdown.
  if (owner && checkKey) {
    html += `<fieldset class="acks-formation-flags"><legend>${loc("audit.resolution")}</legend><ul class="acks-formation-resolution">`;
    for (const cfg of Object.values(PARTY_CHECKS)) {
      if (cfg.flagKey !== checkKey) continue;
      const label = game.i18n.localize(cfg.label);
      const check = resolveCheck(owner, cfg);
      if (!check) {
        html += `<li><strong>${label}</strong>: —</li>`;
        continue;
      }
      const breakdown = (check.parts ?? []).map(partText).join(", ");
      html += `<li><strong>${label}</strong>: ${check.target}+ <em>(${esc(check.source)}${breakdown ? `; ${esc(breakdown)}` : ""})</em></li>`;
    }
    html += `</ul></fieldset>`;
  }
  html += `</div>`;
  return html;
}
