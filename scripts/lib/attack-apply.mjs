/* global game, Hooks, fromUuid, ui */
/**
 * A weapon hit's Apply, drawn and run by lib. The system's own Apply button
 * writes raw hit points and cannot be wrapped, so the attack seam strips it
 * from every attack card and stamps what a press needs
 * (`patches/attack-throw.mjs`, `ATTACK_APPLY_FLAG`: the target, the figure
 * rolled and the weapon's types, quality and silver). This file adds the press
 * for a Judge, outside the system's `.card-buttons`.
 *
 * A press recomputes against the target's defenses as they stand when it is
 * pressed: `amountAfter` takes the stage `defenseStage` builds from
 * `actorDefenses`, and `adjustHp` writes the result at multiplier 1, so a hit
 * and a spell's damage meet one reducer and one writer. A case the module does
 * not compute (a `judge` stage) offers no Apply; its line names the defense and
 * the page. The result is stored on the message
 * (`{state, applied, steps, before, after, by}`) and a Judge's Undo puts the
 * hit points back with `restoreHp`. Only a Judge presses, as in the system; a
 * defense is named to Judges and to the target's owners, and any other seat
 * reads "a defense". See docs/lib/MODEL.md, "Damage against defenses".
 */
import { LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { amountAfter, HP_MODE } from "./hp-logic.mjs";
import { actorDefenses, actorReductions, defenseFigures, defenseStage, reductionStage } from "./defenses.mjs";
import { ATTACK_APPLY_FLAG } from "./patches/attack-throw.mjs";
import { docOf, el, elementOf, locOr } from "./util.mjs";

/** The button actions the block carries. */
export const ATTACK_APPLY_ACTIONS = Object.freeze({ apply: "libAttackApply", undo: "libAttackUndo" });

/** What a stored result's `state` says. */
export const ATTACK_APPLY_STATE = Object.freeze({ applied: "applied", undone: "undone" });

/** The page a defense's line cites when no import supplied one. */
const FALLBACK_CITE = "RR ch. 6, Damage Type Immunity and Resistance";

/** The strings of this file, the `attackApply` branch of lib's lang root, localized with their `{name}` placeholders filled. */
const text = (key, data = {}) => {
  const raw = locOr(`${LANG_PREFIX}.attackApply.${key}`, key);
  return raw.replace(/\{(\w+)\}/g, (_m, name) => String(data[name] ?? ""));
};

/** The word for a defense on a seat that may name it, or "a defense" on one that may not. */
export function defenseWord(step, named, loc = text) {
  if (!named) return loc("defenseUnnamed");
  return step.source ? loc("defenseNamed", { label: step.label ?? "", source: step.source }) : (step.label ?? loc("defenseUnnamed"));
}

/** The page reference of a defense step: the import's, else the section the module cites. */
export const defenseCiteOf = (step) => step?.cite || locOr(`${LANG_PREFIX}.defense.cite`, FALLBACK_CITE);

/**
 * The damage a stamp holds, in the shape `defenseStage` reads.
 * @param {{types?: string[], extraordinary?: boolean, silver?: boolean}} flag
 */
const damageOfFlag = (flag) => ({ types: flag?.types ?? [], extraordinary: flag?.extraordinary, silver: flag?.silver === true });

/**
 * What a press would apply to `actor` now: `amountAfter` over the stamp's
 * rolled figure and two stages in this order: the actor's reductions per die
 * (`reductionStage`, over the stamp's die count and weapon gates), then the stage
 * the actor's defenses make for its damage. A reduction that could not be
 * decided comes back as `skipped`, `[{source, why}]`, on the plan.
 *
 * @param {{rolled: number, types?: string[], extraordinary?: boolean, silver?: boolean, dice?: number, gates?: object}} flag  the stamp
 * @param {Actor|null} actor
 * @param {{sources?: object[], figures?: object, reductions?: object[]}} [read]  in place of the actor's defenses, the world's resistance figures and the actor's reductions
 * @returns {ReturnType<typeof amountAfter>}
 */
export function planAttackApply(flag, actor, read = {}) {
  const stage = defenseStage(read.sources ?? actorDefenses(actor), damageOfFlag(flag), read.figures ?? defenseFigures());
  const reduced = reductionStage(read.reductions ?? actorReductions(actor), flag);
  const plan = amountAfter(flag.rolled, { stages: [reduced.stage, stage] });
  return reduced.skipped.length ? { ...plan, skipped: reduced.skipped } : plan;
}

/** One step as a line of a tooltip: a defense is named only where `named`, its figures are shown either way. */
export function stepLine(step, named, loc = text) {
  if (step.key === "perDie") return loc("step.perDie", { source: step.source ?? "", cite: step.cite ?? "", per: step.per, dice: step.dice, before: step.before, after: step.after });
  if (step.key === "defense") return loc("step.defense", { defense: defenseWord(step, named, loc), before: step.before, after: step.after });
  return loc("step.round", { before: step.before, after: step.after });
}

/** The tooltip of an applied figure: the rolled figure, then each step, defenses named only where `named`. */
export function stepsTip(rolled, steps, named, loc = text) {
  return [loc("rolled", { rolled }), ...(steps ?? []).map((s) => stepLine(s, named, loc))].join(" · ");
}

/** Whose reading names the defense: a Judge, or an owner of the target. */
export const namesDefense = ({ isGM = false, ownsTarget = false } = {}) => isGM || ownsTarget;

/**
 * Apply one stamped hit, a Judge's press. Computes the amount from the target's
 * defenses now, and writes it through `adjustHp` at multiplier 1.
 *
 * - a judge stage: nothing is written, `{state: "judge", judge}`;
 * - a target whose hit points are not adjusted, or a write that did not land:
 *   `{state: "refused", why}`, and nothing is stored;
 * - an amount of 0 stores a result and writes nothing;
 * - otherwise `{state: "applied", result: {state, applied, steps, before, after, by}}`.
 *
 * @param {object} flag  the stamp
 * @param {{actor: Actor, hpTarget: object|null}|null} found  the target as `lib/hp.mjs` `resolveTargets` reads it
 * @param {{adjustHp: Function, by?: string|null, sources?: object[], figures?: object}} deps
 */
export async function applyAttackHit(flag, found, deps) {
  if (!found?.actor || !found.hpTarget) return { state: "refused", why: "gone" };
  if (found.hpTarget.reason) return { state: "refused", why: found.hpTarget.reason };
  const plan = planAttackApply(flag, found.actor, deps);
  if (plan.judge) return { state: "judge", judge: plan.judge };
  const hp = found.hpTarget.hp?.value ?? null;
  let before = hp;
  let after = hp;
  if (plan.applied > 0) {
    const [written] = await deps.adjustHp([{ target: found.hpTarget, amount: plan.applied, multiplier: 1 }], { mode: HP_MODE.damage });
    if (!written?.ok) return { state: "refused", why: written?.why ?? "failed" };
    ({ before, after } = written);
  }
  return { state: "applied", result: { state: ATTACK_APPLY_STATE.applied, applied: plan.applied, steps: plan.steps, before, after, by: deps.by ?? null } };
}

/**
 * Take an applied hit back: the hit points return to what they were before, as
 * a set. Returns the result as it now stands (`state: "undone"`).
 *
 * @param {object} result  a stored result
 * @param {{actor: Actor, hpTarget: object|null}|null} found
 * @param {{restoreHp: Function}} deps
 */
export async function undoAttackHit(result, found, deps) {
  if (result?.state !== ATTACK_APPLY_STATE.applied) return result;
  if (found?.hpTarget && Number.isFinite(result.before) && Number.isFinite(result.after) && result.before !== result.after) {
    await deps.restoreHp([{ target: found.hpTarget, ok: true, before: result.before, after: result.after }]);
  }
  return { ...result, state: ATTACK_APPLY_STATE.undone };
}

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

/** The stamp of a message, or null. */
const flagOf = (message) => message?.flags?.[MODULE_ID]?.[ATTACK_APPLY_FLAG] ?? null;

/** The target a stamp names, as `lib/hp.mjs` reads it, or null. */
async function resolveTarget(uuid) {
  const { resolveTargets } = await import("./hp.mjs");
  const doc = uuid ? await fromUuid(uuid) : null;
  const token = doc?.documentName === "Token" ? doc : null;
  const actor = token?.actor ?? (doc?.documentName === "Actor" ? doc : null);
  if (!actor) return null;
  const [hpTarget] = resolveTargets(token ? { tokens: [token] } : { actors: [actor] });
  return { actor, hpTarget: hpTarget ?? null };
}

/** The reason a target's hit points are not adjusted, in words. */
const reasonText = (why) => locOr(`${LANG_PREFIX}.hp.reason.${why}`, locOr(`${LANG_PREFIX}.hp.why.${why}`, String(why)));

/** A button of the block. */
function button(action, label, icon, tooltip) {
  const node = el("button", "acks-extras-roll-action");
  node.type = "button";
  node.dataset.action = action;
  if (tooltip) {
    node.dataset.tooltipText = tooltip;
    node.setAttribute("aria-label", `${label}. ${tooltip}`);
  }
  const glyph = el("i", icon);
  glyph.setAttribute("inert", "");
  node.append(glyph, el("span", undefined, label));
  return node;
}

/** The block a card carries for this seat, or null where it has nothing to say. */
function blockFor(message, flag) {
  const isGM = game.user?.isGM === true;
  const target = docOf(flag.targetUuid);
  const actor = target?.documentName === "Token" ? target.actor : target?.documentName === "Actor" ? target : null;
  const ownsTarget = !!actor?.testUserPermission?.(game.user, "OWNER");
  const named = namesDefense({ isGM, ownsTarget });
  const result = flag.result?.state === ATTACK_APPLY_STATE.applied ? flag.result : null;
  const block = el("div", "acks-extras-roll-actions acks-extras-attack-apply");
  if (result) {
    // The target's hit points are a Judge's and its owners' to read; the card shows every other seat the amount alone.
    const line = named
      ? el("span", "acks-extras-roll-detail", text("applied", { amount: result.applied, before: result.before ?? "", after: result.after ?? "" }))
      : el("span", "acks-extras-roll-detail", text("appliedAmount", { amount: result.applied }));
    line.dataset.tooltipText = stepsTip(flag.rolled, result.steps, named);
    block.append(line);
    if (isGM) block.append(button(ATTACK_APPLY_ACTIONS.undo, text("undo"), "fa-solid fa-rotate-left", text("undoTip")));
    return block;
  }
  if (!isGM || !actor) return null;
  const plan = planAttackApply(flag, actor);
  if (plan.judge) {
    const cite = defenseCiteOf(plan.judge);
    const line = el("span", "acks-extras-roll-detail", text("judge", { defense: defenseWord(plan.judge, named), cite }));
    line.dataset.tooltipText = cite;
    block.append(line);
    return block;
  }
  const label = text("apply", { amount: plan.applied });
  block.append(button(ATTACK_APPLY_ACTIONS.apply, label, "fa-solid fa-droplet", stepsTip(flag.rolled, plan.steps, named)));
  return block;
}

/** Press Apply or Undo on a card. */
async function press(messageId, action) {
  const message = game.messages?.get(messageId);
  const flag = flagOf(message);
  if (!message || !flag || !game.user?.isGM) return;
  const found = await resolveTarget(flag.targetUuid);
  if (action === ATTACK_APPLY_ACTIONS.apply) {
    if (flag.result?.state === ATTACK_APPLY_STATE.applied) return;
    const { adjustHp } = await import("./hp.mjs");
    const done = await applyAttackHit(flag, found, { adjustHp, by: game.user.id });
    if (done.state === "refused") {
      ui.notifications?.warn(text("refused", { why: reasonText(done.why) }));
      return;
    }
    if (done.state === "judge") {
      ui.notifications?.warn(text("judge", { defense: defenseWord(done.judge, true), cite: defenseCiteOf(done.judge) }));
      return;
    }
    await message.update({ [`flags.${MODULE_ID}.${ATTACK_APPLY_FLAG}.result`]: done.result });
    return;
  }
  if (flag.result?.state !== ATTACK_APPLY_STATE.applied) return;
  const { restoreHp } = await import("./hp.mjs");
  const undone = await undoAttackHit(flag.result, found, { restoreHp });
  await message.update({ [`flags.${MODULE_ID}.${ATTACK_APPLY_FLAG}.result`]: undone });
}

/** Add the block to a rendered attack card and bind its buttons. */
function onRender(message, html) {
  const flag = flagOf(message);
  const root = elementOf(html);
  if (!flag || !root) return;
  const body = root.querySelector?.(".message-content");
  if (!body) return;
  body.querySelector?.(".acks-extras-attack-apply")?.remove();
  const block = blockFor(message, flag);
  if (!block) return;
  body.append(block);
  for (const node of block.querySelectorAll("button[data-action]")) {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      node.disabled = true;
      Promise.resolve(press(message.id, node.dataset.action))
        .catch((err) => console.error(`${MODULE_ID} | a weapon card's Apply failed`, err))
        .finally(() => {
          node.disabled = false;
        });
    });
  }
}

let hooked = false;

/** Register the render hook that draws the block, once. Called where lib registers its hooks. */
export function installAttackApply() {
  if (hooked) return;
  hooked = true;
  Hooks.on("renderChatMessageHTML", onRender);
}
