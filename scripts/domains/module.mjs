/* global CONFIG, Hooks, CONST, foundry */
/**
 * Domains — a ruler's domain as an actor: its land, what it holds, its month's
 * lines, its morale, and its place in a realm of lieges and vassals.
 *
 * Owns the `acks-extras.domain` sub-type (`data/domain-data.mjs`) and its
 * sheet, and registers the country brush's domain layer and the Domains map
 * mode into battlemap's registries (`domain-map.mjs`, at import). The api is
 * published at `init`, not `ready`, because the location feature's
 * empty-location prune runs at `ready` and asks `holdsPlace` before it
 * deletes anything.
 */
import { acksExtras } from "../namespace.mjs";
import {
  MODULE_ID, DOMAIN_TYPE, CLASSIFICATIONS, HOLDING_ROLES, REVENUE_LINES, EXPENSE_LINES,
} from "./constants.mjs";
import { DomainData } from "./data/domain-data.mjs";
import { DomainSheet, registerDomainSheet, registerDomainSheetRefresh } from "./apps/domain-sheet.mjs";
import {
  allDomains, domainOf, domainsHolding, domainsRuledBy, familiesOf, foundSettlement, hold, holdsPlace, isDomain,
  ledgerFor, liegeOf, promoteVassal, release, setLiege, vassalsOf, wouldCycle,
} from "./domains.mjs";
import {
  blankDomain, hexCountOf, ledgerOf, normalizeDomain, peasantFamiliesOf, strongholdValueOf, tributeInOf,
  urbanFamiliesOf,
} from "./domain-logic.mjs";
import { hexCountFor, installDomainMap, territoryOf } from "./domain-map.mjs";

/** The picture a domain is made with when its maker names none: core's castle. */
const DOMAIN_IMG = "icons/svg/castle.svg";

const TEMPLATES = [
  "domain-band", "domain-frame", "domain-tabs",
  "domain-tab-overview", "domain-tab-territory", "domain-tab-holdings", "domain-tab-ledger", "domain-tab-realm", "domain-tab-notes",
  "domain-lines", "domain-bonds",
].map((name) => `modules/${MODULE_ID}/templates/domains/${name}.hbs`);

Hooks.once("init", () => {
  // The data model and the sheet register HERE and only here — this feature
  // owns the sub-type.
  CONFIG.Actor.dataModels[DOMAIN_TYPE] = DomainData;
  registerDomainSheet();
  registerDomainSheetRefresh();
  installDomainMap();

  foundry.applications.handlebars
    .loadTemplates(TEMPLATES)
    .catch((err) => console.warn(`${MODULE_ID} | template preload skipped`, err));

  /**
   * A domain is the Judge's record: it opens with default ownership. Its
   * token is a marker like a place's — named on hover, on no side, tracking
   * no bars, seeing nothing. Field by field, and only where the creation data
   * said nothing.
   */
  Hooks.on("preCreateActor", (doc, data) => {
    if (doc.type !== DOMAIN_TYPE) return;
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
      changes.img = DOMAIN_IMG;
      token.texture = { src: DOMAIN_IMG };
    }
    if (Object.keys(token).length) changes.prototypeToken = token;
    if (Object.keys(changes).length) doc.updateSource(changes);
  });

  acksExtras.domains = {
    // 2: promoteVassal and foundSettlement. 3: territoryOf and hexCountFor.
    apiVersion: 3,
    DOMAIN_TYPE,
    CLASSIFICATIONS,
    HOLDING_ROLES,
    REVENUE_LINES,
    EXPENSE_LINES,
    DomainSheet,
    isDomain,
    allDomains,
    // Who holds what. `domainOf` answers for the place and everything it
    // stands inside; `domainsHolding` and `holdsPlace` for the place alone.
    domainOf,
    domainsHolding,
    holdsPlace,
    domainsRuledBy,
    vassalsOf,
    liegeOf,
    wouldCycle,
    // The record's shape and its sums. `normalizeDomain` is what a writer —
    // the importer's binding included — hands `system`.
    normalizeDomain,
    blankDomain,
    familiesOf,
    ledgerFor,
    ledgerOf,
    peasantFamiliesOf,
    urbanFamiliesOf,
    hexCountOf,
    strongholdValueOf,
    tributeInOf,
    // The territory with the map read in: the stored rows, then a row per
    // hex painted into the domain that none names; and the hexes it covers.
    territoryOf,
    hexCountFor,
    // The Judge's writers. GM only; each says why it refused.
    setLiege,
    hold,
    release,
    promoteVassal,
    foundSettlement,
  };
});
