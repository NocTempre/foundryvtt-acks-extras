/* global foundry, game */
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
import AbilityExtras, { selectionsOf } from "./ability-extras.mjs";
import { keyOf, rollsOf, targetOf, scalesFor } from "./ability-rolls.mjs";
import { ROLL_ACTIONS } from "./roll-editor.mjs";
import { LANGUAGE_ACTIONS, slotsOf, onDropLanguage } from "./language-slots.mjs";

const T = `modules/${MODULE_ID}/templates/abilities`;

// The system's Active Effects partial, folded into the mechanics tab. This is
// the ONE place the path is named: the mechanics part preloads it (a core
// rename fails at part load, loudly) and tab-mechanics.hbs receives it through
// context rather than hardcoding a reach into core's template tree.
const CORE_EFFECTS_PARTIAL = "systems/acks/templates/items/v2/common/item-active-effects.hbs";

/**
 * A definition id ("def.power.longeval") reads as noise on a sheet, so show the
 * ability's own name when that ability is in the world. The id is what the data
 * holds and what survives a rename; this is display only, and falls back to the
 * id whenever the referenced ability has not been imported.
 */
function refName(ref) {
  if (!ref) return ref;
  // lib owns the provenance-flag read (and the importer's scope name with it);
  // it survives on the item whether or not the importer is active.
  const match = (i) => definitionId(i) === ref;
  const item = game.items?.find?.(match);
  if (item) return item.name;
  // acks-content can import into world compendiums instead of the sidebar, in
  // which case `game.items` is empty and every relation rendered as a raw id.
  // Only already-loaded packs are searched — this is a display nicety on a
  // synchronous render path, so it must not await anything; an unopened pack
  // still falls back to the id, exactly as before.
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    const hit = pack.contents?.find?.(match);
    if (hit) return hit.name;
  }
  return ref;
}

/**
 * A breakpoint ladder that came from a printed PER-LEVEL table: contiguous
 * levels, one value each, long enough that listing it inline is noise. Read
 * off a table, it should be shown as a table.
 */
function isDenseLadder(bp) {
  if (!bp || bp.length < 4) return false;
  return bp.every((b, i) => i === 0 || b.atLevel === bp[i - 1].atLevel + 1);
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = Math.abs(n) % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Human-readable one-liner for an effect row. */
function describeEffect(e, V) {
  const label = (enumObj, key) => enumObj?.[key]?.label ?? key ?? "";
  const lv = (v) => {
    if (!v) return null;
    if (v.kind === "perLevel" && v.base != null) {
      // `base === per` is the "N per level" shape — the value IS N x level, so
      // showing "0.5 (+0.5/level)" invites reading a +0.5 bonus at 1st level
      // when the rule gives 1. Say what it multiplies, and say the rounding:
      // "half class level (round up)" is the rule, "0.5" is not a bonus anyone
      // ever applies.
      const rounding = v.round ? ` ${label(V.VALUE_ROUNDING, v.round).toLowerCase()}` : "";
      if (v.base === v.per) return `${v.base}/level${rounding}`;
      return `${v.base} (${v.per >= 0 ? "+" : ""}${v.per}/level)${rounding}`;
    }
    if (v.kind === "breakpoints" && v.breakpoints?.length) {
      // A ladder read off a printed PER-LEVEL table has a value for every level
      // in its range. Listing all fourteen inline is unreadable and, worse,
      // reads as though the value only changes at those points — so summarise
      // the span here and let the row render the full table underneath.
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
      // A situational bonus must SAY so — a bare "+4" claims it always applies,
      // and most of these apply only while ambushing, negotiating, casting…
      // WHOSE roll this hits LEADS the line when it is not the character's
      // own: "-2 to surprise" and "the opponent: -2 to surprise" are opposite
      // abilities, and reading that off the tail of a qualifier list is too
      // easy to miss.
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
      return { kind: label(V.EFFECT_TYPES, e.type), text: `as ${label(V.PROGRESSION_CLASSES, e.as)} — ${label(V.PROGRESSION_LEVELS, e.atLevel)}` };
    case "proficiencyGrant":
      return { kind: label(V.EFFECT_TYPES, e.type), text: `${label(V.PROFICIENCY_DOMAINS, e.domain)} — ${label(V.PROFICIENCY_BREADTH, e.breadth)}${e.group ? ` (${e.group})` : ""}` };
    case "limitation":
      return { kind: label(V.EFFECT_TYPES, e.type), text: e.restriction || e.condition || "—" };
    case "outcome": {
      // "On a roll of X, Y happens." The trigger phrase leads with its number —
      // that number came off the page, and an outcome whose number did not
      // materialize (bookless seat) must read as undecidable, not as absent.
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
        // No `savePenalty` here. This branch rendered one, but acks-lib's
        // effectField declares no such field, so the value could never survive
        // validation to reach the sheet — a display path with no storage
        // behind it, found by chef audit. A save penalty an ability imposes on
        // its targets is a `modifier` with `appliesTo: "opponent"`.
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
      // The slot exists whether or not the creature has been loaded: a seat
      // without the citing book still sees what the ability confers.
      const who = e.actorUuid ? e.note || e.actorUuid : e.note || refName(e.ref) || "creature";
      const state = e.actorUuid ? "" : " (not yet loaded)";
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
  // The system's own `effects` part is folded into mechanics rather than kept
  // as a fourth tab: two tabs both meaning "effects" was a distinction only the
  // implementation cared about. Core's description part is reused as-is — only
  // the details partial inside it is swapped (see _prepareDescriptionContext),
  // so the roll fields come off Description without restating core's template.
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
      // The count earns a row only when it carries information: a repeatable
      // ability the character could take again, or a count already above 1.
      // A non-repeatable ability sitting at 1 says nothing, and "x1" on every
      // sheet is noise. Above 1 always shows — including on a NON-repeatable
      // ability, where the combination is a data fault and hiding it would
      // hide the fault.
      context.showQty = !!extras.repeatable || Number(extras.qty) > 1;
      // Taken more than once while the book says it cannot be. That is a
      // contradiction in the data, not a preference, so it is drawn as one
      // rather than sitting quietly in a number field nobody re-reads.
      context.qtyConflict = !extras.repeatable && Number(extras.qty) > 1;
      // Selections: a checkbox per canonical pick for this category (acks-lib's
      // SELECTION_VOCAB — the class-build shortlist), with the comma-separated
      // line kept as the fallback for picks the shortlist does not name. A stored
      // pick is matched loosely (case/punctuation folded), so imported free text
      // like "Swords" ticks the Swords & Daggers box instead of sitting in the
      // fallback and never matching anything.
      // Read through selectionsOf, never off `extras.selections` directly: it
      // also absorbs the legacy "(X)" name suffix, which is how a pick granted
      // by a template before the selection was stored still ticks its box.
      const picks = selectionsOf(this.item);
      const vocab = V.selectionVocabFor?.(this.item, extras.category) ?? null;
      const matched = new Set();
      context.selectionOptions = vocab
        ? Object.entries(vocab).map(([key, def]) => {
            const hit = picks.find((p) => V.matchSelectionKey?.(vocab, p) === key);
            if (hit) matched.add(hit);
            return { key, label: def.label, checked: !!hit };
          })
        : [];
      context.selectionsCSV = picks.filter((p) => !matched.has(p)).join(", ");
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
      context.rollRows = rollsOf(this.item).map((r, i) => {
        const key = keyOf(r, i);
        const target = targetOf(r, this.item.actor, this.item);
        const bp = r.target?.breakpoints ?? [];
        const varies = bp.length > 1;
        const suffix = r.rollType === "below" ? "-" : r.rollType === "result" ? "" : "+";
        // A `conditional` target names its own scale; every other shape is read
        // at the roll's. Label the ladder with whichever one it is actually
        // stepped by, or the header claims a progression it does not have.
        const scaleKey = (r.target?.kind === "conditional" ? r.target.on : r.scale) || "level";
        return {
          key,
          label: r.label || game.i18n.localize("ACKS-ABILITIES.roll.unnamed"),
          display: target == null ? (varies ? "—" : "?") : `${target}${suffix}`,
          condition: r.condition,
          ladder: varies
            ? {
                scaleLabel: V.VALUE_SCALES?.[scaleKey]?.label ?? scaleKey,
                steps: bp.map((b) => b.atLevel),
                values: bp.map((b) => `${b.value}${suffix}`),
              }
            : null,
        };
      });
      context.scales = scales;
      // Converted content still imports; it just carries a notice. Removed-on-
      // purpose reads as a caution, merely-omitted as info, and a RENAME is
      // marked too — it resolved, but the reader's book calls it something else,
      // so the notice names it. Wording and icon come from acks-lib.
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
        const owner = game.items?.find?.((i) => {
          const id = definitionId(i);
          return id && !i.getFlag("acks-extras", "extras")?.aliasOf && V.capabilityForId?.(id) === token;
        });
        return { token, label: owner?.name ?? slug };
      });
      return context;
    }

    /**
     * Swap the details partial the system's description tab renders, and tell
     * it whether the ability throws at all.
     *
     * Core's `description.hbs` pulls in `details-<type>.hbs` through a context
     * function, and for an ability that partial is mostly the roll block —
     * formula, type, target. Those belong on the Rolls tab with the ability's
     * other throws; leaving the first one here made it look like the only one,
     * and left a bare "1d20 / = / 0" on every proficiency that makes no throw at
     * all.
     *
     * `system.blindroll` stays on this tab, because it is one setting for ALL of
     * an ability's throws rather than a property of any one of them — but the
     * partial renders it only while `hasRolls`, so it never offers to hide a
     * result the ability cannot produce.
     *
     * Nothing but the pointer and that flag is added. Core's description
     * template, its enrichment and everything else about the tab are reused
     * untouched.
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
        // A language carrier shows its slots here. `empty` is a list rather
        // than a count so the template can render one placeholder per free
        // slot without arithmetic in Handlebars.
        const slots = slotsOf(this.item);
        context.languageSlots = slots
          ? { ...slots, free: Math.max(0, slots.capacity - slots.entries.length),
              empty: Array.from({ length: Math.max(0, slots.capacity - slots.entries.length) }, (_, i) => i) }
          : null;
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
        // The Rolls tab may be showing a roll that still lives in core's
        // singleton fields — rollsOf() folded it for display. Seed the merge
        // base with what was actually shown, so editing it MATERIALIZES it here
        // instead of writing a half-row over an empty array and losing the
        // fields the form did not render.
        if (!(stored.rolls ?? []).length) {
          const folded = rollsOf(this.item);
          if (folded.length) stored.rolls = foundry.utils.deepClone(folded);
        }
        // Ticked selection boxes are not form fields (they carry no name, so they
        // cannot collide with the array path) — fold them into the free-text line
        // here. Boxes first, in vocabulary order, then whatever the fallback line
        // still holds; unticking a box therefore removes that pick.
        const root = form instanceof HTMLElement ? form : this.element;
        const boxes = [...(root?.querySelectorAll("[data-selection-pick]") ?? [])];
        if (boxes.length) {
          const picked = boxes.filter((b) => b.checked).map((b) => b.dataset.selectionPick);
          const free = String(raw.selections ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          raw.selections = [...picked, ...free.filter((f) => !picked.includes(f))];
        }
        const merged = foundry.utils.mergeObject(stored, raw, { inplace: false, overwrite: true, insertKeys: true });
        // selections is authoritative from the form (an emptied list must stick).
        if (Array.isArray(raw.selections)) merged.selections = raw.selections;
        // The "(spec)" suffix is DERIVED from the picks, never typed: choosing a
        // selection renames the ability, and clearing the picks takes the suffix
        // off again. Only when this ability HAS a vocabulary — an ability with
        // no picks to offer keeps whatever name it was given.
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
