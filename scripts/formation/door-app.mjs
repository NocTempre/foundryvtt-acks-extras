/* global game, canvas, ui, foundry, Hooks */
/**
 * The Judge's door window: pick the door on the scene, see what standing in
 * front of it is actually worth, and do one of the things the book allows.
 *
 * The throw is shown BEFORE it is rolled, broken into its parts, because the
 * interesting decision at a stuck door is whether to heave at all — a party
 * that can see what the door needs, alone and with two pushing, will spike it
 * and walk away instead of burning rounds finding out.
 *
 * One window stands per door (`doorWindowId`). The basher is the token selected
 * when the window last drew; it draws again when the selection changes, so the
 * name shown is the actor the press acts for. The footer is its own part, pinned
 * under the scrolling body.
 */
import { MODULE_ID, FORMATION_DOC, formationValue } from "./constants.mjs";
import { citeOf } from "../lib/tables.mjs";
import { atTypeScale } from "../lib/util.mjs";
import { getFormationForActor, getMemberActor, memberCanWork, realMembers } from "./formation-model.mjs";
import { bashPlan, bashDoor, bashThrow, bashStrength, spikeDoor, unspikeDoor, batterPlan, batterDoor, setDoorTraits, doorRows, doorState, selectedDoor, maxSpikes } from "./doors.mjs";

const LANG_PREFIX = "ACKS-FORMATION.doors";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The id every door window takes before its wall's ids are added. */
const WINDOW_ID_ROOT = "acks-extras-door";

/** The optional icon module whose glyph stands in the picture frame, and the file in it. */
const ICON_MODULE = "game-icons-net";
const DOOR_GLYPH = `modules/${ICON_MODULE}/blacktransparent/wooden-door.svg`;

/** How long the selection settles before the window draws again: a switch of tokens releases one and controls the next. */
const SELECTION_SETTLE_MS = 60;

/**
 * The window id of one door's window. Core keeps one element per id, so a
 * shared id would let a second door's window replace the first's element and
 * leave the first instance's actions dead; an id of the wall's own lets two
 * doors stand open together and a second opening of one find the first.
 *
 * @param {WallDocument|null} wall
 * @returns {string}
 */
export function doorWindowId(wall) {
  return [WINDOW_ID_ROOT, wall?.parent?.id, wall?.id].filter(Boolean).join("-");
}

/**
 * The actors the basher may heave beside: the other members of the party that
 * holds them, who can work now, when that party is on the door's scene. A basher
 * no party holds has no partner, and neither has one whose party is on another
 * scene. A party with no scene recorded is read as present: nothing says it is
 * elsewhere.
 *
 * @param {WallDocument} wall
 * @param {Actor|null} basher
 * @returns {Actor[]}
 */
export function partnerActors(wall, basher) {
  const formation = basher?.id ? getFormationForActor(basher.id) : null;
  if (!formation) return [];
  const here = wall?.parent?.id ?? canvas?.scene?.id ?? null;
  if (formation.sceneId && here && formation.sceneId !== here) return [];
  const seen = new Set([basher.id]);
  const out = [];
  for (const member of realMembers(formation)) {
    const actor = getMemberActor(member);
    if (!actor || seen.has(actor.id) || !memberCanWork(member, actor)) continue;
    seen.add(actor.id);
    out.push(actor);
  }
  return out;
}

/** The door glyph's path where the icon module is active, else null: no glyph is shown without it. */
const doorGlyph = () => (game.modules?.get?.(ICON_MODULE)?.active ? DOOR_GLYPH : null);

const loc = (key, data) => (data ? game.i18n.format(`${LANG_PREFIX}.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.${key}`));

/** The page a registered door figure was read from, else the page the module cites for it. */
const pageOf = (tableId, fallbackKey) => citeOf(FORMATION_DOC, tableId) ?? loc(fallbackKey);

/** Which registered figure each term of a bash reads, and the count it multiplies. */
function termSource(key, { strMod, steps, spikes }) {
  switch (key) {
    case "str": return { table: "bashStrengthFactor", count: strMod };
    case "pair": return { table: "bashPairBonus", count: 1 };
    case "crowbar": return { table: "bashCrowbarBonus", count: 1 };
    case "size": return steps < 0 ? { table: "bashSizePenalty", count: -steps } : { table: "bashSizeBonus", count: steps };
    case "spikes": return { table: "bashSpikePenalty", count: Math.max(0, spikes - 1) };
    default: return null;
  }
}

/** The Judge's door window. */
export default class DoorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-scroll", "acks-extras-door-window"],
    tag: "form",
    window: { title: `${LANG_PREFIX}.title`, icon: "fa-solid fa-door-closed" },
    // The canvas width; `_initializeApplicationOptions` scales it to the seat's type size.
    position: { width: 560 },
    form: { handler: DoorApp.#submit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      bash: DoorApp.#onBash,
      spike: DoorApp.#onSpike,
      unspike: DoorApp.#onUnspike,
      batter: DoorApp.#onBatter,
    },
  };

  // The body is its own scroller, so a re-render after each change keeps its
  // place; the footer is a second part so Batter and Bash never scroll away.
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/formation/door.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/formation/door-footer.hbs` },
  };

  /** The token selected when the window last drew, and its actor: what a press acts for. */
  #token = null;
  #actor = null;

  /** Hook ids for the watch on the selection. */
  #watch = [];

  /** The debounced redraw the selection watch calls, made at first render. */
  #renderSoon = null;

  /** @param {WallDocument} wall */
  constructor(wall, options = {}) {
    super({ ...options, id: options.id ?? doorWindowId(wall) });
    this.wall = wall;
    this.opts = { crowbar: false, sizeSteps: 0, extra: 0, partnerId: "" };
  }

  /** The actor of the token the Judge had selected at the last draw. */
  get basher() {
    return this.#actor;
  }

  /**
   * Open at the canvas width for the seat's type size. `DEFAULT_OPTIONS` is
   * evaluated before settings exist, so the scale is applied here at
   * construction; core clamps the result to the viewport.
   *
   * @override
   */
  _initializeApplicationOptions(options) {
    const opts = super._initializeApplicationOptions(options);
    if (opts.position?.width) opts.position.width = atTypeScale(opts.position.width);
    return opts;
  }

  /**
   * Watch the selection: a different token at the door is a different basher,
   * and the window follows it.
   *
   * @override
   */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#renderSoon ??= foundry.utils.debounce(() => {
      if (!this.rendered) return;
      if ((canvas?.tokens?.controlled?.[0]?.id ?? null) !== (this.#token?.id ?? null)) this.render();
    }, SELECTION_SETTLE_MS);
    this.#watch = [["controlToken", Hooks.on("controlToken", () => this.#renderSoon())]];
  }

  /** @override */
  async _onClose(options) {
    for (const [hook, id] of this.#watch) Hooks.off(hook, id);
    this.#watch = [];
    await super._onClose(options);
  }

  /** The partner the form names, if the basher still has that one among their party's members here; else null. */
  #partner(basher) {
    return this.opts.partnerId ? partnerActors(this.wall, basher).find((a) => a.id === this.opts.partnerId) ?? null : null;
  }

  static async #submit(_event, _form, formData) {
    const d = foundry.utils.expandObject(formData.object);
    // The door's own record lives on the wall; only a field that differs from
    // what is stored is written, so a crowbar tick never touches the wall.
    const state = doorState(this.wall);
    const traits = {};
    if (d.kind !== undefined && d.kind !== (state.kind ?? "")) traits.kind = d.kind;
    if (!!d.evil !== state.evil) traits.evil = !!d.evil;
    if (!!d.jammed !== state.jammed) traits.jammed = !!d.jammed;
    if (Object.keys(traits).length) await setDoorTraits(this.wall, traits);
    this.opts = {
      crowbar: !!d.crowbar,
      sizeSteps: Number(d.sizeSteps) || 0,
      extra: Number(d.extra) || 0,
      partnerId: d.partnerId ?? "",
    };
    this.render();
  }

  async _prepareContext() {
    const token = canvas?.tokens?.controlled?.[0] ?? null;
    const actor = token?.actor ?? null;
    this.#token = token;
    this.#actor = actor;

    const state = doorState(this.wall);
    const partners = partnerActors(this.wall, actor);
    const partner = this.#partner(actor);
    const strMod = bashStrength(actor, partner);
    const thrown = await bashThrow(actor);
    const plan = bashPlan({
      crowbar: this.opts.crowbar, sizeSteps: this.opts.sizeSteps, extra: this.opts.extra,
      target: thrown?.target ?? null, proficient: thrown?.proficient ?? false, strMod, pair: !!partner, spikes: state.spikes,
    });
    const batter = batterPlan(this.wall);
    const cap = maxSpikes();
    const name = actor?.name ?? token?.name ?? loc("noToken");

    // A figure the plan cannot give leaves the needs blank and the tooltip the
    // page alone; nothing is said about what is missing.
    const bashPage = loc("page.bash");
    const sources = { strMod, steps: Math.trunc(this.opts.sizeSteps) || 0, spikes: state.spikes };
    const termParts = plan.ready ? plan.parts.map((p) => {
      const label = loc(`mod.${p.key}`);
      // A term is shown as what it does to the number needed: a bonus to the roll lowers it.
      const effect = -p.value;
      const sign = effect > 0 ? "+" : "";
      const src = termSource(p.key, sources);
      const tip = src
        ? loc("tip.term", { what: loc(`tipWhat.${p.key}`), count: src.count, unit: formationValue(src.table), page: pageOf(src.table, "page.bash") })
        : loc("tip.judge");
      return { label, display: `${sign}${effect}`, tip, bit: src ? `${label} ${sign}${effect} (${pageOf(src.table, "page.bash")})` : `${label} ${sign}${effect}` };
    }) : [];
    const throwPage = loc("page.throw");
    const throwPart = plan.ready ? { label: loc("throw"), display: `${plan.target}+`, tip: loc("tip.throw", { name, page: throwPage }) } : null;
    const needsTip = plan.ready
      ? [loc("tip.needsThrow", { name, target: plan.target, page: throwPage }), ...termParts.map((p) => p.bit)].join(" · ")
      : bashPage;

    const gridPage = pageOf("doors", "page.grid");
    const batterTip = batter.ok ? loc("tip.row", { ordinal: batter.row.ordinal, page: gridPage }) : gridPage;
    const selectedRow = doorRows().find((row) => row.key === state.kind);

    return {
      state,
      actor,
      // Naming the basher matters: the throw below is THEIR Strength, and a
      // Judge with three tokens selected should see which one it used.
      actorName: name,
      // A selected token whose actor cannot throw a Dungeonbashing throw (none, or a creature)
      // is refused on the window; with nothing selected the name says so and nothing more.
      refusal: plan.noThrow && token ? loc("refuse.noThrow") : null,
      plan,
      // What the die must show, which is what a player actually asks for; null
      // (left blank) while the throw is not ready.
      needs: plan.needs,
      needsTip,
      // A bash is thrown only from a ready plan that is not hopeless.
      canBash: plan.ready && !plan.hopeless,
      parts: throwPart ? [throwPart, ...termParts] : [],
      batter: batter.ok
        ? { ok: true, line: game.i18n.format(`${LANG_PREFIX}.batterLine`, { count: batter.count, unit: game.i18n.localize(`${LANG_PREFIX}.unit.${batter.unit}`), tool: batter.tool }) }
        : { ok: false, tooSolid: batter.reason === "tooSolid" },
      batterTip,
      // The unset choice is always first and is the one selected until a row is picked.
      kinds: [{ value: "", label: loc("kindUnset"), selected: !state.kind },
        ...doorRows().map((row) => ({ value: row.key, label: row.label, selected: row.key === state.kind }))],
      kindTip: selectedRow ? loc("tip.row", { ordinal: selectedRow.ordinal, page: gridPage }) : gridPage,
      partners: partners.map((a) => ({ id: a.id, name: a.name, selected: a.id === partner?.id })),
      opts: this.opts,
      canSpike: cap != null && state.spikes < cap,
      maxSpikes: cap ?? "—",
      spikeTip: cap == null ? loc("page.bash") : loc("spikeHint", { page: pageOf("doorSpikeMax", "page.bash") }),
      glyph: doorGlyph(),
    };
  }

  static async #onBash() {
    const actor = this.#actor;
    const r = await bashDoor(this.wall, { actor, partner: this.#partner(actor), crowbar: this.opts.crowbar, sizeSteps: this.opts.sizeSteps, extra: this.opts.extra });
    // A bash missing an imported term is not thrown and the window already shows it blank; no message says so.
    if (!r.ok && r.reason !== "missing") ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.refuse.${r.reason}`));
    this.render();
  }

  static async #onSpike() {
    const r = await spikeDoor(this.wall, this.#actor);
    if (!r.ok) ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.refuse.${r.reason}`));
    this.render();
  }

  static async #onUnspike() {
    await unspikeDoor(this.wall);
    this.render();
  }

  static async #onBatter() {
    const r = await batterDoor(this.wall, this.#actor);
    if (!r.ok) { ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.refuse.${r.reason}`)); return; }
    // The notification says what the clock was charged: the time the grid counts
    // and whose clock, or that no formation held the basher and nothing was spent.
    const time = game.i18n.format(`${LANG_PREFIX}.batterTime`, { count: r.count, unit: game.i18n.localize(`${LANG_PREFIX}.unit.${r.unit}`) });
    ui.notifications?.info(r.formation
      ? game.i18n.format(`${LANG_PREFIX}.batteredDown`, { time, formation: r.formation })
      : game.i18n.format(`${LANG_PREFIX}.batteredNoClock`, { time }));
    this.render();
  }
}

/**
 * Open the window on the door the Judge has selected, or on the wall given. A
 * door whose window is already open has that window fronted instead of a second
 * one made.
 */
export function openDoorApp(wall = null) {
  const target = wall ?? selectedDoor();
  if (!target) return null;
  const open = foundry.applications.instances?.get(doorWindowId(target));
  if (open) {
    const shown = open.render({ force: true });
    open.bringToFront?.();
    return shown;
  }
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
