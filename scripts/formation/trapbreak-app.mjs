/* global game, foundry, ui */
import { MODULE_ID } from "./constants.mjs";
import { TRAPBREAK_REACH_FEET, STATES, disarmPlan } from "./trap-rules.mjs";
import {
  attemptDisarm,
  attemptRearm,
  disarmRefusal,
  knownPlacementsNear,
  markTrapFound,
  placementsNear,
  resetTrap,
} from "./trap-zone.mjs";
import { getFormation, getMemberActor, realMembers } from "./formation-model.mjs";
import { PARTY_CHECKS, resolveCheck } from "./party-rolls.mjs";
import { requestPartyAction } from "./player-requests.mjs";
import { makeLoc } from "../lib/util.mjs";

const LANG_PREFIX = "ACKS-FORMATION.traps";
const loc = makeLoc(LANG_PREFIX);
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Working on a trap: who is doing it, WHICH trap, and by which column of the
 * table — shown before anything is rolled.
 *
 * **The target is chosen, never inferred.** A party halted in a corridor can be
 * standing at more than one trap, and the thief who spotted the tripwire is not
 * thereby volunteering to put their hands on the pressure plate beside it. The
 * list holds only traps the party has FOUND: an unfound trap offered as a
 * target would announce its existence, which is the whole thing a hidden
 * feature is for. That is also why the list can be empty with traps all around
 * — the answer to "nothing to work on" is to search, not to widen the list.
 *
 * **Players open it too.** Disabling a trap is a character's action, and the
 * throw belongs to their sheet; what a player may not do is write world state,
 * so the attempt is declared and the Judge's client rolls it. Everything the
 * dialog shows a player is already theirs to know: their own throw target, and
 * the traps their party has found.
 */
export default class TrapbreakApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #formationId;

  constructor(options = {}) {
    super(options);
    this.#formationId = options.formationId;
    this.choice = { actorId: options.actorId ?? "", targetUuid: "", mode: "methodical", extra: 0 };
  }

  static DEFAULT_OPTIONS = {
    id: "acks-extras-trapbreak",
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-scroll"],
    tag: "form",
    window: { title: `${LANG_PREFIX}.breakTitle`, icon: "fa-solid fa-screwdriver-wrench" },
    position: { width: 480 },
    form: { handler: TrapbreakApp.#submit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      attempt: TrapbreakApp.#onAttempt,
      rearm: TrapbreakApp.#onRearm,
      markFound: TrapbreakApp.#onMarkFound,
      resetTrap: TrapbreakApp.#onReset,
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/formation/trapbreak.hbs` } };

  get formation() {
    return getFormation(this.#formationId);
  }

  /** The characters this seat may act with: a GM's whole party, a player's own. */
  get candidates() {
    const formation = this.formation;
    if (!formation) return [];
    return realMembers(formation)
      .map(getMemberActor)
      .filter((actor) => actor && (game.user.isGM || actor.testUserPermission(game.user, "OWNER")));
  }

  get actor() {
    const list = this.candidates;
    return list.find((a) => a.id === this.choice.actorId) ?? list[0] ?? null;
  }

  static #submit(_event, _form, formData) {
    const d = foundry.utils.expandObject(formData.object);
    this.choice = {
      actorId: d.actorId ?? "",
      targetUuid: d.targetUuid ?? "",
      mode: d.mode === "hasty" ? "hasty" : "methodical",
      extra: Number(d.extra) || 0,
    };
    this.render();
  }

  async _prepareContext() {
    const formation = this.formation;
    const actor = this.actor;
    // A Judge is shown every trap in reach, found or not, because marking one
    // spotted is one of the things this dialog is for. A player is shown only
    // what the party has found.
    const inReach = game.user.isGM
      ? placementsNear(formation, { feet: TRAPBREAK_REACH_FEET })
      : knownPlacementsNear(formation, TRAPBREAK_REACH_FEET);
    const chosen = inReach.find((p) => p.uuid === this.choice.targetUuid) ?? inReach[0] ?? null;

    const check = actor ? resolveCheck(actor, PARTY_CHECKS[this.choice.mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical"]) : null;
    // What the TRAP is worth is deliberately left out of the plan shown here:
    // whether it was crudely built is the Judge's to know, and the card the
    // throw posts itemises the whole thing afterwards.
    const plan = disarmPlan({ mode: this.choice.mode, skilled: !!check?.skilled, extra: this.choice.extra });
    const refusal = chosen && actor ? disarmRefusal(chosen, actor, this.choice.mode) : chosen ? null : "noZone";

    return {
      isGM: game.user.isGM,
      formationName: formation?.name ?? "",
      actors: this.candidates.map((a) => ({ id: a.id, name: a.name, selected: a.id === actor?.id })),
      hasActor: !!actor,
      targets: inReach.map((p) => ({
        uuid: p.uuid,
        selected: p.uuid === chosen?.uuid,
        label: loc(p.kind === "wall" ? "targetWall" : "targetZone"),
        state: game.i18n.localize(`${LANG_PREFIX}.state.${p.state}`),
        known: p.known,
        feet: Math.round(p.distanceFeet),
      })),
      chosen: chosen ? { uuid: chosen.uuid, known: chosen.known, disarmed: chosen.state === STATES.disarmed } : null,
      mode: this.choice.mode,
      hasty: this.choice.mode === "hasty",
      extra: this.choice.extra,
      check,
      // The number the die must show, which is what a player actually asks for.
      needs: check ? Math.max(2, check.target - check.bonus - this.choice.extra) : null,
      parts: (check?.parts ?? []).map((p) => ({ label: p.label, value: p.value, sign: p.value > 0 ? "+" : "" })),
      extraSign: this.choice.extra > 0 ? "+" : "",
      repeatable: plan.repeatable,
      refusal: refusal ? loc(`refuse.${refusal}`, { name: actor?.name ?? "" }) : null,
      canAttempt: !!actor && !!chosen && !refusal,
      reachFeet: TRAPBREAK_REACH_FEET,
    };
  }

  /** Declare the attempt. A GM's client rolls it; a player's asks the GM's to. */
  static async #onAttempt() {
    const formation = this.formation;
    const actor = this.actor;
    if (!formation || !actor) return;
    const targetUuid = (await this._targetUuid()) ?? "";
    if (!targetUuid) return;
    if (game.user.isGM) await attemptDisarm(formation, actor, { mode: this.choice.mode, extra: this.choice.extra, targetUuid });
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
   * The placement the form currently points at, re-read from the world.
   *
   * Re-read rather than remembered: the dialog stays open across the throws it
   * makes, and the state it is acting on changed the moment the last one landed.
   */
  async _placement() {
    const formation = this.formation;
    if (!formation) return null;
    const inReach = game.user.isGM
      ? placementsNear(formation, { feet: TRAPBREAK_REACH_FEET })
      : knownPlacementsNear(formation, TRAPBREAK_REACH_FEET);
    return inReach.find((p) => p.uuid === this.choice.targetUuid) ?? inReach[0] ?? null;
  }

  async _targetUuid() {
    return (await this._placement())?.uuid ?? null;
  }
}

/** Open the Trapbreaking dialog for a formation. */
export function openTrapbreakApp(formationId, actorId = "") {
  if (!getFormation(formationId)) return null;
  return new TrapbreakApp({ formationId, actorId }).render(true);
}
