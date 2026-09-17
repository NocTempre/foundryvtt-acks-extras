/* global game, ui, foundry, fromUuid, fromUuidSync, Actor */
/**
 * FactionSheet — ActorSheetV2 for the `acks-extras.faction` sub-type.
 *
 * Five tabs. OVERVIEW is what the organisation is and holds: its kind, its
 * seat, the other places it keeps, its leader, the organisation it belongs to,
 * and the quarters it controls. MEMBERS is the roster — drag an actor onto the
 * sheet. RELATIONS is whom it deals with: its own stance toward other
 * organisations, the reverse view of what they say about it, and its totals
 * per subject, so one tab answers how it stands toward an organisation, a
 * character and a party alike. STANDING is the Judge's ledger: rows about a
 * party, a character or an organisation, each with a value and a reason,
 * totalled per subject. NOTES is the shared record, and for the Judge the
 * private one beside it.
 *
 * Drops are read by what is dropped and by the tab showing: a place seats the
 * organisation or joins its holdings, a faction becomes a relation, a ledger
 * row or the parent, anyone else joins the membership or opens a ledger row.
 *
 * Array rows are rewritten whole on every edit. A schema array cannot be
 * patched by index through the form, so the row controls carry no `name` and
 * answer to their own change listeners, which stop the event before the form's
 * submit-on-change sees it.
 */
import { MODULE_ID, LANG_PREFIX, FACTION_TYPE, FACTION_KINDS, RELATION_STANCES, STANDING_SOURCES, SUBJECT_SCOPES } from "../constants.mjs";
import {
  addHolding, addStanding, allFactions, isFaction, regardedByFactions, removeHolding, removeRelation, removeStanding,
  setRelation,
} from "../standing.mjs";
import { factionRecord, wouldCycleFaction } from "../standing-logic.mjs";
import { indexPlaces } from "../../lib/place-logic.mjs";
import { isLocation, occupantRow } from "../../lib/place.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { DISTRICT_TYPE } from "../../formation/district-zone.mjs";
import { readFormations } from "../../formation/formation-model.mjs";
import { SECONDS_PER_DAY } from "../../henchmen/constants.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const loc = makeLoc(LANG_PREFIX);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * The document a uuid names, or null. Never throws: `fromUuidSync` raises on a
 * uuid into an unloaded compendium, and a render path cannot afford it.
 */
function docOf(uuid) {
  try {
    return uuid ? (fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
}

/** A `{uuid, name, missing}` reference for a stored uuid, or null for none. */
function refOf(uuid) {
  if (!uuid) return null;
  const doc = docOf(uuid);
  return { uuid, name: doc?.name ?? uuid, missing: !doc };
}

/**
 * Every quarter drawn as a District in the world, as picker options:
 * `{uuid, label}` with the scene named before the region.
 */
export function districtRegionOptions() {
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const region of scene.regions ?? []) {
      if (!region.behaviors.some((b) => b.type === DISTRICT_TYPE)) continue;
      out.push({ uuid: region.uuid, label: `${scene.name} › ${region.name}` });
    }
  }
  return out;
}

export class FactionSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-faction-sheet"],
    position: { width: 680, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      openDoc: FactionSheet.#onOpenDoc,
      clearSeat: FactionSheet.#onClearSeat,
      clearLeader: FactionSheet.#onClearLeader,
      addControl: FactionSheet.#onAddControl,
      removeControl: FactionSheet.#onRemoveControl,
      removeMember: FactionSheet.#onRemoveMember,
      toggleMemberHidden: FactionSheet.#onToggleMemberHidden,
      addStanding: FactionSheet.#onAddStanding,
      removeStanding: FactionSheet.#onRemoveStanding,
      addRelation: FactionSheet.#onAddRelation,
      removeRelation: FactionSheet.#onRemoveRelation,
      toggleRelationHidden: FactionSheet.#onToggleRelationHidden,
      removeHolding: FactionSheet.#onRemoveHolding,
      toggleHoldingHidden: FactionSheet.#onToggleHoldingHidden,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/factions/faction-sheet.hbs`, scrollable: [""] },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "overview", icon: "fas fa-flag" },
        { id: "members", icon: "fas fa-user-group" },
        { id: "relations", icon: "fas fa-handshake" },
        { id: "standing", icon: "fas fa-scale-balanced" },
        { id: "notes", icon: "fas fa-book" },
      ],
      initial: "overview",
      labelPrefix: `${LANG_PREFIX}.sheet.tab`,
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const isGM = game.user.isGM;
    context.actor = actor;
    context.system = sys;
    context.isGM = isGM;
    context.tabs = this._prepareTabs("primary");
    for (const [id, tab] of Object.entries(context.tabs)) tab.label = game.i18n.localize(`${LANG_PREFIX}.sheet.tab.${id}`);

    const opt = (value, label, selected) => ({ value, label, selected });
    context.kindOptions = FACTION_KINDS.map((k) => opt(k, loc(`kind.${k}`), k === sys.kind));
    context.kindLabel = loc(`kind.${sys.kind}`);
    // Relations and holdings are the Judge's record like the ledger: a player
    // who can open the sheet reads them and does not write them.
    context.canCurate = isGM && this.isEditable;

    // The subject's own name while it exists; the name stamped on the row is
    // what is left to read once it does not.
    const liveName = (uuid) => docOf(uuid)?.name ?? "";

    // What it holds.
    context.seat = refOf(sys.seatUuid);
    context.leader = refOf(sys.leaderUuid);
    context.parent = refOf(sys.parentUuid);
    // The parent picker offers every other faction that would not close a
    // loop: a chapter cannot belong to its own lodge.
    const index = indexPlaces(allFactions().map(factionRecord));
    context.parentOptions = [
      opt("", loc("sheet.none"), !sys.parentUuid),
      ...allFactions()
        .filter((f) => f.uuid !== actor.uuid && !wouldCycleFaction(actor.uuid, f.uuid, index))
        .map((f) => opt(f.uuid, f.name, f.uuid === sys.parentUuid)),
    ];
    const held = new Set(sys.controls ?? []);
    context.controls = (sys.controls ?? []).map((uuid) => {
      const region = fromUuidSync(uuid);
      const scene = region?.parent;
      return { uuid, label: region ? `${scene?.name ?? ""} › ${region.name}` : uuid, missing: !region };
    });
    context.districtOptions = districtRegionOptions().filter((o) => !held.has(o.uuid));

    // The other places it is behind the door of. A hidden holding is a Judge's
    // own — a safehouse is not on the guild's public list.
    context.holdings = (sys.holdings ?? [])
      .map((r) => r.toObject?.() ?? r)
      .filter((row) => isGM || !row.hidden)
      .map((row) => ({ ...row, name: liveName(row.uuid) || row.name || row.uuid, missing: !docOf(row.uuid) }));

    // Relations: its own stance toward each other organisation, then the
    // reverse view. The picker offers every other faction it has no row about.
    const listed = new Set((sys.relations ?? []).map((r) => r.uuid));
    context.relations = (sys.relations ?? [])
      .map((r) => r.toObject?.() ?? r)
      .filter((row) => isGM || !row.hidden)
      .map((row) => ({
        ...row,
        name: liveName(row.uuid) || row.name || row.uuid,
        missing: !docOf(row.uuid),
        stanceLabel: loc(`stance.${row.stance}`),
        stanceOptions: RELATION_STANCES.map((s) => opt(s, loc(`stance.${s}`), s === row.stance)),
      }));
    context.relationOptions = allFactions()
      .filter((f) => f.uuid !== actor.uuid && !listed.has(f.uuid))
      .map((f) => ({ uuid: f.uuid, label: f.name }));
    context.regardedBy = regardedByFactions(actor)
      .filter((row) => isGM || !row.hidden)
      .map((row) => ({ ...row, stanceLabel: loc(`stance.${row.stance}`) }));

    // Members: the stored rows, with a live check that the actor still exists.
    context.members = (sys.members ?? [])
      .map((r) => r.toObject?.() ?? r)
      .filter((row) => isGM || !row.hidden)
      .map((row) => ({
        ...row,
        missing: !fromUuidSync(row.uuid),
        kindLabel: game.i18n.localize(`ACKS-LOCATION.occupant.kind.${row.kind}`),
      }));
    context.headcount = sys.headcount;

    // The ledger, and the running total per subject.
    const subjectLabel = (subject) => {
      if (subject.scope === "all") return loc("subject.all");
      return liveName(subject.uuid) || subject.name || subject.uuid || loc(`subject.${subject.scope}`);
    };
    const totals = new Map();
    context.standing = (sys.standing ?? []).map((r, index) => {
      const row = r.toObject?.() ?? r;
      const key = `${row.subject.scope}:${row.subject.uuid}`;
      const label = subjectLabel(row.subject);
      const prior = totals.get(key);
      totals.set(key, {
        label,
        scopeLabel: loc(`subject.${row.subject.scope}`),
        value: (prior?.value ?? 0) + (Number(row.value) || 0),
        wanted: (prior?.wanted ?? false) || row.source === "wanted",
      });
      return {
        index,
        subjectLabel: label,
        scopeLabel: loc(`subject.${row.subject.scope}`),
        value: row.value,
        valueClass: row.value > 0 ? "is-good" : row.value < 0 ? "is-bad" : "",
        signed: row.value > 0 ? `+${row.value}` : `${row.value}`,
        reason: row.reason,
        sourceLabel: loc(`source.${row.source}`),
        wanted: row.source === "wanted",
        day: Math.floor((Number(row.time) || 0) / SECONDS_PER_DAY),
      };
    });
    context.totals = [...totals.values()].map((t) => ({
      ...t,
      signed: t.value > 0 ? `+${t.value}` : `${t.value}`,
      valueClass: t.value > 0 ? "is-good" : t.value < 0 ? "is-bad" : "",
    }));
    context.wantedCount = (sys.standing ?? []).filter((r) => r.source === "wanted").length;

    const enrich = (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo: actor });
    context.notesHTML = await enrich(sys.notes);
    context.gmNotesHTML = isGM ? await enrich(sys.gmNotes) : "";
    return context;
  }

  /* -------------------------------------------- */
  /*  Drops                                        */
  /* -------------------------------------------- */

  /** @override */
  async _onDropActor(event, actor) {
    if (!actor || actor.uuid === this.actor.uuid || !this.isEditable) return;
    const tab = event?.target?.closest?.(".tab")?.dataset?.tab ?? this.tabGroups.primary;
    // A place takes the seat when it is dropped on the seat row or when there
    // is no seat yet, and otherwise joins the holdings — never both, so the
    // same roof is never counted twice.
    if (isLocation(actor)) {
      if (event?.target?.closest?.('[data-drop-zone="seat"]') || !this.actor.system.seatUuid) return this.#setSeat(actor);
      return this.#addHolding(actor);
    }
    // An organisation is read by the tab showing: whom we deal with, what the
    // ledger says about them, or whom we answer to.
    if (isFaction(actor)) {
      if (tab === "relations") return this.#addRelation(actor);
      if (tab === "standing") return this.#promptStanding(actor);
      return this.#setParent(actor);
    }
    if (event?.target?.closest?.('[data-drop-zone="leader"]')) {
      await this.actor.update({ "system.leaderUuid": actor.uuid });
      return;
    }
    if (tab === "standing") return this.#promptStanding(actor);
    await this.#addMember(actor);
  }

  async #setSeat(place) {
    await this.actor.update({ "system.seatUuid": place.uuid });
    ui.notifications.info(loc("sheet.seated", { name: place.name }));
  }

  /** Put a place on the holdings. A place already held is a no-op, not a duplicate. */
  async #addHolding(place) {
    if (await addHolding(this.actor, place)) {
      ui.notifications.info(loc("sheet.holdingAdded", { name: place.name }));
      return;
    }
    if (!game.user.isGM) ui.notifications.warn(loc("sheet.judgeOnly"));
  }

  /** Open a relation with another organisation, at neutral. A second drop is a no-op. */
  async #addRelation(faction) {
    if (this.actor.system.relationTo(faction.uuid)) return;
    if (await setRelation(this.actor, faction, { stance: "neutral" })) {
      ui.notifications.info(loc("sheet.relationAdded", { name: faction.name }));
      return;
    }
    if (!game.user.isGM) ui.notifications.warn(loc("sheet.judgeOnly"));
  }

  async #setParent(faction) {
    const index = indexPlaces(allFactions().map(factionRecord));
    if (wouldCycleFaction(this.actor.uuid, faction.uuid, index)) {
      ui.notifications.warn(loc("sheet.cycle", { name: faction.name }));
      return;
    }
    await this.actor.update({ "system.parentUuid": faction.uuid });
  }

  /** Put an actor on the membership. A second drop is a no-op, not a duplicate. */
  async #addMember(actor) {
    const rows = (this.actor.system.members ?? []).map((r) => r.toObject?.() ?? r);
    if (rows.some((r) => r.uuid === actor.uuid)) return;
    await this.actor.update({ "system.members": [...rows, occupantRow(actor)] });
    ui.notifications.info(loc("sheet.joined", { name: actor.name }));
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static async #onOpenDoc(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const doc = await fromUuid(uuid).catch(() => null);
    doc?.sheet?.render(true);
  }

  static async #onClearSeat() {
    await this.actor.update({ "system.seatUuid": "" });
  }

  static async #onClearLeader() {
    await this.actor.update({ "system.leaderUuid": "" });
  }

  static async #onAddControl() {
    const uuid = this.element.querySelector('[name="controlPick"]')?.value;
    if (!uuid) return;
    const held = [...(this.actor.system.controls ?? [])];
    if (held.includes(uuid)) return;
    await this.actor.update({ "system.controls": [...held, uuid] });
  }

  static async #onRemoveControl(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const held = (this.actor.system.controls ?? []).filter((u) => u !== uuid);
    await this.actor.update({ "system.controls": held });
  }

  static async #onRemoveMember(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const rows = (this.actor.system.members ?? []).map((r) => r.toObject?.() ?? r).filter((r) => r.uuid !== uuid);
    await this.actor.update({ "system.members": rows });
  }

  static async #onToggleMemberHidden(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const rows = (this.actor.system.members ?? []).map((r) => r.toObject?.() ?? r)
      .map((r) => (r.uuid === uuid ? { ...r, hidden: !r.hidden } : r));
    await this.actor.update({ "system.members": rows });
  }

  static async #onAddRelation() {
    const uuid = this.element.querySelector('[name="relationPick"]')?.value;
    const other = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (other) await this.#addRelation(other);
  }

  static async #onRemoveRelation(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    await removeRelation(this.actor, uuid);
  }

  static async #onToggleRelationHidden(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    await this.#writeRelation(uuid, { hidden: !this.actor.system.relationTo(uuid)?.hidden });
  }

  static async #onRemoveHolding(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    await removeHolding(this.actor, uuid);
  }

  static async #onToggleHoldingHidden(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const rows = (this.actor.system.holdings ?? []).map((r) => r.toObject?.() ?? r)
      .map((r) => (r.uuid === uuid ? { ...r, hidden: !r.hidden } : r));
    await this.actor.update({ "system.holdings": rows });
  }

  /**
   * @override
   * The per-row controls of the two schema arrays bind here rather than to the
   * form: they carry no `name`, because a form patch of an array field would
   * rewrite it by index.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const el of this.element.querySelectorAll("[data-row-field]")) {
      el.addEventListener("change", (event) => this.#onRowField(event));
    }
  }

  /**
   * One field of one row of `system.relations` or `system.holdings`. The event
   * is stopped so the form's submit-on-change does not race this write with a
   * stale form snapshot.
   */
  async #onRowField(event) {
    event.stopPropagation();
    const target = event.currentTarget;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const [array, field] = String(target.dataset.rowField ?? "").split(".");
    if (!uuid || !field) return;
    if (array === "relations") return this.#writeRelation(uuid, { [field]: target.value });
    if (array !== "holdings") return;
    const rows = (this.actor.system.holdings ?? []).map((r) => r.toObject?.() ?? r)
      .map((r) => (r.uuid === uuid ? { ...r, [field]: target.value } : r));
    await this.actor.update({ "system.holdings": rows });
  }

  /**
   * Change one relation row through the feature's writer, so the name is
   * refreshed and the relations hook fires from the one place that fires it.
   * A row whose organisation is gone is struck through and can only be
   * removed — there is no document left to write it against.
   */
  async #writeRelation(uuid, changes) {
    const other = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (other) await setRelation(this.actor, other, changes);
  }

  static async #onAddStanding() {
    await this.#promptStanding(null);
  }

  static async #onRemoveStanding(_event, target) {
    const index = Number(target.closest("[data-index]")?.dataset.index);
    await removeStanding(this.actor, index);
  }

  /**
   * The ledger-row dialog: who it is about (everyone, a party, a character or
   * another organisation), how much, where it came from, and why. `preset` is
   * an actor dropped on the Standing tab, offered as the subject.
   */
  async #promptStanding(preset) {
    if (!game.user.isGM) return;
    const parties = Object.values(readFormations())
      .filter((f) => f?.actorId)
      .map((f) => ({ uuid: `Actor.${f.actorId}`, name: f.name || docOf(`Actor.${f.actorId}`)?.name || f.actorId }));
    const characters = (game.actors ?? []).filter((a) => a.type === "character").map((a) => ({ uuid: a.uuid, name: a.name }));
    const factions = allFactions().filter((f) => f.uuid !== this.actor.uuid).map((f) => ({ uuid: f.uuid, name: f.name }));
    const presetFaction = preset && isFaction(preset) ? factions.find((f) => f.uuid === preset.uuid) : null;
    const presetParty = preset && !presetFaction ? parties.find((p) => p.uuid === preset.uuid) : null;
    const presetScope = presetFaction ? "faction" : presetParty ? "party" : preset ? "character" : (parties.length ? "party" : "character");
    if (preset && !presetFaction && !presetParty && !characters.some((c) => c.uuid === preset.uuid)) {
      characters.unshift({ uuid: preset.uuid, name: preset.name });
    }
    const options = (list, selected) => list.map((o) => `<option value="${esc(o.uuid)}"${o.uuid === selected ? " selected" : ""}>${esc(o.name)}</option>`).join("");
    const scopeOptions = SUBJECT_SCOPES.map((s) => `<option value="${s}"${s === presetScope ? " selected" : ""}>${esc(loc(`subject.${s}`))}</option>`).join("");
    const sourceOptions = STANDING_SOURCES.map((s) => `<option value="${s}"${s === "manual" ? " selected" : ""}>${esc(loc(`source.${s}`))}</option>`).join("");
    const content = `
      <div class="form-group"><label>${esc(loc("standing.about"))}
        <select name="scope">${scopeOptions}</select></label></div>
      <div class="form-group"><label>${esc(loc("subject.party"))}
        <select name="party">${options(parties, presetParty?.uuid)}</select></label></div>
      <div class="form-group"><label>${esc(loc("subject.character"))}
        <select name="character">${options(characters, preset?.uuid)}</select></label></div>
      <div class="form-group"><label>${esc(loc("subject.faction"))}
        <select name="faction">${options(factions, presetFaction?.uuid)}</select></label></div>
      <div class="form-group"><label>${esc(loc("standing.value"))}
        <input type="number" name="value" value="0" step="1"></label></div>
      <div class="form-group"><label>${esc(loc("standing.source"))}
        <select name="source">${sourceOptions}</select></label></div>
      <div class="form-group"><label>${esc(loc("standing.reason"))}
        <input type="text" name="reason" value=""></label></div>`;
    const row = await foundry.applications.api.DialogV2.prompt({
      window: { title: loc("standing.addTitle", { name: this.actor.name }) },
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      content,
      ok: {
        callback: (_event, button) => {
          const f = button.form.elements;
          const scope = f.scope.value;
          const picker = { party: f.party, character: f.character, faction: f.faction }[scope];
          const uuid = picker?.value ?? "";
          return { subject: { scope, uuid }, value: f.value.value, source: f.source.value, reason: f.reason.value.trim() };
        },
      },
    }).catch(() => null);
    if (!row) return;
    if (row.subject.scope !== "all" && !row.subject.uuid) {
      ui.notifications.warn(loc("standing.noSubject"));
      return;
    }
    await addStanding(this.actor, row);
  }
}

/** Register the sheet as the default for the faction sub-type (called from init). */
export function registerFactionSheet() {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FactionSheet, {
    types: [FACTION_TYPE],
    makeDefault: true,
    label: `${LANG_PREFIX}.sheet.name`,
  });
}
