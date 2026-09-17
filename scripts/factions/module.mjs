/* global game, CONFIG, Hooks, CONST, foundry */
/**
 * Factions — organisations as actors, and the Judge's ledger of how each
 * stands toward a party.
 *
 * Owns the `acks-extras.faction` sub-type (`data/faction-data.mjs`), its
 * sheet, the world's one standing knob, and two consumers of the ledger that
 * live here because they read it: the influence roller's faction rows
 * (`influence-listener.mjs`) and the market-class shift the henchmen feature
 * asks for through the api (`standing.mjs`, `marketClassShift`). The hunt —
 * a faction that wants the party marking the settlement board hunted in the
 * quarters it controls — is the formation feature's to apply (`hunt.mjs`
 * there); this feature only answers who is hunting whom where.
 */
import { acksExtras } from "../namespace.mjs";
import {
  MODULE_ID, LANG_PREFIX, FACTION_TYPE, FACTION_KINDS, RELATION_STANCES, STANDING_SOURCES, SUBJECT_SCOPES, HOOKS,
  SETTING_STANDING_STEP,
} from "./constants.mjs";
import { FactionData } from "./data/faction-data.mjs";
import { FactionSheet, registerFactionSheet, districtRegionOptions } from "./apps/faction-sheet.mjs";
import { installFactionInfluence } from "./influence-listener.mjs";
import {
  addHolding, addStanding, allFactions, authoritiesRostering, factionsAt, factionsControlling, factionsHolding,
  factionsOfMember, huntersOf, isFaction, isWantedBy, marketClassShift, regardedByFactions, relationBetween,
  removeHolding, removeRelation, removeStanding, setRelation, standingFor, standingRowsFor, subjectsOfActor,
  subjectsOfFormation,
} from "./standing.mjs";
import { classStepsFor, matchesSubject, subjectsOf, sumStanding } from "./standing-logic.mjs";

/** The picture a faction is made with when its maker names none: core's own hanging sign. */
const FACTION_IMG = "icons/svg/hanging-sign.svg";

const TEMPLATES = [`modules/${MODULE_ID}/templates/factions/faction-sheet.hbs`];

Hooks.once("init", () => {
  // The data model and the sheet register HERE and only here — this feature
  // owns the sub-type. Unconditional: nothing gates a registration whose
  // failure costs the whole sheet.
  CONFIG.Actor.dataModels[FACTION_TYPE] = FactionData;
  registerFactionSheet();

  game.settings.register(MODULE_ID, SETTING_STANDING_STEP, {
    name: `${LANG_PREFIX}.settings.standingStep.name`,
    hint: `${LANG_PREFIX}.settings.standingStep.hint`,
    scope: "world",
    config: true,
    type: Number,
    default: 0,
  });

  installFactionInfluence();

  foundry.applications.handlebars
    .loadTemplates(TEMPLATES)
    .catch((err) => console.warn(`${MODULE_ID} | template preload skipped`, err));

  /**
   * A faction is the Judge's record: it opens with default ownership, so a
   * player sees it only when given it. Its token — a banner on a map, if it
   * ever has one — is a marker like a place's: named on hover, on no side,
   * tracking no bars, seeing nothing. Field by field, and only where the
   * creation data said nothing.
   */
  Hooks.on("preCreateActor", (doc, data) => {
    if (doc.type !== FACTION_TYPE) return;
    const changes = {};
    const proto = data?.prototypeToken ?? {};
    const token = {};
    if (proto.displayName == null) token.displayName = CONST.TOKEN_DISPLAY_MODES.HOVER;
    if (proto.disposition == null) token.disposition = CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    if (proto.bar1?.attribute === undefined) token.bar1 = { attribute: null };
    if (proto.bar2?.attribute === undefined) token.bar2 = { attribute: null };
    if (proto.sight?.enabled == null) token.sight = { enabled: false };
    // The token's picture is copied from the actor's at construction, before
    // this hook runs, so a default icon has to land on both.
    if (data?.img == null && proto.texture?.src == null) {
      changes.img = FACTION_IMG;
      token.texture = { src: FACTION_IMG };
    }
    if (Object.keys(token).length) changes.prototypeToken = token;
    if (Object.keys(changes).length) doc.updateSource(changes);
  });
});

Hooks.once("ready", () => {
  acksExtras.factions = {
    apiVersion: 2,
    FACTION_TYPE,
    FACTION_KINDS,
    RELATION_STANCES,
    STANDING_SOURCES,
    SUBJECT_SCOPES,
    HOOKS,
    FactionSheet,
    isFaction,
    allFactions,
    // Who holds what: a region, a place, an actor. `factionsAt` answers for the
    // place and everything it is inside of; `factionsHolding` for the place
    // alone, which is what a place's own sheet asks.
    factionsControlling,
    factionsAt,
    factionsHolding,
    factionsOfMember,
    authoritiesRostering,
    districtRegionOptions,
    // The subject set of one side of a dealing, and what a ledger says of it.
    subjectsOf,
    subjectsOfActor,
    subjectsOfFormation,
    matchesSubject,
    sumStanding,
    standingFor,
    standingRowsFor,
    isWantedBy,
    huntersOf,
    // The one knob: standing into market steps. The henchmen feature reads
    // `marketClassShift` through this api rather than importing the feature.
    classStepsFor,
    marketClassShift,
    // How organisations regard one another. A stance is a label; the figure
    // that goes with a rivalry is a `faction`-scope ledger row.
    relationBetween,
    regardedByFactions,
    // The Judge's writers. GM only.
    addStanding,
    removeStanding,
    setRelation,
    removeRelation,
    addHolding,
    removeHolding,
  };
});
