/* global Hooks, game, foundry, canvas, CONFIG, socketlib */
import InfluenceApp from "./influence-app.mjs";
import AttitudeData from "./attitude-data.mjs";
import AttitudeSheet from "./attitude-sheet.mjs";
import {
  INFLUENCE_ATTITUDE_LABELS,
  MODULE_ID,
  REACTION_CHANGE_KEY,
  LOYALTY_CHANGE_KEY,
  MORALE_CHANGE_KEY,
  ROLL_FAMILY,
  INFLUENCE_TONE,
  INFLUENCE_BANDS,
  INFLUENCE_RELATIONSHIP_MOD,
  INFLUENCE_TIME_STEPS,
  HENCHMAN_MONTHLY_WAGE,
} from "./constants.mjs";
import { getActorHD, monthlyWageForHD, getProficiencies, getEffectReactionMods } from "./actor-data.mjs";
import { kindOf, matchesKind, registerRaceRelations, relationFor } from "./racial.mjs";

const ATTITUDE_TYPE = `${MODULE_ID}.attitude`;

/**
 * Open the influence roller for a given actor (or standalone if none).
 * @param {Actor|null} actor
 * @param {object} [options] - { targetActor, modifiers: [{label, value}] } —
 *   `modifiers` lets consumer modules inject flat externals (e.g.
 *   acks-henchmen's per-settlement slander penalty).
 */
function openInfluenceApp(actor = null, options = {}) {
  return new InfluenceApp({ actor, ...options }).render(true);
}

// GM-side socket handler (via socketlib): resolve a player's roll against a
// hidden target. socketlib routes `executeAsGM` to an active GM client, which
// re-resolves the roll with the real target data the player can't see.
Hooks.once("socketlib.ready", () => {
  const socket = socketlib.registerModule(MODULE_ID);
  socket.register("resolveHiddenRoll", (payload) => InfluenceApp.resolveExternal(payload));
  InfluenceApp.socket = socket;
});

Hooks.once("init", () => {
  // World settings for the racial layer (docs/RACIAL_REACTIONS_PLAN.md).
  game.settings.register(MODULE_ID, "enableBtaCaste", {
    name: "ACKS-INFLUENCE.settings.btaCaste.name",
    hint: "ACKS-INFLUENCE.settings.btaCaste.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "raceRelations", {
    name: "ACKS-INFLUENCE.settings.raceRelations.name",
    hint: "ACKS-INFLUENCE.settings.raceRelations.hint",
    scope: "world",
    config: true,
    type: String,
    default: "[]",
  });

  // Public API for macros / other modules. Set this FIRST so nothing below can
  // prevent it from being assigned.
  const api = {
    apiVersion: 7, // 7: morale-family pages — combat morale, obedience, irrefusable offer
    open: openInfluenceApp,
    InfluenceApp,
    // Racial & cross-species helpers (docs/RACIAL_REACTIONS_PLAN.md):
    kindOf,
    matchesKind,
    relationFor,
    registerRaceRelations,
    // Rules constants & helpers exported for consumer modules (acks-henchmen).
    constants: {
      REACTION_CHANGE_KEY,
      LOYALTY_CHANGE_KEY,
      MORALE_CHANGE_KEY,
      ROLL_FAMILY,
      INFLUENCE_TONE,
      INFLUENCE_BANDS,
      INFLUENCE_RELATIONSHIP_MOD,
      INFLUENCE_TIME_STEPS,
      HENCHMAN_MONTHLY_WAGE,
    },
    getActorHD,
    monthlyWageForHD,
    getProficiencies,
    getEffectReactionMods,
    // Custom hooks fired (camelCase module namespace — TOOLCHAIN §5b):
    hooks: {
      rollComplete: "acksInfluenceRollComplete",
      attitudeChanged: "acksInfluenceAttitudeChanged",
    },
  };
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
  // Also expose globally as a resilient fallback for macros.
  globalThis.acksInfluence = api;

  // acks-lib is a hard requirement (see module.json): its scopeApplies gates
  // every effect modifier and resolveLevelValue resolves level ladders. If it is
  // missing the roller degrades to "no ability mods / undetermined scope" rather
  // than throwing, but that is a broken world — say so plainly.
  if (!globalThis.acksLib) {
    console.warn(`${MODULE_ID} | acks-lib not found — effect gating and level-value semantics are unavailable; enable acks-lib.`);
  }

  // Register the stored-attitude Item subtype + its sheet.
  CONFIG.Item.dataModels ??= {};
  CONFIG.Item.dataModels[ATTITUDE_TYPE] = AttitudeData;
  try {
    foundry.documents.collections.Items.registerSheet(MODULE_ID, AttitudeSheet, {
      types: [ATTITUDE_TYPE],
      makeDefault: true,
      label: "ACKS Influence: Attitude",
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | attitude sheet registration failed`, err);
  }

  // Preload templates so first render and chat cards are instant (best-effort).
  try {
    foundry.applications.handlebars.loadTemplates([
      `modules/${MODULE_ID}/templates/influence/influence.hbs`,
      `modules/${MODULE_ID}/templates/influence/influence-result.hbs`,
      `modules/${MODULE_ID}/templates/influence/mode-result.hbs`,
      `modules/${MODULE_ID}/templates/influence/attitude-item.hbs`,
    ]);
  } catch (err) {
    console.warn(`${MODULE_ID} | template preload skipped`, err);
  }
});

Hooks.once("ready", () => {
  if (game.system?.id !== "acks") {
    console.warn(`${MODULE_ID} | Active system is not "acks"; the character-sheet button may not appear.`);
  }
});

/**
 * Inject an "Influence" button into the ACKS character sheet header, styled to
 * match the system's existing header icon buttons. Fails gracefully if the
 * header structure changes.
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement|JQuery} element
 */
function injectSheetButton(app, element) {
  try {
    const actor = app?.actor ?? app?.document ?? null;
    if (actor?.type !== "character") return;

    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root || root.querySelector(".acks-influence-btn")) return;

    const anchor = root.querySelector(".sheet-header .health-box") ?? root.querySelector(".sheet-header");
    if (!anchor) return;

    const wrap = document.createElement("div");
    wrap.className = "form-icon-btn";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "plain icon fa-regular fa-comments acks-influence-btn";
    btn.dataset.tooltip = game.i18n.localize("ACKS-INFLUENCE.button.tooltip");
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openInfluenceApp(actor);
    });
    wrap.appendChild(btn);

    if (anchor.classList.contains("health-box")) anchor.insertAdjacentElement("afterend", wrap);
    else anchor.appendChild(wrap);
  } catch (err) {
    console.error(`${MODULE_ID} | failed to inject sheet button`, err);
  }
}

/**
 * Inject a native-looking "Relationships" section (stored attitudes) into the
 * Notes tab — click a row to open the record, drag it to another actor to
 * transfer, or delete it (owner only).
 */
function injectRelationships(app, element) {
  try {
    const actor = app?.actor ?? app?.document ?? null;
    if (actor?.type !== "character") return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;
    const host =
      root.querySelector('.tab[data-tab="notes"] .content .flexcol') ??
      root.querySelector('.tab[data-tab="notes"] .flexcol') ??
      root.querySelector('.tab[data-tab="notes"] .content') ??
      root.querySelector('.tab[data-tab="notes"]');
    if (!host) {
      // The core sheet's Notes-tab DOM changed shape: the attitude Items are
      // still stored on the actor, just with nowhere to render. Warn once so
      // the loss is visible without spamming every render.
      if (!injectRelationships.warnedNoHost) {
        injectRelationships.warnedNoHost = true;
        console.warn(`${MODULE_ID} | relationships: no Notes-tab host found on the character sheet; section not rendered`);
      }
      return;
    }
    if (host.querySelector(".acks-influence-relationships")) return;

    const items = actor.items.filter((i) => i.type === ATTITUDE_TYPE);

    const row = document.createElement("section");
    row.className = "flexrow col-stretch acks-influence-relationships";
    const section = document.createElement("section");
    section.className = "item-list-section";
    const header = document.createElement("div");
    header.className = "list-header";
    header.innerHTML = `<div class="list-header__name">${game.i18n.localize("ACKS-INFLUENCE.attitude.relationships")}</div>`;
    section.appendChild(header);

    const ul = document.createElement("ul");
    ul.className = "item-list unlist";
    for (const item of items) {
      const attKey = INFLUENCE_ATTITUDE_LABELS.diplomacy[item.system.attitude] ?? "";
      const li = document.createElement("li");
      li.className = "item";
      li.dataset.itemId = item.id;
      li.draggable = true;
      li.addEventListener("dragstart", (ev) =>
        ev.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData())),
      );

      const row2 = document.createElement("div");
      row2.className = "item-row";
      const name = document.createElement("a");
      name.className = "item__name";
      name.textContent = `${item.system.targetName || item.name} — ${game.i18n.localize(attKey)}`;
      name.addEventListener("click", () => item.sheet.render(true));
      row2.appendChild(name);

      if (actor.isOwner) {
        const controls = document.createElement("div");
        controls.className = "list-header__controls";
        const del = document.createElement("a");
        del.className = "item-control";
        del.innerHTML = '<i class="fas fa-trash"></i>';
        del.dataset.tooltip = game.i18n.localize("ACKS.Delete");
        del.addEventListener("click", (ev) => {
          ev.stopPropagation();
          item.delete();
        });
        controls.appendChild(del);
        row2.appendChild(controls);
      }
      li.appendChild(row2);
      ul.appendChild(li);
    }
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "item ai-rel-empty";
      empty.textContent = game.i18n.localize("ACKS-INFLUENCE.attitude.none");
      ul.appendChild(empty);
    }
    section.appendChild(ul);
    row.appendChild(section);
    host.insertBefore(row, host.firstChild);
  } catch (err) {
    console.error(`${MODULE_ID} | failed to inject relationships`, err);
  }
}

function onRenderCharacterSheet(app, element) {
  injectSheetButton(app, element);
  injectRelationships(app, element);
}

// v13/v14 ApplicationV2 fires render hooks for the whole class inheritance chain.
// We anchor on the base-class hooks (which fire regardless of the system sheet's
// possibly-minified class name) plus the system-specific name. The handlers
// filter to character sheets and dedupe, so multiple firings are harmless.
Hooks.on("renderApplicationV2", onRenderCharacterSheet);
Hooks.on("renderActorSheetV2", onRenderCharacterSheet);
Hooks.on("renderACKSCharacterSheetV2", onRenderCharacterSheet);

/**
 * Support the `/influence` chat command. Returning false prevents the message
 * from being created as normal chat.
 */
Hooks.on("chatMessage", (_chatLog, message) => {
  const command = message.trim().toLowerCase();
  if (command !== "/influence" && command !== "/inf") return true;

  // Prefer a controlled token's actor, then the user's assigned character.
  const controlled = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  const actor = controlled ?? game.user?.character ?? null;
  openInfluenceApp(actor);
  return false;
});
