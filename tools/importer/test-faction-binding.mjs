/**
 * A settlement's organisations arrive as FACTIONS.
 *
 * Three things this guards. Only an authored row makes a faction, so a row is
 * recognised by its kind AND its block and by nothing else — a heading gathers
 * a body's quarry beside its members, and a page that is read cannot tell them
 * apart. The data a faction is built from must carry its cookbook identity, so
 * the presence claim finds it on a second run. And an authored organisation's
 * block is read defensively: a kind or a stance outside this module's words
 * never reaches a sheet, the leader is a member without being said twice, a
 * concealed tie stays concealed, a quarter it controls becomes that quarter's
 * own place, and a second run owes only what the sheet does not already carry.
 *
 * The foot of the file reads the shipped AX3 cookbook: every organisation
 * ships a numbered label and a heading located by print key or by its seat's
 * key number, every id its block names is an entry of the right sort, and
 * NOBODY is rostered whom an authored row did not name.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  isOrganisationRow, organisationPlan, organisationData, owedRelations, controlledRegions,
} from "../../scripts/importer/faction-binding.mjs";
import { districtPlaceId, isDistrictOverview, isPoiEntry } from "../../scripts/importer/poi-binding.mjs";
import { FACTION_KINDS, FACTION_TYPE, RELATION_STANCES } from "../../scripts/factions/constants.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";

let failed = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  }
};
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

check("an authored organisation is its kind and its block",
  isOrganisationRow({ kind: "kind.organisation", organisation: { kind: "guild" } }), true);
check("the kind without a block is not one", isOrganisationRow({ kind: "kind.organisation" }), false);
check("a block on another kind is not one", isOrganisationRow({ kind: "kind.npc", organisation: { kind: "guild" } }), false);
check("a block that is not an object is not one", isOrganisationRow({ kind: "kind.organisation", organisation: "guild" }), false);

// --- an authored organisation's block ----------------------------------------
const book = {
  "bk.millQuarter": { kind: "kind.location", name: "Mill Quarter", meta: { group: "Mill Quarter — Overview" } },
  "bk.quayQuarter": { kind: "kind.location", name: "Quay Quarter", meta: { group: "Quay Quarter — Overview" } },
  "bk.poi4": { kind: "kind.location", name: "POI 4", meta: { group: "Mill Quarter — Points of Interest" } },
  "bk.poi9": { kind: "kind.location", name: "POI 9", meta: { group: "Quay Quarter — Points of Interest" } },
  "bk.warden": { kind: "kind.npc", meta: { group: "Mill Quarter — Notable Residents" } },
  "bk.clerk": { kind: "kind.npc", meta: { group: "Mill Quarter — Notable Residents" } },
  "bk.cultist": { kind: "kind.npc", meta: { group: "Mill Quarter — Moon Cult" } },
  "bk.quarry": { kind: "kind.npc", meta: { group: "Mill Quarter — Moon Cult" } },
  "bk.sailor": { kind: "kind.npc", meta: { group: "Quay Quarter — Salt Ring" } },
  "bk.org1": {
    kind: "kind.organisation", name: "Organisation 1",
    organisation: {
      kind: "watch", seat: "bk.poi4", holdings: ["bk.poi9", "", 7], leader: "bk.warden",
      members: ["bk.clerk", { id: "bk.sailor", hidden: true }, { id: "" }, { hidden: true }, null, 7],
      controls: ["bk.millQuarter", "bk.quayQuarter", "bk.millQuarter", "bk.nowhere"],
      relations: [
        { to: "bk.org2", stance: "hostile", hidden: true },
        { to: "bk.org3", stance: "allied" },
        { to: "bk.org2", stance: "besotted" },
        { to: "", stance: "allied" },
        null,
      ],
    },
  },
  "bk.org2": {
    kind: "kind.organisation", name: "Organisation 2",
    organisation: { kind: "coven", nameFrom: "seat", seat: "bk.poi9", leader: { id: "bk.cultist", hidden: true }, members: ["bk.cultist"] },
  },
  "bk.org3": { kind: "kind.organisation", name: "Organisation 3", organisation: { kind: "guild" } },
};

const plan1 = organisationPlan("bk", book["bk.org1"], book);
check("a kind in the vocabulary is kept", plan1.kind, "watch");
check("not named after its seat unless the row says so", plan1.namedAfterSeat, false);
check("the seat is the keyed place", plan1.seat, "bk.poi4");
check("the seat's quarter is read off the place's group", plan1.seatQuarter, "Mill Quarter");
check("holdings keep only ids", plan1.holdings, ["bk.poi9"]);
check("the leader is a member, said once and first, and a roster keeps only rows with an id",
  plan1.members, [{ id: "bk.warden", hidden: false }, { id: "bk.clerk", hidden: false }, { id: "bk.sailor", hidden: true }]);
check("a member is open unless the row conceals them", plan1.members.map((m) => m.hidden), [false, false, true]);
check("a controlled quarter becomes that quarter's place, once, and an unknown one is dropped",
  plan1.controls, [districtPlaceId("bk", "Mill Quarter"), districtPlaceId("bk", "Quay Quarter")]);
check("a relation keeps a stance in the vocabulary, and hidden only when said",
  plan1.relations, [{ to: "bk.org2", stance: "hostile", hidden: true }, { to: "bk.org3", stance: "allied", hidden: false }]);

const plan2 = organisationPlan("bk", book["bk.org2"], book);
check("a kind outside the vocabulary lands as other", plan2.kind, "other");
check("named after its seat when the row says so", plan2.namedAfterSeat, true);
check("a leader already among the members is not doubled", plan2.members.map((m) => m.id), ["bk.cultist"]);
check("the leader is the id, however the row spells them", plan2.leader, "bk.cultist");
ok("a leader the book keeps secret is rostered secret — the one head who is not on the public roster",
  plan2.members.every((m) => m.hidden));
check("no quarters, no relations", [plan2.controls, plan2.relations, plan2.holdings], [[], [], []]);

const bare = organisationPlan("bk", { kind: "kind.organisation", organisation: {} }, book);
check("an empty block is an empty plan",
  bare, { kind: "other", namedAfterSeat: false, seat: "", seatQuarter: "", holdings: [], leader: "", members: [], controls: [], relations: [] });
check("a missing entry is an empty plan", organisationPlan("bk", undefined).members, []);
ok("the test's words are the module's", FACTION_KINDS.includes("watch") && !FACTION_KINDS.includes("coven")
  && RELATION_STANCES.includes("hostile") && !RELATION_STANCES.includes("besotted"));

// --- an authored organisation's actor data -----------------------------------
const org = organisationData({
  entryId: "bk.org1", book: "bk", bookLabel: "BK", name: "Wardens of the Mill", kind: "watch", notes: "<p>x</p>",
  seatUuid: "Actor.seat", leaderUuid: "Actor.lead", folderId: "f2",
  holdings: [{ uuid: "Actor.h1", name: "Quay Tower" }, { uuid: "" }, null, { uuid: "Actor.h2" }],
  controls: ["bk.district.mill-quarter"],
});
check("an authored organisation is the faction sub-type", org.type, FACTION_TYPE);
check("named as it was read", org.name, "Wardens of the Mill");
check("its kind is the row's", org.system.kind, "watch");
check("seated and led as asked", [org.system.seatUuid, org.system.leaderUuid], ["Actor.seat", "Actor.lead"]);
check("its notes are the materialized text", org.system.notes, "<p>x</p>");
check("holdings are rows with a uuid, open to the players' eyes", org.system.holdings, [
  { uuid: "Actor.h1", name: "Quay Tower", note: "", hidden: false },
  { uuid: "Actor.h2", name: "", note: "", hidden: false },
]);
check("members are rostered after the build", org.system.members, []);
check("claimed under the entry's own id", org.flags[MODULE_ID].cookbook.id, "bk.org1");
check("audited as a faction", org.flags[MODULE_ID].cookbook.kind, "kind.faction");
check("the quarters it controls ride on the flag", org.flags[MODULE_ID].cookbook.controls, ["bk.district.mill-quarter"]);
ok("no quarters, no key", !("controls" in organisationData({ entryId: "bk.org3", book: "bk", name: "Organisation 3" }).flags[MODULE_ID].cookbook));
check("a kind outside the vocabulary never reaches the sheet",
  organisationData({ entryId: "bk.org2", book: "bk", name: "x", kind: "coven" }).system.kind, "other");

// --- relations a second run still owes ----------------------------------------
const factions = new Map([
  ["bk.org2", { uuid: "Actor.o2", name: "Salt Ring" }],
  ["bk.org3", { uuid: "Actor.o3", name: "Carters" }],
]);
check("every planned relation whose other end exists is owed, with the page as its note",
  owedRelations([], plan1.relations, factions, "BK p.4"), [
    { uuid: "Actor.o2", name: "Salt Ring", stance: "hostile", note: "BK p.4", hidden: true },
    { uuid: "Actor.o3", name: "Carters", stance: "allied", note: "BK p.4", hidden: false },
  ]);
check("a row the sheet already carries is the Judge's",
  owedRelations([{ uuid: "Actor.o2", stance: "friendly" }], plan1.relations, factions).map((r) => r.uuid), ["Actor.o3"]);
check("an organisation that was not built is owed nothing",
  owedRelations([], plan1.relations, new Map([["bk.org3", { uuid: "Actor.o3", name: "Carters" }]])).map((r) => r.uuid), ["Actor.o3"]);
check("two planned rows to one organisation are one row",
  owedRelations([], [{ to: "bk.org2", stance: "allied", hidden: false }, { to: "bk.org2", stance: "rival", hidden: false }], factions).length, 1);
check("nothing planned, nothing owed", owedRelations(undefined, undefined, factions), []);

// --- the regions a map hands over ----------------------------------------------
const regionOf = new Map([["bk.district.mill-quarter", "Scene.s.Region.mill"], ["bk.district.quay-quarter", "Scene.s.Region.quay"]]);
const live = new Set(["Scene.old.Region.keep", "Scene.s.Region.mill"]);
const exists = (uuid) => live.has(uuid);
check("a new map's quarters are added to what it held",
  controlledRegions(["Scene.old.Region.keep"], ["bk.district.mill-quarter"], regionOf, exists), ["Scene.old.Region.keep", "Scene.s.Region.mill"]);
check("a region that is gone is dropped",
  controlledRegions(["Scene.gone.Region.x"], ["bk.district.mill-quarter"], regionOf, exists), ["Scene.s.Region.mill"]);
check("a quarter the map does not draw adds nothing",
  controlledRegions([], ["bk.district.hill-quarter"], regionOf, exists), null);
check("nothing to change is null, so nothing is written",
  controlledRegions(["Scene.s.Region.mill"], ["bk.district.mill-quarter"], regionOf, exists), null);
check("a region held and named again is held once",
  controlledRegions(["Scene.s.Region.mill", "Scene.old.Region.keep"], ["bk.district.mill-quarter"], regionOf, exists), null);

// --- the shipped AX3 cookbook ------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const ax3 = JSON.parse(readFileSync(join(here, "..", "..", "cookbook", "ax3.json"), "utf8"));
const entries = Object.entries(ax3.entries);

const rows = entries.filter(([, e]) => isOrganisationRow(e));
ok("AX3 ships authored organisations", rows.length > 0, `${rows.length}`);
ok("nothing is both a place and an organisation", entries.every(([, e]) => !(isPoiEntry(e) && isOrganisationRow(e))));

const isPerson = (id) => ax3.entries[id]?.kind === "kind.npc";
const isPlace = (id) => ax3.entries[id]?.kind === "kind.location" && !isDistrictOverview(ax3.entries[id]);
const located = (h, by) => h?.op === "heading" && typeof h[by] === "string" && h[by] && !("text" in h) && !!(h.box || h.parts?.every((p) => p.box));

/* Who is rostered, and by whom. A person reaches a faction's roster ONE way —
 * an authored row that names them — so this map is built from the rows alone
 * and every claim below is checked against it. */
const rosteredBy = new Map();
for (const [id, e] of rows) {
  for (const m of organisationPlan("ax3", e, ax3.entries).members) {
    if (!rosteredBy.has(m.id)) rosteredBy.set(m.id, []);
    rosteredBy.get(m.id).push({ org: id, hidden: m.hidden });
  }
}

for (const [id, e] of rows) {
  const n = /^ax3\.org(\d+)$/u.exec(id)?.[1];
  ok(`${id} is numbered`, !!n && e.name === `Organisation ${n}`, e.name);
  const o = e.organisation;
  const plan = organisationPlan("ax3", e, ax3.entries);
  if (plan.namedAfterSeat) {
    ok(`${id} is named by its seat's key number`, located(e.fields?.name, "number") && e.fields.name.number === ax3.entries[plan.seat]?.fields?.name?.number);
    ok(`${id} is still found by its own print key`, located(e.fields?.anchor, "hash"));
  } else {
    ok(`${id} is named by print key`, located(e.fields?.name, "hash") && !e.fields?.anchor);
  }
  ok(`${id} reads a description`, e.fields?.description?.op === "text" && e.fields.description.paras?.length > 0);
  check(`${id} ships a kind and stances the module knows`, [plan.kind, plan.relations.length], [o.kind, (o.relations ?? []).length]);
  ok(`${id} is seated at a keyed place, or nowhere`, !o.seat || isPlace(o.seat), o.seat);
  ok(`${id} holds keyed places`, (o.holdings ?? []).every(isPlace));
  ok(`${id} is led by a person`, !plan.leader || isPerson(plan.leader), plan.leader);
  ok(`${id} rosters people`, plan.members.every((m) => isPerson(m.id)));
  // The plan folds a doubled id into one row, so an authoring slip is only
  // visible in the row itself — and a person named twice is a page misread.
  const named = [o.leader, ...(o.members ?? [])].map((v) => (typeof v === "string" ? v : v?.id)).filter(Boolean);
  ok(`${id} names each of its people once`, new Set(named).size === named.length, named.join(","));
  ok(`${id} rosters whoever leads it`, !plan.leader || plan.members.some((m) => m.id === plan.leader));
  ok(`${id} controls quarters the book gives an overview`, (o.controls ?? []).every((q) => isDistrictOverview(ax3.entries[q])));
  check(`${id} loses no quarter to the plan`, plan.controls.length, (o.controls ?? []).length);
  ok(`${id} stands to other organisations`, (o.relations ?? []).every((r) => r.to !== id && isOrganisationRow(ax3.entries[r.to])));
}

/* Two ways a row finds its name, and the row says which: the runs the book set
 * the name in, or a heading of the body's own. A row that lost its `as` would
 * still compile against the OTHER shape's search and quietly name the faction
 * off the wrong part of the page, so the split is asserted rather than assumed. */
const namedByRun = rows.filter(([, e]) => !e.fields?.anchor && Array.isArray(e.fields?.name?.parts));
const namedByHeading = rows.filter(([, e]) => !e.fields?.anchor && !e.fields?.name?.parts);
ok("a body is named by the runs the page set its name in", namedByRun.length > 0, `${namedByRun.length}`);
for (const [id, e] of namedByRun) {
  ok(`${id}'s name is read from boxed runs`, e.fields.name.parts.length > 0 && e.fields.name.parts.every((p) => !!p.box));
}
for (const [id, e] of namedByHeading) {
  ok(`${id} is named by a heading of its own, boxed and keyed`, e.fields.name.op === "heading" && !!e.fields.name.box && !!e.fields.name.hash);
}

/* The tripwire the group-derived path failed. A heading gathers everyone
 * printed under it — a body's members, the people it holds contracts against,
 * and a guest beside both — so membership that was never authored is a page
 * read as a roster. Nobody is rostered whom a row does not name, and a person
 * the book leaves unaffiliated stays unaffiliated. */
for (const [id, who] of rosteredBy) {
  ok(`${id} is rostered because a row names them`, who.every((w) => {
    const m = (ax3.entries[w.org]?.organisation?.members ?? []).some((v) => (typeof v === "string" ? v : v?.id) === id);
    return m || (typeof ax3.entries[w.org]?.organisation?.leader === "string"
      ? ax3.entries[w.org].organisation.leader === id
      : ax3.entries[w.org]?.organisation?.leader?.id === id);
  }));
}
const people = entries.filter(([, e]) => e.kind === "kind.npc").map(([id]) => id);
ok("every rostered id is one of the book's people", [...rosteredBy.keys()].every((id) => people.includes(id)));

/* And the shape of the data that proves the reading was done. Seven people are
 * printed under ONE heading and belong in four different places: the body that
 * page introduces, the city watch, a scholastic order, and nothing at all —
 * because the page runs a body's members and the people it holds contracts
 * against under adjacent headings, in two columns. A path that took the heading
 * rostered all seven as one body, the watch officer among them. */
const oneHeading = people.filter((id) => ax3.entries[id]?.meta?.group === "Temple District — Special Locations");
check("seven people share that heading", oneHeading.length, 7);
check("and each is rostered by what a row says, not by the heading they share",
  oneHeading.map((id) => (rosteredBy.get(id) ?? []).map((w) => w.org)).map((v) => v.join(",")).sort(),
  ["", "", "", "", "ax3.org16", "ax3.org20", "ax3.org4"]);

/* A body the book hides hides its people with it. One AX3 row is a cult whose
 * whole location turns on nobody on the surface knowing it is there, so every
 * tie it rosters is concealed — and a flag flattened anywhere between the row
 * and the roster would publish that premise on a sheet a player can open. The
 * round-trip below proves the mechanism; this proves the data. */
const concealed = ax3.entries["ax3.org21"];
if (concealed) {
  const plan = organisationPlan("ax3", concealed, ax3.entries);
  ok("the body whose page turns on nobody knowing it rosters every tie concealed",
    plan.members.length > 0 && plan.members.every((m) => m.hidden),
    plan.members.map((m) => `${m.id}:${m.hidden}`).join(","));
}

/* A concealed tie is display-gated, never access-gated, so it must survive the
 * plan exactly as the row spells it — a roster that flattened `hidden` would
 * publish a secret the page keeps. */
for (const [rowId, e] of rows) {
  const spelled = new Map();
  for (const v of [e.organisation.leader, ...(e.organisation.members ?? [])]) {
    if (!v) continue;
    const pid = typeof v === "string" ? v : v.id;
    if (pid) spelled.set(pid, (spelled.get(pid) ?? false) || (typeof v === "object" && v.hidden === true));
  }
  for (const m of organisationPlan("ax3", e, ax3.entries).members) {
    check(`${rowId} keeps ${m.id} as the row spells them`, m.hidden, spelled.get(m.id) ?? false);
  }
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("importer/test-faction-binding: all checks passed");
