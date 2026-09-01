/**
 * Weapon/armor TABLE extraction → core inventory items (the clean-break pipeline).
 *
 * Unlike the gear cookbook (run-in `Name:` descriptions on RR pp. 144-154), the
 * Revised Rulebook prints weapons and armour as GRIDS (pp. 128+). There is no
 * per-item prose to stream — the value IS the row — so this reads the seat's
 * own page geometry and materializes each row into a `weapon` / `armor` item,
 * the same shape core's `acks-all-equipment` ships (used only as a target-shape
 * reference; every value here comes from the reader's book, never from core).
 *
 * IP posture (matches the rest of the importer): the register/recipe ships only
 * GEOMETRY — column x-anchors and cell patterns — never a damage die, an AC, an
 * encumbrance or a price. All of those materialize per-seat from the connected
 * PDF. A bookless seat gets nothing from this path (a grid has no prose of its
 * own), which is acceptable: this exists for tables core will stop shipping.
 *
 * Reuses the proven table primitives (rowsByY / joinRuns) rather than the
 * generic definition compiler, so it stays off the hot shared path other
 * content types churn.
 */
import { rowsByY, joinRuns } from "./table-extract.mjs";
import { MODULE_ID, DEFAULT_IMG } from "./constants.mjs";
import { bookText } from "./prose.mjs";

/* -------------------------------------------------------------------- */
/*  Recipes — GEOMETRY ONLY (no book values)                            */
/* -------------------------------------------------------------------- */

/**
 * The weapons grid (RR PDF p. 128). Column x-anchors read off the page; a run
 * binds to the nearest column within `tol`, windowed columns (`w`) join every
 * run in [x, x+w] for multi-run cells (the Special list, the split name).
 */
export const WEAPON_TABLE = Object.freeze({
  book: "rr",
  page: 128, // the reference edition; a seat's PDF is LOCATED by anchor, not this
  anchors: ["Weapons", "Arbalest"], // the section title AND the first row
  labelMaxX: 158, // the name band; the type column bleeds a little into it
  rowTol: 3,
  // The Size/Type column is CENTERED (long "Medium Melee" starts further left
  // than short "Missile"), so it is read as a wide window purely to detect
  // melee/missile/ammunition — never as a value. Damage is a tight point
  // column just right of it so the die never lands in the type window.
  // typeBand ends at 210 (not 218): a versatile die like "1d6/1d8" is wider and
  // starts further left (x~213) than a single die (x~225), so it would fall
  // inside an 218-wide type band and be lost. 210 keeps the type word ("Missile"
  // at x182) in the band while letting every damage die reach its column.
  typeBand: { x0: 158, x1: 210 },
  columns: [
    { key: "damage", x: 220, tol: 14 }, // "1d8" | "1d6/1d8" (x213–225)
    { key: "enc", x: 280, tol: 11 }, // "1" | "1/6"
    { key: "short", x: 316, tol: 13 },
    { key: "med", x: 353, tol: 13 },
    { key: "long", x: 389, tol: 13 },
    { key: "cost", x: 424, tol: 13 }, // "50gp"
    { key: "special", x: 468, w: 130 }, // "cleave 2, Handy, Slow"
  ],
});

/**
 * Canonical weapon names — the ROW LIST the recipe ships (names are locators,
 * like every gear entry; the IP-sensitive VALUES stay in the book). Order is
 * the printed table order. `re` matches the extracted label band even through
 * the small-caps first-letter drop the PDF text layer produces ("Two-Handed"
 * arrives as "wo-Handed"), so a clean name always attaches to the right row.
 */
export const WEAPON_NAMES = [
  { name: "Arbalest", re: /arbalest/i },
  { name: "Crossbow", re: /^c?rossbow/i }, // anchored: never the "Bows/crossbows" header
  { name: "Case, 20 Bolts", re: /bolts/i },
  { name: "Composite Bow", re: /composite/i },
  { name: "Long Bow", re: /long ?bow/i },
  { name: "Short Bow", re: /short ?bow/i },
  { name: "Quiver, 20 Arrows", re: /arrows/i },
  { name: "Silver Arrow", re: /silver arrow/i },
  { name: "Battle Axe", re: /battle ?axe/i },
  { name: "Great Axe", re: /great ?axe/i },
  { name: "Hand Axe", re: /hand ?axe/i },
  { name: "Club", re: /club/i },
  { name: "Flail", re: /flail/i },
  { name: "Mace", re: /mace/i },
  { name: "Morning Star", re: /morning/i },
  { name: "Warhammer", re: /warhammer/i },
  { name: "Knife", re: /knife/i },
  { name: "Dagger", re: /^dagger|[^r]dagger/i },
  { name: "Silver Dagger", re: /silver ?dagger/i },
  { name: "Short Sword", re: /short ?sword/i },
  { name: "Sword", re: /(^|[^-])sword ?(medium|melee)?$|^sword/i },
  { name: "Two-Handed Sword", re: /handed ?sword/i },
  { name: "Dart", re: /dart/i },
  { name: "Javelin", re: /javelin/i },
  { name: "Lance", re: /lance/i },
  { name: "Polearm", re: /polearm/i },
  { name: "Spear", re: /spear/i },
  { name: "Bola", re: /bola/i },
  { name: "Military Oil", re: /military ?oil/i },
  { name: "Cestus", re: /cestus/i },
  { name: "Net", re: /^n?et ?(medium|melee|missile|$)/i }, // small-caps drops the "n"
  { name: "Rock", re: /rock/i },
  { name: "Sap", re: /^sap|[^a-z]sap/i },
  { name: "Sling", re: /^sling|[^a-z]sling(?! ?stone)/i },
  { name: "Staff Sling", re: /staff ?sling/i },
  { name: "Sling Stones", re: /sling stone/i },
  { name: "Staff", re: /^staff ?(medium|melee)?$|^staff[^ ]/i },
  { name: "Whip", re: /whip/i },
];

/* -------------------------------------------------------------------- */
/*  Extraction                                                          */
/* -------------------------------------------------------------------- */

/** The rotated "EQUIPMENT" chapter side-tab bleeds single glyphs into the grid. */
const SIDE_TAB = /^(equipment|equ|ipme|nt|ip|m|ent|[eqiupment])$/i;

/** Drop side-tab glyphs and lone footnote marks that y-merge into a row. */
export function stripNoise(items) {
  return items.filter((it) => {
    const s = String(it.str ?? "").trim();
    if (!s) return false;
    if (/^[*†‡]+$/.test(s)) return false;
    if (s.length <= 4 && SIDE_TAB.test(s)) return false;
    return true;
  });
}

/**
 * Bind a y-row's runs to declared columns by nearest-x (windowed columns join).
 * @returns {Record<string,string>} raw cell text per column key
 */
export function bindRowCells(runs, columns) {
  const point = {};
  const windows = {};
  for (const run of runs) {
    let best = null;
    for (const col of columns) {
      if (col.w != null) {
        if (run.x >= col.x - 2 && run.x < col.x + col.w) best = { col, d: 0, win: true };
        continue;
      }
      const d = Math.abs(run.x - col.x);
      if (d <= (col.tol ?? 12) && (!best || d < best.d)) best = { col, d, win: false };
    }
    if (!best) continue;
    if (best.win) (windows[best.col.key] ??= []).push(run);
    else if (!point[best.col.key] || best.d < point[best.col.key].d) point[best.col.key] = { d: best.d, run };
  }
  const cells = {};
  for (const [key, { run }] of Object.entries(point)) cells[key] = String(run.str).trim();
  for (const [key, runs2] of Object.entries(windows)) {
    cells[key] = runs2.sort((a, b) => a.x - b.x).map((r) => r.str).join("").replace(/\s+/g, " ").trim();
  }
  return cells;
}

/**
 * Read every DATA row from the page: its label band (for matching), whether it
 * is melee/missile (from the centered type band), and its value cells. Category
 * sub-headers, the section title and the column-header row all fail the
 * "carries a die/cost/type" test and are dropped.
 * @returns {{label:string, melee:boolean, missile:boolean, ammunition:boolean, cells:object}[]}
 */
export function extractValueRows(items, recipe = WEAPON_TABLE) {
  const clean = stripNoise(items);
  const rows = rowsByY(clean, recipe.rowTol ?? 3);
  const out = [];
  for (const r of rows) {
    const label = joinRuns(r.items.filter((it) => it.x < recipe.labelMaxX)).replace(/\s+/g, " ").trim();
    if (!label) continue;
    const typeText = joinRuns(r.items.filter((it) => it.x >= recipe.typeBand.x0 && it.x < recipe.typeBand.x1));
    const cells = bindRowCells(r.items.filter((it) => it.x >= recipe.typeBand.x1), recipe.columns);
    // The Size/Type column is centered, so a short-named melee weapon's type
    // text ("Medium Melee") straddles into the name band. Read the signal from
    // the label AND the type band together — the canonical name comes from the
    // shipped list, so scanning the label here costs nothing.
    const typeSignal = `${label} ${typeText}`;
    const melee = /melee/i.test(typeSignal);
    const missile = /missile/i.test(typeSignal);
    const ammunition = /ammunition/i.test(typeSignal);
    // A real row carries a die, a PRICE, or a melee/missile type. The column
    // HEADER row ("type/damage/…/cost/Special") otherwise sneaks through because
    // its "cost" cell is a non-empty string — so require the cost to look like a
    // price (a digit or "gp"), not merely be present.
    const hasDie = /\dd\d/i.test(cells.damage ?? "");
    const hasPrice = /\d|gp/i.test(cells.cost ?? "");
    if (!hasDie && !hasPrice && !(melee || missile || ammunition)) continue;
    out.push({ label, melee, missile, ammunition, cells });
  }
  return out;
}

/**
 * Attach each canonical weapon name to the value row whose label band matches
 * its pattern. Names are shipped (locators); values come from the seat's page.
 *
 * The seat's own `label` rides along beside the canonical name: it is the only
 * place the reader's spelling of the row survives, and `ammoLoad` reads the
 * printed count out of it.
 * @returns {{name:string, label:string, melee:boolean, missile:boolean, ammunition:boolean, cells:object}[]}
 */
export function extractWeapons(items, recipe = WEAPON_TABLE, names = WEAPON_NAMES) {
  const valueRows = extractValueRows(items, recipe);
  const used = new Set();
  const out = [];
  for (const spec of names) {
    const i = valueRows.findIndex((r, idx) => !used.has(idx) && spec.re.test(r.label));
    if (i < 0) continue; // this weapon's row was not found on the seat's page
    used.add(i);
    const r = valueRows[i];
    out.push({ name: spec.name, label: r.label, melee: r.melee, missile: r.missile, ammunition: r.ammunition, cells: r.cells });
  }
  return out;
}

/** True when a page's items are the weapons-table page (both anchors present). */
export function isWeaponPage(items, recipe = WEAPON_TABLE) {
  const joined = items.map((i) => i.str).join(" ");
  return (recipe.anchors ?? []).every((a) => joined.includes(a));
}

/**
 * Locate the weapons page in a seat's PDF (by anchor, edition-independent) and
 * extract its rows. `readPage(n) → {items}` is injected (the runtime's
 * pageItems; a test's PDF reader) so this module carries no PDF dependency.
 * @returns {Promise<{name,label,melee,missile,ammunition,cells}[]>}
 */
export async function extractWeaponsFromDoc(doc, readPage, recipe = WEAPON_TABLE) {
  const guess = recipe.page ?? 1;
  const order = [];
  for (let d = 0; d <= 14; d++) {
    if (guess + d <= doc.numPages) order.push(guess + d);
    if (d && guess - d >= 1) order.push(guess - d);
  }
  const seen = new Set(order);
  for (let p = 1; p <= doc.numPages; p++) if (!seen.has(p)) order.push(p);
  for (const p of order) {
    const { items } = await readPage(doc, p);
    if (isWeaponPage(items, recipe)) return extractWeapons(items, recipe);
  }
  return [];
}

/* -------------------------------------------------------------------- */
/*  Binding — row → core-shaped `weapon` item                          */
/* -------------------------------------------------------------------- */

/** Encumbrance in stone → core weight6 (sixths of a stone). "1/6"→1, "1"→6. */
function encToWeight6(enc) {
  const s = String(enc ?? "").trim();
  if (!s || s === "-") return null;
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Math.round((Number(frac[1]) / Number(frac[2])) * 6);
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 6) : null;
}

/** "50gp" → 50; blank/"-" → null. */
function costGp(cost) {
  const m = String(cost ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** '180’' / "180'" → 180; "-"/blank → null. */
function rangeFt(v) {
  const m = String(v ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Split the "Special" cell into core-shaped tag objects. */
function qualityTags(special) {
  return String(special ?? "")
    .split(/,|;/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "-")
    .map((title) => ({ title, value: title }));
}

/**
 * Build a core `weapon` item from a materialized row. Missing cells simply stay
 * at core's defaults — a bookless or sparse row is still a valid item.
 * @param {{name,cells}} row
 * @param {string} id  cookbook id (def.weapon.<slug>)
 * @param {string} cite
 */
/**
 * Every damage MODE a weapon offers, structured — the thing the core
 * compendium could not express and split into separate items instead.
 *
 * Two axes of "multiple roll types" the book packs into one row:
 *   - VERSATILE damage: "1d6/1d8" is one grip die and a two-handed die. Core
 *     shipped these as "Battle Axe, 1H" + "Battle Axe, 2H"; here they are one
 *     weapon with two grips.
 *   - MELEE + MISSILE: a thrown weapon (Hand Axe, Javelin) rolls to hit in
 *     melee OR at range. Each is its own attack mode.
 * @returns {{key:string,label:string,damage:string,attack:'melee'|'missile',grip?:string}[]}
 */
export function damageModes(row) {
  const c = row.cells ?? {};
  const dice = String(c.damage ?? "").match(/\d*d\d+/gi) ?? [];
  const modes = [];
  const grips = dice.length > 1 ? ["one-handed", "two-handed"] : [null];
  // A weapon usable in melee AND at range offers each attack as its own mode.
  const attacks = [];
  if (row.melee) attacks.push("melee");
  if (row.missile) attacks.push("missile");
  if (!attacks.length) attacks.push("melee");
  for (const attack of attacks) {
    dice.forEach((die, i) => {
      // The two-handed die is a melee grip only; a thrown weapon is one-handed.
      if (attack === "missile" && grips[i] === "two-handed") return;
      const grip = attack === "missile" ? null : grips[i];
      modes.push({
        key: [attack, grip].filter(Boolean).join("-").replace(/\s/g, ""),
        label: [grip, attack].filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join(" "),
        damage: die,
        attack,
        ...(grip ? { grip } : {}),
      });
    });
    if (!dice.length) modes.push({ key: attack, label: attack[0].toUpperCase() + attack.slice(1), damage: null, attack });
  }
  return modes;
}

export function bindWeaponRow(row, id, cite) {
  const c = row.cells ?? {};
  const melee = !!row.melee;
  const missile = !!row.missile;
  const tags = qualityTags(c.special);
  if (melee) tags.unshift({ title: "Melee", value: "Melee" });
  if (missile) tags.unshift({ title: "Missile", value: "Missile" });
  const weight6 = encToWeight6(c.enc);
  const cost = costGp(c.cost);
  const modes = damageModes(row);
  const primary = modes.find((m) => m.damage) ?? null;
  const system = {
    description: bookText([], cite, { id }),
    tags,
    melee,
    missile,
    equipped: false,
  };
  // Core's single `damage` field holds the PRIMARY die (one-handed melee, or
  // the missile die), so the item stays rollable in the base system; the full
  // set of modes lives structurally in the module flag below.
  if (primary?.damage) system.damage = primary.damage;
  if (weight6 != null) system.weight6 = weight6;
  if (cost != null) system.cost = cost;
  const range = { short: rangeFt(c.short), medium: rangeFt(c.med), long: rangeFt(c.long) };
  if (range.short || range.medium || range.long) {
    system.range = { short: range.short ?? 0, medium: range.medium ?? 0, long: range.long ?? 0 };
  }
  return {
    name: row.name,
    type: "weapon",
    img: DEFAULT_IMG.WEAPON,
    system,
    // The capture the compendium lacked: all attack/damage modes on ONE item.
    flags: { [MODULE_ID]: { cookbook: { id, cite }, minted: true, weapon: { modes } } },
  };
}

/* -------------------------------------------------------------------- */
/*  Ammunition — the grid's own third type                              */
/* -------------------------------------------------------------------- */

/**
 * What a printed ammunition row holds, read off the seat's own label.
 *
 * The grid names an ammunition row for its load — the count and the thing
 * counted are both printed in the row's name — so neither has to be shipped:
 * the seat's extracted label is asked first and the canonical locator only
 * stands in for a label the page did not yield.
 *
 * @returns {{count:number, of:string}|null} null when the label names no count.
 */
export function ammoLoad(row) {
  for (const text of [row?.label, row?.name]) {
    // Seams are `\s*`, never `\s+`: real extraction welds words together.
    const m = /(\d+)\s*([A-Za-z][\w'’-]*(?:\s*[A-Za-z][\w'’-]*)?)\s*$/.exec(String(text ?? "").trim());
    if (m) return { count: Number(m[1]), of: m[2].replace(/\s+/g, " ").trim() };
  }
  return null;
}

/**
 * Build a core `item` from a row the grid types **Ammunition**.
 *
 * The grid prints three types, not two: beside Melee and Missile it files the
 * bolt case, the arrow quiver, the silver arrow and the sling stones as
 * Ammunition, with an em-dash where every weapon carries a die. A `weapon`
 * document cannot hold one of these. The type has no `quantity` field at all,
 * so the load can only ever live in the row's NAME where nothing can spend it;
 * and `damage` defaults to a die, so a case of bolts arrives as something to
 * swing. Ammunition is inventory, which is also the shape the rest of the
 * family already expects — `isAmmoItem` and `canBeSilvered` both read an
 * `item`.
 *
 * Two shapes, because the grid prints two:
 *
 *  - A **loaded device** — a case, a quiver — is the carrying device, and its
 *    load is recorded on the `ammo` flag rather than minted here. The catalogue
 *    holds one document per priced row, which is what lets a class template
 *    copy the row the way it copies every other piece of gear; the stack itself
 *    is materialized when the device reaches an actor and can be put inside it.
 *    It carries the printed encumbrance WHOLE, so what a bundle weighs does not
 *    drift as it is spent — RR counts a bundle as one item however full it is.
 *  - A **bare stack** — the silver arrow, the sling stones — has no device to
 *    carry that weight, so the printed encumbrance is divided across the units
 *    it was printed for and quantity multiplies it back. `weight6` is a plain
 *    NumberField, so the fraction survives.
 *
 * @param {{name,label,cells}} row
 * @param {string} id cookbook id (def.weapon.<slug>)
 * @param {string} cite
 * @param {{device?:boolean}} opts `device` when the printed name names a
 *   carrying device — the equipment root's question, asked by the caller.
 */
export function bindAmmoRow(row, id, cite, { device = false } = {}) {
  const c = row.cells ?? {};
  const load = ammoLoad(row);
  const count = load?.count ?? 1;
  const printed6 = encToWeight6(c.enc);
  const cost = costGp(c.cost);
  const system = {
    description: bookText([], cite, { id }),
    subtype: "item",
    quantity: { value: device ? 1 : count, max: 0 },
  };
  if (printed6 != null) system.weight6 = device || count <= 1 ? printed6 : printed6 / count;
  if (cost != null) system.cost = cost;
  return {
    name: row.name,
    type: "item",
    img: "icons/weapons/ammunition/arrows-fletching.webp",
    system,
    flags: {
      [MODULE_ID]: {
        cookbook: { id, cite },
        minted: true,
        // What the page called this row, and what it said the row holds. The
        // equipment root reads `ammo` to fill the device when it is granted.
        ammunition: true,
        ...(device && load ? { ammo: { load: load.count, of: load.of } } : {}),
      },
    },
  };
}
