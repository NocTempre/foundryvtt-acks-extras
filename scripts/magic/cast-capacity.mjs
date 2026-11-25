/**
 * Whether a caster has a spell left to cast: the class tradition that cast the
 * spell, a slot of the spell's level on it, and what the actor has spent.
 * FOUNDRY-FREE: the class's `casting` list, the pools (`classes/casting.mjs`
 * `poolState`) and core's counts are read by the caller and passed in.
 *
 * Three sources answer, in order. A vancian tradition's slot at the spell's
 * level, spent from the actor's own pool; a points tradition, shown and never
 * spent here; else core's own count, the level's `system.spells.<n>.max`
 * against the `cast` counts of the actor's spells at that level. With none of
 * them the capacity is unknown and no verdict is given. A spell on no list the
 * class casts from (`isOffList`) has no tradition and the unknown capacity;
 * `spellCapacity` is the one reading the cast and the Magic tab's row gate share.
 *
 * `spellStanding` answers the Magic tab's grouping from the same inputs: a
 * heading per tradition the class casts from, with its spells, or the sheet's
 * own slot grid by level where the class casts from none.
 */
import { foldKey, spellTraditions, traditionLabel } from "./spell-logic.mjs";
import { levelUnder } from "./spell-names.mjs";

/** The verdicts a capacity gives. */
export const CAPACITY = Object.freeze({ ok: "ok", none: "none", unknown: "unknown" });

/**
 * The tradition of a class that cast this spell, and the spell's level under
 * it. A tradition matches by its key or its label, folded, against the lists
 * the spell prints on (core's `class` string where it prints none).
 *
 * @param {object[]} casting  the class's `system.casting`
 * @param {object} spell  `{extras, lvl, class}`: the spell flag, core's level and core's class string
 * @returns {{tradition: object, spellLevel: number|null}|null}
 */
export function traditionFor(casting, { extras, lvl, class: systemClass } = {}) {
  const sources = new Set(spellTraditions(extras, systemClass));
  for (const tradition of casting ?? []) {
    const keys = new Set([foldKey(tradition?.key), foldKey(tradition?.label)].filter(Boolean));
    if (![...keys].some((k) => sources.has(k))) continue;
    return { tradition, spellLevel: levelUnder(extras, lvl, keys) };
  }
  return null;
}

/**
 * The traditions of a class that have a key: the lists it casts from. Where there
 * is at least one, the Magic tab groups by list (`spellStanding`'s `lists` mode)
 * and a hand-made spell's cast is gated by its list (`cast-gate.mjs`).
 * @param {object[]|null|undefined} casting  the class's `system.casting`
 * @returns {object[]}
 */
export const listTraditions = (casting) => (casting ?? []).filter((t) => t?.key);

/** The folded key and label sets of the class's traditions that have a key: the lists the class casts from. */
const castFrom = (casting) => (casting ?? []).filter((t) => t?.key).map((t) => new Set([foldKey(t.key), foldKey(t.label)].filter(Boolean)));

/**
 * Is this spell on no list the class casts from? True only where the class's
 * `casting` names at least one tradition, the spell names at least one
 * (`spellTraditions`, core's `class` string included) and none of them is one of
 * the class's. A character with no class bound, a class that casts from no list
 * and a spell that names no tradition are not off list: the module does not know
 * the answer there, so nothing is blocked. The Magic tab, the cast's reading and
 * `spellStanding` all take the answer from here.
 *
 * @param {object[]|null|undefined} casting  the class's `system.casting`
 * @param {object} spell  `{extras, class}`: the spell flag and core's class string
 * @returns {boolean}
 */
export function isOffList(casting, { extras, class: systemClass } = {}) {
  const lists = castFrom(casting);
  if (!lists.length) return false;
  const sources = spellTraditions(extras, systemClass);
  return sources.length > 0 && !sources.some((s) => lists.some((keys) => keys.has(s)));
}

/**
 * The capacity a spell is read at: its tradition, its level under it, whether
 * it is off list and what that tradition has left. One reading serves the cast
 * and the Magic tab, so a row's gate and the cast window's verdict agree. The
 * tradition is the first of the class's the spell stands on, or `prefer` (a
 * tradition key) where the spell stands on that one too. An off-list spell has
 * no tradition and an unknown capacity: it is no slot's to spend and core's grid
 * does not answer for it.
 *
 * @param {object} from
 * @param {object[]} [from.casting]  the class's `system.casting`
 * @param {object[]} [from.pools]  `poolState`'s answer
 * @param {Record<string, {max?: number}>|null} [from.coreSpells]  core's `system.spells`
 * @param {(level: number|null) => number} [from.castsAt]  the sum of `system.cast` over the actor's spells of a level
 * @param {{extras: object, lvl: *, class: string}} from.spell  the spell flag, core's level and core's class string
 * @param {string|null} [from.prefer]  the tradition key the cast goes through
 * @returns {{found: {tradition: object, spellLevel: number|null}|null, spellLevel: number|null, offList: boolean, capacity: ReturnType<typeof castCapacity>}}
 */
export function spellCapacity({ casting = [], pools = [], coreSpells = null, castsAt = () => 0, spell, prefer = null } = {}) {
  const { extras, lvl } = spell ?? {};
  const offList = isOffList(casting, spell);
  const named = prefer ? casting?.find((t) => t?.key === prefer) : null;
  // A named tradition is used where the spell stands on it; any other name is ignored.
  const found = offList ? null : ((named ? traditionFor([named], spell) : null) ?? traditionFor(casting, spell));
  const spellLevel = found?.spellLevel ?? levelUnder(extras, lvl, new Set());
  if (offList) return { found: null, spellLevel, offList, capacity: castCapacity({ spellLevel }) };
  const capacity = castCapacity({ pools, coreSpells, castsAtLevel: castsAt(spellLevel), tradition: found?.tradition?.key ?? null, spellLevel });
  return { found, spellLevel, offList, capacity };
}

/**
 * What the caster has left of the spell's level.
 *
 * @param {object} from
 * @param {Array<{key: string, kind: string, slots?: Array<{n: number, max: number, used: number}>, pool?: object}>} [from.pools]  `poolState`'s answer
 * @param {Record<string, {max?: number}>} [from.coreSpells]  core's `system.spells`
 * @param {number} [from.castsAtLevel]  the sum of `system.cast` over the actor's spells of this level
 * @param {string|null} [from.tradition]  the matched tradition's key
 * @param {number|null} [from.spellLevel]
 * @returns {{verdict: string, tradition: string|null, spellLevel: number|null, max: number|null, used: number|null,
 *   source: "tradition"|"pool"|"core"|null, slotKey: string|null}}
 */
export function castCapacity({ pools = [], coreSpells = null, castsAtLevel = 0, tradition = null, spellLevel = null } = {}) {
  const base = { tradition, spellLevel, max: null, used: null, source: null, slotKey: null };
  const entry = tradition ? pools.find((p) => p.key === tradition) : null;
  if (entry?.slots && Number.isFinite(spellLevel)) {
    const slot = entry.slots.find((s) => s.n === spellLevel);
    const max = slot?.max ?? 0;
    const used = slot?.used ?? 0;
    return { ...base, verdict: used < max ? CAPACITY.ok : CAPACITY.none, max, used, source: "tradition", slotKey: `s${spellLevel}` };
  }
  if (entry?.pool) return { ...base, verdict: CAPACITY.unknown, max: entry.pool.max, used: entry.pool.used, source: "pool", slotKey: "points" };
  const max = Number(coreSpells?.[spellLevel]?.max);
  if (Number.isFinite(spellLevel) && Number.isFinite(max) && max > 0) {
    const used = Math.max(0, Number(castsAtLevel) || 0);
    return { ...base, verdict: used < max ? CAPACITY.ok : CAPACITY.none, max, used, source: "core" };
  }
  return { ...base, verdict: CAPACITY.unknown };
}

/** Does this capacity spend from the tradition's own pool (a vancian slot)? */
export const spendsFromPool = (capacity) => capacity?.source === "tradition" && Boolean(capacity.tradition) && Boolean(capacity.slotKey);

const byName = (a, b) => String(a.name).localeCompare(String(b.name));
const levelOf = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);

/**
 * The lists a spell stands on: one `{source, label, level, fromClass}` per
 * distinct source its flag names, in the flag's order, each at its own level
 * (`levelUnder`); or, where the flag names none, core's `class` string at
 * core's level, marked `fromClass`. Empty where the spell names no tradition.
 */
function listsOf({ extras, lvl, class: systemClass }) {
  const out = [];
  for (const row of extras?.lists ?? []) {
    const source = foldKey(row?.source);
    if (!source || out.some((l) => l.source === source)) continue;
    out.push({ source, label: traditionLabel(String(row.source).trim()), level: levelUnder(extras, lvl, new Set([source])), fromClass: false });
  }
  if (out.length) return out;
  const own = foldKey(systemClass);
  return own ? [{ source: own, label: traditionLabel(String(systemClass).trim()), level: levelUnder(null, lvl, new Set()), fromClass: true }] : [];
}

/** `{level, spells}` buckets of `items`, by `level`, lowest level first, each bucket's spells by name. */
function bucketByLevel(items) {
  const buckets = new Map();
  for (const item of items) {
    if (!buckets.has(item.level)) buckets.set(item.level, []);
    buckets.get(item.level).push(item);
  }
  return [...buckets.keys()].sort((a, b) => a - b).map((level) => ({ level, spells: buckets.get(level).sort(byName) }));
}

/**
 * The Magic tab's groups. Where the class's `casting` names at least one
 * tradition the mode is `lists`: one group per tradition, in the class's
 * order, then `other`, the spells on none of them. Otherwise (no class bound,
 * or a class that casts from no list) the mode is `levels`: the sheet's own
 * grid by the level on the spell, with core's typed maximum.
 *
 * A spell stands on a tradition when a list it names matches the tradition's
 * key or label, folded (`foldKey`); where it names no list, core's `class`
 * string stands in. It is listed under every tradition it stands on, at that
 * list's own level; each appearance carries `own` (that list), `also` (the
 * spell's other lists) and `lists` (all of them), each `{source, label, level,
 * fromClass}`. A spell on no tradition of the class is in `other` at core's
 * level, `offList` true where it names some other tradition and false where it
 * names none.
 *
 * A group's `levels` are the levels its pool gives slots at together with the
 * levels its spells stand at; `slot` is `{used, max}` from the pool where it has a
 * slot at that level, else null. A points tradition's `pool` is `{used, max}` and a
 * ladder's text is `note`; neither has a slot per level.
 *
 * @param {object} from
 * @param {object[]} [from.casting]  the class's `system.casting`
 * @param {Array<{key: string, slots?: Array<{n: number, max: number, used: number}>, pool?: {max: number, used: number}, capacity?: string}>} [from.pools]  `poolState`'s answer
 * @param {Array<{ref: *, name: string, lvl: *, class: string, cast: number, extras: object}>} [from.spells]  `ref` is returned untouched; `extras` is the spell flag, `lvl` and `class` are core's
 * @param {Record<string, {max?: number}>} [from.coreSpells]  core's `system.spells` as stored
 * @returns {{mode: "levels"|"lists", levels: Array<{level: number, used: number, max: number, spells: object[]}>,
 *   groups: Array<{key: string, label: string, kind: string, pool: {used: number, max: number}|null, note: string,
 *   levels: Array<{level: number, slot: {used: number, max: number}|null, spells: object[]}>}>,
 *   other: Array<{level: number, spells: object[]}>}}
 */
export function spellStanding({ casting = [], pools = [], spells = [], coreSpells = null } = {}) {
  const traditions = listTraditions(casting);
  if (!traditions.length) {
    const levels = bucketByLevel(spells.map((s) => ({ ref: s.ref, name: s.name, level: levelOf(s.lvl), cast: Number(s.cast) || 0 }))).map(({ level, spells: rows }) => {
      const max = Number(coreSpells?.[level]?.max);
      return { level, used: rows.reduce((sum, r) => sum + r.cast, 0), max: Number.isFinite(max) ? max : 0, spells: rows };
    });
    return { mode: "levels", levels, groups: [], other: [] };
  }
  const read = spells.map((s) => ({ s, lists: listsOf(s) }));
  const groups = traditions.map((t) => {
    const keys = new Set([foldKey(t.key), foldKey(t.label)].filter(Boolean));
    const here = [];
    for (const { s, lists } of read) {
      const own = lists.find((l) => keys.has(l.source));
      if (!own) continue;
      here.push({ ref: s.ref, name: s.name, level: levelOf(own.level), lists, own, also: lists.filter((l) => l !== own), offList: false });
    }
    const entry = pools.find((p) => p.key === t.key);
    const slots = new Map((entry?.slots ?? []).map((x) => [x.n, { used: x.used, max: x.max }]));
    const buckets = new Map(bucketByLevel(here).map((b) => [b.level, b.spells]));
    const levels = [...new Set([...slots.keys(), ...buckets.keys()])].sort((a, b) => a - b).map((level) => ({ level, slot: slots.get(level) ?? null, spells: buckets.get(level) ?? [] }));
    return { key: t.key, label: t.label || t.key, kind: t.kind, pool: entry?.pool ? { used: entry.pool.used, max: entry.pool.max } : null, note: entry?.capacity ?? "", levels };
  });
  const castsFrom = new Set(traditions.flatMap((t) => [foldKey(t.key), foldKey(t.label)]).filter(Boolean));
  const rest = read
    .filter(({ lists }) => !lists.some((l) => castsFrom.has(l.source)))
    .map(({ s, lists }) => ({ ref: s.ref, name: s.name, level: levelOf(s.lvl), lists, own: null, also: [], offList: isOffList(traditions, s) }));
  return { mode: "lists", levels: [], groups, other: bucketByLevel(rest) };
}
