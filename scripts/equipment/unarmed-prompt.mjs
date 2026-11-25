/* global foundry, game, ui */
/**
 * The unarmed strike's damage prompt: the window `damage-prompt.mjs` opens for
 * a strike with no die imported, in place of the stored-weapon prompt.
 *
 * The strike is an unsaved weapon built for each throw, so an answer cannot be
 * saved onto it. The die the Judge's import would have supplied lives in the
 * `equipment` document's `unarmedStrike` table, so keeping an answer writes it
 * there as the Judge's override (`ruledata-import` contract, `setOverride`),
 * where the Ruledata Browser shows and clears it. A seat without the
 * permission to modify world settings, which a world-setting write needs, is
 * given the field and Attack alone: its die applies to this throw and the next
 * press asks again.
 *
 * The window is built here and not through `DialogV2.prompt`, which resolves on
 * the first submit: a refusal has to leave the window open with its reason on
 * it, so submit is the dialog's own and closing is this file's.
 */
import { LANG } from "./constants.mjs";
import { makeLoc, escape as esc } from "../lib/util.mjs";
import { asUnarmedDie, PRINTED_FIGURE_TABLES } from "./attack-mods.mjs";
import { RULEDATA_DOC } from "./overlays/scavenged.mjs";
import { DAMAGE_FIELD } from "./damage-blank.mjs";

const loc = makeLoc(LANG);
const CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];
const ATTACK = "attack";

/** The permission Foundry asks of a write to a world setting, which is where a kept die is stored. */
const KEEP_PERMISSION = "SETTINGS_MODIFY";

/** Whether this seat may keep a die for the world. */
export const mayKeepUnarmedDie = () => !!game.user?.can?.(KEEP_PERMISSION);

/** The window's body: the field, its hint and the refusal's place, then the keep choice where this seat has one. */
function contentFor(canKeep) {
  const field = `<div class="form-group"><label>${esc(loc("damagePrompt.label"))}<input type="text" name="formula" autofocus data-tooltip-text="${esc(loc("damagePrompt.fieldTip"))}"></label>`
    + `<p class="hint">${esc(loc(canKeep ? "damagePrompt.hintStrike" : "damagePrompt.hintStrikePlayer"))}</p>`
    + `<p class="acks-error" data-strike-error role="alert" hidden></p></div>`;
  if (!canKeep) return field;
  const keep = `<div class="form-group"><label class="acks-check"><input type="checkbox" name="keep" data-tooltip-text="${esc(loc("damagePrompt.keepTip"))}"><span>${esc(loc("damagePrompt.keepLabel"))}</span></label>`
    + `<p class="hint">${esc(loc("damagePrompt.keepHint"))}</p></div>`;
  return field + keep;
}

/**
 * Put the refusal on the open window and leave it open. The window's own
 * nodes are told by `querySelector`, never by `instanceof`, since a window
 * may be built by another document's realm.
 */
function refuse(dialog, typed) {
  const root = dialog.element;
  const box = root?.querySelector?.("[data-strike-error]");
  if (box) {
    box.textContent = loc("damagePrompt.invalidDie", { formula: String(typed ?? "").trim() });
    box.hidden = false;
  }
  const input = root?.querySelector?.('input[name="formula"]');
  input?.setAttribute?.("aria-invalid", "true");
  input?.focus?.();
}

/**
 * Keep the button's face and tooltip true to the keep choice: Attack, or Save
 * and attack once the box is ticked.
 */
function wire(dialog, canKeep) {
  const root = dialog.element;
  const button = root?.querySelector?.(`button[data-action="${ATTACK}"]`);
  const keep = root?.querySelector?.('input[name="keep"]');
  const sync = () => {
    const keeping = !!keep?.checked;
    const face = button?.querySelector?.("span");
    if (face) face.textContent = loc(keeping ? "damagePrompt.save" : "damagePrompt.attack");
    button?.setAttribute?.("data-tooltip-text", loc(keeping ? "damagePrompt.saveTip" : canKeep ? "damagePrompt.attackTip" : "damagePrompt.attackTipPlayer"));
  };
  keep?.addEventListener?.("change", sync);
  sync();
}

/**
 * Ask for the strike's die. Resolves `{die, keep}`, or null when the window is
 * closed. A typed answer that is not a die is refused on the window, which
 * stays open.
 * @param {{name: string, canKeep: boolean}} options `canKeep` offers the keep choice
 * @returns {Promise<{die: string, keep: boolean}|null>}
 */
export function askUnarmedDie({ name, canKeep }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = new foundry.applications.api.DialogV2({
      classes: CLASSES,
      window: { title: loc("damagePrompt.title", { name: name ?? "" }) },
      content: contentFor(canKeep),
      buttons: [{
        action: ATTACK,
        label: loc("damagePrompt.attack"),
        default: true,
        callback: (_event, button) => ({ formula: button.form.elements.formula.value, keep: !!button.form.elements.keep?.checked }),
      }],
      form: { closeOnSubmit: false },
      submit: async (answer, shown) => {
        const die = asUnarmedDie(answer?.formula);
        if (!die) return refuse(shown, answer?.formula);
        settle({ die, keep: canKeep && !!answer.keep });
        await shown.close();
      },
    });
    dialog.addEventListener("render", () => wire(dialog, canKeep));
    dialog.addEventListener("close", () => settle(null), { once: true });
    dialog.render({ force: true });
  });
}

/**
 * Keep `die` as the world's unarmed die: the Judge's override of the
 * `unarmedStrike` table's damage, through the `ruledata-import` contract.
 * Resolves whether it was written; a failure is said on the screen.
 * @param {string} die
 * @returns {Promise<boolean>}
 */
export async function keepUnarmedDie(die) {
  const svc = globalThis.acksExtras?.lib?.services?.get?.("ruledata-import");
  try {
    if (typeof svc?.setOverride !== "function") throw new Error("no provider can write an override");
    await svc.setOverride(RULEDATA_DOC, PRINTED_FIGURE_TABLES.unarmed, { damage: die }, { sourceName: "unarmed strike prompt" });
    return true;
  } catch (err) {
    console.warn("acks-extras | the unarmed die was not kept", err);
    ui.notifications?.warn(loc("damagePrompt.keepFailed"));
    return false;
  }
}

/**
 * The strike's `prepare`: ask for a die, keep it where the seat may and the
 * Judge ticked, and carry it on this throw's weapon. Resolves false, cancelling
 * the attack, when the window is closed.
 * @param {Item} item the unsaved strike
 * @returns {Promise<boolean>}
 */
export async function prepareUnarmedStrike(item) {
  const answer = await askUnarmedDie({ name: item?.name, canKeep: mayKeepUnarmedDie() });
  if (!answer) return false;
  if (answer.keep) await keepUnarmedDie(answer.die);
  item.updateSource({ [DAMAGE_FIELD]: answer.die });
  return true;
}
