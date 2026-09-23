/* global foundry, game, fromUuidSync */
/**
 * The ACKS Abilities sheet is built at ready as a SUBCLASS of the system's own
 * registered `ability` item sheet, so it inherits the header, description and
 * Active Effects tabs verbatim and adds one **Mechanics** tab for the extended
 * effect model (`flags["acks-extras"].extras`).
 *
 * NOTE the tab id is `mechanics`, not `effects` — the system already uses
 * `effects` for Foundry Active Effects, which are a different thing entirely.
 */
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";
import { definitionId } from "../lib/capabilities.mjs";
import { libraryItems } from "../lib/library.mjs";
import AbilityExtras, { selectionsOf } from "./ability-extras.mjs";
import { keyOf, rollsOf, scalesFor, measures, throwText, throwOutcome, labelOf } from "./ability-rolls.mjs";
import { ladderRungs, classByKey, effectiveLevel } from "../classes/registry.mjs";
import { PROGRESSION_CLASSES, levelFactorLabel } from "../lib/vocab.mjs";
import { ROLL_ACTIONS } from "./roll-editor.mjs";
import { LANGUAGE_ACTIONS, slotsOf, onDropLanguage } from "./language-slots.mjs";
import { filledLanguages } from "../classes/languages.mjs";

const T = `modules/${MODULE_ID}/templates/abilities`;

// The system's Active Effects partial. The one place the path is named: the
// mechanics part preloads it (a core rename fails at part load, loudly) and
// tab-mechanics.hbs receives it through context instead.
const CORE_EFFECTS_PARTIAL = "systems/acks/templates/items/v2/common/item-active-effects.hbs";

/** The name of the creature a companion slot points at, or "" when the pointer is empty or stale. */
function companionName(uuid) {
  if (!uuid) return "";
  try {
    return fromUuidSync(uuid)?.name ?? "";
  } catch {
    return "";
  }
}

/**
 * A definition id ("def.power.longeval") shown as the ability's own name when
 * that ability is in the world. Display only: the data keeps the id, and the id
 * is returned whenever the referenced ability cannot be found.
 */
function refName(ref) {
  if (!ref) return ref;
  // lib owns the provenance-flag read (and the importer's scope name with it);
  // it survives on the item whether or not the importer is active.
  const match = (i) => definitionId(i) === ref;
  // The library — the sidebar plus the importer's own pack — answers almost
  // every ref.
  const item = libraryItems().find(match);
  if (item) return item.name;
  // Any OTHER Item pack a world happens to hold, for a ref pointing outside
  // the library. Only already-loaded packs are searched: this is a synchronous
  // render path and must not await; an unopened pack falls back to the id.
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    const hit = pack.contents?.find?.(match);
    if (hit) return hit.name;
  }
  return ref;
}

/** True when breakpoints step one level at a time, long enough to render as a table rather than inline. */
function isDenseLadder(bp) {
  if (!bp || bp.length < 4) return false;
  return bp.every((b, i) => i === 0 || b.atLevel === bp[i - 1].atLevel + 1);
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = Math.abs(n) % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** A class key as a name: the world's document for it, then the chassis vocabulary, then the key itself. */
function className(key) {
  if (!key) return "";
  try {
    return classByKey(key)?.name || PROGRESSION_CLASSES?.[key]?.label || key;
  } catch {
    return PROGRESSION_CLASSES?.[key]?.label || key;
  }
}

/** Human-readable one-liner for an effect row. */
function describeEffect(e, V) {
  const label = (enumObj, key) => enumObj?.[key]?.label ?? key ?? "";
  const lv = (v) => {
    if (!v) return null;
    if (v.kind === "perLevel" && v.base != null) {
      // `base === per` is the "N per level" shape (value = N × level): shown
      // as the rate and its rounding, not the raw per-level fraction.
      const rounding = v.round ? ` ${label(V.VALUE_ROUNDING, v.round).toLowerCase()}` : "";
      if (v.base === v.per) return `${v.base}/level${rounding}`;
      return `${v.base} (${v.per >= 0 ? "+" : ""}${v.per}/level)${rounding}`;
    }
    if (v.kind === "breakpoints" && v.breakpoints?.length) {
      // A per-level ladder spanning every level is summarised as a range here;
      // the row renders the full table underneath.
      if (isDenseLadder(v.breakpoints)) {
        const first = v.breakpoints[0];
        const last = v.breakpoints[v.breakpoints.length - 1];
        return `${first.value}+ at ${ordinal(first.atLevel)} to ${last.value}+ at ${ordinal(last.atLevel)}`;
      }
      return v.breakpoints.map((b) => `${b.value} @${b.atLevel}`).join(", ");
    }
    // A conditional ladder reads off a scale rather than level, so name it.
    if (v.kind === "conditional" && v.breakpoints?.length) {
      const scale = V?.VALUE_SCALES?.[v.on]?.label ?? v.on;
      return v.breakpoints.map((b) => `${b.value} @${scale} ${b.atLevel}+`).join(", ");
    }
    return v.flat ?? null;
  };
  const n = lv(e.value);
  const signed = (x) => (x == null ? "" : `${x >= 0 ? "+" : ""}${x}`);
  const refs = (a) => (a ?? []).map(refName).join(", ");

  switch (e.type) {
    case "modifier": {
      // A situational modifier states its condition rather than a bare number.
      // The subject leads the line when the roll is not the character's own.
      const subject = e.appliesTo && e.appliesTo !== "self" ? `${label(V.EFFECT_SUBJECTS, e.appliesTo)}: ` : "";
      const qual = [e.forWhat, e.condition === "situational" ? "situational" : e.condition, e.mode === "replace" ? "replaces the default" : "", e.mode === "set" ? "does not apply" : ""]
        .filter(Boolean).join("; ");
      const amount = e.mode === "set" ? "" : ` ${signed(n)}`;
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${subject}${label(V.MODIFIER_TARGETS, e.target)}${amount}${qual ? ` (${qual})` : ""}` };
    }
    case "attributeSubstitution": {
      // Which score feeds the roll, not how much it adds — so there is no
      // number to show, and a row that tried to print one would be wrong for
      // every character.
      const qual = [e.condition, e.notStacksWith?.length ? `does not stack with ${refs(e.notStacksWith)}` : ""]
        .filter(Boolean).join("; ");
      return {
        kind: label(V.EFFECT_TYPES, e.type),
        text: `${label(V.ATTRIBUTES, e.attribute)} instead of ${label(V.ATTRIBUTES, e.insteadOf)} on ${label(V.MODIFIER_TARGETS, e.target)}${qual ? ` (${qual})` : ""}`,
      };
    }
    case "conditionRemove": {
      const subject = e.appliesTo && e.appliesTo !== "self" ? `${label(V.EFFECT_SUBJECTS, e.appliesTo)}: ` : "";
      const conds = [...(e.conditions ?? [])].map((c) => label(V.CONDITION_KEYS, c)).join(", ");
      return {
        kind: label(V.EFFECT_TYPES, e.type),
        text: `${subject}cures ${conds || "—"}${e.condition ? ` (${e.condition})` : ""}`,
      };
    }
    case "throw": {
      // A dense-ladder summary already reads "19+ at 1st to …" — appending the
      // target-number "+" to that would double it.
      const span = isDenseLadder(e.value?.breakpoints);
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${e.forWhat ? `${e.forWhat} ` : ""}throw ${n}${span ? "" : "+"}` };
    }
    case "progressionAs":
      // The class may be one the WORLD publishes rather than a chassis, so it is
      // named by its document before falling back to the chassis vocabulary.
      return {
        kind: label(V.EFFECT_TYPES, e.type),
        text: [className(e.as), levelFactorLabel(e)].filter(Boolean).join(" — "),
      };
    case "proficiencyGrant":
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${label(V.PROFICIENCY_DOMAINS, e.domain)} — ${label(V.PROFICIENCY_BREADTH, e.breadth)}${e.group ? ` (${e.group})` : ""}` };
    case "limitation":
      return { kind: label(V.EFFECT_TYPES, e.type), text: e.restriction || e.condition || "—" };
    case "outcome": {
      // The trigger phrase leads with its number; one not yet materialized
      // (bookless seat) reads as undecidable, not absent.
      const when =
        e.trigger === "naturalBand"
          ? Number.isFinite(e.naturalMax)
            ? `natural ${e.naturalMax === 1 ? "1" : `1–${e.naturalMax}`}`
            : "natural roll in a band (number not materialized)"
          : e.trigger === "belowFraction"
            ? Number.isFinite(e.belowFraction)
              ? `result below ${e.belowFraction === 0.5 ? "half" : e.belowFraction} the target`
              : "result below a fraction of the target (number not materialized)"
            : e.trigger === "failure"
              ? "on failure"
              : label(V.OUTCOME_TRIGGERS, e.trigger);
      const qual = [e.condition, e.note].filter(Boolean).join("; ");
      return {
        kind: label(V.EFFECT_TYPES, e.type),
        text: `${when}: ${e.consequence || "—"}${qual ? ` (${qual})` : ""}`,
      };
    }
    case "requires":
    case "grants":
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${refs(e.refs) || refName(e.ref)}${e.choose ? ` (choose ${e.choose})` : ""}` };
    case "modifies":
      return {
        kind: label(V.EFFECT_TYPES, e.type),
        text: `${refs(e.refs) || refName(e.ref)}: ${label(V.MODIFIER_TARGETS, e.target)} ${signed(n)} (${label(V.EFFECT_MODES, e.mode)})`,
      };
    case "spellLike":
      return { kind: label(V.EFFECT_TYPES, e.type), text: [e.spell, label(V.SPELL_LIKE_FREQ, e.frequency)].filter(Boolean).join(" — ") };
    case "sense":
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${label(V.SENSE_TYPES, e.sense) || e.vision}${e.range ? ` ${e.range}'` : ""}` };
    case "movement":
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${label(V.MOVEMENT_TYPES, e.movementMode)}${n != null ? ` ${n}'` : ""}` };
    case "spellcastingMod":
      return {
        kind: label(V.EFFECT_TYPES, e.type),
        // No `savePenalty`: effectField declares none. A save penalty an
        // ability imposes on its targets is a `modifier` with
        // `appliesTo: "opponent"`.
        text: [e.school, e.casterLevelDelta ? `${signed(e.casterLevelDelta)} caster levels` : ""]
          .filter(Boolean).join(", ") || "—",
      };
    case "resource":
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${e.action || ""} ${label(V.RESOURCE_KINDS, e.resource)}${e.amount ? ` ×${e.amount}` : ""}`.trim() };
    case "economic":
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${e.amount ?? ""}${e.unit || ""}${e.period ? ` per ${e.period}` : ""}`.trim() || "—" };
    case "reroll": {
      const total = V.rerollTotal?.(e) ?? 2;
      const what = e.forWhat || label(V.MODIFIER_TARGETS, e.target) || "the roll";
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${what} ${total}× — ${label(V.REROLL_KEEP, e.keep) || "Keep the Better"}` };
    }
    case "companion": {
      // The slot exists whether or not a creature fills it: a filled slot names
      // the creature; an unfilled one shows its note as a label.
      const bound = companionName(e.actorUuid);
      const who = bound || e.note || refName(e.ref) || "creature";
      const state = e.actorUuid ? "" : ` ${game.i18n.localize(e.ref ? "ACKS-ABILITIES.companion.notLoaded" : "ACKS-ABILITIES.companion.notChosen")}`;
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${e.amount > 1 ? `${e.amount}× ` : ""}${who}${state}` };
    }
    case "capability":
      return { kind: label(V.EFFECT_TYPES, e.type), text: label(V.SPELL_LIKE_FREQ, e.frequency) || e.note || "see description" };
    default:
      return { kind: label(V.EFFECT_TYPES, e.type), text: e.note || e.condition || "—" };
  }
}

/**
 * @param {typeof foundry.applications.api.ApplicationV2} Base the system's ability sheet class
 */
export function createAbilitySheet(Base) {
  const P = Base.PARTS ?? {};
  // THREE TABS, and each kind of thing lives on exactly one of them:
  //   description  what the ability is — prose, citation, and the properties
  //                that are not rolls (requirements, type, favourite)
  //   rolls        every throw it offers
  //   mechanics    everything that changes the game without being rolled — the
  //                extended effect model AND Foundry's Active Effects
  //
  // The system's own `effects` part is folded into mechanics (see
  // docs/abilities/DECISIONS.md, "Active Effects live on the Mechanics tab").
  // Core's description part is reused as-is — only the details partial inside
  // it is swapped (see _prepareDescriptionContext).
  const parts = { header: P.header, tabs: P.tabs };
  if (P.description) parts.description = P.description;
  parts.rolls = { template: `${T}/tab-rolls.hbs`, scrollable: [""] };
  parts.mechanics = { template: `${T}/tab-mechanics.hbs`, templates: [CORE_EFFECTS_PARTIAL], scrollable: [""] };

  const tabList = [];
  if (P.description) tabList.push({ id: "description", icon: "fa-solid fa-scroll", label: "ACKS.category.description" });
  tabList.push({ id: "rolls", icon: "fa-solid fa-dice-d20", label: "ACKS-ABILITIES.tab.rolls" });
  tabList.push({ id: "mechanics", icon: "fa-solid fa-gears", label: "ACKS-ABILITIES.tab.mechanics" });

  return class AcksAbilitySheet extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["acks-ui", "acks", "acks2", "item-v2", "acks-extras", "acks-extras-scroll"],
      actions: { ...ROLL_ACTIONS, ...LANGUAGE_ACTIONS },
      dragDrop: [{ dropSelector: ".acks-abilities-languages" }],
    };
    static PARTS = parts;
    static TABS = { primary: { tabs: tabList, initial: tabList[0].id } };

    tabGroups = { primary: tabList[0].id };

    /** @override */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const V = globalThis.acksExtras?.lib?.vocab ?? {};
      const extras = AbilityExtras.fromItem(this.item);
      context.extras = extras;
      context.x = `flags.${MODULE_ID}.${FLAG_EXTRAS}`;
      // The count shows for a repeatable ability, and for any count above 1 —
      // including on a non-repeatable ability, where it is a data fault and is
      // drawn as one (`qtyConflict`).
      context.showQty = !!extras.repeatable || Number(extras.qty) > 1;
      context.qtyConflict = !extras.repeatable && Number(extras.qty) > 1;
      // A checkbox per canonical pick (lib's selection vocabulary), the
      // comma-separated line as fallback for picks the vocabulary does not
      // name. Matched with case and punctuation folded. Boxes come from
      // selectionOptions(), never Object.entries (a vocabulary's meta keys are
      // not picks). Read through selectionsOf, never `extras.selections`
      // directly — it also absorbs the legacy "(X)" name-suffix convention.
      const picks = selectionsOf(this.item);
      const vocab = V.selectionVocabFor?.(this.item, extras.category) ?? null;
      const matched = new Set();
      context.selectionOptions = vocab
        ? (V.selectionOptions?.(vocab) ?? Object.entries(vocab)).map(([key, def]) => {
            const hit = picks.find((p) => V.matchSelectionKey?.(vocab, p) === key);
            if (hit) matched.add(hit);
            return { key, label: def.label, checked: !!hit };
          })
        : [];
      context.selectionsCSV = picks.filter((p) => !matched.has(p)).join(", ");
      // A weapon proficiency's boxes are grant tokens, and its line may hold
      // single weapons a box would widen — the hint beside them says which is
      // which.
      context.weaponPicks = extras.category === "weaponProficiency" && context.selectionOptions.length > 0;
      context.choices = {
        category: V.choicesOf?.(V.ABILITY_CATEGORIES ?? {}) ?? {},
      };
      context.effectRows = (extras.effects ?? []).map((e) => {
        const row = describeEffect(e, V);
        // Carry the whole ladder so the row can show every level, not a summary
        // that looks like the value only changes at a few of them.
        const bp = e.value?.breakpoints;
        if (isDenseLadder(bp)) {
          row.ladder = { levels: bp.map((b) => b.atLevel), values: bp.map((b) => `${b.value}+`) };
        }
        return row;
      });
      const d = extras.defenses ?? {};
      context.defenseRows = ["immunities", "resistances", "susceptibilities"]
        .map((k) => ({
          key: k,
          label: k.charAt(0).toUpperCase() + k.slice(1),
          damage: Array.from(d[k]?.damage ?? []),
          effects: Array.from(d[k]?.effects ?? []),
          conditions: Array.from(d[k]?.conditions ?? []),
        }))
        .filter((r) => r.damage.length || r.effects.length || r.conditions.length);
      // One row per roll the ability offers. A target that varies shows its
      // whole ladder, because the number alone would be a lie at other ranks.
      // Read through rollsOf() — the single read path — so an ability whose
      // roll still lives in core's singleton fields presents identically.
      const scales = scalesFor(this.item.actor, this.item);
      // A throw's rungs, wherever they live: typed onto the throw, or borrowed
      // from a class document's published ladder. The tab shows the whole table
      // either way.
      const borrows = (t) => (t?.kind === "progression" || (!t?.kind && t?.as)) && !!t?.table;
      const ladderRowsFor = (r) => {
        if (measures(r)) return [];
        const t = r.target ?? {};
        if (borrows(t)) {
          try {
            return ladderRungs(t.as, t.table);
          } catch {
            return [];
          }
        }
        return t.breakpoints ?? [];
      };
      /**
       * A borrowed ladder's name, fraction, and rounding, for a header keyed to
       * the LENDING class's levels rather than the reader's own. See
       * docs/abilities/MODEL.md, borrowed ladders.
       */
      const borrowedAs = (r) => {
        const t = r.target ?? {};
        if (!borrows(t)) return null;
        let name = t.as;
        try {
          name = className(t.as);
        } catch {
          /* an unpublished class still labels the row with its key */
        }
        const fraction = levelFactorLabel(t);
        return { name, fraction, round: t.round ? V.VALUE_ROUNDING?.[t.round]?.label : "" };
      };
      context.rollRows = rollsOf(this.item).map((r, i) => {
        const key = keyOf(r, i);
        const verdict = throwOutcome(r, this.item.actor, this.item);
        const rungs = ladderRowsFor(r);
        const borrowed = borrowedAs(r);
        const suffix = r.rollType === "below" ? "-" : r.rollType === "result" ? "" : "+";
        // A `conditional` target names its own scale; every other shape is read
        // at the roll's. Label the ladder with whichever one it is actually
        // stepped by, or the header claims a progression it does not have.
        const scaleKey = (r.target?.kind === "conditional" ? r.target.on : r.scale) || "level";
        return {
          key,
          label: labelOf(r),
          // ONE renderer for what a throw reads as — a measure shows its dice,
          // a lettered rung shows its cell, a number shows the number. A "?"
          // here says the throw is misconfigured, and it is reserved for the
          // one case that actually is: a scored throw with nothing to score by.
          display: throwText(r, this.item.actor, this.item) || (rungs.length > 1 ? "—" : "?"),
          // What the character is due at this rung, when it is not a number.
          // The row already shows the cell; this is what makes it a sentence.
          note:
            verdict.outcome === "auto"
              ? game.i18n.format("ACKS-ABILITIES.roll.autoDetail", { cell: verdict.text || "—" })
              : verdict.outcome === "none"
                ? game.i18n.format("ACKS-ABILITIES.roll.noneDetail", { cell: verdict.text || "—" })
                : "",
          condition: r.condition,
          // Which level of WHOSE the ladder is read at, said out loud whenever
          // it is not simply this character's own.
          readAt: borrowed?.fraction
            ? game.i18n.format("ACKS-ABILITIES.roll.readAt", {
                cls: borrowed.name,
                fraction: borrowed.fraction,
                at: effectiveLevel(r.target, scales.level, r.target?.round || "up"),
              })
            : "",
          ladder:
            rungs.length > 1
              ? {
                  // A borrowed table is headed by the LENDING class's levels.
                  scaleLabel: borrowed
                    ? game.i18n.format("ACKS-ABILITIES.roll.borrowedScale", { cls: borrowed.name })
                    : (V.VALUE_SCALES?.[scaleKey]?.label ?? scaleKey),
                  steps: rungs.map((b) => b.atLevel),
                  // A rung prints its own CELL where it has one, for a table
                  // whose rungs are not all numbers. Suffixing those with "+"
                  // would read them as targets.
                  values: rungs.map((b) => (b.text ? b.text : b.value == null ? "—" : `${b.value}${suffix}`)),
                }
              : null,
        };
      });
      context.scales = scales;
      // Converted content still imports; it just carries a notice. Removed-on-
      // purpose reads as a caution, merely-omitted as info, and a RENAME names
      // what the reader's book calls it. Wording and icon come from lib's
      // vocabulary.
      const statusKey = extras.conversionStatus || (extras.deprecated ? "deleted" : "");
      const status = statusKey ? V.CONVERSION_STATUS?.[statusKey] : null;
      const CLS = { caution: "warning", info: "info", note: "info" };
      context.notice = status
        ? {
            severity: status.severity,
            cls: CLS[status.severity] ?? "info",
            icon: status.icon,
            label: status.label,
            tip: V.conversionTip?.(statusKey, extras.conversionFrom || this.item.name) ?? status.tip,
            replacedBy: extras.replacedBy ? refName(extras.replacedBy) : "",
          }
        : null;
      // An alias is a real ability whose text lives under another entry. Say so
      // — otherwise the two look like accidental duplicates.
      context.aliasOf = extras.aliasOf ? refName(extras.aliasOf) : null;
      // Capabilities read better as the thing they stand for than as raw
      // tokens: "kw:sensingevil" is the Sensing Evil capability.
      context.provides = (extras.provides ?? []).map((token) => {
        const slug = String(token).replace(/^kw:/, "");
        const owner = libraryItems().find((i) => {
          const id = definitionId(i);
          return id && !i.getFlag("acks-extras", "extras")?.aliasOf && V.capabilityForId?.(id) === token;
        });
        return { token, label: owner?.name ?? slug };
      });
      return context;
    }

    /**
     * Swaps the details partial the description tab renders (the roll block
     * moves to the Rolls tab) and tells it whether the ability throws at all.
     * `system.blindroll` stays on this tab — one setting for all of an
     * ability's throws — gated on `hasRolls`.
     * @override
     */
    async _prepareDescriptionContext(context) {
      const prepared = await super._prepareDescriptionContext(context);
      prepared.getDetailsPartialPath = () => `${T}/details-ability.hbs`;
      prepared.hasRolls = rollsOf(this.item).length > 0;
      return prepared;
    }

    /**
     * Foundry's Active Effects render INSIDE the mechanics tab, so the system's
     * effects context has to be prepared for a part the system does not know
     * carries them. Everything else defers to the system.
     * @override
     */
    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      if (partId === "mechanics") {
        context.tab = context.tabs[partId];
        context.coreEffectsPartial = CORE_EFFECTS_PARTIAL;
        // A language carrier shows its slots here. The filled ones are read
        // back as DOCUMENTS, so a language deleted off the character sheet is
        // simply gone from the list and its slot is free again. `empty` is a
        // list rather than a count so the template can render one placeholder
        // per free slot without arithmetic in Handlebars.
        const slots = slotsOf(this.item);
        if (slots) {
          const filled = filledLanguages(this.item);
          const free = Math.max(0, slots.capacity - filled.length);
          context.languageSlots = {
            capacity: slots.capacity,
            entries: filled.map((i) => ({ name: i.name, uuid: i.uuid })),
            free,
            empty: Array.from({ length: free }, (_, i) => i),
          };
        } else {
          context.languageSlots = null;
        }
        // Reuse the system's own preparation — the Active Effects list is its
        // data, rendered through its partial, just on a different tab.
        if (typeof this._prepareEffectsContext === "function") {
          context = await this._prepareEffectsContext(context);
        }
      }
      return context;
    }

    /**
     * A language dropped on the carrier fills a slot rather than being stored
     * on the item — the model records the tongue, never consumes the document.
     * @override
     */
    async _onDropItem(event, item) {
      if (slotsOf(this.item) && (await onDropLanguage.call(this, item))) return null;
      return super._onDropItem?.(event, item) ?? null;
    }

    /**
     * Merge submitted extras over the stored flag (unrendered fields survive)
     * and run them through the schema so blanks stay null, never 0.
     * @override
     */
    _prepareSubmitData(event, form, formData, updateData) {
      const submitData = super._prepareSubmitData(event, form, formData, updateData);
      const path = `flags.${MODULE_ID}.${FLAG_EXTRAS}`;
      const raw = foundry.utils.getProperty(submitData, path);
      if (raw && typeof raw === "object") {
        const stored = foundry.utils.deepClone(this.item.getFlag(MODULE_ID, FLAG_EXTRAS) ?? {});
        // The Rolls tab may show a roll still living in core's singleton
        // fields (rollsOf() folds it for display); seed the merge base with
        // that so editing it materializes here instead of losing fields the
        // form did not render.
        if (!(stored.rolls ?? []).length) {
          const folded = rollsOf(this.item);
          if (folded.length) stored.rolls = foundry.utils.deepClone(folded);
        }
        // Ticked selection boxes carry no name (so they cannot collide with the
        // array path); folded into the free-text line here, boxes first in
        // vocabulary order, then the fallback line. A typed phrase the
        // vocabulary recognises is stored as its key at once.
        const root = form instanceof HTMLElement ? form : this.element;
        const boxes = [...(root?.querySelectorAll("[data-selection-pick]") ?? [])];
        if (boxes.length) {
          const V = globalThis.acksExtras?.lib?.vocab;
          const vocab = V?.selectionVocabFor?.(this.item, raw.category ?? stored.category);
          const picked = boxes.filter((b) => b.checked).map((b) => b.dataset.selectionPick);
          const free = String(raw.selections ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((f) => (vocab && V?.matchSelectionKey?.(vocab, f)) || f);
          raw.selections = [...picked, ...free.filter((f, i) => !picked.includes(f) && free.indexOf(f) === i)];
        }
        const merged = foundry.utils.mergeObject(stored, raw, { inplace: false, overwrite: true, insertKeys: true });
        // selections is authoritative from the form (an emptied list must stick).
        if (Array.isArray(raw.selections)) merged.selections = raw.selections;
        // The "(spec)" suffix is derived from the picks, never typed, and only
        // when the ability has a vocabulary; clearing the picks removes it.
        if (Array.isArray(merged.selections)) {
          const V = globalThis.acksExtras?.lib?.vocab;
          const vocab = V?.selectionVocabFor?.(this.item, merged.category);
          if (vocab && V?.nameWithSelections) {
            const named = V.nameWithSelections(submitData.name ?? this.item.name, merged.selections, vocab);
            if (named) submitData.name = named;
          }
        }
        try {
          foundry.utils.setProperty(submitData, path, AbilityExtras.normalize(merged));
        } catch (err) {
          console.error(`${MODULE_ID} | extras normalization failed; saving merged data as-is`, err);
          foundry.utils.setProperty(submitData, path, merged);
        }
      }
      return submitData;
    }
  };
}
