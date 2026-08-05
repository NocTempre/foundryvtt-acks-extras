/* global foundry, game, ChatMessage, CONST, Roll, fromUuid, ui, Hooks */
import { getSocket } from "../lib/sockets.mjs";
import {
  INFLUENCE_ATTITUDE_LABELS,
  INFLUENCE_BAND_LABELS,
  INFLUENCE_BANDS,
  INFLUENCE_MODIFIERS,
  INFLUENCE_RELATIONSHIP_MOD,
  INFLUENCE_TIME_STEPS,
  INFLUENCE_TONE,
  INFLUENCE_TONE_CHOICES,
  MODULE_ID,
  EXTERNAL_MODES,
  ROLL_FAMILY,
} from "./constants.mjs";
import {
  autoKeysByTone,
  classifyAlignment,
  computeDefaults,
  effectRowsForPage,
  exclusivePeers,
  getActorHD,
  getActsAsPowers,
  getEffectReactionMods,
  getProficiencies,
  getTargetActor,
  itemsWithProficiencyRows,
  monthlyWageForHD,
  resolveParties,
  toLibAlignment,
} from "./actor-data.mjs";
import { getAbilityReactionMods, itemsWithReactionEffects } from "./ability-effects.mjs";
import { hatredNotes, kindOf, optionalRuleEnabled, parseKindList, relationFor } from "./racial.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// scopeApplies is acks-lib's gating authority; every effect modifier — including
// this module's own Active Effect convention — passes through it, so there must
// be exactly ONE implementation. We reach the lib's own through the public
// global (as abilities reaches resolveLevelValue) rather than a static deep
// import: same implementation, no second copy, but a missing or late-loading lib
// degrades to "undetermined" (offered, never asserted) instead of throwing at
// module load. acks-lib is a hard requirement, so this fallback is a safety net
// for a broken world, not a supported no-lib mode.
function scopeApplies(effect, ctx) {
  const fn = globalThis.acksExtras?.lib?.vocab?.scopeApplies;
  return fn ? fn(effect, ctx) : { applies: false, sign: 1, undetermined: true };
}

const ATTITUDE_COUNT = INFLUENCE_RELATIONSHIP_MOD.length; // 5 rungs
const ATTITUDE_TYPE = `${MODULE_ID}.attitude`;
// Modifier keys whose value depends on the (possibly hidden) target's stats.
const TARGET_AUTO_SOURCES = new Set(["targetWill", "alignment", "levelGap", "age"]);
const TARGET_KEYS = new Set(["targetMorale", "bribeFee"]);

/**
 * Resolves the three kinds of ACKS II influence rolls (Diplomacy, Intimidation,
 * Seduction). Builds the tone-specific set of modifiers, auto-populates values
 * from the actor and targeted token, rolls 2d6 + modifiers against the reaction
 * table, and either establishes an initial reaction or shifts a current attitude.
 */
export default class InfluenceApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor = null;
  #targetActor = null;
  #system = null;
  /** Current per-tone modifier values (may be user-overridden). */
  #modifiers = null;
  /** Detected per-tone default values, used by "reset to defaults". */
  #defaults = null;
  #autoKeys = autoKeysByTone();
  /** Actor-specific modifier config: static groups + an effect-granted group. */
  #modConfig = null;
  /** The stored-attitude Item for the current influencer→target, if any. */
  #attitudeItem = null;
  /** Forces the hidden (GM-whisper) posting path when a GM resolves a player's roll. */
  #forceHidden = false;
  /** Externally injected modifiers (api.open(actor, {modifiers: [{label, value}]})). */
  #externalModifiers = [];
  /** External mode (hiring / loyalty page hosted for consumer modules). */
  #modeId = "";
  #mode = null;
  /** Caller-supplied auto values and select options for the external mode. */
  #ctx = {};
  /** Opaque correlation payload echoed back in the rollComplete hook. */
  #extContext = null;
  /** Sum of relationship + tone modifiers (before the GM adjustment bucket). */
  #subtotal = 0;
  /** Effective modifier applied to the roll (#subtotal + GM adjustment). */
  #finalModifier = 0;

  /** socketlib module socket, set in module.mjs on `socketlib.ready`. */
  static socket = null;

  constructor(options = {}) {
    super(options);

    this.#actor = options.actor ?? null;
    this.#targetActor = options.targetActor ?? getTargetActor();
    // Other modules (e.g. acks-henchmen: per-settlement slander penalties) can
    // inject flat modifiers; they apply to every tone and show on the card.
    this.#externalModifiers = Array.isArray(options.modifiers)
      ? options.modifiers
          .map((m) => ({ label: String(m?.label ?? "external"), value: Number(m?.value) || 0 }))
          .filter((m) => m.value !== 0)
      : [];
    // Don't auto-fill the target with the influencer themselves (e.g. a
    // self-targeted token) — keep the two sides distinct until set explicitly.
    if (this.#targetActor && this.#targetActor === this.#actor) this.#targetActor = null;

    // External mode: a consumer-module page (hiring / loyalty) replaces the
    // three core tones; tone selector and attitude tracker hide.
    this.#modeId = options.mode ?? "";
    this.#mode = EXTERNAL_MODES[this.#modeId] ?? null;
    this.#ctx = options.ctx ?? {};
    this.#extContext = options.context ?? null;

    this.#modConfig = this.#buildModConfig();
    this.#defaults = computeDefaults(this.#actor, this.#targetActor, this.#modConfig, this.#ctx);
    this.#modifiers = foundry.utils.deepClone(this.#defaults);

    // External modes: rebuild the auto-key map from the mode's own groups so
    // ctx-derived fields get the wand badge and override-highlight exactly
    // like the core tones' detected values.
    if (this.#mode) {
      const keys = new Set();
      for (const group of this.#mode.groups) for (const mod of group.mods) if (mod.auto) keys.add(mod.key);
      this.#autoKeys = Object.fromEntries(Object.values(INFLUENCE_TONE).map((tone) => [tone, keys]));
    }

    this.#system = {
      tone: INFLUENCE_TONE.DIPLOMACY,
      // attempt 0 = initial reaction (sets attitude, 0 time); 1+ = influence attempts.
      attempt: 0,
      currentAttitude: 2, // Neutral
      gmAdjustment: 0, // generic GM catch-all bucket
      bribeFeeOverridden: false, // true once the GM edits the bribe fee by hand
      // Detected target race/kind tokens (comma list); editable like other autos.
      targetKind: this.#autoTargetKind(),
      targetKindOverridden: false,
    };

    this.#loadAttitude();
    this.#recalculate();
  }

  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-influence-dialog"],
    sheetConfig: false,
    window: { resizable: true, title: "ACKS-INFLUENCE.app.title" },
    position: { width: 560, height: "auto" },
    tag: "form",
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
      handler: InfluenceApp.#onChangeForm,
    },
    actions: {
      roll: InfluenceApp.#onRoll,
      setAttitude: InfluenceApp.#onSetAttitude,
      resetDefaults: InfluenceApp.#onResetDefaults,
    },
    actor: null,
  };

  static PARTS = {
    app: { template: `modules/${MODULE_ID}/templates/influence/influence.hbs` },
  };

  /** @override */
  get title() {
    const base = game.i18n.localize(this.#mode ? this.#mode.label : "ACKS-INFLUENCE.app.title");
    return this.#actor ? `${this.#actor.name}: ${base}` : base;
  }

  /* -------------------------------------------- */
  /*  Target kind (race/species typing)           */
  /* -------------------------------------------- */

  /** The detected target kind as a display string ("goblin, beastman, monster"). */
  #autoTargetKind() {
    return [...kindOf(this.#targetActor).categories].join(", ");
  }

  /**
   * The target's kind tokens for `vs`-gating and race relations: the GM's
   * override when edited, else the auto-detected categories.
   * @returns {Set<string>}
   */
  #targetCategories() {
    if (this.#system?.targetKindOverridden) return new Set(parseKindList(this.#system.targetKind));
    return kindOf(this.#targetActor).categories;
  }

  /** Kind objects for the relations lookup (override-aware on the target side). */
  #relation() {
    const target = this.#system?.targetKindOverridden
      ? { race: "", categories: this.#targetCategories() }
      : kindOf(this.#targetActor);
    return relationFor(kindOf(this.#actor), target);
  }

  /* -------------------------------------------- */
  /*  Modifier configuration                      */
  /* -------------------------------------------- */

  /**
   * The per-tone modifier config for the current actor: the static screen layout
   * plus a "Proficiencies & Powers" group synthesised from the actor's active
   * effects (see getEffectReactionMods). Effect-granted modifiers render as
   * checkboxes — default on when non-situational, off when the GM must confirm.
   */
  #buildModConfig() {
    // WHOSE effects feed this page. Usually the actor working the roll — but a
    // morale or obedience check is the creature's own, and reading the roller's
    // effects there would apply an employer's powers to his hireling's nerve.
    const subject = this.#mode?.subject === "target" ? this.#targetActor : this.#actor;
    // Two sources, one shape. Active Effects first — an item that carries one
    // has overridden whatever its abilities model says, so it claims that item.
    // A third source is not an effect at all: a proficiency detected by name,
    // whose static row already offers the same ability. That claim is made per
    // page (below), because which proficiencies get a row differs by page, and
    // always against `this.#actor` — the static rows read the roller's
    // proficiencies (computeDefaults) even on a page whose effects are the
    // subject's, so the roller's items are the ones that can speak twice.
    const aeMods = getEffectReactionMods(subject);
    const aeClaimed = itemsWithReactionEffects(subject);
    const effectMods = [...aeMods, ...getAbilityReactionMods(subject, aeClaimed)];
    const targetAlign = toLibAlignment(classifyAlignment(this.#targetActor?.system?.details?.alignment));
    const targetCats = this.#targetCategories();
    const config = {};

    /**
     * Rename a proficiency box after the power standing in for it — but only
     * while the character lacks the proficiency itself, since holding both is
     * one non-stacking capability and the canonical name is the one to show.
     *
     * The rename is stamped onto the config, not applied at render, because the
     * chat card lists what contributed by the same labels; resolving it in the
     * view would print the power's name in the dialog and the proficiency's on
     * the card. The frozen table is copied, never written to.
     */
    const actsAs = getActsAsPowers(this.#actor);
    const ownProfs = getProficiencies(this.#actor);
    const nameAfterPower = (mod) => {
      const key = mod.auto?.startsWith("prof:") ? mod.auto.slice(5) : null;
      if (!key || !actsAs[key] || ownProfs[key]) return mod;
      return { ...mod, label: actsAs[key].label, actsAs: true };
    };

    // Campaign race-relations row (asymmetric registry / world setting) —
    // applies to every tone and both external modes (RAW Inhumanity wording
    // covers reactions, loyalty, and morale alike).
    const relation = this.#relation();
    const relationGroup = relation
      ? {
          group: "ACKS-INFLUENCE.group.racial",
          mods: [
            {
              key: "raceRelation",
              type: "signed",
              label: relation.label || "ACKS-INFLUENCE.mod.raceRelation",
              default: relation.value,
              fromEffect: true,
            },
          ],
        }
      : null;

    /**
     * An effect-granted checkbox row, gated by acks-lib's `scopeApplies`.
     *
     * Three outcomes, and the middle one is the point:
     *   applies       pre-checked, unless the effect is also situational
     *   fails         unchecked — a known mismatch
     *   undetermined  unchecked, but offered — the scope could not be settled
     *                 (untyped target, no tone yet), which is not the same as
     *                 failing. Every row stays GM-toggleable regardless.
     *
     * An UNAUDITED row never pre-checks whatever the scope says. Its sign and
     * conditions came from a generic scan, not from a chef reading the page, so
     * it is offered rather than asserted (recipes-not-rules doctrine).
     */
    const effectModRow = (m, tone) => {
      const scope = scopeApplies(m, {
        kinds: targetCats,
        alignment: targetAlign,
        tone: tone ?? null,
        optionalRules: this.#optionalRules(),
      });
      // In `sign` mode the stored value is the matching case, so a mismatch
      // negates it: Deathly Visage's +2 vs Chaotic becomes -2 vs everyone else.
      const value = scope.sign * m.value;
      const def = scope.applies && !m.situational && !m.unaudited;
      return {
        key: m.id,
        type: "check",
        label: m.label,
        value,
        default: def,
        fromEffect: true,
        unaudited: Boolean(m.unaudited),
        bewitched: Number.isFinite(m.kickerAt),
        kickerAt: m.kickerAt ?? null,
        // Target-scoped: the GM's real target data decides on hidden resolves.
        vsGated: Boolean(m.vsKinds?.length || m.vsAlignment),
      };
    };

    // External mode: one modifier layout for every tone key (the tone
    // selector is hidden). `ctxOptions` selects materialize from the ctx bag.
    if (this.#mode) {
      const groups = this.#mode.groups.map((g) => ({
        group: g.group,
        mods: g.mods
          .map((m) =>
            m.ctxOptions ? { ...m, options: this.#ctx[m.ctxOptions] ?? [{ label: "ACKS-INFLUENCE.opt.dash", value: 0 }] } : m
          )
          .map(nameAfterPower),
      }));
      // Only effects feeding THIS page's roll family. A hiring offer is a
      // reaction roll; a loyalty roll is not, so a Diplomacy bonus must not
      // reach it while Inhumanity's loyalty change must. An external page has
      // no tone of its own, hence none to gate on.
      const family = this.#mode.family ?? ROLL_FAMILY.REACTION;
      const forFamily = effectRowsForPage(effectMods, {
        family,
        claimed: itemsWithProficiencyRows(this.#actor, groups),
      });
      if (forFamily.length) {
        groups.push({ group: "ACKS-INFLUENCE.group.powers", mods: forFamily.map((m) => effectModRow(m, null)) });
      }
      if (relationGroup) groups.push(relationGroup);
      for (const tone of Object.values(INFLUENCE_TONE)) config[tone] = groups;
      return config;
    }
    for (const tone of Object.values(INFLUENCE_TONE)) {
      const groups = INFLUENCE_MODIFIERS[tone].map((g) => ({ group: g.group, mods: g.mods.map(nameAfterPower) }));
      const forTone = effectRowsForPage(effectMods, {
        family: ROLL_FAMILY.REACTION,
        tone,
        claimed: itemsWithProficiencyRows(this.#actor, groups),
      });
      if (forTone.length) {
        groups.push({ group: "ACKS-INFLUENCE.group.powers", mods: forTone.map((m) => effectModRow(m, tone)) });
      }
      if (relationGroup) groups.push(relationGroup);
      config[tone] = groups;
    }
    return config;
  }

  /**
   * World settings that gate `optionalRule` effects, in the shape
   * `scopeApplies` expects. A rule with no registered setting is absent from
   * the map, which lib reads as enabled.
   */
  #optionalRules() {
    return { btaCaste: optionalRuleEnabled("btaCaste") };
  }

  /* -------------------------------------------- */
  /*  Modifier maths                              */
  /* -------------------------------------------- */

  #contribution(mod, value) {
    switch (mod.type) {
      case "check":
        return value ? mod.value : 0;
      case "select":
      case "signed":
        return Number(value) || 0;
      case "factor":
        return mod.factor * (Number(value) || 0);
      case "gold": // a gp amount (e.g. the bribe fee) — never modifies the roll
      default:
        return 0;
    }
  }

  /* -------------------------------------------- */
  /*  Bribe fee                                   */
  /* -------------------------------------------- */

  /**
   * Auto-computed bribe fee (gp) from the target's HD and the chosen bribe bonus:
   * +1/+2/+3 = a day / week / month of pay (a week / month / year without the
   * Bribery proficiency), where "a month" is the henchman wage for the target's HD.
   */
  /** The gp cost of each bribe tier (+1/+2/+3) for the current actor/target pair. */
  #bribeTiers() {
    const monthly = monthlyWageForHD(getActorHD(this.#targetActor));
    const day = Math.round(monthly / 30);
    const week = Math.round(monthly / 4);
    const year = monthly * 12;
    const hasBribery = getProficiencies(this.#actor).bribery;
    return hasBribery ? { 1: day, 2: week, 3: monthly } : { 1: week, 2: monthly, 3: year };
  }

  #computeBribeFee() {
    const diplo = this.#modifiers[INFLUENCE_TONE.DIPLOMACY];
    const level = Number(diplo.bribe) || 0;
    if (level <= 0) return 0;
    return this.#bribeTiers()[level] ?? 0;
  }

  /** The bribe bonus (+0..+3) a blind gp offer buys against the real wage tiers. */
  #bonusForOffer(offer) {
    const tiers = this.#bribeTiers();
    let bonus = 0;
    for (const level of [1, 2, 3]) if (offer >= tiers[level]) bonus = level;
    return bonus;
  }

  /** Refresh the auto bribe fee unless the GM has overridden it. */
  #syncBribeFee() {
    if (this.#system.bribeFeeOverridden) return;
    this.#modifiers[INFLUENCE_TONE.DIPLOMACY].bribeFee = this.#computeBribeFee();
  }

  /* -------------------------------------------- */
  /*  Stored attitude (persistence)               */
  /* -------------------------------------------- */

  /** Load the saved attitude/attempts for the current influencer→target, if any. */
  #loadAttitude() {
    this.#attitudeItem = null;
    if (!this.#actor || !this.#targetActor) return;
    const uuid = this.#targetActor.uuid;
    const item = this.#actor.items?.find((i) => i.type === ATTITUDE_TYPE && i.system?.targetUuid === uuid);
    if (!item) return;
    this.#attitudeItem = item;
    this.#system.currentAttitude = item.system.attitude ?? this.#system.currentAttitude;
    this.#system.attempt = item.system.attempts?.[this.#system.tone] ?? this.#system.attempt;
  }

  /** Persist the new attitude and this tone's attempt count (owner only). */
  async #saveAttitude(newIndex, nextAttempt) {
    if (!this.#actor?.isOwner || !this.#targetActor) return;
    const tone = this.#system.tone;
    try {
      if (this.#attitudeItem) {
        await this.#attitudeItem.update({ "system.attitude": newIndex, [`system.attempts.${tone}`]: nextAttempt });
      } else {
        const created = await this.#actor.createEmbeddedDocuments("Item", [
          {
            name: game.i18n.format("ACKS-INFLUENCE.attitude.itemName", { name: this.#targetActor.name }),
            type: ATTITUDE_TYPE,
            img: this.#targetActor.img || undefined,
            system: {
              targetUuid: this.#targetActor.uuid,
              targetName: this.#targetActor.name,
              targetImg: this.#targetActor.img || "",
              attitude: newIndex,
              attempts: { [tone]: nextAttempt },
            },
          },
        ]);
        this.#attitudeItem = created?.[0] ?? null;
      }
      // Consumer-module event: the stored relationship changed.
      Hooks.callAll("acksExtras.influenceAttitudeChanged", {
        actor: this.#actor,
        target: this.#targetActor,
        attitude: newIndex,
        tone,
        attempt: nextAttempt,
      });
    } catch (err) {
      console.error(`${MODULE_ID} | failed to save attitude`, err);
    }
  }

  #relationshipModifier() {
    if (this.#mode) return 0; // external modes carry no attitude ladder
    return INFLUENCE_RELATIONSHIP_MOD[this.#system.currentAttitude] ?? 0;
  }

  #computeSubtotal() {
    const values = this.#modifiers[this.#system.tone];
    let total = this.#relationshipModifier();
    for (const group of this.#modConfig[this.#system.tone]) {
      for (const mod of group.mods) {
        total += this.#contribution(mod, values[mod.key]);
      }
    }
    for (const external of this.#externalModifiers) total += external.value;
    return total;
  }

  #recalculate() {
    this.#syncBribeFee();
    this.#subtotal = this.#computeSubtotal();
    this.#finalModifier = this.#subtotal + (Number(this.#system.gmAdjustment) || 0);
  }

  /** Non-zero contributions (for the chat card), including relationship & GM bucket. */
  #activeModifiers() {
    const list = [];
    const rel = this.#relationshipModifier();
    if (rel !== 0) {
      const attitude = game.i18n.localize(
        INFLUENCE_ATTITUDE_LABELS[this.#system.tone][this.#system.currentAttitude],
      );
      list.push({ label: game.i18n.format("ACKS-INFLUENCE.summary.relationship", { attitude }), value: rel });
    }
    const values = this.#modifiers[this.#system.tone];
    for (const group of this.#modConfig[this.#system.tone]) {
      for (const mod of group.mods) {
        const contribution = this.#contribution(mod, values[mod.key]);
        // Effect-granted labels are literal; static labels are localization keys.
        if (contribution !== 0) list.push({ label: game.i18n.localize(mod.label), value: contribution });
      }
    }
    for (const external of this.#externalModifiers) list.push({ label: external.label, value: external.value });
    const gm = Number(this.#system.gmAdjustment) || 0;
    if (gm !== 0) list.push({ label: game.i18n.localize("ACKS-INFLUENCE.summary.gmAdjustment"), value: gm });
    return list;
  }

  /**
   * True when the current (non-GM) user cannot observe the target's sheet, so
   * the target's derived values and the roll total must be hidden from them.
   */
  #targetHidden() {
    if (!this.#targetActor || game.user?.isGM) return false;
    return !this.#targetActor.testUserPermission?.(game.user, "OBSERVER");
  }

  /** GM-side: rebuild the roll with full target data and post it (hidden path). */
  static async resolveExternal(payload = {}) {
    const actor = payload.actorUuid ? await fromUuid(payload.actorUuid) : null;
    if (!actor) return;
    const target = payload.targetUuid ? await fromUuid(payload.targetUuid) : null;
    const app = new InfluenceApp({ actor, targetActor: target });
    app.#forceHidden = true;
    app.#applyExternalState(payload);
    await app.#rollInfluence();
  }

  /** Overlay a player's request onto GM-computed defaults (keeping target autos). */
  #applyExternalState({ tone, attempt, currentAttitude, gmAdjustment, playerMods, bribeOffer }) {
    if (tone) this.#system.tone = tone;
    if (attempt !== undefined) this.#system.attempt = Number(attempt);
    if (currentAttitude !== undefined) this.#system.currentAttitude = Number(currentAttitude);
    this.#system.gmAdjustment = Number(gmAdjustment) || 0;
    const t = this.#system.tone;
    // Which keys are target-derived (keep the GM's real values for these). The
    // bribe select is also excluded: the player bids blind via bribeOffer.
    // Race relations and kind/alignment-gated effects also resolve GM-side —
    // the player can't judge a hidden target's race or alignment.
    const targetKeys = new Set(["bribe", "raceRelation"]);
    for (const group of this.#modConfig[t]) {
      for (const mod of group.mods) {
        if (TARGET_AUTO_SOURCES.has(mod.auto) || TARGET_KEYS.has(mod.key) || mod.vsGated) targetKeys.add(mod.key);
      }
    }
    for (const [k, v] of Object.entries(playerMods ?? {})) {
      if (!targetKeys.has(k) && k in this.#modifiers[t]) this.#modifiers[t][k] = v;
    }
    // Blind bribe: convert the offered gp into whatever bonus it actually buys.
    const offer = Number(bribeOffer) || 0;
    if (t === INFLUENCE_TONE.DIPLOMACY && offer > 0) {
      const diplo = this.#modifiers[INFLUENCE_TONE.DIPLOMACY];
      diplo.bribe = this.#bonusForOffer(offer);
      diplo.bribeFee = offer; // the full offer is what changes hands
      this.#system.bribeFeeOverridden = true;
    }
    this.#recalculate();
  }

  /**
   * Player-side: hand the roll to a GM (via socketlib) to resolve against a
   * hidden target, whose data the player's client doesn't have.
   */
  #requestGmRoll() {
    if (!game.users?.activeGM) {
      ui.notifications?.warn(game.i18n.localize("ACKS-INFLUENCE.hidden.noGm"));
      return;
    }
    const payload = {
      actorUuid: this.#actor?.uuid,
      targetUuid: this.#targetActor?.uuid,
      tone: this.#system.tone,
      attempt: this.#system.attempt,
      currentAttitude: this.#system.currentAttitude,
      gmAdjustment: this.#system.gmAdjustment,
      playerMods: foundry.utils.deepClone(this.#modifiers[this.#system.tone]),
      // Blind bribe guess: the gp the player offers without knowing the tiers.
      bribeOffer: Number(this.#modifiers[INFLUENCE_TONE.DIPLOMACY]?.bribeFee) || 0,
    };
    getSocket()
      .executeAsGM("resolveHiddenRoll", payload)
      .catch((err) => console.error(`${MODULE_ID} | hidden roll relay failed`, err));
    ui.notifications?.info(game.i18n.localize("ACKS-INFLUENCE.hidden.sentToGm"));
  }

  /**
   * Whether a "bewitched at 12+" source is active: the Mystic Aura box (which a
   * power may fill), or any contributing effect flagged `bewitched`.
   */
  #bewitchedActive() {
    const values = this.#modifiers[this.#system.tone];
    if (values?.mysticAura) return true;
    for (const group of this.#modConfig[this.#system.tone]) {
      for (const mod of group.mods) {
        if (mod.bewitched && this.#contribution(mod, values[mod.key]) !== 0) return true;
      }
    }
    return false;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  #attitudeLadder() {
    const labels = INFLUENCE_ATTITUDE_LABELS[this.#system.tone];
    return labels.map((label, index) => ({
      index,
      label: game.i18n.localize(label),
      modifier: INFLUENCE_RELATIONSHIP_MOD[index],
      isActive: index === this.#system.currentAttitude,
    }));
  }

  #buildGroups() {
    const tone = this.#system.tone;
    const values = this.#modifiers[tone];
    const defaults = this.#defaults[tone];
    const autoKeys = this.#autoKeys[tone];
    const profs = getProficiencies(this.#actor);
    const hidden = this.#targetHidden();
    const L = (s) => game.i18n.localize(s);
    return this.#modConfig[tone].map((group) => ({
      group: L(group.group),
      mods: group.mods.map((mod) => {
        const value = values[mod.key];
        const isAuto = autoKeys.has(mod.key);
        const isGold = mod.type === "gold";
        // A power standing in for a core prof already renamed this box when the
        // config was built (nameAfterPower); the badge is all that is left to
        // read. Its label is literal text, and localize passes it through.
        const isActsAs = Boolean(mod.actsAs);
        // Hidden bribe: the player can't see the tiers, so the fee field becomes
        // a blind "offered payment" guess (bonus computed on GM resolve) and the
        // bribe bonus select is masked instead.
        const isBribeGuess = hidden && mod.key === "bribeFee";
        let label = L(mod.label);
        if (isBribeGuess) label = L("ACKS-INFLUENCE.mod.diplomacy.bribeOffer");
        // A value computed from a proficiency the character has (e.g. Bribery
        // scaling the bribe fee) is flagged so it gets the proficiency badge.
        const isProfModified = Boolean(mod.profModifier && profs[mod.profModifier]);
        return {
          key: mod.key,
          // Effect-granted labels are literal text; localize() passes them through.
          label,
          isCheck: mod.type === "check",
          isSelect: mod.type === "select",
          isNumber: mod.type === "signed" || mod.type === "factor",
          isGold,
          isEffect: Boolean(mod.fromEffect) || isProfModified || isActsAs,
          // A machine-classified mechanic, badged so the sheet never presents a
          // scan's guess as the book's ruling.
          unaudited: Boolean(mod.unaudited),
          masked:
            hidden &&
            !isBribeGuess &&
            (TARGET_AUTO_SOURCES.has(mod.auto) ||
              TARGET_KEYS.has(mod.key) ||
              mod.key === "bribe" ||
              mod.key === "raceRelation"),
          value,
          checked: mod.type === "check" ? Boolean(value) : false,
          options:
            mod.type === "select"
              ? mod.options.map((opt) => ({ value: opt.value, label: L(opt.label), selected: Number(opt.value) === Number(value) }))
              : null,
          contribution: this.#contribution(mod, value),
          // Show the proficiency badge in place of the generic auto badge.
          isAuto: isAuto && !isProfModified,
          isOverridden: isGold
            ? this.#system.bribeFeeOverridden
            : isAuto && String(value) !== String(defaults[mod.key]),
        };
      }),
    }));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    this.#recalculate();

    context.system = this.#system;
    context.isContinuing = this.#system.attempt > 0;

    context.toneChoices = INFLUENCE_TONE_CHOICES;
    context.timeChoices = INFLUENCE_TIME_STEPS;

    context.parties = resolveParties(this.#actor, this.#targetActor);
    context.hasTarget = Boolean(this.#targetActor);
    context.ladder = this.#attitudeLadder();
    context.groups = this.#buildGroups();
    context.relationshipModifier = this.#relationshipModifier();
    context.finalModifier = this.#finalModifier;
    context.targetHidden = this.#targetHidden();
    context.targetKindOverridden = this.#system.targetKindOverridden;

    const timeStep = INFLUENCE_TIME_STEPS.find((step) => step.value === this.#system.attempt);
    context.timeLabel = timeStep ? game.i18n.localize(timeStep.label) : "";

    // External mode: hide the tone selector, attitude ladder, and attempt
    // tracker; the page shows only the mode's own modifier groups.
    context.externalMode = !!this.#mode;
    context.modeLabel = this.#mode ? game.i18n.localize(this.#mode.label) : "";
    if (this.#mode) {
      context.isContinuing = false;
      context.parties = resolveParties(this.#actor, this.#targetActor);
      if (!this.#targetActor && this.#ctx.targetName) {
        context.parties.target = { name: this.#ctx.targetName, img: this.#ctx.targetImg ?? "icons/svg/mystery-man.svg" };
        context.hasTarget = true;
      }
    }

    return context;
  }

  /* -------------------------------------------- */
  /*  Event handlers                              */
  /* -------------------------------------------- */

  /**
   * @this {InfluenceApp}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onChangeForm(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);

    // Detect a GM-bucket / total override against the CURRENTLY RENDERED values,
    // before any modifier change shifts the subtotal. Only one field changes per
    // submit event, so a mismatch pinpoints which the user edited; editing the
    // total overrides it as a generic GM bucket (its delta from the subtotal).
    const renderedGm = Number(this.#system.gmAdjustment) || 0;
    const renderedTotal = this.#subtotal + renderedGm;
    let totalOverride = null;
    let gmOverride = null;
    if (data.finalTotal !== undefined && Number(data.finalTotal) !== renderedTotal) {
      totalOverride = Number(data.finalTotal);
    } else if (data.gmAdjustment !== undefined && Number(data.gmAdjustment) !== renderedGm) {
      gmOverride = Number(data.gmAdjustment) || 0;
    }

    // A hand-edited bribe fee (vs. the rendered auto value) latches an override.
    const renderedBribeFee = Number(this.#modifiers[INFLUENCE_TONE.DIPLOMACY].bribeFee) || 0;
    if (data.mod?.bribeFee !== undefined && Number(data.mod.bribeFee) !== renderedBribeFee) {
      this.#system.bribeFeeOverridden = true;
    }

    // An edited target kind re-gates `vs`-scoped effects and the relations row.
    if (data.targetKind !== undefined && String(data.targetKind) !== this.#system.targetKind) {
      this.#system.targetKind = String(data.targetKind);
      this.#system.targetKindOverridden = String(data.targetKind).trim() !== this.#autoTargetKind();
      this.#regateForKind();
    }

    // Persist the currently-displayed tone's modifier values before switching tone.
    const previousTone = this.#system.tone;
    if (data.mod) {
      // Ticking a member of an exclusive set clears its peers, so the mutual
      // exclusivity that computeDefaults applies to auto-population also holds
      // when the GM ticks a box by hand.
      const groups = this.#modConfig[previousTone] ?? [];
      for (const [key, value] of Object.entries(data.mod)) {
        if (value !== true || this.#modifiers[previousTone][key] === true) continue;
        for (const peer of exclusivePeers(groups, key)) data.mod[peer] = false;
      }
      this.#modifiers[previousTone] = foundry.utils.mergeObject(this.#modifiers[previousTone], data.mod, {
        inplace: false,
      });
    }

    if (data.tone) this.#system.tone = data.tone;
    if (data.attempt !== undefined) this.#system.attempt = Number(data.attempt);
    if (data.currentAttitude !== undefined) this.#system.currentAttitude = Number(data.currentAttitude);
    // Switching tone resumes that tone's stored attempt count.
    if (data.tone && data.tone !== previousTone && this.#attitudeItem) {
      this.#system.attempt = this.#attitudeItem.system.attempts?.[data.tone] ?? 0;
    }

    this.#subtotal = this.#computeSubtotal();
    if (totalOverride !== null) this.#system.gmAdjustment = totalOverride - this.#subtotal;
    else if (gmOverride !== null) this.#system.gmAdjustment = gmOverride;

    this.#recalculate();
    this.render();
  }

  /**
   * @this {InfluenceApp}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onSetAttitude(_event, target) {
    const index = Number(target.dataset.index);
    if (Number.isNaN(index) || index < 0 || index >= ATTITUDE_COUNT) return;
    this.#system.currentAttitude = index;
    this.#recalculate();
    this.render();
  }

  /**
   * Re-detect values from the actor/target and reset the current tone's fields.
   * @this {InfluenceApp}
   */
  static #onResetDefaults() {
    // Re-read the current target so a newly-selected token is picked up.
    this.#targetActor = getTargetActor() ?? this.#targetActor;
    this.#system.targetKindOverridden = false;
    this.#system.targetKind = this.#autoTargetKind();
    this.#modConfig = this.#buildModConfig();
    this.#defaults = computeDefaults(this.#actor, this.#targetActor, this.#modConfig, this.#ctx);
    const tone = this.#system.tone;
    this.#modifiers[tone] = foundry.utils.deepClone(this.#defaults[tone]);
    this.#system.gmAdjustment = 0; // clear the GM bucket / total override
    this.#system.bribeFeeOverridden = false; // re-detect the bribe fee
    this.#loadAttitude();
    this.#recalculate();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Drag & drop of actors/tokens onto a side    */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const el of this.element.querySelectorAll(".influence-party[data-side]")) {
      el.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        el.classList.add("drop-hover");
      });
      el.addEventListener("dragleave", () => el.classList.remove("drop-hover"));
      el.addEventListener("drop", (ev) => this.#onDropActor(ev, el.dataset.side));
    }
  }

  async #onDropActor(event, side) {
    event.preventDefault();
    event.currentTarget?.classList?.remove("drop-hover");
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    let actor = null;
    if (data?.type === "Actor") actor = (await fromUuid(data.uuid)) ?? game.actors.get(data.id);
    else if (data?.type === "Token") actor = (await fromUuid(data.uuid))?.actor ?? null;
    if (!actor) return;

    if (side === "target") this.#targetActor = actor;
    else this.#actor = actor;
    this.#refreshFromActors();
    this.render();
  }

  /** Rebuild config + re-apply auto/effect values for the current actors, keeping manual edits. */
  #refreshFromActors() {
    // A new target invalidates any manual kind override.
    this.#system.targetKindOverridden = false;
    this.#system.targetKind = this.#autoTargetKind();
    this.#modConfig = this.#buildModConfig();
    const newDefaults = computeDefaults(this.#actor, this.#targetActor, this.#modConfig, this.#ctx);
    for (const tone of Object.keys(newDefaults)) {
      const merged = { ...this.#modifiers[tone] };
      for (const group of this.#modConfig[tone]) {
        for (const mod of group.mods) {
          // Refresh auto-detected and effect-granted values; add any new keys.
          if ((mod.auto && mod.auto !== "bribeFee") || mod.fromEffect || !(mod.key in merged)) {
            merged[mod.key] = newDefaults[tone][mod.key];
          }
        }
      }
      this.#modifiers[tone] = merged;
    }
    this.#defaults = newDefaults;
    this.#system.bribeFeeOverridden = false; // re-detect fee for the new target
    this.#loadAttitude();
    this.#recalculate();
  }

  /**
   * Rebuild the modifier config after a target-kind edit and re-apply only the
   * kind-sensitive defaults (`vs`-gated effects and the relations row), keeping
   * every other manual edit intact.
   */
  #regateForKind() {
    this.#modConfig = this.#buildModConfig();
    const newDefaults = computeDefaults(this.#actor, this.#targetActor, this.#modConfig, this.#ctx);
    for (const tone of Object.keys(newDefaults)) {
      const merged = { ...this.#modifiers[tone] };
      for (const group of this.#modConfig[tone]) {
        for (const mod of group.mods) {
          if (mod.vsGated || mod.key === "raceRelation" || !(mod.key in merged)) {
            merged[mod.key] = newDefaults[tone][mod.key];
          }
        }
      }
      this.#modifiers[tone] = merged;
    }
    this.#defaults = newDefaults;
    this.#recalculate();
  }

  /**
   * @this {InfluenceApp}
   */
  static async #onRoll() {
    await this.#rollInfluence();
  }

  /* -------------------------------------------- */
  /*  Rolling                                     */
  /* -------------------------------------------- */

  #applyShift(baseIndex, band) {
    if (band.towardNeutral) {
      if (baseIndex < 2) return baseIndex + 1;
      if (baseIndex > 2) return baseIndex - 1;
      return 2;
    }
    return Math.min(ATTITUDE_COUNT - 1, Math.max(0, baseIndex + band.shift));
  }

  #shiftDescription(band) {
    const label = game.i18n.localize(INFLUENCE_ATTITUDE_LABELS[this.#system.tone][ATTITUDE_COUNT - 1]);
    switch (band.key) {
      case "2-":
        return game.i18n.localize("ACKS-INFLUENCE.shift.hostile2");
      case "3-5":
        return game.i18n.localize("ACKS-INFLUENCE.shift.hostile1");
      case "6-8":
        return game.i18n.localize("ACKS-INFLUENCE.shift.neutral1");
      case "9-11":
        return game.i18n.format("ACKS-INFLUENCE.shift.top1", { label });
      case "12+":
        return game.i18n.format("ACKS-INFLUENCE.shift.top2", { label });
      default:
        return "";
    }
  }

  /* -------------------------------------------- */
  /*  Bribe gold movement                         */
  /* -------------------------------------------- */

  async #maybePayBribe() {
    if (this.#system.tone !== INFLUENCE_TONE.DIPLOMACY) return null;
    const diplo = this.#modifiers[INFLUENCE_TONE.DIPLOMACY];
    const level = Number(diplo.bribe) || 0;
    const fee = Number(diplo.bribeFee) || 0;
    if (level <= 0 || fee <= 0) return null;
    return this.#moveBribeGold(fee);
  }

  async #moveBribeGold(fee) {
    const from = this.#actor;
    const to = this.#targetActor;
    let deducted = false;
    let credited = false;
    try {
      if (from?.isOwner) deducted = await this.#adjustGold(from, -fee);
      if (to && to !== from && to.isOwner) credited = await this.#adjustGold(to, fee);
    } catch (err) {
      console.error(`${MODULE_ID} | bribe gold move failed`, err);
    }
    if (from && !deducted) {
      ui.notifications?.warn(game.i18n.format("ACKS-INFLUENCE.bribe.noGold", { name: from.name }));
    }
    return { fee, from: deducted ? from?.name ?? null : null, to: credited ? to?.name ?? null : null };
  }

  /** Adjust an actor's Gold money item by `delta` gp (creating it on credit). */
  async #adjustGold(actor, delta) {
    const gold = actor.items.find((i) => i.type === "money" && /gold/i.test(i.name));
    if (!gold) {
      if (delta > 0) {
        await actor.createEmbeddedDocuments("Item", [
          { name: "Gold", type: "money", system: { quantity: delta } },
        ]);
        return true;
      }
      return false;
    }
    const current = Number(gold.system?.quantity) || 0;
    await gold.update({ "system.quantity": Math.max(0, current + delta) });
    return true;
  }

  /**
   * RAW consequence notes for the chat card (no attitude auto-shifts): the
   * temporary/combat aftermath of intimidation and the bribery crime/failed-bribe
   * rules. Purely informational, straight from the printed rules.
   */
  #rawNotes(tone, newIndex, diceResult) {
    const notes = [];
    if (tone === INFLUENCE_TONE.INTIMIDATION) {
      notes.push(game.i18n.localize("ACKS-INFLUENCE.note.intimTemporary"));
      if (newIndex === 3) notes.push(game.i18n.localize("ACKS-INFLUENCE.note.intimidated"));
      else if (newIndex === 4) notes.push(game.i18n.localize("ACKS-INFLUENCE.note.overawed"));
    }
    if (tone === INFLUENCE_TONE.DIPLOMACY && (Number(this.#modifiers[INFLUENCE_TONE.DIPLOMACY].bribe) || 0) > 0) {
      const hasBribery = getProficiencies(this.#actor).bribery;
      if (hasBribery) {
        if (diceResult === 2) notes.push(game.i18n.localize("ACKS-INFLUENCE.note.bribeCrime"));
      } else {
        notes.push(game.i18n.localize("ACKS-INFLUENCE.note.bribeRisk"));
      }
    }
    // RAW hard hatreds (MM): automatic-reaction pairs like dwarf↔goblin are
    // surfaced as notes only — the Judge decides, no forced result.
    for (const key of hatredNotes(kindOf(this.#actor).categories, this.#targetCategories())) {
      notes.push(game.i18n.localize(key));
    }
    return { rawNotes: notes };
  }

  /** External-mode resolution: bands + natural clamps, no attitude shift. */
  async #rollExternalMode() {
    this.#recalculate();
    const activeModifiers = this.#activeModifiers();
    const modifier = this.#finalModifier;
    const roll = new Roll(`2d6 + (${modifier})`);
    await roll.evaluate();
    const diceResult = roll.dice[0]?.total ?? roll.total - modifier;
    const total = roll.total;

    const bands = this.#mode.bands;
    const indexFor = (value) =>
      Math.max(
        0,
        bands.findIndex((b) => (b.min === undefined || value >= b.min) && (b.max === undefined || value <= b.max))
      );
    let idx = indexFor(total);
    const clamps = this.#mode.naturalClamps;
    if (clamps) {
      if (diceResult === 2 && clamps.natural2) {
        const cap = bands.findIndex((b) => b.key === clamps.natural2);
        if (cap >= 0 && idx > cap) idx = cap;
      }
      if (diceResult === 12 && clamps.natural12) {
        const floor = bands.findIndex((b) => b.key === clamps.natural12);
        if (floor >= 0 && idx < floor) idx = floor;
      }
    }
    const outcome = bands[idx]?.key ?? bands[0].key;

    const result = {
      modeLabel: game.i18n.localize(this.#mode.label),
      influencerName: this.#actor?.name ?? "",
      targetName: this.#targetActor?.name ?? this.#ctx.targetName ?? "",
      rollFormula: `2d6 + (${modifier})`,
      diceResult,
      modifier,
      total,
      activeModifiers,
      outcome,
      outcomeLabel: game.i18n.localize(this.#mode.bandLabels[outcome] ?? outcome),
      secret: !!this.#mode.secret,
    };

    const speaker = ChatMessage.getSpeaker({ actor: this.#actor });
    const content = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/influence/mode-result.hbs`,
      result
    );
    ChatMessage.create({
      user: game.user.id,
      speaker,
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      rolls: [roll],
      whisper: this.#mode.secret ? ChatMessage.getWhisperRecipients("GM").map((u) => u.id) : [],
      flags: { [MODULE_ID]: { mode: this.#modeId, outcome, rollResult: result } },
    });

    Hooks.callAll("acksExtras.influenceRollComplete", {
      actor: this.#actor,
      target: this.#targetActor,
      mode: this.#modeId,
      outcome,
      natural: diceResult,
      modifier,
      total,
      parts: activeModifiers,
      context: this.#extContext,
      hidden: !!this.#mode.secret,
    });
    if (this.rendered) this.render();
  }

  async #rollInfluence() {
    // External modes (hiring / loyalty) resolve on their own band tables.
    if (this.#mode) {
      await this.#rollExternalMode();
      return;
    }

    // A player can't see the hidden target's data to compute the roll, so hand
    // it to the GM's client (which has it) and resolve there.
    if (this.#targetHidden()) {
      this.#requestGmRoll();
      return;
    }

    this.#recalculate();

    // Capture the active modifiers before the roll (state is unchanged by rolling).
    const activeModifiers = this.#activeModifiers();
    const bewitchedActive = this.#bewitchedActive();

    const modifier = this.#finalModifier;
    const roll = new Roll(`2d6 + (${modifier})`);
    await roll.evaluate();

    const diceResult = roll.dice[0]?.total ?? roll.total - modifier;
    const total = roll.total;

    const band = INFLUENCE_BANDS.find((b) => total >= b.min && total <= b.max);

    const tone = this.#system.tone;
    const labels = INFLUENCE_ATTITUDE_LABELS[tone];
    // Attempt 0 is the initial reaction (sets the attitude); 1+ shifts it.
    const isContinuing = this.#system.attempt > 0;

    const startIndex = this.#system.currentAttitude;
    const newIndex = isContinuing ? this.#applyShift(startIndex, band) : band.initialIndex;

    const toneLabel = game.i18n.localize(
      INFLUENCE_TONE_CHOICES.find((t) => t.value === tone)?.label ?? tone,
    );
    const timeStep = INFLUENCE_TIME_STEPS.find((step) => step.value === this.#system.attempt);

    // If a bribe was offered with a fee, move the gold now.
    const bribePaid = await this.#maybePayBribe();

    const result = {
      toneLabel,
      bribePaid,
      influencerName: this.#actor?.name ?? game.i18n.localize("ACKS-INFLUENCE.party.influencer"),
      targetName: this.#targetActor?.name ?? game.i18n.localize("ACKS-INFLUENCE.party.target"),
      isContinuing,
      rollFormula: `2d6 + (${modifier})`,
      diceResult,
      modifier,
      total,
      activeModifiers,
      bandLabel: game.i18n.localize(INFLUENCE_BAND_LABELS[tone][band.key]),
      startAttitude: game.i18n.localize(labels[startIndex]),
      resultAttitude: game.i18n.localize(labels[newIndex]),
      shiftDescription: isContinuing ? this.#shiftDescription(band) : null,
      // Mystic Aura / aura-power kicker: a total of 12+ bewitches the subject.
      bewitched: bewitchedActive && total >= 12,
      attempt: this.#system.attempt,
      timeLabel: isContinuing && timeStep ? game.i18n.localize(timeStep.label) : null,
      ...this.#rawNotes(tone, newIndex, diceResult),
    };

    const speaker = ChatMessage.getSpeaker({ actor: this.#actor });
    const template = `modules/${MODULE_ID}/templates/influence/influence-result.hbs`;
    // GM resolving a player's request uses the hidden path via #forceHidden.
    const hidden = this.#targetHidden() || this.#forceHidden;

    if (hidden) {
      // Full details to GMs only; a public message reveals just the attitude.
      const full = await foundry.applications.handlebars.renderTemplate(template, result);
      ChatMessage.create({
        user: game.user.id,
        speaker,
        content: full,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        rolls: [roll],
        whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
        flags: { [MODULE_ID]: { influence: true, rollResult: result } },
      });
      const reveal = await foundry.applications.handlebars.renderTemplate(template, { ...result, attitudeOnly: true });
      ChatMessage.create({ user: game.user.id, speaker, content: reveal, style: CONST.CHAT_MESSAGE_STYLES.OTHER });
    } else {
      const content = await foundry.applications.handlebars.renderTemplate(template, result);
      ChatMessage.create({
        user: game.user.id,
        speaker,
        content,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        rolls: [roll],
        flags: { [MODULE_ID]: { influence: true, rollResult: result } },
      });
    }

    // Advance the tracker to the new attitude and step to the next attempt level
    // (the initial reaction rolls into the 1st attempt to influence).
    this.#system.currentAttitude = newIndex;
    const nextAttempt = Math.min(INFLUENCE_TIME_STEPS.length - 1, this.#system.attempt + 1);
    this.#system.attempt = nextAttempt;
    // Persist the updated relationship (auto save/load).
    void this.#saveAttitude(newIndex, nextAttempt);
    this.#recalculate();

    // Consumer-module event (acks-henchmen etc.): the full resolved roll.
    Hooks.callAll("acksExtras.influenceRollComplete", {
      actor: this.#actor,
      target: this.#targetActor,
      tone,
      attempt: result.attempt,
      natural: diceResult,
      modifier,
      total,
      band: band.key,
      startAttitude: startIndex,
      newAttitude: newIndex,
      bewitched: result.bewitched,
      hidden,
    });

    // Re-render only a live window (a GM-resolved player roll is headless).
    if (this.rendered) this.render();
  }
}
