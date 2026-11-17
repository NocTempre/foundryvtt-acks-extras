/* global foundry, ui, Roll */
/**
 * The first attack with a weapon that has no damage formula asks for one.
 *
 * Registered as an attack contributor's `prepare` on the lib's seam
 * (`lib/patches/attack-throw.mjs`), which owns the one wrapper of the system's
 * `makeAttackThrow`; nothing here registers with libWrapper. Every attack
 * button reaches that call, so every one is asked before the system builds
 * the throw and, on a hit, rolls the damage from `getDamageFormula`.
 *
 * The answer is saved to the weapon (`damage-blank.mjs` says what is
 * written) and the attack goes ahead with it. Closing the prompt cancels the
 * attack: nothing is written and nothing is rolled. Answers to no setting,
 * since a blank formula is a blank whether or not rolls are automated.
 */
import { LANG } from "./constants.mjs";
import { makeLoc, escape as esc } from "../lib/util.mjs";
import { addAttackContributor } from "../lib/patches/attack-throw.mjs";
import { needsDamageFormula, damageAnswer, savedFormulaUpdates, DAMAGE_FIELD } from "./damage-blank.mjs";
import { recomputeItemFields } from "./properties.mjs";
import * as named from "./overlays/named.mjs";

const loc = makeLoc(LANG);
const CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];

/**
 * Ask for the weapon's damage formula until the answer parses or the prompt
 * is closed. Resolves the formula, or null on a close or a Cancel.
 */
async function askFormula(item) {
  for (;;) {
    const typed = await foundry.applications.api.DialogV2.prompt({
      classes: CLASSES,
      window: { title: loc("damagePrompt.title", { name: item.name ?? "" }) },
      content: `<div class="form-group"><label>${esc(loc("damagePrompt.label"))}<input type="text" name="formula" autofocus></label><p class="hint">${esc(loc("damagePrompt.hint"))}</p></div>`,
      ok: { label: loc("damagePrompt.save"), callback: (_e, button) => button.form.elements.formula.value },
      rejectClose: false,
    }).catch(() => null);
    if (typed === null || typed === undefined) return null;
    const formula = damageAnswer(typed, (f) => Roll.validate(f));
    if (formula) return formula;
    ui.notifications?.warn(loc("damagePrompt.invalid", { formula: String(typed).trim() }));
  }
}

/**
 * Save `formula` onto the weapon and apply its layers over it again. A copy
 * an attack button rolls in place of the stored weapon (a Follower Card
 * override keeps the stored id) takes the formula in memory too, so this
 * attack rolls it; an unsaved weapon takes it in memory only.
 */
async function saveFormula(item, formula) {
  const live = item.id ? (item.collection?.get?.(item.id) ?? null) : null;
  if (live) {
    const { update, layers } = savedFormulaUpdates(live, formula);
    await live.update(update);
    if (layers.pristine) await recomputeItemFields(live);
    if (named.isNamed(live)) await live.update(named.applyUpdates(live));
    if (live === item) return;
  }
  item.updateSource({ [DAMAGE_FIELD]: live ? (live.system?.damage?.base?.formula ?? formula) : formula });
}

/**
 * The contributor's `prepare`: a weapon with no damage formula is asked for
 * one before the attack is built. Resolves false, cancelling the attack, when
 * the prompt is closed or the weapon cannot be written by this user.
 */
export async function prepareDamageFormula(ctx) {
  const item = ctx?.weapon;
  if (!needsDamageFormula(item)) return true;
  const live = item.id ? (item.collection?.get?.(item.id) ?? null) : null;
  if (live && !live.isOwner) {
    ui.notifications?.warn(loc("damagePrompt.notOwner", { name: item.name ?? "" }));
    return false;
  }
  const formula = await askFormula(item);
  if (!formula) return false;
  await saveFormula(item, formula);
  return true;
}

/** The contributor this file registers. */
const damagePromptContributor = Object.freeze({ prepare: prepareDamageFormula });

/** Take the prompt's seat at the attack throw. */
export function registerDamagePrompt() {
  addAttackContributor(damagePromptContributor);
}
