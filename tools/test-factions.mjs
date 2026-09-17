/**
 * Factions: standing is a ledger of the Judge's values, and everything a
 * faction does is a reading of that ledger.
 *
 * What is pinned here. A row counts for a subject set on exactly one branch
 * (everyone, the party, one character), so a party favour and a member's own
 * offence never sum twice. The hunt is asked once per QUARTER: the board
 * changes when the party crosses into another district and never while it
 * stays, so a Judge who cleared the flag is not re-armed by the next turn.
 * The reaction listener names each faction once and stays silent for a mode
 * outside the reaction family. The social-rank fact reads the same chain as
 * every other fact and feeds the status row only when both ranks are known.
 * A market's rarity override answers before the rarity table, and the
 * standing shift prices nothing at the default knob.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";

// --- the world the Foundry-bound modules load against -------------------------
class FieldStub {
  constructor(...args) { this.args = args; }
}
globalThis.foundry = {
  utils: { deepClone: (v) => structuredClone(v), randomID: () => "id", setProperty: () => {}, hasProperty: () => false },
  data: { regionBehaviors: { RegionBehaviorType: class {} }, fields: new Proxy({}, { get: () => FieldStub }) },
};
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.CONST = { TOKEN_DISPLAY_MODES: {}, TOKEN_DISPOSITIONS: {} };
let standingStep = 0;
let domainsApi = null;
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k, d = {}) => `${k}|${d.name ?? `${d.other}>${d.own}:${d.stance}`}` },
  settings: { get: (_m, key) => (key === "standingPerClassStep" ? standingStep : undefined), set() {}, register() {} },
  modules: { get: (id) => (id === "acks-domains" && domainsApi ? { api: domainsApi } : undefined) },
  tables: { find: () => null },
  packs: { filter: () => [], get: () => undefined },
  actors: { filter: () => [], find: () => null },
  scenes: [],
};
globalThis.acksExtras ??= {};

const {
  subjectsOf, matchesSubject, sumStanding, rowsFor, isWanted, huntersAmong, classStepsFor, wouldCycleFaction, factionRecord,
  relationOf, regardedBy, placesHeld,
} = await import("../scripts/factions/standing-logic.mjs");
const { applyHunt, freshSettlement } = await import("../scripts/formation/settlement.mjs");
const { pushFactionModifiers } = await import("../scripts/factions/influence-listener.mjs");
const { marketClassShift } = await import("../scripts/factions/standing.mjs");
const { getSocialRank } = await import("../scripts/henchmen/facts.mjs");
const { computeDefaults } = await import("../scripts/influence/actor-data.mjs");
const { overrideRarity, rollMonthlyPool } = await import("../scripts/henchmen/rules/availability.mjs");
const { resolveLevelValue } = await import("../scripts/lib/vocab.mjs");
globalThis.acksExtras.lib = { resolveLevelValue };

// --- subjects ------------------------------------------------------------------
const subjects = subjectsOf({ partyUuid: "Actor.party", memberUuids: ["Actor.a", "Actor.b", "Actor.a", ""] });
assert.deepEqual(subjects, { partyUuid: "Actor.party", characterUuids: ["Actor.a", "Actor.b"], factionUuids: [] });
assert.deepEqual(subjectsOf(), { partyUuid: "", characterUuids: [], factionUuids: [] });
const withGuild = subjectsOf({ partyUuid: "Actor.party", memberUuids: ["Actor.a"], factionUuids: ["Actor.guild", "", "Actor.guild"] });
assert.deepEqual(withGuild.factionUuids, ["Actor.guild"], "the organisations a side answers for are deduped like its people");

assert.equal(matchesSubject({ scope: "all" }, subjects), true);
assert.equal(matchesSubject({ scope: "faction", uuid: "Actor.guild" }, withGuild), true);
assert.equal(matchesSubject({ scope: "faction", uuid: "Actor.guild" }, subjects), false, "a side in no organisation takes no organisation's row");
assert.equal(matchesSubject({ scope: "faction", uuid: "" }, withGuild), false, "a faction row with no uuid names nobody");
assert.equal(matchesSubject({ scope: "character", uuid: "Actor.guild" }, withGuild), false, "an organisation is not a character");
assert.equal(matchesSubject({ scope: "party", uuid: "Actor.party" }, subjects), true);
assert.equal(matchesSubject({ scope: "party", uuid: "Actor.other" }, subjects), false);
assert.equal(matchesSubject({ scope: "party", uuid: "" }, subjects), false, "a party row with no uuid names nobody");
assert.equal(matchesSubject({ scope: "character", uuid: "Actor.b" }, subjects), true);
assert.equal(matchesSubject({ scope: "character", uuid: "Actor.party" }, subjects), false, "the party is not a character");
assert.equal(matchesSubject({ scope: "nonsense", uuid: "Actor.a" }, subjects), false);
assert.equal(matchesSubject(undefined, subjects), true, "a row with no subject is everyone's");

// --- the ledger ----------------------------------------------------------------
const ledger = [
  { subject: { scope: "all" }, value: 1, source: "manual" },
  { subject: { scope: "party", uuid: "Actor.party" }, value: 2, source: "favour" },
  { subject: { scope: "character", uuid: "Actor.a" }, value: -4, source: "offence" },
  { subject: { scope: "character", uuid: "Actor.z" }, value: -10, source: "offence" },
  { subject: { scope: "party", uuid: "Actor.party" }, value: "3", source: "favour" },
  { subject: { scope: "character", uuid: "Actor.b" }, value: 0, source: "wanted" },
];
assert.equal(sumStanding(ledger, subjects), 2, "1 + 2 - 4 + 3 + 0; the stranger's row is not ours");
assert.equal(sumStanding(ledger, subjects, { source: "favour" }), 5);
assert.equal(sumStanding(ledger, subjects, { source: "crime" }), 0);
assert.equal(sumStanding(undefined, subjects), 0);
assert.deepEqual(rowsFor(ledger, subjects, { source: "offence" }).map((r) => r.value), [-4]);
assert.equal(rowsFor(ledger, subjects).length, 5);
assert.equal(isWanted(ledger, subjects), true, "a member's wanted row wants the party");
assert.equal(isWanted(ledger, subjectsOf({ partyUuid: "Actor.party", memberUuids: ["Actor.a"] })), false);
assert.equal(isWanted([{ subject: { scope: "all" }, value: 0, source: "wanted" }], subjectsOf()), true);

// A row about an organisation counts for every side that answers for it, and
// for no other — the numeric half of a rivalry.
const guildRow = [{ subject: { scope: "faction", uuid: "Actor.guild" }, value: -3, source: "offence" }];
assert.equal(sumStanding(guildRow, withGuild), -3, "the guild's people carry the guild's row");
assert.equal(sumStanding(guildRow, subjects), 0, "a side outside the guild carries none of it");
assert.equal(sumStanding([...ledger, ...guildRow], withGuild), sumStanding(ledger, withGuild) - 3, "a faction row adds once, beside the rest");

// --- hunters -------------------------------------------------------------------
const watch = { uuid: "Actor.watch", controls: ["Region.r1"], standing: [{ subject: { scope: "party", uuid: "Actor.party" }, source: "wanted", value: 0 }] };
const guild = { uuid: "Actor.guild", controls: ["Region.r1"], standing: [{ subject: { scope: "all" }, source: "favour", value: 3 }] };
const cult = { uuid: "Actor.cult", controls: ["Region.r2"], standing: [{ subject: { scope: "all" }, source: "wanted", value: 0 }] };
assert.deepEqual(huntersAmong([watch, guild, cult], "Region.r1", subjects).map((f) => f.uuid), ["Actor.watch"]);
assert.deepEqual(huntersAmong([watch, guild, cult], "Region.r2", subjects).map((f) => f.uuid), ["Actor.cult"]);
assert.deepEqual(huntersAmong([watch, guild, cult], "", subjects), [], "no quarter, no hunt");
assert.deepEqual(huntersAmong([watch], "Region.r1", subjectsOf({ partyUuid: "Actor.others" })), []);

// --- market steps --------------------------------------------------------------
assert.equal(classStepsFor(5, 2), 2);
assert.equal(classStepsFor(-5, 2), -2, "bad standing shrinks the market by whole steps");
assert.equal(classStepsFor(1, 2), 0, "short of a step moves nothing");
assert.equal(classStepsFor(9, 0), 0, "the default knob prices nothing");
assert.equal(classStepsFor(9, -3), 0);
assert.equal(classStepsFor("6", "3"), 2);

// --- the parent walk -----------------------------------------------------------
const index = new Map([
  ["Actor.top", { uuid: "Actor.top", parentUuid: "" }],
  ["Actor.mid", { uuid: "Actor.mid", parentUuid: "Actor.top" }],
  ["Actor.leaf", { uuid: "Actor.leaf", parentUuid: "Actor.mid" }],
]);
assert.equal(wouldCycleFaction("Actor.top", "Actor.leaf", index), true, "the top under its own leaf is a loop");
assert.equal(wouldCycleFaction("Actor.leaf", "Actor.top", index), false);
assert.equal(wouldCycleFaction("Actor.x", "Actor.x", index), true);
assert.equal(wouldCycleFaction("Actor.x", "", index), false);
assert.equal(wouldCycleFaction("Actor.mid", "Actor.stranger", index), false, "an unknown parent walks nowhere");

const record = factionRecord({
  uuid: "Actor.f",
  name: "Watch",
  system: {
    kind: "watch",
    seatUuid: "Actor.keep",
    controls: ["Region.r1"],
    standing: [{ toObject: () => ({ value: 1 }) }],
    members: [{ uuid: "Actor.a" }],
    holdings: [{ toObject: () => ({ uuid: "Actor.gaol", hidden: true }) }],
    relations: [{ uuid: "Actor.guild", stance: "rival" }],
  },
});
assert.deepEqual(record, {
  uuid: "Actor.f", name: "Watch", kind: "watch", parentUuid: "", seatUuid: "Actor.keep", controls: ["Region.r1"],
  standing: [{ value: 1 }], members: [{ uuid: "Actor.a" }], holdings: [{ uuid: "Actor.gaol", hidden: true }],
  relations: [{ uuid: "Actor.guild", stance: "rival" }],
}, "every schema array arrives as plain rows");
assert.equal(factionRecord(null).kind, "other");
assert.deepEqual(factionRecord(null).relations, []);

// --- relations, and the places a faction is behind the door of ------------------
{
  const watchRec = factionRecord({
    uuid: "Actor.watch", name: "Watch",
    system: { seatUuid: "Actor.keep", holdings: [{ uuid: "Actor.gaol" }, { uuid: "Actor.keep" }, { uuid: "" }], relations: [{ uuid: "Actor.guild", stance: "rival", note: "smuggling" }] },
  });
  const guildRec = factionRecord({
    uuid: "Actor.guild", name: "Guild",
    system: { seatUuid: "", relations: [{ uuid: "Actor.watch", stance: "hostile", hidden: true }, { uuid: "Actor.cult", stance: "allied" }] },
  });
  const cultRec = factionRecord({ uuid: "Actor.cult", name: "Cult", system: {} });

  assert.equal(relationOf(watchRec, "Actor.guild").stance, "rival");
  assert.equal(relationOf(watchRec, "Actor.cult"), null, "no row is null, not a neutral one");
  assert.equal(relationOf(watchRec, ""), null);
  assert.equal(relationOf(null, "Actor.guild"), null);
  assert.equal(relationOf(guildRec, "Actor.watch").stance, "hostile", "the two sides are read apart — the relation is directed");

  assert.deepEqual(regardedBy([watchRec, guildRec, cultRec], "Actor.watch"),
    [{ uuid: "Actor.guild", name: "Guild", stance: "hostile", note: "", hidden: true }],
    "the reverse view names who holds the opinion, not whom it is about");
  assert.deepEqual(regardedBy([watchRec, guildRec, cultRec], "Actor.cult").map((r) => r.uuid), ["Actor.guild"]);
  assert.deepEqual(regardedBy([watchRec, guildRec], "Actor.guild").map((r) => r.uuid), ["Actor.watch"]);
  assert.deepEqual(regardedBy([watchRec], "Actor.nobody"), []);
  assert.deepEqual(regardedBy([watchRec], ""), []);

  assert.deepEqual(placesHeld(watchRec), ["Actor.keep", "Actor.gaol"], "the seat comes first and is never listed twice");
  assert.deepEqual(placesHeld(guildRec), [], "a faction with no seat and no holding is behind no door");
  assert.deepEqual(placesHeld(null), []);
}

// --- the hunt, asked once per quarter -------------------------------------------
{
  const fresh = freshSettlement();
  assert.equal(fresh.huntRegion, "");
  assert.equal(fresh.huntedBy, "");
  const hunted = applyHunt(fresh, { regionUuid: "Region.r1", hunterUuid: "Actor.watch" });
  assert.equal(hunted.wanted, true, "entering the hunter's quarter sets the flag");
  assert.equal(hunted.huntedBy, "Actor.watch");
  assert.equal(hunted.huntRegion, "Region.r1");
  assert.equal(applyHunt(hunted, { regionUuid: "Region.r1", hunterUuid: "" }), hunted, "the same quarter is not asked again");
  const cleared = { ...hunted, wanted: false, huntedBy: "" };
  assert.equal(applyHunt(cleared, { regionUuid: "Region.r1", hunterUuid: "Actor.watch" }), cleared, "the Judge's clearing stands while the party stays");
  const moved = applyHunt(cleared, { regionUuid: "Region.r2", hunterUuid: "" });
  assert.equal(moved.huntRegion, "Region.r2");
  assert.equal(moved.wanted, false, "a quarter nobody hunts in leaves the flag as the Judge had it");
  assert.equal(moved.huntedBy, "");
  const kept = applyHunt({ ...hunted }, { regionUuid: "Region.r2", hunterUuid: "" });
  assert.equal(kept.wanted, true, "a ticked flag survives the crossing; only the name clears");
  assert.equal(kept.huntedBy, "");
  const outside = applyHunt(hunted, { regionUuid: "", hunterUuid: "" });
  assert.equal(outside.huntRegion, "");
  assert.equal(outside.huntedBy, "");
  assert.equal(applyHunt(fresh, {}), fresh, "no quarter from no quarter is nothing");
}

// --- the reaction listener -------------------------------------------------------
{
  const guildDoc = { uuid: "Actor.guild", name: "Guild" };
  const watchDoc = { uuid: "Actor.watch", name: "Watch" };
  const nobody = { uuid: "Actor.nobody", name: "Nobody" };
  const values = new Map([["Actor.guild", 2], ["Actor.watch", -1], ["Actor.nobody", 0]]);
  const finders = {
    subjectsOfActor: () => subjects,
    isFaction: (doc) => doc === guildDoc,
    factionsOfMember: () => [guildDoc, watchDoc],
    factionsControlling: () => [guildDoc, nobody],
    authoritiesRostering: () => [watchDoc],
    standingFor: (faction) => values.get(faction.uuid) ?? 0,
    districtUnder: () => ({ uuid: "Region.r1" }),
  };
  const rows = [];
  pushFactionModifiers({ actor: { uuid: "Actor.a" }, targetActor: guildDoc, mode: null, modifiers: rows }, finders);
  assert.deepEqual(rows, [
    { label: "ACKS-FACTIONS.influence.standing|Guild", value: 2 },
    { label: "ACKS-FACTIONS.influence.standing|Watch", value: -1 },
    { label: "ACKS-FACTIONS.influence.authority|Watch", value: 0, note: true },
  ], "each faction once, a zero standing silent, the authority a note the roller keeps");

  const silent = [];
  pushFactionModifiers({ actor: {}, targetActor: guildDoc, mode: "seduction", modifiers: silent }, finders);
  assert.deepEqual(silent, [], "a mode outside the reaction family gets no rows");
  const reaction = [];
  pushFactionModifiers({ actor: {}, targetActor: guildDoc, mode: "hiring", modifiers: reaction }, finders);
  assert.equal(reaction.length, 3, "a reaction-family mode is priced");

  const noDistrict = [];
  pushFactionModifiers({ actor: {}, targetActor: nobody, mode: null, modifiers: noDistrict }, { ...finders, districtUnder: () => null });
  assert.deepEqual(noDistrict, [
    { label: "ACKS-FACTIONS.influence.standing|Guild", value: 2 },
    { label: "ACKS-FACTIONS.influence.standing|Watch", value: -1 },
  ], "outside a district only the target's own factions speak");
  assert.doesNotThrow(() => pushFactionModifiers({ actor: {}, targetActor: null, mode: null, modifiers: null }, finders));
  assert.doesNotThrow(() => pushFactionModifiers(null, finders));
}

// --- what the other side's organisation thinks of the speaker's ------------------
{
  const guildDoc = { uuid: "Actor.guild", name: "Guild" };
  const watchDoc = { uuid: "Actor.watch", name: "Watch" };
  const cultDoc = { uuid: "Actor.cult", name: "Cult" };
  // The target speaks for the Guild; the influencer for the Watch and the Cult.
  const rowsBetween = new Map([
    ["Actor.guild>Actor.watch", { uuid: "Actor.watch", stance: "hostile", hidden: false }],
    ["Actor.guild>Actor.cult", { uuid: "Actor.cult", stance: "rival", hidden: true }],
  ]);
  const base = {
    subjectsOfActor: () => subjects,
    isFaction: (doc) => doc === guildDoc,
    factionsOfMember: (uuid) => (uuid === "Actor.a" ? [watchDoc, cultDoc] : []),
    factionsControlling: () => [],
    authoritiesRostering: () => [],
    standingFor: () => 0,
    districtUnder: () => null,
    relationBetween: (a, b) => rowsBetween.get(`${a.uuid}>${b.uuid}`) ?? null,
    isGM: () => true,
  };
  const context = () => ({ actor: { uuid: "Actor.a" }, targetActor: guildDoc, mode: null, modifiers: [] });

  const judge = context();
  pushFactionModifiers(judge, base);
  assert.deepEqual(judge.modifiers, [
    { label: "ACKS-FACTIONS.influence.relation|Guild>Watch:ACKS-FACTIONS.stance.hostile", value: 0, note: true },
    { label: "ACKS-FACTIONS.influence.relation|Guild>Cult:ACKS-FACTIONS.stance.rival", value: 0, note: true },
  ], "a relation is said, never added: value 0 and marked a note");

  const player = context();
  pushFactionModifiers(player, { ...base, isGM: () => false });
  assert.deepEqual(player.modifiers.map((r) => r.label), ["ACKS-FACTIONS.influence.relation|Guild>Watch:ACKS-FACTIONS.stance.hostile"],
    "a hidden row is the Judge's alone");

  const neutral = context();
  pushFactionModifiers(neutral, { ...base, relationBetween: () => ({ stance: "neutral" }) });
  assert.deepEqual(neutral.modifiers, [], "neutral is the absence of an opinion and says nothing");

  const none = context();
  pushFactionModifiers(none, { ...base, relationBetween: () => null });
  assert.deepEqual(none.modifiers, []);

  const offFamily = { actor: { uuid: "Actor.a" }, targetActor: guildDoc, mode: "seduction", modifiers: [] };
  pushFactionModifiers(offFamily, base);
  assert.deepEqual(offFamily.modifiers, [], "a mode outside the reaction family gets no relation note either");

  // The speaker's own organisation on both sides of the table is not an
  // opinion about anyone: a faction never regards itself.
  const itself = { actor: { uuid: "Actor.a" }, targetActor: watchDoc, mode: null, modifiers: [] };
  pushFactionModifiers(itself, { ...base, isFaction: (doc) => doc === watchDoc, relationBetween: () => ({ stance: "hostile" }) });
  assert.deepEqual(itself.modifiers.filter((r) => r.label.includes("Watch>Watch")), []);
}

// --- the standing shift at the knob ---------------------------------------------
standingStep = 0;
assert.equal(marketClassShift({ system: {} }, { uuid: "Actor.a" }), 0, "the default knob prices nothing");
standingStep = 2;
assert.equal(marketClassShift({ system: {} }, { uuid: "Actor.a" }), 0, "no faction in the world, no shift");
assert.equal(marketClassShift(null, null), 0);
standingStep = 0;

// --- the social rank fact -------------------------------------------------------
{
  const actor = (items = [], flag = undefined) => ({
    items: items.map((name) => ({ name })),
    getFlag: (_m, key) => (key === "socialRank" ? flag : undefined),
  });
  assert.equal(getSocialRank(actor()), null, "nothing stated is null, not zero");
  assert.deepEqual(getSocialRank(actor([], 3)), { rank: 3, title: "" });
  assert.deepEqual(getSocialRank(actor([], "3")), { rank: 3, title: "" });
  assert.deepEqual(getSocialRank(actor([], { rank: 2, title: "Baron" })), { rank: 2, title: "Baron" });
  assert.deepEqual(getSocialRank(actor([], { title: "Baron" })), { rank: null, title: "Baron" });
  assert.deepEqual(getSocialRank(actor(["Rank: 3 (Baron)"])), { rank: 3, title: "Baron" });
  assert.deepEqual(getSocialRank(actor(["Social Rank: 5 (Count)"])), { rank: 5, title: "Count" });
  assert.deepEqual(getSocialRank(actor(["Rank - 4"])), { rank: 4, title: "" });
  assert.deepEqual(getSocialRank(actor(["Rank: Baron"])), { rank: null, title: "Baron" }, "a title with no rung is a title");
  assert.deepEqual(getSocialRank(actor(["Stronghold: Fort", "rank: 1 (Knight)"])), { rank: 1, title: "Knight" });
  assert.equal(getSocialRank(actor(["Ranking: 3"])), null, "the marker word is exact");
  assert.deepEqual(getSocialRank(actor(["Rank: 9 (King)"], 2)), { rank: 2, title: "" }, "the flag outranks the marker");
  domainsApi = { getSocialRank: () => ({ rank: 7, title: "Duke" }) };
  assert.deepEqual(getSocialRank(actor(["Rank: 1"], 2)), { rank: 7, title: "Duke" }, "the owning module outranks both");
  domainsApi = { getSocialRank: () => 4 };
  assert.deepEqual(getSocialRank(actor()), { rank: 4, title: "" });
  domainsApi = null;
}

// --- the status row -----------------------------------------------------------------
{
  const fake = (rank) => ({
    name: `r${rank}`,
    type: "character",
    rank,
    system: { details: { alignment: "", level: 1 } },
    items: [],
    effects: [],
    getFlag: () => undefined,
  });
  const facts = { getSocialRank: (a) => (a.rank == null ? null : { rank: a.rank, title: "" }) };
  globalThis.acksExtras.henchmen = { facts };
  assert.equal(computeDefaults(fake(5), fake(2)).seduction.socialStatus, 3, "rungs above the target");
  assert.equal(computeDefaults(fake(2), fake(5)).seduction.socialStatus, 0, "below the target is nothing, not a penalty");
  assert.equal(computeDefaults(fake(null), fake(2)).seduction.socialStatus, 0, "an unknown rank leaves the row untouched");
  delete globalThis.acksExtras.henchmen;
  assert.equal(computeDefaults(fake(5), fake(2)).seduction.socialStatus, 0, "no facts provider, no auto value");
}

// --- the market's rarity override ---------------------------------------------------
{
  const overrides = [{ classKey: "Mage", rarity: "common" }, { classKey: "thief", rarity: "nonsense" }];
  assert.equal(overrideRarity(overrides, "mage"), "common", "the class is matched without regard to case");
  assert.equal(overrideRarity(overrides, " MAGE "), "common");
  assert.equal(overrideRarity(overrides, "thief"), null, "a tier off the ladder is no override");
  assert.equal(overrideRarity(overrides, "fighter"), null);
  assert.equal(overrideRarity(overrides, ""), null);
  assert.equal(overrideRarity(undefined, "mage"), null);
  const roll = async () => 1;
  // No rarity tables are registered here, so the table cannot answer either
  // way: without the override the class is unknown; with it the override
  // has already answered and the search reaches the availability table.
  const bare = await rollMonthlyPool({ kind: "henchmanByClass", classKey: "mage" }, 3, roll);
  assert.equal(bare.error, "unknown-class");
  const overridden = await rollMonthlyPool({ kind: "henchmanByClass", classKey: "mage" }, 3, roll, Math.random, "default", overrides);
  assert.equal(overridden.error, "unknown-rarity", "the override answers before the rarity table");
  const byProf = await rollMonthlyPool({ kind: "henchmanByClassProficiency", classKey: "mage" }, 3, roll, Math.random, "default", overrides);
  assert.equal(byProf.error, "unknown-rarity", "a class-proficiency search reads the same override");
}

console.log("test-factions: all checks passed");
