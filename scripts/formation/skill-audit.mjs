/* global game, foundry, fromUuidSync, Hooks, document */
import { makeLoc } from "../lib/util.mjs";
import { MODULE_ID } from "./constants.mjs";
import {
  abilityKey,
  importedLadderFor,
  importedSkillKeys,
  itemHasCapability,
  ladderRows,
  overrideFor,
  refreshLadders,
  resetOverrides,
  setOverride,
} from "./ability-bridge.mjs";
import { getFormation, getMemberActor, realMembers } from "./formation-model.mjs";
import { PARTY_CHECKS, resolveCheck, scaledSkillTarget, inferredThiefSkill } from "./party-rolls.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Skill Audit (GM): full transparency into how every party roll resolves for
 * every member — which item or Adventuring target is used, the auto-scaled
 * level and factor, and the bonuses applied. Also the editor for **custom
 * skills**: any ability item can be flagged to participate in a party roll
 * (`checkKey`), auto-scale on a thief progression (`thiefSkill`), and scale
 * at a fraction of the owner's level (`levelFactor`, e.g. 0.5 for "as a
 * thief of half his class level").
 */
export default class SkillAuditApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #formationId;

  constructor(options = {}) {
    super(options);
    this.#formationId = options.formationId;
  }

  static DEFAULT_OPTIONS = {
    id: "acks-formation-skill-audit",
    classes: ["acks-extras", "acks-extras-scroll", "skill-audit"],
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

      /** Drop every ruling — back to what automation decides on its own. */
      async resetAbilityOverrides() {
        if (!game.user.isGM) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          classes: ["acks-extras", "acks-extras-scroll"],
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
    // The skills offered are the ones this world has imported — the only ones
    // a ladder can be read for. An empty list means no skills imported yet.
    const progressionOptions = [
      { value: "", label: game.i18n.localize("ACKS-FORMATION.audit.fixedTarget") },
      ...importedSkillKeys().map((key) => ({ value: key, label: key })),
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
          const bonus = check.bonus ? (check.bonus > 0 ? ` +${check.bonus}` : ` ${check.bonus}`) : "";
          return { label: `${check.target}+${bonus}`, source: check.source };
        }),
        items: actor.items
          .filter((i) => i.type === "ability")
          .map((item) => ({
            uuid: item.uuid,
            name: item.name,
            target: item.system?.rollTarget ?? 0,
            checkKey: item.getFlag(MODULE_ID, "checkKey") ?? "",
            thiefSkill: item.getFlag(MODULE_ID, "thiefSkill") ?? "",
            levelFactor: item.getFlag(MODULE_ID, "levelFactor") ?? 1,
            checkOptions: checkOptions.map((o) => ({
              ...o,
              active: o.value === (item.getFlag(MODULE_ID, "checkKey") ?? ""),
            })),
            progressionOptions: progressionOptions.map((o) => ({
              ...o,
              active: o.value === (item.getFlag(MODULE_ID, "thiefSkill") ?? ""),
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
        let value = event.currentTarget.value;
        if (field === "levelFactor") value = Number(value) || 1;
        if (value === "" || value === null) await item.unsetFlag(MODULE_ID, field);
        else await item.setFlag(MODULE_ID, field, value);
        // Binding an item to a party roll makes it a skill (turns on its tab).
        if ((field === "checkKey" || field === "thiefSkill") && value) {
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
      if (item.type !== "ability") continue;
      const key = abilityKey(item);
      let row = rows.get(key);
      if (!row) {
        // Which checks would take this item, and how it qualified for each.
        const bindings = [];
        for (const [checkKey, cfg] of Object.entries(PARTY_CHECKS)) {
          let route = null;
          if (cfg.capability && itemHasCapability(item, cfg.capability)) route = "capability";
          else if (item.getFlag(MODULE_ID, "checkKey") === cfg.flagKey) route = "binding";
          else if (
            !item.getFlag(MODULE_ID, "checkKey") &&
            cfg.pattern.test(item.name) &&
            (item.getFlag(MODULE_ID, "thiefSkill") || Number(item.system?.rollTarget) > 0)
          ) {
            route = "name";
          }
          if (route) {
            bindings.push({
              label: game.i18n.localize(cfg.label),
              route,
              routeLabel: game.i18n.localize(`ACKS-FORMATION.audit.route.${route}`),
            });
          }
        }
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
          // Default state = what automation would do unaided.
          active: ruling === null ? bindings.length > 0 : ruling,
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
  return !!(item.getFlag(MODULE_ID, "checkKey") || item.getFlag(MODULE_ID, "thiefSkill"));
}

/**
 * Ability item sheets grow a "Skill" checkbox on the details pane; checking it
 * turns on a **Skill tab** showing the party-roll binding (Used for), the
 * thief progression with the owner's current row highlighted, the level
 * factor, and the live resolved target with every stacked bonus itemized.
 * GMs edit; owners of a flagged skill see the tab read-only.
 */
export function registerSkillFlagEditor() {
  Hooks.on("renderApplicationV2", (app, element) => {
    try {
      const item = app?.document;
      if (item?.documentName !== "Item" || item.type !== "ability") return;
      const root = element instanceof HTMLElement ? element : element?.[0];
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
      if (field === "levelFactor") value = Number(value) || 1;
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
  const thiefSkill = item.getFlag(MODULE_ID, "thiefSkill") ?? "";
  const levelFactor = item.getFlag(MODULE_ID, "levelFactor") ?? 1;
  const targetMod = item.getFlag(MODULE_ID, "targetMod") ?? 0;
  const inferredKey = thiefSkill ? null : inferredThiefSkill(item);
  const dis = gm ? "" : "disabled";
  const owner = item.parent;

  const flagKeys = [...new Set(Object.values(PARTY_CHECKS).map((c) => c.flagKey))];
  const checkOpts = [`<option value="">${loc("audit.flagNone")}</option>`]
    .concat(flagKeys.map((k) => `<option value="${k}" ${k === checkKey ? "selected" : ""}>${k}</option>`))
    .join("");
  // A binding the world can no longer resolve (its skill was never imported, or
  // the import was removed) still lists itself, so the GM sees their own choice
  // rather than a silently blank select.
  const progKeys = [...new Set([...importedSkillKeys(), ...(thiefSkill ? [thiefSkill] : [])])].sort();
  const progOpts = [`<option value="">${loc("audit.fixedTarget")}</option>`]
    .concat(progKeys.map((k) => `<option value="${k}" ${k === thiefSkill ? "selected" : ""}>${k}</option>`))
    .join("");

  let html = `<div class="content">`;
  html += `<fieldset class="acks-formation-flags"><legend>${loc("audit.sheetSection")}</legend>
    <div class="acks-formation-flag-row">
      <label>${loc("audit.usedFor")}</label>
      <select data-field="checkKey" ${dis}>${checkOpts}</select>
      <label>${loc("audit.progression")}</label>
      <select data-field="thiefSkill" ${dis}>${progOpts}</select>
      <label>${loc("audit.factor")}</label>
      <input type="number" step="0.25" min="0.25" max="2" value="${levelFactor}" data-field="levelFactor" ${dis}/>
      <label title="${loc("audit.throwBonusHint")}">${loc("audit.throwBonus")}</label>
      <input type="number" step="1" value="${targetMod}" data-field="targetMod" title="${loc("audit.throwBonusHint")}" ${dis}/>
    </div>
    ${checkKey ? "" : `<p class="hint">${loc("audit.tabNotSkill")}</p>`}
  </fieldset>`;

  // Progression by level with the owner's current row highlighted. An explicit
  // binding wins; a cookbook identity names the same skill with no setup. The
  // ladder itself comes from the world's imported copy of that skill, so this
  // shows the GM's own book rather than anything this module carries.
  const progressionKey = thiefSkill || inferredKey;
  const rows = progressionKey ? ladderRows(importedLadderFor(progressionKey, owner)) : [];
  html += `<fieldset class="acks-formation-flags"><legend>${loc("audit.progressionRow")}</legend>`;
  if (inferredKey && rows.length) {
    html += `<p class="hint">${loc("audit.inferredProgression", { key: inferredKey })}</p>`;
  }
  if (rows.length) {
    const factor = Number(levelFactor) || 1;
    const level = owner?.system?.details?.level ?? null;
    const maxLevel = rows[rows.length - 1].level;
    const row = level !== null ? Math.min(Math.max(Math.ceil(level * factor), 1), maxLevel) : null;
    html += `<div class="acks-formation-progression">`;
    for (const cell of rows) {
      html += `<span class="cell${row === cell.level ? " current" : ""}"><label>L${cell.level}</label>${cell.value}+</span>`;
    }
    html += `</div>`;
    if (row !== null) {
      html += `<p class="hint">${loc("audit.effectiveRow", { name: esc(owner.name), level, factor, row })}</p>`;
    }
  } else if (progressionKey) {
    // Bound to a skill this world has not imported: say so plainly, because the
    // roll will quietly use the sheet target instead of the ladder.
    html += `<p class="warning">${loc("audit.progressionNotImported", { key: progressionKey })}</p>`;
    html += `<p class="hint">${loc("audit.sheetTarget")}: ${Number(item.system?.rollTarget) || 0}+</p>`;
  } else {
    // No table applies — but an imported ability may carry its own ladder
    // (acks-abilities extras), which is what the party roll will actually use.
    const scaled = owner ? scaledSkillTarget(owner, item) : null;
    if (scaled) html += `<p class="hint">${loc("audit.importedTarget")}: ${scaled.target}+</p>`;
    else html += `<p class="hint">${loc("audit.sheetTarget")}: ${Number(item.system?.rollTarget) || 0}+</p>`;
  }
  html += `</fieldset>`;

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
      const breakdown = (check.parts ?? []).map((p) => `+${p.value} ${p.label}`).join(", ");
      html += `<li><strong>${label}</strong>: ${check.target}+ <em>(${esc(check.source)}${breakdown ? `; ${breakdown}` : ""})</em></li>`;
    }
    html += `</ul></fieldset>`;
  }
  html += `</div>`;
  return html;
}
