/**
 * Core patch: a weapon with no alternate damage starts with none.
 *
 * The system's weapon model (`CONFIG.Item.dataModels.weapon`) gives
 * `damage.alternate.formula` the damage field's own default, a one-handed die,
 * so every weapon built with no alternate (created with a base die only, with
 * `damage.alternate: {}`, stored without the key, or rewritten whole by the
 * system's migration) stores that die and offers a second, two-handed grip
 * nobody gave it. The alternate is a grip choice: a blank formula is the weapon
 * that has none.
 *
 * At `init` the patch sets that one field's `initial` to a blank string, so the
 * schema's own clean-up fills an absent alternate with nothing. The field is
 * the alternate's own instance, so `damage.base.formula` keeps its default, and
 * a record that states an alternate, a die included, is untouched. A weapon
 * already stored with the default die is a stated alternate and stays as it is.
 *
 * This file is the one owner of that field's default: no other patch touches
 * the weapon schema (`attack-throw.mjs` wraps weapon methods, not fields).
 * It stands down, doing nothing, when the model's schema already cleans both an
 * absent alternate and an empty one to a blank formula, so a system release
 * that starts the alternate blank retires it without an edit. It acts only on
 * a blankable `StringField`, and restores the field and warns once if the
 * change does not make the schema clean to a blank.
 */
import { MODULE_ID } from "../constants.mjs";

/** The `damage` objects the probe cleans: one with no alternate, one with an empty alternate. */
const SAMPLES = [
  () => ({ base: { formula: "1d6" } }),
  () => ({ base: { formula: "1d6" }, alternate: {} }),
];

/**
 * Whether the weapon model's schema cleans a damage object that states no
 * alternate to a blank alternate formula, for both an absent alternate and an
 * empty one. `true` when both clean blank, `false` when either keeps a die,
 * `null` when the model has no `damage` field to ask.
 * @param {Function} model The weapon data model class.
 * @returns {boolean|null}
 */
export function alternateCleansBlank(model) {
  const damage = model?.schema?.getField?.("damage");
  if (typeof damage?.clean !== "function") return null;
  try {
    return SAMPLES.every((sample) => damage.clean(sample())?.alternate?.formula === "");
  } catch {
    return null;
  }
}

/**
 * Install at `init`, after the system has assigned its data models and before
 * any weapon is built from a record. Unconditional and settingless: it changes
 * a default the system itself marks as unfinished.
 */
export function installWeaponAlternatePatch() {
  const model = globalThis.CONFIG?.Item?.dataModels?.weapon;
  const field = model?.schema?.getField?.("damage.alternate.formula");
  const StringField = globalThis.foundry?.data?.fields?.StringField;
  if (!field || typeof StringField !== "function" || !(field instanceof StringField)) {
    console.warn(`${MODULE_ID} | no weapon damage.alternate.formula string field to patch; a weapon with no alternate keeps the system's default die.`);
    return;
  }
  const before = alternateCleansBlank(model);
  if (before === true) return;
  if (before === null || field.blank !== true) {
    console.warn(`${MODULE_ID} | the weapon's alternate damage cannot be probed or is not blankable; a weapon with no alternate keeps the system's default die.`);
    return;
  }
  const original = field.initial;
  field.initial = "";
  if (alternateCleansBlank(model) === true) return;
  field.initial = original;
  console.warn(`${MODULE_ID} | blanking the weapon's alternate damage default did not take; a weapon with no alternate keeps the system's default die.`);
}
