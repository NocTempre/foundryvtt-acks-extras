/**
 * A settlement's organisations arrive as FACTIONS.
 *
 * Three things this guards. The group shapes that name an organisation — a
 * quarter's own group that is neither its places nor its residents, and the
 * roaming company's head — must be taken exactly, so a point-of-interest
 * group is never read as a faction and a faction group never as a place. The
 * data a faction is built from must carry its cookbook identity, so the
 * presence claim finds it on a second run. And an authored organisation's
 * block is read defensively: a kind or a stance outside this module's words
 * never reaches a sheet, the leader is a member without being said twice, a
 * quarter it controls becomes that quarter's own place, and a second run owes
 * only what the sheet does not already carry.
 *
 * The foot of the file reads the shipped AX3 cookbook: every organisation
 * ships a numbered label and a heading located by print key or by its seat's
 * key number, every id its block names is an entry of the right sort, and the
 * groups it stands in for are groups the book really prints.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  organisationGroupOf, isOrganisationEntry, isOrganisationRow, factionId, factionData, replacedFactionIds,
  organisationPlan, organisationData, owedRelations, controlledRegions,
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

// --- the group parse ---------------------------------------------------------
check("a quarter's organisation", organisationGroupOf("Mill Quarter — Moon Cult"),
  { district: "Mill Quarter", name: "Moon Cult", roaming: false });
check("a roaming company has no quarter", organisationGroupOf("NPC Party — Iron Company"),
  { district: "", name: "Iron Company", roaming: true });
check("a quarter's places are not an organisation", organisationGroupOf("Mill Quarter — Points of Interest"), null);
check("a quarter's residents are not an organisation", organisationGroupOf("Quay Quarter — Notable Residents"), null);
check("a quarter's overview is not an organisation", organisationGroupOf("Quay Quarter — Overview"), null);
check("a group with no dash is nothing", organisationGroupOf("Mill Quarter"), null);
check("an empty group is nothing", organisationGroupOf(""), null);
check("a missing group is nothing", organisationGroupOf(undefined), null);
check("a hyphen is not the dash", organisationGroupOf("Mill Quarter - Moon Cult"), null);

check("a person under an organisation is a member",
  isOrganisationEntry({ kind: "kind.npc", meta: { group: "Quay Quarter — Salt Ring" } }), true);
check("a room under an organisation is not a member",
  isOrganisationEntry({ kind: "kind.location", meta: { group: "Quay Quarter — Salt Ring" } }), false);
check("a resident is not a member",
  isOrganisationEntry({ kind: "kind.npc", meta: { group: "Quay Quarter — Notable Residents" } }), false);
check("a table under a company is not a member",
  isOrganisationEntry({ kind: "kind.rolltable", meta: { group: "NPC Party — Iron Company" } }), false);

check("an authored organisation is its kind and its block",
  isOrganisationRow({ kind: "kind.organisation", organisation: { kind: "guild" } }), true);
check("the kind without a block is not one", isOrganisationRow({ kind: "kind.organisation" }), false);
check("a block on another kind is not one", isOrganisationRow({ kind: "kind.npc", organisation: { kind: "guild" } }), false);
check("a block that is not an object is not one", isOrganisationRow({ kind: "kind.organisation", organisation: "guild" }), false);

// --- identity ----------------------------------------------------------------
check("the id names book, quarter and organisation",
  factionId("bk", { district: "Mill Quarter", name: "Moon Cult" }), "bk.faction.mill-quarter-moon-cult");
check("a roaming company's id has no quarter",
  factionId("bk", { district: "", name: "Iron Company" }), "bk.faction.iron-company");
ok("two organisations of one name in two quarters are two ids",
  factionId("bk", { district: "Old", name: "Guild" }) !== factionId("bk", { district: "New", name: "Guild" }));

// --- a group organisation's actor data ---------------------------------------
const built = factionData({
  book: "bk", bookLabel: "BK", name: "Moon Cult", district: "Mill Quarter", seatUuid: "Actor.seat", folderId: "f1",
});
check("a faction is the faction sub-type", built.type, FACTION_TYPE);
check("seated in its quarter", built.system.seatUuid, "Actor.seat");
check("a group's kind is the Judge's", built.system.kind, "other");
check("no members yet", built.system.members, []);
check("the folder is the one asked for", built.folder, "f1");
check("stamped with its cookbook id", built.flags[MODULE_ID].cookbook.id, "bk.faction.mill-quarter-moon-cult");
check("stamped as a faction for the audit", built.flags[MODULE_ID].cookbook.kind, "kind.faction");
check("unaudited until a person checks it", built.flags[MODULE_ID].cookbook.unaudited, true);
check("a company seats in the city it is handed", factionData({ book: "bk", name: "Iron Company", seatUuid: "Actor.city" }).system.seatUuid, "Actor.city");

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
      kind: "watch", seat: "bk.poi4", holdings: ["bk.poi9", "", 7], leader: "bk.warden", members: ["bk.clerk"],
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
    organisation: { kind: "coven", nameFrom: "seat", seat: "bk.poi9", leader: "bk.cultist", members: ["bk.cultist"], replaces: ["bk.cultist"] },
  },
  "bk.org3": { kind: "kind.organisation", name: "Organisation 3", organisation: { kind: "guild", replaces: ["bk.warden", "bk.ghost"] } },
};

const plan1 = organisationPlan("bk", book["bk.org1"], book);
check("a kind in the vocabulary is kept", plan1.kind, "watch");
check("not named after its seat unless the row says so", plan1.namedAfterSeat, false);
check("the seat is the keyed place", plan1.seat, "bk.poi4");
check("the seat's quarter is read off the place's group", plan1.seatQuarter, "Mill Quarter");
check("holdings keep only ids", plan1.holdings, ["bk.poi9"]);
check("the leader is a member, said once and first", plan1.members, ["bk.warden", "bk.clerk"]);
check("a controlled quarter becomes that quarter's place, once, and an unknown one is dropped",
  plan1.controls, [districtPlaceId("bk", "Mill Quarter"), districtPlaceId("bk", "Quay Quarter")]);
check("a relation keeps a stance in the vocabulary, and hidden only when said",
  plan1.relations, [{ to: "bk.org2", stance: "hostile", hidden: true }, { to: "bk.org3", stance: "allied", hidden: false }]);

const plan2 = organisationPlan("bk", book["bk.org2"], book);
check("a kind outside the vocabulary lands as other", plan2.kind, "other");
check("named after its seat when the row says so", plan2.namedAfterSeat, true);
check("a leader already among the members is not doubled", plan2.members, ["bk.cultist"]);
check("no quarters, no relations", [plan2.controls, plan2.relations, plan2.holdings], [[], [], []]);

const bare = organisationPlan("bk", { kind: "kind.organisation", organisation: {} }, book);
check("an empty block is an empty plan",
  bare, { kind: "other", namedAfterSeat: false, seat: "", seatQuarter: "", holdings: [], leader: "", members: [], controls: [], relations: [] });
check("a missing entry is an empty plan", organisationPlan("bk", undefined).members, []);
ok("the test's words are the module's", FACTION_KINDS.includes("watch") && !FACTION_KINDS.includes("coven")
  && RELATION_STANCES.includes("hostile") && !RELATION_STANCES.includes("besotted"));

check("an authored organisation stands in for the group its person is keyed under, and for nothing else",
  [...replacedFactionIds("bk", book)], [factionId("bk", { district: "Mill Quarter", name: "Moon Cult" })]);
check("a book with no authored organisations replaces nothing", [...replacedFactionIds("bk", { "bk.sailor": book["bk.sailor"] })], []);
check("no entries replace nothing", [...replacedFactionIds("bk", undefined)], []);

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
const byFaction = new Map();
for (const [, e] of entries) {
  if (!isOrganisationEntry(e)) continue;
  const id = factionId("ax3", organisationGroupOf(e.meta.group));
  byFaction.set(id, (byFaction.get(id) ?? 0) + 1);
}
check("AX3 keys people under four groups, this many each", [...byFaction.values()].sort((a, b) => a - b), [1, 2, 6, 6]);
ok("nothing is both a place and a member", entries.every(([, e]) => !(isPoiEntry(e) && isOrganisationEntry(e))));
ok("no organisation group is read as a place", entries.every(([, e]) => !organisationGroupOf(e.meta?.group) || !isPoiEntry(e)));

const rows = entries.filter(([, e]) => isOrganisationRow(e));
check("AX3 ships twenty authored organisations", rows.length, 20);
const replaced = replacedFactionIds("ax3", ax3.entries);
check("two of them stand in for a group", replaced.size, 2);
ok("and each of those groups is one the book prints", [...replaced].every((id) => byFaction.has(id)));

const isPerson = (id) => ax3.entries[id]?.kind === "kind.npc";
const isPlace = (id) => ax3.entries[id]?.kind === "kind.location" && !isDistrictOverview(ax3.entries[id]);
const located = (h, by) => h?.op === "heading" && typeof h[by] === "string" && h[by] && !("text" in h) && !!(h.box || h.parts?.every((p) => p.box));
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
  ok(`${id} is led by a person`, !o.leader || isPerson(o.leader), o.leader);
  ok(`${id} rosters people`, (o.members ?? []).every(isPerson));
  ok(`${id} stands in for people keyed under a group`, (o.replaces ?? []).every((p) => isOrganisationEntry(ax3.entries[p])));
  ok(`${id} controls quarters the book gives an overview`, (o.controls ?? []).every((q) => isDistrictOverview(ax3.entries[q])));
  check(`${id} loses no quarter to the plan`, plan.controls.length, (o.controls ?? []).length);
  ok(`${id} stands to other organisations`, (o.relations ?? []).every((r) => r.to !== id && isOrganisationRow(ax3.entries[r.to])));
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("importer/test-faction-binding: all checks passed");
