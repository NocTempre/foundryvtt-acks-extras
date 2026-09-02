/* global game, canvas, ui, foundry, Hooks */
/**
 * The Judge's door dialog: pick the door on the scene, see what standing in
 * front of it is actually worth, and do one of the things the book allows.
 *
 * The throw is shown BEFORE it is rolled, broken into its parts, because the
 * interesting decision at a stuck door is whether to heave at all — a party
 * that can see "18+, and you need a 14 with both of you pushing" will spike it
 * and walk away instead of burning six rounds finding out.
 */
import { MODULE_ID } from "./constants.mjs";
import { bashPlan, bashDoor, spikeDoor, unspikeDoor, batterPlan, doorState, isDoor, selectedDoor, DOOR_KINDS, MAX_SPIKES } from "./doors.mjs";
import { abilityMod } from "../lib/actor-read.mjs";

const LANG_PREFIX = "ACKS-FORMATION.doors";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export default class DoorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-door",
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-scroll"],
    tag: "form",
    window: { title: `${LANG_PREFIX}.title`, icon: "fa-solid fa-door-closed" },
    position: { width: 460 },
    form: { handler: DoorApp.#submit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      bash: DoorApp.#onBash,
      spike: DoorApp.#onSpike,
      unspike: DoorApp.#onUnspike,
      batter: DoorApp.#onBatter,
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/formation/door.hbs` } };

  /** @param {WallDocument} wall */
  constructor(wall, options = {}) {
    super(options);
    this.wall = wall;
    this.opts = { crowbar: false, sizeSteps: 0, extra: 0, partnerId: "" };
  }

  /** The token the Judge has selected is the one at the door. */
  get basher() {
    return canvas?.tokens?.controlled?.[0]?.actor ?? null;
  }

  static #submit(_event, _form, formData) {
    const d = foundry.utils.expandObject(formData.object);
    this.opts = {
      crowbar: !!d.crowbar,
      sizeSteps: Number(d.sizeSteps) || 0,
      extra: Number(d.extra) || 0,
      partnerId: d.partnerId ?? "",
    };
    this.render();
  }

  async _prepareContext() {
    const state = doorState(this.wall);
    const actor = this.basher;
    const partner = this.opts.partnerId ? game.actors.get(this.opts.partnerId) : null;
    const strMod = Math.max(actor ? abilityMod(actor, "str") : 0, partner ? abilityMod(partner, "str") : 0);
    const plan = bashPlan({ ...this.opts, strMod, pair: !!partner, spikes: state.spikes });
    const batter = batterPlan(this.wall);

    return {
      state,
      actor,
      // Naming the basher matters: the throw below is THEIR Strength, and a
      // Judge with three tokens selected should see which one it used.
      actorName: actor?.name ?? game.i18n.localize(`${LANG_PREFIX}.noToken`),
      plan,
      // What the die must show, which is what a player actually asks for.
      needs: Math.max(2, plan.target - plan.modifier),
      parts: plan.parts.map((p) => ({ ...p, label: game.i18n.localize(`${LANG_PREFIX}.mod.${p.key}`), sign: p.value > 0 ? "+" : "" })),
      batter,
      kinds: Object.entries(DOOR_KINDS).map(([value, k]) => ({
        value, label: game.i18n.localize(k.label), selected: value === state.kind,
      })),
      partners: game.actors.filter((a) => a.type === "character" && a !== actor)
        .map((a) => ({ id: a.id, name: a.name, selected: a.id === this.opts.partnerId })),
      opts: this.opts,
      canSpike: state.spikes < MAX_SPIKES,
      maxSpikes: MAX_SPIKES,
    };
  }

  static async #onBash() {
    const partner = this.opts.partnerId ? game.actors.get(this.opts.partnerId) : null;
    await bashDoor(this.wall, { actor: this.basher, partner, crowbar: this.opts.crowbar, sizeSteps: this.opts.sizeSteps, extra: this.opts.extra });
    this.render();
  }

  static async #onSpike() {
    const r = await spikeDoor(this.wall, this.basher);
    if (!r.ok) ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.refuse.${r.reason}`));
    this.render();
  }

  static async #onUnspike() {
    await unspikeDoor(this.wall);
    this.render();
  }

  static async #onBatter() {
    const plan = batterPlan(this.wall);
    if (!plan.ok) { ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.refuse.tooSolid`)); return; }
    await this.wall.update({ ds: 1 });
    ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.batteredDown`, { turns: plan.turns }));
    this.render();
  }
}

/** Open the dialog on the door the Judge has selected. */
export function openDoorApp(wall = null) {
  const target = wall ?? selectedDoor();
  if (!target) return null;
  return new DoorApp(target).render(true);
}

/**
 * The Walls layer gets a tool for it. A door is a wall, so this is where a
 * Judge already is when they are thinking about one.
 */
export function installDoorControl() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const walls = controls.walls ?? controls.find?.((c) => c.name === "walls");
    if (!walls) return;
    const tools = walls.tools;
    const tool = {
      name: "acksDoor",
      title: game.i18n.localize(`${LANG_PREFIX}.tool`),
      icon: "fa-solid fa-door-closed",
      button: true,
      visible: game.user.isGM,
      // One handler only: v13+ calls BOTH `onChange` and `onClick` on a
      // `button: true` tool, so a second dialog opens over the first.
      onChange: () => openDoorApp(),
    };
    // v13+ hands these over as an object keyed by name; older builds as an
    // array. Both shapes are still in the wild across the family's worlds.
    if (Array.isArray(tools)) tools.push(tool);
    else tools[tool.name] = tool;
  });
}
