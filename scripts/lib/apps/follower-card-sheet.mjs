/* global foundry, game, ui, CONFIG, document, Roll, ChatMessage */
/**
 * FollowerCardSheet — the compact "Follower Card" as an actor's own sheet.
 *
 * Registered (at `ready`, in module.mjs) for `character` and `monster` as an
 * ALTERNATIVE sheet. acks-lib makes it the per-instance default for retainers, so a
 * hireling opens as the card. The "Expand / details" header button opens the full
 * system sheet.
 *
 * The card is a QUICK-ROLL surface: attacks and proficiencies roll through the
 * system, and each roll target (AC, adventuring throws) can be given a **sticky
 * card-only override** — stored in `flags.acks-lib.fcOverrides`, which the main
 * character sheet ignores, so you can change a target for a quick roll without
 * touching the actor's real data. **Reset** clears the overrides; **Commit** bakes
 * them into the real base fields. `+Attack` / `+Skill` add minimal items for ad-hocs.
 */
import { MODULE_ID } from "../constants.mjs";
import { followerCardContext, FOLLOWER_CARD_TEMPLATE } from "../follower-card.mjs";

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export class FollowerCardSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2,
) {
  static DEFAULT_OPTIONS = {
    classes: ["acks", "acks-lib-follower-card-sheet"],
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
    },
  };

  static #onOpenFull() {
    this.#openFull();
  }

  static PARTS = {
    card: { template: FOLLOWER_CARD_TEMPLATE, scrollable: [".acks-lib-follower-card"] },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return { ...context, ...followerCardContext(this.actor, { editable: this.isEditable }) };
  }

  /** @override — wire the override inputs and inject the Expand button. */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Roll-target inputs write CARD-ONLY overrides (a flag the main sheet ignores),
    // not the base fields. They carry no name=, so they don't ride the form submit.
    this.element?.querySelector("input[data-fc-ac]")?.addEventListener("change", (ev) => this.#onAcInput(ev));
    for (const inp of this.element?.querySelectorAll("input[data-fc-adv]") ?? []) {
      inp.addEventListener("change", (ev) => this.#onAdvInput(ev));
    }
    for (const inp of this.element?.querySelectorAll("input[data-fc-atk]") ?? []) {
      inp.addEventListener("change", (ev) => this.#onAttackInput(ev));
    }

    // Re-fit the window to the card. `position.height: "auto"` only applies to the
    // FIRST render — a resize (or a restored position) pins a pixel height, which
    // then shows as empty window-content under a short card. Ask for auto again
    // every render so the frame always tracks the content.
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

  /** Open the full system sheet for this actor's type — never this card. */
  #openFull() {
    const entries = Object.values(CONFIG.Actor?.sheetClasses?.[this.actor.type] ?? {});
    const other = entries.filter((e) => e.cls !== FollowerCardSheet);
    const full = (other.find((e) => e.default) ?? other[0])?.cls ?? null;
    if (!full) {
      ui.notifications.warn(game.i18n.localize("ACKS-LIB.followerCard.noFullSheet"));
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
      if (this.actor.type === "monster") {
        upd["system.aac.value"] = num(ov.ac); // monster AC is stored directly
      } else {
        const sys = this.actor.system;
        const base = num(sys.aac?.value) - num(sys.aac?.mod);
        upd["system.aac.mod"] = num(ov.ac) - base; // land computeAC on the typed value
      }
    }
    for (const [k, v] of Object.entries(ov.adventuring ?? {})) upd[`system.adventuring.${k}`] = num(v);
    if (Object.keys(upd).length) await this.actor.update(upd);

    // Attack edits bake onto the WEAPON they came from (name / damage die / the
    // weapon's own bonus). A row with no item — unarmed, improvised — has nothing
    // to write to, so its override simply stays an override.
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

    await this.actor.unsetFlag(MODULE_ID, "fcOverrides");
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
