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
 *   day, which `post` writes and `credit` consumes once world time has passed the day and
 *   every rate the day is worth is read; a passed day with a rate unread stays posted;
 * - `credited` is the research done so far, `[{day, amount, by}]`, one row per counted
 *   participant and day (`by` is the actor's uuid, `amount` a gold figure above zero), which
 *   only `credit` writes;
 * - `dueDays` is the Judge's entry for how many days the research takes, read only while
 *   the rates it would be computed from are not imported, and counted against the days
 *   credited, which are days whose gold was read;
 * - `bucket` is the components bucket as lib stores an answer, `[{uuid, qty, fit}]`,
 *   which the end of the project settles;
 * - `throw` is `{target}` where a throw has been fixed, null otherwise.
 * The researcher's sheet links to the project and does not own it.
 *
 * Nothing here is a figure. The facility's minimum, step, bonus size and cap are
 * the imported passages (`research-tables.mjs`), passed in as `tables`, and a
 * figure that is not read answers null: a verdict is then `unknown`, which blocks
 * and warns nothing, and a bonus is null.
 */
import { facilityMinimum, facilityBonus, researchRateAt, footnoteNames, assistantCapacity, assistantMinimum } from "./research-tables.mjs";
import { bucketView, ENTRY_KIND } from "../lib/bucket.mjs";

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
export const PROJECT_OP = Object.freeze({ create: "create", update: "update", close: "close", facility: "facility", post: "post", credit: "credit" });

/** The fields of a project only a Judge writes; a Player's request that names one is refused. */
export const JUDGE_FIELDS = Object.freeze(["costs", "paid", "throw", "dueDays"]);

/** The fields an update may change. `level` is a Judge's after the project exists. */
export const UPDATE_FIELDS = Object.freeze(["subject", "level", "costs", "paid", "throw", "dueDays", "assistants", "bucket"]);

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

/**
 * One stored project cleaned to its shape, or null for one with no id or a kind
 * this module does not know. The researcher is never one of the assistants.
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
 * levelOf(uuid), intBonusOf(uuid)}`.
 * @returns {{uuid: string, role: "researcher"|"assistant", level: number|null, rate: number|null, counts: boolean, why: string}[]}
 */
export function weighParticipants(project, { tables, levelOf = () => null, intBonusOf = () => 0 } = {}) {
  const named = footnoteNames(tables?.ladder, project.kind);
  const rateOf = (level) => (level === null || level === undefined ? null : (researchRateAt(tables?.ladder, level, { named })?.rate ?? null));
  const researcherLevel = levelOf(project.researcher) ?? null;
  const minimum = assistantMinimum(tables?.assistants, "aid");
  const capacity = assistantCapacity(tables?.assistants, { level: researcherLevel, intBonus: intBonusOf(project.researcher) });
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
 * remaining day worked in turn from today.
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
  return { people, creditedGp, creditedDays, posted: postedAll - waiting, waiting, unread: held.length, daily, dueGp, dueDays, dueBy, dueDay, complete };
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

/* --------------------------------- the operations -------------------------------- */

/**
 * The operations on a location's record, over the dependencies of the place they run.
 * `deps`: `read(location)` the stored flag, `write(location, patch)` a direct update
 * of `{facilities}` and/or `{projects}`, `canWrite(location)`, `relay(request)` the
 * GM's answer or undefined, `today()`, `isJudge()`, `owns(uuid)` whether this user
 * owns the actor, `linked(location)` the uuids of the characters linked to it,
 * `tables()` the imported research tables, `newId()`, and, for the rates a day is
 * worth, `levelOf(uuid)` a participant's class level (null where there is none) and
 * `intBonusOf(uuid)` an Intellect bonus.
 */
export function projectOps(deps) {
  const recordOf = (location) => readRecord(deps.read(location));
  /** What the rates and the assistants need, as this client has it. */
  const ctxOf = () => ({ today: deps.today(), tables: deps.tables(), levelOf: deps.levelOf ?? (() => null), intBonusOf: deps.intBonusOf ?? (() => 0) });

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
    if (deps.canWrite(location)) return apply(location, op, args, who);
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
    /** The posted days world time has passed credited, on one project or on every project the requester may act on. */
    credit: (location, id) => run(location, PROJECT_OP.credit, id ? { id } : {}),
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
 */
export function panelModel({ record, tables, linked, today, loc, bucketLoc, judge, owns, entries = {}, levelOf = () => null, intBonusOf = () => 0, paceOf = () => PACE.dedicated }) {
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
    const researcherLevel = levelOf(p.researcher);
    const base = ladderThrow(tables?.ladder, researcherLevel);
    const throwTarget = p.throw?.target ?? base;
    const held = entries[p.id] ?? [];
    const finishWhy = prog.complete === true ? loc("finishWhy.outcome") : loc("finishWhy.credited");
    const ladderCite = citeOf("ladder");
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
    const stripCells = Array.from({ length: cells }, (_, i) => (i < prog.creditedDays ? "c" : i < prog.creditedDays + postedDays ? "p" : ""));
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
      strip: { show: cells > 0, cells: stripCells, aria: loc("stripAria", { credited: prog.creditedDays, posted: postedDays }) },
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
          return { value, label: loc(`pace.${value}`), checked: value === paceChosen, tip: value === PACE.dedicated ? loc("paceTip.dedicated") : f === null ? loc("paceUnread", { cite: citeOf("prose") }) : loc(`paceTip.${value}`, { share, cite: citeOf("prose") }) };
        }),
      },
      post: { label: loc("post"), can, disabled: postedToday, tip: postedToday ? loc("postedToday") : loc("postTip") },
      verdicts,
      throw: throwTarget === null ? { text: "", tip: loc("throwUnread", { cite: citeOf("ladder") }) } : { text: loc("throw", { n: throwTarget }), tip: loc("throwTip", { cite: citeOf("ladder") }) },
      throwLabel: loc("throwLabel"),
      bucket: bucketView({ due: { gp: p.costs.component, cite: citeOf("costs") }, accepts: { kinds: COMPONENT_KINDS } }, held, {
        key: p.id,
        loc: bucketLoc,
        legend: loc("components"),
        icon: "fa-flask",
        locked: !can,
        dropText: loc("dropComponents"),
        emptyText: loc("noComponents"),
      }),
      closeLabel: loc("close", { name: subject.name || loc(`kind.${p.kind}`) }),
      finish: { label: loc("finish"), why: finishWhy },
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
