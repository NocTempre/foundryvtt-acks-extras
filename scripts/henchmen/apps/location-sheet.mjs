/* global game, ui, foundry, fromUuidSync, fromUuid, RollTable, TextEditor, Hooks, CONST */
/**
 * LocationSheet — ActorSheetV2 for the `acks-henchmen.location` sub-type.
 *
 * Sections: market settings + demographics, THE MARKET (the location's
 * shared monthly pools — availability belongs to the town, RR 162), paid
 * searches (postings), candidates (unique individuals), slander registry,
 * fee ledger. Players with OBSERVER permission see the candidates their
 * paid searches cover; GMs see everything.
 */
import { MODULE_ID, HOOKS, SECONDS_PER_DAY, SECONDS_PER_WEEK } from "../constants.mjs";
import { getTable, optTable } from "../rules/tables.mjs";
import { processLocation, closePosting, reloadMarket } from "../engine/recruitment.mjs";
import { executeAsGM } from "../sockets.mjs";
import { addSpecialHire, updateSpecialHire } from "../engine/hire.mjs";
import { openPostingDialog } from "./posting-dialog.mjs";
import { openRecruitDialog, openRecruitSpecial } from "./recruit-dialog.mjs";
import { openHireGroupDialog } from "./hire-group-dialog.mjs";
import { now, advanceDays, nextMarketRollTime } from "../time.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

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
    classes: ["acks-ui", "acks-henchmen", "location-sheet"],
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
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/henchmen/location-sheet.hbs` },
  };

  /** Sheet tabs (user direction 2026-07-22: tabs, not one long page). */
  static TABS = {
    primary: {
      tabs: [
        { id: "recruitment", icon: "fas fa-scroll" },
        { id: "henchmen", icon: "fas fa-user-group" },
        { id: "mercenaries", icon: "fas fa-shield-halved" },
        { id: "specialists", icon: "fas fa-user-gear" },
        { id: "gmSettings", icon: "fas fa-gears" },
        { id: "gmView", icon: "fas fa-eye" },
      ],
      initial: "recruitment",
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
    // Owners may run due processing (idempotent) so arrivals reveal
    // without waiting on a GM click; the clock itself is the GM's.
    context.canProcess = game.user.isGM || actor.testUserPermission(game.user, "OWNER");
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
    context.marketClassSource = sys.marketClassOverride
      ? game.i18n.localize("ACKS-HENCHMEN.location.sourceOverride")
      : sys.urbanFamilies != null
        ? game.i18n.localize("ACKS-HENCHMEN.location.sourceFamilies")
        : game.i18n.localize("ACKS-HENCHMEN.location.sourceDefault");
    context.rarityVariants = Object.entries(optTable("rarity", "classRarityTables")?.variants ?? {}).map(([id, v]) => ({
      id,
      label: game.i18n.localize(v.label),
      selected: id === sys.classRarityTableId,
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
    context.market = (sys.marketRolls ?? []).map((r) => {
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

    // Tabs: labels carry live counts; the GM tabs exist only for GMs.
    context.tabs = this._prepareTabs("primary");
    if (!game.user.isGM) {
      delete context.tabs.gmSettings;
      delete context.tabs.gmView;
    }
    const tabCounts = {
      recruitment: context.postings.filter((p) => p.isActive).length + context.directedRows.length + (context.specialHires?.length ?? 0),
      henchmen: context.henchmenRows.length,
      mercenaries: context.mercenaryRows.length,
      specialists: context.specialistRows.length,
    };
    for (const [id, tab] of Object.entries(context.tabs)) {
      const base = game.i18n.localize(`ACKS-HENCHMEN.location.tab.${id}`);
      tab.label = tabCounts[id] != null ? `${base} (${tabCounts[id]})` : base;
    }
    return context;
  }

  /**
   * Candidate-list ergonomics for big markets: a text filter and
   * click-to-sort headers, both pure DOM (no re-render, keeps the sheet
   * snappy at Class I scale).
   * @override
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;

    // Culture mix by drag-and-drop: drop a RollTable of cultures on the
    // demographics block to SET this town's mix (result text = culture,
    // weight = result weight/range width). The exported mix round-trips.
    const demoBlock = root.querySelector(".demographics-block");
    if (demoBlock && game.user.isGM) {
      demoBlock.addEventListener("dragover", (ev) => ev.preventDefault());
      demoBlock.addEventListener("drop", (ev) => this.#onDropDemographics(ev));
    }

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
    for (const path of ["system.slander", "system.demographics"]) {
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
    await this.actor.update({ "system.postings": postings });
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

  /** GM drag-drop: register a dropped actor as a special hire. */
  async _onDropActor(_event, actor) {
    if (!game.user.isGM || !actor) return;
    if (actor.type === `${MODULE_ID}.location`) return;
    const existing = (this.actor.system.specialHires ?? []).find(
      (s) => s.actorUuid === actor.uuid && s.status === "available"
    );
    if (existing) {
      ui.notifications.info(game.i18n.format("ACKS-HENCHMEN.special.already", { name: actor.name }));
      return;
    }
    await addSpecialHire(this.actor, actor, { origin: "gm" });
    ui.notifications.info(game.i18n.format("ACKS-HENCHMEN.special.added", { name: actor.name }));
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
    await this.actor.update({ "system.specialHires": entries });
  }

  /** GM: set/clear a decision time limit (in days from now; 0 = none). */
  static async #onSetSpecialLimit(_event, target) {
    const entry = this.#specialHire(target);
    if (!entry) return;
    const days = await foundry.applications.api.DialogV2.prompt({
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
    await this.actor.update({ "system.candidates": candidates });
  }

  static async #onAddSlander() {
    const slander = [
      ...(this.actor.system.slander ?? []).map((s) => s.toObject?.() ?? s),
      { subject: { scope: "all", uuid: "" }, npcName: "", time: now(), note: "" },
    ];
    await this.actor.update({ "system.slander": slander });
    Hooks.callAll(HOOKS.SLANDER_CHANGED, { location: this.actor });
  }

  static async #onRemoveSlander(_event, target) {
    const index = Number(target.closest("[data-slander-index]")?.dataset.slanderIndex);
    const slander = (this.actor.system.slander ?? []).map((s) => s.toObject?.() ?? s).filter((_, i) => i !== index);
    await this.actor.update({ "system.slander": slander });
    Hooks.callAll(HOOKS.SLANDER_CHANGED, { location: this.actor });
  }

  static async #onAddDemographic() {
    const demographics = [
      ...(this.actor.system.demographics ?? []).map((d) => d.toObject?.() ?? d),
      { culture: "auran", weight: 1 },
    ];
    await this.actor.update({ "system.demographics": demographics });
  }

  static async #onRemoveDemographic(_event, target) {
    const index = Number(target.closest("[data-demographic-index]")?.dataset.demographicIndex);
    const demographics = (this.actor.system.demographics ?? [])
      .map((d) => d.toObject?.() ?? d)
      .filter((_, i) => i !== index);
    await this.actor.update({ "system.demographics": demographics });
  }

  /** Drop a RollTable on the demographics block → set the culture mix. */
  async #onDropDemographics(event) {
    event.preventDefault();
    event.stopPropagation();
    let dropData;
    try {
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
      dropData = TE.getDragEventData(event);
    } catch {
      return;
    }
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
    await this.actor.update({ "system.demographics": demographics });
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
}
