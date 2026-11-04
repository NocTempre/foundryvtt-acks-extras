/**
 * Beastman kits: the arms and armour a troop type carries, as a template's
 * Kit axis applies them. Pure, and holds no figure of the page's: each troop
 * type's armour class, move, damage and morale is read from the Judge's own
 * rulebook (RR ch. 9, Beastman Troops), each kind's unarmoured armour class
 * and move from the Judge's AXIOMS (Beastmen by Type), and the die a damage
 * modifier converts to from the same issue's conversion table, all into the
 * `monsters` registry document, and passed in.
 *
 * What ships is the procedure. A troop row's figures stand for the rank and
 * file of its kind as printed. A kit nobody printed a figure for is worked out
 * at generation (`kitArmourClass`): a leader in a troop's kit wears that kit
 * over its own advantage on its warrior, so its armour class is the row's plus
 * the difference between the leader's armour class and its warrior's; an
 * unarmoured creature has its kind's natural armour class, with the same
 * difference for a leader.
 */
import { citeOf, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";

/** The registry document and tables the kits are read from. */
export const KIT_DOC = "monsters";
export const KIT_TABLES = Object.freeze({ troops: "beastmanTroops", byType: "beastmenByType", dice: "damageDieConversion" });

/** The Kit axis's key, its default (the creature's own stat block) and the unarmoured option's key. */
export const KIT_AXIS = "kit";
export const OWN_KIT = "own";
export const UNARMOURED = "unarmoured";

/**
 * A troop row's damage cell as the creature's own modifier: "BW" is 0,
 * "BW-1" is -1, "BW +3" is 3. A row that prints a second figure after a slash
 * (a natural attack beside the weapon) is read for its weapon figure. Null
 * for a cell naming no weapon.
 */
export function troopDamage(text) {
  const first = String(text ?? "").split("/")[0].replace(/[−–—]/g, "-");
  const m = /^\s*BW\s*(?:([+-])\s*(\d+))?\s*$/i.exec(first);
  if (!m) return null;
  return m[1] ? (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10) : 0;
}

const finite = (v) => v !== null && v !== "" && Number.isFinite(Number(v));

/** The live rows of one table: an object of rows, minus the ones the import marked missing. */
const rowsOf = (table) =>
  Object.entries(table && typeof table === "object" ? table : {}).filter(([, r]) => r && typeof r === "object" && !isMissingRow(r));

/**
 * The kits as the Judge's world holds them: `{troops, byType, dice,
 * troopsCite, byTypeCite, diceCite}`. `troops` is every troop row that reads
 * whole (`{kind, troop, ac, move, hd, damage, morale, note}`, `damage` the
 * modifier), `byType` each kind's `{naturalAc}`, `dice` the conversion
 * table's rows. A table not imported is empty, and its citation null.
 */
export function importedKits() {
  const tables = hasDoc(KIT_DOC) ? getDoc(KIT_DOC)?.tables ?? {} : {};
  const troops = [];
  for (const [, r] of rowsOf(tables[KIT_TABLES.troops])) {
    const damage = troopDamage(r.damage);
    if (!r.kind || !r.troop || !finite(r.ac) || damage == null) continue;
    troops.push({
      kind: String(r.kind),
      troop: String(r.troop),
      ac: Number(r.ac),
      move: finite(r.move) ? Number(r.move) : null,
      hd: String(r.hd ?? ""),
      damage,
      morale: finite(r.morale) ? Number(r.morale) : null,
      note: String(r.note ?? ""),
    });
  }
  const byType = {};
  for (const [key, r] of rowsOf(tables[KIT_TABLES.byType])) {
    if (!finite(r.naturalAc)) continue;
    byType[String(r.kind ?? key)] = { naturalAc: Number(r.naturalAc) };
  }
  const dice = Object.fromEntries(rowsOf(tables[KIT_TABLES.dice]));
  const cite = (t) => (hasDoc(KIT_DOC) ? citeOf(KIT_DOC, t) : null);
  return {
    troops,
    byType,
    dice,
    troopsCite: troops.length ? cite(KIT_TABLES.troops) : null,
    byTypeCite: Object.keys(byType).length ? cite(KIT_TABLES.byType) : null,
    diceCite: Object.keys(dice).length ? cite(KIT_TABLES.dice) : null,
  };
}

/**
 * A kit's armour class where no page prints one, worked out at generation:
 * the troop row's armour class, or the kind's natural armour class for the
 * unarmoured option, plus, for a leader, the leader's armour class less its
 * warrior's. `kit` is the cell's `extras.kit` (`{role, ac | naturalAc,
 * memberAc}`); `resolvedAc` the armour class the role's own cell wrote.
 * `{value, base, step, from}` (`from` "troop" or "natural"), or null when a
 * part is missing, so the armour class the cells wrote stands.
 */
export function kitArmourClass(kit, resolvedAc) {
  if (!kit) return null;
  const from = kit.troop === UNARMOURED ? "natural" : "troop";
  const base = from === "natural" ? kit.naturalAc : kit.ac;
  if (!finite(base)) return null;
  const leader = kit.role && kit.role !== "standard";
  let step = 0;
  if (leader) {
    if (!finite(resolvedAc) || !finite(kit.memberAc)) return null;
    step = Number(resolvedAc) - Number(kit.memberAc);
  }
  return { value: Number(base) + step, base: Number(base), step, from, leaderAc: leader ? Number(resolvedAc) : null };
}

/**
 * A generated creature's kit, applied to its resolved payload before it is
 * written (the template engine's resolved hook): a kit with no printed armour
 * class gets the one `kitArmourClass` works out, with its parts on
 * `extras.derived.kit`; and the kit's own words are added to both prose
 * channels, the system biography and the Full Monster Sheet's notes, as the
 * line `noteLine(kit)` returns. A creature with no kit is left as it is.
 * Returns the derivation written, or null.
 */
export function applyGeneratedKit(resolved, { noteLine = () => "" } = {}) {
  const extras = resolved?.flags?.[MODULE_ID]?.[FLAG_EXTRAS];
  const kit = extras?.kit;
  if (!kit) return null;
  let derived = null;
  if (kit.compute) {
    const system = (resolved.system ??= {});
    derived = kitArmourClass(kit, system.ac?.value);
    if (derived) {
      system.ac = { ...(system.ac ?? {}), value: derived.value };
      extras.derived = { ...(extras.derived ?? {}), kit: { ...derived, troop: kit.troop, label: kit.label, cite: kit.cite ?? "", memberAc: kit.memberAc ?? null } };
    }
  }
  const line = noteLine(kit);
  if (line) {
    const system = (resolved.system ??= {});
    system.details = { ...(system.details ?? {}), biography: `${system.details?.biography ?? ""}${line}` };
    extras.description = { ...(extras.description ?? {}), notes: `${extras.description?.notes ?? ""}${line}` };
  }
  return derived;
}

/**
 * The die a weapon's die and a damage modifier convert to, as the imported
 * conversion table prints it ("1d8 or 2d4"), or null where the table is not
 * imported or prints no cell for the pair. The header row says which
 * modifier each column stands for.
 */
export function convertedDie(dice, formula, mod) {
  if (!dice || !formula || !Number.isInteger(mod)) return null;
  const header = dice.header;
  if (!header) return null;
  const die = String(formula).replace(/\s+/g, "").toLowerCase();
  const row = Object.values(dice).find((r) => r && r !== header && String(r.die ?? "").toLowerCase() === die);
  if (!row) return null;
  const col = Object.keys(header).find((k) => /^col\d+$/.test(k) && Number(String(header[k]).replace(/[−–—]/g, "-")) === mod);
  const cell = col ? String(row[col] ?? "").trim() : "";
  return cell || null;
}
