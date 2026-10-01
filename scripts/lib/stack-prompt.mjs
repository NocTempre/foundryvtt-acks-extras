/* global foundry, ui */
/**
 * The divide prompt: how many to take off a stack, asked the same way by
 * every sheet that lists one.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { makeLoc } from "./util.mjs";
import { divideStack, stackCountOf } from "./item-model.mjs";

const loc = makeLoc(LANG_PREFIX);

/**
 * Ask how many to take off `item`'s stack and divide that many into a row of
 * their own (`divideStack`). A prompt dismissed writes nothing and says
 * nothing; a count that does not fall strictly inside the stack — none, all
 * of it, or more — is refused with a warning.
 * @returns {Promise<Item|null>} the new row, or null when nothing was divided
 */
export async function promptDivide(item) {
  const have = stackCountOf(item) ?? 0;
  if (!item || have < 2) return null;
  const count = await foundry.applications.api.DialogV2.prompt({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("stack.divideTitle", { name: item.name }) },
    content: `<div class="form-group"><label>${loc("stack.divideCount", { have })}</label>
      <input type="number" name="count" value="${Math.floor(have / 2)}" min="1" max="${have - 1}" step="1" autofocus></div>`,
    ok: { label: loc("stack.divide"), callback: (_event, button) => Number(button.form.elements.count.value) },
    rejectClose: false,
  });
  // A dismissed prompt answers null; a count of 0 is an answer, and a refused one.
  if (count == null) return null;
  const made = await divideStack(item, count);
  if (!made) ui.notifications.warn(loc("stack.divideRefused", { have }));
  return made;
}
