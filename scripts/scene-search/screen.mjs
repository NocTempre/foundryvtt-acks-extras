/* global game, foundry, fromUuidSync, Hooks, ui */
/**
 * The scene screen: one window per party that shows a scene search, drawn from
 * `screen-logic.mjs`'s model for the seat that opened it. A Judge sees every
 * entry and the Judges' log; a player sees what `acksExtras.sceneSearch.read`
 * projects for that seat, once the Judge has shown the scene. The window holds
 * no state of the search: every write goes through the session api and every
 * change to the party, its place or its pot draws the window again.
 *
 * Assigning is a picker on the rail (a member's button, with the reason where
 * the member may not) or a drag of a member tile onto an entry; both end in
 * `assignSceneCheck`, which a player's seat declares to the Judge for their own
 * characters only.
 *
 * On the Judge's seat a third column, left of the entries, is the keying aside:
 * pressing an entry's name selects it, and the aside draws the keying rail
 * (`keying.mjs`, the partial the place sheet's Things here tab shares) for that
 * entry. A player's seat has no aside and its names are text.
 *
 * The window scrolls at its columns; `.window-content` scrolls only where the
 * window is too short for the board's floor (`styles/scene-search.css`).
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { PicksMixin } from "../lib/picks.mjs";
import { PressFocus } from "../lib/press-focus.mjs";
import { getSocket, registerHandler } from "../lib/sockets.mjs";
import { atTypeScale } from "../lib/util.mjs";
import { SETTING_FORMATIONS, getFormation, getMemberActor, getPartyActor, realMembers } from "../formation/formation-model.mjs";
import { resolvePlanTurn } from "../formation/turn-plan.mjs";
import { TEXTURE, textureArt } from "../treasure/card-art.mjs";
import { isPot, viewOf } from "../treasure/pot.mjs";
import { askScenePress, assignSceneCheck, readSceneSearch, sceneAssignments, sceneOptions, showSceneSearch, unassignSceneCheck } from "./api.mjs";
import { resolveSceneRound } from "./round.mjs";
import { CHECK } from "./constants.mjs";
import { KEYING_RAIL_ACTIONS, bindKeyingRail, loadKeyingTemplates, railFor } from "./keying.mjs";
import { placeOfSession, plateNamesOf, readSession, refImageOf } from "./session.mjs";
import { ROOT, buildScreen, firstOpenLayer, memberDragData, memberDropOf } from "./screen-logic.mjs";
import { ROLL_FLAG, sceneReasonText } from "./words.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The socket action that tells the table's other seats the Judge showed the scene. */
const SHOWN_ACTION = "sceneSearchShown";

/** The window id every scene screen takes before its party's id is added. */
const WINDOW_ROOT = "acks-extras-scene-search";

/** The window id of one party's scene screen: one screen per party, however often it is opened. */
export const screenWindowId = (partyId) => `${WINDOW_ROOT}-${partyId}`;

/** A word from the screen's lang file, formatted where it carries data. */
const say = (key, data) => (data && Object.keys(data).length ? game.i18n.format(key, data) : game.i18n.localize(key));

/** The figures a Judge's whispered card carries for one throw, or null where the card is gone or holds none. */
function throwOf(cardId) {
  const figures = game.messages?.get(cardId)?.getFlag?.(MODULE_ID, ROLL_FLAG);
  return figures && typeof figures === "object" ? figures : null;
}

/** A pot's view by its uuid, or null where the uuid names no pot. */
function potViewOf(uuid) {
  try {
    const pile = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    return isPot(pile) ? viewOf(pile) : null;
  } catch {
    return null;
  }
}

/**
 * The scene screen of one party's search. Opened by `openSceneScreen`, and on a
 * player's seat by the Judge showing the scene.
 */
export default class SceneSearchScreen extends PicksMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  #partyId;

  /** The entry the Judge's keying rail has open, by key, or null. */
  #selected = null;

  /** The press whose render is pending: where keyboard focus returns once the HTML is replaced. */
  #press = new PressFocus();

  /** The rail whose assign picker is open, `{key, layer}`, or null. */
  #picking = null;

  /** Hook ids the window watches its party, place and pot through. */
  #watch = [];

  /** The debounced re-render the watch calls, made at first render. */
  #renderSoon = null;

  constructor(options = {}) {
    super({ ...options, id: options.id ?? screenWindowId(options.partyId) });
    this.#partyId = options.partyId;
  }

  static DEFAULT_OPTIONS = {
    // no-scroll: this window scrolls at its entries and party columns inside the
    // body part, not at `.window-content`. The shared contract would make
    // `.window-content` the scroller, which is no part, so the part's retained
    // scroll position below would stop working on a window that draws again on
    // every change to the search.
    classes: ["acks-ui", "acks-extras", "acks-extras-scene-search"],
    window: { title: `${ROOT}title`, icon: "fa-solid fa-magnifying-glass" },
    // The canvas figures; `_initializeApplicationOptions` scales them to the seat's type size.
    position: { width: 1180, height: 760 },
    actions: {
      show: SceneSearchScreen.#onShow,
      round: SceneSearchScreen.#onRound,
      spend: SceneSearchScreen.#onSpend,
      openPot: SceneSearchScreen.#onOpenPot,
      pick: SceneSearchScreen.#onPick,
      cancelPick: SceneSearchScreen.#onCancelPick,
      assign: SceneSearchScreen.#onAssign,
      unassign: SceneSearchScreen.#onUnassign,
      select: SceneSearchScreen.#onSelect,
      ...KEYING_RAIL_ACTIONS,
    },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/scene-search/screen.hbs`,
      scrollable: [".acks-extras-ss-entries", ".acks-extras-ss-aside", ".acks-extras-keying-aside"],
    },
  };

  /** The party's formation, fresh from the world setting. */
  get formation() {
    return getFormation(this.#partyId);
  }

  /** Open at the canvas size for the seat's type size; core clamps the result to the viewport. */
  _initializeApplicationOptions(options) {
    const opts = super._initializeApplicationOptions(options);
    if (opts.position?.width) opts.position.width = atTypeScale(opts.position.width);
    if (opts.position?.height) opts.position.height = atTypeScale(opts.position.height);
    return opts;
  }

  /** The place the keying rail writes to: the session's. */
  keyingPlace() {
    return this.formation ? placeOfSession(readSession(this.formation)) : null;
  }

  /** The members as this seat reads them: every real member, each marked owned where this user owns the character. */
  #members() {
    const formation = this.formation;
    return formation
      ? realMembers(formation)
          .map((member) => ({ member, actor: getMemberActor(member) }))
          .filter(({ actor }) => !!actor)
          .map(({ actor }) => ({ actorId: actor.id, name: actor.name, owned: game.user.isGM || (actor.testUserPermission?.(game.user, "OWNER") ?? false) }))
      : [];
  }

  /** What the open picker lists: each member this seat may assign, with the reason where the member may not attempt the check. */
  #pickerFor(members, entries) {
    const picking = this.#picking;
    if (!picking) return null;
    const searched = entries.find((e) => e.key === picking.key)?.layers[picking.layer]?.check === CHECK.SEARCH;
    const rows = members
      .filter((m) => m.owned)
      .map((m) => {
        const options = sceneOptions({ partyId: this.#partyId, actorId: m.actorId }).find((o) => o.key === picking.key);
        const layer = options?.layers.find((l) => l.layer === picking.layer);
        const refusal = layer?.refusal ?? null;
        const unimported = refusal === "scene:notImported";
        // A blank figure points at the page it is read from: the search's own, or the proficiency's page its member's ability cites.
        const tip = !unimported ? "" : searched ? say(`${ROOT}assign.notImportedTip`) : layer?.data?.cite ? say(`${ROOT}assign.notImportedSkillTip`, { cite: layer.data.cite }) : "";
        return { actorId: m.actorId, name: m.name, blocked: !!refusal, refusal: refusal ? sceneReasonText(refusal, m.name) : "", tip };
      });
    return { ...picking, rows };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const read = this.formation ? readSceneSearch(this.#partyId) : null;
    context.open = !!read;
    context.isGM = game.user.isGM;
    if (!read) return context;
    const members = this.#members();
    const entries = read.entries;
    const model = buildScreen({
      isGM: game.user.isGM,
      read,
      assignments: await sceneAssignments(this.#partyId),
      members,
      names: plateNamesOf(entries),
      potView: potViewOf(read.session.potUuid),
      turn: this.formation?.clock?.turnsTotal ?? null,
      picker: this.#pickerFor(members, entries),
      refOf: (key) => ({ img: refImageOf(entries.find((e) => e.key === key) ?? {}) }),
      throwOf,
      t: say,
    });
    // The Judge's seat alone has the rail; an entry gone from the scene closes it.
    const isGM = game.user.isGM;
    if (isGM) await loadKeyingTemplates();
    if (!entries.some((e) => e.key === this.#selected)) this.#selected = null;
    const cards = isGM ? (model.cards ?? []).map((card) => ({ ...card, selected: card.key === this.#selected })) : model.cards;
    // The grime reads through the art seam: with nothing imported there is none, and a card is a plain slab.
    return Object.assign(context, model, { cards, rail: isGM ? railFor(entries, this.#selected) : null, open: true, texture: textureArt(TEXTURE.grime, 1) });
  }

  /**
   * Start watching before the first draw reads anything, so a change that lands
   * while that draw is being made still draws again.
   *
   * @override
   */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (!this.#watch.length) this.#watchWorld();
  }

  /**
   * Watch what the window draws: the formations record (the plan, the clock,
   * the roster), the party actor (the session), the place (the things) and the
   * pot's cards (the found marks). A change during a draw queues another.
   */
  #watchWorld() {
    const { RENDERING } = foundry.applications.api.ApplicationV2.RENDER_STATES;
    this.#renderSoon ??= foundry.utils.debounce(() => {
      if (this.state >= RENDERING) this.render();
    }, 60);
    const onSetting = (setting) => {
      if (setting?.key === `${MODULE_ID}.${SETTING_FORMATIONS}`) this.#renderSoon();
    };
    const onActor = (actor) => {
      const formation = this.formation;
      if (!formation) return;
      if (actor?.id === getPartyActor(formation)?.id || actor?.uuid === readSceneSearch(this.#partyId)?.place.uuid) this.#renderSoon();
    };
    const onCard = (card) => {
      const potUuid = readSceneSearch(this.#partyId)?.session.potUuid;
      if (potUuid && card?.parent?.uuid === potUuid) this.#renderSoon();
    };
    this.#watch = [
      ["updateSetting", Hooks.on("updateSetting", onSetting)],
      ["updateActor", Hooks.on("updateActor", onActor)],
      ["createCard", Hooks.on("createCard", onCard)],
      ["updateCard", Hooks.on("updateCard", onCard)],
      ["deleteCard", Hooks.on("deleteCard", onCard)],
    ];
  }

  /** @override */
  async _onClose(options) {
    for (const [hook, id] of this.#watch) Hooks.off(hook, id);
    this.#watch = [];
    await super._onClose(options);
  }

  /** Note every `[data-action]` press as it lands, so focus returns to its successor after the draw. @override */
  _attachFrameListeners() {
    super._attachFrameListeners();
    const root = this.element;
    root.addEventListener("click", (event) => this.#press.note(event.target, root), { capture: true });
  }

  /** The drag of a member tile and the drops onto an entry and its rails. @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (game.user.isGM) bindKeyingRail(this);
    for (const tile of root.querySelectorAll("[data-member-drag]")) {
      tile.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", memberDragData(tile.dataset.actorId));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "link";
      });
    }
    for (const zone of root.querySelectorAll("[data-drop-entry]")) {
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "link";
      });
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const actorId = memberDropOf(event.dataTransfer?.getData("text/plain") ?? "");
        if (actorId) this.#dropOn(actorId, zone.dataset.dropEntry, zone.dataset.dropLayer ?? null);
      });
    }
  }

  /** @override */
  async _postRender(context, options) {
    await super._postRender(context, options);
    try {
      this.#press.restore(this.element);
    } catch (err) {
      console.error(`${MODULE_ID} | ${this.constructor.name}: restoring focus failed`, err);
    }
  }

  /** Tell the seat why a call was refused, in the sentence the reason has; a refusal with no words says nothing. */
  #note(answer, name = "") {
    if (answer?.ok !== false) return;
    const text = sceneReasonText(answer.reason, name);
    if (text) ui.notifications.warn(text);
  }

  /** A member dropped on an entry: on a rail, that check; on the card, the first check the member may attempt. */
  async #dropOn(actorId, entryKey, layer) {
    const name = game.actors?.get(actorId)?.name ?? "";
    const check = layer ?? firstOpenLayer(sceneOptions({ partyId: this.#partyId, actorId }).find((o) => o.key === entryKey));
    if (!check) {
      ui.notifications.warn(sceneReasonText("scene:notOffered", name));
      return;
    }
    this.#note(await assignSceneCheck({ partyId: this.#partyId, actorId, layer: check, entryKey }), name);
    this.render();
  }

  /** The Judge shows the scene to the table: the players' seats open this screen. */
  static async #onShow() {
    this.#note(await showSceneSearch(this.#partyId));
    this.render();
  }

  /** The Round press: on the Judge's seat the hasty checks assigned resolve; on a player's it asks the Judge. */
  static async #onRound() {
    const formation = this.formation;
    if (!formation) return;
    if (!game.user.isGM) return this.#note(await askScenePress({ partyId: this.#partyId, press: "round" }));
    await resolveSceneRound(formation);
    this.render();
  }

  /** Spend a turn: on the Judge's seat the party's turn plan resolves, as the Dungeon tab's Advance turn does; on a player's it asks the Judge. */
  static async #onSpend() {
    const formation = this.formation;
    if (!formation) return;
    if (!game.user.isGM) return this.#note(await askScenePress({ partyId: this.#partyId, press: "turn" }));
    await resolvePlanTurn(formation);
    this.render();
  }

  /** Open the pot's own window. */
  static #onOpenPot() {
    const uuid = readSceneSearch(this.#partyId)?.session.potUuid;
    const pile = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    if (pile) pile.sheet.render(true);
  }

  /** Open an entry's keying rail on the Judge's seat. */
  static #onSelect(_event, target) {
    if (!game.user.isGM) return;
    this.#selected = target.dataset.key || null;
    this.render();
  }

  /** Open the assign picker on a rail, or close it where it is already open there. */
  static #onPick(_event, target) {
    const { entry, layer } = target.dataset;
    this.#picking = this.#picking?.key === entry && this.#picking.layer === layer ? null : { key: entry, layer };
    this.render();
  }

  /** Close the picker. */
  static #onCancelPick() {
    this.#picking = null;
    this.render();
  }

  /** Assign the member a picker button names to the rail it is open on. A button for a member who may not attempt the check does nothing: its reason is on the row. */
  static async #onAssign(_event, target) {
    if (target.dataset.blocked === "true") return;
    const { actorId, entry, layer } = target.dataset;
    const name = game.actors?.get(actorId)?.name ?? "";
    this.#picking = null;
    this.#note(await assignSceneCheck({ partyId: this.#partyId, actorId, layer, entryKey: entry }), name);
    this.render();
  }

  /** Take a member off the check a chip shows. */
  static async #onUnassign(_event, target) {
    const name = game.actors?.get(target.dataset.actorId)?.name ?? "";
    this.#note(await unassignSceneCheck({ partyId: this.#partyId, actorId: target.dataset.actorId }), name);
    this.render();
  }
}

/**
 * Open the scene screen for a party, or bring its open one forward.
 * @param {string} partyId the formation's id
 * @returns {SceneSearchScreen}
 */
export function openSceneScreen(partyId) {
  const open = foundry.applications.instances.get(screenWindowId(partyId));
  if (open) {
    open.render({ force: true });
    return open;
  }
  const screen = new SceneSearchScreen({ partyId });
  screen.render({ force: true });
  return screen;
}

/**
 * Tell the table's other seats the Judge showed the scene: a seat that owns one
 * of the party's characters opens its screen. Fire and forget on the module's
 * socket.
 * @param {string} partyId
 */
export function announceSceneShown(partyId) {
  getSocket()?.executeForOthers(SHOWN_ACTION, { partyId });
}

/** A seat told the scene was shown: open the screen when this user plays one of the party. */
function onSceneShown({ partyId } = {}) {
  if (game.user.isGM) return;
  const formation = getFormation(partyId);
  if (!formation) return;
  const plays = realMembers(formation).some((member) => getMemberActor(member)?.testUserPermission?.(game.user, "OWNER"));
  if (plays) openSceneScreen(partyId);
}

/** Register the socket handler the Judge's Show the scene reaches the other seats through. Called once at init. */
export function registerSceneScreen() {
  registerHandler(SHOWN_ACTION, onSceneShown, { broadcast: true });
}
