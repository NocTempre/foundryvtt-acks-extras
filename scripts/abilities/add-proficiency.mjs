/* global foundry, ui */
/**
 * Adding a proficiency to a character by hand, straight into the list it
 * belongs to: the character sheet's "Class proficiency" and "General
 * proficiency" controls land here.
 *
 * Where the world has an imported library, the player picks from the list the
 * control names — the bound class's own proficiencies, or the general list —
 * through the same option set and the same `<select>` the level-up wizard and
 * chargen ask their rungs with, and the copy is granted as the type of the
 * list it came from (`grantAbility`'s `proficiencyType`), so a definition that
 * sits on both lists files where the button was pressed. With no list to pick
 * from, or on "Blank", an empty ability of that proficiency type is made and
 * its sheet opened to fill in.
 */
import { LANG_PREFIX, ABILITY_TYPE } from "./constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { whenReady } from "../lib/library.mjs";
import { classForActor, classForActorAsync, findByRef } from "../classes/registry.mjs";
import { rungOptions, rungSelectHtml } from "../classes/picks.mjs";
import { grantAbility, heldCount } from "../classes/grants.mjs";

const loc = makeLoc(LANG_PREFIX);

/**
 * The two proficiency lists a sheet adds to, each as the choice spec that
 * resolves its options. The key is also the `proficiencytype` the added
 * ability carries.
 */
export const PROFICIENCY_LISTS = Object.freeze({
  class: Object.freeze({ from: "classInventory", filter: "proficiencies" }),
  general: Object.freeze({ from: "generalList" }),
});

/**
 * The item data of an empty proficiency of `list` — a core ability whose
 * proficiency type is the list it was added from.
 * @param {"class"|"general"} list
 * @param {string} name
 */
export const blankProficiencyData = (list, name) => ({ name, type: ABILITY_TYPE, system: { proficiencytype: list } });

/**
 * What the player may pick for `list`: every definition the list resolves to
 * in this world, each marked `owned` where the actor already holds it. The
 * class list is the bound class's own, so a character with no class bound has
 * none; the general list is the world's and needs no class. A ref the library
 * cannot resolve is left out, since a pick of it could grant nothing. The
 * library and the bound class are read synchronously, so a caller that can wait
 * loads them first (`addProficiency` does) and hands the class in.
 * @param {Item|null} [classItem] the bound class, where the caller resolved it
 * @returns {Array<{ref: string, name: string, owned: boolean}>}
 */
export function proficiencyOptions(actor, list, classItem = classForActor(actor)) {
  const choice = PROFICIENCY_LISTS[list];
  if (!choice) return [];
  if (list === "class" && !classItem) return [];
  return rungOptions(choice, classItem ?? { system: {} }, actor).filter((o) => !!findByRef(o.ref));
}

/**
 * Ask which proficiency of `list` to add. Resolves `{ref}` for a pick,
 * `{blank: true}` for a blank one, and null when the dialog is closed.
 */
async function askProficiency(list, options) {
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc(`add.title.${list}`) },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    content: rungSelectHtml({ name: "ref", label: loc(`add.from.${list}`), options, offerAnswered: false, placeholder: true }),
    buttons: [
      {
        action: "pick",
        label: loc("add.add"),
        icon: "fa-solid fa-plus",
        default: true,
        callback: (_event, button) => ({ ref: String(button.form?.elements?.ref?.value ?? "") }),
      },
      { action: "blank", label: loc("add.blank"), icon: "fa-regular fa-file", callback: () => ({ blank: true }) },
    ],
    rejectClose: false,
  }).catch(() => null);
  return answer && typeof answer === "object" ? answer : null;
}

/**
 * Add one proficiency of `list` to `actor`. Resolves `{via: "library", ref}`
 * for a pick, `{via: "blank", item}` for a blank one, and null when nothing
 * was made. The library and the bound class are awaited first, so a shelf still
 * loading is not mistaken for an empty list. A pick the actor already holds
 * adds another copy (a rank is a count of copies).
 * @param {Actor} actor
 * @param {"class"|"general"} list
 * @param {{ask?: Function}} [options] replaces the dialog (the offline tests')
 */
export async function addProficiency(actor, list, { ask = askProficiency } = {}) {
  if (!actor?.isOwner || !PROFICIENCY_LISTS[list]) return null;
  // A shelf still loading reads as an empty list and would skip the picker.
  await whenReady();
  const options = proficiencyOptions(actor, list, await classForActorAsync(actor));
  const answer = options.length ? await ask(list, options) : { blank: true };
  if (!answer) return null;

  if (answer.blank) {
    const [item] = await actor.createEmbeddedDocuments("Item", [blankProficiencyData(list, loc(`add.new.${list}`))]);
    item?.sheet?.render(true);
    return { via: "blank", item };
  }

  if (!answer.ref) {
    ui.notifications?.warn(loc("add.chooseFirst"));
    return null;
  }
  const grants = [];
  await grantAbility(actor, answer.ref, grants, { upTo: heldCount(actor, answer.ref) + 1, proficiencyType: list });
  const missing = grants.find((g) => g.missing);
  if (missing) {
    ui.notifications?.warn(loc("add.missing", { name: options.find((o) => o.ref === answer.ref)?.name ?? missing.name }));
    return null;
  }
  return { via: "library", ref: answer.ref };
}
