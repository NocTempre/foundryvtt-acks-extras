/* global foundry, game */
/**
 * The unarmed strike's damage prompt: the window `damage-prompt.mjs` opens for
 * a strike with no die, in place of the stored-weapon prompt.
 *
 * The strike is an unsaved weapon built for each throw, so an answer cannot be
 * saved onto it. What the seat is offered to keep it on depends on what the
 * seat may write (`unarmed-keep.mjs`): a seat that may modify world settings
 * keeps it as the world's die, the Judge's override of the equipment document's
 * `unarmedStrike` table, where the Ruledata Browser shows and clears it; a seat
 * that owns the character keeps it on the character, and the Judge is offered
 * the same die for the world (`unarmed-offer.mjs`); any other seat is given the
 * field and Attack alone, and its die is this throw's.
 *
 * The window is built here and not through `DialogV2.prompt`, which resolves on
 * the first submit: a refusal has to leave the window open with its reason on
 * it, so submit is the dialog's own and closing is this file's.
 */
import { LANG } from "./constants.mjs";
import { makeLoc, escape as esc } from "../lib/util.mjs";
import { asUnarmedDie } from "./attack-mods.mjs";
import { DAMAGE_FIELD } from "./damage-blank.mjs";
import { keepScopeFor, keepUnarmedDie, keepCharacterDie } from "./unarmed-keep.mjs";
import { offerToJudge } from "./unarmed-offer.mjs";

const loc = makeLoc(LANG);
const CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];
const ATTACK = "attack";

/** The lang key of what the keep box and its parts say, by what the box keeps it on. */
const KEEP_KEYS = Object.freeze({
  world: { label: "keepLabel", hint: "keepHint", tip: "keepTip", save: "saveTip" },
  character: { label: "keepCharacterLabel", hint: "keepCharacterHint", tip: "keepCharacterTip", save: "saveCharacterTip" },
});

/** The window's body: the field, its hint and the refusal's place, then the keep choice where this seat has one. */
function contentFor(scope, name) {
  const field = `<div class="form-group"><label>${esc(loc("damagePrompt.label"))}<input type="text" name="formula" autofocus data-tooltip-text="${esc(loc("damagePrompt.fieldTip"))}"></label>`
    + `<p class="hint">${esc(loc(scope ? "damagePrompt.hintStrike" : "damagePrompt.hintStrikePlayer"))}</p>`
    + `<p class="acks-error" data-strike-error role="alert" hidden></p></div>`;
  const keys = KEEP_KEYS[scope];
  if (!keys) return field;
  const fill = { name };
  const keep = `<div class="form-group"><label class="acks-check"><input type="checkbox" name="keep" data-tooltip-text="${esc(loc(`damagePrompt.${keys.tip}`, fill))}"><span>${esc(loc(`damagePrompt.${keys.label}`))}</span></label>`
    + `<p class="hint">${esc(loc(`damagePrompt.${keys.hint}`, fill))}</p></div>`;
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
function wire(dialog, scope, name) {
  const root = dialog.element;
  const button = root?.querySelector?.(`button[data-action="${ATTACK}"]`);
  const keep = root?.querySelector?.('input[name="keep"]');
  const sync = () => {
    const keeping = !!keep?.checked;
    const face = button?.querySelector?.("span");
    if (face) face.textContent = loc(keeping ? "damagePrompt.save" : "damagePrompt.attack");
    const tip = keeping ? loc(`damagePrompt.${KEEP_KEYS[scope].save}`, { name }) : loc(scope ? "damagePrompt.attackTip" : "damagePrompt.attackTipPlayer");
    button?.setAttribute?.("data-tooltip-text", tip);
  };
  keep?.addEventListener?.("change", sync);
  sync();
}

/**
 * Ask for the strike's die. Resolves `{die, keep}`, or null when the window is
 * closed. A typed answer that is not a die is refused on the window, which
 * stays open.
 * @param {{name: string, scope: "world"|"character"|null, characterName?: string}} options `scope` is what the keep box keeps it on, null for no box
 * @returns {Promise<{die: string, keep: boolean}|null>}
 */
export function askUnarmedDie({ name, scope, characterName = "" }) {
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
      content: contentFor(scope, characterName),
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
        settle({ die, keep: scope !== null && !!answer.keep });
        await shown.close();
      },
    });
    dialog.addEventListener("render", () => wire(dialog, scope, characterName));
    dialog.addEventListener("close", () => settle(null), { once: true });
    dialog.render({ force: true });
  });
}

/**
 * The strike's `prepare`: ask for a die, keep it where the seat may and it was
 * ticked, and carry it on this throw's weapon. Resolves false, cancelling the
 * attack, when the window is closed.
 * @param {Item} item the unsaved strike
 * @returns {Promise<boolean>}
 */
export async function prepareUnarmedStrike(item) {
  const actor = item?.parent ?? null;
  const scope = keepScopeFor(actor);
  const answer = await askUnarmedDie({ name: item?.name, scope, characterName: actor?.name ?? "" });
  if (!answer) return false;
  if (answer.keep && scope === "world") await keepUnarmedDie(answer.die);
  else if (answer.keep && scope === "character" && (await keepCharacterDie(actor, answer.die))) await offerToJudge(actor, answer.die);
  item.updateSource({ [DAMAGE_FIELD]: answer.die });
  return true;
}
