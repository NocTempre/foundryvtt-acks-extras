/**
 * The research, ritual and sacrifice tables, read: one reader per imported
 * table, each turning the raw cells the importer stored (the `magicResearch`
 * document, RR ch. 8 and ch. 2; `importer/books/rr/table-recipes-research.mjs`) into
 * plain values. Pure: it imports the tables registry and nothing of Foundry,
 * and every reader takes its lookups as an argument, so a test or a consumer
 * supplies its own.
 *
 * Every figure here is read off the Judge's own copy. What ships is the
 * procedure for reading and applying them. A figure that is absent, or that
 * will not parse, is `null` and never a default: a reader of a table nothing
 * imported answers `{present: false}` with every figure null, and each helper
 * that derives from a figure answers null when any figure it needs is null. A
 * table's `cite` is the page it was read from; a table a Judge overrode has no
 * page, so it carries `byHand: true` and `cite: null`. An override replaces a
 * whole table, so `byHand` belongs to the table and not to a figure.
 *
 * `researchRateAt` reads the rate on the ladder and, for a project the page's
 * footnote names no reduction for, the lesser of that rate and the rate the
 * footnote gives other projects; the footnote's rate is its own table.
 */
import { PRIORITY, citeOf, getLayer, getTable } from "../lib/tables.mjs";

/** The registry document every table here is read from. */
export const RESEARCH_DOC_ID = "magicResearch";

/** The kinds of facility, each with the table its passage is read into. */
export const FACILITY_TABLES = Object.freeze({
  library: "libraryProse",
  workshop: "workshopProse",
  identify: "workshopProse",
  ritualLibrary: "ritualCostProse",
  ritualWorkshop: "ritualWorkshopProse",
});

/** Every table of the document by the name this module reads it under. */
export const RESEARCH_TABLE_IDS = Object.freeze({
  ladder: "researchLadder",
  ladderNote: "researchLadderNote",
  prose: "researchProse",
  assistants: "assistantProse",
  library: "libraryProse",
  sample: "sampleProse",
  workshop: "workshopProse",
  ritualCosts: "ritualCostProse",
  ritualWorkshop: "ritualWorkshopProse",
  sacrifice: "sacrificeTraits",
  divineLifetime: "divineLifetime",
  arcaneLifetime: "arcaneLifetime",
  powerOfSacrifice: "powerOfSacrifice",
});

/** The lookups every reader reads through by default: the tables registry, whole. */
const REGISTRY_LOOKUP = Object.freeze({
  table(docId, tableId) {
    try {
      return getTable(docId, tableId);
    } catch {
      return null;
    }
  },
  citeOf,
  isOverridden: (docId, tableId) => getLayer(docId, PRIORITY.OVERRIDE)?.tables?.[tableId] != null,
});

/** A table as `{raw, cite, byHand}`: the stored object, its page and whether a hand set it. Null raw when nothing is registered. */
function open(tableId, lookup = {}) {
  const via = { ...REGISTRY_LOOKUP, ...lookup };
  const raw = via.table(RESEARCH_DOC_ID, tableId) ?? null;
  const byHand = raw != null && via.isOverridden(RESEARCH_DOC_ID, tableId) === true;
  return { raw: raw && typeof raw === "object" ? raw : null, cite: byHand ? null : via.citeOf(RESEARCH_DOC_ID, tableId) ?? null, byHand };
}

/** The provenance every answer carries. */
const prov = ({ cite, byHand }) => ({ cite, byHand });

/** A cell's text with whitespace collapsed; "" for anything that is not text or a number. */
const text = (cell) => (typeof cell === "number" && Number.isFinite(cell) ? String(cell) : typeof cell === "string" ? cell.replace(/\s+/g, " ").trim() : "");

/** A stored whole or decimal number, or a numeric string with thousands separators, as a number; null otherwise. */
export function figure(cell) {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const m = text(cell).replace(/[−–—]/g, "-").match(/^[-+]?\d[\d,]*(?:\.\d+)?$/);
  return m ? Number(m[0].replace(/,/g, "")) : null;
}

/** A gold figure as a ladder cell prints it: a number, then "gp" and any footnote mark. Null for anything else. */
export function parseGp(cell) {
  const m = text(cell).match(/^(\d[\d,]*(?:\.\d+)?)\s*gp\b/i);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** A throw target as the ladder prints it: "N+" or "N". Null for anything else. */
export function parseThrow(cell) {
  const m = text(cell).match(/^(\d+)\s*\+?$/);
  return m ? Number(m[1]) : null;
}

/** A fraction written "a/b", as `{numerator, denominator, share}`, or null. */
export function parseFraction(cell) {
  const m = text(cell).match(/(\d+)\s*\/\s*(\d+)/);
  if (!m || Number(m[2]) === 0) return null;
  return { numerator: Number(m[1]), denominator: Number(m[2]), share: Number(m[1]) / Number(m[2]) };
}

/**
 * Pairs of a gold figure and the level it holds for, from a sentence's list
 * ("<gp> for <level> …; <gp> for <level> …"), where an ordinal's suffix may sit
 * in the text layer as a stray word beside either figure. The list ends at the first
 * label (a colon) and where a level fails to rise, so a window that runs on
 * into the next cost cannot add a rung. Null when the window holds none.
 *
 * @returns {{level: number, gp: number}[]|null}
 */
export function parseLevelCosts(cell) {
  const s = text(cell);
  if (!s) return null;
  const head = s.split(":")[0];
  const out = [];
  for (const m of head.matchAll(/(\d[\d,]*)\s*gp\s*(?:(?:st|nd|rd|th)\s+)*for\s*(?:(?:st|nd|rd|th)\s+)*(\d+)/gi)) {
    const entry = { level: Number(m[2]), gp: Number(m[1].replace(/,/g, "")) };
    if (out.length && entry.level <= out[out.length - 1].level) break;
    out.push(entry);
  }
  return out.length ? out : null;
}

/** A word count and a span word read together: `{count, unit}`, null where the unit is absent. */
function span(raw) {
  const unit = typeof raw?.unit === "string" && raw.unit.trim() ? raw.unit.trim() : null;
  return unit ? { count: figure(raw?.count), unit } : null;
}

/* ------------------------------ the ladder ------------------------------ */

/**
 * The research ladder: `{present, rungs: [{level, rate, throw}], otherProjectsRate, cite, byHand}`.
 * A rung whose level or rate will not parse is left out; `rungs` follow print order.
 * `otherProjectsRate` is the rate the footnote gives projects it names no
 * reduction for, null when it was not read.
 */
export function readLadder(lookup) {
  const t = open(RESEARCH_TABLE_IDS.ladder, lookup);
  const note = open(RESEARCH_TABLE_IDS.ladderNote, lookup);
  const rungs = Object.values(t.raw ?? {})
    .map((row) => ({ level: figure(row?.label), rate: parseGp(row?.rate), throw: parseThrow(row?.throw) }))
    .filter((r) => r.level !== null && r.rate !== null);
  return { present: t.raw != null, rungs, otherProjectsRate: figure(note.raw?.otherProjectsRate), ...prov(t) };
}

/**
 * A level's rung of the ladder, `{level, rate, throw, reduced, cite, byHand}`,
 * or null when the ladder holds no rung for the level. With `full: true` the
 * rate is the ladder's own. Otherwise it is the lesser of the ladder's rate and
 * the rate the footnote gives other projects (`reduced` says it was cut), and
 * the answer is null while that rate is unread: which rungs the footnote marks
 * is read off its figure, so with no figure there is nothing to read them by.
 */
export function researchRateAt(ladder, level, { full = false } = {}) {
  const rung = ladder?.rungs?.find((r) => r.level === level) ?? null;
  if (!rung) return null;
  const base = { level, throw: rung.throw, cite: ladder.cite, byHand: ladder.byHand };
  if (full) return { ...base, rate: rung.rate, reduced: false };
  if (ladder.otherProjectsRate == null) return null;
  const rate = Math.min(rung.rate, ladder.otherProjectsRate);
  return { ...base, rate, reduced: rate < rung.rate };
}

/* ---------------------- the research rules, in prose ---------------------- */

/**
 * The rate's ancillary share, the automatic-failure band and the substituted
 * components' penalty: `{present, ancillary, autoFail: {min, max}|null,
 * penalty, penaltyMinimum, cite, byHand}`. `ancillary` is `{numerator,
 * denominator, share}` or null.
 */
export function readResearchProse(lookup) {
  const t = open(RESEARCH_TABLE_IDS.prose, lookup);
  const band = Array.isArray(t.raw?.autoFailBand) ? t.raw.autoFailBand.map(figure) : [];
  return {
    present: t.raw != null,
    ancillary: parseFraction(t.raw?.ancillaryFraction),
    autoFail: band.length === 2 && band.every((n) => n !== null) ? { min: band[0], max: band[1] } : null,
    penalty: figure(t.raw?.penalty),
    penaltyMinimum: figure(t.raw?.penaltyMinimum),
    ...prov(t),
  };
}

/**
 * The penalty a throw takes for a share of substituted components: the
 * per-level penalty times the spell's level times the substituted share,
 * rounded away from zero (a larger penalty), and never less than
 * the minimum for any substitution at all. `share` is 0 to 1; zero substituted is no penalty. Null while a figure
 * it needs is unread. The result is a negative number, as the page prints it.
 */
export function substitutionPenalty(prose, { level, share }) {
  if (!prose || prose.penalty === null || prose.penaltyMinimum === null) return null;
  if (!Number.isFinite(level) || !Number.isFinite(share) || share < 0 || share > 1) return null;
  if (share === 0) return 0;
  const size = Math.ceil(Math.abs(prose.penalty) * level * share - 1e-9);
  return -Math.max(size, Math.abs(prose.penaltyMinimum));
}

/** The ancillary share of a research rate: the rate times the printed fraction, or null. */
export function ancillaryRate(prose, rate) {
  return prose?.ancillary && Number.isFinite(rate) ? rate * prose.ancillary.share : null;
}

/** An automatic failure on the unmodified die: true or false, null while the band is unread. */
export function isAutoFail(prose, die) {
  return prose?.autoFail && Number.isFinite(die) ? die >= prose.autoFail.min && die <= prose.autoFail.max : null;
}

/* ------------------------------ assistants ------------------------------ */

/**
 * Who may manage research assistants and the level each way of working needs:
 * `{present, managerLevel, managerBase, aidLevel, spellLevel, itemLevel, cite, byHand}`.
 */
export function readAssistants(lookup) {
  const t = open(RESEARCH_TABLE_IDS.assistants, lookup);
  const n = (key) => figure(t.raw?.[key]);
  return { present: t.raw != null, managerLevel: n("managerLevel"), managerBase: n("managerBase"), aidLevel: n("aidLevel"), spellLevel: n("spellLevel"), itemLevel: n("itemLevel"), ...prov(t) };
}

/**
 * How many assistants a researcher manages: nothing below the manager's level,
 * else the base count plus one for each point of the Intellect bonus. Null
 * while the level or the base is unread.
 */
export function assistantCapacity(assistants, { level, intBonus = 0 }) {
  if (!assistants || assistants.managerLevel === null || assistants.managerBase === null || !Number.isFinite(level)) return null;
  return level >= assistants.managerLevel ? assistants.managerBase + Math.max(0, Number(intBonus) || 0) : 0;
}

/** The level a way of working needs: `kind` is "aid", "spell" or "item". Null while unread. */
export function assistantMinimum(assistants, kind) {
  return assistants?.[{ aid: "aidLevel", spell: "spellLevel", item: "itemLevel" }[kind]] ?? null;
}

/* ------------------------------- facilities ------------------------------- */

/**
 * One kind of facility's passage (`FACILITY_TABLES`): `{kind, present, minimum,
 * step, minimums: [{level, gp}]|null, bonus: {step, size, cap}, share, cite,
 * byHand}`. A spell library or workshop prints `minimum` for the first level
 * and `step` for each level after it; a ritual facility prints `minimums` by
 * level; the identification kind prints neither (its minimum is the research's
 * cost) and only the bonus. `share` is the part of a research's spend a library
 * keeps, as a fraction, null on every kind but the library. A figure the passage
 * does not print is null, and a bonus cap is never borrowed from another kind.
 */
export function readFacility(kind, lookup) {
  const tableId = Object.hasOwn(FACILITY_TABLES, kind) ? FACILITY_TABLES[kind] : null;
  if (!tableId) return null;
  const t = open(tableId, lookup);
  const r = t.raw ?? {};
  const n = (key) => figure(r[key]);
  const out = { kind, present: t.raw != null, minimum: null, step: null, minimums: null, bonus: { step: null, size: null, cap: null }, share: null, ...prov(t) };
  if (kind === "library" || kind === "workshop") {
    Object.assign(out, { minimum: n("minimum"), step: n("step"), bonus: { step: n("bonusStep"), size: n("bonusSize"), cap: n("bonusCap") } });
    if (kind === "library") out.share = n("share") === null ? null : n("share") / 100;
  } else if (kind === "identify") {
    out.bonus = { step: n("identifyBonusStep"), size: n("identifyBonusSize"), cap: n("identifyBonusCap") };
  } else if (kind === "ritualLibrary") {
    out.minimums = parseLevelCosts(r.libraryMinimums);
    out.bonus = { step: n("libraryBonusStep"), size: n("libraryBonusSize"), cap: n("libraryBonusCap") };
  } else {
    out.minimums = parseLevelCosts(r.workshopMinimums);
    out.bonus = { step: n("bonusStep"), size: n("bonusSize"), cap: n("bonusCap") };
  }
  return out;
}

/**
 * The value a facility must hold for a level of effect: a ritual facility's
 * listed minimum for the level, or a spell facility's first-level minimum plus
 * its step for each level after the first. Null while the figures it needs are
 * unread, or for a level a ritual facility lists no minimum for.
 */
export function facilityMinimum(facility, level) {
  if (!facility || !Number.isInteger(level) || level < 1) return null;
  if (facility.minimums) return facility.minimums.find((m) => m.level === level)?.gp ?? null;
  if (facility.minimum === null || facility.step === null) return null;
  return facility.minimum + facility.step * (level - 1);
}

/**
 * The bonus a facility's value gives a research throw: the size for each step
 * of value above the required minimum, up to the cap. `value` is the facility's
 * total; `sharers` divides it among the researchers using it for different
 * projects. Null while a figure of the bonus is unread; zero below the minimum.
 */
export function facilityBonus(facility, { value, required, sharers = 1 }) {
  const b = facility?.bonus;
  if (!b || b.step === null || b.size === null || b.cap === null || b.step <= 0) return null;
  if (!Number.isFinite(value) || !Number.isFinite(required) || !(sharers >= 1)) return null;
  const surplus = value / sharers - required;
  if (surplus < 0) return 0;
  return Math.min(Math.floor(surplus / b.step) * b.size, b.cap);
}

/** What a research adds to a library's value: the library's printed share of the gold spent, or null while unread. */
export function librarySpendShare(library, spent) {
  return library?.share != null && Number.isFinite(spent) ? library.share * spent : null;
}

/** The sample's bonus on a magic item's research throw: `{present, bonus, cite, byHand}`. */
export function readSample(lookup) {
  const t = open(RESEARCH_TABLE_IDS.sample, lookup);
  return { present: t.raw != null, bonus: figure(t.raw?.sampleBonus), ...prov(t) };
}

/**
 * Identification by research: `{present, minimumLevel, material, research,
 * library, cite, byHand}`, `library` being the `identify` facility's bonus.
 */
export function readIdentification(lookup) {
  const t = open(RESEARCH_TABLE_IDS.workshop, lookup);
  const n = (key) => figure(t.raw?.[key]);
  return { present: t.raw != null, minimumLevel: n("identifyLevel"), material: n("identifyMaterial"), research: n("identifyResearch"), library: readFacility("identify", lookup), ...prov(t) };
}

/* ------------------------------ ritual costs ------------------------------ */

/**
 * Learning and casting a ritual spell: `{present, learn: {material, research},
 * cast: {component, material, research}, cite, byHand}`, each cost a list of
 * `{level, gp}` by the level of the ritual spell, or null where the page's
 * list is unread. Learning a ritual takes no components, and so lists none.
 */
export function readRitualCosts(lookup) {
  const t = open(RESEARCH_TABLE_IDS.ritualCosts, lookup);
  const r = t.raw ?? {};
  return {
    present: t.raw != null,
    learn: { material: parseLevelCosts(r.learnMaterial), research: parseLevelCosts(r.learnResearch) },
    cast: { component: parseLevelCosts(r.castComponent), material: parseLevelCosts(r.castMaterial), research: parseLevelCosts(r.castResearch) },
    ...prov(t),
  };
}

/** A cost list's gold for a ritual spell's level, or null where the list has none. */
export function ritualCostAt(list, level) {
  return Array.isArray(list) ? list.find((c) => c.level === level)?.gp ?? null : null;
}

/* ------------------------- sacrifice and divine power ------------------------- */

/**
 * The blood sacrifice's victim traits: `{present, rows: [{label, times}], cite, byHand}`
 * in print order. `times` is the factor the row adds to the component value: the
 * figure after its multiplication sign, or one for a row that prints the value
 * and no factor, and null for a cell that prints neither. The labels are the
 * page's, as the importer read them.
 */
export function readSacrificeTraits(lookup) {
  const t = open(RESEARCH_TABLE_IDS.sacrifice, lookup);
  const rows = Object.values(t.raw ?? {})
    .map((row) => {
      const label = text(row?.label);
      const cell = text(row?.multiplier);
      const m = cell.match(/[×x*]\s*(\d+)/i);
      return { label, times: m ? Number(m[1]) : /value/i.test(cell) ? 1 : null };
    })
    .filter((r) => r.label);
  return { present: t.raw != null, rows, ...prov(t) };
}

/**
 * The divine power a throw's success adds for the traits that apply: the
 * component value times each applying row's factor, summed. `applies` is a set
 * of row indexes. Null while a chosen row's factor is unread.
 */
export function sacrificeBonus(traits, applies, componentValue) {
  if (!traits?.present || !Number.isFinite(componentValue)) return null;
  let total = 0;
  for (const i of applies ?? []) {
    const row = traits.rows[i];
    if (!row || row.times === null) return null;
    total += row.times * componentValue;
  }
  return total;
}

/** How long divine power keeps: `{present, lifetime: {count, unit}|null, cite, byHand}`. */
export function readDivineLifetime(lookup) {
  const t = open(RESEARCH_TABLE_IDS.divineLifetime, lookup);
  return { present: t.raw != null, lifetime: span(t.raw), ...prov(t) };
}

/** How long arcane power keeps: the page names the unit and no count, so `count` is null. */
export function readArcaneLifetime(lookup) {
  const t = open(RESEARCH_TABLE_IDS.arcaneLifetime, lookup);
  return { present: t.raw != null, lifetime: span(t.raw), ...prov(t) };
}

/** The multiple the demonologist's power counts arcane power from a blood sacrifice for: `{present, multiplier, cite, byHand}`. */
export function readPowerOfSacrifice(lookup) {
  const t = open(RESEARCH_TABLE_IDS.powerOfSacrifice, lookup);
  return { present: t.raw != null, multiplier: figure(t.raw?.multiplier), ...prov(t) };
}

/**
 * Every table here read at once, for a consumer that wants them together:
 * `{ladder, prose, assistants, facilities, sample, identification, ritualCosts,
 * sacrifice, divineLifetime, arcaneLifetime, powerOfSacrifice}`.
 */
export function readResearchTables(lookup) {
  return {
    ladder: readLadder(lookup),
    prose: readResearchProse(lookup),
    assistants: readAssistants(lookup),
    facilities: Object.fromEntries(Object.keys(FACILITY_TABLES).map((kind) => [kind, readFacility(kind, lookup)])),
    sample: readSample(lookup),
    identification: readIdentification(lookup),
    ritualCosts: readRitualCosts(lookup),
    sacrifice: readSacrificeTraits(lookup),
    divineLifetime: readDivineLifetime(lookup),
    arcaneLifetime: readArcaneLifetime(lookup),
    powerOfSacrifice: readPowerOfSacrifice(lookup),
  };
}
