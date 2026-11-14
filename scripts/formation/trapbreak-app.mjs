/* global game, foundry, ui */
import { MODULE_ID } from "./constants.mjs";
import { STATES, disarmPlan } from "./trap-rules.mjs";
import {
  attemptDisarm,
  attemptRearm,
  disarmRefusal,
  knownPlacementsNear,
  markTrapFound,
  placementsNear,
  resetTrap,
  trapbreakReach,
} from "./trap-zone.mjs";
import { getFormation, getMemberActor, realMembers } from "./formation-model.mjs";
import { PARTY_CHECKS, resolveCheck } from "./party-rolls.mjs";
import { requestPartyAction } from "./player-requests.mjs";
import { makeLoc } from "../lib/util.mjs";

const LANG_PREFIX = "ACKS-FORMATION.traps";
const loc = makeLoc(LANG_PREFIX);
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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

/**
 * Working on a trap: who is doing it, which trap, and by which column of the
 * table, shown before anything is rolled. The target is chosen, never inferred,
 * from the traps in reach the party has found (a Judge also sees unfound ones).
 * Players open it too: their attempt is declared and the Judge's client rolls
 * it. See docs/formation/DECISIONS.md, "Trapbreaking picks its target, and refuses an unfound trap".
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
    const reachFeet = trapbreakReach();
    const inReach = placementsInReach(formation, reachFeet);
    const chosen = inReach.find((p) => p.uuid === this.choice.targetUuid) ?? inReach[0] ?? null;

    const check = actor ? resolveCheck(actor, PARTY_CHECKS[this.choice.mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical"]) : null;
    // The plan omits whether the trap is crude (the Judge's to know); the posted card itemises it.
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
      // 0 reads as "not imported": only a trap the party touches is offered.
      reachFeet: reachFeet > 0 ? reachFeet : null,
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

/** Open the Trapbreaking dialog for a formation. */
export function openTrapbreakApp(formationId, actorId = "") {
  if (!getFormation(formationId)) return null;
  return new TrapbreakApp({ formationId, actorId }).render(true);
}
