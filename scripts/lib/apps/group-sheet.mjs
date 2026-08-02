/* global game, foundry, ui, fromUuid */
/**
 * The `acks-lib.group` sheet.
 *
 * A group is not a creature you read a stat block off — it is one or more
 * STACKS, each a HEADCOUNT and a ROSTER — so it gets its own sheet rather than
 * the monster sheet an animal borrows. A uniform pack is one stack; a mixed unit
 * (10 swordsmen + 10 spearmen) is several, each with its own prototype, count,
 * and roster. Drop an actor to add a stack; drop onto a stack to re-point it.
 *
 * Group-level fields (noun, unit bookkeeping) submit through the default
 * document-sheet pipeline. Per-stack COUNTS do NOT: a partial form write to
 * `system.stacks` would replace the whole array and lose the other stacks'
 * templates and rosters, so counts are data-attribute inputs handled by explicit
 * `patchStack` writes, and the lifecycle buttons call group.mjs, which owns each
 * stack's `size.current` and roster so the invariant is never edited into an
 * inconsistent state.
 */
import { MODULE_ID } from "../constants.mjs";
import { GROUP_CATEGORY, GROUP_STATE } from "../data/group-data.mjs";
import * as groups from "../group.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export const GROUP_TYPE = `${MODULE_ID}.group`;

export class GroupSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-extras", "acks-lib-group-sheet"],
    position: { width: 600, height: 680 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      deploy: GroupSheet.#onDeploy,
      recall: GroupSheet.#onRecall,
      materialize: GroupSheet.#onMaterialize,
      addCasualty: GroupSheet.#onAddCasualty,
      detach: GroupSheet.#onDetach,
      openMember: GroupSheet.#onOpenMember,
      deleteRecord: GroupSheet.#onDeleteRecord,
      removeStack: GroupSheet.#onRemoveStack,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/lib/group-sheet.hbs`, scrollable: [".acks-lib-group-body"] },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;

    context.isGM = game.user.isGM;
    context.editable = this.isEditable;
    context.system = sys;
    context.noun = sys.noun || this.#defaultNoun(sys);
    context.invariantBroken = !sys.invariantHolds;
    context.totals = { current: sys.totalCurrent, pristine: sys.totalPristine, dead: sys.totalDead };

    const viewFor = (stack) => (m) => ({
      key: m.key,
      ordinal: m.ordinal,
      name: groups.memberName(stack, m),
      state: m.state,
      note: m.note,
      hp: m.delta?.system?.hp ?? null,
      hasActor: !!m.actorUuid,
    });

    context.stacks = sys.stacks.map((stack) => {
      const view = viewFor(stack);
      const tmpl = stack.template ?? {};
      return {
        key: stack.key,
        label: tmpl.label || "",
        type: tmpl.type || "",
        hasTemplate: !!(tmpl.uuid || tmpl.label),
        size: { current: stack.size?.current ?? 0, initial: stack.size?.initial ?? 0, pristine: sys.pristineCountOf(stack) },
        members: sys.livingRecordedOf(stack).map(view).sort((a, b) => a.ordinal - b.ordinal),
        dead: sys.deadOf(stack).map(view).sort((a, b) => a.ordinal - b.ordinal),
        detached: (stack.roster ?? []).filter((m) => m.state === GROUP_STATE.detached).map(view),
      };
    });

    context.hasStacks = context.stacks.length > 0;
    context.categories = Object.fromEntries(
      Object.entries(GROUP_CATEGORY).map(([k, label]) => [k, game.i18n.has(label) ? game.i18n.localize(label) : k])
    );
    return context;
  }

  #defaultNoun(sys) {
    const cat = sys.unit?.category;
    const key = `ACKS-LIB.group.noun.${cat || "monster"}`;
    return game.i18n.has(key) ? game.i18n.localize(key) : "group";
  }

  /**
   * @override — bind actor drag-drop (formation's PartySheet pattern) and wire
   * the per-stack count inputs, which are NOT form fields (see the class note).
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!this.isEditable) return;
    new foundry.applications.ux.DragDrop.implementation({
      permissions: { drop: () => this.isEditable },
      callbacks: { drop: (event) => this.#onDropActor(event) },
    }).bind(this.element);

    // Per-stack headcount edits go straight to that ONE stack (never the form,
    // which would rewrite the whole stacks array). A blank/NaN reads as 0.
    for (const input of this.element.querySelectorAll("input[data-stack-size]")) {
      input.addEventListener("change", async (ev) => {
        ev.stopPropagation();
        const stackKey = ev.target.closest("[data-stack-key]")?.dataset.stackKey;
        const field = ev.target.dataset.stackSize; // "current" | "initial"
        const val = Math.max(0, Math.floor(Number(ev.target.value) || 0));
        if (stackKey) await groups.patchStack(this.actor, stackKey, (s) => (s.size[field] = val));
        this.render();
      });
    }
    // The transient deploy/casualty count must not trip submitOnChange.
    for (const input of this.element.querySelectorAll("input.deploy-count")) {
      input.addEventListener("change", (ev) => ev.stopPropagation());
    }
  }

  async #onDropActor(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Actor") return;
    const source = await foundry.utils.getDocumentClass("Actor").fromDropData(data);
    if (!source) return;
    if (source.uuid === this.actor.uuid || groups.isGroup(source)) {
      return ui.notifications.warn(game.i18n.localize("ACKS-LIB.group.warn.badPrototype"));
    }
    // Dropped ONTO a stack → re-point that stack; dropped elsewhere → add a stack.
    const stackKey = event.target?.closest?.("[data-stack-key]")?.dataset?.stackKey;
    if (stackKey) {
      await groups.setStackPrototype(this.actor, stackKey, source);
      ui.notifications.info(game.i18n.format("ACKS-LIB.group.info.stackRepointed", { name: source.name }));
    } else {
      await groups.addStack(this.actor, source);
      ui.notifications.info(game.i18n.format("ACKS-LIB.group.info.stackAdded", { name: source.name }));
    }
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action helpers                              */
  /* -------------------------------------------- */

  static #stackKey(target) {
    return target.closest("[data-stack-key]")?.dataset.stackKey ?? null;
  }

  /** The count typed in THIS stack's control row (deploy / casualties). */
  static #count(target, fallback = 1) {
    const input = target.closest("[data-stack-key]")?.querySelector("input.deploy-count");
    const n = Number(input?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onDeploy(event, target) {
    const stackKey = GroupSheet.#stackKey(target);
    if (!stackKey) return;
    const scene = game.scenes?.viewed;
    if (!scene) return ui.notifications.warn(game.i18n.localize("ACKS-LIB.group.warn.noScene"));
    const token = scene.tokens.find((t) => t.actorId === this.actor.id);
    const x = token?.x ?? Math.floor((scene.width ?? 0) / 2);
    const y = token?.y ?? Math.floor((scene.height ?? 0) / 2);
    const made = await groups.deploy(this.actor, scene, { stackKey, count: GroupSheet.#count(target), x, y });
    ui.notifications.info(game.i18n.format("ACKS-LIB.group.info.deployed", { n: made.length }));
    this.render();
  }

  static async #onRecall() {
    const { recalled, casualties } = await groups.recall(this.actor);
    ui.notifications.info(game.i18n.format("ACKS-LIB.group.info.recalled", { n: recalled, dead: casualties }));
    this.render();
  }

  static async #onMaterialize(event, target) {
    const stackKey = GroupSheet.#stackKey(target);
    if (!stackKey) return;
    const member = await groups.materializeMember(this.actor, stackKey);
    if (!member) ui.notifications.warn(game.i18n.localize("ACKS-LIB.group.warn.noPristine"));
    this.render();
  }

  static async #onAddCasualty(event, target) {
    const stackKey = GroupSheet.#stackKey(target);
    if (!stackKey) return;
    const n = await groups.applyCasualties(this.actor, stackKey, GroupSheet.#count(target));
    if (!n) ui.notifications.warn(game.i18n.localize("ACKS-LIB.group.warn.noBodies"));
    this.render();
  }

  static async #onDetach(event, target) {
    const stackKey = GroupSheet.#stackKey(target);
    const key = target.closest("[data-member-key]")?.dataset.memberKey;
    if (!stackKey || !key) return;
    const actor = await groups.detach(this.actor, stackKey, key);
    if (actor) {
      actor.sheet.render(true);
      ui.notifications.info(game.i18n.format("ACKS-LIB.group.info.detached", { name: actor.name }));
    }
    this.render();
  }

  static async #onOpenMember(event, target) {
    const stackKey = GroupSheet.#stackKey(target);
    const key = target.closest("[data-member-key]")?.dataset.memberKey;
    const member = this.actor.system.stackOf(stackKey)?.roster.find((m) => m.key === key);
    if (member?.actorUuid) {
      const actor = await fromUuid(member.actorUuid);
      actor?.sheet?.render(true);
    }
  }

  static async #onDeleteRecord(event, target) {
    const stackKey = GroupSheet.#stackKey(target);
    const key = target.closest("[data-member-key]")?.dataset.memberKey;
    if (!stackKey || !key) return;
    // Dropping a DEAD or DETACHED record is pure bookkeeping — it never touches
    // size.current (those bodies already left the headcount).
    await groups.patchStack(this.actor, stackKey, (s) => {
      s.roster = s.roster.filter((m) => m.key !== key);
    });
    this.render();
  }

  static async #onRemoveStack(event, target) {
    const stackKey = GroupSheet.#stackKey(target);
    if (!stackKey) return;
    await groups.removeStack(this.actor, stackKey);
    this.render();
  }
}
