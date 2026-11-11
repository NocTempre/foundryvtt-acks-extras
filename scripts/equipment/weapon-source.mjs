/**
 * The weapon source equipment registers with the weapon seam: the library's
 * imported weapon rows, placed against the imported lists, in the shape the
 * readers ask for.
 *
 * Nothing here ships a weapon. The `weapons` ruledata document (published by
 * `weapon-rows.mjs` from the minted library weapons) holds one row per printed
 * weapon, and `lib/weapons.mjs` `resolveRows` places each row on a proficiency
 * category, a Weapon Focus group and a damage type from the `weaponLists`
 * document. This file only renames that answer to the fields the classifier,
 * the training units and the sheets read (`cat`, `type`, `twoHandedForced`)
 * and adds the procedure the module runs for each kind of thrown thing. A
 * world that imported no weapons has no rows, and every reader's answer is
 * "not imported".
 *
 * The seam reads the registry at every call; the adapted rows are memoized on
 * the resolver's own (itself memoized) answer, so a row keeps its identity
 * until the registry changes.
 */
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { resolveRows, weaponLists } from "../lib/weapons.mjs";
import { IMPROVISED_THROWN } from "./config.mjs";

/** The ruledata document the minted library weapons are published in. */
export const WEAPONS_DOC = "weapons";

/** The table inside it: one row per weapon key. */
export const WEAPONS_TABLE = "grid";

/**
 * Other spellings of a row's key: a key is the printed name run together, so
 * the common variants of a name resolve to it. An alias answers only where its
 * target is a row of the imported table.
 */
const SPELLINGS = Object.freeze({
  battleax: "battleaxe",
  greatax: "greataxe",
  handax: "handaxe",
  hammer: "warhammer",
  twohandsword: "twohandedsword",
  greatsword: "twohandedsword",
  bastardsword: "sword",
  slingstaff: "staffsling",
  quarterstaff: "staff",
  compbow: "compositebow",
  holywaterflask: "holywater",
  vialofholywater: "holywater",
});

/**
 * What the module does with each kind of thrown thing the book's throwables
 * section names (RR p. 148, p. 297, p. 298): which attack modes it has, which
 * qualities the attack and ammunition paths read, and that no attribute bonus
 * rides its damage. The die and the types are the section's, read at import.
 */
const THROWABLE = Object.freeze({
  oil: { special: ["thrown", "splash", "noDamageBonus"] },
  holyWater: { special: ["thrown", "splash", "consumable", "noDamageBonus"] },
  torch: { melee: true, special: ["thrown", "noDamageBonus", "light"] },
});

/** The qualities of a row and a kind's shape, each once. */
const joined = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];

/**
 * One resolved row as the readers read it. A throwables kind with no grid row
 * of its own (holy water, a torch) is thrown by definition, and the shape the
 * module runs for the kind is added to what the row states.
 */
function adapt(row) {
  const shape = row.throwable ? THROWABLE[row.throwable.kind] : null;
  const out = {
    ...row,
    cat: row.category ?? null,
    type: row.damageType ?? row.types?.[0] ?? null,
    twoHandedForced: row.twoHands === true,
  };
  if (row.kind) {
    out.thrown = true;
    out.missile = true;
    if (shape?.melee) out.melee = true;
  }
  if (shape) out.special = joined(row.special, shape.special);
  return out;
}

/** The adapted rows of one resolver answer, and the focus groups they file under. */
const ADAPTED = new WeakMap();

/** The rows now: the registry's grid, placed, adapted. Empty where none is imported. */
function current() {
  const grid = hasDoc(WEAPONS_DOC) ? (getDoc(WEAPONS_DOC).tables?.[WEAPONS_TABLE] ?? null) : null;
  const resolved = resolveRows(grid, weaponLists());
  let held = ADAPTED.get(resolved);
  if (!held) {
    const rows = {};
    const focus = {};
    for (const [key, row] of Object.entries(resolved)) {
      rows[key] = adapt(row);
      if (row.focus) (focus[row.focus] ??= []).push(key);
    }
    held = { rows, focus };
    ADAPTED.set(resolved, held);
  }
  return held;
}

/** Does every character throw this row proficiently: a throwables kind, or a thrown flask by its printed name? */
const throwsAsAnyone = (_key, row) => !!row.throwable || (!!(row.thrown || row.missile) && IMPROVISED_THROWN.test(row.name ?? ""));

/**
 * The source `registerWeaponSource` takes: its fields read the registry at
 * every call.
 */
export const librarySource = Object.freeze({
  rows: () => current().rows,
  aliases: SPELLINGS,
  focusGroups: () => current().focus,
  throwsAsAnyone,
});
