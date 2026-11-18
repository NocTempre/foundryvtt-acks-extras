/**
 * Research projects at a location: the record, the facility a project reads and
 * the operations on both. Foundry-free: every clock reading, imported table,
 * permission and write is an argument or a dependency, so a test or a consumer
 * supplies its own.
 *
 * The record is `flags["acks-extras"].magic = {facilities, projects}` on the
 * `location` actor. `facilities` is `{library, workshop}`, the gold value the
 * Judge writes for each (null while unset). A PROJECT is `{id, kind, subject,
 * level, costs, researcher, assistants, paid, credited, bucket, throw, status,
 * opened, closed}`:
 * - `kind` is one of `PROJECT_KIND`; `subject` is `{uuid, name, img}` of the spell
 *   or item (blank for none); `level` is the level of effect the facility's
 *   minimum is read by;
 * - `costs` are the three costs as due, in gold, null where nothing is entered;
 * - `researcher` and `assistants` are actor uuids of the characters linked to the
 *   location (`linked`);
 * - `paid` is what the material cost was paid at the start, `{material, day}`;
 * - `credited` is the research done so far, `[{day, amount, by}]`, which crediting
 *   writes and a project here only holds;
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
import { facilityMinimum, facilityBonus, researchRateAt } from "./research-tables.mjs";
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

/** The operations a request names. */
export const PROJECT_OP = Object.freeze({ create: "create", update: "update", close: "close", facility: "facility" });

/** The fields of a project only a Judge writes; a Player's request that names one is refused. */
export const JUDGE_FIELDS = Object.freeze(["costs", "paid", "throw"]);

/** The fields an update may change. `level` is a Judge's after the project exists. */
export const UPDATE_FIELDS = Object.freeze(["subject", "level", "costs", "paid", "throw", "assistants", "bucket"]);

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
    credited: (Array.isArray(raw.credited) ? raw.credited : [])
      .map((c) => ({ day: dayOf(c?.day), amount: gold(c?.amount), by: str(c?.by) }))
      .filter((c) => c.amount !== null && c.amount > 0),
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

/* --------------------------------- the operations -------------------------------- */

/**
 * The operations on a location's record, over the dependencies of the place they run.
 * `deps`: `read(location)` the stored flag, `write(location, patch)` a direct update
 * of `{facilities}` and/or `{projects}`, `canWrite(location)`, `relay(request)` the
 * GM's answer or undefined, `today()`, `isJudge()`, `owns(uuid)` whether this user
 * owns the actor, `linked(location)` the uuids of the characters linked to it,
 * `tables()` the imported research tables, `newId()`.
 */
export function projectOps(deps) {
  const recordOf = (location) => readRecord(deps.read(location));

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
      const draft = cleanProject({ ...spec, id: "draft", researcher, assistants, paid, status: "open", opened: today, credited: [], bucket: [] });
      const gate = facilityGate(facilityVerdicts(draft, { facilities: record.facilities, projects: record.projects, tables: deps.tables(), adding: true }), { judge });
      if (!gate.ok) return gate;
      const id = deps.newId();
      const project = { ...draft, id };
      await deps.write(location, { projects: [...record.projects, project] });
      return { ok: true, id, project, ...(gate.warn ? { warn: gate.warn } : {}) };
    }

    const project = projectOf(args.id);
    if (!project || project.status !== "open") return { ok: false, reason: "noProject" };
    if (!mayAct(project)) return { ok: false, reason: "owner" };

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
      const merged = cleanProject({ ...project, ...joined, id: project.id, kind: project.kind, researcher: project.researcher, credited: project.credited, status: "open" });
      await deps.write(location, { projects: record.projects.map((p) => (p.id === project.id ? merged : p)) });
      return { ok: true, id: project.id, project: merged };
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
    /** A project closed: it stays on the record and counts for no facility. */
    close: (location, id) => run(location, PROJECT_OP.close, { id }),
    /** A facility's value in gold, null to blank it; the Judge's. */
    setFacility: (location, key, gp) => run(location, PROJECT_OP.facility, { key, gp }),
  };
}

/* ------------------------------------ the panel ----------------------------------- */

const GLYPH = Object.freeze({ spell: "fa-wand-sparkles", item: "fa-gem", identify: "fa-magnifying-glass", ritual: "fa-moon" });

/** A gold figure as a panel prints it: whole where it is whole, else to two places. */
const goldText = (n) => (n === null || n === undefined ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * What the Research tab renders. `loc(key, data)` is the localizer of the
 * feature's lang group (the `research` group under the magic root) and `bucketLoc` lib's bucket
 * group. `linked` is `[{uuid, name, img}]`, `owns(uuid)` whether this viewer owns
 * the actor, `entries[projectId]` the project's bucket rows resolved to lib
 * entries, `levelOf(uuid)` a researcher's class level or null.
 */
export function panelModel({ record, tables, linked, today, loc, bucketLoc, judge, owns, entries = {}, levelOf = () => null }) {
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
    const subject = p.subject;
    const researcherLevel = levelOf(p.researcher);
    const base = ladderThrow(tables?.ladder, researcherLevel);
    const throwTarget = p.throw?.target ?? base;
    const held = entries[p.id] ?? [];
    const finishWhy = due === null || done < due ? loc("finishWhy.credited") : loc("finishWhy.outcome");
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
      researcher: { uuid: p.researcher, name: nameOf(p.researcher), img: imgOf(p.researcher), role: loc("researcher") },
      assistants: p.assistants.map((uuid) => ({ uuid, name: nameOf(uuid), img: imgOf(uuid), role: loc("assistant"), removeLabel: loc("removeAssistant", { name: nameOf(uuid) }) })),
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
        tip: loc("progressTip", { n: p.credited.length, cite: citeOf("ladder") }),
        pct: due ? Math.min(100, Math.round((done / due) * 100)) : 0,
      },
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
