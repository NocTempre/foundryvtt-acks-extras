/**
 * The beastman organisation tables as the Judge's world holds them: the village
 * makeup, the leader grades, the special-troop roll bands and the tribal-trait
 * roll bands (MM pp. 54-55, 57), the figures the paragraphs under them print
 * (troop kinds, optional equipment, traits: MM pp. 55-57), and the split,
 * speech and sidebar figures (MM pp. 47, 54, 55), read from the `monsters`
 * registry document and nothing else. No row, breed or figure is stated here:
 * every row key is minted from the printed label at import, every column key
 * is a Variant key of the beastman family template, and a cell is what the
 * page prints. Pure and Foundry-free; a Judge's override of a table (the
 * Ruledata Browser) is what a read returns, and a table not imported answers
 * empty with no citation.
 */
import { citeOf, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";
import { mergePatch } from "../lib/template-logic.mjs";
import { leaderCell, roleKeyOf, splitWeaponModifier, STANDARD_ROLE } from "../importer/leader-roles.mjs";
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";
import { damageModOf, UNARMOURED } from "./kits.mjs";
import { CONDITIONS, CONDITION_IDS } from "../lib/conditions.mjs";
import { RANGE_BANDS } from "../lib/roll-gate-kinds.mjs";
import { namesakeAbility } from "../importer/stats-map.mjs";
import { MANEUVER_TABLES } from "../equipment/overlays/maneuvers.mjs";
import { ITEM_FLAGS } from "../equipment/constants.mjs";
import { shotStack } from "../equipment/ammo.mjs";
import { classifyWeapon } from "../equipment/profiles.mjs";
import { DEFAULT_IMG } from "../importer/constants.mjs";
import { gearRunItem } from "./gear-run.mjs";

/** The registry document the organisation tables are read from. */
export const ORGANISATION_DOC = "monsters";

/** The tables of `ORGANISATION_DOC` read here, by role. */
export const ORGANISATION_TABLES = Object.freeze({
  village: "beastmanVillage",
  leaders: "beastmanLeaders",
  troops: "beastmanSpecialTroops",
  traits: "beastmanTraits",
  troopRules: "beastmanTroopRules",
  traitRules: "beastmanTraitRules",
  equipment: "beastmanEquipment",
  organisation: "beastmanOrganisation",
});

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const whole = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** A village cell: the printed text, or null where the page prints none. */
const villageCell = (v) => text(v);

/**
 * A roll band, `{min, max}` of whole numbers with `min <= max`, or null: a
 * dash or blank on the page (a breed the row does not apply to) and a value
 * that is not a band alike.
 */
export function bandCell(v) {
  const min = whole(v?.min);
  const max = whole(v?.max);
  return min !== null && max !== null && min <= max ? { min, max } : null;
}

/**
 * A leader cell, `{ac, armour, hd, hp, die, dmg}`: the armour class and hit
 * points whole numbers, `armour` the printed armour words, `hd` the printed
 * rating, `die` the printed damage die, `dmg` the printed modifier a weapon
 * adds (null where none is printed, never 0). Null where the armour class,
 * rating or hit points are not read.
 */
export function gradeCell(v) {
  const ac = whole(v?.ac);
  const hp = whole(v?.hp);
  const hd = text(v?.hd);
  if (ac === null || hp === null || hd === null) return null;
  return { ac, armour: text(v.armour), hd, hp, die: text(v.die), dmg: whole(v.dmg) };
}

/**
 * The rows of one table in the order stored: each a `{key, label, cells}`
 * where `cells` holds every breed column key the row carries, its cell read by
 * `read` and null where unread. A missing-row placeholder and a row with no
 * printed label are skipped.
 */
function rowsOf(table, read) {
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  const rows = [];
  for (const [key, row] of Object.entries(table)) {
    if (!row || typeof row !== "object" || isMissingRow(row)) continue;
    const label = text(row.label);
    if (!label) continue;
    const cells = {};
    for (const [breed, cell] of Object.entries(row)) if (breed !== "label") cells[breed] = read(cell);
    rows.push({ key, label, cells });
  }
  return rows;
}

/**
 * A figure the paragraphs' tables hold, as a plain value: a finite number,
 * non-empty text, a boolean, or a list or map of those; anything else (and a
 * null or empty one) is dropped, so a row holds only what was read.
 */
function plain(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return text(v) ?? undefined;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    const list = v.map(plain).filter((x) => x !== undefined);
    return list.length ? list : undefined;
  }
  if (v && typeof v === "object") {
    const map = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]).filter(([, x]) => x !== undefined));
    return Object.keys(map).length ? map : undefined;
  }
  return undefined;
}

/**
 * The rows of a paragraph table in the order stored, each `{key, label,
 * figures}`: `figures` is every figure the row holds beside its label, as
 * `plain` reads it, so a figure the page did not print is absent and a row
 * whose paragraph was not read holds none. A missing-row placeholder and a row
 * with no printed label are skipped.
 */
function figureRows(table) {
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  const rows = [];
  for (const [key, row] of Object.entries(table)) {
    if (!row || typeof row !== "object" || isMissingRow(row)) continue;
    const label = text(row.label);
    if (!label) continue;
    const { label: _label, ...rest } = row;
    rows.push({ key, label, figures: plain(rest) ?? {} });
  }
  return rows;
}

/**
 * The organisation figures as one flat map. The import stores them in one block
 * per page it reads; a Judge's override may store them flat or in blocks, and
 * both read alike (a figure name is unique across the blocks).
 */
function flatFigures(table) {
  const out = {};
  if (!table || typeof table !== "object" || Array.isArray(table)) return out;
  for (const [key, value] of Object.entries(table)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) if (plain(v) !== undefined) out[k] = plain(v);
    } else if (plain(value) !== undefined) out[key] = plain(value);
  }
  return out;
}

/**
 * The organisation tables as `{village, leaders, troops, traits, troopRules,
 * traitRules, equipment, organisation}`, each `{rows, cite}` but the last.
 * `rows` of the four grids is `{key, label, cells}` in print order; `cells`
 * maps a breed key to the cell (village: the printed text; leaders:
 * `gradeCell`; troops and traits: `bandCell`), null where the page prints
 * none. `troopRules`, `traitRules` and `equipment` are `{key, label, figures}`
 * rows under the same keys as the grids' (equipment under its own): the
 * figures each paragraph prints, absent where it prints none (field names:
 * docs/monsters/MODEL.md). `organisation` is `{figures, cite}`, the flat map of
 * the split, speech and sidebar figures. `cite` is the page the rows were read
 * from, null for an empty table and for a Judge's override.
 */
export function importedOrganisation() {
  const doc = hasDoc(ORGANISATION_DOC) ? getDoc(ORGANISATION_DOC) : null;
  const read = (id, cell) => {
    const rows = rowsOf(doc?.tables?.[ORGANISATION_TABLES[id]], cell);
    return { rows, cite: rows.length ? citeOf(ORGANISATION_DOC, ORGANISATION_TABLES[id]) : null };
  };
  const readFigures = (id) => {
    const rows = figureRows(doc?.tables?.[ORGANISATION_TABLES[id]]);
    return { rows, cite: rows.length ? citeOf(ORGANISATION_DOC, ORGANISATION_TABLES[id]) : null };
  };
  const figures = flatFigures(doc?.tables?.[ORGANISATION_TABLES.organisation]);
  return {
    village: read("village", villageCell),
    leaders: read("leaders", gradeCell),
    troops: read("troops", bandCell),
    traits: read("traits", bandCell),
    troopRules: readFigures("troopRules"),
    traitRules: readFigures("traitRules"),
    equipment: readFigures("equipment"),
    organisation: { figures, cite: Object.keys(figures).length ? citeOf(ORGANISATION_DOC, ORGANISATION_TABLES.organisation) : null },
  };
}

/** The special-troop axis's key. */
export const TROOP_AXIS = "troop";
/** The tribal-trait axis's key. */
export const TRAIT_AXIS = "trait";
/** The optional-equipment axis's key (a multi axis). */
export const GEAR_AXIS = "gear";
/** The three organisation axes, in the order a template lists them (the Kit axis sits between the first two). */
export const ORGANISATION_AXES = Object.freeze([TROOP_AXIS, TRAIT_AXIS, GEAR_AXIS]);
/** The troop axis's default: no special troop. */
export const NO_TROOP = "none";
/** The trait axis's default: no trait. */
export const NO_TRAIT = "none";
/** The leader-figures option that reads the leader table (`beastmanLeaders`). */
export const GRADE_SOURCE = "table";

/** The roles that stand in a gang, warband or village as fighters: a troop role and a trait's armour reach these and no caster or dependant. */
const FIGHTING_ROLES = new Set([STANDARD_ROLE, "champion", "subChieftain", "chieftain"]);
/** The roles a trait's rank grant (its proficiency ranks) reaches. */
const GRANT_ROLES = new Set(["chieftain"]);
/** The core morale field's bounds. */
const MORALE_RANGE = [-6, 4];

const figure = (v) => (v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
const addTo = (n, d) => (figure(n) ?? 0) + d;

/** The fold of a printed name for matching: letters and digits, lowercased. */
export const foldName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** English inflectional endings a printed word and a library name may differ by. */
const INFLECTIONS = new Set(["s", "es", "ed", "er", "ers", "ing", "ings", "ion", "ions", "ation", "ment", "ance", "ence", "ist"]);
/** The shortest fold the inflection match accepts, so a short word cannot swallow an unrelated name. */
const MIN_STEM = 4;

/**
 * The one candidate (an object with a `name`) that a printed word names, or
 * null. An exact fold wins and the first such candidate answers. Failing that,
 * a candidate answers when its fold and the word's fold differ only by an
 * English inflection (one is the other plus an ending from a short fixed set)
 * and the shorter fold is at least four characters; the match holds only when
 * the candidates that qualify carry one folded name, so an ambiguous word
 * answers null rather than a guess.
 */
export function matchProficiency(word, candidates) {
  const target = foldName(word);
  if (!target) return null;
  const list = [...(candidates ?? [])].filter((c) => foldName(c?.name));
  const exact = list.find((c) => foldName(c.name) === target);
  if (exact) return exact;
  const inflected = list.filter((c) => {
    const name = foldName(c.name);
    const [short, long] = name.length < target.length ? [name, target] : [target, name];
    return short.length >= MIN_STEM && long.startsWith(short) && INFLECTIONS.has(long.slice(short.length));
  });
  return new Set(inflected.map((c) => foldName(c.name))).size === 1 ? inflected[0] : null;
}

/**
 * The names a catalogue condition answers to: its id, which folds to the printed
 * name of every id the system ships, and each `/`-separated part of the label
 * of a row the module keeps. Never the system's localized name: a printed word
 * is matched against English and the matcher runs with no lang loaded.
 */
const CONDITION_NAMES = Object.freeze(Object.fromEntries(CONDITION_IDS.map((id) => [
  id,
  [id, ...String(CONDITIONS[id].label ?? "").split("/")].map((name) => name.trim()).filter(Boolean).map((name) => ({ name })),
])));

/**
 * The id of the conditions-catalogue entry a printed word names, or null. A
 * word that is an id answers it; then an exact fold of an id or a label part,
 * the first entry in catalogue order; then the inflection fold of
 * `matchProficiency`, which answers only when exactly one entry qualifies (an
 * entry contributes several names and counts once). A word no entry answers, or
 * that two answer inflected, gets null: the caller writes nothing on a guess.
 */
export function matchCondition(word) {
  const raw = String(word ?? "").trim();
  if (Object.hasOwn(CONDITIONS, raw)) return raw;
  const target = foldName(raw);
  if (!target) return null;
  const exact = CONDITION_IDS.find((id) => CONDITION_NAMES[id].some((c) => foldName(c.name) === target));
  if (exact) return exact;
  const hits = CONDITION_IDS.filter((id) => matchProficiency(raw, CONDITION_NAMES[id]));
  return hits.length === 1 ? hits[0] : null;
}

/** The conditions a waiver key names, by the recipe's value key: the charge, and the movement at running speed (the catalogue's retreating, which carries its disorder). */
const WAIVED_BY_KEY = Object.freeze({ waivesCharge: "charging", waivesRun: "retreating" });

/** The ability item a row's gated figures ride on: named by the row's label, carrying its page and a cookbook id built from the kind and the row key, its specs on `extras.effects`. Null where there are no specs. */
export function organisationAbility(kind, row, specs) {
  if (!Array.isArray(specs) || !specs.length) return null;
  const item = namesakeAbility(row.label);
  const mine = item.flags[MODULE_ID];
  mine.cookbook = { id: `organisation.${kind}.${row.key}`, cite: row.cite ?? "" };
  mine.extras = { ...mine.extras, effects: specs };
  return item;
}

/** The manoeuvres an armour's damage rider reaches (the `MANEUVERS` keys of equipment). */
const RIDER_MANEUVERS = Object.freeze(["overrun", "wrestling"]);
/** Dice as the importer reads them: a die count and a face count. */
const DICE_TEXT = /^\d+d\d+$/;
/** The dice text a figure holds, or null where it is blank or no die. */
const diceFigure = (v) => (text(v) && DICE_TEXT.test(text(v)) ? text(v) : null);

/**
 * The `drink` flag of a consumable's gear row, or null where the row prints no
 * healing dice. A figure the row left blank, or that is no dice, is null in it;
 * a printed condition word that folds to no catalogue entry is null and goes to
 * `miss(figureKey, word)`. The swig dice are stored and no count is set.
 */
function drinkFlag(f, miss) {
  const healDice = diceFigure(f.healDice);
  if (!healDice) return null;
  const word = text(f.condition);
  const condition = word ? matchCondition(word) : null;
  if (word && !condition) miss("condition", word);
  return { healDice, saveKind: text(f.saveKind), condition, successHealDice: diceFigure(f.successHealDice), swigDice: diceFigure(f.swigs) };
}

/** The consumable item a gear row with healing dice writes: named by the row, its page on the cookbook id, the figures on the `drink` flag. */
function drinkItem(row, drink) {
  return {
    name: row.label,
    type: "item",
    img: DEFAULT_IMG.ITEM,
    system: { description: "", subtype: "item", quantity: 1, cost: 0, weight: 0, weight6: 0 },
    flags: { [MODULE_ID]: { cookbook: { id: `organisation.gear.${row.key}`, cite: row.cite ?? "" }, [ITEM_FLAGS.DRINK]: drink } },
  };
}

/** The `onHit` flag of an ammunition row, or null where the row prints no turn count and damage dice. */
function onHitFlag(row, f) {
  const formula = diceFigure(f.damage);
  if (!formula || !Number.isInteger(f.delayTurns) || f.delayTurns < 1) return null;
  return { saveKind: text(f.saveKind), saveMod: figure(f.saveMod), formula, delayTurns: f.delayTurns, source: row.label, cite: row.cite ?? "" };
}

/**
 * Flag the stack the first launcher of `items` shoots with `onHit` and declare
 * it nocked (the archer fires its shots), taking the declaration from any other
 * stack. The stack is the one `shotStack` names; nothing is written, and false
 * is answered, where no launcher has one.
 */
function flagLauncherStack(items, onHit) {
  const list = Array.isArray(items) ? items : [];
  for (const weapon of list) {
    if (weapon?.type !== "weapon") continue;
    const stack = shotStack({ items: list }, weapon, classifyWeapon(weapon));
    if (!stack) continue;
    for (const other of list) if (other !== stack && other?.flags?.[MODULE_ID]) delete other.flags[MODULE_ID][ITEM_FLAGS.NOCKED];
    stack.flags = { ...(stack.flags ?? {}), [MODULE_ID]: { ...(stack.flags?.[MODULE_ID] ?? {}), [ITEM_FLAGS.ON_HIT]: onHit, [ITEM_FLAGS.NOCKED]: true } };
    return true;
  }
  return false;
}

/**
 * What the chosen equipment rows write on a creature, by the row's figure keys
 * and its `figuresFrom`, never by its key (the key is minted from the printed
 * label). `gear` is `[{key, label, cite, figures}]`; a row that is not carried
 * by a fighting creature (`fights` false) writes nothing, and no row at all
 * writes nothing: a creature with no gear stays stat-only.
 *
 *   - `reductionPerDie` (a marking on the body): an ability item with a
 *     `damageReduction` row `{perDie, value, gate: weaponMundane}`;
 *   - `riderDice` (armour): an ability item with a `maneuverRider` row naming
 *     `RIDER_MANEUVERS`, read at the damage roll by equipment's `damageRows`;
 *   - `ac`: a standing armour class bump, summed into `ac` and its rows listed;
 *   - `figuresFrom` the hooked-weapon table: the module's hooked flag on each
 *     melee weapon item of `resolved.items` (mutated; missile weapons stay).
 *
 *   - `radius` (an item whose reach the carrier runs): one gear item minted by
 *     `gear-run.mjs` `gearRunItem`, its figures live registry references, in
 *     `reachItems`; a row whose condition word or printed qualifier does not
 *     resolve writes no item and is listed in `unresolved`;
 *   - `healDice` (a consumable to drink): one item named by the row, its page
 *     on `cookbook.cite` and its figures on the `drink` flag, the printed
 *     condition word stored as the catalogue id `matchCondition` folds it to
 *     (null, and listed in `unresolved`, where it folds to none). It carries no
 *     swig count;
 *   - `delayTurns` with damage dice (ammunition whose hit asks a save): the
 *     `onHit` flag, and the nocked declaration, on the creature's stack of the
 *     ammunition its launcher takes (`shotStack`, the stack the shot spends).
 *     A creature that holds no launcher and stack writes nothing: the row stays
 *     recorded on `extras.organisation.gear`.
 *
 * A figure the import left blank writes nothing. Returns `{abilities, ac,
 * armourRows, hooked, consumables, reachItems, onHit, unresolved}`: the ability items to
 * add, the summed bump (null where no row has one), the `{label, cite}` of each
 * row that gave it, the count of weapons flagged, the consumable items to add,
 * the reach items to add,
 * the count of ammunition stacks flagged, and the `{kind, key, figure, word}` of
 * each figure that did not resolve.
 */
export function gearPayloads(gear, resolved, { fights = true } = {}) {
  const out = { abilities: [], ac: null, armourRows: [], hooked: 0, consumables: [], reachItems: [], onHit: 0, unresolved: [] };
  if (!fights) return out;
  for (const row of Array.isArray(gear) ? gear : []) {
    const f = row.figures ?? {};
    const specs = [];
    const per = figure(f.reductionPerDie);
    if (per !== null && per > 0) specs.push({ type: "modifier", target: "damageReduction", perDie: true, value: per, gate: { kind: "weaponMundane" } });
    const dice = text(f.riderDice);
    if (dice && DICE_TEXT.test(dice)) specs.push({ type: "modifier", target: "maneuverRider", maneuvers: [...RIDER_MANEUVERS], dice });
    const item = organisationAbility("gear", row, specs);
    if (item) out.abilities.push(item);
    const bump = figure(f.ac);
    if (bump !== null && bump !== 0) {
      out.ac = (out.ac ?? 0) + bump;
      out.armourRows.push({ label: row.label, cite: row.cite ?? "" });
    }
    const drink = drinkFlag(f, (figureKey, word) => out.unresolved.push({ kind: "gear", key: row.key, figure: figureKey, word }));
    if (drink) out.consumables.push(drinkItem(row, drink));
    const reachItem = gearRunItem(row, { doc: ORGANISATION_DOC, table: ORGANISATION_TABLES.equipment, fold: matchCondition, miss: (figureKey, word) => out.unresolved.push({ kind: "gear", key: row.key, figure: figureKey, word }) });
    if (reachItem) out.reachItems.push(reachItem);
    const hit = onHitFlag(row, f);
    if (hit && flagLauncherStack(resolved?.items, hit)) out.onHit++;
    if (f.figuresFrom === MANEUVER_TABLES.hooked) {
      for (const w of Array.isArray(resolved?.items) ? resolved.items : []) {
        const melee = w?.system?.melee === true || (w?.system?.melee == null && !w?.system?.missile);
        if (w?.type !== "weapon" || !melee) continue;
        w.flags ??= {};
        w.flags[MODULE_ID] = { ...(w.flags[MODULE_ID] ?? {}), [ITEM_FLAGS.HOOKED]: true };
        out.hooked++;
      }
    }
  }
  return out;
}

/**
 * The effect specs one troop or trait row's figures give, built from the
 * recipe's VALUE keys only (never a row key), and the figures that could not be
 * written: `{specs, unresolved}`, each unresolved `{kind, key, figure, word}`.
 * A figure whose gate cannot be built (a condition word that folds to no entry,
 * a band outside `RANGE_BANDS`, a ratio that is no pair of numbers, a gate word
 * not imported) writes no spec and is listed. The gate keys a trait row carries
 * all gate its attack and damage figures together (`allOf` where there are two);
 * `outnumberedMorale` is a clause that prints no ratio and gates only its own
 * morale part.
 */
function organisationSpecs(kind, row, figures) {
  const specs = [];
  const unresolved = [];
  const miss = (figureKey, word = null) => unresolved.push({ kind, key: row.key, figure: figureKey, word });
  const f = figures ?? {};
  const condition = (figureKey) => {
    const id = matchCondition(f[figureKey]);
    if (!id) miss(figureKey, text(f[figureKey]));
    return id;
  };
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null);
  const waived = Object.keys(WAIVED_BY_KEY).filter((k) => text(f[k])).map((k) => WAIVED_BY_KEY[k]);
  if (waived.length) specs.push({ type: "modifier", target: "acWaiver", conditions: waived });

  if (kind === "troop") {
    if (num(f.opponentSurprise) !== null) specs.push({ type: "modifier", target: "surprise", appliesTo: "opponent", value: f.opponentSurprise });
    const wanted = [["vulnerableAttack", "attackThrow"], ["damageDiceTimes", "damageDice"]].filter(([k]) => num(f[k]) !== null);
    if (wanted.length) {
      const id = condition("targetCondition");
      const band = foldName(f.targetBand);
      const bandOk = RANGE_BANDS.includes(band);
      if (!bandOk) miss("targetBand", text(f.targetBand));
      if (id && bandOk) {
        const gate = { kind: "allOf", of: [{ kind: "targetCondition", condition: id }, { kind: "rangeBand", band: [...new Set(["melee", band])] }] };
        for (const [k, target] of wanted) specs.push({ type: "modifier", target, value: f[k], gate: structuredClone(gate) });
      }
    }
    return { specs, unresolved };
  }

  const gates = [];
  let sound = true;
  if (f.outnumber != null) {
    const [a, b] = Array.isArray(f.outnumber) ? f.outnumber : [];
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) gates.push({ kind: "outnumbering", ratio: a / b });
    else {
      sound = false;
      miss("outnumber");
    }
  }
  if (Number.isInteger(f.round) && f.round > 0) gates.push({ kind: "combatRound", round: f.round });
  if (f.targetCondition != null) {
    const id = condition("targetCondition");
    if (id) gates.push({ kind: "targetCondition", condition: id });
    else sound = false;
  }
  if (gates.length && sound) {
    const gate = gates.length === 1 ? gates[0] : { kind: "allOf", of: gates };
    for (const [k, target] of [["attack", "attackThrow"], ["damage", "damage"]]) {
      if (num(f[k]) !== null) specs.push({ type: "modifier", target, value: f[k], gate: structuredClone(gate) });
    }
  }
  if (num(f.outnumberedMorale) !== null) specs.push({ type: "modifier", target: "morale", value: f.outnumberedMorale, gate: { kind: "outnumbering", side: "against", strict: true } });
  return { specs, unresolved };
}

/** The extras block of a resolved payload, created where absent. */
function extrasOf(resolved) {
  const flags = (resolved.flags ??= {});
  const mine = (flags[MODULE_ID] ??= {});
  return (mine[FLAG_EXTRAS] ??= {});
}

/**
 * A leader generated from the leader table's grade (leader figures `table`),
 * applied to its resolved payload before the kit is (the kit reads the
 * leader's armour class and damage modifier): the cell marks variant and role
 * (`extras.organisation.grade`), and the figures are read here from the
 * world's table and written as a printed leader cell writes them
 * (`leaderCell`: armour class, hit points and rating, the damage modifier as a
 * total, the throw and saves moved from the member's own block).
 *
 * The table's die states the leader's damage with its arms, the grade's
 * modifier already in it. Without a troop kit it becomes the formula of each
 * by-weapon attack the payload carries (the weapon item holding only the bare
 * marker), and that item's own damage bonus takes back the grade's modifier,
 * so core's addition of the actor's modifier nets to the die. The actor keeps
 * the modifier, so a kit, a trait and a natural attack read what they read
 * for a printed leader. A troop kit leaves the die recorded alone (the kit
 * states the leader's damage as a modifier over the troop row's); the
 * unarmoured kit is not a troop kit and keeps the die. A die that does not
 * read whole as dice writes nothing, and no item is added where none
 * qualifies. `variantOption` is the template's variant option for the chosen
 * variant, the member's block the leader is moved from. A grade the table
 * holds no cell for writes nothing. Returns the grade recorded, or null.
 */
export function applyGeneratedLeaderGrade(resolved, { variantOption, org = importedOrganisation(), ladder = null, ladderCite = null } = {}) {
  const extras = resolved?.flags?.[MODULE_ID]?.[FLAG_EXTRAS];
  const mark = extras?.organisation?.grade;
  if (!mark || !variantOption) return null;
  const row = org.leaders.rows.find((r) => roleKeyOf(r.label) === mark.role);
  const cell = row?.cells?.[mark.variant];
  if (!cell) return null;
  const modifier = cell.dmg ?? 0;
  const troopKit = !!extras.kit && extras.kit.troop !== UNARMOURED;
  const die = troopKit ? null : diceOf(cell.die);
  const built = leaderCell(variantOption, { ac: cell.ac, hd: cell.hd, hp: cell.hp, dmg: modifier }, {
    ladder,
    ladderCite,
    leader: { source: GRADE_SOURCE, cite: org.leaders.cite ?? "", ac: cell.ac, armour: cell.armour ?? "", die: "", row: row.label, damage: modifier },
  });
  mergePatch((resolved.system ??= {}), built.merge);
  mergePatch(extras, built.flags?.[MODULE_ID]?.extras ?? {});
  if (die && writeGradeDie(resolved.items, die, modifier)) extras.derived.leader.die = die;
  const grade = { ...mark, label: row.label, armour: cell.armour ?? "", die: cell.die ?? "", cite: org.leaders.cite ?? "" };
  extras.organisation = { ...extras.organisation, grade };
  return grade;
}

/** A printed damage cell as a formula, spaces stripped and minus signs plain, or null where it does not read whole as dice (a number alone, or dice with a modifier of their own, count). */
function diceOf(text) {
  const formula = String(text ?? "").replace(/\s+/g, "").replace(/[−–—]/g, "-");
  return /^(?:\d*d\d+(?:[+-]\d+)?|\d+)$/i.test(formula) ? formula : null;
}

/**
 * Write a grade's die onto the by-weapon attacks among `items`: each weapon
 * whose formula is the bare marker (no modifier of its own) takes `die` as its
 * formula, keeping its damage types and extraordinary mark, and its damage
 * bonus takes back `modifier`. Returns how many items were written.
 */
function writeGradeDie(items, die, modifier) {
  let written = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type !== "weapon") continue;
    const base = item.system?.damage?.base;
    if (!base || splitWeaponModifier(base.formula)?.mod !== 0) continue;
    base.formula = die;
    const bonus = item.system.bonus;
    const taken = (Number(bonus?.damage) || 0) - modifier;
    item.system.bonus = bonus && typeof bonus === "object" ? { ...bonus, damage: taken } : { attack: Number(bonus) || 0, damage: taken };
    written++;
  }
  return written;
}

/** The natural-attack items a trait's dice list gives: one weapon per listed die, named by `name(n)`; a text with no die in it gives none. */
export function naturalAttackItems(dice, name) {
  const items = [];
  for (const text of Array.isArray(dice) ? dice : []) {
    const formula = /^\s*(\d*d\d+(?:\s*[+-]\s*\d+)?|\d+)/i.exec(String(text))?.[1]?.replace(/\s+/g, "");
    if (!formula) continue;
    items.push({
      name: name(items.length + 1),
      type: "weapon",
      system: {
        description: "",
        damage: { base: { formula } },
        bonus: 0,
        melee: true,
        missile: false,
        equipped: true,
        pattern: "transparent",
        tags: [],
        counter: { value: 1, max: 1 },
        cost: 0,
        weight: 0,
        weight6: 0,
      },
    });
  }
  return items;
}

/**
 * A generated creature's special troop, tribal trait and optional equipment,
 * applied to its resolved payload before it is written (the template engine's
 * resolved hook, after the kit). Reads `importedOrganisation()` and the chosen
 * keys (`choices.troop`, `.trait`, `.gear`, and the role for who a figure
 * reaches).
 *
 * WRITES the standing figures only: a troop's attack bonus (`attack.mod`),
 * armour reduction and armour bump (`ac.value`), initiative (`initiative.mod`),
 * avoid-surprise bonus and proficiency grant; a trait's damage and morale
 * where the row has no gate, its armour bump and, for a chieftain, its
 * proficiency ranks; natural attacks where the template's cell marked them.
 * Each gated figure of a fighting creature's troop and trait rides on one
 * ability item named by the row (`organisationAbility`): its typed specs are
 * read at the roll, the surprise matrix, the morale page and the Armor Class
 * waiver (`organisationSpecs`), and a word that does not fold, a band outside
 * `RANGE_BANDS` or a ratio that is no pair writes no spec and is listed on
 * `extras.organisation.unresolved` and passed to `warn`. A standing figure and a
 * gated spec never share a figure. The chosen equipment rows write what
 * `gearPayloads` returns for a fighting creature: ability items, an armour
 * class bump (the `gear` part) and the hooked flag on its melee weapons.
 * Everything else ranged, activated or generated (the rest of a row's figures)
 * is RECORDED on `extras.organisation` as the row's figures and not applied. A figure not
 * imported writes nothing. The parts go to
 * `extras.derived.organisation` for the sheet's tooltips. A noncombatant, and a
 * caster or dependant role, takes no troop figure and no armour bump.
 * `findProficiency(word)` returns an item payload or null (a miss writes none
 * and is reported to `warn`); `noteLine({kind, label, cite})` is the prose line
 * added to both channels; `loc(key, data)` names a natural attack.
 * Returns the derivation written, or null.
 */
export function applyGeneratedOrganisation(resolved, { choices = {}, org = importedOrganisation(), findProficiency = null, noteLine = () => "", warn = () => {}, loc = (k) => k } = {}) {
  const troopKey = choices.troop && choices.troop !== NO_TROOP ? choices.troop : null;
  const traitKey = choices.trait && choices.trait !== NO_TRAIT ? choices.trait : null;
  const gearKeys = Array.isArray(choices.gear) ? choices.gear : choices.gear ? [choices.gear] : [];
  const marks = resolved?.flags?.[MODULE_ID]?.[FLAG_EXTRAS]?.organisation;
  if (!troopKey && !traitKey && !gearKeys.length && !marks?.naturalAttacks) return null;
  const extras = extrasOf(resolved);
  const system = (resolved.system ??= {});
  const role = choices.role ?? STANDARD_ROLE;
  const fights = FIGHTING_ROLES.has(role) && !extras.noncombatant;
  const record = { ...(extras.organisation ?? {}) };
  const pick = (grid, rules, key, cite) => {
    const row = org[rules].rows.find((r) => r.key === key);
    const label = org[grid].rows.find((r) => r.key === key)?.label ?? row?.label ?? key;
    return { key, label, cite: cite ?? "", figures: row?.figures ?? {} };
  };
  const troop = troopKey ? pick("troops", "troopRules", troopKey, org.troopRules.cite ?? org.troops.cite) : null;
  const trait = traitKey ? pick("traits", "traitRules", traitKey, org.traitRules.cite ?? org.traits.cite) : null;
  const gear = gearKeys.map((key) => {
    const row = org.equipment.rows.find((r) => r.key === key);
    return { key, label: row?.label ?? key, cite: org.equipment.cite ?? "", figures: row?.figures ?? {} };
  });
  if (troop) record.troop = troop;
  if (trait) record.trait = trait;
  if (gear.length) record.gear = gear;

  // The standing figures, each as {base, troop, trait, value}: the troop's and the trait's own part.
  const t = fights && troop ? troop.figures : {};
  const r = trait ? trait.figures : {};
  const gated = r.outnumber != null || r.round != null || r.condition != null || r.saveKind != null || r.targetCondition != null || r.outnumberedMorale != null;
  const parts = {};

  const acBase = figure(system.ac?.value);
  const hasTroopAc = figure(t.armourBump) != null || figure(t.acReduction) != null;
  const troopAc = (figure(t.armourBump) ?? 0) - (figure(t.acReduction) ?? 0);
  const traitAc = fights ? figure(r.armourBump) : null;
  const built = gearPayloads(gear, resolved, { fights });
  if (acBase !== null && (hasTroopAc || traitAc !== null || built.ac !== null)) {
    const value = acBase + (hasTroopAc ? troopAc : 0) + (traitAc ?? 0) + (built.ac ?? 0);
    system.ac = { ...(system.ac ?? {}), value };
    parts.ac = { base: acBase, troop: hasTroopAc ? troopAc : null, trait: traitAc, ...(built.ac !== null ? { gear: built.ac } : {}), value };
  }
  if (figure(t.attack) !== null) {
    const mod = system.attack?.mod ?? {};
    const melee = addTo(mod.melee, figure(t.attack));
    system.attack = { ...(system.attack ?? {}), mod: { ...mod, melee, missile: addTo(mod.missile, figure(t.attack)) } };
    parts.attack = { base: figure(mod.melee) ?? 0, troop: figure(t.attack), trait: null, value: melee };
  }
  if (figure(t.initiative) !== null) {
    const base = figure(system.initiative?.mod) ?? 0;
    system.initiative = { ...(system.initiative ?? {}), mod: base + figure(t.initiative) };
    parts.initiative = { base, troop: figure(t.initiative), trait: null, value: base + figure(t.initiative) };
  }
  if (figure(t.avoidSurprise) !== null) {
    const base = figure(system.surprise?.avoidsurprise) ?? 0;
    system.surprise = { ...(system.surprise ?? {}), avoidsurprise: base + figure(t.avoidSurprise) };
    parts.avoidSurprise = { base, troop: figure(t.avoidSurprise), trait: null, value: base + figure(t.avoidSurprise) };
  }
  const moraleBase = figure(system.details?.morale);
  if (!gated && figure(r.morale) !== null && moraleBase !== null) {
    const value = Math.max(MORALE_RANGE[0], Math.min(MORALE_RANGE[1], moraleBase + figure(r.morale)));
    system.details = { ...(system.details ?? {}), morale: value };
    parts.morale = { base: moraleBase, troop: null, trait: figure(r.morale), value };
  }
  const mods = system.damage?.mod ?? {};
  // A modifier the kit left blank (null) stays blank; one never set is 0.
  const meleeBase = mods.melee === null ? null : damageModOf(mods.melee);
  const missileBase = mods.missile === null ? null : damageModOf(mods.missile);
  if (!gated && typeof r.damage === "number" && meleeBase !== null && missileBase !== null) {
    system.damage = { ...(system.damage ?? {}), mod: { ...mods, melee: meleeBase + r.damage, missile: missileBase + r.damage } };
    parts.damage = { base: meleeBase, troop: null, trait: r.damage, value: meleeBase + r.damage };
  }

  // Proficiency grants: the printed word matched to the world's proficiency names (`matchProficiency`).
  const grants = [];
  const grant = (word, ranks, kind) => {
    if (!word) return;
    const source = findProficiency?.(word) ?? null;
    if (!source) {
      warn(`${kind}: no proficiency answers to the printed word`);
      grants.push({ kind, word, ranks, found: false });
      return;
    }
    for (let i = 0; i < ranks; i++) {
      const copy = structuredClone(source);
      delete copy._id;
      (resolved.items ??= []).push(copy);
    }
    grants.push({ kind, word, ranks, found: true });
  };
  if (fights && troop) grant(t.proficiency, 1, "troop");
  if (trait && GRANT_ROLES.has(role)) grant(r.proficiency, figure(r.proficiencyRanks) ?? 1, "trait");
  if (grants.length) record.proficiencies = grants;

  // Natural attacks a cell marked: one weapon per die the trait's table lists for the breed.
  if (marks?.naturalAttacks && trait) {
    const dice = r.damage && typeof r.damage === "object" ? r.damage[marks.naturalAttacks.variant] : null;
    const made = naturalAttackItems(dice, (n) => loc("organisation.natural", { label: trait.label, n }));
    if (made.length) (resolved.items ??= []).push(...made);
    record.natural = { trait: trait.key, count: made.length };
  }

  // The gated figures ride on one ability item per row, for a fighting creature only; a row with no spec mints none.
  const unresolved = [];
  for (const [kind, row] of [["troop", fights ? troop : null], ["trait", fights ? trait : null]]) {
    if (!row) continue;
    const built = organisationSpecs(kind, row, row.figures);
    unresolved.push(...built.unresolved);
    const item = organisationAbility(kind, row, built.specs);
    if (item) (resolved.items ??= []).push(item);
  }
  if (built.abilities.length) (resolved.items ??= []).push(...built.abilities);
  if (built.consumables.length) (resolved.items ??= []).push(...built.consumables);
  if (built.reachItems.length) (resolved.items ??= []).push(...built.reachItems);
  unresolved.push(...built.unresolved);
  for (const u of unresolved) warn(`${u.kind}: no gated figure written, the printed ${u.figure} does not resolve`);
  if (unresolved.length) record.unresolved = unresolved;

  extras.organisation = record;
  const derived = {
    ...(troop ? { troop: { label: troop.label, cite: troop.cite } } : {}),
    ...(trait ? { trait: { label: trait.label, cite: trait.cite } } : {}),
    ...(parts.ac?.gear !== undefined ? { gear: built.armourRows } : {}),
    ...parts,
  };
  if (Object.keys(parts).length) extras.derived = { ...(extras.derived ?? {}), organisation: derived };

  // The prose: each piece named with its page.
  let lines = "";
  if (troop) lines += noteLine({ kind: "troop", label: troop.label, cite: troop.cite });
  if (trait) lines += noteLine({ kind: "trait", label: trait.label, cite: trait.cite });
  // A waived run is the catalogue's retreat, so an undeclared withdrawal and a bare run stay with the Judge: a line each, with the page.
  for (const row of [fights ? troop : null, fights ? trait : null]) {
    if (row && text(row.figures.waivesRun)) lines += noteLine({ kind: "withdrawal", label: row.label, cite: row.cite }) + noteLine({ kind: "run", label: row.label, cite: row.cite });
  }
  for (const g of gear) lines += noteLine({ kind: "gear", label: g.label, cite: g.cite });
  if (lines) {
    system.details = { ...(system.details ?? {}), biography: `${system.details?.biography ?? ""}${lines}` };
    extras.description = { ...(extras.description ?? {}), notes: `${extras.description?.notes ?? ""}${lines}` };
  }
  return Object.keys(parts).length ? derived : null;
}
