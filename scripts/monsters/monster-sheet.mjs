/* global foundry, game, ui, canvas, Roll, ChatMessage, CONFIG, fromUuid */
/**
 * The Full Monster sheet, created at ready as a SUBCLASS of the system's own
 * registered monster sheet (resolved from CONFIG.Actor.sheetClasses) drawn on
 * the lib's sheet frame: the band in the window header, the two rails around
 * the portrait, the tab strip with its fold, and the folded card of pins. It
 * inherits the system's item, effect, save, reaction and encounter actions and
 * REPLACES its header and tab set with:
 *
 *   Statblock · Classification · Animal · Attacks · Abilities · Inventory ·
 *   Spoils · Defences · Ecology · Henchman · Spells (system) · Description ·
 *   Effects (system)
 *
 * Statblock is the dashboard: every throw with its target and what it is made
 * of, and the readings — movement, senses, the load, the defences, the spell
 * slots. Classification is the pen for what the band, the rails and Statblock
 * read. The importer's provenance (once the Source tab) is a dialog from the
 * tools rail. The frame's mechanics are docs/lib/MODEL.md, "The sheet frame";
 * this sheet's are docs/monsters/MODEL.md, "The sheet".
 */
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";
import MonsterExtras from "./monster-extras.mjs";
import { ACTIONS } from "./monster-actions.mjs";
import { oseSourceView } from "./source-view.mjs";
import * as CFG from "./config.mjs";
import { loadStone, capacityStone, borneBy6 } from "../lib/capacity.mjs";
import { riderOf } from "../lib/mount.mjs";
import { hdFormula } from "../lib/actor-read.mjs";
import { ANIMAL_TRAINING } from "../lib/data/animal-data.mjs";
import { FRAME_CLASS, FRAME_LANG_PREFIX, FRAME_VIEW_ACTIONS, FrameMixin } from "../lib/frame.mjs";
import { SAVE_KEYS, saveCells, hpCell, num, sheetFlag } from "../lib/frame-model.mjs";
import { statblockColumns, rollRows, hdRating, bodyFormIcon, moveReading, sensesReading, feet } from "./statblock.mjs";
import { openHpTool } from "../lib/apps/hp-app.mjs";
import { makeLoc } from "../lib/util.mjs";

const T = `modules/${MODULE_ID}/templates/monsters`;
const loc = makeLoc("ACKS-MONSTERS");
const frameLoc = makeLoc(FRAME_LANG_PREFIX);

/** Every template the body includes as a partial, preloaded at init; the frame's own are the lib's. */
export const MONSTER_SHEET_TEMPLATES = Object.freeze([
  `${T}/body.hbs`,
  `${T}/tab-statblock.hbs`,
  `${T}/tab-classification.hbs`,
  `${T}/tab-animal.hbs`,
  `${T}/tab-attacks.hbs`,
  `${T}/tab-abilities.hbs`,
  `${T}/tab-inventory.hbs`,
  `${T}/tab-spoils.hbs`,
  `${T}/tab-defenses.hbs`,
  `${T}/tab-ecology.hbs`,
  `${T}/tab-henchman.hbs`,
  `${T}/tab-description.hbs`,
  `${T}/tab-source.hbs`,
  "systems/acks/templates/actors/v2/spells.hbs",
  "systems/acks/templates/actors/v2/effects.hbs",
  "systems/acks/templates/items/v2/common/item-active-effects.hbs",
]);

// Spelled here rather than imported from lib's ready-time registrar module,
// to avoid a cycle — same string.
const ANIMAL_SUBTYPE = `${MODULE_ID}.animal`;

/** The tab strip, in order; `animal`, `spells` and `effects` are gated per actor. */
const TAB_LIST = Object.freeze([
  { id: "statblock", label: "ACKS-MONSTERS.tab.statblock" },
  { id: "classification", label: "ACKS-MONSTERS.tab.classification" },
  { id: "animal", label: "ACKS-MONSTERS.tab.animal" },
  { id: "attacks", label: "ACKS-MONSTERS.tab.attacks" },
  { id: "abilities", label: "ACKS-MONSTERS.tab.abilities" },
  { id: "inventory", label: "ACKS-MONSTERS.tab.inventory" },
  { id: "spoils", label: "ACKS-MONSTERS.tab.spoils" },
  { id: "defenses", label: "ACKS-MONSTERS.tab.defenses" },
  { id: "ecology", label: "ACKS-MONSTERS.tab.ecology" },
  { id: "henchman", label: "ACKS-MONSTERS.tab.henchman" },
  { id: "spells", label: "ACKS.category.spells" },
  { id: "description", label: "ACKS-MONSTERS.tab.description" },
  { id: "effects", label: "ACKS.category.effects" },
]);

/** The tools rail, top to bottom; `source` appears only on an imported creature. */
const TOOLS = Object.freeze([
  { key: "editDescription", icon: "fa-solid fa-pen-to-square" },
  { key: "changeArt", icon: "fa-solid fa-image" },
  { key: "editTags", icon: "fa-solid fa-tags" },
  { key: "ownership", icon: "fa-solid fa-user-lock" },
  { key: "source", icon: "fa-solid fa-book-open", imported: true },
  { key: "showTweaksDialog", icon: "fa-solid fa-screwdriver-wrench", title: "tweaks" },
]);

/** `data-*` attributes for a cell or the band's glyph, rendered raw by the partial. */
const attr = (o) => Object.entries(o).map(([k, v]) => `data-${k}="${foundry.utils.escapeHTML(String(v))}"`).join(" ");
const localize = (key) => (key ? game.i18n.localize(key) : "");
const labelOf = (table, key) => (key ? localize(table?.[key]?.label ?? key) : "");

/**
 * Derived monster encumbrance, read through lib's capacity primitive (the
 * system's computeEncumbrance early-returns for non-characters). The load is
 * what the creature carries — items, coin, and a mounted rider at body weight
 * plus carried encumbrance — compared against its normal load (full speed)
 * and its maximum.
 */
function computeEncumbrance(actor, extras) {
  const stone = loadStone(actor);
  const rider = riderOf(actor);

  const normal = extras.load?.normal;
  const max = capacityStone(actor);
  let state = "unknown";
  let speedFactor = null;
  let pct = null;
  let normalPct = null;
  if (normal != null) {
    const denom = (max != null ? max : normal * 2) || 1;
    pct = Math.min(100, Math.max(0, (stone / denom) * 100));
    normalPct = Math.min(100, (normal / denom) * 100);
    if (stone <= normal) [state, speedFactor] = ["unencumbered", 1];
    else if (max != null ? stone <= max : stone <= normal * 2) [state, speedFactor] = ["encumbered", 0.5];
    else [state, speedFactor] = ["overloaded", 0];
  }
  return {
    stone: Math.round(stone * 10) / 10,
    normal,
    max,
    pct,
    normalPct,
    state,
    speedFactor,
    stateLabel: game.i18n.localize(`ACKS-MONSTERS.enc.${state}`),
    // The rider's line is body weight plus kit, not the rider's own encumbrance.
    rider: rider ? { name: rider.name, stone: Math.round(borneBy6(rider) / 6 * 10) / 10 } : null,
  };
}

/** { key: label } choices maps consumed by templates. */
function choices() {
  return {
    types: CFG.choicesOf(CFG.MONSTER_TYPES),
    size: CFG.choicesOf(CFG.SIZES),
    bodyForm: CFG.choicesOf(CFG.BODY_FORMS),
    saveClass: CFG.choicesOf(CFG.SAVE_CLASSES),
    movement: CFG.choicesOf(CFG.MOVEMENT_TYPES),
    vision: CFG.choicesOf(CFG.VISION_TYPES),
    sense: CFG.choicesOf(CFG.SENSE_TYPES),
    intelligence: CFG.choicesOf(CFG.INTELLIGENCE),
    youngType: CFG.choicesOf(CFG.YOUNG_TYPES),
    intervalUnit: CFG.choicesOf(CFG.INTERVAL_UNITS),
    trainedRole: CFG.choicesOf(CFG.TRAINED_ROLES),
    treasure: CFG.choicesOf(CFG.TREASURE_TYPES),
    damage: CFG.choicesOf(CFG.DAMAGE_TYPES),
    effect: CFG.choicesOf(CFG.EFFECT_KEYS),
    condition: CFG.choicesOf(CFG.CONDITION_KEYS),
    alignment: { Lawful: "Lawful", Neutral: "Neutral", Chaotic: "Chaotic" },
    category: { henchman: "Henchman", mercenary: "Mercenary", specialist: "Specialist" },
  };
}

/** A plain roll posted to chat under the actor's name. */
async function plainRoll(actor, formula, data, flavor) {
  const roll = await new Roll(formula, data).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor });
  return roll;
}

/** The uuid inside a stored content link, or null. */
const linkUuid = (link) => String(link ?? "").match(/@UUID\[([^\]]+)\]/)?.[1] ?? null;

/**
 * Build the Full Monster sheet class extending the system's monster sheet.
 * @param {typeof foundry.applications.api.ApplicationV2} Base  The system's monster sheet class.
 */
export function createFullMonsterSheet(Base) {
  return class FullMonsterSheet extends FrameMixin(Base) {
    static DEFAULT_OPTIONS = {
      // no-scroll: this sheet scrolls at its PART root, not at `.window-content`.
      // The shared contract would move the scroller onto `.window-content`, which
      // is not a part — and ApplicationV2 restores scroll per part, so the body's
      // `scrollable: [""]` below would stop working. A sheet whose fields submit
      // on change needs the retention; the scroller lives in styles/lib-frame.css.
      classes: ["acks-ui", "acks", "actor-v2", "monster-v2", "acks-extras", FRAME_CLASS, "acks-extras-monster"],
      // Scalars overwrite up the chain: without this the system's opening size wins.
      position: { width: 900, height: "auto" },
      window: { resizable: true, contentClasses: [`${FRAME_CLASS}__content`] },
      actions: {
        ...ACTIONS,
        roll: FullMonsterSheet.#onRoll,
        pinRoll: FullMonsterSheet.#onPinRoll,
        hpCell: FullMonsterSheet.#onHpCell,
        moveMenu: FullMonsterSheet.#onMoveMenu,
        senseMenu: FullMonsterSheet.#onSenseMenu,
        groupSelect: FullMonsterSheet.#onGroupSelect,
        employer: FullMonsterSheet.#onEmployer,
        editDescription: FullMonsterSheet.#onEditDescription,
        changeArt: FullMonsterSheet.#onChangeArt,
        editTags: FullMonsterSheet.#onEditTags,
        ownership: FullMonsterSheet.#onOwnership,
        source: FullMonsterSheet.#onSource,
      },
    };

    /** Actions a read-only seat keeps: the frame's, the rolls and the menus, and what only opens or shows. */
    static VIEW_ACTIONS = new Set([...FRAME_VIEW_ACTIONS, "roll", "moveMenu", "senseMenu", "groupSelect", "employer", "source", "itemShow", "toggleSummary"]);

    /** The folded card is narrower than a character's: the rails and the portrait alone. */
    static FRAME_WIDTHS = Object.freeze({ open: 900, folded: 348 });

    static PARTS = {
      band: { template: `modules/${MODULE_ID}/templates/lib/frame/band.hbs` },
      body: { template: `${T}/body.hbs`, scrollable: [""] },
    };

    static TABS = { primary: { tabs: [...TAB_LIST], initial: "statblock" } };

    tabGroups = { primary: "statblock" };

    /** Sheet-local state that survives the re-render every form change causes. */
    #ui = { editingBio: false, moveRow: 0 };

    /** The Statblock of the last render — what the folded bar and the row ids read against. */
    #columns = null;

    /**
     * The record an importer leaves on a converted creature, or null. A
     * hand-built monster has none, and gets no Source tool.
     */
    get #oseRecord() {
      return this.actor.flags?.[MODULE_ID]?.ose ?? null;
    }

    /**
     * The `system.animal` subtree, or null on a plain monster; gates the
     * Animal tab. See docs/monsters/MODEL.md, "Animal tab".
     */
    get #animalData() {
      return this.actor.type === ANIMAL_SUBTYPE ? (this.actor.system?.animal ?? null) : null;
    }

    /**
     * The tab strip for this actor: no Animal tab without the subtree, no
     * Spells tab while the system's spellcasting is off (the base drops it),
     * and the active tab resolved onto one that exists.
     */
    _prepareTabs(group) {
      const tabs = super._prepareTabs(group);
      if (group !== "primary") return tabs;
      if (!this.#animalData) delete tabs.animal;
      const keys = Object.keys(tabs);
      if (keys.length && !tabs[this.tabGroups.primary]) {
        this.tabGroups.primary = keys[0];
        for (const t of Object.values(tabs)) {
          t.active = t.id === keys[0];
          t.cssClass = t.active ? "active" : "";
        }
      }
      return tabs;
    }

    /* -------------------------------------------- */
    /*  Context                                      */
    /* -------------------------------------------- */

    /** @override */
    async _prepareContext(options) {
      let context = await super._prepareContext(options);
      const actor = this.actor;
      const editable = this.isEditable;
      const folded = this.folded;
      const extras = MonsterExtras.fromActor(actor);
      context.extras = extras;
      context.ose = oseSourceView(this.#oseRecord);
      // Enrich the entry-prose fields the same way core enriches biography.
      // The raw value still drives editing; the enriched HTML is the display.
      // `relativeTo` resolves relative @UUID links; secrets stay hidden from
      // a non-owner.
      const TE = foundry.applications.ux.TextEditor.implementation;
      const desc = extras.description ?? {};
      context.enrichedDesc = Object.fromEntries(
        await Promise.all(
          ["appearance", "combat", "ecology", "encounterText", "lore", "notes"].map(async (k) => [
            k,
            await TE.enrichHTML(desc[k] ?? "", { relativeTo: actor, secrets: actor.isOwner }),
          ]),
        ),
      );
      // Split generic items into carried inventory vs. flagged spoils so the
      // two lists live on separate tabs (a monster can carry gear AND drop parts).
      const items = context.owned?.items ?? [];
      context.spoilItems = items.filter((i) => i.getFlag(MODULE_ID, "spoil"));
      context.carriedItems = items.filter((i) => !i.getFlag(MODULE_ID, "spoil"));
      context.encumbrance = computeEncumbrance(actor, extras);
      context.choices = choices();
      context.scores = CFG.ABILITY_SCORES;
      context.ages = CFG.AGE_CATEGORIES;
      context.x = `flags.${MODULE_ID}.${FLAG_EXTRAS}`;
      // The Animal tab. `training` falls back to the schema initial so a blank
      // string still selects a row. See docs/monsters/MODEL.md, "Animal tab".
      const animal = this.#animalData;
      context.animal = animal
        ? {
            training: animal.training || "untrained",
            mountable: !!animal.mountable,
            trainingChoices: ANIMAL_TRAINING,
            imported: !!actor.flags?.[MODULE_ID]?.cookbook,
          }
        : null;
      // Pre-localized save rows for the Classification tab. Resolves each
      // logical save to whichever key the running system actually uses, so
      // the value and roll target the real field and never come up empty.
      const sysSaves = actor.system?.saves ?? {};
      const pick = (...keys) => keys.find((k) => sysSaves[k] !== undefined) ?? keys[0];
      const saveKeys = {
        paralysis: pick("paralysis"),
        death: pick("death"),
        blast: pick("blast", "breath"),
        implements: pick("implements", "wand"),
        spell: pick("spell"),
      };
      context.saveRows = SAVE_KEYS.map((logical) => ({
        key: saveKeys[logical],
        value: sysSaves[saveKeys[logical]]?.value,
        label: loc(`save.${logical}`),
        tip: game.i18n.localize(`ACKS.saves.${saveKeys[logical]}.long`),
      }));
      const def = extras.defenses ?? {};
      context.selected = {
        types: Array.from(extras.types ?? []),
        vision: Array.from(extras.vision ?? []),
        immDamage: Array.from(def.immunities?.damage ?? []),
        resDamage: Array.from(def.resistances?.damage ?? []),
        susDamage: Array.from(def.susceptibilities?.damage ?? []),
        immEffects: Array.from(def.immunities?.effects ?? []),
        resEffects: Array.from(def.resistances?.effects ?? []),
        susEffects: Array.from(def.susceptibilities?.effects ?? []),
        immConditions: Array.from(def.immunities?.conditions ?? []),
        resConditions: Array.from(def.resistances?.conditions ?? []),
        susConditions: Array.from(def.susceptibilities?.conditions ?? []),
      };
      // The base prepares the effects list only for its own effects PART; the
      // body includes that template, so the list is prepared here.
      if (typeof this._prepareEffectsContext === "function") context = await this._prepareEffectsContext(context);

      // The frame: the snapshot, the Statblock, the band, the rails, the pins.
      const snap = this.#snapshot(extras, context, saveKeys);
      const statblock = statblockColumns(snap, loc);
      this.#columns = statblock.columns;
      const tabs = this.#frameTabs(context);

      const bio = String(extras.description?.appearance ?? "");
      const formLabel = labelOf(CFG.BODY_FORMS, extras.bodyForm);
      const art = {
        img: actor.img,
        alt: actor.name,
        changeTitle: loc("frame.tools.changeArt"),
        overline: [...snap.typeLabels, snap.sizeLabel, formLabel, actor.system?.details?.alignment].filter(Boolean).join(" · "),
        prose: context.enrichedDesc.appearance,
        proseSource: bio,
        proseField: `${context.x}.description.appearance`,
        editing: this.#ui.editingBio,
        tags: [
          actor.system?.details?.alignment ? String(actor.system.details.alignment) : null,
          snap.sizeLabel ? loc("frame.art.size", { size: snap.sizeLabel }) : null,
          snap.lairChance != null ? loc("frame.art.lair", { n: num(snap.lairChance) }) : null,
          snap.treasure.type ? loc("frame.art.treasure", { type: snap.treasure.type }) : null,
          snap.intelligenceLabel || null,
          snap.savesAs ? loc("frame.art.savesAs", snap.savesAs) : null,
        ].filter(Boolean),
      };

      const employer = snap.employer;
      return Object.assign(context, {
        editable,
        folded,
        frame: { tabs, folded },
        cells: this.#railCells(snap),
        band: {
          glyph: {
            icon: bodyFormIcon(extras.bodyForm),
            action: "goTab",
            attrs: attr({ tab: "classification" }),
            title: loc("frame.glyphTitle", { form: formLabel || loc("frame.noForm") }),
          },
          rank: snap.hdText ? loc("frame.hd", { hd: snap.hdText }) : "",
          rankTitle: loc("frame.hdTitle"),
          name: actor.name,
          editable,
          folded,
          chips: employer
            ? [{ action: "goTab", attrs: attr({ tab: "henchman" }), icon: "fa-solid fa-handshake", label: employer.name, title: loc("frame.inServiceTitle") }]
            : [],
          bar: null,
          reading: { label: loc("frame.xpAward", { xp: num(actor.system?.details?.xp) }), title: loc("frame.xpTitle") },
        },
        foldTitle: folded ? frameLoc("fold.open") : frameLoc("fold.close"),
        tabsLabel: loc("frame.tabsLabel"),
        art,
        statblock: { columns: statblock.columns, intro: loc("statblock.intro") },
        pins: this.#pinBar(statblock.columns),
        sheetTools: TOOLS.filter((t) => !t.imported || this.#oseRecord).map((t) => ({ key: t.key, icon: t.icon, title: loc(`frame.tools.${t.title ?? t.key}`) })),
      });
    }

    /** The tab strip as the frame partial draws it, with the counts the lists carry. */
    #frameTabs(context) {
      const counts = {
        attacks: context.owned?.weapons?.length ?? 0,
        abilities: context.abilities?.length ?? 0,
        inventory: (context.carriedItems?.length ?? 0) + (context.owned?.armors?.length ?? 0) + (context.owned?.clothes?.length ?? 0),
        spoils: context.spoilItems?.length ?? 0,
        effects: Object.values(context.effects ?? {}).reduce((n, c) => n + (c?.effects?.length ?? 0), 0),
      };
      return Object.values(context.tabs ?? {}).map((t) => ({
        key: t.id,
        label: localize(t.label),
        active: !!t.active,
        cssClass: t.active ? "active" : "",
        n: counts[t.id] || 0,
        p: 0,
        pTitle: "",
      }));
    }

    /**
     * What the frame reads off the actor, in one plain object the pure model
     * takes: the throws and their targets, the attack routines, the readings,
     * the load, the defences and the spell slots.
     */
    #snapshot(extras, context, saveKeys) {
      const actor = this.actor;
      const sys = actor.system ?? {};
      const sec = extras.secondary ?? {};
      const enc = context.encumbrance;
      const flagsOf = (item) => item.flags?.[MODULE_ID] ?? {};
      const side = (key, core) => {
        const s = extras.encounter?.[key] ?? {};
        return { wandering: s.wandering?.number || core || "", lair: s.lair?.number || "" };
      };
      const def = extras.defenses ?? {};
      const band = (b, silverFlawToo) => [
        ...Array.from(b?.damage ?? []).map((k) => labelOf(CFG.DAMAGE_TYPES, k)),
        ...(b?.mundane ? [loc("field.mundane")] : []),
        ...(b?.extraordinary ? [loc("field.extraordinary")] : []),
        ...(silverFlawToo && b?.silverFlaw ? [loc("field.silverFlaw")] : []),
        ...Array.from(b?.effects ?? []).map((k) => labelOf(CFG.EFFECT_KEYS, k)),
        ...Array.from(b?.conditions ?? []).map((k) => labelOf(CFG.CONDITION_KEYS, k)),
      ];
      const slots = Object.entries(sys.spells ?? {})
        .filter(([k, v]) => /^\d+$/.test(k) && v && num(v.max) > 0)
        .map(([k, v]) => ({ level: k, used: num(context.slots?.used?.[k] ?? v.value), max: num(v.max) }));
      const retainer = sys.retainer ?? {};
      const manager = retainer.enabled && retainer.managerid ? game.actors?.get(retainer.managerid) ?? null : null;
      const saveAs = extras.saveAs ?? {};
      return {
        pins: sheetFlag(actor).pins ?? [],
        saves: Object.fromEntries(SAVE_KEYS.map((k) => [k, sys.saves?.[saveKeys[k]]?.value])),
        saveLabels: Object.fromEntries(SAVE_KEYS.map((k) => [k, loc(`save.${k}`)])),
        saveKeys,
        savesAs: saveAs.class
          ? { cls: labelOf(CFG.SAVE_CLASSES, saveAs.class), level: saveAs.levelMax != null && saveAs.levelMax !== saveAs.level ? `${num(saveAs.level)}–${num(saveAs.levelMax)}` : `${num(saveAs.level)}` }
          : null,
        morale: sys.details?.morale,
        loyalty: retainer.enabled ? retainer.loyalty : null,
        initiative: sys.initiative?.mod ?? sys.initiative?.value,
        surpriseOthers: sys.surprise?.surpriseothers,
        surpriseAvoid: sys.surprise?.avoidsurprise,
        encounter: { dungeon: side("dungeon", sys.details?.appearing?.d), wilderness: side("wilderness", sys.details?.appearing?.w) },
        lairChance: extras.encounter?.lairChance,
        treasure: { type: sys.details?.treasure?.type ?? "", linked: !!sys.details?.treasure?.table },
        attackThrow: sys.attack?.throw,
        attacks: (context.owned?.weapons ?? []).map((w) => ({
          id: w.id,
          name: w.name,
          damage: w.system?.damage?.base?.formula ?? w.system?.damage?.formula ?? "",
          damageType: labelOf(CFG.DAMAGE_TYPES, flagsOf(w).damageType),
          natural: !!flagsOf(w).naturalWeapon,
          extraordinary: !!flagsOf(w).extraordinary,
          counter: { value: num(w.system?.counter?.value), max: num(w.system?.counter?.max) },
        })),
        hp: { value: sys.hp?.value, max: sys.hp?.max, formula: sys.hp?.hd ?? "" },
        hdText: hdRating(extras.hd) ?? (sys.hp?.hd ? String(sys.hp.hd) : null),
        abilities: (context.abilities ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          rollable: !!a.system?.roll,
          target: a.system?.rollTarget ?? null,
          line: [flagsOf(a).abilityCategory ? String(flagsOf(a).abilityCategory) : "", flagsOf(a).usage ? localize(CFG.USAGE?.[flagsOf(a).usage]?.label ?? "") : ""].filter(Boolean).join(" · "),
        })),
        speeds: (extras.speeds ?? []).map((s) => ({ type: s.type, label: labelOf(CFG.MOVEMENT_TYPES, s.type), combat: s.combat, run: s.run, hover: !!s.hover })),
        vision: Array.from(extras.vision ?? []).map((k) => ({ key: k, label: labelOf(CFG.VISION_TYPES, k) })),
        lightlessRange: extras.lightlessRange,
        otherSenses: (extras.otherSenses ?? []).map((s) => ({ label: labelOf(CFG.SENSE_TYPES, s.type), range: s.range, note: s.note ?? "" })),
        load: { stone: enc.stone, normal: enc.normal, max: enc.max, rider: enc.rider },
        defenses: { immune: band(def.immunities, true), resist: band(def.resistances, true), susceptible: band(def.susceptibilities, false) },
        spells: { enabled: !!sys.spells?.enabled, casterClass: extras.spellcasting?.class ?? "", casterLevel: extras.spellcasting?.level, slots },
        typeLabels: Array.from(extras.types ?? []).map((k) => labelOf(CFG.MONSTER_TYPES, k)),
        sizeLabel: labelOf(CFG.SIZES, extras.size),
        intelligenceLabel: labelOf(CFG.INTELLIGENCE, sec.intelligence),
        ac: sys.ac?.value,
        employer: manager ? { id: manager.id, name: manager.name } : null,
        group: this.#groupOnScene(),
      };
    }

    /** The tokens of this actor on the current scene. */
    #groupOnScene() {
      const scene = canvas?.scene ?? game.scenes?.current ?? null;
      const tokens = scene ? scene.tokens.filter((t) => t.actorId === this.actor.id) : [];
      return { scene, tokens, n: tokens.length };
    }

    /**
     * The two rails as uniform cell objects for the cell partial. The pure
     * model decided the reading; this decides the glyph and the action.
     */
    #railCells(snap) {
      const saves = saveCells({ saves: snap.saves });
      const left = [
        { key: "reaction", action: "rollReaction", cls: "is-btn", icon: "fa-solid fa-comments", title: loc("frame.rail.reaction") },
        ...saves.map((c) => ({
          key: `save-${c.key}`,
          action: "roll",
          attrs: attr({ roll: `save:${c.key}` }),
          cls: "",
          title: loc("frame.rail.save", { name: snap.saveLabels[c.key], target: c.target }),
          icon: c.icon,
          big: true,
        })),
      ];
      const hp = hpCell(snap.hp);
      const gm = game.user?.isGM;
      const move = moveReading(snap.speeds, this.#ui.moveRow);
      const senses = sensesReading({ vision: snap.vision.map((v) => v.key), lightlessRange: snap.lightlessRange, otherSenses: snap.otherSenses });
      const group = snap.group;
      const right = [
        {
          key: "hp",
          action: gm ? "hpCell" : "goTab",
          attrs: gm ? "" : attr({ tab: "classification" }),
          cls: hp.zero ? "is-bad" : hp.on ? "is-on" : "",
          fill: hp.pct,
          title: hp.zero ? loc("frame.rail.hpZero") : loc(gm ? "frame.rail.hp" : "frame.rail.hpTab", { value: num(snap.hp.value), max: num(snap.hp.max) }),
          inside: { icon: "fa-solid fa-heart", n: hp.n },
        },
        { key: "ac", cls: "", title: loc("frame.rail.ac", { n: num(snap.ac) }), inside: { icon: "fa-solid fa-shield-halved", n: num(snap.ac) } },
        {
          key: "move",
          action: "moveMenu",
          cls: move.pad ? "is-pad" : "",
          title: move.row ? loc("frame.rail.move", { mode: move.row.label, value: move.sub }) : loc("frame.rail.moveNone"),
          icon: "fa-solid fa-map",
          sub: move.sub,
          disabled: move.pad,
        },
        { key: "attack", action: "rollAttack", cls: "is-hi", title: loc("frame.rail.attack", { n: num(snap.attackThrow, 10) }), inside: { icon: "fa-solid fa-hand-fist", n: `${num(snap.attackThrow, 10)}+` } },
        {
          key: "senses",
          action: "senseMenu",
          cls: senses.pad ? "is-pad" : "",
          title: senses.any
            ? loc("frame.rail.senses", { what: [...snap.vision.map((v) => v.label), ...snap.otherSenses.map((s) => s.label)].join(", ") })
            : loc("frame.rail.sensesNone"),
          icon: "fa-solid fa-eye",
          sub: senses.sub,
          disabled: senses.pad,
        },
        snap.employer
          ? { key: "group", action: "employer", cls: "is-btn", icon: "fa-solid fa-handshake", title: loc("frame.rail.employer", { name: snap.employer.name }) }
          : {
              key: "group",
              action: "groupSelect",
              cls: group.n ? "is-btn" : "is-pad",
              icon: "fa-solid fa-people-group",
              sub: group.n ? `×${group.n}` : "",
              title: group.n ? loc("frame.rail.group", { n: group.n }) : loc("frame.rail.groupNone"),
              disabled: !group.n,
            },
      ];
      return { left, right };
    }

    /** The folded bar: the starred rows, in the order they were starred. */
    #pinBar(columns) {
      const rows = rollRows(columns).filter((r) => r.pinned);
      return {
        rolls: rows.map((r) => ({ id: r.id, label: r.label, value: r.value, eq: false, post: !!r.post, title: r.post ? frameLoc("post") : r.value || r.line })),
        timers: [],
        resources: [],
        any: rows.length > 0,
        emptyLabel: frameLoc("fold.noPins"),
      };
    }

    /* -------------------------------------------- */
    /*  Rolls                                        */
    /* -------------------------------------------- */

    /** Make the throw a Statblock row names. */
    async #rollById(id, event) {
      const actor = this.actor;
      const [kind, a] = String(id).split(":");
      const sys = actor.system ?? {};
      const skipKey = game.settings.get("acks", "skip-dialog-key");
      const skipDialog = Boolean(event?.[skipKey]);
      switch (kind) {
        case "save": {
          const key = this.#saveKey(a);
          if (sys.saves?.[key]?.value == null) {
            ui.notifications.warn(game.i18n.format("ACKS-MONSTERS.notify.noSave", { save: a }));
            return false;
          }
          await actor.rollSave(key, { event });
          return true;
        }
        case "reaction":
          await actor.rollReaction({ event });
          return true;
        case "morale":
          await actor.rollMorale({ event });
          return true;
        case "loyalty":
          await actor.rollLoyalty({ event });
          return true;
        case "init": {
          const combatant = game.combat?.combatants?.find((c) => c.actorId === actor.id) ?? null;
          if (combatant && game.combat) {
            await game.combat.rollInitiative([combatant.id]);
            return true;
          }
          const formula = CONFIG.Combat?.initiative?.formula || "1d6 + @initiative.mod";
          await plainRoll(actor, formula, actor.getRollData?.() ?? sys, game.i18n.localize("ACKS.Initiative"));
          return true;
        }
        case "surprise": {
          const mod = num(a === "others" ? sys.surprise?.surpriseothers : sys.surprise?.avoidsurprise);
          await plainRoll(actor, `1d6 + ${mod}`, {}, game.i18n.localize(a === "others" ? "ACKS.SurpriseOthers" : "ACKS.AvoidSurprise"));
          return true;
        }
        case "enc":
          await actor.rollAppearing({ event, check: a === "wilderness" ? "wilderness" : "dungeon" });
          return true;
        case "lair": {
          const chance = MonsterExtras.fromActor(actor).encounter?.lairChance;
          if (chance == null) return false;
          await plainRoll(actor, "1d100", {}, loc("statblock.row.lairFlavor", { n: num(chance) }));
          return true;
        }
        case "treasure": {
          const uuid = linkUuid(sys.details?.treasure?.table);
          const table = uuid ? await fromUuid(uuid) : null;
          if (!table?.draw) return false;
          await table.draw();
          return true;
        }
        case "hp":
          await ACTIONS.rollHitPoints.call(this);
          return true;
        case "hd":
          await actor.rollHitDice({ event });
          return true;
        case "atk":
        case "abl": {
          const item = actor.items.get(a);
          if (!item) return false;
          await item.use({ skipDialog });
          return true;
        }
        case "post": {
          const item = actor.items.get(a);
          if (!item) return false;
          if (typeof item.showChatCard === "function") await item.showChatCard();
          else await item.use({ skipDialog: true });
          return true;
        }
        default:
          ui.notifications?.warn(frameLoc("rollUnknown"));
          return false;
      }
    }

    /** The system's key for a logical save, resolved on this actor. */
    #saveKey(logical) {
      const sysSaves = this.actor.system?.saves ?? {};
      const alt = { blast: "breath", implements: "wand" }[logical];
      if (sysSaves[logical] !== undefined) return logical;
      return alt && sysSaves[alt] !== undefined ? alt : logical;
    }

    /* -------------------------------------------- */
    /*  Actions                                      */
    /* -------------------------------------------- */

    static async #onRoll(event, target) {
      const id = target.dataset.roll;
      if (!id) return;
      try {
        await this.#rollById(id, event);
      } catch (err) {
        console.error(`${MODULE_ID} | roll ${id} failed`, err);
        ui.notifications.error(frameLoc("rollFailed"));
      }
    }

    static async #onPinRoll(event, target) {
      await this._togglePinId(target.dataset.roll);
    }

    /** The heart: the Judge's hit-point window, seeded with this creature. */
    static #onHpCell() {
      openHpTool({ actors: [this.actor] });
    }

    /** Every speed row; the pick is the row the rail shows. */
    static #onMoveMenu(event, target) {
      const extras = MonsterExtras.fromActor(this.actor);
      const items = (extras.speeds ?? []).map((s, i) => ({
        key: i,
        icon: "fa-solid fa-map",
        label: labelOf(CFG.MOVEMENT_TYPES, s.type),
        value: [s.combat != null ? feet(s.combat) : "—", s.run != null ? feet(s.run) : "—"].join(" / "),
        on: i === this.#ui.moveRow,
      }));
      if (!items.length) return;
      this._frameMenu(target, items, (pick) => {
        this.#ui.moveRow = pick.key;
        this.render();
      });
    }

    /** Every sense, read only: the vision kinds, then the other senses with their ranges. */
    static #onSenseMenu(event, target) {
      const extras = MonsterExtras.fromActor(this.actor);
      const items = [
        ...Array.from(extras.vision ?? []).map((k) => ({
          icon: "fa-solid fa-eye",
          label: labelOf(CFG.VISION_TYPES, k),
          value: k === "lightless" && extras.lightlessRange != null ? feet(extras.lightlessRange) : null,
          disabled: true,
        })),
        ...(extras.otherSenses ?? []).map((s) => ({
          icon: "fa-solid fa-ear-listen",
          label: [labelOf(CFG.SENSE_TYPES, s.type), s.note].filter(Boolean).join(" · "),
          value: s.range != null ? feet(s.range) : null,
          disabled: true,
        })),
      ];
      if (!items.length) return;
      this._frameMenu(target, items, () => {});
    }

    /** Select every token of this creature on the scene and pan to the first. */
    static async #onGroupSelect() {
      const { tokens } = this.#groupOnScene();
      const objects = tokens.map((t) => t.object).filter(Boolean);
      if (!objects.length) return;
      objects[0].control({ releaseOthers: true });
      for (const o of objects.slice(1)) o.control({ releaseOthers: false });
      await canvas.animatePan({ x: objects[0].center.x, y: objects[0].center.y });
    }

    /** Open the employer's sheet. */
    static #onEmployer() {
      const id = this.actor.system?.retainer?.managerid;
      const manager = id ? game.actors.get(id) : null;
      manager?.sheet?.render(true);
    }

    static #onEditDescription() {
      this.#ui.editingBio = !this.#ui.editingBio;
      this.render();
    }

    static #onChangeArt() {
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      new FilePicker({ type: "image", current: this.actor.img, callback: (path) => this.actor.update({ img: path }) }).browse();
    }

    static #onOwnership() {
      const Config = foundry.applications.apps.DocumentOwnershipConfig;
      if (Config) new Config({ document: this.actor }).render(true);
    }

    /** Alignment and the XP award, the two tags the art row prints that have no other pen on the frame. */
    static async #onEditTags() {
      const d = this.actor.system?.details ?? {};
      const Dialog = foundry.applications.api.DialogV2;
      const options = Object.keys(choices().alignment)
        .map((k) => `<option value="${k}" ${k === d.alignment ? "selected" : ""}>${foundry.utils.escapeHTML(k)}</option>`)
        .join("");
      const content =
        `<div class="form-group"><label>${game.i18n.localize("ACKS.details.alignment")}</label><div class="form-fields"><select class="acks-input" name="alignment"><option value=""></option>${options}</select></div></div>` +
        `<div class="form-group"><label>${game.i18n.localize("ACKS.details.experience.award")}</label><div class="form-fields"><input class="acks-input" type="number" name="xp" value="${foundry.utils.escapeHTML(String(d.xp ?? ""))}"></div></div>`;
      const result = await Dialog.prompt({
        classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
        window: { title: loc("frame.tags.title") },
        content,
        ok: {
          label: loc("frame.tags.save"),
          callback: (_ev, button) => {
            const f = button.form.elements;
            return { alignment: f.alignment.value, xp: f.xp.valueAsNumber };
          },
        },
        rejectClose: false,
      });
      if (!result) return;
      await this.actor.update({
        "system.details.alignment": result.alignment,
        ...(Number.isFinite(result.xp) ? { "system.details.xp": result.xp } : {}),
      });
    }

    /** The importer's provenance, in a window of its own. */
    static async #onSource() {
      const record = this.#oseRecord;
      if (!record) return;
      const content = await foundry.applications.handlebars.renderTemplate(`${T}/tab-source.hbs`, { ose: oseSourceView(record) });
      await foundry.applications.api.DialogV2.wait({
        // `monster-v2` carries the sheet's own table styles into the dialog.
        classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "monster-v2", "acks-extras-monster-source"],
        window: { title: `${this.actor.name} · ${loc("tab.source")}`, resizable: true },
        position: { width: 720 },
        content,
        buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }],
        rejectClose: false,
      });
    }

    /* -------------------------------------------- */
    /*  Submit                                       */
    /* -------------------------------------------- */

    /**
     * Merge submitted extras over the stored flag (unrendered fields survive;
     * arrays replace), run through the schema (null-safe), and mirror the
     * primary number-appearing formulas into the reused core details.appearing.
     * @override
     */
    _prepareSubmitData(event, form, formData, updateData) {
      const submitData = super._prepareSubmitData(event, form, formData, updateData);
      const path = `flags.${MODULE_ID}.${FLAG_EXTRAS}`;
      const raw = foundry.utils.getProperty(submitData, path);
      if (raw && typeof raw === "object") {
        const stored = foundry.utils.deepClone(this.actor.getFlag(MODULE_ID, FLAG_EXTRAS) ?? {});
        const merged = foundry.utils.mergeObject(stored, raw, { inplace: false, overwrite: true, insertKeys: true });
        let cleaned;
        try {
          cleaned = MonsterExtras.normalize(merged);
        } catch (err) {
          console.error(`${MODULE_ID} | extras normalization failed; saving merged data as-is`, err);
          cleaned = merged;
        }
        foundry.utils.setProperty(submitData, path, cleaned);

        const firstOf = (enc, side) => enc?.[side]?.wandering?.number || enc?.[side]?.lair?.number || "";
        for (const [side, key] of [["dungeon", "d"], ["wilderness", "w"]]) {
          const next = firstOf(cleaned.encounter, side);
          if (next && next !== firstOf(stored.encounter, side)) {
            foundry.utils.setProperty(submitData, `system.details.appearing.${key}`, next);
          }
        }
        // Only the rating's own change rewrites `system.hp.hd`. See
        // docs/monsters/DECISIONS.md, "The Hit Dice rating writes core's
        // roll formula".
        const formula = hdFormula(cleaned.hd);
        if (formula && formula !== hdFormula(stored.hd)) {
          foundry.utils.setProperty(submitData, "system.hp.hd", formula);
        }
      }
      return submitData;
    }
  };
}
