/**
 * Research projects at a location: the record, the facility a project reads and
 * the operations on both. Foundry-free: every clock reading, imported table,
 * permission and write is an argument or a dependency, so a test or a consumer
 * supplies its own.
 *
 * The record is `flags["acks-extras"].magic = {facilities, projects}` on the
 * `location` actor. `facilities` is `{library, workshop}`, the gold value the
 * Judge writes for each (null while unset). A PROJECT is `{id, kind, subject,
 * level, costs, researcher, assistants, paid, posted, credited, dueDays, bucket, throw,
 * status, opened, closed}`:
 * - `kind` is one of `PROJECT_KIND`; `subject` is `{uuid, name, img}` of the spell
 *   or item (blank for none); `level` is the level of effect the facility's
 *   minimum is read by;
 * - `costs` are the three costs as due, in gold, null where nothing is entered;
 * - `researcher` and `assistants` are actor uuids of the characters linked to the
 *   location (`linked`);
 * - `paid` is what the material cost was paid at the start, `{material, day}`;
 * - `posted` is the days worked and not yet credited, `[{day, pace}]`, one per calendar
 *   day, which `post` and `postRange` write, `withdraw` takes back and `credit` consumes once
 *   world time has passed the day and every rate the day is worth is read; a passed day with a
 *   rate unread stays posted;
 * - `credited` is the research done so far, `[{day, amount, by}]`, one row per counted
 *   participant and day (`by` is the actor's uuid, `amount` a gold figure above zero), which
 *   only `credit` writes;
 * - `dueDays` is the Judge's entry for how many days the research takes, read only while
 *   the rates it would be computed from are not imported, and counted against the days
 *   credited, which are days whose gold was read;
 * - `bucket` is the components bucket as lib stores an answer, `[{uuid, qty, fit}]`,
 *   which the end of the project settles;
 * - `throw` is `{target}` where a throw has been fixed, null otherwise;
 * - `outcome` is what Finish came to, `{result, die, total, target, day}` (`result` is
 *   `success` or `failure`), null while the project is open, and is written in the same
 *   write that closes it.
 * The researcher's sheet links to the project and does not own it.
 *
 * Nothing here is a figure. The facility's minimum, step, bonus size and cap are
 * the imported passages (`research-tables.mjs`), passed in as `tables`, and a
 * figure that is not read answers null: a verdict is then `unknown`, which blocks
 * and warns nothing, and a bonus is null.
 */
import { facilityMinimum, facilityBonus, researchRateAt, footnoteNames, assistantCapacity, assistantMinimum, substitutionPenalty, isAutoFail } from "./research-tables.mjs";
import { bucketView, settlementPlan, counts, coverage, COVERAGE, ENTRY_KIND, OUTCOME, SETTLE } from "../lib/bucket.mjs";
import { foldName } from "../lib/spell-sources.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/** The kinds of project: what the facility check reads, not what any of them costs. */
export const PROJECT_KIND = Object.freeze({ spell: "spell", item: "item", identify: "identify", ritual: "ritual" });

/** Every kind, in the order a picker lists them. */
export const PROJECT_KINDS = Object.freeze(Object.values(PROJECT_KIND));

/** The two facilities a location holds a value for. */
export const FACILITY = Object.freeze({ library: "library", workshop: "workshop" });

/** Every facility, in the order the panel draws them. */
export const FACILITY_KEYS = Object.freeze(Object.values(FACILITY));

/**
 * Which facility value a kind reads and which imported passage gives its minimum
 * and bonus (`readFacility`'s kinds). A ritual reads both of its facilities.
 */
export const KIND_FACILITIES = Object.freeze({
  spell: Object.freeze([{ value: FACILITY.library, table: "library" }]),
  item: Object.freeze([{ value: FACILITY.workshop, table: "workshop" }]),
  identify: Object.freeze([{ value: FACILITY.library, table: "identify" }]),
  ritual: Object.freeze([
    { value: FACILITY.library, table: "ritualLibrary" },
    { value: FACILITY.workshop, table: "ritualWorkshop" },
  ]),
});

/** The kinds of document a project's components bucket takes by a drop (lib's bucket entry kinds). */
export const COMPONENT_KINDS = Object.freeze([ENTRY_KIND.item, ENTRY_KIND.actor, ENTRY_KIND.token]);

/** The three costs a project is due, in the order the panel draws them. */
export const COST_KEYS = Object.freeze(["material", "component", "research"]);

/** The ways a day is worked: dedicated, ancillary, or both together (overtime). */
export const PACE = Object.freeze({ dedicated: "dedicated", ancillary: "ancillary", both: "both" });

/** Every pace, in the order the tab draws them. */
export const PACES = Object.freeze(Object.values(PACE));

/** The operations a request names. */
export const PROJECT_OP = Object.freeze({ create: "create", update: "update", close: "close", facility: "facility", post: "post", postRange: "postRange", withdraw: "withdraw", credit: "credit", finish: "finish" });

/** The die a research throw rolls; the throw is the die and the throw's modifiers against the target. */
export const THROW_DIE = "1d20";

/**
 * How a component row stands to the project: matched to the effect or a substitute for it. The
 * substituted share of the component cost takes a throw penalty and turns the formula off. A row that
 * is arcane or divine power is matched unless the Judge marks it a substitute (`projectEntries`).
 */
export const COMPONENT_FIT = Object.freeze({ matched: "matched", substitute: "substitute" });

/** The fit a stored power row stands at: matched unless the row says otherwise (power is no substitute); a document row's default is the policy's. */
export const powerRowFit = (stored) => str(stored) || COMPONENT_FIT.matched;

/**
 * A power row's value toward a component cost: its amount in gp, since the page counts arcane and divine power in
 * gp of power (RR ch. 8). `each` is that unit, so lib's `withQty` keeps the value at the row's held amount.
 */
export const powerRowValue = () => ({ each: 1, gp: null, source: "power", cite: "RR ch. 8" });

/** What becomes of the components bucket on every outcome: spent. A creature is marked, never deleted (`settlementPlan`). */
export const COMPONENT_SETTLE = Object.freeze({ [OUTCOME.success]: SETTLE.consume, [OUTCOME.failure]: SETTLE.consume, [OUTCOME.botch]: SETTLE.consume });

/** The key of the researcher's flag that records the formulas they have researched (`flags["acks-extras"].magic`). */
export const FORMULAS_KEY = "formulas";

/** The kinds of project whose success records a formula: the ones that make a spell or an item. */
export const FORMULA_KINDS = Object.freeze([PROJECT_KIND.spell, PROJECT_KIND.item]);

/** Why a Finish is refused, by the reason the state names; `announce` reads `refused.<reason>`. */
const FINISH_REFUSAL = Object.freeze({ credited: "notComplete", components: "componentsShort", throw: "throwUnread", int: "intUnread", bonus: "bonusUnread", penalty: "penaltyUnread", ritual: "ritual", subject: "subject" });

/** The kinds whose ladder target is raised by the project's level of effect: every kind a project is. */
export const LEVEL_RAISED_KINDS = Object.freeze([PROJECT_KIND.spell, PROJECT_KIND.item, PROJECT_KIND.identify, PROJECT_KIND.ritual]);

/** Why a Finish needs no throw: the researcher's formula completes an item, or the Judge marked a spell common. */
export const NO_THROW = Object.freeze({ formula: "formula", common: "common" });

/** The most days one range post takes: a bound on one write, not a rule of the book. */
export const RANGE_MAX = 366;

/** A list of days as text, runs joined: `[3, 4, 5, 9]` reads "3–5, 9". Each day counts once, in order. */
export function daysText(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

/** The fields of a project only a Judge writes; a Player's request that names one is refused. */
export const JUDGE_FIELDS = Object.freeze(["costs", "paid", "throw", "dueDays", "common"]);

/** The fields an update may change. `level` is a Judge's after the project exists. */
export const UPDATE_FIELDS = Object.freeze(["subject", "level", "costs", "paid", "throw", "dueDays", "assistants", "bucket", "common"]);

/** A finite number of at least zero, else null. */
const gold = (raw) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** A whole number of at least one, else null. */
const level = (raw) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : null;
};

/** A day stamp: a finite whole number, else null. */
const dayOf = (raw) => (raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw)) ? null : Math.trunc(Number(raw)));

/** A string, trimmed; "" for anything that is not text. */
const str = (raw) => (typeof raw === "string" ? raw.trim() : "");

/** A subject as `{uuid, name, img}`; every key blank for none. */
export function cleanSubject(raw) {
  return { uuid: str(raw?.uuid), name: str(raw?.name), img: str(raw?.img) };
}

/** The costs as `{material, component, research}`, each gold or null. */
export function cleanCosts(raw) {
  return Object.fromEntries(COST_KEYS.map((key) => [key, gold(raw?.[key])]));
}

/** A stored bucket answer cleaned to `[{uuid, qty, fit}]`; a row with no uuid is dropped. */
export function cleanBucket(raw) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const uuid = str(row?.uuid);
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    out.push({ uuid, qty: Math.max(1, Math.trunc(Number(row?.qty)) || 1), fit: str(row?.fit) });
  }
  return out;
}

/** The posted days as `[{day, pace}]`: a day stands once, a row with no day or an unknown pace is dropped, and the days run in order. */
export function cleanPosted(raw) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const day = dayOf(row?.day);
    if (day === null || seen.has(day) || !PACES.includes(row?.pace)) continue;
    seen.add(day);
    out.push({ day, pace: row.pace });
  }
  return out.sort((a, b) => a.day - b.day);
}

/**
 * The credited rows as `[{day, amount, by}]`. A row stands once for its day and
 * participant, which is what keeps crediting idempotent whatever writes the record
 * twice. A row with no day or with no amount above zero is dropped: a figure that
 * was not read is never written as a credit.
 */
export function cleanCredited(raw) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const entry = { day: dayOf(row?.day), amount: gold(row?.amount), by: str(row?.by) };
    if (entry.day === null || entry.amount === null || entry.amount <= 0) continue;
    const key = `${entry.day}|${entry.by}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** A list of uuids, each once and none blank. */
const uuids = (raw) => [...new Set((Array.isArray(raw) ? raw : []).map(str).filter(Boolean))];

/** A finite number, else null. */
const num = (raw) => (raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw));

/**
 * What Finish came to as stored: `{result, die, total, target, day}`, or null where there is none to read. A Finish
 * that made no throw has no die, total or target and names why in `noThrow` (`NO_THROW`).
 */
export function cleanOutcome(raw) {
  if (!raw || typeof raw !== "object" || !["success", "failure"].includes(raw.result)) return null;
  const noThrow = Object.values(NO_THROW).includes(raw.noThrow) ? raw.noThrow : null;
  return { result: raw.result, die: num(raw.die), total: num(raw.total), target: num(raw.target), day: dayOf(raw.day), ...(noThrow ? { noThrow } : {}) };
}

/**
 * One stored project cleaned to its shape, or null for one with no id or a kind
 * this module does not know. The researcher is never one of the assistants. `common`
 * is the Judge's mark that a spell is common (no research throw); it is false for any other kind.
 */
export function cleanProject(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id || !PROJECT_KINDS.includes(raw.kind)) return null;
  const researcher = str(raw.researcher);
  const target = level(raw.throw?.target);
  return {
    id: raw.id,
    kind: raw.kind,
    subject: cleanSubject(raw.subject),
    level: level(raw.level),
    costs: cleanCosts(raw.costs),
    researcher,
    assistants: uuids(raw.assistants).filter((u) => u !== researcher),
    paid: { material: gold(raw.paid?.material), day: dayOf(raw.paid?.day) },
    posted: cleanPosted(raw.posted),
    credited: cleanCredited(raw.credited),
    dueDays: level(raw.dueDays),
    bucket: cleanBucket(raw.bucket),
    throw: target === null ? null : { target },
    common: raw.kind === PROJECT_KIND.spell && raw.common === true,
    outcome: raw.status === "closed" ? cleanOutcome(raw.outcome) : null,
    status: raw.status === "closed" ? "closed" : "open",
    opened: dayOf(raw.opened),
    closed: dayOf(raw.closed),
  };
}

/** The stored flag cleaned: `{facilities: {library, workshop}, projects: [...]}`. An unknown shape reads as empty. */
export function readRecord(raw) {
  return {
    facilities: { library: gold(raw?.facilities?.library), workshop: gold(raw?.facilities?.workshop) },
    projects: (Array.isArray(raw?.projects) ? raw.projects : []).map(cleanProject).filter(Boolean),
  };
}

/** The projects not yet closed. */
export const openProjects = (projects) => (projects ?? []).filter((p) => p.status === "open");

/** The research a project has had credited, in gold. */
export const creditedTotal = (project) => (project?.credited ?? []).reduce((n, c) => n + c.amount, 0);

/** The facility values a kind reads, by the value they name. */
export const usesFacility = (kind, value) => (KIND_FACILITIES[kind] ?? []).some((f) => f.value === value);

/**
 * How many open projects share one facility value: every open project whose kind
 * reads it, and the one being created when `adding` names a kind.
 */
export function sharersOf(projects, value, { adding = null } = {}) {
  const held = openProjects(projects).filter((p) => usesFacility(p.kind, value)).length;
  return held + (adding && usesFacility(adding, value) ? 1 : 0);
}

/**
 * What one facility says about a project: the value the location holds, how many
 * projects share it, each one's share, the minimum the project's level needs,
 * whether the share meets it (`ok`, `below` or `unknown` where a figure is not
 * read) and the throw bonus the surplus buys. `tables` is `readResearchTables()`.
 * @returns {{value: string, table: string, gp: number, sharers: number, share: number, minimum: number|null, verdict: string, bonus: number|null, cite: string|null, byHand: boolean, present: boolean}[]}
 */
export function facilityVerdicts(project, { facilities, projects, tables, adding = false }) {
  return (KIND_FACILITIES[project.kind] ?? []).map(({ value, table }) => {
    const facility = tables?.facilities?.[table] ?? null;
    const gp = facilities?.[value] ?? 0;
    const sharers = Math.max(1, sharersOf(projects, value, { adding: adding ? project.kind : null }));
    const share = gp / sharers;
    const minimum = table === "identify" ? (tables?.identification?.research ?? null) : facilityMinimum(facility, project.level);
    const verdict = minimum === null ? "unknown" : share >= minimum ? "ok" : "below";
    const bonus = minimum === null ? null : facilityBonus(facility, { value: gp, required: minimum, sharers });
    return { value, table, gp, sharers, share, minimum, verdict, bonus, cite: facility?.cite ?? null, byHand: facility?.byHand === true, present: facility?.present === true };
  });
}

/**
 * Whether a project may stand at the facilities it reads: a share below the
 * imported minimum blocks a Player and warns a Judge, and a figure that is not
 * read does neither.
 * @returns {{ok: true, warn?: string}|{ok: false, reason: string}}
 */
export function facilityGate(verdicts, { judge }) {
  if (!verdicts.some((v) => v.verdict === "below")) return { ok: true };
  return judge ? { ok: true, warn: "facility" } : { ok: false, reason: "facility" };
}

/** The throw the researcher's level reads on the ladder, or null where the ladder or the level is unread. */
export function ladderThrow(ladder, researcherLevel) {
  return Number.isFinite(researcherLevel) ? (researchRateAt(ladder, researcherLevel, { full: true })?.throw ?? null) : null;
}

/** The researchers' uuids a project names, the researcher first. */
export const participantsOf = (project) => [project.researcher, ...project.assistants].filter(Boolean);

/**
 * The projects an actor is on, across locations, as its sheet links to them.
 * `entries` is `[{location: {uuid, name}, projects}]`; the answer is derived, so
 * nothing is written on the character.
 * @returns {{locationUuid: string, locationName: string, id: string, name: string, role: "researcher"|"assistant"}[]}
 */
export function linksFor(entries, uuid) {
  const out = [];
  for (const { location, projects } of entries ?? []) {
    for (const p of openProjects(projects)) {
      const role = p.researcher === uuid ? "researcher" : p.assistants.includes(uuid) ? "assistant" : null;
      if (role) out.push({ locationUuid: location.uuid, locationName: location.name, id: p.id, name: p.subject.name, role });
    }
  }
  return out;
}

/* ------------------------------ days and their credit ----------------------------- */

/** Round a gold sum off the float's tail, so a product of two read figures does not carry one. */
const tidy = (n) => Math.round(n * 1e6) / 1e6;

/**
 * The share of a day's rate a pace applies: the whole rate when dedicated, the
 * imported ancillary share when ancillary, and both together for overtime. Null
 * where the share is not read.
 */
export function paceFactor(prose, pace) {
  if (pace === PACE.dedicated) return 1;
  const share = prose?.ancillary?.share ?? null;
  if (share === null) return null;
  if (pace === PACE.ancillary) return share;
  return pace === PACE.both ? 1 + share : null;
}

/**
 * Who works a project and what each one's day is worth: the researcher first, then
 * the assistants in their listed order. A person is `{uuid, role, level, rate, counts,
 * why}`; `rate` is the ladder's rate for the level (null where it is not read), and
 * `counts` says whether the person adds it to the project. The rate is the imported
 * ladder's, read for the project's kind: a rung the footnote marks reads the printed
 * rate where the footnote names the kind (`footnoteNames`) and the footnote's rate
 * otherwise, and null where what decides it is not read. An assistant counts only
 * where the imported assistant levels say so: at or above the level that aids a
 * researcher, and within the number the researcher manages (`assistantCapacity`). `why`
 * is "" for a person who counts, else "below" (under the level), "over" (past the number
 * managed) or "unread" (a figure that decides it is not read). `ctx` is `{tables,
 * levelOf(uuid), intBonusOf(uuid)}`; an Intellect bonus that is not read (null) counts as zero here.
 * @returns {{uuid: string, role: "researcher"|"assistant", level: number|null, rate: number|null, counts: boolean, why: string}[]}
 */
export function weighParticipants(project, { tables, levelOf = () => null, intBonusOf = () => 0 } = {}) {
  const named = footnoteNames(tables?.ladder, project.kind);
  const rateOf = (level) => (level === null || level === undefined ? null : (researchRateAt(tables?.ladder, level, { named })?.rate ?? null));
  const researcherLevel = levelOf(project.researcher) ?? null;
  const minimum = assistantMinimum(tables?.assistants, "aid");
  const capacity = assistantCapacity(tables?.assistants, { level: researcherLevel, intBonus: intBonusOf(project.researcher) ?? 0 });
  const people = [{ uuid: project.researcher, role: "researcher", level: researcherLevel, rate: rateOf(researcherLevel), counts: true, why: "" }];
  let taken = 0;
  for (const uuid of project.assistants) {
    const level = levelOf(uuid) ?? null;
    let why = "";
    if (minimum === null || capacity === null) why = "unread";
    else if (level === null || level < minimum) why = "below";
    else if (taken >= capacity) why = "over";
    if (!why) taken++;
    people.push({ uuid, role: "assistant", level, rate: rateOf(level), counts: !why, why });
  }
  return people;
}

/**
 * What one day at a pace credits: each counted person's rate times the pace's share,
 * and their sum. A figure not read leaves that person's amount null and the sum null.
 * @returns {{entries: {by: string, amount: number|null}[], total: number|null}}
 */
export function dayAmounts(people, prose, pace) {
  const factor = paceFactor(prose, pace);
  const entries = people.filter((p) => p.counts).map((p) => ({ by: p.uuid, amount: p.rate !== null && factor !== null ? tidy(p.rate * factor) : null }));
  const known = entries.length > 0 && entries.every((e) => e.amount !== null);
  return { entries, total: known ? tidy(entries.reduce((n, e) => n + e.amount, 0)) : null };
}

/**
 * What a posted day credits now: one entry per counted participant, `{by, amount}`, or
 * null while a figure that decides it is unread. The day waits as a whole: an assistant
 * whose counting is unread leaves it undecided, and so does any counted participant whose
 * rate is not read at the pace, because a credit written without them could never be
 * corrected.
 * @returns {{by: string, amount: number}[]|null}
 */
export function creditableDay(people, prose, pace) {
  if (people.some((p) => p.why === "unread")) return null;
  const { entries } = dayAmounts(people, prose, pace);
  return entries.length && entries.every((e) => e.amount !== null && e.amount > 0) ? entries : null;
}

/**
 * Credit a project's posted days that world time has passed: each such day leaves
 * `posted` and adds one `credited` row per counted participant, valued by the rates read
 * now. A passed day whose rates are not all read (`creditableDay`) is left posted and
 * credits nothing, so a later call with the rates read credits it. A (day, participant)
 * already credited adds nothing, so the same call twice, or from two clients, changes
 * nothing the second time. `ctx` is `{today, tables, levelOf, intBonusOf}`.
 * @returns {{project: object, credited: number}} the project and how many days it credited
 */
export function creditDue(project, ctx) {
  const passed = project.posted.filter((row) => row.day < ctx.today);
  if (!passed.length) return { project, credited: 0 };
  const people = weighParticipants(project, ctx);
  const have = new Set(project.credited.map((c) => `${c.day}|${c.by}`));
  const standing = new Set(project.credited.map((c) => c.day));
  const added = [];
  const done = new Set();
  for (const row of passed) {
    // A day already credited that a write left posted too leaves `posted` with no row added.
    const entries = standing.has(row.day) ? [] : creditableDay(people, ctx.tables?.prose, row.pace);
    if (entries === null) continue;
    done.add(row.day);
    for (const e of entries) {
      const key = `${row.day}|${e.by}`;
      if (have.has(key)) continue;
      have.add(key);
      added.push({ day: row.day, amount: e.amount, by: e.by });
    }
  }
  if (!done.size) return { project, credited: 0 };
  return { project: { ...project, posted: project.posted.filter((row) => !done.has(row.day)), credited: [...project.credited, ...added] }, credited: done.size };
}

/**
 * Where a project stands: the gold and the days credited, the days posted (`posted` those
 * not yet passed, `waiting` those passed and not yet credited, `unread` those of the waiting
 * that a rate not read holds back), what each participant does, and the due. The due is
 * computed while the rates and the research cost are read: the days already credited and
 * posted, plus the days the remaining cost takes at a dedicated day's rate (`dueBy`
 * "ladder"). Otherwise it is the Judge's `dueDays` (`dueBy` "judge") or unknown; a day held
 * back for a rate not read is posted and not credited, so it counts toward neither. `complete`
 * is whether the research cost is credited: by the gold once it reaches the cost, not before
 * while the rates are read, and by the Judge's days where they are not; null where no cost
 * and no days are known. `dueDay` is the calendar day the last needed day falls on, were each
 * remaining day worked in turn from today. `heldDays` are the calendar days of the held ones.
 */
export function progressOf(project, ctx) {
  const prose = ctx.tables?.prose;
  const people = weighParticipants(project, ctx);
  const undecided = people.some((p) => p.why === "unread");
  const creditedDays = new Set(project.credited.map((c) => c.day)).size;
  const creditedGp = tidy(creditedTotal(project));
  const postedAll = project.posted.length;
  const waiting = project.posted.filter((row) => row.day < ctx.today).length;
  const standing = new Set(project.credited.map((c) => c.day));
  const held = project.posted.filter((row) => row.day < ctx.today && !standing.has(row.day) && creditableDay(people, prose, row.pace) === null);
  const pending = project.posted.filter((row) => !held.includes(row));
  const daily = dayAmounts(people, prose, PACE.dedicated).total;
  const expected = pending.map((row) => dayAmounts(people, prose, row.pace).total);
  const dueGp = project.costs.research;
  const rateRead = daily !== null && daily > 0;
  const computable = dueGp !== null && rateRead && !undecided && !held.length && expected.every((n) => n !== null);
  let dueDays = null;
  let dueBy = null;
  if (computable) {
    const remaining = Math.max(0, dueGp - creditedGp - expected.reduce((n, x) => n + x, 0));
    dueDays = creditedDays + pending.length + Math.ceil(remaining / daily - 1e-9);
    dueBy = "ladder";
  } else if (project.dueDays !== null) {
    dueDays = project.dueDays;
    dueBy = "judge";
  }
  let complete = null;
  if (dueGp !== null && creditedGp >= dueGp) complete = true;
  else if (dueGp !== null && rateRead) complete = false;
  else if (project.dueDays !== null) complete = creditedDays >= project.dueDays;
  else if (dueGp !== null) complete = false;
  const lastPosted = pending.length ? pending[pending.length - 1].day : null;
  const remainingDays = dueDays === null ? null : Math.max(0, dueDays - creditedDays - pending.length);
  const lastCredited = project.credited.reduce((n, c) => Math.max(n, c.day), -Infinity);
  const dueDay = remainingDays === null ? null : remainingDays > 0 ? Math.max(ctx.today, (lastPosted ?? ctx.today - 1) + 1) + remainingDays - 1 : (lastPosted ?? (Number.isFinite(lastCredited) ? lastCredited : null));
  return { people, creditedGp, creditedDays, posted: postedAll - waiting, waiting, unread: held.length, heldDays: held.map((row) => row.day), daily, dueGp, dueDays, dueBy, dueDay, complete };
}

/**
 * Whether the assistants a project names may stand: one that does not count for being
 * under the level, or past the number the researcher manages, blocks a Player and warns a
 * Judge; one whose figure is not read does neither. `names` limits the check to the
 * assistants just added (a removal never trips it); omit it to check them all.
 * @returns {{ok: true, warn?: string}|{ok: false, reason: string}}
 */
export function assistantGate(people, { judge, names = null }) {
  const asked = people.filter((p) => p.role === "assistant" && (names === null || names.includes(p.uuid)));
  const reason = asked.some((p) => p.why === "below") ? "assistantLevel" : asked.some((p) => p.why === "over") ? "assistantCount" : null;
  if (!reason) return { ok: true };
  return judge ? { ok: true, warn: reason } : { ok: false, reason };
}

/** Join two gate answers: a refusal wins, and every warning is kept in `warns`. */
function joinGates(...gates) {
  const refused = gates.find((g) => g.ok === false);
  if (refused) return refused;
  const warns = gates.map((g) => g.warn).filter(Boolean);
  return warns.length ? { ok: true, warn: warns[0], warns } : { ok: true };
}

/* ------------------------- the components, the throw, the formula ------------------------- */

/**
 * The policy of a project's components bucket (lib's bucket policy): the kinds a drop may be, the fit a
 * row opens on (a row whose own names, or the names its effects answer to, match the subject's name is
 * matched; any other document is a substitute until the seat changes it, and a power row is matched, `powerRowFit`), the amount due and what an outcome does
 * to the rows. `loc` words the fit labels; `cite` is the page of the amount due.
 */
export function componentPolicy(project, { loc = (key) => key, cite = "" } = {}) {
  const names = project.subject.name ? [project.subject.name] : [];
  return {
    accepts: { kinds: COMPONENT_KINDS },
    fit: { options: [{ key: COMPONENT_FIT.matched, label: loc("fit.matched"), names }, { key: COMPONENT_FIT.substitute, label: loc("fit.substitute") }], fallback: COMPONENT_FIT.substitute },
    due: { gp: project.costs.component, cite },
    settle: COMPONENT_SETTLE,
  };
}

/**
 * The share of the component cost the rows that are substitutes make up, and how many such rows
 * there are. `share` is 0 with none, and null where a substitute's value or the cost is not read
 * (a share that cannot be told is never taken for none). A share above the whole is held to one.
 * @returns {{share: number|null, substituted: number}}
 */
export function substitutedShare(entries, dueGp) {
  const rows = (entries ?? []).filter((e) => counts(e) && e.fit === COMPONENT_FIT.substitute);
  if (!rows.length) return { share: 0, substituted: 0 };
  const values = rows.map((e) => num(e.value?.gp));
  const due = num(dueGp);
  if (due === null || due <= 0 || values.some((v) => v === null)) return { share: null, substituted: rows.length };
  return { share: Math.min(1, tidy(values.reduce((n, v) => n + v, 0) / due)), substituted: rows.length };
}

/** A subject as the formula record matches it: its cookbook id, its uuid and its name folded. */
export const subjectRef = (subject, cookbookId = "") => ({ cookbookId: str(cookbookId), uuid: str(subject?.uuid), key: foldName(subject?.name) });

/** Whether two subject refs are one: by the cookbook id, else by uuid, else by the folded name. */
export function sameSubject(a, b) {
  if (a.cookbookId && b.cookbookId) return a.cookbookId === b.cookbookId;
  if (a.uuid && b.uuid) return a.uuid === b.uuid;
  return Boolean(a.key) && a.key === b.key;
}

/** The stored formulas as `[{kind, key, name, uuid, cookbookId, day, project}]`: a kind this module does not record and a repeat of one are dropped. */
export function cleanFormulas(raw) {
  const out = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!FORMULA_KINDS.includes(row?.kind)) continue;
    const entry = { kind: row.kind, key: str(row.key), name: str(row.name), uuid: str(row.uuid), cookbookId: str(row.cookbookId), day: dayOf(row.day), project: str(row.project) };
    if (!entry.key && !entry.uuid && !entry.cookbookId) continue;
    if (out.some((e) => e.kind === entry.kind && sameSubject(e, entry))) continue;
    out.push(entry);
  }
  return out;
}

/** Whether the researcher's formulas hold the subject, of this kind. */
export const knowsFormula = (formulas, kind, ref) => cleanFormulas(formulas).some((e) => e.kind === kind && sameSubject(e, ref));

/** The formulas with this one added; the list as it was where the subject is already held. */
export function withFormula(formulas, entry) {
  const held = cleanFormulas(formulas);
  return cleanFormulas([...held, entry]).length === held.length ? held : cleanFormulas([...held, entry]);
}

/**
 * The research throw as the project stands: the target (a Judge's stored one taken whole, else the ladder's rung for
 * the researcher's level raised by the project's level of effect, `levelRaise`), the researcher's Intellect bonus
 * (`intBonusOf(uuid)`, null where it is not read), the facility bonus (the sum of what each facility's verdict reads),
 * the penalty a substituted share takes (`substitutionPenalty`; null while its figures are not read) and whether the
 * researcher's formula is applied: it is known and no substitute is held. `modifier` is what the die is changed by.
 * A throw is never made with a figure missing (`finishState`): a target not read is null (the ladder's rung without
 * the project's level included), `intUnread` is true while the Intellect bonus is not read, `bonusUnread` while any
 * facility's bonus is not read (its table, its figures or the project's level) and `penaltyUnread` while a substitute
 * is held and the penalty's size is not read. `modifier` counts an unread part as nothing, for display only.
 * `noThrow` names why no throw is made (`NO_THROW`: an item whose formula is applied, or a spell the Judge marked
 * common) and is null where one is; the throw's parts are not held then. `components` is the bucket against the
 * component cost: `hold` is true while the cost is owed and the counted rows do not meet it or a counted row's value
 * is not read (a kind with no component cost is never held).
 * @returns {{target: number|null, by: "hand"|"ladder"|null, levelRaise: number, int: number|null, intUnread: boolean, bonus: number, bonusRead: boolean, bonusUnread: boolean, share: number|null, substituted: number, penalty: number|null, penaltyUnread: boolean, modifier: number, formula: {known: boolean, used: boolean}, noThrow: string|null, components: {due: number|null, total: number, short: boolean, unread: boolean, hold: boolean}}}
 */
export function throwPlan(project, { tables, levelOf = () => null, intBonusOf = () => null, verdicts = [], entries = [], known = false }) {
  const base = ladderThrow(tables?.ladder, levelOf(project.researcher));
  const hand = project.throw?.target ?? null;
  const raised = LEVEL_RAISED_KINDS.includes(project.kind);
  const ladder = base !== null && (!raised || project.level !== null) ? base + (raised ? project.level : 0) : null;
  const bonuses = verdicts.map((v) => v.bonus);
  const bonus = bonuses.reduce((n, b) => n + (b ?? 0), 0);
  const int = num(intBonusOf(project.researcher));
  const { share, substituted } = substitutedShare(entries, project.costs.component);
  const raw = substituted === 0 ? 0 : share === null || project.level === null ? null : substitutionPenalty(tables?.prose, { level: project.level, share });
  const penalty = Number.isFinite(raw) ? raw : null;
  const formula = { known, used: known && substituted === 0 };
  const due = num(project.costs.component);
  const cover = due !== null && due > 0 ? coverage(entries, due) : null;
  return {
    target: hand ?? ladder,
    by: hand !== null ? "hand" : ladder !== null ? "ladder" : null,
    levelRaise: hand === null && ladder !== null && raised ? project.level : 0,
    int,
    intUnread: int === null,
    bonus,
    bonusRead: bonuses.length > 0 && bonuses.every((b) => b !== null),
    bonusUnread: bonuses.some((b) => b === null),
    share,
    substituted,
    penalty,
    penaltyUnread: substituted > 0 && penalty === null,
    modifier: bonus + (penalty ?? 0) + (int ?? 0),
    formula,
    noThrow: project.kind === PROJECT_KIND.item && formula.used ? NO_THROW.formula : project.kind === PROJECT_KIND.spell && project.common === true ? NO_THROW.common : null,
    components: cover
      ? { due, total: cover.total, short: cover.status === COVERAGE.short, unread: cover.status === COVERAGE.unknown, hold: cover.status !== COVERAGE.covered }
      : { due, total: 0, short: false, unread: false, hold: false },
  };
}

/** The throw's result for a natural die: the total, whether the die is in the imported automatic-failure band, and the outcome. */
export function throwResult(plan, prose, die) {
  const auto = isAutoFail(prose, die) === true;
  const total = die + plan.modifier;
  const success = !auto && total >= plan.target;
  return { die, total, target: plan.target, auto, success, outcome: success ? OUTCOME.success : OUTCOME.failure };
}

/** Whether a resolved subject's document type suits the kind: a spell project takes a spell, the others an item that is not one. */
export const subjectFits = (kind, type) => (kind === PROJECT_KIND.spell ? type === ITEM_TYPE.spell : ![ITEM_TYPE.spell, ITEM_TYPE.ability, ITEM_TYPE.language].includes(type));

/**
 * Whether Finish may be pressed and, where it may not, why: `ritual` (a ritual's result is not written here),
 * `credited` (the research cost is not credited), `components` (the component cost is not met by the bucket, or a
 * row's value is not read), then, unless the plan makes no throw (`noThrow`): `throw` (no target is read), `int` (the
 * Intellect bonus is not read), `bonus` (a facility's bonus is not read) or `penalty` (a substitute is held and its
 * penalty's size is not read); and last `subject` (an identification with no item to identify, or a subject whose
 * document does not suit the kind). A throw is never rolled with a figure missing, and the throw is made after the
 * component cost is paid. `subjectType` is the resolved subject document's type, or null where it names none.
 * @returns {{ok: boolean, why: string}}
 */
export function finishState(project, prog, plan, { subjectType = null } = {}) {
  if (project.kind === PROJECT_KIND.ritual) return { ok: false, why: "ritual" };
  if (prog.complete !== true) return { ok: false, why: "credited" };
  if (plan.components?.hold) return { ok: false, why: "components" };
  if (!plan.noThrow) {
    if (plan.target === null) return { ok: false, why: "throw" };
    if (plan.intUnread) return { ok: false, why: "int" };
    if (plan.bonusUnread) return { ok: false, why: "bonus" };
    if (plan.penaltyUnread) return { ok: false, why: "penalty" };
  }
  const named = subjectType !== null;
  if ((project.kind === PROJECT_KIND.identify && !named) || (named && !subjectFits(project.kind, subjectType))) return { ok: false, why: "subject" };
  return { ok: true, why: "" };
}

/* --------------------------------- the operations -------------------------------- */

/**
 * The operations on a location's record, over the dependencies of the place they run.
 * `deps`: `read(location)` the stored flag, `write(location, patch)` a direct update
 * of `{facilities}` and/or `{projects}`, `canWrite(location)`, `relay(request)` the
 * GM's answer or undefined, `today()`, `isJudge()`, `owns(uuid)` whether this user
 * owns the actor, `linked(location)` the uuids of the characters linked to it,
 * `tables()` the imported research tables, `newId()`, and, for the rates a day is
 * worth, `levelOf(uuid)` a participant's class level (null where there is none) and
 * `intBonusOf(uuid)` an Intellect bonus. A Finish adds `outcome` (the world's half, `finish` lists it) and
 * `canFinish(location, id)`, whether this seat may write everything a Finish touches.
 */
export function projectOps(deps) {
  const recordOf = (location) => readRecord(deps.read(location));
  /** What the rates and the assistants need, as this client has it. */
  const ctxOf = () => ({ today: deps.today(), tables: deps.tables(), levelOf: deps.levelOf ?? (() => null), intBonusOf: deps.intBonusOf ?? (() => 0) });

  /**
   * Finish a project (ruling 223): throw, then stamp the outcome and close the project in one write (so a second
   * press finds it closed and throws nothing), write the result, settle the components bucket, and post the card.
   * A project that needs no throw (`plan.noThrow`) rolls nothing and succeeds; its card is handed `rolled: null` and a result with no die.
   * `deps.outcome` is the world's half: `subject(project)` the resolved subject's `{type, cookbookId}` or null,
   * `entries(project)` the bucket's rows as lib entries, `formulas(uuid)` the researcher's recorded formulas, `roll(formula)`
   * the natural die, `deliver`, `identify`, `addSpell`, `blank` and `recordFormula` the writers, `settle(project, plan)` and
   * `card(summary)`. A writer that throws is reported in `failed` and stops nothing after it: the bucket is settled and the
   * card posted whatever happened. A Player's request is held to what the sender owns: every component and an identified item.
   */
  async function finish(location, record, project, who) {
    const out = deps.outcome;
    if (!out) return { ok: false, reason: "op" };
    const judge = who.judge === true;
    const ctx = ctxOf();
    if (!Number.isFinite(ctx.today)) return { ok: false, reason: "noClock" };
    const gate = joinGates(
      facilityGate(facilityVerdicts(project, { facilities: record.facilities, projects: record.projects, tables: ctx.tables }), { judge }),
      assistantGate(weighParticipants(project, ctx), { judge })
    );
    if (!gate.ok) return gate;
    const doc = await out.subject(project);
    const entries = await out.entries(project);
    const ref = subjectRef(project.subject, doc?.cookbookId);
    const known = FORMULA_KINDS.includes(project.kind) && knowsFormula(await out.formulas(project.researcher), project.kind, ref);
    const verdicts = facilityVerdicts(project, { facilities: record.facilities, projects: record.projects, tables: ctx.tables });
    const plan = throwPlan(project, { tables: ctx.tables, levelOf: ctx.levelOf, intBonusOf: ctx.intBonusOf, verdicts, entries, known });
    const state = finishState(project, progressOf(project, ctx), plan, { subjectType: doc?.type ?? null });
    if (!state.ok) return { ok: false, reason: FINISH_REFUSAL[state.why] };
    if (!judge) {
      if (entries.some((e) => e.kind !== ENTRY_KIND.power && who.owns(e.uuid) !== true)) return { ok: false, reason: "bucketOwner" };
      if (project.kind === PROJECT_KIND.identify && who.owns(project.subject.uuid) !== true) return { ok: false, reason: "subjectOwner" };
    }
    // A Finish with no throw rolls no die and succeeds; the card and the stamp carry no die, total or target.
    const rolled = plan.noThrow ? null : await out.roll(THROW_DIE);
    const result = plan.noThrow ? { die: null, total: null, target: null, auto: false, success: true, outcome: OUTCOME.success, noThrow: plan.noThrow } : throwResult(plan, ctx.tables?.prose, rolled.die);
    const stamp = { result: result.success ? "success" : "failure", die: result.die, total: result.total, target: result.target, day: ctx.today, ...(plan.noThrow ? { noThrow: plan.noThrow } : {}) };
    await deps.write(location, { projects: record.projects.map((p) => (p.id === project.id ? { ...p, status: "closed", closed: ctx.today, outcome: stamp } : p)) });
    const written = [];
    const failed = [];
    const attempt = async (what, fn) => {
      try {
        const got = await fn();
        written.push({ what, ...(got && typeof got === "object" ? got : {}) });
      } catch (err) {
        failed.push({ what, error: String(err?.message ?? err) });
      }
    };
    let made = null;
    if (result.success) {
      if (project.kind === PROJECT_KIND.identify) await attempt("identify", () => out.identify(project));
      else if (project.kind === PROJECT_KIND.spell && doc) await attempt("spell", () => out.addSpell(project));
      else if (project.kind === PROJECT_KIND.item && doc) await attempt("item", () => out.deliver(project));
      else if (FORMULA_KINDS.includes(project.kind)) {
        await attempt("blank", async () => (made = await out.blank(project)));
      }
      if (FORMULA_KINDS.includes(project.kind)) await attempt("formula", () => out.recordFormula(project, { ...ref, uuid: ref.uuid || made?.uuid || "", day: ctx.today }));
    }
    const settlement = settlementPlan(entries, result.success ? OUTCOME.success : OUTCOME.failure, COMPONENT_SETTLE);
    let settled = null;
    try {
      settled = await out.settle(project, settlement);
    } catch (err) {
      failed.push({ what: "settle", error: String(err?.message ?? err) });
    }
    try {
      await out.card({ project, plan, result, rolled, written, failed, settled, made });
    } catch (err) {
      failed.push({ what: "card", error: String(err?.message ?? err) });
    }
    return { ok: true, id: project.id, outcome: stamp.result, die: result.die, total: result.total, target: result.target, auto: result.auto, modifier: plan.modifier, formula: plan.formula, noThrow: plan.noThrow, written, failed, settled, ...(gate.warn ? { warn: gate.warn, warns: gate.warns } : {}) };
  }

  /** Run one op here, on a location this client may write; `who` is the requester's: `{judge, owns(uuid)}`. */
  async function apply(location, op, args, who) {
    if (!location) return { ok: false, reason: "noLocation" };
    const record = recordOf(location);
    const judge = who.judge === true;
    const projectOf = (id) => record.projects.find((p) => p.id === id) ?? null;
    const mayAct = (project) => judge || who.owns(project.researcher) === true;

    if (op === PROJECT_OP.facility) {
      if (!judge) return { ok: false, reason: "judge" };
      if (!FACILITY_KEYS.includes(args.key)) return { ok: false, reason: "facility" };
      const gp = gold(args.gp);
      if (args.gp !== null && args.gp !== "" && args.gp !== undefined && gp === null) return { ok: false, reason: "amount" };
      await deps.write(location, { facilities: { ...record.facilities, [args.key]: gp } });
      return { ok: true, key: args.key, gp };
    }

    if (op === PROJECT_OP.create) {
      const spec = args.spec ?? {};
      if (!PROJECT_KINDS.includes(spec.kind)) return { ok: false, reason: "kind" };
      const linked = new Set(deps.linked(location));
      const researcher = str(spec.researcher);
      if (!researcher || !linked.has(researcher)) return { ok: false, reason: "researcher" };
      if (!judge && who.owns(researcher) !== true) return { ok: false, reason: "owner" };
      if (!judge && JUDGE_FIELDS.some((key) => spec[key] !== undefined)) return { ok: false, reason: "judge" };
      const assistants = uuids(spec.assistants).filter((u) => u !== researcher);
      if (assistants.some((u) => !linked.has(u))) return { ok: false, reason: "assistant" };
      const today = deps.today();
      const paid = spec.paid?.material === undefined || spec.paid?.material === null || spec.paid?.material === "" ? spec.paid : { ...spec.paid, day: spec.paid.day ?? today };
      const draft = cleanProject({ ...spec, id: "draft", researcher, assistants, paid, status: "open", opened: today, posted: [], credited: [], bucket: [] });
      const gate = joinGates(
        facilityGate(facilityVerdicts(draft, { facilities: record.facilities, projects: record.projects, tables: deps.tables(), adding: true }), { judge }),
        assistantGate(weighParticipants(draft, ctxOf()), { judge })
      );
      if (!gate.ok) return gate;
      const id = deps.newId();
      const project = { ...draft, id };
      await deps.write(location, { projects: [...record.projects, project] });
      return { ok: true, id, project, ...(gate.warn ? { warn: gate.warn, warns: gate.warns } : {}) };
    }

    if (op === PROJECT_OP.credit) {
      // Every open project the requester may act on, or the one named; nothing is written when no day is due.
      const ctx = ctxOf();
      if (!Number.isFinite(ctx.today)) return { ok: false, reason: "noClock" };
      let credited = 0;
      const next = record.projects.map((p) => {
        if (p.status !== "open" || (args.id && p.id !== args.id) || !mayAct(p)) return p;
        const done = creditDue(p, ctx);
        credited += done.credited;
        return done.project;
      });
      if (credited) await deps.write(location, { projects: next });
      return { ok: true, credited };
    }

    const project = projectOf(args.id);
    if (!project || project.status !== "open") return { ok: false, reason: "noProject" };
    if (!mayAct(project)) return { ok: false, reason: "owner" };

    if (op === PROJECT_OP.finish) return finish(location, record, project, who);

    if (op === PROJECT_OP.post) {
      const ctx = ctxOf();
      const pace = args.pace ?? PACE.dedicated;
      if (!PACES.includes(pace)) return { ok: false, reason: "pace" };
      const day = args.day === undefined || args.day === null ? ctx.today : dayOf(args.day);
      // A Player posts today and no other day, since a past day is credited at once; a Judge posts any.
      if (day === null || !Number.isFinite(ctx.today) || (!judge && day !== ctx.today)) return { ok: false, reason: "day" };
      if (project.posted.some((row) => row.day === day) || project.credited.some((c) => c.day === day)) return { ok: false, reason: "duplicate" };
      const gate = joinGates(
        facilityGate(facilityVerdicts(project, { facilities: record.facilities, projects: record.projects, tables: ctx.tables }), { judge }),
        assistantGate(weighParticipants(project, ctx), { judge })
      );
      if (!gate.ok) return gate;
      const posted = cleanPosted([...project.posted, { day, pace }]);
      await deps.write(location, { projects: record.projects.map((p) => (p.id === project.id ? { ...p, posted } : p)) });
      return { ok: true, id: project.id, day, pace, ...(gate.warn ? { warn: gate.warn, warns: gate.warns } : {}) };
    }

    if (op === PROJECT_OP.postRange) {
      // A range is a Judge's: a Player posts today alone, through `post`.
      if (!judge) return { ok: false, reason: "judge" };
      const ctx = ctxOf();
      const pace = args.pace ?? PACE.dedicated;
      if (!PACES.includes(pace)) return { ok: false, reason: "pace" };
      const count = Number(args.days);
      const from = args.from === undefined || args.from === null || args.from === "" ? ctx.today : dayOf(args.from);
      if (!Number.isInteger(count) || count < 1 || count > RANGE_MAX || from === null || !Number.isFinite(ctx.today)) return { ok: false, reason: "range" };
      const taken = new Set([...project.posted.map((row) => row.day), ...project.credited.map((c) => c.day)]);
      const days = Array.from({ length: count }, (_, i) => from + i);
      const fresh = days.filter((day) => !taken.has(day));
      const skipped = days.filter((day) => taken.has(day));
      if (!fresh.length) return { ok: true, id: project.id, pace, posted: [], skipped };
      // The gates are read once for the whole range, so a warning is told once.
      const gate = joinGates(
        facilityGate(facilityVerdicts(project, { facilities: record.facilities, projects: record.projects, tables: ctx.tables }), { judge }),
        assistantGate(weighParticipants(project, ctx), { judge })
      );
      if (!gate.ok) return gate;
      const posted = cleanPosted([...project.posted, ...fresh.map((day) => ({ day, pace }))]);
      await deps.write(location, { projects: record.projects.map((p) => (p.id === project.id ? { ...p, posted } : p)) });
      return { ok: true, id: project.id, pace, posted: fresh, skipped, ...(gate.warn ? { warn: gate.warn, warns: gate.warns } : {}) };
    }

    if (op === PROJECT_OP.withdraw) {
      // A day credited is never taken back, even where a stale write left it posted too.
      const day = dayOf(args.day);
      if (project.credited.some((c) => c.day === day)) return { ok: false, reason: "credited" };
      if (!project.posted.some((row) => row.day === day)) return { ok: false, reason: "notPosted" };
      await deps.write(location, { projects: record.projects.map((p) => (p.id === project.id ? { ...p, posted: p.posted.filter((row) => row.day !== day) } : p)) });
      return { ok: true, id: project.id, day };
    }

    if (op === PROJECT_OP.close) {
      const next = record.projects.map((p) => (p.id === project.id ? { ...p, status: "closed", closed: deps.today() } : p));
      await deps.write(location, { projects: next });
      return { ok: true, id: project.id };
    }

    if (op === PROJECT_OP.update) {
      const patch = args.patch ?? {};
      const keys = Object.keys(patch);
      if (keys.some((key) => !UPDATE_FIELDS.includes(key))) return { ok: false, reason: "field" };
      if (!judge && keys.some((key) => key === "level" || JUDGE_FIELDS.includes(key))) return { ok: false, reason: "judge" };
      // The common mark is a boolean on a spell project; written on any other kind it would store nothing, so it is refused.
      if (patch.common !== undefined && (typeof patch.common !== "boolean" || project.kind !== PROJECT_KIND.spell)) return { ok: false, reason: "field" };
      const linked = new Set(deps.linked(location));
      if (patch.assistants !== undefined && uuids(patch.assistants).some((u) => u !== project.researcher && !linked.has(u))) return { ok: false, reason: "assistant" };
      // A patch of a keyed field changes the keys it names; the rest of that field stays.
      const joined = { ...patch };
      for (const key of ["subject", "costs", "paid"]) if (patch[key] !== undefined) joined[key] = { ...project[key], ...patch[key] };
      if (joined.paid?.material !== undefined && joined.paid.material !== null && joined.paid.material !== "" && patch.paid?.day === undefined && project.paid.material === null) joined.paid.day = deps.today();
      const merged = cleanProject({ ...project, ...joined, id: project.id, kind: project.kind, researcher: project.researcher, posted: project.posted, credited: project.credited, status: "open" });
      const added = merged.assistants.filter((u) => !project.assistants.includes(u));
      const gate = added.length ? assistantGate(weighParticipants(merged, ctxOf()), { judge, names: added }) : { ok: true };
      if (!gate.ok) return gate;
      await deps.write(location, { projects: record.projects.map((p) => (p.id === project.id ? merged : p)) });
      return { ok: true, id: project.id, project: merged, ...(gate.warn ? { warn: gate.warn, warns: [gate.warn] } : {}) };
    }

    return { ok: false, reason: "op" };
  }

  /** Run an op where the seat may write the location, else ask the GM's client; `{ok: false, reason: "noGm"}` where none answers. */
  async function run(location, op, args = {}) {
    const who = { judge: deps.isJudge(), owns: (uuid) => deps.owns(uuid) };
    // A Finish writes documents beyond the location (the researcher, the components, the subject), so the seat must be able to write all of them.
    const here = op === PROJECT_OP.finish && deps.canFinish ? deps.canFinish(location, args.id) : deps.canWrite(location);
    if (here) return apply(location, op, args, who);
    const answer = await deps.relay({ locationUuid: location?.uuid, op, args });
    return answer && typeof answer === "object" ? answer : { ok: false, reason: "noGm" };
  }

  return {
    apply,
    run,
    record: recordOf,
    /** A project started: `spec` is `{kind, subject, level, researcher, assistants}`, with the costs, `paid` and `throw` a Judge's. */
    create: (location, spec) => run(location, PROJECT_OP.create, { spec }),
    /** A project's fields changed (`UPDATE_FIELDS`); the researcher and the kind never change. */
    update: (location, id, patch) => run(location, PROJECT_OP.update, { id, patch }),
    /** A day posted: `{pace, day}`, the pace dedicated and the day today unless named; a Player's day is today. */
    post: (location, id, { pace, day } = {}) => run(location, PROJECT_OP.post, { id, pace, day }),
    /** A Judge's range of days posted: `{pace, from, days}`, each day once; a day already posted or credited is skipped and named. */
    postRange: (location, id, { pace, from, days } = {}) => run(location, PROJECT_OP.postRange, { id, pace, from, days }),
    /** A posted day, not yet credited, taken back: a Judge's any, a Player's on a project of a character they own. */
    withdraw: (location, id, day) => run(location, PROJECT_OP.withdraw, { id, day }),
    /** The posted days world time has passed credited, on one project or on every project the requester may act on. */
    credit: (location, id) => run(location, PROJECT_OP.credit, id ? { id } : {}),
    /** A project finished: the throw, the outcome stamped as it closes, the result written, the bucket settled and the card posted (`finish`). */
    finish: (location, id) => run(location, PROJECT_OP.finish, { id }),
    /** A project closed: it stays on the record and counts for no facility. */
    close: (location, id) => run(location, PROJECT_OP.close, { id }),
    /** A facility's value in gold, null to blank it; the Judge's. */
    setFacility: (location, key, gp) => run(location, PROJECT_OP.facility, { key, gp }),
  };
}

/* ------------------------------------ the panel ----------------------------------- */

const GLYPH = Object.freeze({ spell: "fa-wand-sparkles", item: "fa-gem", identify: "fa-magnifying-glass", ritual: "fa-moon" });

/** The most cells the day strip draws; the count it labels is always the whole. */
const STRIP_MAX = 60;

/** A gold figure as a panel prints it: whole where it is whole, else to two places. */
const goldText = (n) => (n === null || n === undefined ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * What the Research tab renders. `loc(key, data)` is the localizer of the
 * feature's lang group (the `research` group under the magic root) and `bucketLoc` lib's bucket
 * group. `linked` is `[{uuid, name, img}]`, `owns(uuid)` whether this viewer owns
 * the actor, `entries[projectId]` the project's bucket rows resolved to lib
 * entries, `levelOf(uuid)` a participant's class level or null, `intBonusOf(uuid)` an
 * Intellect bonus and `paceOf(id)` the pace this window has chosen for a project's day.
 * `formulasOf(uuid)` is a researcher's recorded formulas, `cookbookOf(uuid)` a subject's cookbook id and
 * `subjectTypeOf(uuid)` the type of the subject's document, null where it resolves to none.
 */
export function panelModel({ record, tables, linked, today, loc, bucketLoc, judge, owns, entries = {}, levelOf = () => null, intBonusOf = () => 0, paceOf = () => PACE.dedicated, formulasOf = () => [], cookbookOf = () => "", subjectTypeOf = () => null }) {
  const open = openProjects(record.projects);
  const nameOf = (uuid) => linked.find((a) => a.uuid === uuid)?.name ?? loc("gone");
  const imgOf = (uuid) => linked.find((a) => a.uuid === uuid)?.img ?? "";
  const citeOf = (table) => loc(`cite.${table}`);

  const facilities = FACILITY_KEYS.map((key) => {
    const users = sharersOf(record.projects, key);
    const raw = record.facilities[key];
    return {
      key,
      label: loc(`facility.${key}`),
      value: raw ?? "",
      text: raw === null ? "" : goldText(raw),
      editable: judge,
      unit: loc("gp"),
      inputLabel: loc("facilityInput", { label: loc(`facility.${key}`) }),
      users,
      usersText: users ? loc("usedBy", { n: users }) : "",
      tip: loc("facilityTip", { label: loc(`facility.${key}`), cite: citeOf(key === FACILITY.library ? "library" : "workshop") }),
    };
  });

  const projects = open.map((p) => {
    const can = judge || owns(p.researcher) === true;
    const verdicts = facilityVerdicts(p, { facilities: record.facilities, projects: record.projects, tables }).map((v) => {
      const page = v.byHand ? "" : (v.cite ?? citeOf(v.table));
      const label = loc(`facility.${v.value}`);
      if (v.minimum === null) return { tone: "", glyph: "fa-book", text: "", tip: loc("verdictUnread", { label, cite: page }), aria: loc("verdictUnreadAria", { label }) };
      const parts = loc("verdictParts", { label, gp: goldText(v.gp), sharers: v.sharers, share: goldText(v.share), minimum: goldText(v.minimum), cite: page ? ` (${page})` : "" });
      if (v.verdict === "below") return { tone: "warn", glyph: "fa-triangle-exclamation", text: loc("below", { label }), tip: parts, aria: loc("below", { label }) };
      const bonusText = v.bonus === null ? loc("bonusUnread") : loc("bonus", { n: v.bonus });
      return { tone: "ok", glyph: "fa-check", text: bonusText, tip: parts, aria: bonusText };
    });
    const due = p.costs.research;
    const done = creditedTotal(p);
    const prog = progressOf(p, { today, tables, levelOf, intBonusOf });
    const subject = p.subject;
    const held = entries[p.id] ?? [];
    const ref = subjectRef(subject, cookbookOf(subject.uuid));
    const known = FORMULA_KINDS.includes(p.kind) && knowsFormula(formulasOf(p.researcher), p.kind, ref);
    const verdictRows = facilityVerdicts(p, { facilities: record.facilities, projects: record.projects, tables });
    const plan = throwPlan(p, { tables, levelOf, intBonusOf, verdicts: verdictRows, entries: held, known });
    const throwTarget = plan.target;
    const state = finishState(p, prog, plan, { subjectType: subject.uuid ? subjectTypeOf(subject.uuid) : null });
    const ladderCite = citeOf("ladder");
    const proseCite = citeOf("prose");
    // The pages of the facility passages whose bonus is not read: what a held Finish points at.
    const bonusCite = [...new Set(verdictRows.filter((v) => v.bonus === null).map((v) => (v.byHand ? citeOf(v.table) : (v.cite ?? citeOf(v.table)))))].filter(Boolean).join(", ");
    const unreadTip = { bonus: loc("throwPartBonusUnread", { cite: bonusCite }), penalty: loc("throwPartPenaltyUnread", { cite: proseCite }), int: loc("throwPartIntUnread") };
    // The component cost against the bucket: what the rows come to and the page of the cost, or the page alone where a row's value is not read.
    const componentsTip = plan.components.unread ? loc("componentsTipUnread", { cite: citeOf("costs") }) : loc("componentsTipShort", { total: goldText(plan.components.total), due: goldText(plan.components.due), cite: citeOf("costs") });
    // The throw's parts, each named: where the target came from, the level it is raised by, the Intellect bonus, the facility bonus, the substitutes' penalty and the formula.
    const throwParts = [
      plan.by === "hand" ? loc("throwTipHand") : loc("throwTip", { cite: ladderCite }),
      ...(plan.levelRaise ? [loc("throwPartLevel", { n: plan.levelRaise })] : []),
      plan.intUnread ? unreadTip.int : loc("throwPartInt", { n: plan.int >= 0 ? `+${plan.int}` : String(plan.int) }),
      plan.bonusUnread ? unreadTip.bonus : loc("throwPartBonus", { n: plan.bonus }),
      ...(plan.substituted ? [plan.penaltyUnread ? unreadTip.penalty : loc("throwPartPenalty", { n: plan.penalty, cite: proseCite })] : []),
      ...(known ? [plan.formula.used ? loc("throwPartFormula") : loc("throwPartFormulaOff")] : []),
    ].join(" · ");
    // With no throw the tip says why and lists no throw part.
    const finishTip = plan.noThrow ? loc(`finishTipNo.${plan.noThrow}`) : loc("finishTip", { parts: throwParts });
    const personOf = (uuid) => prog.people.find((x) => x.uuid === uuid);
    const rateView = (uuid) => {
      const who = personOf(uuid);
      const why = who && who.role === "assistant" && who.why ? loc(`assistantWhy.${who.why}`, { cite: citeOf("assistants") }) : "";
      if (!who || who.rate === null) return { text: "", tone: why && who?.why !== "unread" ? "warn" : "", tip: why ? `${loc("rateUnread", { cite: ladderCite })} · ${why}` : loc("rateUnread", { cite: ladderCite }) };
      const text = loc("perDay", { rate: goldText(who.rate) });
      return { text, tone: why && who.why !== "unread" ? "warn" : "", tip: why ? `${loc("rateTip", { cite: ladderCite })} · ${why}` : loc("rateTip", { cite: ladderCite }) };
    };
    const byWho = (uuid) => p.credited.filter((c) => c.by === uuid && c.amount !== null);
    const creditedParts = prog.people
      .filter((x) => byWho(x.uuid).length)
      .map((x) => loc("creditedPart", { name: nameOf(x.uuid), amount: goldText(tidy(byWho(x.uuid).reduce((n, c) => n + c.amount, 0))), n: byWho(x.uuid).length }));
    const postedDays = prog.posted + prog.waiting;
    const dayText = prog.dueDays === null ? (prog.creditedDays + postedDays ? loc("dayChipOpen", { d: prog.creditedDays + postedDays }) : "") : loc("dayChip", { d: prog.creditedDays + postedDays, due: prog.dueDays });
    const dueSource = prog.dueBy === "judge" ? loc("dueJudge") : prog.dueBy === "ladder" ? loc("dueLadder", { cite: ladderCite }) : loc("dueUnread", { cite: ladderCite });
    const cells = Math.min(STRIP_MAX, Math.max(prog.dueDays ?? 0, prog.creditedDays + postedDays));
    // A day held for an unread rate is a waiting cell ("w"); the rest of the posted are "p".
    const postedCells = p.posted.map((row) => (prog.heldDays.includes(row.day) ? "w" : "p"));
    const stripCells = Array.from({ length: cells }, (_, i) => (i < prog.creditedDays ? "c" : i < prog.creditedDays + postedDays ? postedCells[i - prog.creditedDays] : ""));
    // The posted days not yet credited, each with the tag it wears and the withdraw a viewer who may act on the project has.
    const postedList = p.posted.map((row) => {
      const waiting = prog.heldDays.includes(row.day);
      return {
        day: row.day,
        label: loc("postedDay", { day: row.day, pace: loc(`paceName.${row.pace}`) }),
        tag: waiting ? { text: loc("tagWaiting"), tone: "warn", tip: loc("waitingTip", { cite: ladderCite }) } : { text: loc("tagPosted"), tone: "", tip: "" },
        canWithdraw: can,
        withdrawLabel: loc("withdrawDay", { day: row.day }),
      };
    });
    // The due: the Judge's box while it cannot be computed from the rates, else text (the computed due, or the Judge's days).
    const dueByHand = judge && prog.dueBy !== "ladder";
    const dueRow = {
      byHand: dueByHand,
      label: dueByHand ? loc("dueByHand") : loc("dueRow"),
      value: p.dueDays ?? "",
      text: prog.dueDays === null ? "" : String(prog.dueDays),
      inputLabel: loc("dueInput"),
      tip: dueByHand ? loc("dueByHandTip", { cite: ladderCite }) : dueSource,
    };
    const paceChosen = paceOf(p.id);
    const factor = (pace) => paceFactor(tables?.prose, pace);
    const postedToday = p.posted.some((row) => row.day === today);
    const ancillary = tables?.prose?.ancillary;
    return {
      id: p.id,
      kind: p.kind,
      kindLabel: loc(`kind.${p.kind}`),
      glyph: GLYPH[p.kind],
      img: subject.img,
      name: subject.name || loc(`kind.${p.kind}`),
      subjectName: subject.name,
      subjectLabel: loc("subjectLabel"),
      level: p.level ?? "",
      levelLabel: loc("levelLabel"),
      levelTip: loc("levelTip", { cite: citeOf("library") }),
      caption: p.level ? loc("caption", { kind: loc(`kind.${p.kind}`), level: p.level }) : loc(`kind.${p.kind}`),
      can,
      judge,
      researcher: { uuid: p.researcher, name: nameOf(p.researcher), img: imgOf(p.researcher), role: loc("researcher"), rate: rateView(p.researcher) },
      assistants: p.assistants.map((uuid) => ({ uuid, name: nameOf(uuid), img: imgOf(uuid), role: loc("assistant"), rate: rateView(uuid), removeLabel: loc("removeAssistant", { name: nameOf(uuid) }) })),
      addChoices: linked.filter((a) => a.uuid !== p.researcher && !p.assistants.includes(a.uuid)).map((a) => ({ uuid: a.uuid, name: a.name })),
      addLabel: loc("addLinked"),
      costs: COST_KEYS.map((key) => ({
        key,
        label: loc(`cost.${key}`),
        value: p.costs[key] ?? "",
        text: goldText(p.costs[key]),
        editable: judge,
        inputLabel: loc("costInput", { label: loc(`cost.${key}`) }),
        tip: loc("costTip", { label: loc(`cost.${key}`), cite: citeOf("costs") }),
      })),
      paid: { value: p.paid.material ?? "", text: goldText(p.paid.material), editable: judge, label: loc("paid"), inputLabel: loc("paidInput"), tip: p.paid.day === null ? loc("paidTip") : loc("paidTipDay", { day: p.paid.day }) },
      progress: {
        text: due === null ? goldText(done) : loc("progress", { done: goldText(done), due: goldText(due) }),
        label: loc("credited"),
        tip: creditedParts.length ? loc("creditedTip", { parts: creditedParts.join(" · "), cite: ladderCite }) : loc("progressTip", { n: p.credited.length, cite: ladderCite }),
        pct: due ? Math.min(100, Math.round((done / due) * 100)) : 0,
      },
      day: { text: dayText, tone: dayText ? "pow" : "", tip: loc("dayTip", { credited: prog.creditedDays, posted: postedDays, source: dueSource }), aria: dayText },
      strip: { show: cells > 0, cells: stripCells, aria: loc("stripAria", { credited: prog.creditedDays, posted: postedDays - prog.unread, waiting: prog.unread }) },
      due: dueRow,
      postedList: { show: postedList.length > 0, rows: postedList, aria: loc("postedListAria") },
      postedRow: {
        label: loc("postedRow"),
        text: String(postedDays),
        tip: prog.unread ? loc("postedTipUnread", { n: prog.unread, cite: ladderCite }) : prog.waiting ? loc("postedTipWaiting", { n: prog.waiting }) : loc("postedTip"),
      },
      pace: {
        name: `pace-${p.id}`,
        legend: loc("paceLegend"),
        options: PACES.map((value) => {
          const f = factor(value);
          const share = ancillary && value !== PACE.dedicated ? `${ancillary.numerator}/${ancillary.denominator}` : "";
          return { value, label: loc(`pace.${value}`), name: loc(`paceName.${value}`), checked: value === paceChosen, tip: value === PACE.dedicated ? loc("paceTip.dedicated") : f === null ? loc("paceUnread", { cite: citeOf("prose") }) : loc(`paceTip.${value}`, { share, cite: citeOf("prose") }) };
        }),
      },
      // A Judge's control opens the range prompt and is never spent by today's post; a Player's posts today once.
      post: judge
        ? { label: loc("postDays"), can, range: true, disabled: false, tip: loc("postDaysTip") }
        : { label: loc("post"), can, range: false, disabled: postedToday, tip: postedToday ? loc("postedToday") : loc("postTip") },
      verdicts,
      throw: throwTarget === null ? { text: "", tip: loc("throwUnread", { cite: citeOf("ladder") }) } : { text: loc("throw", { n: throwTarget }), tip: throwParts },
      formula: known ? { text: loc("formulaKnown"), tone: plan.formula.used ? "ok" : "", tip: plan.formula.used ? loc("formulaTip") : loc("formulaOffTip") } : null,
      throwLabel: loc("throwLabel"),
      bucket: bucketView(componentPolicy(p, { loc, cite: citeOf("costs") }), held, {
        key: p.id,
        loc: bucketLoc,
        legend: loc("components"),
        icon: "fa-flask",
        locked: !can,
        dropText: loc("dropComponents"),
        emptyText: loc("noComponents"),
      }),
      closeLabel: loc("close", { name: subject.name || loc(`kind.${p.kind}`) }),
      // Finish is live for a viewer who may act on the project once the state allows it; a disabled one carries its reason.
      finish: { label: loc("finish"), why: state.ok ? "" : loc(`finishWhy.${state.why}`), live: state.ok && can, tip: state.ok ? finishTip : state.why === "components" ? componentsTip : (unreadTip[state.why] ?? loc(`finishWhy.${state.why}`)) },
      opened: p.opened ?? "",
      today,
    };
  });

  return {
    judge,
    facilities,
    projects,
    openCount: open.length,
    closed: record.projects.filter((p) => p.status === "closed").map((p) => ({ id: p.id, name: p.subject.name || loc(`kind.${p.kind}`), day: p.closed ?? "", dayText: p.closed === null ? "" : loc("closedOn", { day: p.closed }) })),
    canCreate: linked.some((a) => judge || owns(a.uuid) === true),
    createLabel: loc("newProject"),
    noLinked: linked.length === 0,
  };
}
