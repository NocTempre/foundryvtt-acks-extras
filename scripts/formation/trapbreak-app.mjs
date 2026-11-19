/* global game, foundry, ui, Hooks */
import { FORMATION_DOC, MODULE_ID } from "./constants.mjs";
import { STATES } from "./trap-rules.mjs";
import {
  attemptDisarm,
  attemptRearm,
  disarmGate,
  knownPlacementsNear,
  markTrapFound,
  placementsNear,
  resetTrap,
  trapbreakReach,
} from "./trap-zone.mjs";
import { SETTING_FORMATIONS, getFormation, getMemberActor, realMembers } from "./formation-model.mjs";
import { PARTY_CHECKS, resolveCheck } from "./party-rolls.mjs";
import { requestPartyAction } from "./player-requests.mjs";
import { citeOf } from "../lib/tables.mjs";
import { judgeDeclares } from "../lib/sockets.mjs";
import { dieFloor, throwFigures, throwsCite } from "../lib/throws.mjs";
import { atTypeScale, makeLoc } from "../lib/util.mjs";

const LANG_PREFIX = "ACKS-FORMATION.traps";
const loc = makeLoc(LANG_PREFIX);
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The id every Trapbreaking window takes before its party and character are added. */
const WINDOW_ID_ROOT = "acks-extras-trapbreak";

/** How long a burst of document writes settles before the window draws again. */
const REDRAW_SETTLE_MS = 80;

/** Refusals whose sentence is the character's own state at this trap, and not the module's words. */
const STATE_REFUSALS = new Set(["alreadyFailedHasty"]);

/**
 * The window id of one party's window for one character. Core keeps one element
 * per id, so a shared id would let a second window replace the first's element
 * and kill the first instance's actions; the pair's own id lets two characters
 * (or two parties) work side by side, and a second opening of one pair finds
 * the first.
 *
 * @param {string} formationId
 * @param {string} [actorId]
 * @returns {string}
 */
export function trapbreakWindowId(formationId, actorId = "") {
  return [WINDOW_ID_ROOT, formationId, actorId].filter(Boolean).join("-");
}

/** The characters this seat may act with: a GM's whole party, a player's own. */
function seatActors(formation) {
  if (!formation) return [];
  return realMembers(formation)
    .map(getMemberActor)
    .filter((actor) => actor && (game.user.isGM || actor.testUserPermission(game.user, "OWNER")));
}

/**
 * The placements a Trapbreaking attempt can reach. A Judge sees every trap in
 * reach, found or not, because marking one spotted is one of the things the
 * dialog is for; a player sees only what the party has found.
 */
function placementsInReach(formation, reachFeet) {
  return game.user.isGM
    ? placementsNear(formation, { feet: reachFeet })
    : knownPlacementsNear(formation, reachFeet);
}

/** Does an update's `changes` touch this dotted path? */
const touches = (changes, path) => {
  let at = changes;
  for (const key of path.split(".")) {
    if (at == null || typeof at !== "object" || !(key in at)) return false;
    at = at[key];
  }
  return true;
};

/**
 * Working on a trap: who is doing it, which trap, and by which column of the
 * table, shown before anything is rolled. The target is chosen, never inferred,
 * from the traps in reach the party has found (a Judge also sees unfound ones).
 * Players open it too: their attempt is declared and the Judge's client rolls
 * it.
 *
 * One window stands per party and character (`trapbreakWindowId`), and it draws
 * again when the trap, the party, or the character's tools and conditions
 * change. A Judge is warned of what stops a player and may work past it; what
 * leaves nothing to roll stops the Judge too (`disarmGate`). The footer is its
 * own part, pinned under the scrolling body. See docs/formation/MODEL.md, "The
 * Trapbreaking dialog".
 */
export default class TrapbreakApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #formationId;

  /** Hook ids for the watch on the trap, the party and the character. */
  #watch = [];

  /** The debounced redraw the watch calls, made at first render. */
  #renderSoon = null;

  /**
   * @param {object} [options]
   * @param {string} options.formationId
   * @param {string} [options.actorId] the character the window is for
   * @param {object} [options.choice] the mode, target and Judge modifier to start from
   */
  constructor({ formationId, actorId = "", choice = null, ...options } = {}) {
    super({ ...options, id: options.id ?? trapbreakWindowId(formationId, actorId) });
    this.#formationId = formationId;
    this.choice = { actorId, targetUuid: "", mode: "methodical", extra: 0, ...(choice ?? {}) };
  }

  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-scroll", "acks-extras-trapbreak-window"],
    tag: "form",
    window: { title: `${LANG_PREFIX}.breakTitle`, icon: "fa-solid fa-screwdriver-wrench" },
    // The canvas width; `_initializeApplicationOptions` scales it to the seat's type size.
    position: { width: 560 },
    form: { handler: TrapbreakApp.#submit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      attempt: TrapbreakApp.#onAttempt,
      rearm: TrapbreakApp.#onRearm,
      markFound: TrapbreakApp.#onMarkFound,
      resetTrap: TrapbreakApp.#onReset,
    },
  };

  // The body is its own scroller, so a draw after each change keeps its place;
  // the footer is a second part so Work on it never scrolls away.
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/formation/trapbreak.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/formation/trapbreak-footer.hbs` },
  };

  get formation() {
    return getFormation(this.#formationId);
  }

  /** The characters this seat may act with: a GM's whole party, a player's own. */
  get candidates() {
    return seatActors(this.formation);
  }

  get actor() {
    const list = this.candidates;
    return list.find((a) => a.id === this.choice.actorId) ?? list[0] ?? null;
  }

  /** The title bar names the party and the character the window is for. */
  get title() {
    return game.i18n.format(`${LANG_PREFIX}.breakWindowTitle`, {
      title: game.i18n.localize(`${LANG_PREFIX}.breakTitle`),
      party: this.formation?.name ?? "",
      name: this.actor?.name ?? "",
    });
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
   * Watch what the window shows: the trap (walls, region behaviors, the place's
   * things), the party (its record, its token), and the character (their
   * record, items and effects). Each write draws it again once.
   *
   * @override
   */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#renderSoon ??= foundry.utils.debounce(() => {
      if (this.rendered) this.render();
    }, REDRAW_SETTLE_MS);
    const mine = (id) => !!id && this.candidates.some((a) => a.id === id);
    const soon = () => this.#renderSoon();
    const onActor = (actor, changes) => {
      if (mine(actor?.id) || touches(changes, `flags.${MODULE_ID}`) || touches(changes, "ownership")) soon();
    };
    const onItem = (item) => { if (mine(item?.parent?.id)) soon(); };
    const onEffect = (effect) => { if (mine(effect?.parent?.id) || mine(effect?.parent?.parent?.id)) soon(); };
    const onToken = (token) => { if (token?.id === this.formation?.tokenId) soon(); };
    const onSetting = (setting) => { if (setting?.key === `${MODULE_ID}.${SETTING_FORMATIONS}`) soon(); };
    this.#watch = [
      ...["updateWall", "createWall", "deleteWall", "updateRegion", "updateRegionBehavior", "createRegionBehavior", "deleteRegionBehavior"].map((name) => [name, Hooks.on(name, soon)]),
      ["updateActor", Hooks.on("updateActor", onActor)],
      ...["createItem", "updateItem", "deleteItem"].map((name) => [name, Hooks.on(name, onItem)]),
      ...["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"].map((name) => [name, Hooks.on(name, onEffect)]),
      ["updateToken", Hooks.on("updateToken", onToken)],
      ["createSetting", Hooks.on("createSetting", onSetting)],
      ["updateSetting", Hooks.on("updateSetting", onSetting)],
    ];
  }

  /** @override */
  async _onClose(options) {
    for (const [hook, id] of this.#watch) Hooks.off(hook, id);
    this.#watch = [];
    await super._onClose(options);
  }

  static async #submit(_event, _form, formData) {
    const d = foundry.utils.expandObject(formData.object);
    const next = {
      targetUuid: d.targetUuid ?? "",
      mode: d.mode === "hasty" ? "hasty" : "methodical",
      extra: Number(d.extra) || 0,
    };
    // A window belongs to one character: picking another hands the choice to
    // that character's window, opened or fronted, and closes this one.
    if (d.actorId && d.actorId !== this.actor?.id) {
      openTrapbreakApp(this.#formationId, d.actorId, next);
      await this.close();
      return;
    }
    this.choice = { actorId: this.actor?.id ?? this.choice.actorId, ...next };
    this.render();
  }

  /**
   * What the die must show, with the parts that make it: `{needs, tip}`, both
   * null where the character's throw is not read. The floor of the die is the
   * general rule's (`dieFloor`); with nothing imported it is absent, so the
   * target alone decides. A skilled thrower's automatic-success face lowers it.
   */
  #needsOf(check, actor, extra) {
    const page = loc("pageThrow");
    if (!check || !Number.isFinite(check.target)) return { needs: null, tip: page };
    const wanted = check.target - (Number(check.bonus) || 0) - extra;
    const { succeedMin } = throwFigures();
    const succeeds = check.skilled && succeedMin != null && succeedMin < wanted;
    const floor = dieFloor();
    const needs = Math.max(floor ?? 1, succeeds ? succeedMin : wanted);
    const dicePage = throwsCite() ?? loc("pageDice");
    const bits = [
      loc("tipNeeds", { name: actor?.name ?? "", source: check.source, target: check.target, page }),
      ...(check.parts ?? []).map((p) => partTip(p, page)),
    ];
    if (extra) bits.push(loc("tipJudge", { value: signed(extra) }));
    if (succeeds) bits.push(loc("tipSucceeds", { face: succeedMin, page: dicePage }));
    if (floor != null) bits.push(loc("tipFloor", { floor, page: dicePage }));
    return { needs, tip: bits.join(" · ") };
  }

  async _prepareContext() {
    const formation = this.formation;
    const actor = this.actor;
    const isGM = judgeDeclares();
    const reachFeet = trapbreakReach();
    const reachImported = reachFeet > 0;
    const inReach = placementsInReach(formation, reachFeet);
    const chosen = inReach.find((p) => p.uuid === this.choice.targetUuid) ?? inReach[0] ?? null;
    const mode = this.choice.mode === "hasty" ? "hasty" : "methodical";
    // The Judge's modifier is the Judge's and rides their throw; a player's request carries none.
    const extra = isGM ? this.choice.extra : 0;
    const page = loc("pageTrapbreak");

    const check = actor ? resolveCheck(actor, PARTY_CHECKS[mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical"]) : null;
    const { needs, tip: needsTip } = this.#needsOf(check, actor, extra);

    // One gate for the dialog and the throw: a Judge is warned of the soft refusals and may go on.
    const gate = chosen && actor ? disarmGate(chosen, actor, mode, { judge: isGM }) : { block: chosen ? null : "noZone", warnings: [] };
    const level = Number(actor?.system?.details?.level) || 1;
    const said = (reason) => {
      if (STATE_REFUSALS.has(reason)) return { text: loc("stateFailedHasty", { name: actor?.name ?? "", level: Number(chosen?.repeatLock?.[actor?.id]) || level }), tip: page };
      return { text: loc(`refuse.${reason}`, { name: actor?.name ?? "" }), tip: null };
    };
    // A character with no throw in either column has the blank needs and the page, and nothing is said about
    // what is missing; one who throws methodically and not hastily lacks the skill, and the window says so.
    const lacksSkill = gate.block === "cannotTry" && mode === "hasty" && !!resolveCheck(actor, PARTY_CHECKS.trapbreakMethodical);
    const refusal = lacksSkill ? said("hastyNeedsSkill") : gate.block && gate.block !== "cannotTry" ? said(gate.block) : null;
    const warnings = gate.warnings.map(said).map((w) => ({ ...w, advice: loc("breakWarning") }));
    // The character's own state at this trap, when no refusal already says it.
    const note = chosen && actor && !gate.warnings.concat(gate.block ?? []).some((r) => STATE_REFUSALS.has(r))
      ? { text: loc("stateNoFailedHasty", { name: actor.name, level }), tip: page }
      : null;

    return {
      isGM,
      formationName: formation?.name ?? "",
      actors: this.candidates.map((a) => ({ id: a.id, name: a.name, selected: a.id === actor?.id })),
      hasActor: !!actor,
      targets: inReach.map((p) => ({
        uuid: p.uuid,
        selected: p.uuid === chosen?.uuid,
        label: targetLabel(p),
        state: game.i18n.localize(`${LANG_PREFIX}.state.${p.state === STATES.armed && p.known ? STATES.found : p.state}`),
        known: p.known,
        distance: reachImported ? loc("feet", { feet: Math.round(p.distanceFeet) }) : loc("breakTouching"),
      })),
      chosen: chosen ? { uuid: chosen.uuid, known: chosen.known, disarmed: chosen.state === STATES.disarmed } : null,
      mode,
      hasty: mode === "hasty",
      modeTip: page,
      extra,
      check,
      hasThrow: !!check,
      needs,
      needsTip,
      throwLine: check ? { source: check.source, target: check.target, tip: loc("tipNeeds", { name: actor?.name ?? "", source: check.source, target: check.target, page: loc("pageThrow") }) } : null,
      parts: (check?.parts ?? []).map((p) => ({ label: p.label, display: `${signed(p.value)}`, tip: partTip(p, loc("pageThrow")) })),
      judgePart: extra ? { display: signed(extra), tip: loc("tipJudge", { value: signed(extra) }) } : null,
      refusal,
      warnings,
      note,
      canAttempt: !!actor && !!chosen && !gate.block,
      canRearm: !!actor && chosen?.state === STATES.disarmed,
      showRearm: isGM || chosen?.state === STATES.disarmed,
      reachText: reachImported ? loc("feet", { feet: reachFeet }) : "—",
      reachTip: reachImported ? loc("tipReach", { page: citeOf(FORMATION_DOC, "trapbreakReachFeet") ?? page }) : page,
      reachImported,
    };
  }

  /** Declare the attempt. A GM's client rolls it; a player's asks the GM's to, and carries no modifier. */
  static async #onAttempt() {
    const formation = this.formation;
    const actor = this.actor;
    if (!formation || !actor) return;
    const targetUuid = (await this._targetUuid()) ?? "";
    if (!targetUuid) return;
    if (judgeDeclares()) await attemptDisarm(formation, actor, { mode: this.choice.mode, extra: this.choice.extra, targetUuid, askUserId: game.user.id, judge: true });
    else await requestPartyAction(formation.id, "trapbreak", { actorId: actor.id, targetUuid, mode: this.choice.mode });
    this.render();
  }

  static async #onRearm() {
    const formation = this.formation;
    const actor = this.actor;
    if (!formation || !actor) return;
    const targetUuid = (await this._targetUuid()) ?? "";
    if (!targetUuid) return;
    if (game.user.isGM) await attemptRearm(formation, actor, { targetUuid });
    else await requestPartyAction(formation.id, "trapRearm", { actorId: actor.id, targetUuid });
    this.render();
  }

  static async #onMarkFound() {
    if (!game.user.isGM) return;
    const target = await this._placement();
    if (!target) return;
    await markTrapFound(target);
    this.render();
  }

  static async #onReset() {
    if (!game.user.isGM) return;
    const target = await this._placement();
    if (!target) return;
    await resetTrap(target);
    ui.notifications?.info(loc("resetDone"));
    this.render();
  }

  /**
   * The placement the form currently points at, re-read from the world each
   * call because the dialog stays open across its own throws.
   */
  async _placement() {
    const formation = this.formation;
    if (!formation) return null;
    const inReach = placementsInReach(formation, trapbreakReach());
    return inReach.find((p) => p.uuid === this.choice.targetUuid) ?? inReach[0] ?? null;
  }

  async _targetUuid() {
    return (await this._placement())?.uuid ?? null;
  }
}

/** A signed figure: a plus on a positive one. */
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;

/** One part of a throw as a tooltip: its name, its figure and the page it came from (the throw's own page when it names none). */
const partTip = (part, fallbackPage) => `${part.label} ${signed(part.value)} (${part.cite ?? fallbackPage})`;

/**
 * How a trap is listed: a trap thing by its place's name, a wall and a zone by
 * their kind. The place's name is the world's own.
 */
function targetLabel(placement) {
  if (placement.kind === "wall") return loc("targetWall");
  if (placement.kind === "thing") return loc("targetThing", { place: placement.doc?.name ?? "" });
  return loc("targetZone");
}

/**
 * Open the Trapbreaking dialog for a formation and character; with no
 * character, the seat's first. A pair whose window is already open has that
 * window fronted instead of a second one made.
 *
 * @param {string} formationId
 * @param {string} [actorId]
 * @param {object} [choice] the mode, target and Judge modifier to start from
 */
export function openTrapbreakApp(formationId, actorId = "", choice = null) {
  const formation = getFormation(formationId);
  if (!formation) return null;
  const seat = seatActors(formation);
  const pick = seat.find((a) => a.id === actorId) ?? seat[0] ?? null;
  const open = foundry.applications.instances?.get(trapbreakWindowId(formationId, pick?.id));
  if (open) {
    const shown = open.render({ force: true });
    open.bringToFront?.();
    return shown;
  }
  return new TrapbreakApp({ formationId, actorId: pick?.id ?? "", choice }).render(true);
}
