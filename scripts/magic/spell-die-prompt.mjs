/* global foundry, game, ui, Hooks, ChatMessage, Roll, fromUuidSync */
/**
 * The damage prompt of a spell whose damage row states no die: the window a
 * cast opens in place of a throw or a roll with no damage in it, and the card
 * that offers the Judge the same die for every copy.
 *
 * The window is the strike's (`equipment/unarmed-prompt.mjs`) with the spell's
 * field: it accepts whatever the row's own roll field holds and the dice roller
 * parses, a flat figure included, and refuses the rest on the window, which
 * stays open. What the seat is offered to keep the die on depends on what it may
 * write: a seat that may modify world settings keeps it on every copy of the
 * spell that has none (`spell-die.mjs`); a seat that may update its own copy of
 * the spell keeps it there, and the Judge is whispered a card whose one press
 * does the world's save; any other seat is given the field and Attack alone.
 * Closing the window cancels the attack.
 *
 * A cast asks once for a row: a thrown row is thrown once per instance and each
 * reads the answer the first gave.
 *
 * The card holds no state. What it says is read from the world when it is drawn:
 * a copy or the entry still blank (the press is offered), or none (it was saved).
 */
import { MODULE_ID, SPELL_DIE_OFFER_FLAG } from "./constants.mjs";
import { escape as esc } from "../lib/util.mjs";
import { addAttackContributor, carrierOf } from "../lib/patches/attack-throw.mjs";
import { byCookbookId } from "../lib/library.mjs";
import { damageBlank } from "./cast-rows.mjs";
import { planKeepForAll, blankCount, keepOn, keepForAll } from "./spell-die.mjs";

const loc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.spellDie.${key}`, data);
const CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];
const ATTACK = "attack";

/** The document field a weapon's base damage formula lives in; the carrier takes the answer there for this throw. */
const DAMAGE_FIELD = "system.damage.base.formula";

const MARK = "data-spell-die-offer";
const PRESS = "data-spell-die-offer-save";
const RESULT = "data-spell-die-offer-result";
const IGNORE = "data-spell-die-offer-ignore";

const liveLookups = () => ({ byCookbookId, fromUuidSync: (uuid) => globalThis.fromUuidSync?.(uuid) });

/** Whether this seat may keep a die for every copy. */
const mayKeepForAll = () => !!game.user?.can?.("SETTINGS_MODIFY");

/**
 * Which keep this seat is offered for `spell`: `"all"` where it may modify world
 * settings, else `"copy"` where Foundry lets it update the spell item, else null.
 * @returns {"all"|"copy"|null}
 */
export function keepScopeFor(spell) {
  if (mayKeepForAll()) return "all";
  if (spell?.canUserModify?.(game.user, "update")) return "copy";
  return null;
}

/** What the keep box and its parts say, by what it keeps the die on. */
const KEEP_KEYS = Object.freeze({
  all: { label: "allLabel", hint: "allHint", tip: "allTip", save: "allSaveTip" },
  copy: { label: "copyLabel", hint: "copyHint", tip: "copyTip", save: "copySaveTip" },
});

/** The window's body: the field, its hint and the refusal's place, then the keep choice where this seat has one. */
function contentFor(scope, fill) {
  const field = `<div class="form-group"><label>${esc(loc("label"))}<input type="text" name="formula" autofocus data-tooltip-text="${esc(loc("fieldTip"))}"></label>`
    + `<p class="hint">${esc(loc(scope ? "hint" : "hintNone", fill))}</p>`
    + `<p class="acks-error" data-spell-die-error role="alert" hidden></p></div>`;
  const keys = KEEP_KEYS[scope];
  if (!keys) return field;
  return field
    + `<div class="form-group"><label class="acks-check"><input type="checkbox" name="keep" data-tooltip-text="${esc(loc(keys.tip, fill))}"><span>${esc(loc(keys.label))}</span></label>`
    + `<p class="hint">${esc(loc(keys.hint, fill))}</p></div>`;
}

/** Put the refusal on the open window and leave it open; nodes are told by `querySelector`, never by `instanceof`. */
function refuse(dialog, typed) {
  const root = dialog.element;
  const box = root?.querySelector?.("[data-spell-die-error]");
  if (box) {
    box.textContent = loc("invalid", { formula: String(typed ?? "").trim() });
    box.hidden = false;
  }
  const input = root?.querySelector?.('input[name="formula"]');
  input?.setAttribute?.("aria-invalid", "true");
  input?.focus?.();
}

/** Keep the button's face and tooltip true to the keep choice: Attack, or Save and attack once the box is ticked. */
function wire(dialog, scope, fill) {
  const root = dialog.element;
  const button = root?.querySelector?.(`button[data-action="${ATTACK}"]`);
  const keep = root?.querySelector?.('input[name="keep"]');
  const sync = () => {
    const keeping = !!keep?.checked;
    const face = button?.querySelector?.("span");
    if (face) face.textContent = loc(keeping ? "save" : "attack");
    button?.setAttribute?.("data-tooltip-text", keeping ? loc(KEEP_KEYS[scope].save, fill) : loc(scope ? "attackTip" : "attackTipNone"));
  };
  keep?.addEventListener?.("change", sync);
  sync();
}

/** The formula the dice roller parses, trimmed; null for none. */
function formulaOf(text) {
  const formula = String(text ?? "").trim();
  if (!formula) return null;
  try {
    return Roll.validate(formula) ? formula : null;
  } catch {
    return null;
  }
}

/**
 * Open the window. Resolves `{die, keep}`, or null when it is closed.
 * @param {{scope: "all"|"copy"|null, fill: object}} options  `fill` is the strings' names: `spell`, `name`, `count`
 */
export function openSpellDieWindow({ scope, fill }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = new foundry.applications.api.DialogV2({
      classes: CLASSES,
      window: { title: loc("title", fill) },
      content: contentFor(scope, fill),
      buttons: [{
        action: ATTACK,
        label: loc("attack"),
        default: true,
        callback: (_event, button) => ({ formula: button.form.elements.formula.value, keep: !!button.form.elements.keep?.checked }),
      }],
      form: { closeOnSubmit: false },
      submit: async (answer, shown) => {
        const die = formulaOf(answer?.formula);
        if (!die) return refuse(shown, answer?.formula);
        settle({ die, keep: scope !== null && !!answer.keep });
        await shown.close();
      },
    });
    dialog.addEventListener("render", () => wire(dialog, scope, fill));
    dialog.addEventListener("close", () => settle(null), { once: true });
    dialog.render({ force: true });
  });
}

/** The answers given, by cast and row; a thrown row asks once however many instances throw. */
const answers = new Map();
const REMEMBERED = 40;

/**
 * Ask for the die of a spell row that states none, keep it where the seat may and
 * it was ticked, and resolve it. Resolves null when the window is closed.
 *
 * @param {{caster: Actor|null, spell: Item, rowKey: string, castId?: string|null, lookups?: object}} options
 * @returns {Promise<string|null>}
 */
export async function askSpellDie({ caster, spell, rowKey, castId = null, lookups = liveLookups() }) {
  const memo = castId ? `${castId}|${rowKey}` : null;
  if (memo && answers.has(memo)) return answers.get(memo);
  const scope = keepScopeFor(spell);
  const fill = { spell: spell?.name ?? "", name: caster?.name ?? "", count: scope === "all" ? blankCount(planKeepForAll(spell, rowKey, { lookups })) : 0 };
  const answer = await openSpellDieWindow({ scope, fill });
  if (!answer) return null;
  if (answer.keep && scope === "all") {
    const made = await keepForAll(spell, rowKey, answer.die, { lookups });
    if (made.failed || made.entry === "failed") ui.notifications?.warn(loc("keepFailed"));
  } else if (answer.keep && scope === "copy" && (await keepOn(spell, rowKey, answer.die))) {
    await offerToJudge({ caster, spell, rowKey, die: answer.die, lookups });
  } else if (answer.keep) ui.notifications?.warn(loc("keepFailed"));
  if (memo) {
    answers.set(memo, answer.die);
    if (answers.size > REMEMBERED) answers.delete(answers.keys().next().value);
  }
  return answer.die;
}

/**
 * The contributor's `prepare` for a spell carrier whose damage row states no
 * die: ask once for the cast, and carry the answer on this throw's weapon.
 * Resolves false, cancelling the attack, when the window is closed. Anything
 * that is not such a carrier is left to the weapon prompt.
 */
export async function prepareSpellDie(ctx) {
  const weapon = ctx?.weapon;
  const carrier = carrierOf(weapon);
  if (!carrier || !damageBlank(carrier.row)) return true;
  const spell = carrier.spellUuid ? fromUuidSync(carrier.spellUuid) : null;
  if (!spell) return true;
  const die = await askSpellDie({ caster: weapon.parent ?? null, spell, rowKey: carrier.rowKey, castId: carrier.castId });
  if (!die) return false;
  weapon.updateSource({ [DAMAGE_FIELD]: die });
  return true;
}

/* -------------------------------------------- */
/*  The offer card                               */
/* -------------------------------------------- */

/**
 * What the card says now: `sent` for a seat that cannot write the world, `offered`
 * for one that can with a copy or the entry still blank, `saved` with none, and
 * `gone` where the spell is no longer in the world.
 * @param {{count: number, mayKeep: boolean, found: boolean}} world
 * @returns {"sent"|"offered"|"saved"|"gone"}
 */
export function offerState({ count, mayKeep, found }) {
  if (!found) return "gone";
  if (count === 0) return "saved";
  return mayKeep ? "offered" : "sent";
}

/** The card's markup: the title, the sentence, the one press, what ignoring it does and what it never reaches. */
export function offerContent({ player, character, spell, die, count = 0 }) {
  const fill = { player, character, spell, die, count };
  return `<div class="acks-ui acks-extras acks-extras-spell-die-offer" ${MARK}>`
    + `<h3>${esc(loc("offer.title"))}</h3>`
    + `<p>${esc(loc("offer.body", fill))}</p>`
    + `<p class="hint" ${RESULT} hidden></p>`
    + `<button type="button" ${PRESS} data-tooltip-text="${esc(loc("offer.saveTip", fill))}">${esc(loc("offer.save"))}</button>`
    + `<p class="hint" ${IGNORE}>${esc(loc("offer.ignore", fill))} ${esc(loc("offer.unlinked"))}</p>`
    + `</div>`;
}

/**
 * Whisper the offer to every seat that may modify world settings.
 * @returns {Promise<ChatMessage|null>} null where no seat can be told
 */
export async function offerToJudge({ caster, spell, rowKey, die, lookups = liveLookups() }) {
  const to = [...(game.users ?? [])].filter((user) => user.can?.("SETTINGS_MODIFY") && user.id !== game.user.id).map((user) => user.id);
  if (!to.length) return null;
  const plan = planKeepForAll(spell, rowKey, { lookups });
  try {
    return await ChatMessage.create({
      content: offerContent({ player: game.user.name, character: caster?.name ?? "", spell: spell.name, die, count: blankCount(plan) }),
      whisper: to,
      speaker: caster ? ChatMessage.getSpeaker({ actor: caster }) : undefined,
      flags: { [MODULE_ID]: { [SPELL_DIE_OFFER_FLAG]: { die, rowKey, spellUuid: spell.uuid, spell: spell.name, character: caster?.name ?? "" } } },
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | the spell die offer was not sent`, err);
    return null;
  }
}

/** The line that follows a press: how many copies took the die, how many kept their own, and what became of the entry. */
export function doneLine(made) {
  const parts = [loc("offer.done", { written: made.written, kept: made.kept })];
  if (made.entry === "written") parts.push(loc("offer.entryWritten"));
  else if (made.entry === "locked") parts.push(loc("offer.entryLocked"));
  else if (made.entry === "failed") parts.push(loc("offer.entryFailed"));
  if (made.failed) parts.push(loc("offer.copiesFailed", { count: made.failed }));
  return parts.join(" ");
}

/** The lookups a drawn card reads the world's spells with; the live ones unless a test registered its own. */
let cardLookups = liveLookups;

/** Draw the card for the world as it is: the press, or the line that replaces it. */
function draw(root, offer, said = "") {
  const spell = offer.spellUuid ? fromUuidSync(offer.spellUuid) : null;
  const count = spell ? blankCount(planKeepForAll(spell, offer.rowKey, { lookups: cardLookups() })) : 0;
  const state = offerState({ count, mayKeep: mayKeepForAll(), found: !!spell });
  const button = root.querySelector(`[${PRESS}]`);
  const result = root.querySelector(`[${RESULT}]`);
  const ignore = root.querySelector(`[${IGNORE}]`);
  if (state === "offered") {
    if (button) button.hidden = false;
    if (result) result.hidden = true;
    return;
  }
  if (button) button.hidden = true;
  if (ignore) ignore.hidden = true;
  if (result) {
    result.textContent = said || loc(`offer.${state}`, { spell: offer.spell, die: offer.die });
    result.hidden = false;
  }
}

/** Wire the one press. */
function bind(root, offer) {
  draw(root, offer);
  const button = root.querySelector(`[${PRESS}]`);
  if (!button || button.dataset.bound) return;
  button.dataset.bound = "1";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    const spell = offer.spellUuid ? fromUuidSync(offer.spellUuid) : null;
    if (!mayKeepForAll() || !spell) return draw(root, offer);
    button.disabled = true;
    const made = await keepForAll(spell, offer.rowKey, offer.die, { lookups: cardLookups() });
    button.disabled = false;
    draw(root, offer, doneLine(made));
  });
}

/**
 * Take the prompt's seat at the attack throw and draw every offer card this client renders.
 * @param {() => object} [lookups]  the world lookups a drawn card reads with
 */
export function registerSpellDiePrompt(lookups = liveLookups) {
  cardLookups = lookups;
  addAttackContributor(Object.freeze({ prepare: prepareSpellDie }));
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const offer = message?.getFlag?.(MODULE_ID, SPELL_DIE_OFFER_FLAG);
    const root = html?.querySelector?.(`[${MARK}]`);
    if (offer?.die && root) bind(root, offer);
  });
}
