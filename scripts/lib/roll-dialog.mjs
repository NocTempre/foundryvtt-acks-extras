/* global game, foundry, CONFIG */
/**
 * The roll dialog every roll this module makes asks through: a situational
 * modifier and the message's visibility, the one read of the system's
 * skip-dialog key, and the audit of a rolled total back into its natural die.
 *
 * A situational modifier is a table-side adjustment, so it is written into the
 * FORMULA as its own labelled term (`+ 2[Situational]`), never folded into a
 * target: the card and the dice box then agree, and `auditOf` can read the
 * natural die back out. See docs/lib/DECISIONS.md, "One roll dialog, and the
 * natural die on the card".
 */

/**
 * The visibility modes the dialog offers, in display order.
 * `CONFIG.ChatMessage.modes` also carries `ic` (in-character styling, not
 * visibility), which is not one of them.
 */
const VISIBILITY_MODES = ["public", "gm", "blind", "self"];

const loc = (key) => game.i18n.localize(`ACKS-LIB.rollDialog.${key}`);
const esc = (text) => foundry.utils.escapeHTML?.(String(text ?? "")) ?? String(text ?? "");

/** The event property the system's skip-dialog setting names, or null when the setting is absent. */
export function skipDialogKey() {
  try {
    return game.settings.get("acks", "skip-dialog-key") || null;
  } catch {
    return null;
  }
}

/**
 * Whether a roll skips its dialog: an explicit `true` from the caller, or the
 * system's skip key held on the triggering event. Anything else shows it, as
 * core's own rolls do.
 */
export function skipDialogFor(event, explicit) {
  if (explicit === true) return true;
  const key = skipDialogKey();
  return !!(event && key && event[key]);
}

/** The label a situational modifier carries as a roll term. */
export const situationalLabel = () => loc("situational");

/** ` + 2[Situational]`, the term a bonus adds to a formula; "" for none. */
export function situationalTerm(bonus) {
  const n = Math.trunc(Number(bonus)) || 0;
  if (!n) return "";
  return ` ${n > 0 ? "+" : "-"} ${Math.abs(n)}[${situationalLabel().replace(/[[\]]/g, "")}]`;
}

/**
 * Ask for a situational modifier and a visibility mode.
 *
 * @param {object} opts
 * @param {string} opts.title        the window title
 * @param {string} opts.formula      shown above the fields
 * @param {string} [opts.messageMode] the mode the select opens on; the chat's own when omitted
 * @param {boolean} [opts.lockMode]   the mode is not the roller's to choose: it is stated, not offered
 * @param {number} [opts.bonus]       the modifier the field opens on
 * @param {string} [opts.hint]        replaces the modifier field's hint
 * @returns {Promise<{bonus: number, messageMode: string}|null>} null when the dialog is closed
 */
export async function rollDetailsDialog({ title, formula, messageMode, lockMode = false, bonus = 0, hint = "" } = {}) {
  const mode = messageMode || game.settings.get("core", "messageMode");
  const modeLabel = (k) => game.i18n.localize(CONFIG.ChatMessage.modes[k]?.label ?? k);
  const start = Math.trunc(Number(bonus)) || 0;
  const visibility = lockMode
    ? `<p class="hint">${esc(game.i18n.localize("CHAT.RollVisibility"))}: ${esc(modeLabel(mode))}</p>`
    : `<div class="form-group"><label>${esc(game.i18n.localize("CHAT.RollVisibility"))}</label>
        <div class="form-fields"><select name="messageMode">${VISIBILITY_MODES.map(
          (k) => `<option value="${k}"${k === mode ? " selected" : ""}>${esc(modeLabel(k))}</option>`,
        ).join("")}</select></div></div>`;
  const content = `
    <p class="hint">${esc(formula)}</p>
    <div class="form-group"><label>${esc(loc("bonus"))}</label>
      <div class="form-fields"><input type="number" name="bonus" placeholder="0" step="1" value="${start || ""}" autofocus /></div>
      <p class="hint">${esc(hint || loc("bonusHint"))}</p></div>
    ${visibility}`;
  try {
    return await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title, resizable: true },
      content,
      ok: {
        label: loc("roll"),
        callback: (_ev, button) => ({
          bonus: Math.trunc(Number(button.form.elements.bonus.value)) || 0,
          messageMode: lockMode ? mode : button.form.elements.messageMode?.value || mode,
        }),
      },
      rejectClose: true,
    });
  } catch {
    return null;
  }
}

/**
 * A rolled total read back into its natural die and what was added to it:
 * `{natural, terms: [{value, label}], total}`, or null when the formula is bare
 * dice, holds more than one dice term, or is anything but a plain sum.
 * Duck-typed over the evaluated terms, so it reads a Roll and a test's
 * stand-in alike.
 */
export function auditOf(roll) {
  const terms = roll?.terms ?? [];
  let sign = 1;
  let natural = null;
  const added = [];
  for (const term of terms) {
    if (typeof term?.operator === "string") {
      if (term.operator === "+") sign = 1;
      else if (term.operator === "-") sign = -1;
      else return null;
      continue;
    }
    if (Array.isArray(term?.results) && Number.isFinite(Number(term?.faces))) {
      if (natural != null) return null;
      natural = sign * Number(term.total);
    } else if (typeof term?.number === "number") {
      added.push({ value: sign * term.number, label: String(term.flavor ?? term.options?.flavor ?? "") });
    } else {
      return null;
    }
    sign = 1;
  }
  if (natural == null || !added.length) return null;
  return { natural, terms: added, total: Number(roll.total) };
}

/**
 * "Natural 14 + 2 (Situational) = 16" — `auditOf` as the line a card prints,
 * or "" when there is nothing to audit.
 */
export function auditLine(roll) {
  const audit = auditOf(roll);
  if (!audit) return "";
  const terms = audit.terms
    .map((t) => ` ${t.value < 0 ? "−" : "+"} ${Math.abs(t.value)}${t.label ? ` (${t.label})` : ""}`)
    .join("");
  return game.i18n.format("ACKS-LIB.rollDialog.audit", { natural: audit.natural, terms, total: audit.total });
}
