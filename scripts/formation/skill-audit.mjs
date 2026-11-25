/* global game, foundry, fromUuidSync, Hooks, document */
import { atTypeScale, elementOf, escape as esc, makeLoc } from "../lib/util.mjs";
import { PressFocus } from "../lib/press-focus.mjs";
import { MODULE_ID } from "./constants.mjs";
import {
  abilityKey,
  importedSkillFor,
  importedSkillKeys,
  ladderRows,
  overrideFor,
  refreshLadders,
  resetOverrides,
  setOverride,
} from "./ability-bridge.mjs";
import { SETTING_FORMATIONS, getFormation, getMemberActor, realMembers } from "./formation-model.mjs";
import { PARTY_CHECKS, boundChecks, checkLabel, checkTip, partText, resolveCheck, skillGateAllows, usedForOptions } from "./party-rolls.mjs";
import { citeOf } from "../abilities/ability-rolls.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { rollAbilityForParty as rollForParty } from "./audit-roll.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * How long a Used-for change keeps its select remembered for the render it
 * causes. The audit's render reads the ladders fresh and can outlast the press
 * window `press-focus.mjs` gives an action control, so a select waits longer;
 * focus held anywhere else drops it sooner.
 */
const FIELD_FOCUS_MS = 10000;

/** The window id every Skill audit takes before its party's id is added. */
const AUDIT_ID_ROOT = "acks-formation-skill-audit";

/**
 * The window id of one party's Skill audit. Core keeps one element per id, so a
 * shared id would let a second audit replace the first's element and leave the
 * first instance's actions dead; an id of the party's own lets each party's
 * audit stand beside the others.
 *
 * @param {string} [formationId] The party's formation id.
 * @returns {string}
 */
export function auditWindowId(formationId) {
  return formationId ? `${AUDIT_ID_ROOT}-${formationId}` : AUDIT_ID_ROOT;
}

/** The world actors behind a party's real members, in marching order. */
function memberActorIds(formation) {
  return realMembers(formation)
    .map((member) => getMemberActor(member)?.id)
    .filter(Boolean);
}

/**
 * Skill Audit (GM): full transparency into how every party roll resolves for
 * every member — which item or Adventuring target is used and the bonuses
 * applied. Also the editor for **custom skills**: any ability item can be
 * flagged to participate in a party roll (`checkKey`). How a skill scales
 * with level is the item's own throw, edited on its ability sheet.
 */
export default class SkillAuditApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #formationId;

  /** The press whose render is pending: where keyboard focus returns once the body's HTML is replaced. */
  #press = new PressFocus();

  /** The Used-for select a change just re-rendered under, `{uuid, field, at}`, until focus is held again. */
  #fieldFocus = null;

  /** Hook ids for the watch on the party's roster and its members' abilities. */
  #watch = [];

  /** The debounced re-render the watch calls, made at first render. */
  #renderSoon = null;

  /** The roster the last render read, as one string: a record write that leaves it alone is no reason to draw again. */
  #roster = "";

  constructor(options = {}) {
    super({ ...options, id: options.id ?? auditWindowId(options.formationId) });
    this.#formationId = options.formationId;
  }

  static DEFAULT_OPTIONS = {
    // no-scroll: this window scrolls at its body PART root, not at
    // `.window-content`. The shared contract would move the scroller onto
    // `.window-content`, which is not a part — and ApplicationV2 restores
    // scroll per part, so the body's `scrollable: [""]` below would stop
    // working on a window that re-renders on every ruling. The scroller
    // lives in styles/formation.css, at the top.
    classes: ["acks-ui", "acks-extras", "skill-audit"],
    window: { title: "ACKS-FORMATION.audit.title" },
    // The canvas figures; `_initializeApplicationOptions` scales them to the seat's type size.
    position: { width: 640, height: 640 },
    actions: {
      /** Flip one ability's ruling: automatic → off → on → automatic. */
      async toggleAbility(event, target) {
        if (!game.user.isGM) return;
        const item = fromUuidSync(target.closest("[data-item-uuid]")?.dataset.itemUuid);
        if (!item) return;
        const current = overrideFor(item);
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

  /**
   * Open at the canvas size for the seat's type size. `DEFAULT_OPTIONS` is
   * evaluated before settings exist, so the scale is applied here at
   * construction instead; core clamps the result to the viewport.
   */
  _initializeApplicationOptions(options) {
    const opts = super._initializeApplicationOptions(options);
    if (opts.position?.width) opts.position.width = atTypeScale(opts.position.width);
    if (opts.position?.height) opts.position.height = atTypeScale(opts.position.height);
    return opts;
  }

  /**
   * Watch what the window draws: the party's roster, which the formations
   * record carries, and the ability items of its members. A write to the record
   * that leaves the roster as it was (the clock, a light) draws nothing.
   *
   * @override
   */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#renderSoon ??= foundry.utils.debounce(() => {
      if (this.rendered) this.render();
    }, 60);
    this.#roster = memberActorIds(this.formation).join();
    const onSetting = (setting) => {
      if (setting?.key !== `${MODULE_ID}.${SETTING_FORMATIONS}`) return;
      const roster = memberActorIds(this.formation).join();
      if (roster === this.#roster) return;
      this.#roster = roster;
      this.#renderSoon();
    };
    const onItem = (item) => {
      if (item?.type !== ITEM_TYPE.ability || !item.parent?.id) return;
      if (memberActorIds(this.formation).includes(item.parent.id)) this.#renderSoon();
    };
    this.#watch = [
      ["createSetting", Hooks.on("createSetting", onSetting)],
      ["updateSetting", Hooks.on("updateSetting", onSetting)],
      ["createItem", Hooks.on("createItem", onItem)],
      ["updateItem", Hooks.on("updateItem", onItem)],
      ["deleteItem", Hooks.on("deleteItem", onItem)],
    ];
  }

  /** @override */
  async _onClose(options) {
    for (const [hook, id] of this.#watch) Hooks.off(hook, id);
    this.#watch = [];
    await super._onClose(options);
  }

  /**
   * Note every `[data-action]` press as it lands, in the capture phase so it
   * runs ahead of the action's own handler. The root persists across renders;
   * only the body's HTML is replaced.
   *
   * @override
   */
  _attachFrameListeners() {
    super._attachFrameListeners();
    const root = this.element;
    root.addEventListener("click", (event) => this.#press.note(event.target, root), { capture: true });
  }

  /**
   * After every hook has run: focus back on the control a press re-rendered
   * (`press-focus.mjs`), or on the Used-for select a change re-rendered under.
   *
   * @override
   */
  async _postRender(context, options) {
    await super._postRender(context, options);
    try {
      if (!this.#press.restore(this.element)) this.#restoreField(this.element);
    } catch (err) {
      console.error(`${MODULE_ID} | ${this.constructor.name}: restoring focus failed`, err);
    }
  }

  /**
   * Put focus back on the select a change was made in. A select is no
   * `[data-action]` control, so `PressFocus` does not know it; it is named by
   * its item and field. The change stays remembered across the renders one
   * write causes, until focus is held again or the window after it lapses.
   */
  #restoreField(root) {
    const pending = this.#fieldFocus;
    if (!pending) return;
    const doc = root.ownerDocument;
    const held = doc.activeElement && doc.activeElement !== doc.body && doc.activeElement !== doc.documentElement;
    if (held || Date.now() - pending.at > FIELD_FOCUS_MS) {
      this.#fieldFocus = null;
      return;
    }
    const field = [...root.querySelectorAll("[data-item-uuid][data-field]")].find(
      (el) => el.dataset.itemUuid === pending.uuid && el.dataset.field === pending.field,
    );
    if (!field) return;
    field.focus({ preventScroll: true });
    // One write can draw the window more than once; each draw that puts focus
    // back keeps the select remembered for the next.
    pending.at = Date.now();
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // The first draw reads the ladders fresh; later draws read the cache the
    // item hooks keep. A fresh read opens every world compendium, which takes
    // seconds, so on every draw it would outlast the press-focus window.
    if (options.isFirstRender) await refreshLadders();
    const formation = this.formation;
    context.formation = formation;
    if (!formation) return context;

    const checks = Object.entries(PARTY_CHECKS).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
    }));
    context.checkColumns = checks;

    const checkOptions = usedForOptions();
    context.members = realMembers(formation)
      .map((member) => getMemberActor(member))
      .filter(Boolean)
      .map((actor) => ({
        name: actor.name,
        img: actor.img,
        level: actor.system?.details?.level ?? "—",
        resolutions: Object.entries(PARTY_CHECKS).map(([key, cfg]) => {
          const check = resolveCheck(actor, cfg, { auto: true });
          if (!check) return { label: "—", source: "", tip: "" };
          // The parts are inside the target, so they are the source's detail.
          const detail = check.parts.map(partText).join(", ");
          return {
            label: checkLabel(check),
            source: detail ? `${check.source}; ${detail}` : check.source,
            tip: checkTip(check),
          };
        }),
        items: actor.items
          .filter((i) => i.type === ITEM_TYPE.ability)
          .map((item) => ({
            uuid: item.uuid,
            name: item.name,
            editable: item.isOwner,
            ...sheetTargetOf(item),
            checkKey: item.getFlag(MODULE_ID, "checkKey") ?? "",
            checkOptions: checkOptions.map((o) => ({
              ...o,
              active: o.value === (item.getFlag(MODULE_ID, "checkKey") ?? ""),
            })),
          })),
      }));

    context.abilities = collectPartyAbilities(formation);
    context.progressionTable = importedSkillKeys()
      .map((key) => importedSkillFor(key))
      .filter(Boolean)
      .map((skill) => ({
        name: skill.name,
        tip: citeOf(skill.item),
        values: ladderRows(skill.ladder)
          .map((r) => r.value ?? "")
          .join(" / "),
      }));
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // A select is live for the ability's owner only; the template disables the rest.
    for (const el of this.element.querySelectorAll("[data-item-uuid][data-field]")) {
      if (!fromUuidSync(el.dataset.itemUuid)?.isOwner) continue;
      el.addEventListener("change", async (event) => {
        const { itemUuid, field } = event.currentTarget.dataset;
        const item = fromUuidSync(itemUuid);
        if (!item) return;
        // The select replaces any press still remembered: noting a control that
        // is no action drops it, so the render returns focus here, not there.
        this.#press.note(event.currentTarget, this.element);
        this.#fieldFocus = { uuid: itemUuid, field, at: Date.now() };
        const value = event.currentTarget.value;
        if (value === "" || value === null) await item.unsetFlag(MODULE_ID, field);
        else await item.setFlag(MODULE_ID, field, value);
        // Binding an item to a party roll makes it a skill (turns on its tab).
        if (field === "checkKey" && value) {
          await item.setFlag(MODULE_ID, "isSkill", true);
        }
        // The item watch draws the window again; a render of its own here would
        // be one more render inside the focus window.
      });
    }
  }
}

/**
 * What an item's Sheet target cell shows: the stored `system.rollTarget` as a
 * target when it is a positive number, else nothing, with the tooltip saying
 * where the figure comes from: the page the item's import names, or, for an item
 * that carries none, that the figure is the sheet's stored target.
 *
 * @returns {{target: string, targetTip: string}}
 */
function sheetTargetOf(item) {
  const stored = Number(item.system?.rollTarget);
  return {
    target: stored > 0 ? `${stored}+` : "",
    targetTip: citeOf(item) || game.i18n.localize("ACKS-FORMATION.audit.sheetTargetTip"),
  };
}

/* -------------------------------------------- */
/*  Party ability roster (the union's audit)    */
/* -------------------------------------------- */

/**
 * Every distinct ability in the party, once: one row per ability identity
 * (register id, else folded name), with whether automation uses it and by
 * which route (a name-only binding breaks on a rename).
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
          // Only a name-only binding is flagged.
          nameOnly: bindings.length > 0 && bindings.every((b) => b.route === "name"),
          ruling,
          overridden: ruling !== null,
          // Unruled: what automation does, through the gate rollPartyCheck applies.
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
 * An ability is "a skill" when checked on its sheet, or, with no explicit
 * `isSkill` flag, when it carries a `checkKey`.
 */
export function isSkillItem(item) {
  const explicit = item.getFlag(MODULE_ID, "isSkill");
  if (explicit !== undefined) return !!explicit;
  return !!item.getFlag(MODULE_ID, "checkKey");
}

/**
 * Ability item sheets grow a "Skill" checkbox on the details pane; checking it
 * turns on a **Skill tab** showing the party-roll binding (Used for), the
 * Throw bonus, and the live resolved target with every stacked bonus
 * itemized. A seat edits where Foundry lets it edit the item's sheet (its
 * owner, a Judge, a pack that is not locked); any other seat reads the tab.
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
  // Rebuilt on every render: the injected section survives part replacement
  // (it is no application part) while the nav anchor and checkbox do not.
  for (const el of root.querySelectorAll(".acks-formation-skill-anchor, .acks-formation-skill-tab, .acks-formation-skill-check")) el.remove();

  const editable = !!app.isEditable;
  const skill = isSkillItem(item);

  // "Skill" checkbox on the details pane turns the tab on and off.
  const fieldSet = root.querySelector('.tab[data-tab="description"] .field-set');
  if (fieldSet && editable) {
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
  section.innerHTML = buildSkillTabHTML(item, editable);
  sections[sections.length - 1].after(section);

  for (const el of section.querySelectorAll("[data-field]")) {
    el.disabled = !editable;
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

/**
 * The Skill tab's body for an ability item: the Used-for select (named by the
 * party check, as the audit window names it), the Throw bonus, and for a bound
 * item held by an actor the live resolution, its tooltip citing each part's page.
 *
 * @param {Item} item
 * @param {boolean} editable whether the seat may edit the item; its fields are disabled otherwise
 * @returns {string} HTML
 */
export function buildSkillTabHTML(item, editable) {
  const checkKey = item.getFlag(MODULE_ID, "checkKey") ?? "";
  const targetMod = item.getFlag(MODULE_ID, "targetMod") ?? 0;
  const dis = editable ? "" : "disabled";
  const owner = item.parent;

  const checkOpts = usedForOptions()
    .map((o) => `<option value="${esc(o.value)}" ${o.value === checkKey ? "selected" : ""}>${esc(o.label)}</option>`)
    .join("");
  let html = `<div class="content">`;
  html += `<fieldset class="acks-formation-flags"><legend>${loc("audit.sheetSection")}</legend>
    <div class="acks-formation-flag-row">
      <label>${loc("audit.usedFor")}</label>
      <select data-field="checkKey" aria-label="${esc(loc("audit.usedForLabel", { name: item.name }))}" ${dis}>${checkOpts}</select>
      <label data-tooltip="ACKS-FORMATION.audit.throwBonusHint">${loc("audit.throwBonus")}</label>
      <input type="number" step="1" value="${esc(targetMod)}" data-field="targetMod" aria-label="${esc(loc("audit.throwBonus"))}" data-tooltip="ACKS-FORMATION.audit.throwBonusHint" ${dis}/>
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
      const check = resolveCheck(owner, cfg, { auto: true });
      if (!check) {
        html += `<li><strong>${label}</strong>: —</li>`;
        continue;
      }
      const breakdown = (check.parts ?? []).map(partText).join(", ");
      html += `<li data-tooltip-text="${esc(checkTip(check))}"><strong>${label}</strong>: ${esc(checkLabel(check))} <em>(${esc(check.source)}${breakdown ? `; ${esc(breakdown)}` : ""})</em></li>`;
    }
    html += `</ul></fieldset>`;
  }
  html += `</div>`;
  return html;
}
