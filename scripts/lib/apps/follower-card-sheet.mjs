/* global foundry, game, ui, CONFIG, document, Roll, ChatMessage */
/**
 * FollowerCardSheet — the compact "Follower Card" as an actor's own sheet.
 *
 * Registered at `ready` in module.mjs: the default sheet for `monster`, an
 * alternative for `character`, and the per-instance default for retainers.
 * See docs/lib/FOLLOWER-CARD.md and docs/lib/DECISIONS.md, "A monster's type
 * default is the Follower Card, met before it is read up on".
 *
 * A quick-roll surface: attacks and proficiencies roll through the system,
 * and each roll target can carry a sticky card-only override in
 * `flags.acks-extras.fcOverrides`, which the main character sheet ignores.
 * **Reset** clears the overrides; **Commit** bakes them into the real base
 * fields. `+Attack` / `+Skill` add minimal items for ad-hocs. See
 * docs/lib/DECISIONS.md, "Card-only overrides bake onto whichever field
 * actually exists, or stay overrides".
 */
import { toNum as num, unset } from "../util.mjs";
import { MODULE_ID } from "../constants.mjs";
import { actorProvides, followerCardContext, FOLLOWER_CARD_TEMPLATE } from "../follower-card.mjs";


export class FollowerCardSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2,
) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks", "acks-lib-follower-card-sheet", "acks-extras-scroll"],
    // Size to content (grow with the card), not a fixed height that leaves an
    // empty window-content bar below a short card. The card part scrolls if it
    // outgrows the viewport.
    position: { width: 600, height: "auto" },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      fcToggleEquip: FollowerCardSheet.#onToggleEquip,
      fcRollProficiency: FollowerCardSheet.#onRollProficiency,
      fcRollAttack: FollowerCardSheet.#onRollAttack,
      fcRollAdventuring: FollowerCardSheet.#onRollAdventuring,
      fcResetSheet: FollowerCardSheet.#onResetSheet,
      fcCommit: FollowerCardSheet.#onCommit,
      fcAddAttack: FollowerCardSheet.#onAddAttack,
      fcAddSkill: FollowerCardSheet.#onAddSkill,
      fcToggleAttackEdit: FollowerCardSheet.#onToggleAttackEdit,
      fcOpenFull: FollowerCardSheet.#onOpenFull,
      fcShowItem: FollowerCardSheet.#onShowItem,
    },
  };

  /** Post a power or spell to chat via the system's own `show()`, which
   * obeys the seat's roll mode. */
  static #onShowItem(event, target) {
    this.actor.items.get(target.dataset.itemId)?.show?.();
  }

  static #onOpenFull() {
    this.#openFull();
  }

  static PARTS = {
    card: { template: FOLLOWER_CARD_TEMPLATE, scrollable: [".acks-lib-follower-card"] },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return { ...context, ...(await followerCardContext(this.actor, { editable: this.isEditable, interactive: true })) };
  }

  /** @override — wire the override inputs and inject the Expand button. */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Roll-target inputs write CARD-ONLY overrides (a flag the main sheet ignores),
    // not the base fields. They carry no name=, so they don't ride the form submit.
    this.element?.querySelector("input[data-fc-ac]")?.addEventListener("change", (ev) => this.#onAcInput(ev));
    this.element?.querySelector("input[data-fc-speed]")?.addEventListener("change", (ev) => this.#onSpeedInput(ev));
    this.element?.querySelector("input[data-fc-enc]")?.addEventListener("change", (ev) => this.#onEncInput(ev));
    for (const inp of this.element?.querySelectorAll("input[data-fc-adv]") ?? []) {
      inp.addEventListener("change", (ev) => this.#onAdvInput(ev));
    }
    for (const inp of this.element?.querySelectorAll("input[data-fc-atk]") ?? []) {
      inp.addEventListener("change", (ev) => this.#onAttackInput(ev));
    }

    // `position.height: "auto"` only applies to the first render; a resize
    // pins a pixel height, so ask for auto again on every render.
    try {
      this.setPosition({ height: "auto" });
    } catch {
      /* position not settable yet — harmless */
    }

    const header = this.element?.querySelector(".window-header");
    if (!header || header.querySelector(".acks-lib-fc-expand")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "header-control icon fa-solid fa-up-right-from-square acks-lib-fc-expand";
    btn.dataset.tooltip = game.i18n.localize("ACKS-LIB.followerCard.expand");
    btn.addEventListener("click", () => this.#openFull());
    const close = header.querySelector('[data-action="close"]');
    if (close) header.insertBefore(btn, close);
    else header.append(btn);
  }

  /**
   * Open the full sheet for this actor's type — never this card. Prefers the
   * registry's `default` for the type, then this module's own full sheet,
   * then registration order. Raises an already-open window rather than
   * rendering a second one. See docs/lib/DECISIONS.md, '2026-09-22 — "Full
   * sheet" opens the sheet the world chose' and '2026-09-19 — "Full sheet"
   * raises the window it already opened'.
   */
  #openFull() {
    const entries = Object.entries(CONFIG.Actor?.sheetClasses?.[this.actor.type] ?? {})
      .map(([id, e]) => ({ id, ...e }))
      .filter((e) => e.cls && e.cls !== FollowerCardSheet);
    const full =
      entries.find((e) => e.default)?.cls ??
      entries.find((e) => e.id.startsWith(`${MODULE_ID}.`))?.cls ??
      entries[0]?.cls ??
      null;
    if (!full) {
      ui.notifications.warn(game.i18n.localize("ACKS-LIB.followerCard.noFullSheet"));
      return;
    }
    const open = Object.values(this.actor.apps ?? {}).find((app) => app.constructor === full);
    if (open) {
      open.render(true);
      open.bringToFront?.();
      return;
    }
    new full({ document: this.actor }).render(true);
  }

  /* -------------------------------------------- */
  /*  Card-only overrides                         */
  /* -------------------------------------------- */

  #overrides() {
    return foundry.utils.deepClone(this.actor.getFlag(MODULE_ID, "fcOverrides") ?? {});
  }

  async #setOverride(patch) {
    await this.actor.setFlag(MODULE_ID, "fcOverrides", foundry.utils.mergeObject(this.#overrides(), patch));
  }

  async #onAcInput(ev) {
    ev.stopPropagation();
    const v = Math.round(Number(ev.target.value));
    if (Number.isFinite(v)) await this.#setOverride({ ac: v });
  }

  async #onSpeedInput(ev) {
    ev.stopPropagation();
    const v = Math.round(Number(ev.target.value));
    if (Number.isFinite(v)) await this.#setOverride({ speed: v });
  }

  async #onEncInput(ev) {
    ev.stopPropagation();
    const v = Math.round(Number(ev.target.value));
    if (Number.isFinite(v)) await this.#setOverride({ enc: v });
  }

  async #onAdvInput(ev) {
    ev.stopPropagation();
    const key = ev.target.dataset.fcAdv;
    const v = Math.round(Number(ev.target.value));
    if (key && Number.isFinite(v)) await this.#setOverride({ adventuring: { [key]: v } });
  }

  /** Per-attack quick edit: name / throw / bonus / damage / damage bonus. */
  async #onAttackInput(ev) {
    ev.stopPropagation();
    const field = ev.target.dataset.fcAtk;
    const key = ev.target.closest("[data-attack-key]")?.dataset.attackKey;
    if (!field || !key) return;
    const raw = ev.target.value;
    const value = field === "label" || field === "damage" ? String(raw) : Math.round(Number(raw));
    if (typeof value === "number" && !Number.isFinite(value)) return;
    await this.#setOverride({ attacks: { [key]: { [field]: value } } });
  }

  /** Reveal/hide one attack's edit line (view state only — nothing is stored). */
  static #onToggleAttackEdit(_event, target) {
    target.closest(".fc-attack-wrap")?.classList.toggle("editing");
  }

  /** Reset: drop all card-only overrides, back to the sheet's own values. */
  static async #onResetSheet() {
    await this.actor.unsetFlag(MODULE_ID, "fcOverrides");
  }

  /** Commit: bake the card-only overrides into the real base fields, then clear. */
  static async #onCommit() {
    const ov = this.actor.getFlag(MODULE_ID, "fcOverrides") ?? {};
    const upd = {};
    if (ov.ac != null) {
      // Core recomputes `aac.value` on a body with ability scores, so the
      // difference goes into `aac.mod` instead; a scoreless model stores it as typed.
      if (actorProvides(this.actor, "scores")) {
        const sys = this.actor.system;
        const base = num(sys.aac?.value) - num(sys.aac?.mod);
        upd["system.aac.mod"] = num(ov.ac) - base;
      } else {
        upd["system.aac.value"] = num(ov.ac);
      }
    }
    // Speed bakes onto whichever rate the model declares. `enc` has no base
    // field to bake into and stays an override until Reset.
    if (ov.speed != null) {
      if (actorProvides(this.actor, "movementacks.combat")) upd["system.movementacks.combat"] = num(ov.speed);
      else if (actorProvides(this.actor, "movement.base")) upd["system.movement.base"] = num(ov.speed);
    }
    for (const [k, v] of Object.entries(ov.adventuring ?? {})) upd[`system.adventuring.${k}`] = num(v);
    if (Object.keys(upd).length) await this.actor.update(upd);

    // Attack edits bake onto the weapon they came from; a row with no item
    // (unarmed, improvised) has nothing to write to and stays an override.
    const itemUpdates = [];
    for (const [key, o] of Object.entries(ov.attacks ?? {})) {
      const itemId = String(key).split(":")[0];
      const item = this.actor.items.get(itemId);
      if (!item) continue;
      const u = { _id: item.id };
      if (o.label) u.name = o.label;
      if (o.damage != null) u["system.damage"] = o.damage;
      if (o.bonus != null) u["system.bonus"] = num(o.bonus);
      if (Object.keys(u).length > 1) itemUpdates.push(u);
    }
    if (itemUpdates.length) await this.actor.updateEmbeddedDocuments("Item", itemUpdates);

    // Clear only what was baked; a whole-flag unset would drop overrides that
    // have no base field to bake into. Deletion is spelled per key
    // (`unset()`) — a smaller object would deep-merge and remove nothing.
    const cleared = {};
    if (ov.ac != null) cleared.ac = unset();
    if (ov.speed != null && (actorProvides(this.actor, "movementacks.combat") || actorProvides(this.actor, "movement.base"))) {
      cleared.speed = unset();
    }
    if (ov.adventuring) cleared.adventuring = unset();
    for (const key of Object.keys(ov.attacks ?? {})) {
      const itemId = String(key).split(":")[0];
      if (this.actor.items.get(itemId)) cleared[`attacks.${key}`] = unset();
    }
    if (Object.keys(cleared).length) {
      await this.actor.update({ [`flags.${MODULE_ID}.fcOverrides`]: cleared });
    }
  }

  /* -------------------------------------------- */
  /*  Rolls                                       */
  /* -------------------------------------------- */

  /** Toggle a weapon/armour item's worn/wielded state. */
  static async #onToggleEquip(_event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item && "equipped" in (item.system ?? {})) {
      await item.update({ "system.equipped": !item.system.equipped });
    }
  }

  /** Roll a proficiency/power the way the system does (formula, else show). */
  static #onRollProficiency(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (!item) return;
    if (item.system?.roll) item.rollFormula?.({ event });
    else item.show?.();
  }

  /**
   * Roll one attack option. A row backed by an equipped weapon rolls THAT weapon
   * (so its damage die and bonus ride along); unarmed / improvised / a monster's
   * natural attack roll bare, as core does with no item.
   */
  static #onRollAttack(event, target) {
    const type = target.dataset.attack || "melee";
    const itemId = target.dataset.itemId;
    const key = target.closest("[data-attack-key]")?.dataset.attackKey;
    let skip = false;
    try {
      skip = !!event?.[game.settings.get("acks", "skip-dialog-key")];
    } catch {
      /* setting absent — show the dialog */
    }
    const ov = key ? ((this.actor.getFlag(MODULE_ID, "fcOverrides") ?? {}).attacks ?? {})[key] : null;
    const item = itemId ? this.actor.items.get(itemId) : null;

    // Build the throwaway item object core's roll reads (name / damage / bonus),
    // patched with any per-attack override — a row with no item still gets one so
    // an ad-hoc attack can carry its own name and damage die.
    let payload = item ? item.toObject() : null;
    if (ov || !item) {
      const base = payload ?? { name: target.textContent.trim(), system: { damage: "", bonus: 0 } };
      payload = foundry.utils.deepClone(base);
      payload.system ??= {};
      if (ov?.label) payload.name = ov.label;
      if (ov?.damage != null) payload.system.damage = ov.damage;
      if (ov?.damageBonus != null) payload.system.damageBonus = num(ov.damageBonus);
      if (!payload.system.damage) delete payload.system.damage;
    }
    const attData = { actor: this.actor, roll: { save: item?.system?.save, target: null } };
    if (payload?.system?.damage || item) attData.item = payload;
    // On attData, not options: core's targetAttack rebuilds options as
    // {type, skipDialog} and would drop it.
    if (ov && (ov.target != null || ov.bonus != null)) {
      attData.acksLibOverride = { target: ov.target, bonus: ov.bonus };
    }
    this.actor.targetAttack?.(attData, type, { type, skipDialog: skip });
  }

  /** Roll an adventuring throw, honouring a card-only override target if set. */
  static #onRollAdventuring(event, target) {
    const key = target.dataset.skill;
    if (!key) return;
    const ov = (this.actor.getFlag(MODULE_ID, "fcOverrides") ?? {}).adventuring ?? {};
    if (ov[key] == null) {
      this.actor.rollAdventuring?.(key, { event });
      return;
    }
    // Overridden: roll against the card-only target without writing to the actor.
    const label = game.i18n.localize(`ACKS.adventuring.${key}`);
    new Roll("1d20").toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `${label} — ${game.i18n.format("ACKS-LIB.followerCard.targetHint", { n: num(ov[key]) })}`,
    });
  }

  /* -------------------------------------------- */
  /*  Ad-hoc additions (real, minimal items)      */
  /* -------------------------------------------- */

  static async #onAddAttack() {
    await this.actor.createEmbeddedDocuments("Item", [
      { name: game.i18n.localize("ACKS-LIB.followerCard.newAttack"), type: "weapon", system: { equipped: true, damage: "1d6", melee: true } },
    ]);
  }

  static async #onAddSkill() {
    await this.actor.createEmbeddedDocuments("Item", [
      { name: game.i18n.localize("ACKS-LIB.followerCard.newSkill"), type: "ability", system: { roll: "1d20" } },
    ]);
  }
}
