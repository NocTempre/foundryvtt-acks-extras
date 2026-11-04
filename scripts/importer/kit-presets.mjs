/**
 * A beastman template's KIT axis: the troop types its kinds field, as presets
 * of the template engine (`lib/template-logic.mjs`). Pure: the troop rows,
 * the natural armour classes and their citations are the Judge's imported
 * tables (`monsters/kits.mjs` `importedKits`), passed in.
 *
 * A troop row writes stat cells only, never an item: its armour class, damage
 * total, move and morale, for the rank and file of the kind it is printed
 * for, with the kit's own words and the row's citation on `extras.kit`. A row
 * stands for a variant only where the variant is that kind and its Hit Dice
 * are the row's, so a row read under the wrong heading never dresses another
 * kind. A leader in a troop's kit, and any creature with the kit taken off,
 * have no printed armour class: their cells carry `extras.kit.compute` and the
 * monsters feature works it out at generation (`kitArmourClass`).
 *
 * Model: docs/monsters/MODEL.md, "The Kit axis". Rulings:
 * docs/importer/DECISIONS.md, 2026-11-04.
 */
import { MODULE_ID } from "./constants.mjs";
import { damageTotal, hdOf, ratingText, STANDARD_ROLE } from "./leader-roles.mjs";
import { KIT_AXIS, OWN_KIT, UNARMOURED } from "../monsters/kits.mjs";

/** The troop keys, in the order the axis lists them, with their labels. */
const TROOP_LABELS = {
  lightInfantry: "Light Infantry",
  heavyInfantry: "Heavy Infantry",
  slingers: "Slingers",
  bowmen: "Bowmen",
  compositeBowmen: "Composite Bowmen",
  longbowmen: "Longbowmen",
  crossbowmen: "Crossbowmen",
  [UNARMOURED]: "Unarmoured",
};

/** Roles a kit dresses: every rank that fights, never a dependant. */
const DRESSED = new Set(["champion", "subChieftain", "chieftain", "shaman", "witchDoctor"]);

/** The rating a member's option carries, as the page prints it. */
const ratingOf = (option) => ratingText(hdOf(option.flags?.[MODULE_ID]?.extras?.hd));

/** The roles a variant has cells for, from the cells already built. */
function rolesOf(cells, key) {
  const roles = new Set();
  for (const c of cells) {
    const by = c.by ?? [];
    const parts = String(c.key ?? "").split("|");
    if (by[0] !== "variant" || by[1] !== "role" || parts[0] !== key) continue;
    if (DRESSED.has(parts[1])) roles.add(parts[1]);
  }
  return roles;
}

/**
 * Build the Kit axis and its cells: for each variant whose kind has troop
 * rows (and Hit Dice matching them) or a natural armour class, a cell per
 * troop type for the rank and file and one per leader rank it has, plus the
 * unarmoured option. Cells are keyed `variant|role|kit` where the template has
 * a Role axis, else `variant|kit`. The axis's default is the creature's own
 * stat block, so nothing changes unless a kit is picked. `kits` is
 * `importedKits()`. Pushes onto `axes` and `cells`; adds nothing where no
 * variant is dressed.
 */
export function kitPresets({ options, axes, cells, kits }) {
  if (!kits) return;
  const hasRole = axes.some((a) => a.key === "role");
  const found = new Set();
  const built = [];
  for (const option of options) {
    const kind = String(option.key ?? "").toLowerCase();
    const rating = ratingOf(option);
    const memberAc = Number(option.merge?.ac?.value);
    const roles = hasRole ? rolesOf(cells, option.key) : new Set();
    const keyOf = (role, troop) => (hasRole ? `${option.key}|${role}|${troop}` : `${option.key}|${troop}`);
    const by = hasRole ? ["variant", "role", KIT_AXIS] : ["variant", KIT_AXIS];
    const push = (role, troop, merge, kit) => {
      built.push({ by, key: keyOf(role, troop), merge, items: [], flags: { [MODULE_ID]: { extras: { kit } } } });
      found.add(troop);
    };
    const moveAndMorale = (move, morale) => ({
      ...(Number.isFinite(move) ? { movement: { base: move } } : {}),
      ...(Number.isFinite(morale) ? { details: { morale } } : {}),
    });
    for (const row of kits.troops ?? []) {
      if (row.kind !== kind || !TROOP_LABELS[row.troop]) continue;
      if (!rating || ratingText(hdOf(row.hd)) !== rating) continue;
      const kit = { troop: row.troop, label: TROOP_LABELS[row.troop], note: row.note, ac: row.ac, damage: row.damage, move: row.move, morale: row.morale, cite: kits.troopsCite ?? "" };
      push(STANDARD_ROLE, row.troop, { ac: { value: row.ac }, damage: damageTotal(row.damage), ...moveAndMorale(row.move, row.morale) }, { ...kit, role: STANDARD_ROLE });
      // A leader keeps its own damage total and takes the kit's move and
      // morale; its armour class has no page and is worked out at generation.
      for (const role of roles) push(role, row.troop, moveAndMorale(row.move, row.morale), { ...kit, role, memberAc: Number.isFinite(memberAc) ? memberAc : null, compute: true });
    }
    const natural = kits.byType?.[kind];
    if (natural) {
      // Unarmoured changes the armour class alone: the stat block's speed and
      // damage are the kind's own.
      const kit = { troop: UNARMOURED, label: TROOP_LABELS[UNARMOURED], note: "", naturalAc: natural.naturalAc, cite: kits.byTypeCite ?? "", memberAc: Number.isFinite(memberAc) ? memberAc : null, compute: true };
      for (const role of [STANDARD_ROLE, ...roles]) push(role, UNARMOURED, {}, { ...kit, role });
    }
  }
  if (!found.size) return;
  cells.push(...built);
  kitAxis(axes, found);
}

/** The Kit axis holding `found` troop types, the creature's own stat block first and the default; widened where the template already has one. */
function kitAxis(axes, found) {
  let axis = axes.find((a) => a.key === KIT_AXIS);
  if (!axis) {
    axis = { key: KIT_AXIS, label: "Kit", roll: "", default: OWN_KIT, derive: { from: "", max: null }, options: [{ key: OWN_KIT, label: "Stat block", nameLabel: "" }] };
    axes.push(axis);
  }
  const have = new Set(axis.options.map((o) => o.key));
  for (const key of Object.keys(TROOP_LABELS)) {
    if (found.has(key) && !have.has(key)) axis.options.push({ key, label: TROOP_LABELS[key], nameLabel: "" });
  }
  const order = [OWN_KIT, ...Object.keys(TROOP_LABELS)];
  axis.options.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return axis;
}

/**
 * Carry a Kit axis from `from` onto `to` where `to` has none or lacks an
 * option, so the cells of merged variants keep an axis to be chosen on.
 */
export function unionKitAxis(to, from) {
  const src = (from ?? []).find((a) => a.key === KIT_AXIS);
  if (!src) return;
  const keys = new Set((src.options ?? []).map((o) => o.key));
  kitAxis(to, keys);
}
