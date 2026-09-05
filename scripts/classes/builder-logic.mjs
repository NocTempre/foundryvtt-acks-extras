/**
 * The class-builder derivation engine — pure module (no Foundry imports; Node
 * tooling and tests import it directly). Advanced mode's arithmetic: build
 * values in, a plan of simple-mode class fields out.
 *
 * The engine is STRUCTURE only. Every number the Judges Journal's builder
 * chapter prints — category XP costs, per-value spell grids, trade-off
 * yields, racial ladders, the post-8th increments — reaches it through the
 * `acks.classBuilder` ruledata document (assembled per world by the importer
 * from the GM's own book, or hand-authored at OVERRIDE priority). A missing
 * table degrades to a named issue on the plan, never a throw and never a
 * shipped fallback value.
 *
 * Magic types are an OPEN, string-keyed set: `magicTypes` rows define arcane
 * and divine the same way they define ceremonial, gnostic, alchemy, eldritch,
 * fairie or a homebrew tradition. Nothing in code closes the list.
 */

/** Ruledata document id the builder reads (assembled at WORLD by an import). */
export const BUILDER_DOC_ID = "acks.classBuilder";

/**
 * Assembled tables the builder consumes (declared via lib `expectTables`).
 *
 * - `budget` — { basePoints, savesPrecedence: [magic-or-category keys…],
 *   smoothing: { level, nearest }, postEight: { crusaderThief, fighter,
 *   mage }, racialCaps: [{ points, maxLevel }], tradeInXp }
 * - `hd` — [{ value, die ("d6"), mortalWounds, cost }]
 * - `fighting` — [{ value, sub (""|"a"|"b"), label, cost, attackAs (chassis
 *   key), attack: { step, every }, damage: { step, every } | null, cleaves
 *   ("none"|"half"|"full"), styles, weapons, armor }]
 * - `thievery` — [{ value, skills, cost }]
 * - `magicTypes` — { <typeKey>: { label, kind (CASTING_KINDS), repertoire,
 *   savesAs (chassis key), progenitor (class key), values: [{ value, cost,
 *   fraction, slots?: [slotRow…], delayedSlots?: […] }] } } where a slotRow
 *   is { atLevel, s1..s6, casterLevel }
 * - `tradeoffs` — [{ key, label, powersGained, xpDelta }]
 *
 * An optional `attackThrows` grid ([{ level, values: {column: throw} }])
 * overrides the per-row attack resolution when a world imports one.
 */
export const BUILDER_TABLE_IDS = ["budget", "hd", "fighting", "thievery", "magicTypes", "tradeoffs"];

/** The four save/attack chassis a derived class may name. */
const CHASSIS = ["fighter", "crusader", "mage", "thief"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Round to the nearest `step` (the JJ smooths one printed threshold). */
export const roundToStep = (value, step) => (step > 0 ? Math.round(value / step) * step : value);

/**
 * The cumulative XP thresholds of levels 1..maxLevel from the class's base
 * cost (the XP its build values sum to for 2nd level).
 *
 * Structure per JJ "Experience Points per Level" + "Experience Point
 * Smoothing": 2nd level costs the base; each level through 8th doubles the
 * previous threshold, with the smoothing level's threshold rounded to the
 * printed nearest before doubling continues; each level past 8th adds the
 * flat increment of the class's saving-throw progression (plus any racial
 * increase).
 */
export function xpSchedule(base, maxLevel, { smoothing, postEightIncrement } = {}) {
  const out = [0];
  if (!isNum(base) || base < 0 || !isNum(maxLevel)) return out;
  let prev = 0;
  for (let level = 2; level <= maxLevel; level++) {
    let next;
    if (level === 2) next = base;
    else if (level <= 8) next = prev * 2;
    else next = prev + (isNum(postEightIncrement) ? postEightIncrement : 0);
    if (smoothing && level === smoothing.level) next = roundToStep(next, smoothing.nearest ?? 0);
    out.push(next);
    prev = next;
  }
  return out;
}

/** The row of a value-laddered table for `value` (+ fighting's a/b sub). */
export function valueRow(rows, value, sub = "") {
  if (!Array.isArray(rows)) return null;
  return (
    rows.find((r) => r.value === value && String(r.sub ?? "") === String(sub ?? "")) ??
    rows.find((r) => r.value === value) ??
    null
  );
}

/**
 * Total build points a builder state spends: HD value + fighting + thievery
 * + every magic value + the racial value. (JJ: a racial class's level cap is
 * read off this total.)
 */
export function pointsSpent(builder) {
  const b = builder ?? {};
  const magic = (b.magic ?? []).reduce((sum, m) => sum + (m.value || 0), 0);
  return (b.hdValue || 0) + (b.fighting?.value || 0) + (b.thievery?.value || 0) + magic + (b.race?.value || 0);
}

/** Ladder labels for the narrowed damage-bonus keys derive can emit. */
const DAMAGE_BONUS_LABELS = {
  meleeDamageBonus: "Melee Damage Bonus",
  missileDamageBonus: "Missile Damage Bonus",
  electedDamageBonus: "Damage Bonus (melee or missile)",
};

/**
 * The ladder key a builder state's damage bonus is written under, or null
 * where the trade-offs eliminate it. Bare `damageBonus` applies to both
 * attacks; `damage.eliminateOne` keeps one side — `fighting.damageBonus`
 * names it (`melee`/`missile`), and left blank the class hands the choice to
 * each character (`electedDamageBonus`); `damage.eliminateBoth` keeps none.
 *
 * @returns {"damageBonus"|"meleeDamageBonus"|"missileDamageBonus"|"electedDamageBonus"|null}
 */
export function damageBonusKey(builder) {
  const tradeoffs = builder?.tradeoffs ?? [];
  if (tradeoffs.includes("damage.eliminateBoth")) return null;
  if (!tradeoffs.includes("damage.eliminateOne")) return "damageBonus";
  const side = String(builder?.fighting?.damageBonus ?? "").trim().toLowerCase();
  if (side === "melee" || side === "missile") return `${side}DamageBonus`;
  return "electedDamageBonus";
}

/**
 * Custom-power accounting: how many power picks the trade-offs yield and what
 * the chosen powers spend against them. Choices never block — the summary
 * reports, the Judge decides.
 */
export function powerSummary(builder, tables) {
  const chosen = builder?.powers ?? [];
  const spent = chosen.reduce((sum, p) => sum + (isNum(p.cost) ? p.cost : 1), 0);
  let gained = 0;
  const tradeoffRows = tables?.tradeoffs ?? [];
  for (const key of builder?.tradeoffs ?? []) {
    const row = tradeoffRows.find((r) => r.key === key);
    if (row) gained += row.powersGained || 0;
  }
  return { gained, spent, left: gained - spent };
}

/**
 * The racial rung a builder state stands on, with the race's magic stacking:
 * `{ rung, stacksWith, stackValue }`. An elf's racial points add to the
 * arcane value (JJ: "stack with points allocated to the Arcane Value").
 */
export function racialStacking(builder, race) {
  const value = builder?.race?.value ?? 0;
  const rung = value > 0 ? valueRow(race?.values, value) : null;
  const stacksWith = race?.stacksWith || "";
  return { rung, stacksWith, stackValue: stacksWith && rung ? value : 0 };
}

/** A magic entry's effective value once racial stacking is applied. */
export const effectiveMagicValue = (entry, stacking) =>
  (entry.value || 0) + (stacking.stacksWith === entry.type ? stacking.stackValue : 0);

/**
 * The XP a builder state's choices sum to for 2nd level: category costs,
 * magic values, the race document's rung cost, trade-off XP deltas, a
 * stacking race's discount, and the sheet's manual adjustment. Missing table
 * rows surface as issues.
 */
export function baseXpCost(builder, tables, race, issues = []) {
  let total = 0;
  const add = (cost, issueKey, data = {}) => {
    if (isNum(cost)) total += cost;
    else issues.push({ key: issueKey, ...data });
  };

  add(valueRow(tables?.hd, builder?.hdValue ?? 0)?.cost, "missingHdRow");
  add(valueRow(tables?.fighting, builder?.fighting?.value ?? 0, builder?.fighting?.sub)?.cost, "missingFightingRow");
  add(valueRow(tables?.thievery, builder?.thievery?.value ?? 0)?.cost, "missingThieveryRow");

  const stacking = racialStacking(builder, race);
  for (const m of builder?.magic ?? []) {
    if (!(m.value > 0)) continue;
    const type = tables?.magicTypes?.[m.type];
    if (!type) {
      issues.push({ key: "unknownMagicType", type: m.type });
      continue;
    }
    const row = valueRow(type.values, m.value ?? 0);
    if (row) add(row.cost, "missingMagicRow");
    else issues.push({ key: "missingMagicRow", type: m.type, value: m.value });
    // A stacking race discounts the magic category it stacks with (the elf's
    // printed reduction on the Arcane cost).
    if (stacking.stacksWith === m.type && isNum(race?.stackXpDiscount)) total -= race.stackXpDiscount;
  }

  if ((builder?.race?.value ?? 0) > 0) {
    if (stacking.rung) add(stacking.rung.xpCost, "missingRaceRow");
    else issues.push({ key: "missingRaceRow", value: builder.race.value });
  }

  const tradeoffRows = tables?.tradeoffs ?? [];
  for (const key of builder?.tradeoffs ?? []) {
    const row = tradeoffRows.find((r) => r.key === key);
    // A priced trade-off (weapon narrowing) charges only from the fighting
    // value the book names — a 1a/1b class narrows for free.
    if (row && isNum(row.xpDelta) && (builder?.fighting?.value ?? 0) >= (row.xpDeltaMinFighting ?? 0)) total += row.xpDelta;
  }

  if (isNum(builder?.xpAdjustment)) total += builder.xpAdjustment;
  return total;
}

/**
 * Compress a per-level series into [min,max] bands (the shape the class
 * document's attack table stores).
 */
export function bandify(series) {
  const bands = [];
  for (const { level, value } of series) {
    if (value == null) continue;
    const last = bands.at(-1);
    if (last && last.throw === value && last.maxLevel === level - 1) last.maxLevel = level;
    else bands.push({ minLevel: level, maxLevel: level, throw: value });
  }
  return bands;
}

/**
 * Attack bands for a fighting row, in resolution order: an imported
 * attack-throw grid; the chassis class the row names (its printed table is
 * already in the world); the row's own progression parameters, based off the
 * fighter chassis's first printed throw.
 *
 * @param {Map<string, Array>} chassisAttack - chassis key → printed attack
 *   bands ({minLevel,maxLevel,throw}), resolved by the caller
 */
export function attackBands(fightRow, tables, maxLevel, chassisAttack = new Map(), issues = []) {
  const cap = maxLevel || 14;
  const grid = tables?.attackThrows;
  if (Array.isArray(grid) && grid.length) {
    const column = fightRow?.attackColumn ?? String(fightRow?.value ?? 0);
    const series = grid
      .filter((r) => r.level >= 1 && r.level <= cap)
      .map((r) => ({ level: r.level, value: r.values?.[column] ?? null }));
    if (!series.every((r) => r.value == null)) return bandify(series);
  }
  if (fightRow?.attackAs && chassisAttack.get(fightRow.attackAs)?.length) {
    return chassisAttack
      .get(fightRow.attackAs)
      .filter((b) => b.minLevel <= cap)
      .map((b) => ({ minLevel: b.minLevel, maxLevel: b.maxLevel == null || b.maxLevel > cap ? cap : b.maxLevel, throw: b.throw }));
  }
  const params = fightRow?.attack;
  if (params && isNum(params.step) && isNum(params.every) && params.every > 0) {
    const base = chassisAttack.get("fighter")?.[0]?.throw;
    if (!isNum(base)) {
      issues.push({ key: "missingAttackBase" });
      return [];
    }
    const series = [];
    for (let level = 1; level <= cap; level++) series.push({ level, value: base - params.step * Math.floor((level - 1) / params.every) });
    issues.push({ key: "attackFromParams" });
    return bandify(series);
  }
  if (fightRow) issues.push({ key: "missingAttackResolution" });
  return [];
}

/**
 * Which chassis the derived class saves as (JJ Saving Throw Progression):
 * the largest category value wins; ties resolve by the budget's printed
 * precedence order. The racial value NEVER counts here — the book is
 * explicit that saves ignore it even when it stacks with a category.
 */
export function savesChassis(builder, tables, race, issues = []) {
  const entries = [
    { key: "fighting", chassis: "fighter", value: builder?.fighting?.value || 0 },
    { key: "thievery", chassis: "thief", value: builder?.thievery?.value || 0 },
  ];
  for (const m of builder?.magic ?? []) {
    const type = tables?.magicTypes?.[m.type];
    entries.push({ key: m.type, chassis: type?.savesAs ?? "mage", value: m.value || 0 });
  }
  const precedence = tables?.budget?.savesPrecedence ?? [];
  const rank = (key) => {
    const at = precedence.indexOf(key);
    return at < 0 ? precedence.length : at;
  };
  entries.sort((a, b) => b.value - a.value || rank(a.key) - rank(b.key));
  const winner = entries[0];
  if (!winner || !CHASSIS.includes(winner.chassis)) {
    if (winner && winner.value > 0) issues.push({ key: "unknownSavesChassis", chassis: winner?.chassis });
    return "mage";
  }
  return winner.chassis;
}

/** Scale one vancian slot row by `fraction`, halves rounding up (JJ note). */
export const scaleSlots = (row, fraction) => {
  const out = { atLevel: row.atLevel };
  for (const key of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
    const v = row[key];
    out[key] = isNum(v) ? Math.round(v * fraction + 1e-9) : v == null ? null : v;
  }
  return out;
};

const slotRowsToTradition = (rows, cap) =>
  rows
    .filter((r) => r.atLevel >= 1 && r.atLevel <= cap)
    .map((r) => ({ atLevel: r.atLevel, s1: r.s1 ?? null, s2: r.s2 ?? null, s3: r.s3 ?? null, s4: r.s4 ?? null, s5: r.s5 ?? null, s6: r.s6 ?? null }));

/** The caster-level ladder a printed grid carries, when it lags class level. */
const casterLadder = (rows, cap) => {
  const rungs = rows
    .filter((r) => r.atLevel >= 1 && r.atLevel <= cap && isNum(r.casterLevel))
    .map((r) => ({ atLevel: r.atLevel, value: r.casterLevel, text: "" }));
  const lags = rungs.some((r) => r.value !== r.atLevel);
  return lags ? rungs : null;
};

/**
 * Derive one casting tradition from a magic value. Resolution order for the
 * grid: the value row's own printed slots (delayed variant when elected);
 * the type's 100% grid (or the progenitor class's), scaled by the value's
 * fraction, halves up.
 *
 * @returns {{tradition, ladder}|null} the tradition plus an optional
 *   casterLevel ladder to publish on the class
 */
export function deriveTradition(magicEntry, typeDef, progenitorCasting, maxLevel, issues = [], effectiveValue = null) {
  const value = effectiveValue ?? magicEntry?.value ?? 0;
  if (!(value > 0)) return null;
  const row = valueRow(typeDef?.values, value);
  const cap = maxLevel || 14;
  const tradition = {
    key: magicEntry.type,
    label: magicEntry.label || typeDef?.label || magicEntry.type,
    kind: typeDef?.kind || "vancian",
    repertoire: typeDef?.repertoire || "",
    spellList: [],
    slots: [],
    pool: [],
    casterLevel: "",
  };
  let ladder = null;

  const printed = magicEntry.delayed ? (row?.delayedSlots ?? null) : (row?.slots ?? null);
  if (magicEntry.delayed && !row?.delayedSlots) issues.push({ key: "missingDelayedGrid", type: magicEntry.type, value });
  if (Array.isArray(printed) && printed.length) {
    tradition.slots = slotRowsToTradition(printed, cap);
    const rungs = casterLadder(printed, cap);
    if (rungs) {
      tradition.casterLevel = `${magicEntry.type}CasterLevel`;
      ladder = { key: tradition.casterLevel, label: `${tradition.label} Caster Level`, values: rungs };
    }
    return { tradition, ladder };
  }

  const fraction = row?.fraction;
  if (!isNum(fraction) || fraction <= 0) {
    issues.push({ key: "missingMagicFraction", type: magicEntry.type, value });
    return null;
  }
  const baseline =
    typeDef?.values?.find((r) => r.fraction === 1 && Array.isArray(r.slots) && r.slots.length)?.slots ??
    (progenitorCasting?.slots?.length ? progenitorCasting.slots : null);
  const basePool = progenitorCasting?.pool ?? [];
  if (baseline) {
    tradition.slots = baseline.filter((r) => r.atLevel <= cap).map((r) => scaleSlots(r, fraction));
  } else if (basePool.length) {
    tradition.pool = basePool
      .filter((r) => r.atLevel <= cap)
      .map((r) => ({ atLevel: r.atLevel, value: isNum(r.value) ? Math.round(r.value * fraction + 1e-9) : r.value }));
  } else {
    issues.push({ key: "missingProgenitorGrid", type: magicEntry.type, progenitor: typeDef?.progenitor ?? "" });
  }
  return { tradition, ladder };
}

/** The cleave rate a fighting row names, as the document's LevelValue. */
export function cleavesValue(fightRow) {
  switch (fightRow?.cleaves) {
    case "full":
      return { kind: "perLevel", base: 0, per: 1, round: "down" };
    case "half":
      return { kind: "perLevel", base: 0, per: 0.5, round: "down" };
    case "none":
      return { kind: "flat", flat: 0 };
    default:
      return null;
  }
}

/** A racial class's level cap: the budget's printed points→cap table. */
export function racialMaxLevel(totalPoints, budget) {
  const caps = budget?.racialCaps;
  if (!Array.isArray(caps)) return null;
  const row = caps.find((r) => r.points === totalPoints);
  return row?.maxLevel ?? null;
}

/**
 * The whole derivation: builder state + assembled ruledata tables + the race
 * document's data + caller-resolved chassis grids → a PLAN.
 *
 * The plan is `{ update, summary, issues }`: `update` holds the simple-mode
 * field values derivation stands behind (paths relative to `system.`),
 * `summary` the accounting a sheet displays, and `issues` everything the
 * tables could not answer. Fields a missing table leaves unknown are ABSENT
 * from `update` — the write must skip them, never zero them.
 *
 * @param {object} args
 * @param {object} args.builder - the class document's `system.builder`
 * @param {object|null} args.tables - `getDoc(BUILDER_DOC_ID).tables`, or null
 * @param {object|null} args.race - the bound race document's system data
 * @param {Map<string,object>} [args.progenitors] - magic type key → the
 *   progenitor class's casting tradition object
 * @param {Map<string,Array>} [args.chassisAttack] - chassis key → printed
 *   attack bands
 * @param {object|null} [args.fighterLadders] - the fighter chassis's ladders
 *   (`damageBonus` is borrowed when the fighting row grants the bonus)
 * @param {Map<string,object>} [args.skillLadders] - thief-skill ref → the
 *   progenitor's ladder for it ({key,label,values})
 * @param {Array} [args.titles] - existing level rows whose titles survive
 */
export function derivePlan({
  builder,
  tables,
  race,
  progenitors = new Map(),
  chassisAttack = new Map(),
  fighterLadders = null,
  skillLadders = new Map(),
  titles = [],
}) {
  const issues = [];
  const update = {};
  if (!tables) {
    return {
      update,
      issues: [{ key: "missingTables" }],
      summary: { points: { spent: pointsSpent(builder), base: null }, powers: powerSummary(builder, null), baseXp: null, maxLevel: null },
    };
  }

  const budget = tables.budget ?? {};
  const spent = pointsSpent(builder);
  const racialValue = builder?.race?.value ?? 0;
  const basePoints = isNum(budget.basePoints) ? budget.basePoints : null;
  // A human class spends the base budget; a racial class may spend up to the
  // cap table's largest row. Overspend/underspend is reported, never blocked.
  if (basePoints != null && racialValue === 0 && spent !== basePoints) issues.push({ key: "pointsOff", spent, base: basePoints });

  // --- max level: the racial cap table by TOTAL points; human default 14 ---
  let maxLevel = 14;
  if (racialValue > 0) {
    const cap = racialMaxLevel(spent, budget);
    if (cap) maxLevel = cap;
    else if (!race) issues.push({ key: "missingRaceDoc" });
    else issues.push({ key: "missingRacialCap", points: spent });
  }
  update.maximumLevel = maxLevel;

  // --- hit die + mortal wounds ladder ---
  const hdRow = valueRow(tables.hd, builder?.hdValue ?? 0);
  const die = hdRow?.die ? String(hdRow.die).replace(/[()]/g, "") : "";
  if (die) update.hitDie = `1${die}`;
  const ladders = [];
  if (isNum(hdRow?.mortalWounds) && hdRow.mortalWounds !== 0) {
    ladders.push({ key: "mortalWounds", label: "Mortal Wounds Bonus", values: [{ atLevel: 1, value: hdRow.mortalWounds, text: "" }] });
  }

  // --- saves chassis first: the post-8 increment keys on it ---
  const chassis = savesChassis(builder, tables, race, issues);
  update.saveChassis = chassis;
  update.saves = [];

  // --- XP schedule ---
  const baseXp = baseXpCost(builder, tables, race, issues);
  let increment = null;
  const post = budget.postEight ?? {};
  if (chassis === "crusader" || chassis === "thief") increment = post.crusaderThief ?? null;
  else increment = post[chassis] ?? null;
  if (increment == null) issues.push({ key: "missingPostEight", chassis });
  // A race may increase the post-8 climb (dwarf by chassis, elf flat) —
  // only when the class actually spends a racial value.
  if (racialValue > 0) {
    for (const extra of race?.postEight ?? []) {
      const applies =
        !extra.chassis ||
        extra.chassis === chassis ||
        (extra.chassis === "crusaderThief" && (chassis === "crusader" || chassis === "thief"));
      if (applies && isNum(extra.delta) && increment != null) increment += extra.delta;
    }
  }
  // --- hit points per level past 9th ---
  // Past 9th the table stops adding dice and prints a flat instead, and the
  // rate keys on the SAVES chassis — paired differently from the post-8 XP
  // increment above (crusader+mage and fighter+thief, not crusader+thief /
  // fighter / mage), which is why the two read different keys of the budget.
  // A race may add to it, on the same "only when the class spends a racial
  // value" gate as its four siblings. A rate the world has not imported is a
  // named issue and a flat-less cell, never an invented number.
  const HP_GROUP = { crusader: "crusaderMage", mage: "crusaderMage", fighter: "fighterThief", thief: "fighterThief" };
  const hpRates = budget.hpAfterNine ?? {};
  let hpPerLevel = isNum(hpRates[HP_GROUP[chassis]]) ? hpRates[HP_GROUP[chassis]] : null;
  if (hpPerLevel == null && maxLevel > 9) issues.push({ key: "missingHpAfterNine", chassis });
  if (hpPerLevel != null && racialValue > 0 && isNum(race?.hpAfter9)) hpPerLevel += race.hpAfter9;

  const thresholds = xpSchedule(baseXp, maxLevel, { smoothing: budget.smoothing, postEightIncrement: increment ?? 0 });
  update.levels = thresholds.map((xp, i) => {
    const level = i + 1;
    // The printed cell carries the CUMULATIVE flat, not the per-level rate:
    // parseHd reads "9d6+2" as nine dice and two points, so each row past 9th
    // states the whole bonus earned up to it.
    const flat = hpPerLevel != null && level > 9 ? (level - 9) * hpPerLevel : 0;
    return {
      level,
      xp,
      title: titles.find((r) => r.level === level)?.title ?? "",
      hd: die ? `${Math.min(level, 9)}${die}${flat > 0 ? `+${flat}` : ""}` : "",
    };
  });

  // --- attack + cleaves + damage bonus ---
  const fightRow = valueRow(tables.fighting, builder?.fighting?.value ?? 0, builder?.fighting?.sub);
  if (!fightRow) issues.push({ key: "missingFightingRow" });
  const attack = attackBands(fightRow, tables, maxLevel, chassisAttack, issues);
  if (attack.length) {
    update.attack = attack;
    update.attackChassis = "";
  }
  const cleaves = cleavesValue(fightRow);
  if (cleaves) update.cleaves = cleaves;
  // The trade-off ticks say who the borrowed bonus applies to: none narrows
  // it (bare key, both attacks); eliminating one side leaves the other, named
  // by the builder's election where the Judge fixed it and ELECTED by each
  // character where the class leaves the choice to the player; eliminating
  // both removes the ladder outright.
  const dmgKey = damageBonusKey(builder);
  if (fightRow?.damage && dmgKey && fighterLadders?.damageBonus?.values?.length) {
    ladders.push({
      key: dmgKey,
      label: dmgKey === "damageBonus" ? fighterLadders.damageBonus.label || "Damage Bonus" : DAMAGE_BONUS_LABELS[dmgKey],
      values: fighterLadders.damageBonus.values.filter((r) => r.atLevel <= maxLevel),
    });
  } else if (fightRow?.damage && dmgKey) {
    issues.push({ key: "missingDamageLadder" });
  }

  // --- casting: one tradition per magic value above zero (after stacking) ---
  const stacking = racialStacking(builder, race);
  const casting = [];
  for (const m of builder?.magic ?? []) {
    const effective = effectiveMagicValue(m, stacking);
    if (!(effective > 0)) continue;
    const typeDef = tables.magicTypes?.[m.type];
    if (!typeDef) {
      issues.push({ key: "unknownMagicType", type: m.type });
      continue;
    }
    const derived = deriveTradition(m, typeDef, progenitors.get(m.type) ?? null, maxLevel, issues, effective);
    if (derived) {
      casting.push(derived.tradition);
      if (derived.ladder) ladders.push(derived.ladder);
    }
  }
  update.casting = casting;

  // --- thievery skills into the inventory, with the progenitor's ladders ---
  const thiefRow = valueRow(tables.thievery, builder?.thievery?.value ?? 0);
  const skillRefs = builder?.thievery?.skills ?? [];
  if (isNum(thiefRow?.skills) && skillRefs.length !== thiefRow.skills)
    issues.push({ key: "skillCountOff", chosen: skillRefs.length, expected: thiefRow.skills });
  if (skillRefs.length) {
    update["inventory.skills"] = skillRefs.map((ref) => {
      const ladder = skillLadders.get(ref);
      if (ladder?.values?.length) {
        ladders.push({ key: ladder.key, label: ladder.label ?? "", values: ladder.values.filter((r) => r.atLevel <= maxLevel) });
        return { ref, ladderKey: ladder.key };
      }
      return { ref, ladderKey: "" };
    });
  }

  if (ladders.length) update.ladders = ladders;

  // --- racial traits: every power the ladder grants up to the chosen value ---
  if (racialValue > 0 && race?.values) {
    const powers = [];
    for (const row of race.values) {
      if ((row.value ?? 0) > racialValue) continue;
      for (const ref of row.powers ?? []) if (!powers.includes(ref)) powers.push(ref);
    }
    if (powers.length) update.racialTraits = powers.map((ref) => ({ name: "", ref, html: "" }));
  }

  // --- attribute floors the race imposes ---
  if (racialValue > 0 && race?.minimumAttributes?.length) {
    update.requirements = race.minimumAttributes.map((r) => ({ attr: r.attr, min: r.min }));
  }

  return {
    update,
    issues,
    summary: {
      points: { spent, base: basePoints },
      powers: powerSummary(builder, tables),
      baseXp,
      maxLevel,
    },
  };
}
