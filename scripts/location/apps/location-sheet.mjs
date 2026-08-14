/* global game, ui, foundry, fromUuidSync, fromUuid, Actor, RollTable, Hooks, CONST */
/**
 * LocationSheet — ActorSheetV2 for the `acks-extras.location` sub-type.
 *
 * A place: what it is, what it holds, what it sits inside — and, where there is
 * one, the market that recruits people there. This feature owns the sub-type and
 * this is its only sheet.
 *
 * MARKET tabs: settings + demographics, THE MARKET (the location's shared
 * monthly pools — availability belongs to the town, RR 162), paid searches
 * (postings), candidates (unique individuals), slander registry, fee ledger.
 * Players with OBSERVER permission see the candidates their paid searches
 * cover; GMs see everything.
 *
 * STORAGE tab: goods grouped by whose they are, because a warehouse holding
 * three characters' gear is three inventories in one actor, not one shared
 * pile. Retrieval is offered on the rows a user can actually claim — their own
 * characters' goods, or everything for a GM. That is a UI convention, not a
 * security boundary (acks-lib's storage header makes the same ruling): anything
 * that must genuinely stay private belongs on a GM-owned actor.
 */
import { makeLoc, libStorage as storage } from "../../lib/util.mjs";
import * as places from "../../lib/place.mjs";
import { emptyMarket } from "../data/location-data.mjs";
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE, SCENE_LINK_FLAG } from "../constants.mjs";
import { HOOKS, SECONDS_PER_DAY, SECONDS_PER_WEEK } from "../../henchmen/constants.mjs";
import { openStashDialog } from "./stash-dialog.mjs";
import { getTable, optTable } from "../../henchmen/rules/tables.mjs";
import { processLocation, closePosting, reloadMarket } from "../../henchmen/engine/recruitment.mjs";
import { executeAsGM } from "../../lib/sockets.mjs";
import { addSpecialHire, updateSpecialHire } from "../../henchmen/engine/hire.mjs";
import { openPostingDialog } from "../../henchmen/apps/posting-dialog.mjs";
import { openRecruitDialog, openRecruitSpecial } from "../../henchmen/apps/recruit-dialog.mjs";
import { openHireGroupDialog } from "../../henchmen/apps/hire-group-dialog.mjs";
import { now, advanceDays, nextMarketRollTime } from "../../henchmen/time.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";
import { buildCatalog, availabilityFor, performSearchDay } from "../../markets/engine/trade.mjs";
import { openPurchaseDialog } from "../../markets/apps/purchase-dialog.mjs";
import { merchandiseLabel } from "../../markets/config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/* Storage-tab helpers. `loc` resolves under ACKS-LOCATION.*, which is where the
 * storage half's strings were authored; the market half localizes under
 * ACKS-HENCHMEN.* inline. Both roots live in the one merged lang file. */
const loc = makeLoc(LANG_PREFIX);

/** The tabs that exist only where there is a market. */
const MARKET_TABS = ["recruitment", "henchmen", "mercenaries", "specialists", "trade"];

/**
 * Does a directed-search spec match this candidate? A directed CLASS search
 * reveals every available candidate of that class (and, for the class+level
 * tier, that level) to the poster — not only the ones the replacement mechanic
 * converted. A proficiency-only search matches the tag the replacement stamps
 * on `notes` (best-effort — a bare walk-in carries no proficiency record).
 * Shared-segment specs (general henchman, mercenary, specialist) are NOT
 * directed and never match here; they are covered by the segment logic.
 */
function directedSpecMatches(spec, c) {
  const kind = spec?.kind ?? "";
  const wantsClass = kind === "henchmanByClass" || kind === "henchmanByClassProficiency";
  const wantsProf = kind === "henchmanByProficiency" || kind === "henchmanByClassProficiency";
  if (!wantsClass && !wantsProf) return false;
  if (wantsClass) {
    if (!spec.classKey) return false;
    if (String(c.classKey ?? "").toLowerCase() !== String(spec.classKey).toLowerCase()) return false;
    // class+level tier: the level was part of what was sought.
    if (spec.level != null && (c.level ?? null) !== spec.level) return false;
    return true;
  }
  // proficiency-only search: only a candidate carrying the proficiency tag matches.
  const name = String(spec.proficiencyName ?? "").toLowerCase();
  return !!name && String(c.notes ?? "").toLowerCase().includes(name);
}

export class LocationSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // "location-sheet" was unprefixed and only passed validation because the
    // CSS rule scans styles/*.css, not JS class arrays.
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-location-sheet"],
    position: { width: 760, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      createPosting: LocationSheet.#onCreatePosting,
      processNow: LocationSheet.#onProcessNow,
      reloadMarket: LocationSheet.#onReloadMarket,
      advanceWeek: LocationSheet.#onAdvanceWeek,
      closePosting: LocationSheet.#onClosePosting,
      togglePlayerDetails: LocationSheet.#onTogglePlayerDetails,
      recruit: LocationSheet.#onRecruit,
      hireGroup: LocationSheet.#onHireGroup,
      recruitSpecial: LocationSheet.#onRecruitSpecial,
      removeSpecial: LocationSheet.#onRemoveSpecial,
      setSpecialLimit: LocationSheet.#onSetSpecialLimit,
      removeCandidate: LocationSheet.#onRemoveCandidate,
      addSlander: LocationSheet.#onAddSlander,
      removeSlander: LocationSheet.#onRemoveSlander,
      addDemographic: LocationSheet.#onAddDemographic,
      removeDemographic: LocationSheet.#onRemoveDemographic,
      exportDemographics: LocationSheet.#onExportDemographics,
      // --- storage tab ---
      retrieveRow: LocationSheet.#onRetrieveRow,
      retrieveAll: LocationSheet.#onRetrieveAll,
      depositHere: LocationSheet.#onDepositHere,
      openManager: LocationSheet.#onOpenManager,
      openOwner: LocationSheet.#onOpenOwner,
      // --- contents tab: nesting, occupancy, stacking, the map ---
      openPlace: LocationSheet.#onOpenPlace,
      detachPlace: LocationSheet.#onDetachPlace,
      addChildPlace: LocationSheet.#onAddChildPlace,
      removeOccupant: LocationSheet.#onRemoveOccupant,
      keepOccupant: LocationSheet.#onKeepOccupant,
      toggleOccupantHidden: LocationSheet.#onToggleOccupantHidden,
      splitStack: LocationSheet.#onSplitStack,
      openScene: LocationSheet.#onOpenScene,
      unlinkScene: LocationSheet.#onUnlinkScene,
      // --- trade tab (engine + dialogs live in the markets feature) ---
      openPurchase: LocationSheet.#onOpenPurchase,
      marketsSearchDay: LocationSheet.#onMarketsSearchDay,
      toggleMasterworkContact: LocationSheet.#onToggleMasterworkContact,
      // --- the market gate ---
      addMarket: LocationSheet.#onAddMarket,
      removeMarket: LocationSheet.#onRemoveMarket,
    },
    // Culture mix by drag-and-drop: drop a RollTable of cultures on the
    // demographics block to SET this town's mix (result text = culture,
    // weight = result weight/range width). The exported mix round-trips.
    dragDrop: [{ dropSelector: ".demographics-block" }],
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/location/location-sheet.hbs` },
  };

  /** Sheet tabs. A place accumulates unrelated concerns; one scrolling page
   *  made the market's absence read as a defect rather than the norm. */
  static TABS = {
    primary: {
      tabs: [
        { id: "contents", icon: "fas fa-sitemap" },
        { id: "recruitment", icon: "fas fa-scroll" },
        { id: "henchmen", icon: "fas fa-user-group" },
        { id: "mercenaries", icon: "fas fa-shield-halved" },
        { id: "specialists", icon: "fas fa-user-gear" },
        { id: "trade", icon: "fas fa-coins" },
        { id: "storage", icon: "fas fa-boxes-stacked" },
        { id: "gmSettings", icon: "fas fa-gears" },
        { id: "gmView", icon: "fas fa-eye" },
      ],
      // Contents, not Recruitment: what a place holds and what it sits inside
      // are true of every place; a market is not.
      initial: "contents",
      // Every tab label resolves under one prefix, so the storage tab's label
      // is ACKS-HENCHMEN.location.tab.storage even though the storage half was
      // authored under ACKS-LOCATION.*. Adding the one key beats overriding
      // label resolution to support two prefixes.
      labelPrefix: "ACKS-HENCHMEN.location.tab",
    },
  };

  /** Localized label for a shared-pool segment key. */
  #segmentLabel(segment) {
    const [kind, key] = String(segment ?? "").split(":");
    if (kind === "henchman") return game.i18n.format("ACKS-HENCHMEN.market.henchmanSegment", { level: key });
    if (kind === "mercenary") return game.i18n.localize(`ACKS-HENCHMEN.troop.${key}`);
    if (kind === "specialist") return game.i18n.localize(`ACKS-HENCHMEN.specialist.${key}`);
    return segment;
  }

  #specLabel(spec) {
    const kind = game.i18n.localize(`ACKS-HENCHMEN.posting.kind.${spec.kind}`);
    const detail =
      spec.classKey ||
      spec.troopType ||
      spec.specialistType ||
      spec.proficiencyName ||
      (spec.level != null ? game.i18n.format("ACKS-HENCHMEN.posting.levelN", { level: spec.level }) : "");
    return detail ? `${kind}: ${detail}` : kind;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const t = now();

    context.actor = actor;
    context.system = sys;
    context.isGM = game.user.isGM;
    context.hasMarket = sys.hasMarket;
    // Owners may run due processing (idempotent) so arrivals reveal
    // without waiting on a GM click; the clock itself is the GM's.
    context.canProcess = game.user.isGM || actor.testUserPermission(game.user, "OWNER");

    // A place is its identity, its nesting and its contents first; the market
    // is a specialisation, prepared only where there is one.
    await this.#preparePlace(context);
    if (sys.hasMarket) this.#prepareMarket(context, t);
    if (sys.hasMarket) await this.#prepareTrade(context);

    // Tabs: labels carry live counts. The market tabs exist only where there is
    // a market, and the GM tabs only for GMs.
    context.tabs = this.#prepareVisibleTabs(context);
    await this.#prepareStorage(context);

    const tabCounts = {
      contents: context.contentRows.length + context.occupants.length,
      recruitment:
        (context.postings?.filter((p) => p.isActive).length ?? 0) +
        (context.directedRows?.length ?? 0) +
        (context.specialHires?.length ?? 0),
      henchmen: context.henchmenRows?.length ?? 0,
      mercenaries: context.mercenaryRows?.length ?? 0,
      specialists: context.specialistRows?.length ?? 0,
      trade: context.tradeRows?.length ?? 0,
      storage: context.groups.length,
    };
    for (const [id, tab] of Object.entries(context.tabs)) {
      const base = game.i18n.localize(`ACKS-HENCHMEN.location.tab.${id}`);
      tab.label = tabCounts[id] != null ? `${base} (${tabCounts[id]})` : base;
    }
    return context;
  }

  /**
   * Which tabs this viewer gets, and a guarantee that one of them is active.
   *
   * That guarantee is the whole reason this is not three `delete` lines. The
   * active tab is remembered per application instance (`this.tabGroups`), so a
   * GM who was on Recruitment when the market was removed — or a player opening
   * a sheet whose remembered tab is a GM one — would otherwise be left with
   * every tab inactive, which renders as a sheet with a nav bar and no body.
   */
  #prepareVisibleTabs(context) {
    const tabs = this._prepareTabs("primary");
    if (!context.hasMarket) for (const id of MARKET_TABS) delete tabs[id];
    if (!game.user.isGM) {
      delete tabs.gmSettings;
      delete tabs.gmView;
    }
    if (!Object.values(tabs).some((tab) => tab.active)) {
      const fallback = tabs.contents ?? Object.values(tabs)[0];
      if (fallback) {
        this.tabGroups.primary = fallback.id;
        for (const tab of Object.values(tabs)) {
          tab.active = tab.id === fallback.id;
          tab.cssClass = tab.active ? "active" : "";
        }
      }
    }
    return tabs;
  }

  /**
   * The place half: where it sits, what is in it, who is in it.
   *
   * One `allPlaces()` scan is taken here and threaded through every call that
   * needs it — the breadcrumb, the children, and the coin roll-up would
   * otherwise each re-scan `game.actors` on every render.
   */
  async #preparePlace(context) {
    const actor = this.actor;
    const nodes = places.allPlaces();
    const index = places.indexPlaces(nodes);

    // Breadcrumb: root first, this place last. The last entry is dropped —
    // the sheet's own title already says where you are.
    context.breadcrumb = places
      .placePath(actor.uuid, index)
      .slice(0, -1)
      .map((node) => ({ uuid: node.uuid, name: node.name }));
    context.parentName = context.breadcrumb.at(-1)?.name ?? null;

    // Contents: sub-places first, then goods. `contentRows` folds a container
    // item and a sub-location into one row shape, which is what makes a chest
    // the trivial case of a town rather than a separate list.
    context.contentRows = places.contentRows(actor, nodes).map((row) => ({
      ...row,
      icon: row.isPlace ? (row.kind === "container" ? "fa-box" : "fa-map-location-dot") : "fa-cube",
    }));

    // Occupants: the stored roster, plus whoever is standing on the linked
    // scene, filtered to what this viewer may see (place-logic.mjs owns the
    // order of those three steps — getting it wrong leaks or loses rows).
    const scene = actor.system.sceneUuid ? this.#linkedScene() : null;
    const ownedUuids = game.user.isGM
      ? []
      : game.actors.filter((a) => a.testUserPermission(game.user, "OWNER")).map((a) => a.uuid);
    context.occupants = places
      .rosterFor(actor, { scene, isGM: game.user.isGM, ownedUuids })
      .map((row) => ({
        ...row,
        kindLabel: game.i18n.localize(`${LANG_PREFIX}.occupant.kind.${row.kind}`),
        // A row whose actor is gone is shown struck through rather than dropped:
        // "the garrison used to be here" is a fact the GM should act on, not one
        // the sheet should quietly erase. `fromUuidSync` THROWS on a uuid into an
        // unloaded compendium, so it cannot be called bare on a render path.
        missing: !LocationSheet.#exists(row.uuid),
      }));
    context.headcount = places.headcount(context.occupants);

    context.scene = scene ? { uuid: scene.uuid, name: scene.name, active: scene.active } : null;
    context.stackCount = actor.system.instanceCount;
    context.isStacked = context.stackCount > 1;
    context.coinRollupGC = places.coinRollupGC(actor, nodes);
  }

  /** Does this uuid still resolve? Never throws — render paths cannot afford it. */
  static #exists(uuid) {
    try {
      return !!fromUuidSync(uuid);
    } catch {
      return false;
    }
  }

  /** The scene this place is, or null when the link is dead. */
  #linkedScene() {
    const uuid = this.actor.system.sceneUuid;
    if (!uuid) return null;
    try {
      const scene = fromUuidSync(uuid);
      return scene?.documentName === "Scene" ? scene : null;
    } catch {
      return null;
    }
  }

  /** Everything the four market tabs render. Only called when there IS a market. */
  #prepareMarket(context, t) {
    const actor = this.actor;
    const sys = actor.system;
    // "Not stuck" visibility: current market week + when the next whole-
    // market roll lands (a late-month board is quiet by RAW, not stalled).
    if (sys.monthAnchorTime) {
      context.marketWeek = Math.max(1, Math.floor((t - sys.monthAnchorTime) / SECONDS_PER_WEEK) + 1);
      const next = nextMarketRollTime(sys.monthAnchorTime, t);
      context.nextRollDays = next ? Math.max(0, Math.ceil((next - t) / SECONDS_PER_DAY)) : null;
    }
    context.marketClass = sys.marketClass;
    context.marketClassRoman = ["I", "II", "III", "IV", "V", "VI"][sys.marketClass - 1];
    context.searchFeeFormula = (() => {
      try {
        return getTable("availability", "searchFees").byMarketClass[String(sys.marketClass)];
      } catch {
        return "";
      }
    })();
    context.marketClassSource = sys.market?.marketClassOverride
      ? game.i18n.localize("ACKS-HENCHMEN.location.sourceOverride")
      : sys.market?.urbanFamilies != null
        ? game.i18n.localize("ACKS-HENCHMEN.location.sourceFamilies")
        : game.i18n.localize("ACKS-HENCHMEN.location.sourceDefault");
    context.rarityVariants = Object.entries(optTable("rarity", "classRarityTables")?.variants ?? {}).map(([id, v]) => ({
      id,
      label: game.i18n.localize(v.label),
      selected: id === sys.market?.classRarityTableId,
    }));
    context.cultureOptions = Object.entries(optTable("people", "cultures")?.list ?? {}).map(([id, c]) => ({
      id,
      label: c.label,
    }));
    context.demographics = (sys.demographics ?? []).map((d, index) => ({
      ...(d.toObject?.() ?? d),
      index,
    }));

    const candidates = (sys.candidates ?? []).map((c) => c.toObject?.() ?? c);
    const postings = (sys.postings ?? []).map((p) => p.toObject?.() ?? p);

    // --- The market: shared monthly pools ---
    context.marketPools = (sys.marketRolls ?? []).map((r) => {
      const roll = r.toObject?.() ?? r;
      const mine = candidates.filter((c) => c.segment === roll.segment);
      const week = Math.max(1, Math.floor((t - roll.monthStartTime) / SECONDS_PER_WEEK) + 1);
      return {
        ...roll,
        label: this.#segmentLabel(roll.segment),
        week,
        arrived: mine.filter((c) => c.status === "available").reduce((s, c) => s + (c.quantity ?? 1), 0),
        pending: mine.filter((c) => c.status === "pending").reduce((s, c) => s + (c.quantity ?? 1), 0),
        hired: mine.filter((c) => c.status === "hired").reduce((s, c) => s + (c.quantity ?? 1), 0),
      };
    });

    // --- Paid searches ---
    const myActorUuids = game.user.isGM
      ? []
      : game.actors.filter((a) => a.testUserPermission(game.user, "OWNER")).map((a) => a.uuid);
    context.postings = postings.map((p) => {
      let employer = null;
      try {
        employer = p.employerUuid ? fromUuidSync(p.employerUuid) : null;
      } catch {
        /* unresolved */
      }
      const lied = p.presentedLevel != null && employer && p.presentedLevel !== (employer.system?.details?.level ?? null);
      return {
        ...p,
        specLabel: this.#specLabel(p.spec),
        employerName: employer?.name ?? "",
        feesTotal: (p.feesPaid ?? []).reduce((s, f) => s + f.gp, 0),
        statusLabel: game.i18n.localize(`ACKS-HENCHMEN.posting.status.${p.status}`),
        isActive: p.status === "active",
        isPrivate: !p.segment,
        isMine: game.user.isGM || myActorUuids.includes(p.employerUuid),
        liedLevel: game.user.isGM && lied ? p.presentedLevel : null,
      };
    });

    // --- Candidates: visibility per paid-search coverage ---
    const visibility = game.settings.get(MODULE_ID, "playerMarketVisibility");
    const ownedUuids = game.user.isGM
      ? []
      : game.actors.filter((a) => a.testUserPermission(game.user, "OWNER")).map((a) => a.uuid);
    // A posting covers its shared segment; the GENERAL henchman post
    // ("henchman:*", the option players buy) covers every henchman level.
    const coveredSegments = new Set();
    let coversAllHenchmen = false;
    for (const p of postings) {
      if (p.status !== "active") continue;
      if (!(game.user.isGM || ownedUuids.includes(p.employerUuid))) continue;
      if (p.segment === "henchman:*") coversAllHenchmen = true;
      else if (p.segment) coveredSegments.add(p.segment);
    }
    const maskedSegments = new Set(
      postings.filter((p) => p.segment && p.playersSeeDetails === false).map((p) => p.segment)
    );
    // A viewer's own active DIRECTED (private, no shared segment) searches
    // reveal every matching available candidate to them and route it to the
    // SPECIAL bucket — not only the ones the replacement mechanic converted.
    // GM sees everything already, so this is a player-facing reveal. This only
    // ADDS visibility and re-buckets the same rows: it can never hide a
    // candidate (the "blank everything" regression).
    const myDirectedSpecs = game.user.isGM
      ? []
      : postings
          .filter((p) => p.status === "active" && !p.segment && ownedUuids.includes(p.employerUuid))
          .map((p) => p.spec?.toObject?.() ?? p.spec ?? {});
    const matchesMyDirected = (c) => myDirectedSpecs.some((s) => directedSpecMatches(s, c));
    const playerVisible = (c) => {
      if (game.user.isGM) return true;
      if (c.privateToUuid) return ownedUuids.includes(c.privateToUuid) && ["available", "hired"].includes(c.status);
      if (!["available", "hired"].includes(c.status)) return false;
      // A replaced candidate is always visible to the recruiter whose
      // directed search found them (highlighted, month-long).
      if (c.highlightFor && ownedUuids.includes(c.highlightFor)) return true;
      // My directed search reveals every available candidate it matches.
      if (matchesMyDirected(c)) return true;
      if (visibility === "none") return false;
      if (visibility === "all") return true;
      if (String(c.segment ?? "").startsWith("henchman:") && coversAllHenchmen) return true;
      return coveredSegments.has(c.segment);
    };

    const cultures = optTable("people", "cultures")?.list ?? {};
    const henchKinds = ["henchman", "henchmanByClass", "henchmanByProficiency"];
    const rows = candidates
      .filter(playerVisible)
      .filter((c) => game.user.isGM || c.status !== "withdrawn")
      .map((c) => {
        const masked = !game.user.isGM && c.segment && maskedSegments.has(c.segment);
        const isHench = henchKinds.includes(c.kind);
        let identityLine = "";
        if (!masked) {
          if (isHench) {
            identityLine = [c.level != null ? `L${c.level}` : "", c.classKey, c.occupation]
              .filter(Boolean)
              .join(" · ");
            if (c.notes) identityLine = [identityLine, c.notes].filter(Boolean).join(" · ");
          } else if (c.kind === "specialist") {
            identityLine = game.i18n.localize(`ACKS-HENCHMEN.specialist.${c.specialistType}`);
          }
        }
        return {
          ...c,
          name: masked ? game.i18n.localize("ACKS-HENCHMEN.candidate.masked") : c.name,
          cultureLabel: masked ? "" : (cultures[c.culture]?.label ?? c.culture ?? ""),
          identityLine,
          appearanceTip: masked
            ? ""
            : [
                c.appearance,
                c.hitDice ? game.i18n.format("ACKS-HENCHMEN.candidate.hitDice", { hd: c.hitDice }) : "",
                c.profCount != null ? game.i18n.format("ACKS-HENCHMEN.candidate.profCount", { count: c.profCount }) : "",
              ]
                .filter(Boolean)
                .join(" — "),
          isAggregate: (c.quantity ?? 1) > 1,
          isPrivate: !!c.privateToUuid,
          // replaced-by-your-search: highlighted for that recruiter (and GM)
          isHighlighted: !!c.highlightFor && (game.user.isGM || ownedUuids.includes(c.highlightFor)),
          refusalCount: (c.refusals ?? []).length,
          statusLabel: game.i18n.localize(`ACKS-HENCHMEN.candidate.status.${c.status}`),
          isAvailable: c.status === "available",
        };
      })
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "available" ? -1 : 1));
    // The SPECIAL bucket holds everything a viewer's directed searches reveal:
    // candidates claimed privately (replacements), those highlighted for them,
    // AND every available candidate their active class/proficiency search
    // matches — even walk-ins the search did not convert. A row lands in the
    // special bucket OR a normal one, never both, so nothing is dropped.
    const isDirectedRow = (c) => c.isPrivate || c.isHighlighted || matchesMyDirected(c);
    context.directedRows = rows.filter(isDirectedRow);
    context.henchmenRows = rows.filter((c) => henchKinds.includes(c.kind) && !isDirectedRow(c));
    context.mercenaryRows = rows.filter((c) => c.kind === "mercenary" && !isDirectedRow(c));
    context.specialistRows = rows.filter((c) => c.kind === "specialist" && !isDirectedRow(c));
    context.candidateCount = rows.length - context.directedRows.length;

    // Special hires: real actors placed by the GM (no time limit unless
    // set) or found on adventures (until hired that month, RAW default).
    context.specialHires = (sys.specialHires ?? [])
      .map((s) => s.toObject?.() ?? s)
      .filter((s) => game.user.isGM || s.status === "available")
      .map((s) => ({
        ...s,
        originLabel: game.i18n.localize(`ACKS-HENCHMEN.special.origin.${s.origin}`),
        statusLabel: game.i18n.localize(`ACKS-HENCHMEN.special.status.${s.status}`),
        isAvailable: s.status === "available",
        refusalCount: (s.refusals ?? []).length,
        limitLabel:
          s.expiresTime > 0
            ? game.i18n.format("ACKS-HENCHMEN.special.daysLeft", {
                days: Math.max(0, Math.ceil((s.expiresTime - t) / SECONDS_PER_DAY)),
              })
            : game.i18n.localize("ACKS-HENCHMEN.special.noLimit"),
      }));

    context.slander = (sys.slander ?? []).map((s, index) => ({ ...(s.toObject?.() ?? s), index }));
    context.ledger = (sys.searchLedger ?? []).slice(-20).reverse();
    context.ledgerTotal = (sys.searchLedger ?? []).reduce((s, l) => s + l.gp, 0);
    // Market ledger (rollback record) — newest first, day-stamped.
    context.marketLog = (sys.marketLog ?? [])
      .map((l) => l.toObject?.() ?? l)
      .slice(-30)
      .reverse()
      .map((l) => ({
        ...l,
        typeLabel: game.i18n.localize(`ACKS-HENCHMEN.marketLog.${l.type}`),
        when: game.i18n.format("ACKS-HENCHMEN.marketLog.day", { day: Math.floor(l.time / SECONDS_PER_DAY) }),
      }));
  }

  /** DragDrop instances for the declared configs; _onRender only re-binds them. */
  #dragDrop;

  /**
   * Candidate-list ergonomics for big markets: a text filter and
   * click-to-sort headers, both pure DOM (no re-render, keeps the sheet
   * snappy at Class I scale).
   * @override
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;

    // The GM-only permission gates the bind itself: a player's demographics
    // block gets no drop handlers at all.
    this.#dragDrop ??= (this.options.dragDrop ?? []).map(
      (config) =>
        new foundry.applications.ux.DragDrop.implementation({
          ...config,
          permissions: { drop: () => game.user.isGM },
          callbacks: { drop: (ev) => this.#onDropDemographics(ev) },
        })
    );
    for (const dragDrop of this.#dragDrop) dragDrop.bind(root);

    // One filter per candidate tab, scoped to its own tables.
    root.querySelectorAll("[data-candidate-filter]").forEach((filterInput) => {
      const scope = filterInput.closest(".tab") ?? root;
      filterInput.addEventListener("input", () => {
        const needle = filterInput.value.trim().toLowerCase();
        scope.querySelectorAll(".candidates-table tbody tr").forEach((tr) => {
          tr.style.display = !needle || tr.textContent.toLowerCase().includes(needle) ? "" : "none";
        });
      });
    });

    root.querySelectorAll(".candidates-table th[data-sortable]").forEach((th) => {
      th.addEventListener("click", () => {
        const table = th.closest("table");
        const tbody = table.querySelector("tbody");
        const index = [...th.parentElement.children].indexOf(th);
        const ascending = th.dataset.sortDir !== "asc";
        table.querySelectorAll("th[data-sortable]").forEach((h) => delete h.dataset.sortDir);
        th.dataset.sortDir = ascending ? "asc" : "desc";
        const rows = [...tbody.querySelectorAll("tr")];
        rows.sort((a, b) => {
          const av = a.children[index]?.textContent.trim() ?? "";
          const bv = b.children[index]?.textContent.trim() ?? "";
          const an = parseFloat(av);
          const bn = parseFloat(bv);
          const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv);
          return ascending ? cmp : -cmp;
        });
        rows.forEach((r) => tbody.appendChild(r));
      });
    });
  }

  /**
   * Indexed form arrays (slander rows, demographics rows) arrive as
   * numeric-keyed objects; rebuild them, merging over stored rows.
   * @override
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    for (const path of ["system.market.slander", "system.market.demographics"]) {
      const submitted = foundry.utils.getProperty(data, path);
      if (submitted && !Array.isArray(submitted)) {
        const existing = (foundry.utils.getProperty(this.actor, path) ?? []).map((s) => s.toObject?.() ?? s);
        const merged = Object.entries(submitted)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([index, row]) => ({ ...(existing[Number(index)] ?? {}), ...row }));
        foundry.utils.setProperty(data, path, merged);
      }
    }
    return data;
  }

  #posting(target) {
    const id = target.closest("[data-posting-id]")?.dataset.postingId;
    return (this.actor.system.postings ?? []).find((p) => p.id === id);
  }

  #candidate(target) {
    const id = target.closest("[data-candidate-id]")?.dataset.candidateId;
    return (this.actor.system.candidates ?? []).find((c) => c.id === id);
  }

  async #updatePosting(id, changes) {
    const postings = (this.actor.system.postings ?? []).map((p) => {
      const obj = p.toObject?.() ?? foundry.utils.deepClone(p);
      return obj.id === id ? { ...obj, ...changes } : obj;
    });
    await this.actor.update({ "system.market.postings": postings });
  }

  static async #onCreatePosting() {
    openPostingDialog(this.actor);
  }

  static async #onProcessNow() {
    const { arrived } = await processLocation(this.actor);
    ui.notifications.info(game.i18n.format("ACKS-HENCHMEN.location.processed", { arrived }));
  }

  /**
   * Reload — re-load the persisted rules tables into the registry and re-render,
   * to recover a board that reads empty because of a render / registry glitch
   * (the data is still stored; the display or its labels failed). It does NOT
   * roll the market — that is Process time. Client-local, so any viewer may run
   * it; no location write.
   */
  static async #onReloadMarket() {
    const result = await reloadMarket();
    // Force a full re-render: recovers a sheet that blanked when the registry
    // lost its tables — the persisted market and its labels reappear.
    await this.render(true);
    if (!result.tablesPresent) {
      ui.notifications.error(game.i18n.localize("ACKS-HENCHMEN.location.reloadNoTables"));
    } else {
      ui.notifications.info(
        game.i18n.format("ACKS-HENCHMEN.location.reloaded", { layers: result.reloaded?.layers ?? 0 })
      );
    }
  }

  static async #onAdvanceWeek() {
    await advanceDays(7);
  }

  /** Take a notice down. Players relay through the GM socket (they cannot
   *  write the location actor); ownership of the posting is enforced there. */
  static async #onClosePosting(_event, target) {
    const posting = this.#posting(target);
    if (!posting) return;
    // Local-first: location owners (players on an OWNER-default bulletin
    // board) close directly; only permission-less seats relay.
    if (game.user.isGM || this.actor.testUserPermission(game.user, "OWNER")) {
      await closePosting(this.actor, posting.id, { requestUserId: game.user.isGM ? null : game.user.id });
    } else {
      await executeAsGM("closePosting", {
        locationUuid: this.actor.uuid,
        postingId: posting.id,
        requestUserId: game.user.id,
      });
    }
  }

  static async #onTogglePlayerDetails(_event, target) {
    const posting = this.#posting(target);
    if (posting) await this.#updatePosting(posting.id, { playersSeeDetails: !posting.playersSeeDetails });
  }

  static async #onRecruit(_event, target) {
    const candidate = this.#candidate(target);
    if (candidate) openRecruitDialog(this.actor, candidate.id);
  }

  /** Assemble available troops + an officer into one acks-lib.group. */
  static async #onHireGroup() {
    await openHireGroupDialog(this.actor);
  }

  /**
   * Dropping an actor: WHERE it lands decides what it means.
   *
   * On the recruitment tab a dropped NPC is somebody the party can hire — the
   * behaviour this sheet has always had. Anywhere else it is somebody who is
   * simply HERE: the innkeeper, the garrison, the stabled mule. Both readings
   * are obviously right in their own tab and obviously wrong in the other, so
   * the drop target arbitrates rather than a modifier key nobody would find.
   *
   * Dropping a LOCATION re-parents it — that is nesting, and it goes through
   * the cycle guard.
   */
  async _onDropActor(event, actor) {
    if (!actor) return;
    if (actor.uuid === this.actor.uuid) return;

    // A LOCATION dropped on a location is nesting, whichever tab it lands on.
    // Deliberately narrower than `isPlace`: a pack mule someone enabled storage
    // on is a provider too, and dropping it here means "the mule is standing in
    // the stable", not "the stable now contains the mule as a sub-place".
    if (places.isLocation(actor)) {
      if (!game.user.isGM) return;
      await places.setParent(actor, this.actor.uuid);
      this.render();
      return;
    }

    const tab = event?.target?.closest?.(".tab")?.dataset?.tab ?? this.tabGroups.primary;
    if (tab === "recruitment" && this.actor.system.hasMarket) {
      if (!game.user.isGM) return;
      const existing = this.actor.system.specialHires.find(
        (s) => s.actorUuid === actor.uuid && s.status === "available"
      );
      if (existing) {
        ui.notifications.info(game.i18n.format("ACKS-HENCHMEN.special.already", { name: actor.name }));
        return;
      }
      await addSpecialHire(this.actor, actor, { origin: "gm" });
      ui.notifications.info(game.i18n.format("ACKS-HENCHMEN.special.added", { name: actor.name }));
      return;
    }

    // Anywhere else: this actor is here. Ownership is recorded so a player's
    // own stabled horse stays visible to them even on a GM-hidden roster.
    if (!this.actor.isOwner) return;
    const added = await places.addOccupant(this.actor, actor, {
      ownerUuid: game.user.isGM ? "" : (game.user.character?.uuid ?? ""),
    });
    if (added) ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.place.occupantAdded`, { name: actor.name }));
    this.render();
  }

  /**
   * Core's `_onDropDocument` switches on documentName and has cases for
   * ActiveEffect, Actor, Item and Folder only — a dropped Scene falls through
   * to `null` and nothing happens. Adding the one case is what makes
   * drag-a-scene-onto-a-place work at all.
   * @override
   */
  async _onDropDocument(event, document) {
    if (document?.documentName === "Scene") return (await this._onDropScene(event, document)) ?? null;
    return super._onDropDocument(event, document);
  }

  /** Dropping a SCENE on a place links the map to it (GM only). */
  async _onDropScene(_event, scene) {
    if (!game.user.isGM || !scene) return;
    await scene.setFlag(MODULE_ID, SCENE_LINK_FLAG, this.actor.uuid);
    await this.actor.update({ "system.sceneUuid": scene.uuid });
    ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.place.sceneLinked`, { name: scene.name }));
    this.render();
  }

  #specialHire(target) {
    const id = target.closest("[data-special-id]")?.dataset.specialId;
    return (this.actor.system.specialHires ?? []).find((s) => s.id === id);
  }

  static async #onRecruitSpecial(_event, target) {
    const entry = this.#specialHire(target);
    if (entry) openRecruitSpecial(this.actor, entry.id);
  }

  static async #onRemoveSpecial(_event, target) {
    const entry = this.#specialHire(target);
    if (!entry) return;
    const entries = (this.actor.system.specialHires ?? [])
      .map((s) => s.toObject?.() ?? s)
      .filter((s) => s.id !== entry.id);
    await this.actor.update({ "system.market.specialHires": entries });
  }

  /** GM: set/clear a decision time limit (in days from now; 0 = none). */
  static async #onSetSpecialLimit(_event, target) {
    const entry = this.#specialHire(target);
    if (!entry) return;
    const days = await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: game.i18n.format("ACKS-HENCHMEN.special.limitTitle", { name: entry.name }) },
      content: `<input type="number" name="days" min="0" step="1" placeholder="${game.i18n.localize("ACKS-HENCHMEN.special.limitPlaceholder")}" />`,
      ok: { callback: (_e, button) => button.form.elements.days.value },
    }).catch(() => null);
    if (days === null) return;
    const n = Math.max(0, Number(days) || 0);
    await updateSpecialHire(this.actor, entry.id, { expiresTime: n > 0 ? now() + n * SECONDS_PER_DAY : 0 });
  }

  static async #onRemoveCandidate(_event, target) {
    const candidate = this.#candidate(target);
    if (!candidate) return;
    const candidates = (this.actor.system.candidates ?? [])
      .map((c) => c.toObject?.() ?? c)
      .filter((c) => c.id !== candidate.id);
    await this.actor.update({ "system.market.candidates": candidates });
  }

  static async #onAddSlander() {
    const slander = [
      ...(this.actor.system.slander ?? []).map((s) => s.toObject?.() ?? s),
      { subject: { scope: "all", uuid: "" }, npcName: "", time: now(), note: "" },
    ];
    await this.actor.update({ "system.market.slander": slander });
    Hooks.callAll(HOOKS.SLANDER_CHANGED, { location: this.actor });
  }

  static async #onRemoveSlander(_event, target) {
    const index = Number(target.closest("[data-slander-index]")?.dataset.slanderIndex);
    const slander = (this.actor.system.slander ?? []).map((s) => s.toObject?.() ?? s).filter((_, i) => i !== index);
    await this.actor.update({ "system.market.slander": slander });
    Hooks.callAll(HOOKS.SLANDER_CHANGED, { location: this.actor });
  }

  static async #onAddDemographic() {
    const demographics = [
      ...(this.actor.system.demographics ?? []).map((d) => d.toObject?.() ?? d),
      { culture: "auran", weight: 1 },
    ];
    await this.actor.update({ "system.market.demographics": demographics });
  }

  static async #onRemoveDemographic(_event, target) {
    const index = Number(target.closest("[data-demographic-index]")?.dataset.demographicIndex);
    const demographics = (this.actor.system.demographics ?? [])
      .map((d) => d.toObject?.() ?? d)
      .filter((_, i) => i !== index);
    await this.actor.update({ "system.market.demographics": demographics });
  }

  /** Drop a RollTable on the demographics block → set the culture mix. */
  async #onDropDemographics(event) {
    // Without this the drop bubbles to the sheet root, where ActorSheetV2's own
    // DragDrop would treat it as a document drop on the actor.
    event.stopPropagation();
    const dropData = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (dropData?.type !== "RollTable") return;
    const table = await fromUuid(dropData.uuid).catch(() => null);
    if (!table) return;
    const cultures = optTable("people", "cultures")?.list ?? {};
    const byLabel = Object.fromEntries(
      Object.entries(cultures).map(([id, c]) => [String(c.label ?? id).toLowerCase(), id])
    );
    const demographics = [];
    const unknown = [];
    for (const r of table.results) {
      const text = String(r.description ?? r.text ?? "").trim();
      const key = text.toLowerCase();
      const culture = cultures[key] ? key : byLabel[key];
      const [min, max] = r.range ?? [];
      const weight = Number(r.weight) || (Number.isFinite(min) && Number.isFinite(max) ? max - min + 1 : 1);
      if (!culture) {
        unknown.push(text);
        continue;
      }
      demographics.push({ culture, weight });
    }
    if (!demographics.length) {
      ui.notifications.warn(game.i18n.format("ACKS-HENCHMEN.location.mixNoCultures", { name: table.name }));
      return;
    }
    await this.actor.update({ "system.market.demographics": demographics });
    ui.notifications.info(
      game.i18n.format("ACKS-HENCHMEN.location.mixApplied", { name: table.name, n: demographics.length }) +
        (unknown.length ? " " + game.i18n.format("ACKS-HENCHMEN.location.mixUnknown", { list: unknown.join(", ") }) : "")
    );
  }

  /** Export the current culture mix as a prefilled world RollTable. */
  static async #onExportDemographics() {
    const cultures = optTable("people", "cultures")?.list ?? {};
    const demographics = (this.actor.system.demographics ?? []).map((d) => d.toObject?.() ?? d);
    const rows = demographics.length
      ? demographics
      : Object.keys(cultures).map((id) => ({ culture: id, weight: 1 }));
    let at = 0;
    const results = rows.map((d) => {
      const w = Math.max(1, Number(d.weight) || 1);
      const range = [at + 1, at + w];
      at += w;
      return { text: cultures[d.culture]?.label ?? d.culture, weight: w, range };
    });
    const table = await RollTable.create({
      name: game.i18n.format("ACKS-HENCHMEN.location.mixTableName", { name: this.actor.name }),
      formula: `1d${Math.max(1, at)}`,
      description: game.i18n.localize("ACKS-HENCHMEN.location.mixTableHint"),
      results,
    });
    ui.notifications.info(game.i18n.format("ACKS-HENCHMEN.location.mixExported", { name: table.name }));
    table.sheet.render(true);
  }

  /* ====================================================================== */
  /*  Contents tab — nesting, occupancy, stacking, and the map.             */
  /* ====================================================================== */

  /** Open a sub-place, a parent, or a stored container. */
  static async #onOpenPlace(_event, target) {
    const uuid = target.closest("[data-place-uuid]")?.dataset.placeUuid;
    if (!uuid) return;
    const doc = await fromUuid(uuid).catch(() => null);
    doc?.sheet?.render(true);
  }

  /** Lift a sub-place out to the root — the undo for a wrong drop. */
  static async #onDetachPlace(_event, target) {
    const uuid = target.closest("[data-place-uuid]")?.dataset.placeUuid;
    const child = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (child) await places.setParent(child, null);
    this.render();
  }

  /** Make a new place inside this one — the ordinary way to build a hierarchy. */
  static async #onAddChildPlace() {
    const name = await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("place.newChildTitle") },
      content: `<input type="text" name="name" value="${game.i18n.localize(`${LANG_PREFIX}.place.newChildDefault`)}" />`,
      ok: { callback: (_e, button) => button.form.elements.name.value },
    }).catch(() => null);
    if (!name) return;
    const child = await Actor.create({
      name,
      type: LOCATION_TYPE,
      img: "icons/svg/house.svg",
      // Inherit the parent's ownership: a room in an inn the party owns is
      // theirs too, and making them ask for each one would be busywork.
      ownership: this.actor.toObject().ownership,
      system: { parentUuid: this.actor.uuid },
    });
    child?.sheet?.render(true);
    this.render();
  }

  static async #onRemoveOccupant(_event, target) {
    const uuid = target.closest("[data-occupant-uuid]")?.dataset.occupantUuid;
    if (uuid) await places.removeOccupant(this.actor, uuid);
    this.render();
  }

  /**
   * Promote a DERIVED row (someone standing on the linked scene) into a stored
   * one. Deliberately explicit: a party crossing a map must not silently take up
   * residence in it, so the observation only becomes a record when asked.
   */
  static async #onKeepOccupant(_event, target) {
    const uuid = target.closest("[data-occupant-uuid]")?.dataset.occupantUuid;
    const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (actor) await places.addOccupant(this.actor, actor.actor ?? actor);
    this.render();
  }

  static async #onToggleOccupantHidden(_event, target) {
    if (!game.user.isGM) return;
    const uuid = target.closest("[data-occupant-uuid]")?.dataset.occupantUuid;
    const rows = (this.actor.system.roster ?? []).map((r) => r.toObject?.() ?? r);
    const row = rows.find((r) => r.uuid === uuid);
    if (!row) return;
    row.hidden = !row.hidden;
    await this.actor.update({ "system.roster": rows });
  }

  /** Split one instance out of a stacked place (eight bays → seven + one). */
  static async #onSplitStack() {
    const made = await places.splitPlace(this.actor, 1);
    if (made) {
      ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.place.split`, { name: made.name }));
      made.sheet?.render(true);
    }
    this.render();
  }

  static async #onOpenScene() {
    const scene = await fromUuid(this.actor.system.sceneUuid).catch(() => null);
    scene?.view?.();
  }

  /** Break the scene link from the place side. The scene's flag is authoritative,
   *  so BOTH ends are cleared — clearing only the mirror would let the scene
   *  re-assert the link on its next render. */
  static async #onUnlinkScene() {
    const scene = await fromUuid(this.actor.system.sceneUuid).catch(() => null);
    if (scene) await scene.unsetFlag(MODULE_ID, SCENE_LINK_FLAG).catch(() => null);
    await this.actor.update({ "system.sceneUuid": "" });
    this.render();
  }

  /* ---------------------------- the market gate ------------------------- */

  /**
   * The trade half of the market: the catalog (built once per sheet open,
   * refreshed by render), each row's live availability for the viewer's
   * character, the party's month state, and the demand modifiers where the
   * viewer may see them. All engine logic lives in the markets feature.
   */
  async #prepareTrade(context) {
    const goods = this.actor.system.market.goods;
    this._tradeCatalog ??= await buildCatalog(this.actor);
    const trader =
      game.user.character ??
      game.actors.find((a) => a.type === ACTOR_TYPE.character && a.testUserPermission(game.user, "OWNER")) ??
      null;
    context.tradeActor = trader;
    context.tradeRows = this._tradeCatalog.map((row) => {
      const avail = availabilityFor(this.actor, { itemName: row.name, costGp: row.costGp, trader });
      return {
        ...row,
        availability: avail,
        availabilityLabel: game.i18n.format(`ACKS-MARKETS.availability.${avail.status}`, avail),
        canBuy: avail.status === "available" || avail.status === "pending",
      };
    });
    context.masterworkContact = !!goods.masterworkContact;
    context.extendedSearchOn = game.settings.get(MODULE_ID, "marketsExtendedSearch");
    const seeDemand = context.isGM || goods.playersSeeDemand;
    context.demandRows = seeDemand
      ? (goods.demand ?? []).map((d) => ({
          label: game.i18n.localize(merchandiseLabel(d.category)),
          modifier: d.modifier > 0 ? `+${d.modifier}` : `${d.modifier}`,
        }))
      : [];
  }

  /** Open the purchase dialog for a catalog row. */
  static async #onOpenPurchase(_event, target) {
    const key = target?.dataset?.key;
    const row = (this._tradeCatalog ?? []).find((r) => r.key === key);
    if (row) openPurchaseDialog(this.actor, row);
  }

  /** Spend a further dedicated day searching this market. */
  static async #onMarketsSearchDay(_event, _target) {
    const trader =
      game.user.character ??
      game.actors.find((a) => a.type === ACTOR_TYPE.character && a.testUserPermission(game.user, "OWNER"));
    if (!trader) return;
    const result = await performSearchDay(this.actor, { actorUuid: trader.uuid });
    if (result?.error) {
      ui.notifications.warn(game.i18n.localize(`ACKS-MARKETS.trade.error.${result.error}`));
      return;
    }
    if (result?.ok) {
      ui.notifications.info(game.i18n.format("ACKS-MARKETS.trade.searchDaySpent", { days: result.days }));
      this.render();
    }
  }

  /** GM gate: whether masterwork gear has a contact at this market (RR §IV.6). */
  static async #onToggleMasterworkContact() {
    if (!game.user.isGM) return;
    const current = !!this.actor.system.market.goods.masterworkContact;
    await this.actor.update({ "system.market.goods.masterworkContact": !current });
    this._tradeCatalog = null;
    this.render();
  }

  /**
   * Give this place a market. One write of a fully-defaulted subtree — until
   * now `system.market` was literally null, which is what kept a cave from
   * carrying a recruitment schema it would never use.
   */
  static async #onAddMarket() {
    if (!game.user.isGM || this.actor.system.hasMarket) return;
    await this.actor.update({ "system.market": emptyMarket() });
    this.tabGroups.primary = "recruitment";
    this.render();
  }

  /**
   * Take the market away — and say plainly what that discards, because it
   * discards a great deal: every posting, candidate, slander entry and fee
   * ledger line goes with it. Hired people are real actors and are untouched.
   */
  static async #onRemoveMarket() {
    if (!game.user.isGM || !this.actor.system.hasMarket) return;
    const sys = this.actor.system;
    const tally = [
      { n: sys.postings.length, key: "postings" },
      { n: sys.candidates.length, key: "candidates" },
      { n: sys.specialHires.length, key: "specialHires" },
      { n: sys.slander.length, key: "slander" },
    ].filter((row) => row.n > 0);
    const detail = tally.length
      ? `<ul>${tally.map((row) => `<li>${row.n} × ${game.i18n.localize(`${LANG_PREFIX}.place.discard.${row.key}`)}</li>`).join("")}</ul>`
      : `<p>${game.i18n.localize(`${LANG_PREFIX}.place.discardNothing`)}</p>`;
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: game.i18n.format(`${LANG_PREFIX}.place.removeMarketTitle`, { name: this.actor.name }) },
      content: `<p>${game.i18n.localize(`${LANG_PREFIX}.place.removeMarketWarn`)}</p>${detail}`,
    }).catch(() => false);
    if (!ok) return;
    await this.actor.update({ "system.market": null });
    this.tabGroups.primary = "contents";
    this.render();
  }

  /* ====================================================================== */
  /*  Storage tab — what is KEPT here, as opposed to who is hired here.      */
  /*  Was a separate sheet on a separate `location` sub-type until the merge. */
  /* ====================================================================== */

  /** Goods grouped by whose they are, plus what this user may do with them. */
  async #prepareStorage(context) {
    const api = storage();
    const actor = this.actor;
    // Enriched for display only; the raw text is what the notes editor edits
    // (its `value`). Never reach for the bare `TextEditor` global — v14 serves
    // it from foundry.applications.ux and the global is deprecated.
    context.notesHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actor.system.notes ?? "",
      { relativeTo: actor },
    );
    context.vaultOwner = api.resolveActorSync(api.vaultOwnerUuid(actor))?.name ?? null;
    // The characters this user could stash FROM — the deposit button is
    // pointless (and its dialog empty) without one.
    context.canDeposit = game.actors.some((a) => a.type === ACTOR_TYPE.character && a.isOwner);

    const groups = [];
    for (const bucket of api.storesByOwner(actor).values()) {
      const owner = api.resolveActorSync(bucket.ownerUuid);
      groups.push({
        ownerUuid: bucket.ownerUuid,
        // A deleted owner keeps their name on the goods — that is exactly why
        // the name is stored alongside the uuid. The GM's manager reassigns it.
        name: owner?.name || bucket.ownerName || loc("storage.unattributed"),
        dangling: !owner,
        canTake: game.user.isGM || !!owner?.isOwner,
        coinGC: api.coinTotalGC(bucket.items),
        rows: bucket.items.map((item) => ({
          id: item._id,
          name: item.name,
          img: item.img,
          type: item.type,
          quantity: api.quantityOf(item)?.value ?? null,
          stackable: !!api.quantityOf(item),
        })),
      });
    }
    groups.sort((a, b) => a.name.localeCompare(b.name));
    context.groups = groups;
    context.storageEmpty = !groups.length;
  }

  /** The character this user is taking goods back to. */
  #claimant(ownerUuid) {
    const owner = storage().resolveActorSync(ownerUuid);
    if (owner?.isOwner) return owner;
    if (!game.user.isGM) return null;
    // A GM claiming for a deleted owner has nowhere to send the goods; the
    // manager's reassign is the cure, so say that rather than failing silently.
    return owner ?? null;
  }

  #rowContext(target) {
    const row = target.closest("[data-item-id]");
    const group = target.closest("[data-owner-uuid]");
    return { itemId: row?.dataset.itemId ?? null, ownerUuid: group?.dataset.ownerUuid ?? "" };
  }

  static async #onRetrieveRow(_event, target) {
    const { itemId, ownerUuid } = this.#rowContext(target);
    const owner = this.#claimant(ownerUuid);
    if (!itemId) return;
    if (!owner) {
      ui.notifications.warn(loc("storage.noClaimant"));
      return;
    }
    const input = target.closest(".acks-location-row")?.querySelector("input[data-quantity]");
    const quantity = input?.value === "" || input == null ? null : Number(input.value);
    await storage().retrieve(this.actor, owner, [{ id: itemId, quantity }]);
    this.render();
  }

  static async #onRetrieveAll(_event, target) {
    const ownerUuid = target.closest("[data-owner-uuid]")?.dataset.ownerUuid ?? "";
    const owner = this.#claimant(ownerUuid);
    if (!owner) {
      ui.notifications.warn(loc("storage.noClaimant"));
      return;
    }
    const spec = storage()
      .storedItems(this.actor, { ownerUuid })
      .map((i) => ({ id: i.id }));
    if (!spec.length) return;
    await storage().retrieve(this.actor, owner, spec);
    this.render();
  }

  static async #onDepositHere() {
    const mine = game.actors.filter((a) => a.type === ACTOR_TYPE.character && a.isOwner);
    if (!mine.length) {
      ui.notifications.warn(loc("storage.noCharacter"));
      return;
    }
    await openStashDialog(mine, this.actor);
    this.render();
  }

  static async #onOpenManager() {
    const { openStorageManager } = await import("./storage-manager.mjs");
    openStorageManager(this.actor);
  }

  static async #onOpenOwner(_event, target) {
    const uuid = target.closest("[data-owner-uuid]")?.dataset.ownerUuid;
    storage().resolveActorSync(uuid)?.sheet?.render(true);
  }

  /**
   * Dropping an item from another actor STORES it here — a real move, not the
   * system's copy. Core's drop handler creates on the target and never deletes
   * from the source, which for a location would quietly duplicate the party's
   * gear, so this path never falls through to it.
   */
  async _onDropItem(event, item) {
    const source = item?.parent;
    if (!source || source.documentName !== "Actor") {
      // A compendium or sidebar item is not anybody's property yet, and every
      // stored row is filed under an owner. Refusing is the whole handling:
      // dropping such an item on the actor by other routes (the directory)
      // embeds it WITHOUT the storage flag, and `storedItems` lists only
      // flagged rows — so it would sit on the place invisibly. Stocking a
      // place means giving the goods to a character and stowing them.
      ui.notifications.warn(loc("storage.dropNeedsOwner"));
      return null;
    }
    if (source.uuid === this.actor.uuid) return null;
    await storage().stash(source, this.actor, [{ id: item.id }]);
    this.render();
    return null;
  }
}

/** Register the one sheet for the one `location` sub-type. */
export function registerLocationSheet() {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, LocationSheet, {
    types: [LOCATION_TYPE],
    makeDefault: true,
    label: `${LANG_PREFIX}.sheet.location`,
  });
}
