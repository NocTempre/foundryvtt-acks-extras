/* global foundry, game */
/**
 * The Full Monster sheet is created at init time as a SUBCLASS of the system's
 * own registered monster sheet (resolved from CONFIG.Actor.sheetClasses). It
 * inherits the compact header, item/effect/save actions, Generate Saves, and
 * CSS, and REPLACES the tab set with a cleaner one:
 *
 *   Classification · Attacks · Abilities · Inventory · Defenses & Magic ·
 *   Ecology · Henchman · Spells (system) · Description · Effects (system)
 *
 * Attacks (weapons), Abilities (ability items), and Inventory (items/armor)
 * are deliberately separate lists. Header and the Spells/Effects tabs reuse the
 * system's own templates so they stay pixel-identical to the default sheet.
 */
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";
import MonsterExtras from "./monster-extras.mjs";
import { ACTIONS } from "./monster-actions.mjs";
import * as CFG from "./config.mjs";

const T = `modules/${MODULE_ID}/templates/monsters`;

/**
 * Derived monster encumbrance (the system's computeEncumbrance early-returns for
 * non-characters). Sums CARRIED item weight — weapons, armor, and non-clothing
 * generic items, plus money — in stone (weight6 is 1/6-stone, matching the core
 * character calc). Spoils are the monster's own harvestable parts, not carried
 * gear, so they are excluded. Compared against Normal Load (full speed) and Max
 * Load (2× normal → half speed) per MM p.13.
 */
function computeEncumbrance(actor, extras) {
  let weight6 = 0;
  for (const item of actor.items) {
    if (item.getFlag(MODULE_ID, "spoil")) continue;
    if (item.type === "item" && item.system?.subtype !== "clothing") {
      weight6 += (item.system?.weight6 ?? 0) * (item.system?.quantity?.value ?? 1);
    } else if (item.type === "weapon" || item.type === "armor") {
      weight6 += item.system?.weight6 ?? 0;
    }
  }
  const money = actor.getTotalMoneyEncumbrance?.() ?? { stone: 0 };
  const stone = weight6 / 6 + (money.stone ?? 0);

  const normal = extras.load?.normal;
  const max = extras.load?.capacity ?? (normal != null ? normal * 2 : null);
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
    alignment: { Lawful: "Lawful", Neutral: "Neutral", Chaotic: "Chaotic" },
    category: { henchman: "Henchman", mercenary: "Mercenary", specialist: "Specialist" },
  };
}

/**
 * Build the Full Monster sheet class extending the system's monster sheet.
 * @param {typeof foundry.applications.api.ApplicationV2} Base  The system's monster sheet class.
 */
export function createFullMonsterSheet(Base) {
  const P = Base.PARTS ?? {};
  const OWN = {
    classification: { template: `${T}/tab-classification.hbs`, scrollable: [""] },
    attacks: { template: `${T}/tab-attacks.hbs`, scrollable: [""] },
    abilities: { template: `${T}/tab-abilities.hbs`, scrollable: [""] },
    inventory: { template: `${T}/tab-inventory.hbs`, scrollable: [""] },
    spoils: { template: `${T}/tab-spoils.hbs`, scrollable: [""] },
    defenses: { template: `${T}/tab-defenses.hbs`, scrollable: [""] },
    ecology: { template: `${T}/tab-ecology.hbs`, scrollable: [""] },
    henchman: { template: `${T}/tab-henchman.hbs`, scrollable: [""] },
    description: { template: `${T}/tab-description.hbs`, scrollable: [""] },
  };

  // Reuse the system's header/tabs/spells/effects parts; drop its mixed
  // "attributes" and "notes" parts (their content now lives in our tabs).
  const parts = { header: P.header, tabs: P.tabs, ...OWN };
  if (P.spells) parts.spells = P.spells;
  if (P.effects) parts.effects = P.effects;

  const tabList = [
    { id: "classification", icon: "fa-solid fa-dragon", label: "ACKS-MONSTERS.tab.classification" },
    { id: "attacks", icon: "fa-solid fa-khanda", label: "ACKS-MONSTERS.tab.attacks" },
    { id: "abilities", icon: "fa-solid fa-star", label: "ACKS-MONSTERS.tab.abilities" },
    { id: "inventory", icon: "fa-solid fa-sack", label: "ACKS-MONSTERS.tab.inventory" },
    { id: "spoils", icon: "fa-solid fa-bone", label: "ACKS-MONSTERS.tab.spoils" },
    { id: "defenses", icon: "fa-solid fa-shield-halved", label: "ACKS-MONSTERS.tab.defenses" },
    { id: "ecology", icon: "fa-solid fa-leaf", label: "ACKS-MONSTERS.tab.ecology" },
    { id: "henchman", icon: "fa-solid fa-handshake", label: "ACKS-MONSTERS.tab.henchman" },
  ];
  if (P.spells) tabList.push({ id: "spells", icon: "fa-solid fa-wand-sparkles", label: "ACKS.category.spells" });
  tabList.push({ id: "description", icon: "fa-solid fa-scroll", label: "ACKS-MONSTERS.tab.description" });
  if (P.effects) tabList.push({ id: "effects", icon: "fa-solid fa-sparkles", label: "ACKS.category.effects" });

  return class FullMonsterSheet extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["acks", "actor-v2", "monster-v2", "acks-extras"],
      actions: { ...ACTIONS },
    };

    static PARTS = parts;

    static TABS = { primary: { tabs: tabList, initial: "classification" } };

    tabGroups = { primary: "classification" };

    /** @override */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const extras = MonsterExtras.fromActor(this.actor);
      context.extras = extras;
      // Enrich the entry-prose fields so text enrichers run in them the way the
      // core sheet already enriches biography — most importantly acks-content's
      // @PdfText tags, which stream book prose per seat. The raw value still
      // drives editing (prose-mirror `value`); the enriched HTML is the display.
      const TE = foundry.applications.ux.TextEditor.implementation;
      const desc = extras.description ?? {};
      context.enrichedDesc = Object.fromEntries(
        await Promise.all(
          ["appearance", "combat", "ecology", "encounterText", "lore", "notes"].map(async (k) => [
            k,
            await TE.enrichHTML(desc[k] ?? ""),
          ]),
        ),
      );
      // Split generic items into carried inventory vs. flagged spoils so the
      // two lists live on separate tabs (a monster can carry gear AND drop parts).
      const items = context.owned?.items ?? [];
      context.spoilItems = items.filter((i) => i.getFlag(MODULE_ID, "spoil"));
      context.carriedItems = items.filter((i) => !i.getFlag(MODULE_ID, "spoil"));
      context.encumbrance = computeEncumbrance(this.actor, extras);
      context.choices = choices();
      context.scores = CFG.ABILITY_SCORES;
      context.ages = CFG.AGE_CATEGORIES;
      context.x = `flags.${MODULE_ID}.${FLAG_EXTRAS}`;
      // Pre-localized save rows for the Classification tab. Resolve each save to
      // whichever key the running system actually uses — the released acks
      // 14.0.1 still uses breath/wand, while newer builds use blast/implements —
      // so the value and roll target the real field and never come up empty.
      const sysSaves = this.actor.system?.saves ?? {};
      const pick = (...keys) => keys.find((k) => sysSaves[k] !== undefined) ?? keys[0];
      context.saveRows = [
        { logical: "paralysis", key: pick("paralysis") },
        { logical: "death", key: pick("death") },
        { logical: "blast", key: pick("blast", "breath") },
        { logical: "implements", key: pick("implements", "wand") },
        { logical: "spell", key: pick("spell") },
      ].map((s) => ({
        key: s.key,
        value: sysSaves[s.key]?.value,
        label: game.i18n.localize(`ACKS-MONSTERS.save.${s.logical}`),
        tip: game.i18n.localize(`ACKS.saves.${s.key}.long`),
      }));
      const def = extras.defenses ?? {};
      context.selected = {
        types: Array.from(extras.types ?? []),
        vision: Array.from(extras.vision ?? []),
        immDamage: Array.from(def.immunities?.damage ?? []),
        resDamage: Array.from(def.resistances?.damage ?? []),
        susDamage: Array.from(def.susceptibilities?.damage ?? []),
      };
      return context;
    }

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
      }
      return submitData;
    }
  };
}
