/* global game, foundry, Hooks, CONFIG, Actor, ui, CONST */
/**
 * ACKS II — Henchmen & Hirelings. Entry point.
 *
 *  init:  location data model + sheet (module sub-types register safely at
 *         init — acks-domains precedent), settings, template preload.
 *  setup: ruledata load (fetch), public API.
 *  ready: system check, GM time watcher, chat commands, card listeners.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, LOCATION_TYPE, RULEDATA, HOOKS, SCHEMA_VERSION } from "./constants.mjs";
import { installWageGuard, registerDeletionCleanup, sweepAtReady, repairWorld, repairActor, scanActor, describeRepair } from "./repair.mjs";
import * as config from "./config.mjs";
import { registerSettings, getSetting } from "./settings.mjs";
import { getTable, getDoc, initTables } from "./rules/tables.mjs";
import { THROWS_DATA, RARITY_AUTOMATION } from "./data/throws-data.mjs";
import * as availabilityRules from "./rules/availability.mjs";
import * as wageRules from "./rules/wages.mjs";
import * as loyaltyRules from "./rules/loyalty.mjs";
import * as diceRules from "./rules/dice.mjs";
import * as adapter from "./acks-adapter.mjs";
import { collectEffectModifiers, sumEffectModifiers, hasEffectFlag } from "./effects.mjs";
import HenchmanRecord from "./data/henchman-record.mjs";
import { isGroupActor } from "../lib/group-logic.mjs";
import { missingTablesList } from "../lib/ruledata.mjs";
import { LocationSheet } from "../location/apps/location-sheet.mjs";
import { ThrowDialog, openThrowDialog } from "./apps/throw-dialog.mjs";
import { openPostingDialog } from "./apps/posting-dialog.mjs";
import { openRecruitDialog, openRecruitSpecial } from "./apps/recruit-dialog.mjs";
import { createPosting, processLocation, processAllLocations, effectiveMarketClass } from "./engine/recruitment.mjs";
import { materializePendingHires } from "./apps/recruit-dialog.mjs";
import { postSlaveMarketCard, slaveryEnabled } from "./engine/slavery-market.mjs";
import { hire, checkHenchmanLimit, addSpecialHire, hireExistingActor } from "./engine/hire.mjs";
import * as candidateRules from "./rules/candidates.mjs";
import * as identityRules from "./rules/identity.mjs";
import { onTimeAdvanced, advanceDays, now } from "./time.mjs";
import { bindCardListeners, registerCardAction } from "./chat/cards.mjs";

import { registerEventEngine, openLoyaltyRoll, openObedienceRoll, recordCalamity, payWagesFor, enrollNewcomers, forgiveWageDebts, setPermanentCompensated, allEmployers, effectiveLoyaltyFor, effectiveMoraleFor } from "./engine/events.mjs";
import { openRosterApp } from "./apps/roster-app.mjs";
import { installHirelingsGrid } from "./apps/hirelings-grid.mjs";
import { recruitMonster, hireMonster, validateMonsterRecruit } from "./engine/monster.mjs";
import { openFollowersDialog } from "./apps/followers-dialog.mjs";
import * as slaveryRules from "./rules/slavery.mjs";
import * as facts from "./facts.mjs";
import * as influenceIntegration from "./integrations/influence.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
const { registerInfluenceIntegration, openInfluenceFor } = influenceIntegration;

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);

  // The `location` sub-type and its sheet belong to the location feature and
  // are registered there. This feature is a consumer: it reads and writes
  // `system.market.*` on a location it does not own.

  registerSettings();

  // Core's getTotalWages dereferences every henchmenList id unguarded, so one
  // deleted hireling breaks character-sheet render for everyone. Guard first,
  // repair after (scripts/repair.mjs).
  installWageGuard();
  registerDeletionCleanup();

  try {
    const T = `modules/${MODULE_ID}/templates/henchmen`;
    // The location sheet's template lives under templates/location/ with the
    // sheet, and the location feature preloads it — not this list.
    foundry.applications.handlebars.loadTemplates([
      `${T}/posting-dialog.hbs`,
      `${T}/throw-dialog.hbs`,
      `${T}/roster-app.hbs`,
      `${T}/chat/throw-card.hbs`,
      `${T}/chat/reveal-card.hbs`,
      `${T}/chat/event-card.hbs`,
    ]);
  } catch (err) {
    console.warn(`${MODULE_ID} | template preload skipped`, err);
  }

  // Re-skin the core character sheet's Hirelings tab as a grid of acks-lib
  // Follower Cards (degrades to the stock list if acks-lib is too old).
  installHirelingsGrid();
});

Hooks.once("setup", async () => {
  // Book tables are NOT shipped and NOT fetched here. Every rules function
  // reads through rules/tables.mjs, which delegates to the acks-lib registry
  // (acksLib.tables). Tables arrive per world via acks-content extraction →
  // the ruledata-import contract → acks-lib at world priority; acks-location
  // mirrors the persisted set into the registry before this module's `ready`.
  //
  // The exception is `throws`: this module's own social-roll automation config
  // (module vocabulary, not book data), shipped and registered at SAMPLE
  // priority so hiring/loyalty/obedience rolls work with no import. A catalog
  // or world may still override the `throws` doc by id.
  if (globalThis.acksExtras?.lib?.tables) {
    try {
      initTables(THROWS_DATA);
      initTables(RARITY_AUTOMATION); // partial doc: per-table layering keeps imports above
    } catch (err) {
      console.error(`${MODULE_ID} | failed to register throws automation`, err);
    }
    // Declare the tables this module reads, so the materialize flow can
    // generate EMPTY placeholders for expected-but-missing ones.
    try {
      globalThis.acksExtras?.lib.tables.expectTables?.("availability", ["henchmanAvailability", "mercenaryAvailability", "specialistAvailability", "searchFees"]);
      globalThis.acksExtras?.lib.tables.expectTables?.("rarity", ["classRarityTables", "rarityAvailability", "randomHenchmanLevel", "classDistribution", "specificQualificationMods"]);
      globalThis.acksExtras?.lib.tables.expectTables?.("wages", ["henchmanWageByLevel", "signingBonus", "mercenaryWages"]);
      globalThis.acksExtras?.lib.tables.expectTables?.("people", ["cultures", "classPercentages", "occupationTypes", "occupationSubTables", "occupationPackages", "classRestrictions", "cultureAppearance", "ageByClass", "proficienciesByAge", "hd0", "dwarvenCastes"]);
      globalThis.acksExtras?.lib.tables.expectTables?.("slavery", ["commonSlaves", "slaveTroopCosts", "slaveLoyalty", "soldierRules"]);
      globalThis.acksExtras?.lib.tables.expectTables?.("settlement", ["marketClassByFamilies"]);
    } catch (err) {
      console.warn(`${MODULE_ID} | expectTables failed`, err);
    }
  }

  // Public API: macros and other modules reach the module through here.
  const api = {
    MODULE_ID,
    HOOKS,
    config,
    // apps
    openThrowDialog,
    ThrowDialog,
    openPostingDialog,
    openRecruitDialog,
    openRosterApp,
    LocationSheet,
    // loyalty automation
    openLoyaltyRoll,
    openObedienceRoll,
    recordCalamity,
    payWagesFor,
    enrollNewcomers,
    forgiveWageDebts,
    setPermanentCompensated,
    allEmployers,
    effectiveLoyaltyFor,
    effectiveMoraleFor,
    // monsters, followers, integrations
    recruitMonster,
    hireMonster,
    validateMonsterRecruit,
    openFollowersDialog,
    openInfluenceFor,
    // "Where am I slandered?" — the party/character-side reader over the
    // location-held slander registries (a read helper, not a second store).
    slanderedAt: (query = {}) =>
      game.actors
        .filter((a) => a.type === LOCATION_TYPE)
        .map((location) => ({ location, count: location.system.slanderCountFor?.(query) ?? 0 }))
        .filter((r) => r.count > 0),
    integrations: { influence: influenceIntegration },
    facts,
    // engine
    createPosting,
    processLocation,
    processAllLocations,
    effectiveMarketClass,
    hire,
    checkHenchmanLimit,
    materializePendingHires,
    // special hires (real actors: GM-placed or found on adventures)
    addSpecialHire,
    registerFoundRecruit: (location, actor, opts = {}) => addSpecialHire(location, actor, { ...opts, origin: "found" }),
    hireExistingActor,
    openRecruitSpecial,
    // data
    HenchmanRecord,
    getRecord: (actor) => HenchmanRecord.fromActor(actor),
    // rules (pure; slavery rules only function with enableSlavery on)
    rules: { ...availabilityRules, ...wageRules, ...loyaltyRules, ...diceRules, ...candidateRules, ...identityRules, slavery: slaveryRules },
    // optional RAW slavery surface (setting-gated GM chat card)
    postSlaveMarketCard,
    slaveryEnabled,
    tables: { getTable, getDoc },
    // dangling-reference repair (core getTotalWages crash — see repair.mjs)
    repair: { repairWorld, repairActor, scanActor, describeRepair },
    // adapter + effects (the data-driven modifier contract)
    adapter,
    effects: { collectEffectModifiers, sumEffectModifiers, hasEffectFlag },
    time: { now, advanceDays },
  };
  acksExtras.henchmen = api;
});

Hooks.once("ready", () => {
  if (!assertAcksSystem("henchmen automation expects the ACKS II system.")) return;

  registerEventEngine();
  registerInfluenceIntegration();

  if (getSetting("autoRepairReferences")) sweepAtReady();

  // Adopt pre-existing henchmen the moment the module can see them, not on
  // the first time-advance: their wage clocks start from install day, so the
  // first prompt they ever appear in is an honest one month from now.
  if (game.user === game.users.activeGM) {
    (async () => {
      for (const employer of allEmployers()) await enrollNewcomers(employer);
    })().catch((err) => console.error(`${MODULE_ID} | adopting pre-existing hirelings failed`, err));
  }

  // Book tables are imported per-world, not shipped. If some documents have
  // not been imported yet, tell the GM once and name them. The question is
  // which declared TABLES are readable, never which ids are registered: this
  // feature registers a `rarity` doc of its own automation at setup, so a
  // doc-presence check could never name rarity's book tables as missing.
  if (game.user.isGM) {
    const missing = missingTablesList(RULEDATA);
    if (missing.length) {
      ui.notifications.warn(game.i18n.format("ACKS-HENCHMEN.tablesMissing", { list: missing.join(", ") }));
    }
  }

  // Hires accepted while no seat could create actors (players hiring with
  // no GM online) — materialize their queued actors now.
  if (game.user === game.users.activeGM) {
    for (const location of game.actors.filter((a) => a.type === LOCATION_TYPE)) {
      materializePendingHires(location).catch((err) => console.error(`${MODULE_ID} | pending-hire sweep failed`, err));
    }
  }

  // Location schema migration (GM): v2 moved availability from per-posting
  // pools to the location's shared market — old-shape postings/candidates
  // (pre-0.3.0 test data) cannot be converted and are cleared.
  if (game.user === game.users.activeGM) {
    for (const location of game.actors.filter((a) => a.type === LOCATION_TYPE)) {
      if ((location.system.schemaVersion ?? 1) >= SCHEMA_VERSION) continue;
      // A place with no market has no subtree to clear, and writing one would
      // hand it a market it never asked for.
      if (!location.system.hasMarket) continue;
      const hadData = (location.system.postings?.length ?? 0) + (location.system.candidates?.length ?? 0) > 0;
      location
        .update({
          "system.market.postings": [],
          "system.market.candidates": [],
          "system.market.marketRolls": [],
          "system.schemaVersion": SCHEMA_VERSION,
        })
        .then(() => {
          if (hadData) {
            ui.notifications.warn(game.i18n.format("ACKS-HENCHMEN.migration.wiped", { name: location.name }));
          }
        })
        .catch((err) => console.error(`${MODULE_ID} | migration failed for ${location.name}`, err));
    }
  }

  // GM-side due-processing whenever world time moves (posting aging, arrival
  // tranches, weekly fees, month rollover). Idempotent per posting.
  onTimeAdvanced(async () => {
    await processAllLocations();
    // time moved with a GM present: materialize any hires queued while offline
    for (const location of game.actors.filter((a) => a.type === LOCATION_TYPE)) {
      await materializePendingHires(location).catch(() => null);
    }
  });

  // Chat command: /recruit opens the recruitment board for the user's actor.
  try {
    game.acks?.commands?.registerCommand?.({
      path: "/recruit",
      desc: game.i18n.localize("ACKS-HENCHMEN.command.recruit"),
      func: () => {
        const locations = game.actors.filter((a) => a.type === LOCATION_TYPE);
        if (!locations.length) {
          ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.command.noLocations"));
          return;
        }
        (locations.find((l) => l.testUserPermission?.(game.user, "OBSERVER")) ?? locations[0])?.sheet?.render(true);
      },
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | chat command registration failed`, err);
  }
});

/* A location is a public bulletin board: new location actors default to OWNER
 * so players can post searches, run due processing and hire with no GM client
 * online. The sheet still hides GM tabs from players, and a stricter table sets
 * ownership down by hand — explicit ownership in the creation data always
 * wins. */
Hooks.on("preCreateActor", (doc, data) => {
  if (doc.type !== `${MODULE_ID}.location`) return;
  if (data?.ownership?.default != null) return;
  doc.updateSource({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
});

/* Bind event-card buttons (v14 AppV2 convention: HTMLElement hook only —
 * registering the legacy jQuery hook triggers a deprecation warning). */
Hooks.on("renderChatMessageHTML", (_message, html) => bindCardListeners(html));

/* Roster button on acks character sheets (additive DOM only — the
 * acks-domains/acks-influence injection pattern, dedupe-guarded). */
Hooks.on("renderActorSheetV2", (app, element) => {
  if (game.system?.id !== "acks") return;
  const actor = app.actor ?? app.document;
  if (actor?.type !== ACTOR_TYPE.character || actor.system?.retainer?.enabled) return;
  if (!actor.isOwner) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const header = root?.querySelector(".window-header");
  if (!header || header.querySelector(".acks-henchmen-roster-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon fa-solid fa-people-group acks-henchmen-roster-button";
  button.dataset.tooltip = game.i18n.localize("ACKS-HENCHMEN.roster.open");
  button.addEventListener("click", () => openRosterApp(actor));
  const closeButton = header.querySelector('[data-action="close"]');
  if (closeButton) header.insertBefore(button, closeButton);
  else header.append(button);
});

/* "Roll Unit Morale" on a group actor's directory context menu — the group
 * sheet lives in the library half, so this stays out of it. */
Hooks.on("getActorContextOptions", (_directory, options) => {
  const findActor = (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
    return id ? game.actors.get(id) : null;
  };
  options.push({
    label: "ACKS-HENCHMEN.unitMorale.menu",
    icon: '<i class="fas fa-flag"></i>',
    visible: (li) => isGroupActor(findActor(li)),
    onClick: async (_event, li) => {
      const actor = findActor(li);
      if (!actor) return;
      const { openUnitMoraleDialog } = await import("./apps/unit-morale-dialog.mjs");
      openUnitMoraleDialog(actor);
    },
  });
});

export { registerCardAction, getSetting };
