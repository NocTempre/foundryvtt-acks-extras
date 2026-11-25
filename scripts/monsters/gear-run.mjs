/**
 * The gear items the item carrier runs, built from an imported optional-
 * equipment row (MM pp. 55-56): the three whose paragraphs name a reach, an
 * item that encourages the bearer's subordinates once, an item raised until it
 * is lowered that calls a save of whoever starts a turn or walks within its
 * reach, and an item played so that the bearer's own unit holds a bonus while
 * inside its reach.
 *
 * A row is classified by the VALUE keys it holds, never by its key (the key is
 * minted from the printed label, and no item name is written here). The shape a
 * row takes is the procedure: which reach the carrier raises, which pulse it
 * hears, which filter it applies and which rolls its modifier rides on. Every
 * figure is a live registry reference `{doc, table, row, figure}` into the
 * table the row came from, resolved at the moment of use, so an override or a
 * revert in the Ruledata Browser reaches every item and no figure sits on one.
 * The condition word a row prints is folded onto a catalogue key at generation
 * (`fold`) and a printed qualifier onto kind keys with lib's `matchKinds`; a row
 * whose word or qualifier does not resolve writes no reach and is reported
 * through `miss`, never guessed. Pure and Foundry-free.
 */
import { MODULE_ID } from "./constants.mjs";
import { matchKinds } from "../lib/actor-read.mjs";
import { MONSTER_TYPES } from "./config.mjs";
import { DEFAULT_IMG } from "../importer/constants.mjs";

/** The registry figure keys each shape is built from; a row holding them is that shape. */
const FIGURE = Object.freeze({
  radius: "radius",
  saveKind: "saveKind",
  immunityTurns: "immunityTurns",
  condition: "condition",
  damage: "damage",
  bonus: "bonus",
  reachKind: "reachKind",
  saveQualifier: "saveQualifier",
  saveCircumstance: "saveCircumstance",
});

/** The printed words of a throw made against magic; `magical` is this module's own field for the idea. */
const MAGICAL_WORDS = Object.freeze(["magical", "magic"]);

/** The rolls a played item's bonus rides on: the bearer's own armour class, attack throws and morale (`morale` is the reach vocabulary's word for a reaction part read on a morale roll). */
export const STANDING_ROLLS = Object.freeze(["ac", "attack", "morale"]);

const whole = (v) => typeof v === "number" && Number.isFinite(v);
const word = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The reference to one figure of an equipment row. */
const refTo = (base, rowKey, figure) => ({ doc: base.doc, table: base.table, row: rowKey, figure });

/** The item document a shape is minted as: named by the row, its page on the cookbook id and the carrier's flag holding the activation and the one row. */
function itemData(row, kind, rowData) {
  return {
    name: row.label,
    type: "item",
    img: DEFAULT_IMG.ITEM,
    system: { description: "", subtype: "item", quantity: 1, cost: 0, weight: 0, weight6: 0 },
    flags: {
      [MODULE_ID]: {
        cookbook: { id: `organisation.gear.${row.key}`, cite: row.cite ?? "" },
        itemRun: { activation: { kind, state: { active: false, activationId: "", regionId: "" } }, rows: [rowData] },
      },
    },
  };
}

/**
 * The kind keys a reach's filter names: the row's printed qualifier resolved
 * onto the keys `creatureKinds` carries (`matchKinds` over the race
 * categories and `MONSTER_TYPES`), or null where the import read none or a part
 * of it names no key. A qualifier that matches nothing writes no filter, so a
 * printed name never becomes a key.
 */
const kindsOf = (figures) => {
  const printed = word(figures[FIGURE.reachKind]);
  if (!printed) return null;
  const { kinds, unresolved } = matchKinds(printed, Object.keys(MONSTER_TYPES));
  return kinds.length && !unresolved.length ? kinds : null;
};

/**
 * What a standing row's saving-throw bonus is narrowed to, from the two words
 * the page prints beside it: `{when, magical}` where the circumstance word
 * resolves onto the conditions catalogue (`circumstance`) and the qualifier
 * says the throw is against magic, else null. A row naming neither writes no
 * save part and reports nothing; a row naming one or both that does not resolve
 * reports each word that failed through `miss`, never guessed.
 *
 * @param {object} figures  the row's figures
 * @param {{circumstance?: (word: string) => string|null, miss?: (figure: string, word: string|null) => void}} [deps]
 * @returns {{when: string, magical: true}|null}
 */
export function resolveSaveWhen(figures, { circumstance = () => null, miss = () => {} } = {}) {
  const qualifier = word(figures?.[FIGURE.saveQualifier]);
  const printed = word(figures?.[FIGURE.saveCircumstance]);
  if (!qualifier && !printed) return null;
  const when = printed ? circumstance(printed) : null;
  const magical = !!qualifier && MAGICAL_WORDS.includes(qualifier.toLowerCase().replace(/[^a-z]/g, ""));
  if (!when) miss(FIGURE.saveCircumstance, printed);
  if (!magical) miss(FIGURE.saveQualifier, qualifier);
  return when && magical ? { when, magical: true } : null;
}

/**
 * The gear item a row with a reach is minted as, or null.
 *
 *   - `radius` with `saveKind` and `condition` (a reach that calls a save): a
 *     `toggle` item, row pulse `turnStart+moveIn`, the condition folded to a
 *     catalogue key, `reach.save` and `reach.immunity` (where the window is
 *     printed) references, no kind or unit narrowing;
 *   - `radius` with a numeric `damage` and no save (a reach that encourages
 *     once): a `once` item, row pulse `action`, the filter the bearer's
 *     subordinates (`unit: under`) of the printed kind, an action part on
 *     `damage` that ends with the next attack;
 *   - `radius` with a numeric `bonus` (a reach that holds a part): a `toggle`
 *     item, row pulse `standing`, the filter the bearer's unit and those under
 *     it (`unit: under`) of the printed kind, the part riding on `STANDING_ROLLS`,
 *     and on the saving throw as well, narrowed to its circumstance and to
 *     magic, where the row's two words resolve (`resolveSaveWhen`).
 *
 * A row holding no `radius` is no reach item (null, nothing reported). A row
 * with one that fits no shape, whose condition word folds to no catalogue key
 * or whose printed qualifier was not read writes nothing and goes to
 * `miss(figureKey, word)`.
 *
 * @param {{key: string, label: string, cite?: string, figures?: object}} row
 * @param {{doc: string, table: string, fold: (word: string) => string|null, circumstance?: (word: string) => string|null, miss?: (figure: string, word: string|null) => void}} deps
 *   `doc` and `table` name the registry table the row was read from; `fold` is the condition matcher and `circumstance` the circumstance word's
 */
export function gearRunItem(row, { doc, table, fold, circumstance, miss = () => {} }) {
  const f = row?.figures ?? {};
  if (!row?.key || !row?.label || !whole(f[FIGURE.radius])) return null;
  const base = { doc, table };
  const radius = refTo(base, row.key, FIGURE.radius);

  if (word(f[FIGURE.saveKind])) {
    const printed = word(f[FIGURE.condition]);
    const key = printed ? fold(printed) : null;
    if (!key) {
      miss(FIGURE.condition, printed);
      return null;
    }
    const reach = { radius, save: refTo(base, row.key, FIGURE.saveKind), filter: { kinds: [], exceptKinds: [], side: "any", unit: "any" }, pulse: "turnStart+moveIn", showReach: false };
    if (whole(f[FIGURE.immunityTurns])) reach.immunity = refTo(base, row.key, FIGURE.immunityTurns);
    return itemData(row, "toggle", { key: "reach", type: "conditionGrant", conditions: [key], reach });
  }

  const modifier = whole(f[FIGURE.damage]) ? FIGURE.damage : whole(f[FIGURE.bonus]) ? FIGURE.bonus : null;
  if (!modifier) {
    miss("shape", null);
    return null;
  }
  const kinds = kindsOf(f);
  if (!kinds) {
    miss(FIGURE.reachKind, word(f[FIGURE.reachKind]));
    return null;
  }
  const once = modifier === FIGURE.damage;
  const saveWhen = once ? null : resolveSaveWhen(f, { circumstance, miss });
  const reach = {
    radius,
    modifier: refTo(base, row.key, modifier),
    on: once ? ["damage"] : [...STANDING_ROLLS, ...(saveWhen ? ["save"] : [])],
    ...(saveWhen ? { saveWhen } : {}),
    filter: { kinds, exceptKinds: [], side: "any", unit: "under" },
    pulse: once ? "action" : "standing",
    showReach: false,
  };
  const rowData = { key: "reach", type: "modifier", reach, ...(once ? { endsOn: ["attack"] } : {}) };
  return itemData(row, once ? "once" : "toggle", rowData);
}
