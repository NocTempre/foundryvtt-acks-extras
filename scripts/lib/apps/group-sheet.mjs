/* global game, foundry, ui, fromUuid */
/**
 * The `acks-extras.group` sheet.
 *
 * A group is not a creature you read a stat block off — it is one or more
 * STACKS, each a HEADCOUNT and a ROSTER — so it gets its own sheet rather than
 * the monster sheet an animal borrows. A uniform pack is one stack; a mixed unit
 * (10 swordsmen + 10 spearmen) is several, each with its own prototype, count,
 * and roster. Drop an actor to add a stack; drop onto a stack to re-point it. A
 * family template dropped here picks a variant first, and the stack is of that.
 * A row dragged from another group's sheet moves here, the bodies beneath it too.
 *
 * The group's coin is listed as its purse: a paid unit's wage lands on the
 * group's own actor, and this is the sheet that shows it. A purse row drags
 * off like any goods row, and coin dropped on the sheet joins the purse.
 *
 * Where a stack has a creature whose line gives bodies, a Judge has a Roll on its
 * row, which sizes that stack from its ecology, and once the group is an encounter
 * the reveal, a schema field the form writes (group-encounter.mjs).
 *
 * Group-level fields (noun, unit bookkeeping) submit through the default
 * document-sheet pipeline. Per-stack COUNTS do NOT: a partial form write to
 * `system.stacks` would replace the whole array and lose the other stacks'
 * templates and rosters, so counts are data-attribute inputs handled by explicit
 * `patchStack` writes, and the lifecycle buttons call group.mjs, which owns each
 * stack's `size.current` and roster so the invariant is never edited into an
 * inconsistent state.
 */
import { GROUP_LANG_PREFIX, GROUP_TYPE, MODULE_ID, TEMPLATE_TYPE } from "../constants.mjs";
import { GROUP_CATEGORY, GROUP_STATE } from "../data/group-data.mjs";
import * as groups from "../group.mjs";
import { citeOf, countTip, defaultRollContext, groupNoun, judgeCaption, rollEncounter, rollRefusal, stackSource } from "../group-encounter.mjs";
import {
  BY_LAIR_CHANCE,
  REVEAL,
  ROLL_CONTEXTS,
  ROLL_STATES,
  isCreatureStack,
  lairChanceOf,
  lineReading,
  offersRoll,
  rollsOver,
  statesACount,
  unitSides,
} from "../group-encounter-logic.mjs";
import { generateFromTemplate } from "../template-generate.mjs";
import { makeLoc } from "../util.mjs";
import { coinCount, coinTotalGC } from "../money-logic.mjs";
import { ownCoin } from "../money.mjs";
import { coinOrderView } from "../coin-order.mjs";
import { isCurrency } from "../item-model.mjs";
import { landCoin, refuseGoods } from "../bundles.mjs";
import { PicksMixin } from "../picks.mjs";

const { DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

export { GROUP_TYPE };

const loc = makeLoc(GROUP_LANG_PREFIX);

/** The classes a dialog this sheet opens carries. */
const DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-lib-group-dialog"];

/** A template in this sheet's folder, rendered for a dialog. */
const dialogContent = (name, view) =>
  foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/${name}.hbs`, view);

/**
 * The sheet for a STACK — a headcount plus a roster of the individuals in it,
 * which is a different shape from a single creature and so gets its own sheet
 * rather than an alternate character one.
 */
export class GroupSheet extends PicksMixin(HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-lib-group-sheet"],
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
      rollEncounter: GroupSheet.#onRollEncounter,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/lib/group-sheet.hbs`, scrollable: [""] },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;

    context.isGM = game.user.isGM;
    context.editable = this.isEditable;
    context.system = sys;
    context.actor = this.actor;
    context.biographyHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      sys.details?.biography ?? "",
      { relativeTo: this.actor, secrets: this.actor.isOwner }
    );
    context.noun = groupNoun(this.actor);
    context.invariantBroken = !sys.invariantHolds;
    context.totals = { current: sys.totalCurrent, pristine: sys.totalPristine, dead: sys.totalDead };
    context.totalsTip = sys.stacks.map((s) => `${s.template?.label ?? ""} ${s.size?.current ?? 0}`).join(" · ");
    const sources = await Promise.all(sys.stacks.map(stackSource));
    const judge = game.user.isGM && this.isEditable;

    const viewFor = (stack) => (m) => ({
      key: m.key,
      ordinal: m.ordinal,
      name: groups.memberName(stack, m),
      state: m.state,
      note: m.note,
      hp: m.delta?.system?.hp ?? null,
      hasActor: !!m.actorUuid,
    });

    context.canDeploy = this.isEditable && groups.canDeploy(this.actor);
    context.dragTip = `ACKS-LIB.group.${context.canDeploy ? "dragRow" : "dragRowMove"}`;
    context.stacks = sys.stacks.map((stack, i) => {
      const view = viewFor(stack);
      const tmpl = stack.template ?? {};
      return {
        key: stack.key,
        img: tmpl.snapshot?.img || "",
        label: tmpl.label || "",
        type: tmpl.type || "",
        hasTemplate: !!(tmpl.uuid || tmpl.label),
        size: { current: stack.size?.current ?? 0, initial: stack.size?.initial ?? 0, pristine: sys.pristineCountOf(stack) },
        countTip: GroupSheet.#countTip(stack, sources[i]),
        rollLabel: judge && offersRoll(stack, sources[i]) ? loc(stack.rolled?.total != null ? "roll.again" : "roll.press") : null,
        rollNotes: judge ? GroupSheet.#rollNotes(stack, sources[i]) : [],
        members: sys.livingRecordedOf(stack).map(view).sort((a, b) => a.ordinal - b.ordinal),
        dead: sys.deadOf(stack).map(view).sort((a, b) => a.ordinal - b.ordinal),
        detached: (stack.roster ?? []).filter((m) => m.state === GROUP_STATE.detached).map(view),
      };
    });

    // The purse: the coin the group holds, which is where a unit's pay lands.
    const coin = ownCoin(this.actor);
    const order = coinOrderView(this.actor);
    const gold = (rows) => coinTotalGC(rows).toLocaleString(game.i18n.lang);
    context.isMonsterBand = sys.unit?.category === "monster";
    context.purse = {
      shown: !context.isMonsterBand || coin.length > 0,
      rows: coin.map((row) => ({ id: row.id, name: row.name, img: row.img, count: coinCount(row), gp: gold([row]) })),
      gp: gold(coin),
      order: order.shown ? order : null,
    };

    context.hasStacks = context.stacks.length > 0;
    context.categories = Object.fromEntries(
      Object.entries(GROUP_CATEGORY).map(([k, label]) => [k, game.i18n.has(label) ? game.i18n.localize(label) : k])
    );
    context.reveal = judge && sys.reveal ? this.#revealView() : null;
    return context;
  }

  /** The Judge's control over what a seat reads off the token. */
  #revealView() {
    const sys = this.actor.system;
    const option = (value) => ({ value, label: loc(`reveal.${value}`), selected: sys.reveal === value });
    return {
      options: Object.values(REVEAL).map(option),
      reads: loc("reveal.reads", { name: this.actor.prototypeToken?.name ?? "" }),
    };
  }

  /** Where a stack's count came from, with the group's own numbers. */
  static #countTip(stack, source) {
    return countTip(stack, source);
  }

  /** What a Roll cannot do with this stack, said on the sheet before anyone presses it. */
  static #rollNotes(stack, source) {
    if (!isCreatureStack(stack)) return [];
    if (!rollsOver(stack)) return [loc("roll.note.hand")];
    if (!statesACount(source)) return [];
    const sides = unitSides(source).map(({ context, state, count }) =>
      `${loc(`roll.context.${context}`)}, ${loc(`roll.state.${state}`)}: ${count}`);
    return sides.length ? [loc("roll.note.units", { sides: sides.join(" · ") })] : [];
  }

  /**
   * @override — bind the sheet's own drop (formation's PartySheet pattern) and
   * wire the per-stack count inputs, which are NOT form fields (see the class
   * note). The drop bound here replaces the base class's on the same element,
   * so an item reaches `#onDropItem` and never the base's copy-on-drop. The
   * base class binds every `.draggable`, a stack's grip and a purse row alike.
   * A sheet this seat cannot edit still takes the drop, so a row dropped on it
   * says why it did not move; `#onDrop` refuses everything else there.
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      permissions: { drop: () => true },
      callbacks: { drop: (event) => this.#onDrop(event) },
    }).bind(this.element);
    if (!this.isEditable) return;

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
  }

  /** @override — a stack's grip carries its stack; a purse row is the base class's. */
  async _onDragStart(event) {
    const stackKey = GroupSheet.#stackKey(event.currentTarget);
    if (!stackKey) return super._onDragStart(event);
    const drag = { type: groups.STACK_DRAG_TYPE, group: this.actor.uuid, stackKey };
    event.dataTransfer.setData("text/plain", JSON.stringify(drag));
  }

  /**
   * Coin dropped from elsewhere joins the purse by the one rule every sheet
   * uses (`landCoin`). A group lists nothing else it holds, so any other item
   * is refused in the words every such sheet uses (`refuseGoods`), and a
   * purse row dropped back on its own sheet moves nothing.
   */
  async #onDropItem(data) {
    const item = await foundry.utils.getDocumentClass("Item").fromDropData(data);
    if (!item || item.parent?.uuid === this.actor.uuid) return;
    if (isCurrency(item)) await landCoin(this.actor, item);
    else refuseGoods(this.actor);
  }

  /** Another group's row moves here. Its own row dropped back moves nothing. */
  async #onDropStack({ group, stackKey }) {
    if (group === this.actor.uuid) return;
    const from = await fromUuid(group);
    const result = await groups.moveStack(from, this.actor, stackKey);
    if (!result.ok) return ui.notifications.warn(loc(`move.refused.${result.reason}`, result));
    ui.notifications.info(loc("move.done", { name: result.name, group: this.actor.name }));
  }

  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type === groups.STACK_DRAG_TYPE) return this.#onDropStack(data);
    if (!this.isEditable) return;
    if (data?.type === "Item") return this.#onDropItem(data);
    if (data?.type !== "Actor") return;
    const dropped = await foundry.utils.getDocumentClass("Actor").fromDropData(data);
    if (!dropped) return;
    if (dropped.uuid === this.actor.uuid || groups.isGroup(dropped)) {
      return ui.notifications.warn(game.i18n.localize("ACKS-LIB.group.warn.badPrototype"));
    }
    // Read before the dialog a family opens: the event's target does not outlive it.
    const stackKey = event.target?.closest?.("[data-stack-key]")?.dataset?.stackKey;
    const source = dropped.type === TEMPLATE_TYPE ? await GroupSheet.#pickVariant(dropped) : dropped;
    if (!source) return;
    // Dropped ONTO a stack → re-point that stack; dropped elsewhere → add a stack.
    if (stackKey) {
      await groups.setStackPrototype(this.actor, stackKey, source);
      ui.notifications.info(game.i18n.format("ACKS-LIB.group.info.stackRepointed", { name: source.name }));
    } else {
      await groups.addStack(this.actor, source);
      ui.notifications.info(game.i18n.format("ACKS-LIB.group.info.stackAdded", { name: source.name }));
    }
    this.render();
  }

  /**
   * A family dropped here is no body until it is one variant: the Judge picks
   * along its axes, and what generates is the creature the stack copies.
   * @returns {Promise<Actor|null>} null where the dialog closed or nothing generated
   */
  static async #pickVariant(template) {
    const sys = template.system;
    if (sys.isStub) return null;
    // An axis that names a default takes it when left alone, so its blank
    // choice says which; an unavailable pick falls back to it (`chooseAxes`).
    const axes = (sys.axes ?? []).filter((axis) => !axis.multi).map((axis) => {
      const fallback = axis.default ? (axis.options ?? []).find((o) => o.key === axis.default) : null;
      return {
        key: axis.key,
        label: axis.label || axis.key,
        rollLabel: fallback
          ? game.i18n.format("ACKS-LIB.template.defaultTo", { option: fallback.label || fallback.key })
          : axis.roll
            ? game.i18n.format("ACKS-LIB.template.rollDie", { die: axis.roll })
            : game.i18n.localize("ACKS-LIB.template.rollUniform"),
        options: (axis.options ?? []).map((o) => ({ key: o.key, label: o.label || o.key })),
      };
    });
    const pins = await DialogV2.prompt({
      classes: DIALOG_CLASSES,
      window: { title: loc("variant.title", { name: template.name }) },
      content: await dialogContent("group-variant", { axes }),
      ok: {
        label: loc("variant.press"),
        callback: (_event, button) =>
          Object.fromEntries(axes.map(({ key }) => [key, button.form.elements.namedItem(key).value]).filter(([, value]) => value)),
      },
      rejectClose: false,
    });
    if (!pins) return null;
    const created = await generateFromTemplate(template, { pins });
    if (!created) ui.notifications.warn(game.i18n.localize("ACKS-LIB.template.warn.rejected"));
    return created;
  }

  /** One monster's choice, its line read out beside it. Null where the dialog closed. */
  static async #askRoll(stack) {
    const source = await stackSource(stack);
    const chance = lairChanceOf(source);
    const opening = defaultRollContext();
    const count = (context, state) => lineReading(source, context, state).count || "—";
    const content = await dialogContent("group-roll", {
      contexts: ROLL_CONTEXTS.map((value) => ({ value, label: loc(`roll.context.${value}`), selected: value === opening })),
      states: [
        ...ROLL_STATES.map((value) => ({ value, label: loc(`roll.state.${value}`) })),
        {
          value: BY_LAIR_CHANCE,
          label: chance == null ? loc("roll.state.chanceBare") : loc("roll.state.chance", { n: chance }),
          disabled: chance == null,
        },
      ],
      lineTip: loc("roll.lineTip", { cite: citeOf(source) || loc("roll.noCite") }),
      lines: ROLL_CONTEXTS.map((context) => loc("roll.line", {
        where: loc(`roll.context.${context}`),
        wandering: count(context, "wandering"),
        lair: count(context, "lair"),
      })),
    });
    return DialogV2.prompt({
      classes: DIALOG_CLASSES,
      window: { title: loc("roll.title", { name: stack.template?.label ?? "" }) },
      content,
      ok: {
        label: loc("roll.press"),
        callback: (_event, button) => ({ context: button.form.elements.context.value, state: button.form.elements.state.value }),
      },
      rejectClose: false,
    });
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

  /** A row's Roll: a refusal says why before the dialog opens, and the side chosen may still give no bodies. */
  static async #onRollEncounter(event, target) {
    const stack = this.actor.system.stackOf(GroupSheet.#stackKey(target));
    if (!stack) return;
    const refused = (result) => result.reason === "noChance" || ui.notifications.warn(loc(`roll.refused.${result.reason}`, result));
    const refusal = rollRefusal(this.actor, stack);
    if (refusal) return refused(refusal);
    const choice = await GroupSheet.#askRoll(stack);
    if (!choice) return;
    const result = await rollEncounter(this.actor, stack.key, choice);
    if (!result.ok) refused(result);
    this.render();
  }
}
