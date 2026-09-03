/* global foundry, game, ui, Hooks, canvas, ChatMessage */
/**
 * The ACKS character sheet — this module's own window for a character. Its
 * shape is fixed: the title band is the window header, the art row carries
 * the two rails around the portrait, and everything else is a tab.
 *
 * Three layers, and this file is only the outermost:
 *   snapshot.mjs + tabs/*.mjs   read the actor into plain data
 *   view-model.mjs              decides what the frame shows (pure, tested offline)
 *   sheet.mjs                   binds the decisions to Foundry — the form, the
 *                               actions, the drops, the menus, the window chrome
 *
 * The window chrome is merged into the sheet's own first row exactly as the
 * item sheet does it: the band part renders into the window content and is
 * then MOVED into Foundry's `.window-header`, so the header stays the drag
 * handle and keeps its buttons while the band's name field lives in the form.
 *
 * Registered at ready as the default for `character` (module.mjs); the
 * system's own sheet stays registered and Sheet Config switches back.
 */
import { MODULE_ID, LANG, SHEET_CLASS, SHEET_FLAG, FOLD_FLAG, SUMMON_FLAG, MOVE_MODES, TAB_ORDER } from "./constants.mjs";
import { makeLoc, libStorage } from "../lib/util.mjs";
import { snapshotFrame, sheetFlag, saveLabel, partyOf, summonerOf, henchmanIds, currentScene } from "./snapshot.mjs";
import { buildFrameModel, nextAcMode, togglePin } from "./view-model.mjs";
import { rollInventory, rollById } from "./rolls.mjs";
import { buildEquipmentTab } from "./tabs/equipment.mjs";
import { buildStatsTab } from "./tabs/stats.mjs";
import { buildClassTab } from "./tabs/class.mjs";
import { buildAbilitiesTab } from "./tabs/abilities.mjs";
import { buildMagicTab } from "./tabs/magic.mjs";
import { buildFollowersTab } from "./tabs/followers.mjs";
import { buildNotesTab } from "./tabs/notes.mjs";
import { buildEffectsTab } from "./tabs/effects.mjs";
import { openCoreWindow } from "./core-bridge.mjs";
import { drawItem, sheatheItem, wearItem, removeItem, prepareTorch } from "../equipment/actions.mjs";
import { cycleGrip } from "../equipment/loadout.mjs";
import { cycleStrap } from "../equipment/overlays/shield-variants.mjs";
import { declareLightAction, lightTypeOf } from "../equipment/sheet.mjs";
import { takeOut, storeIn, setConcealed, setLocked, setOpened, emptyContainer, containedIn, isContainer } from "../equipment/containers.mjs";
import { pickLock, bashOpen } from "../equipment/locks.mjs";
import { annotateItem } from "../equipment/api.mjs";
import { splitOne } from "../equipment/item-sheet/stack.mjs";
import { isEquippable, isGoods } from "../lib/item-model.mjs";
import { openClassPicker } from "../classes/assign-app.mjs";
import { openLevelUp } from "../classes/levelup.mjs";
import { reopenChargen } from "../classes/reopen-chargen.mjs";
import { setActorPath } from "../classes/paths.mjs";
import { classForActor } from "../classes/registry.mjs";
import { castingStripElement, restPools } from "../classes/casting.mjs";
import { classModifiersSection } from "../classes/class-modifiers.mjs";
import { toggleTraining } from "../classes/training.mjs";
import { LANGUAGE_ACTIONS } from "../abilities/language-slots.mjs";
import { openRosterApp } from "../henchmen/apps/roster-app.mjs";
import { dismissMonster } from "../henchmen/apps/hirelings-grid.mjs";
import { openLoyaltyRoll } from "../henchmen/engine/events.mjs";
import { openStashDialog } from "../location/apps/stash-dialog.mjs";
import { setPinnedPlace, pinnedPlaces } from "../location/reach.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const T = `modules/${MODULE_ID}/templates/character-sheet`;
/** Every template the body includes as a partial, preloaded at init. */
export const CHARACTER_SHEET_TEMPLATES = Object.freeze([
  "band", "body", "rails", "cell", "folded", "rolls", "abilities", "equipment", "gear-row", "stats", "class", "magic", "followers", "notes", "effects",
].map((n) => `${T}/${n}.hbs`));

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Actions that only LOOK — fold, switch a tab, open a menu or another window,
 * make a roll as the system's own sheet lets an observer — and so stay live
 * on a sheet the viewer cannot edit. DocumentSheetV2 disables every form
 * control on a read-only sheet; these are re-enabled after it does.
 */
const VIEW_ACTIONS = new Set([
  "fold", "goTab", "roll", "moveMenu", "cycleAc", "abilityFilter", "toggleBucket", "formation", "partyMenu", "influence",
  "placeOpen", "itemEdit", "hirelingShow", "relationshipOpen", "classOpen", "effectEdit", "source", "tab",
]);

/** A movement figure in its mode's unit: feet for the round and turn scales, miles for the day. */
const moveFigure = (modeKey, value) => (MOVE_MODES.find((m) => m.key === modeKey)?.unit === "perDay" ? `${value} mi` : `${value}′`);
const enrich = (html, actor) =>
  foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo: actor, secrets: actor.isOwner });

export class AcksCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // no-scroll: this sheet scrolls at its PART root, not at `.window-content`.
    // The shared contract would move the scroller onto `.window-content`, which
    // is not a part — and ApplicationV2 restores scroll per part, so the body's
    // `scrollable: [""]` below would stop working. A sheet whose fields submit
    // on change needs the retention; the scroller lives in styles/character-sheet.css.
    classes: ["acks-ui", "acks-extras", SHEET_CLASS],
    position: { width: 900, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    window: { resizable: true, contentClasses: [`${SHEET_CLASS}__content`] },
    actions: {
      fold: AcksCharacterSheet.#onFold,
      goTab: AcksCharacterSheet.#onGoTab,
      roll: AcksCharacterSheet.#onRoll,
      pinRoll: AcksCharacterSheet.#onPinRoll,
      pinItem: AcksCharacterSheet.#onPinItem,
      influence: AcksCharacterSheet.#onInfluence,
      mortalWounds: AcksCharacterSheet.#onMortalWounds,
      cycleAc: AcksCharacterSheet.#onCycleAc,
      moveMenu: AcksCharacterSheet.#onMoveMenu,
      gripMenu: AcksCharacterSheet.#onGripMenu,
      lightMenu: AcksCharacterSheet.#onLightMenu,
      formation: AcksCharacterSheet.#onFormation,
      partyMenu: AcksCharacterSheet.#onPartyMenu,
      editDescription: AcksCharacterSheet.#onEditDescription,
      changeArt: AcksCharacterSheet.#onChangeArt,
      editTags: AcksCharacterSheet.#onEditTags,
      ownership: AcksCharacterSheet.#onOwnership,
      source: AcksCharacterSheet.#onSource,
      tweaks: AcksCharacterSheet.#onTweaks,
      modifiers: AcksCharacterSheet.#onModifiers,
      generateScores: AcksCharacterSheet.#onGenerateScores,
      rollHitDice: AcksCharacterSheet.#onRollHitDice,
      itemEdit: AcksCharacterSheet.#onItemEdit,
      itemDelete: AcksCharacterSheet.#onItemDelete,
      itemShow: AcksCharacterSheet.#onItemShow,
      itemCreate: AcksCharacterSheet.#onItemCreate,
      itemFavorite: AcksCharacterSheet.#onItemFavorite,
      toggleEquip: AcksCharacterSheet.#onToggleEquip,
      toggleWear: AcksCharacterSheet.#onToggleWear,
      cycleGrip: AcksCharacterSheet.#onCycleGrip,
      cycleStrap: AcksCharacterSheet.#onCycleStrap,
      lightAction: AcksCharacterSheet.#onLightAction,
      readyTorch: AcksCharacterSheet.#onReadyTorch,
      takeOut: AcksCharacterSheet.#onTakeOut,
      splitStack: AcksCharacterSheet.#onSplitStack,
      containerToggle: AcksCharacterSheet.#onContainerToggle,
      containerLock: AcksCharacterSheet.#onContainerLock,
      containerPick: AcksCharacterSheet.#onContainerPick,
      containerBash: AcksCharacterSheet.#onContainerBash,
      containerEmpty: AcksCharacterSheet.#onContainerEmpty,
      annotateAll: AcksCharacterSheet.#onAnnotateAll,
      placeOpen: AcksCharacterSheet.#onPlaceOpen,
      placeDeposit: AcksCharacterSheet.#onPlaceDeposit,
      placeRetrieveAll: AcksCharacterSheet.#onPlaceRetrieveAll,
      placePin: AcksCharacterSheet.#onPlacePin,
      toggleTraining: AcksCharacterSheet.#onToggleTraining,
      toggleBucket: AcksCharacterSheet.#onToggleBucket,
      classPick: AcksCharacterSheet.#onClassPick,
      classReopen: AcksCharacterSheet.#onClassReopen,
      classOpen: AcksCharacterSheet.#onClassOpen,
      levelUp: AcksCharacterSheet.#onLevelUp,
      abilityFilter: AcksCharacterSheet.#onAbilityFilter,
      pickLanguage: AcksCharacterSheet.#onPickLanguage,
      spellCast: AcksCharacterSheet.#onSpellCast,
      spellReset: AcksCharacterSheet.#onSpellReset,
      rest: AcksCharacterSheet.#onRest,
      roster: AcksCharacterSheet.#onRoster,
      payWages: AcksCharacterSheet.#onPayWages,
      hirelingShow: AcksCharacterSheet.#onHirelingShow,
      hirelingLoyalty: AcksCharacterSheet.#onHirelingLoyalty,
      hirelingMorale: AcksCharacterSheet.#onHirelingMorale,
      hirelingDelete: AcksCharacterSheet.#onHirelingDelete,
      editNotes: AcksCharacterSheet.#onEditNotes,
      relationshipOpen: AcksCharacterSheet.#onRelationshipOpen,
      relationshipDelete: AcksCharacterSheet.#onRelationshipDelete,
      effectCreate: AcksCharacterSheet.#onEffectCreate,
      effectToggle: AcksCharacterSheet.#onEffectToggle,
      effectEdit: AcksCharacterSheet.#onEffectEdit,
      effectDelete: AcksCharacterSheet.#onEffectDelete,
      fateAdjust: AcksCharacterSheet.#onFateAdjust,
    },
  };

  static PARTS = {
    band: { template: `${T}/band.hbs` },
    body: { template: `${T}/body.hbs`, scrollable: [""] },
  };

  tabGroups = { primary: "rolls" };

  /** Sheet-local state that survives the re-render every form change causes. */
  #ui = { editingBio: false, editingNotes: false, moveMode: "exploration", abilityFilter: "all", openBuckets: new Set() };

  /** The roll inventory of the last render — what the folded bar and the row ids read against. */
  #rolls = null;

  /** Hook ids for the watch on documents this sheet shows but does not own. */
  #watch = [];

  #renderSoon = foundry.utils.debounce(() => {
    if (this.rendered) this.render();
  }, 60);

  /* -------------------------------------------- */
  /*  State                                        */
  /* -------------------------------------------- */

  /** Is this sheet folded for the viewing user? */
  get folded() {
    return !!game.user.getFlag(MODULE_ID, FOLD_FLAG)?.[this.actor.id];
  }

  /** The hirelings, summons and places this sheet shows off other documents. */
  #related() {
    const ids = new Set(henchmanIds(this.actor));
    for (const p of libStorage()?.providers?.() ?? []) ids.add(p.id);
    for (const t of currentScene()?.tokens ?? []) if (t.actorId && summonerOf(t.actor) === this.actor.uuid) ids.add(t.actorId);
    return ids;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const related = (doc) => doc?.documentName === "Actor" && doc.id !== this.actor.id && this.#related().has(doc.id);
    const watchActor = (doc) => {
      if (related(doc)) this.#renderSoon();
    };
    const watchItem = (doc) => {
      if (related(doc?.parent)) this.#renderSoon();
    };
    const watchMine = (actor) => {
      if (actor?.id === this.actor.id) this.#renderSoon();
    };
    // The party cell counts tokens on the scene, so the scene's tokens, the
    // scene change itself and the formation record all re-count it.
    const watchToken = (doc) => {
      if (doc?.parent?.id === currentScene()?.id) this.#renderSoon();
    };
    const watchSetting = (setting) => {
      if (setting?.key === `${MODULE_ID}.formations`) this.#renderSoon();
    };
    const pairs = [
      ["updateActor", watchActor], ["deleteActor", watchActor],
      ["createItem", watchItem], ["updateItem", watchItem], ["deleteItem", watchItem],
      ["createToken", watchToken], ["updateToken", watchToken], ["deleteToken", watchToken],
      ["canvasReady", () => this.#renderSoon()], ["updateSetting", watchSetting],
      ["acksExtras.lightChanged", watchMine], ["acksExtras.roleChanged", watchMine],
      ["updateCombat", () => this.#renderSoon()], ["deleteCombat", () => this.#renderSoon()],
    ];
    for (const [hook, fn] of pairs) this.#watch.push([hook, Hooks.on(hook, fn)]);
  }

  /** @override */
  async _onClose(options) {
    for (const [hook, id] of this.#watch) Hooks.off(hook, id);
    this.#watch = [];
    await super._onClose(options);
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const editable = this.isEditable;
    const gm = game.user.isGM;
    const folded = this.folded;

    const snap = snapshotFrame(actor);
    const frame = buildFrameModel(snap, {
      isGM: gm,
      editable,
      folded,
      activeTab: this.tabGroups.primary,
      acMode: snap.acMode,
      moveMode: this.#ui.moveMode,
    });
    if (frame.active) this.tabGroups.primary = frame.active;
    this.#decorateFrame(frame, snap);

    const rolls = rollInventory(actor);
    this.#rolls = rolls;

    const tabs = Object.fromEntries(frame.tabs.map((t) => [t.key, t]));
    const panels = {};
    panels.rolls = { columns: this.#rollColumns(rolls.groups) };
    panels.abilities = buildAbilitiesTab(actor, { filter: this.#ui.abilityFilter });
    panels.equipment = buildEquipmentTab(actor);
    panels.stats = buildStatsTab(actor, { openBuckets: this.#ui.openBuckets });
    panels.class = buildClassTab(actor);
    if (tabs.magic) panels.magic = buildMagicTab(actor);
    panels.followers = await buildFollowersTab(actor);
    panels.notes = await buildNotesTab(actor, { editing: this.#ui.editingNotes });
    panels.effects = buildEffectsTab(actor);

    const bio = String(actor.system?.details?.biography ?? "");
    const art = {
      img: actor.img,
      overline: [snap.cls.name, actor.system?.details?.alignment].filter(Boolean).join(" · "),
      prose: await enrich(bio, actor),
      proseSource: bio,
      editing: this.#ui.editingBio,
      tags: [
        actor.system?.details?.alignment ? String(actor.system.details.alignment) : null,
        loc("art.level", { n: snap.cls.level }),
        loc("art.age", { n: num(actor.system?.details?.age) }),
        loc("art.fate", { n: num(actor.system?.details?.fatepoints) }),
      ].filter(Boolean),
    };

    return Object.assign(context, {
      actor,
      editable,
      isGM: gm,
      folded,
      frame,
      cells: this.#railCells(frame),
      cls: snap.cls,
      band: {
        xpLabel: frame.xp.full
          ? loc("band.levelUp", { xp: frame.xp.value })
          : frame.xp.next ? loc("band.xp", { xp: frame.xp.value, next: frame.xp.next }) : loc("band.xpOnly", { xp: frame.xp.value }),
        xpTitle: loc("band.xpTitle"),
        rankTitle: loc("band.rankTitle"),
      },
      art,
      pins: this.#pinBar(rolls, panels.effects),
      panels,
      sheetTools: frame.rails.tools.map((t) => ({ ...t, title: loc(`tools.${t.key}`) })),
    });
  }

  /** The Rolls tab's three columns, as the design lays them out. */
  #rollColumns(groups) {
    const by = Object.fromEntries(groups.map((g) => [g.key, g]));
    return [
      [by.saves, by.initiative, by.retainer].filter(Boolean),
      [by.attack, by.recovery].filter(Boolean),
      [by.adventuring, by.proficiencies].filter(Boolean),
    ];
  }

  /** Tooltips and labels the pure model leaves to the sheet. */
  #decorateFrame(frame, snap) {
    const r = frame.rails;
    for (const cell of r.saves) {
      const name = saveLabel(cell.key);
      const riders = cell.riders.map((x) => `${x.name} · ${x.clock}`).join(", ");
      cell.title = [loc("rail.save", { name, target: cell.target }), riders, cell.sub && !cell.riders.length ? loc("rail.saveMod", { mod: cell.sub }) : ""].filter(Boolean).join(" · ");
      cell.riderImg = cell.riders[0]?.img ?? null;
    }
    r.hp.title = r.hp.zero ? loc("rail.hpZero") : loc("rail.hp", { value: snap.hp.value, max: snap.hp.max });
    r.ac.title = loc(`rail.ac.${r.ac.mode}`, { n: r.ac.n });
    r.move.label = game.i18n.localize(`ACKS.movement.${r.move.key}`);
    r.move.title = loc("rail.move", { mode: r.move.label, value: moveFigure(r.move.key, r.move.value) }) + (r.move.tone ? ` · ${loc(`rail.moveSlowed.${r.move.tone}`)}` : "");
    r.grip.title = r.grip.held
      ? loc("rail.grip", { weapons: snap.grip.weapons.map((w) => w.name).join(", "), cleaves: snap.grip.cleaves })
      : loc("rail.gripEmpty");
    r.light.title = loc(`rail.light.${r.light.key}`, { reach: r.light.sub });
    r.formationTitle = r.formation ? loc("rail.formation", { name: r.formation.name }) : loc("rail.noFormation");
    const party = r.party;
    const facts = snap.party ?? {};
    if (party.mode === "formation") {
      r.partyTitle = loc("rail.formationHere", { name: facts.formation?.name ?? "", n: facts.formation?.membersOnScene ?? 0 });
    } else if (party.mode === "party") {
      r.partyTitle = loc("rail.party", { h: party.hOn, s: party.sOn, scene: facts.scene ?? "" });
      if (facts.formation) r.partyTitle += ` · ${loc("rail.formationElsewhere", { name: facts.formation.name })}`;
    } else {
      r.partyTitle = loc("rail.partyNone");
    }
    if (party.calamity) r.partyTitle += ` · ${loc("rail.partyCalamity", { n: party.calamity })}`;
    r.influenceTitle = loc("rail.influence");
    r.foldTitle = frame.folded ? loc("fold.open") : loc("fold.close");
    for (const t of frame.tabs) {
      t.label = loc(`tab.${t.key}`);
      t.pTitle = t.p ? loc("tab.pending", { n: t.p }) : "";
    }
  }

  /**
   * The two rails as uniform cell objects for the cell partial. The pure
   * model decided the reading; this decides the glyph and the action.
   */
  #railCells(frame) {
    const r = frame.rails;
    const attr = (o) => Object.entries(o).map(([k, v]) => `data-${k}="${foundry.utils.escapeHTML(String(v))}"`).join(" ");
    const HAND = { open: "fa-solid fa-hand", fist: "fa-solid fa-hand-fist", shield: "fa-solid fa-shield-halved" };
    const left = [
      { key: "influence", action: "influence", cls: "is-btn", icon: "fa-solid fa-comments", title: r.influenceTitle },
      ...r.saves.map((c) => ({
        key: `save-${c.key}`,
        action: "roll",
        attrs: attr({ roll: `save:${c.key}` }),
        cls: c.tone ? `is-${c.tone}` : "",
        fill: c.pct,
        title: c.title,
        icon: c.riderImg ? null : c.icon,
        big: !c.sub && !c.riderImg,
        img: c.riderImg,
        sub: c.sub,
        corner: c.riders.length ? c.corner : null,
        count: c.count,
      })),
    ];
    const hp = r.hp.zero
      ? { key: "hp", action: "mortalWounds", cls: "is-bad", title: r.hp.title, inside: { icon: "fa-solid fa-heart", n: r.hp.n } }
      : { key: "hp", action: "goTab", attrs: attr({ tab: "stats" }), cls: r.hp.on ? "is-on" : "", fill: r.hp.pct, title: r.hp.title, inside: { icon: "fa-solid fa-heart", n: r.hp.n } };
    const right = [
      hp,
      {
        key: "ac",
        action: "cycleAc",
        title: r.ac.title,
        inside: r.ac.mode === "none" ? { n: r.ac.n, dash: true } : { icon: r.ac.mode === "shield" ? "fa-solid fa-shield-halved" : "fa-solid fa-shirt", n: r.ac.n },
      },
      { key: "move", action: "moveMenu", cls: r.move.tone ? `is-${r.move.tone}` : "", title: r.move.title, icon: r.move.icon, sub: moveFigure(r.move.key, r.move.value) },
      { key: "grip", action: "gripMenu", cls: r.grip.tone ? `is-${r.grip.tone}` : "", title: r.grip.title, hands: r.grip.hands.map((h) => HAND[h]), joined: r.grip.joined, sub: r.grip.sub },
      { key: "light", action: "lightMenu", cls: r.light.tone ? `is-${r.light.tone}` : "", fill: r.light.pct, title: r.light.title, icon: r.light.icon, sub: r.light.sub },
      this.#partyCellDef(r),
    ];
    return { left, right };
  }

  /**
   * The party cell: the formation (opens the party sheet) while its token is
   * on the scene, else the character's own party with its count (opens the
   * party menu). A pad with no party at all — still a button, because the
   * menu is where a Judge binds the first summon.
   */
  #partyCellDef(r) {
    const p = r.party;
    const tone = p.tone ? ` is-${p.tone}` : "";
    if (p.mode === "formation") return { key: "party", action: "formation", cls: `is-btn${tone}`, icon: p.icon, sub: p.sub, title: r.partyTitle };
    return { key: "party", action: "partyMenu", cls: p.pad ? `is-pad${tone}` : `is-btn${tone}`, icon: p.icon, sub: p.sub, title: r.partyTitle };
  }

  /** The folded bar: starred rolls, timers and counts, in that order. */
  #pinBar(rolls, effects) {
    const rows = rolls.groups.flatMap((g) => g.rows).filter((r) => r.pinned);
    return {
      rolls: rows.map((r) => ({ id: r.id, label: r.label, value: r.value, eq: r.eq })),
      timers: effects.timers.filter((t) => t.pinned).map((t) => ({ id: t.id, label: t.name, pct: t.pct, tone: t.tone, icon: t.icon ?? null, img: t.img ?? null })),
      resources: effects.resources.filter((r) => r.pinned).map((r) => ({ id: r.id, label: r.name, count: r.count, icon: r.icon })),
      any: rows.length + effects.timers.filter((t) => t.pinned).length + effects.resources.filter((r) => r.pinned).length > 0,
    };
  }

  /* -------------------------------------------- */
  /*  Render                                       */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // The folded card may shrink below the open sheet's floor.
    this.element.classList.toggle("is-folded", !!context.folded);
    this.#sizeForFold(!!context.folded);
    if (!this.isEditable) {
      for (const button of this.element.querySelectorAll("button[data-action]")) {
        if (VIEW_ACTIONS.has(button.dataset.action)) button.disabled = false;
      }
    }
    const steps = [
      ["band", () => this.#moveBandIntoHeader()],
      ["casting", () => this.#mountCasting()],
      ["classModifiers", () => this.#mountClassModifiers()],
      ["drops", () => this.#markDropZones()],
      ["itemInputs", () => this.#bindItemInputs()],
      ["paths", () => this.#bindPathSelects()],
    ];
    for (const [what, step] of steps) {
      try {
        step();
      } catch (err) {
        console.error(`${MODULE_ID} | character sheet: ${what} failed`, err);
      }
    }
  }

  /** The title band is the window header (see the item sheet for the mechanics). */
  #moveBandIntoHeader() {
    const header = this.element.querySelector(":scope > .window-header");
    const bands = [...this.element.querySelectorAll('[data-application-part="band"]')];
    const band = bands.find((b) => b.parentElement !== header) ?? bands[0];
    if (!header || !band) return;
    for (const stale of bands) if (stale !== band) stale.remove();
    const controls = header.querySelector("button[data-action=toggleControls]");
    if (band.parentElement !== header) header.insertBefore(band, controls ?? null);
    if (!band.dataset.guarded) {
      band.dataset.guarded = "1";
      band.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest("input, button, a, select, textarea, label")) ev.stopPropagation();
      });
    }
  }

  #mountCasting() {
    const mount = this.element.querySelector('[data-mount="casting"]');
    if (!mount || mount.children.length) return;
    const strip = castingStripElement(this.actor);
    if (strip) mount.append(strip);
  }

  #mountClassModifiers() {
    const mount = this.element.querySelector('[data-mount="classModifiers"]');
    if (!mount || mount.children.length) return;
    const section = classModifiersSection(this.actor);
    if (section) mount.append(section);
  }

  #markDropZones() {
    for (const zone of this.element.querySelectorAll("[data-drop]")) {
      if (zone.dataset.wired) continue;
      zone.dataset.wired = "1";
      zone.addEventListener("dragenter", () => zone.classList.add("is-over"));
      zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
      zone.addEventListener("drop", () => zone.classList.remove("is-over"));
    }
  }

  /** Inputs that write an ITEM field: `data-item-field` inside a `[data-item-id]` row. */
  #bindItemInputs() {
    for (const input of this.element.querySelectorAll("input[data-item-field]")) {
      if (input.dataset.wired) continue;
      input.dataset.wired = "1";
      input.addEventListener("change", (ev) => {
        ev.stopImmediatePropagation();
        const item = this.#itemOf(input);
        const value = input.type === "number" ? input.valueAsNumber : input.value;
        if (!item || (input.type === "number" && Number.isNaN(value))) return;
        item.update({ [input.dataset.itemField]: value }).catch((err) => console.error(`${MODULE_ID} | item field write failed`, err));
      });
    }
  }

  /** A path group's select records the choice on the class ledger, not on the form. */
  #bindPathSelects() {
    for (const select of this.element.querySelectorAll("select[data-path-group]")) {
      if (select.dataset.wired) continue;
      select.dataset.wired = "1";
      select.addEventListener("change", (ev) => {
        ev.stopImmediatePropagation();
        setActorPath(this.actor, select.dataset.pathGroup, select.value).catch((err) => console.error(`${MODULE_ID} | path choice failed`, err));
      });
    }
  }

  #itemOf(target) {
    const id = target?.closest?.("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) : null;
  }

  #effectOf(target) {
    const id = target?.closest?.("[data-effect-id]")?.dataset.effectId;
    return id ? this.actor.effects.get(id) : null;
  }

  /**
   * A small menu under a rail cell: one row per option, the current one
   * marked; a click picks, a click anywhere else closes.
   */
  #openMenu(anchor, items, onPick) {
    this.element.querySelector(`.${SHEET_CLASS}__menu`)?.remove();
    const menu = document.createElement("div");
    menu.className = `${SHEET_CLASS}__menu`;
    menu.innerHTML = items
      .map(
        (it, i) =>
          `<button type="button" class="${SHEET_CLASS}__menu-item${it.on ? " is-on" : ""}" data-menu-index="${i}"${it.disabled ? " disabled" : ""}>` +
          `${it.icon ? `<i class="${it.icon}" inert></i>` : it.img ? `<img src="${it.img}" alt="" inert>` : ""}<span>${foundry.utils.escapeHTML(it.label)}</span>` +
          `${it.value != null ? `<b>${foundry.utils.escapeHTML(String(it.value))}</b>` : ""}</button>`,
      )
      .join("");
    const rail = anchor.closest(`.${SHEET_CLASS}__rail`) ?? anchor.parentElement;
    rail.style.position = "relative";
    menu.style.top = `${anchor.offsetTop}px`;
    rail.append(menu);
    const close = () => {
      menu.remove();
      document.removeEventListener("pointerdown", onOutside, true);
    };
    const onOutside = (ev) => {
      if (!menu.contains(ev.target)) close();
    };
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
    menu.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-menu-index]");
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      close();
      Promise.resolve(onPick(items[Number(btn.dataset.menuIndex)])).catch((err) => console.error(`${MODULE_ID} | menu pick failed`, err));
    });
  }

  /* -------------------------------------------- */
  /*  Drops                                        */
  /* -------------------------------------------- */

  /**
   * An item of this actor's dropped on a zone moves it: onto a place it is
   * worn there, onto a container it is stored, onto the loose column it is
   * taken off or out. Anything else is the ordinary arrival — coin merging
   * into the stack of the same name rather than doubling it.
   */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;
    const zone = event.target?.closest?.("[data-drop]")?.dataset.drop ?? null;
    if (this.actor.uuid === item.parent?.uuid) {
      const own = this.actor.items.get(item.id);
      if (!own || !zone) return null;
      const [kind, key] = zone.split(":");
      try {
        if (kind === "container") {
          const box = this.actor.items.get(key);
          if (box && box.id !== own.id && isContainer(box)) await storeIn(this.actor, own, box);
        } else if (kind === "slot") {
          if (containedIn(own)) await takeOut(own);
          if (own.type === ITEM_TYPE.weapon) await drawItem(own);
          else if (isEquippable(own)) await own.update({ "system.equipped": true });
          else await wearItem(own, key);
        } else if (kind === "loose") {
          if (containedIn(own)) await takeOut(own);
          else if (own.type === ITEM_TYPE.weapon && own.system?.equipped) await sheatheItem(own);
          else if (isEquippable(own) && own.system?.equipped) await own.update({ "system.equipped": false });
          else await removeItem(own);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | drop move failed`, err);
      }
      return own;
    }
    if (item.type === ITEM_TYPE.money && item.parent?.documentName !== "Actor") {
      const mine = this.actor.items.find((i) => i.type === ITEM_TYPE.money && i.name === item.name);
      if (mine) {
        await mine.update({ "system.quantity": num(mine.system?.quantity) + Math.max(1, num(item.system?.quantity, 1)) });
        return mine;
      }
    }
    return super._onDropItem(event, item);
  }

  /** A place dropped on the sheet is pinned to it; any other actor is hired, as core does. */
  async _onDropActor(event, dropped) {
    if (!this.actor.isOwner || !dropped) return null;
    const storage = libStorage();
    if (storage?.isProvider?.(dropped)) {
      await setPinnedPlace(this.actor, dropped.uuid, true);
      ui.notifications.info(game.i18n.format("ACKS-LOCATION.storage.pinned", { name: dropped.name }));
      return null;
    }
    if (dropped.id === this.actor.id) return null;
    if ([ACTOR_TYPE.character, ACTOR_TYPE.monster].includes(dropped.type)) await this.actor.addHenchman?.(dropped.id);
    return null;
  }

  /* -------------------------------------------- */
  /*  Actions — the frame                          */
  /* -------------------------------------------- */

  /**
   * The flag is written as an explicit true or false per actor: `setFlag`
   * MERGES an object, so a key deleted from a copy would survive the write.
   */
  static async #onFold() {
    const next = !this.folded;
    await game.user.setFlag(MODULE_ID, FOLD_FLAG, { [this.actor.id]: next });
    this.render();
  }

  /** The fold state the window was last sized for. */
  #foldedWas = null;

  /**
   * Size the window to its state: the card narrows, the open sheet widens
   * back. Done after render, once the root carries `is-folded`, because the
   * open sheet's minimum width would otherwise clamp the card's.
   */
  #sizeForFold(folded) {
    if (this.#foldedWas === folded) return;
    this.#foldedWas = folded;
    this.setPosition({ width: folded ? 400 : 900, height: "auto" });
  }

  static #onGoTab(event, target) {
    const tab = target.dataset.tab;
    if (this.folded) return;
    if (this.element.querySelector(`.tabs [data-group="primary"][data-tab="${tab}"]`)) this.changeTab(tab, "primary");
  }

  static async #onRoll(event, target) {
    const id = target.dataset.roll;
    if (!id) return;
    try {
      await rollById(this.actor, id, { event });
    } catch (err) {
      console.error(`${MODULE_ID} | roll ${id} failed`, err);
      ui.notifications.error(loc("rolls.failed"));
    }
  }

  /** A pin on an item's roll is the item's favourite; on an actor roll it is the sheet flag. */
  static async #onPinRoll(event, target) {
    const id = target.dataset.roll;
    const row = this.#rolls?.groups.flatMap((g) => g.rows).find((r) => r.id === id);
    if (!row) return;
    if (row.item) {
      const item = this.actor.items.get(row.item);
      if (item && "favorite" in (item.system ?? {})) await item.update({ "system.favorite": !item.system.favorite });
      return;
    }
    await this.#togglePinId(id);
  }

  static async #onPinItem(event, target) {
    await this.#togglePinId(target.dataset.pin);
  }

  async #togglePinId(id) {
    if (!id) return;
    const flag = foundry.utils.deepClone(sheetFlag(this.actor));
    flag.pins = togglePin(flag.pins, id);
    await this.actor.setFlag(MODULE_ID, SHEET_FLAG, flag);
  }

  static #onInfluence() {
    const open = globalThis.acksExtras?.influence?.open;
    if (typeof open === "function") open(this.actor);
    else ui.notifications.warn(loc("core.unreachable", { what: "influence" }));
  }

  static #onMortalWounds() {
    openCoreWindow("mortalWounds", this.actor);
  }

  static async #onCycleAc() {
    const flag = foundry.utils.deepClone(sheetFlag(this.actor));
    flag.acMode = nextAcMode(flag.acMode ?? "shield");
    if (this.actor.isOwner) await this.actor.setFlag(MODULE_ID, SHEET_FLAG, flag);
    else this.render();
  }

  static #onMoveMenu(event, target) {
    const modes = this.actor.system?.movementacks ?? {};
    const items = MOVE_MODES.map((m) => ({
      key: m.key,
      icon: m.icon,
      label: game.i18n.localize(`ACKS.movement.${m.key}`),
      value: moveFigure(m.key, num(modes[m.key])),
      on: this.#ui.moveMode === m.key,
    }));
    this.#openMenu(target, items, (pick) => {
      this.#ui.moveMode = pick.key;
      this.render();
    });
  }

  /** Every weapon the character could hold, and the grip of the one held. */
  static #onGripMenu(event, target) {
    if (!this.actor.isOwner) return;
    const items = [];
    for (const item of this.actor.items.filter((i) => i.type === ITEM_TYPE.weapon)) {
      const equipped = !!item.system?.equipped;
      items.push({ item, kind: equipped ? "sheathe" : "draw", img: item.img, label: item.name, value: loc(equipped ? "grip.sheathe" : "grip.draw"), on: equipped });
    }
    const snap = snapshotFrame(this.actor);
    for (const w of snap.grip.weapons.filter((x) => x.canTwoHand)) {
      const item = this.actor.items.get(w.id);
      items.push({ item, kind: "grip", icon: "fa-solid fa-hands", label: loc("grip.cycle", { name: item?.name ?? "" }), value: game.i18n.localize(`ACKS-EQUIPMENT.grip.${w.grip}`) });
    }
    if (!items.length) items.push({ kind: "none", icon: "fa-solid fa-hand", label: loc("grip.nothing"), disabled: true });
    this.#openMenu(target, items, async (pick) => {
      if (pick.kind === "draw") await drawItem(pick.item);
      else if (pick.kind === "sheathe") await sheatheItem(pick.item);
      else if (pick.kind === "grip") await cycleGrip(pick.item);
    });
  }

  /** Every light source carried: light, douse, shutter; ready a torch from a stack. */
  static #onLightMenu(event, target) {
    if (!this.actor.isOwner) return;
    const lights = globalThis.acksExtras?.lib?.light?.bearerLights?.(this.actor) ?? [];
    const items = [];
    for (const item of this.actor.items) {
      const type = lightTypeOf(item);
      if (!type || containedIn(item)) continue;
      if (type === "torch" && item.type === ITEM_TYPE.item) {
        items.push({ kind: "ready", item, img: item.img, label: item.name, value: game.i18n.localize("ACKS-EQUIPMENT.action.readyHint") });
        continue;
      }
      const lit = lights.find((l) => l.type === type && l.lit);
      const held = lit || lights.find((l) => l.type === type && l.shielded);
      if (held) {
        items.push({ kind: "lightToggle", lightId: held.id, img: item.img, label: item.name, value: game.i18n.localize("ACKS-EQUIPMENT.light.douse"), on: true });
        if (type === "lantern") items.push({ kind: "lightShield", lightId: held.id, icon: "fa-solid fa-lightbulb", label: item.name, value: game.i18n.localize("ACKS-EQUIPMENT.light.shutter") });
      } else {
        items.push({ kind: "light", lightType: type, img: item.img, label: item.name, value: game.i18n.localize("ACKS-EQUIPMENT.light.light") });
      }
    }
    if (!items.length) items.push({ kind: "none", icon: "fa-solid fa-moon", label: loc("light.nothing"), disabled: true });
    this.#openMenu(target, items, async (pick) => {
      if (pick.kind === "ready") await prepareTorch(this.actor, pick.item);
      else if (pick.kind === "light") await declareLightAction(this.actor, "light", { lightType: pick.lightType, bearerId: this.actor.id });
      else if (pick.kind === "lightToggle") await declareLightAction(this.actor, "lightToggle", { lightId: pick.lightId });
      else if (pick.kind === "lightShield") await declareLightAction(this.actor, "lightShield", { lightId: pick.lightId });
    });
  }

  static #onFormation() {
    const fm = globalThis.acksExtras?.formation;
    const formation = fm?.getFormationForActor?.(this.actor.id);
    if (!formation) return void ui.notifications.info(loc("rail.noFormation"));
    fm.open?.(formation);
  }

  /**
   * The party menu: who of the party is on the scene (a pick selects the
   * token and pans to it), how many are elsewhere, and for an owner the
   * bind and release of summons — the controlled tokens become this
   * character's summons — plus the roster and the Followers tab.
   */
  static #onPartyMenu(event, target) {
    const facts = partyOf(this.actor);
    const scene = currentScene();
    const items = [];
    for (const h of facts.henchmen.filter((x) => x.onScene)) {
      items.push({ kind: "token", tokenId: h.tokenIds[0], img: h.img, label: h.name, value: h.calamity ? loc("party.calamity") : loc("party.henchman"), on: h.calamity });
    }
    for (const s of facts.summons) items.push({ kind: "token", tokenId: s.tokenId, img: s.img, label: s.name, value: loc("party.summon") });
    const away = facts.henchmen.filter((x) => !x.onScene).length;
    if (away) items.push({ kind: "info", icon: "fa-solid fa-person-walking-arrow-right", label: loc("party.away", { n: away }), disabled: true });
    if (this.actor.isOwner) {
      const mine = new Set(henchmanIds(this.actor));
      const controlled = (canvas?.tokens?.controlled ?? [])
        .map((t) => t.document)
        .filter((t) => t.actorId !== this.actor.id && !mine.has(t.actorId) && summonerOf(t.actor) !== this.actor.uuid && t.actor);
      if (controlled.length) items.push({ kind: "bind", tokens: controlled, icon: "fa-solid fa-wand-magic-sparkles", label: loc("party.bind", { n: controlled.length }) });
      if (facts.summons.length) items.push({ kind: "release", icon: "fa-solid fa-link-slash", label: loc("party.release", { n: facts.summons.length }) });
      if (!this.actor.system?.retainer?.enabled) items.push({ kind: "roster", icon: "fa-solid fa-people-group", label: loc("followers.roster") });
    }
    items.push({ kind: "tab", icon: "fa-solid fa-users", label: loc("tab.followers") });
    this.#openMenu(target, items, async (pick) => {
      switch (pick.kind) {
        case "token": {
          const doc = scene?.tokens.get(pick.tokenId);
          const token = doc?.object;
          if (!token) return;
          token.control({ releaseOthers: true });
          await canvas.animatePan({ x: token.center.x, y: token.center.y });
          return;
        }
        // The flag lands on the summoned actor — another document, or a
        // token's delta — so the count is re-read here rather than waiting
        // on a hook that may not name this sheet.
        case "bind":
          for (const t of pick.tokens) await t.actor?.setFlag(MODULE_ID, SUMMON_FLAG, this.actor.uuid);
          this.render();
          return;
        case "release":
          for (const s of facts.summons) await scene?.tokens.get(s.tokenId)?.actor?.unsetFlag(MODULE_ID, SUMMON_FLAG);
          this.render();
          return;
        case "roster":
          openRosterApp(this.actor);
          return;
        case "tab":
          if (!this.folded) this.changeTab("followers", "primary");
          return;
        default:
          return;
      }
    });
  }

  static #onEditDescription() {
    this.#ui.editingBio = !this.#ui.editingBio;
    this.render();
  }

  static #onChangeArt() {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    new FilePicker({ type: "image", current: this.actor.img, callback: (path) => this.actor.update({ img: path }) }).browse();
  }

  /** The tags: alignment, age, fate points and the level title, in one small prompt. */
  static async #onEditTags() {
    const d = this.actor.system?.details ?? {};
    const Dialog = foundry.applications.api.DialogV2;
    const field = (name, label, value, type = "text") =>
      `<div class="form-group"><label>${label}</label><div class="form-fields"><input class="acks-input" type="${type}" name="${name}" value="${foundry.utils.escapeHTML(String(value ?? ""))}"></div></div>`;
    const content = [
      field("alignment", game.i18n.localize("ACKS.details.alignment"), d.alignment),
      field("title", game.i18n.localize("ACKS.details.title"), d.title),
      field("age", game.i18n.localize("ACKS.details.age"), d.age, "number"),
      field("fatepoints", game.i18n.localize("ACKS.details.fate"), d.fatepoints, "number"),
    ].join("");
    const result = await Dialog.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("tags.title") },
      content,
      ok: {
        label: loc("tags.save"),
        callback: (_ev, button) => {
          const f = button.form.elements;
          return { alignment: f.alignment.value, title: f.title.value, age: f.age.valueAsNumber, fatepoints: f.fatepoints.valueAsNumber };
        },
      },
      rejectClose: false,
    });
    if (!result) return;
    await this.actor.update({
      "system.details.alignment": result.alignment,
      "system.details.title": result.title,
      ...(Number.isFinite(result.age) ? { "system.details.age": result.age } : {}),
      ...(Number.isFinite(result.fatepoints) ? { "system.details.fatepoints": result.fatepoints } : {}),
    });
  }

  static #onOwnership() {
    const Config = foundry.applications.apps.DocumentOwnershipConfig;
    if (Config) new Config({ document: this.actor }).render(true);
  }

  static #onSource() {
    const source = this.actor._stats?.compendiumSource;
    ui.notifications.info(source ? loc("source.from", { source }) : loc("source.none"));
  }

  static #onTweaks() {
    openCoreWindow("tweaks", this.actor);
  }

  static #onModifiers() {
    openCoreWindow("modifiers", this.actor);
  }

  static #onGenerateScores() {
    openCoreWindow("generateScores", this.actor);
  }

  /** Roll the hit dice and write the result as the full total — after asking. */
  static async #onRollHitDice() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: game.i18n.localize("ACKS.HitDice") },
      content: `<p>${loc("vitals.rerollConfirm", { hd: this.actor.system?.hp?.hd ?? "" })}</p>`,
      rejectClose: false,
    });
    if (!ok) return;
    const roll = await this.actor.rollHP(true);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content: loc("vitals.rerolled", { name: this.actor.name, total: roll.total }) });
  }

  /* -------------------------------------------- */
  /*  Actions — items                              */
  /* -------------------------------------------- */

  static #onItemEdit(event, target) {
    this.#itemOf(target)?.sheet?.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    if (game.settings.get("acks", "confirmDeletion")) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
        window: { title: game.i18n.localize("ACKS.Delete") },
        content: `<p>${loc("items.deleteConfirm", { name: item.name })}</p>`,
        rejectClose: false,
      });
      if (!ok) return;
    }
    await item.delete();
  }

  static #onItemShow(event, target) {
    this.#itemOf(target)?.show?.();
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    if (!type) return;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [{ name: loc(`items.new.${type}`), type }]);
    created?.sheet?.render(true);
  }

  static async #onItemFavorite(event, target) {
    const item = this.#itemOf(target);
    if (item && "favorite" in (item.system ?? {})) await item.update({ "system.favorite": !item.system.favorite });
  }

  static async #onToggleEquip(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    if (item.type === ITEM_TYPE.weapon) await (item.system?.equipped ? sheatheItem(item) : drawItem(item));
    else await item.update({ "system.equipped": !item.system?.equipped });
  }

  static async #onToggleWear(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    const worn = !!item.getFlag(MODULE_ID, "gear")?.wornAt;
    await (worn ? removeItem(item) : wearItem(item, target.dataset.slot));
  }

  static async #onCycleGrip(event, target) {
    const item = this.#itemOf(target);
    if (item) await cycleGrip(item);
  }

  static async #onCycleStrap(event, target) {
    const item = this.#itemOf(target);
    if (item) await cycleStrap(item);
  }

  static async #onLightAction(event, target) {
    const { light, lightId, lightType } = target.dataset;
    const payload = light === "light" ? { lightType, bearerId: this.actor.id } : { lightId };
    await declareLightAction(this.actor, light, payload);
  }

  static async #onReadyTorch(event, target) {
    const item = this.#itemOf(target);
    if (item) await prepareTorch(this.actor, item);
  }

  static async #onTakeOut(event, target) {
    const item = this.#itemOf(target);
    if (item) await takeOut(item);
  }

  static async #onSplitStack(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    const created = await splitOne(item);
    if (created) ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.itemSheet.equip.splitDone", { name: created.name }));
  }

  static async #onContainerToggle(event, target) {
    const item = this.#itemOf(target);
    if (item) await setConcealed(item, !item.getFlag(MODULE_ID, "container")?.concealed);
  }

  static async #onContainerLock(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    const locked = !!item.getFlag(MODULE_ID, "container")?.locked;
    await (locked ? setOpened(item, true) : setLocked(item, true));
  }

  static async #onContainerPick(event, target) {
    const item = this.#itemOf(target);
    if (item) await pickLock(this.actor, item);
  }

  static async #onContainerBash(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    const fragile = !!item.getFlag(MODULE_ID, "container")?.fragile;
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: game.i18n.localize("ACKS-EQUIPMENT.container.bash") },
      content: `<p>${game.i18n.format(fragile ? "ACKS-EQUIPMENT.container.bashConfirmFragile" : "ACKS-EQUIPMENT.container.bashConfirm", { name: item.name })}</p>`,
      rejectClose: false,
    });
    if (ok) await bashOpen(this.actor, item);
  }

  static async #onContainerEmpty(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    const n = await emptyContainer(this.actor, item);
    if (n) ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.container.emptied", { n, name: item.name }));
  }

  static async #onAnnotateAll() {
    let n = 0;
    for (const item of this.actor.items) {
      if (!isGoods(item) || item.type === ITEM_TYPE.money) continue;
      if (await annotateItem(item)) n++;
    }
    ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.container.annotated", { n }));
  }

  #placeOf(target) {
    const uuid = target?.closest?.("[data-place-uuid]")?.dataset.placeUuid;
    return uuid ? libStorage()?.resolveActorSync?.(uuid) ?? null : null;
  }

  static #onPlaceOpen(event, target) {
    this.#placeOf(target)?.sheet?.render(true);
  }

  static async #onPlaceDeposit(event, target) {
    const place = this.#placeOf(target);
    if (place) await openStashDialog(this.actor, place);
  }

  static async #onPlaceRetrieveAll(event, target) {
    const place = this.#placeOf(target);
    const api = libStorage();
    if (!place || !api) return;
    const spec = api.storedItems(place, { ownerUuid: this.actor.uuid }).map((i) => ({ id: i.id }));
    if (spec.length) await api.retrieve(place, this.actor, spec);
  }

  static async #onPlacePin(event, target) {
    const place = this.#placeOf(target);
    if (!place) return;
    await setPinnedPlace(this.actor, place.uuid, !pinnedPlaces(this.actor).has(place.uuid));
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions — stats, class, abilities            */
  /* -------------------------------------------- */

  static async #onToggleTraining(event, target) {
    const { group, slot } = target.dataset;
    if (!group || !slot) return;
    try {
      await toggleTraining(this.actor, group, slot);
    } catch (err) {
      console.error(`${MODULE_ID} | toggling class training failed`, err);
      ui.notifications.error(game.i18n.localize("ACKS-CLASSES.modifiers.failed"));
    }
  }

  static #onToggleBucket(event, target) {
    const key = target.dataset.bucket;
    if (this.#ui.openBuckets.has(key)) this.#ui.openBuckets.delete(key);
    else this.#ui.openBuckets.add(key);
    this.render();
  }

  static #onClassPick() {
    openClassPicker(this.actor);
  }

  static #onClassReopen() {
    reopenChargen(this.actor);
  }

  static #onClassOpen() {
    classForActor(this.actor)?.sheet?.render(true);
  }

  static #onLevelUp() {
    openLevelUp(this.actor);
  }

  static #onAbilityFilter(event, target) {
    this.#ui.abilityFilter = target.dataset.filter ?? "all";
    this.render();
  }

  /** The abilities feature's picker, run against the carrier the row names. */
  static async #onPickLanguage(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    await LANGUAGE_ACTIONS.pickLanguage.call({ item, render: () => this.render() });
  }

  static #onSpellCast(event, target) {
    const item = this.#itemOf(target);
    if (!item) return;
    let skip = false;
    try {
      skip = !!event[game.settings.get("acks", "skip-dialog-key")];
    } catch {
      skip = false;
    }
    item.spendSpell?.({ skipDialog: skip });
  }

  static async #onSpellReset() {
    const updates = this.actor.items.filter((i) => i.type === ITEM_TYPE.spell).map((i) => ({ _id: i.id, "system.cast": 0, "system.memorized": 0 }));
    if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  static async #onRest() {
    await restPools(this.actor);
  }

  /* -------------------------------------------- */
  /*  Actions — followers, notes, effects          */
  /* -------------------------------------------- */

  static #onRoster() {
    openRosterApp(this.actor);
  }

  static async #onPayWages() {
    await this.actor.payWages?.();
  }

  #hirelingOf(target) {
    const id = target?.closest?.("[data-actor-id]")?.dataset.actorId;
    return id ? game.actors.get(id) : null;
  }

  static #onHirelingShow(event, target) {
    this.#hirelingOf(target)?.sheet?.render(true);
  }

  static #onHirelingLoyalty(event, target) {
    const h = this.#hirelingOf(target);
    if (!h) return;
    if (h.type === ACTOR_TYPE.monster) openLoyaltyRoll(h);
    else h.rollLoyalty?.({ event });
  }

  static #onHirelingMorale(event, target) {
    this.#hirelingOf(target)?.rollMorale?.({ event });
  }

  static async #onHirelingDelete(event, target) {
    const h = this.#hirelingOf(target);
    if (!h) return;
    if (h.type === ACTOR_TYPE.monster) return dismissMonster(this.actor, h);
    if (game.settings.get("acks", "confirmDeletion")) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
        window: { title: game.i18n.localize("ACKS.Delete") },
        content: `<p>${loc("followers.dismissConfirm", { name: h.name })}</p>`,
        rejectClose: false,
      });
      if (!ok) return;
    }
    await this.actor.delHenchman?.(h.id);
  }

  static #onEditNotes() {
    this.#ui.editingNotes = !this.#ui.editingNotes;
    this.render();
  }

  static #onRelationshipOpen(event, target) {
    this.#itemOf(target)?.sheet?.render(true);
  }

  static async #onRelationshipDelete(event, target) {
    await this.#itemOf(target)?.delete();
  }

  static async #onEffectCreate() {
    const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [
      { name: loc("effects.newName"), img: "icons/svg/aura.svg", disabled: false, duration: { rounds: 1 } },
    ]);
    effect?.sheet?.render(true);
  }

  static async #onEffectToggle(event, target) {
    const effect = this.#effectOf(target);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  static #onEffectEdit(event, target) {
    this.#effectOf(target)?.sheet?.render(true);
  }

  static async #onEffectDelete(event, target) {
    await this.#effectOf(target)?.delete();
  }

  static async #onFateAdjust(event, target) {
    const delta = num(target.dataset.delta);
    const cur = num(this.actor.system?.details?.fatepoints);
    await this.actor.update({ "system.details.fatepoints": Math.max(0, cur + delta) });
  }

  /** A saved description or note closes the editor it was typed in. */
  async _processSubmitData(event, form, submitData, options) {
    if (foundry.utils.hasProperty(submitData, "system.details.biography")) this.#ui.editingBio = false;
    if (foundry.utils.hasProperty(submitData, "system.details.notes")) this.#ui.editingNotes = false;
    return super._processSubmitData(event, form, submitData, options);
  }
}

export { TAB_ORDER };
