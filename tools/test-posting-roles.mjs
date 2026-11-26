/**
 * `createPosting` reads the sender, not the server role, for permission: a
 * relayed request is refused where the sender does not own the employer, a
 * player is blocked from the level-only kind and from a directed search that
 * names no target, and a GM's request (no `requestUserId`) skips those
 * checks. A posting already standing for the employer and segment stands in
 * for the rest of the post: reaching `duplicate-segment` proves a request got
 * past the sender checks. Every figure below is invented.
 *
 * Nothing here renders the posting dialog or drops an actor on a place's
 * sheet; `tools/live/henchmen-owner-controls.mjs` step "posting" walks both.
 *
 * Run: node tools/test-posting-roles.mjs
 */
import assert from "node:assert";

class Field {
  constructor(options = {}) {
    this.options = options;
  }
}
const fieldsProxy = new Proxy({}, { get: () => Field });
globalThis.foundry = { abstract: { TypeDataModel: class {} }, data: { fields: fieldsProxy } };
const USERS = { player: { id: "p1", isGM: false } };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k },
  time: { worldTime: 0 },
  settings: { get: () => null },
  users: { get: (id) => Object.values(USERS).find((u) => u.id === id) },
};
globalThis.Hooks = { once() {}, on() {}, callAll() {} };

// The arrival shares are the one table a generic post reads before the sender checks.
const TABLES = { "availability.arrivalProse": { firstShare: 0.5, secondShare: 0.5, secondMin: 1 } };
globalThis.acksExtras = {
  lib: {
    tables: {
      hasDoc: (doc) => Object.keys(TABLES).some((k) => k.startsWith(`${doc}.`)),
      getTable: (doc, id) => {
        const t = TABLES[`${doc}.${id}`];
        if (!t) throw new Error(`no table ${doc}.${id}`);
        return t;
      },
    },
  },
};

const { createPosting } = await import("../scripts/henchmen/engine/recruitment.mjs");

const owned = { uuid: "Actor.owned", testUserPermission: (user) => user.id === "p1" };
const foreign = { uuid: "Actor.foreign", testUserPermission: () => false };
const standing = (segment, spec) => ({
  toObject: () => ({ id: `post-${segment}`, status: "active", segment, employerUuid: owned.uuid, spec }),
});
const place = () => ({
  system: {
    hasMarket: true,
    marketClass: 4,
    market: {},
    postings: [standing("henchman:1", { kind: "henchman", level: 1 }), standing("henchman:*", { kind: "henchman", general: true })],
  },
});
const post = (spec, employer, requestUserId) => createPosting(place(), spec, employer, { requestUserId });

const LEVEL_ONLY = { kind: "henchman", level: 1 };
const PAST_THE_CHECKS = { error: "duplicate-segment" };

// ---- the level-only kind: a player is blocked, the Judge's request is not ----
assert.deepStrictEqual(await post(LEVEL_ONLY, owned, USERS.player.id), { error: "criteria-required" }, "a player's level-only post is refused");
assert.deepStrictEqual(await post(LEVEL_ONLY, owned, null), PAST_THE_CHECKS, "the same post from a GM (no requestUserId) is not refused by the sender checks");

// ---- ownership of the employer decides who may post for it ----
assert.deepStrictEqual(await post({ kind: "henchman", general: true }, owned, USERS.player.id), PAST_THE_CHECKS, "a player posting the general kind for an employer they own passes");
assert.deepStrictEqual(await post({ kind: "henchman", general: true }, foreign, USERS.player.id), { error: "not-yours" }, "a player posting for an employer they do not own is refused");
assert.deepStrictEqual(await post({ kind: "henchman", general: true }, null, USERS.player.id), { error: "not-yours" }, "a player posting with no employer is refused");
assert.deepStrictEqual(await post(LEVEL_ONLY, foreign, USERS.player.id), { error: "not-yours" }, "ownership is checked before the kind");

// ---- a directed search names its target ----
assert.deepStrictEqual(await post({ kind: "henchmanByClass", classKey: "" }, owned, USERS.player.id), { error: "criteria-required" }, "a player's by-class search with no class is refused");
assert.deepStrictEqual(await post({ kind: "henchmanByClassProficiency", classKey: "", proficiencyName: "x" }, owned, USERS.player.id), { error: "criteria-required" }, "a by-class-and-proficiency search with no class is refused");
assert.deepStrictEqual(await post({ kind: "henchmanByProficiency", proficiencyName: "  " }, owned, USERS.player.id), { error: "criteria-required" }, "a by-proficiency search with a blank proficiency is refused");

// ---- flipping "players see details": the employer's owner or a GM, written for them ----
// The owner's seat reaches the write by the GM relay, which re-reads the sender here.
{
  const { setPostingDetails, candidateMasked } = await import("../scripts/henchmen/engine/recruitment.mjs");
  const USER_GM = { id: "g1", isGM: true };
  USERS.gm = USER_GM;
  USERS.other = { id: "p2", isGM: false };
  globalThis.fromUuid = async (uuid) => (uuid === owned.uuid ? owned : uuid === foreign.uuid ? foreign : null);
  const placeOf = (employerUuid) => {
    const writes = [];
    return {
      writes,
      system: { postings: [{ toObject: () => ({ id: "p-1", status: "active", segment: "henchman:2", employerUuid, playersSeeDetails: true }) }] },
      update: async (data) => void writes.push(data),
    };
  };
  const owner = placeOf(owned.uuid);
  const done = await setPostingDetails(owner, "p-1", false, { requestUserId: USERS.player.id });
  assert.strictEqual(done.error, undefined, "the employer's owner flips the posting's details");
  assert.strictEqual(owner.writes[0]["system.market.postings"][0].playersSeeDetails, false, "and the flip is written");
  assert.strictEqual(owner.writes[0]["system.market.postings"][0].status, "active", "without touching the rest of the posting");
  const byGm = placeOf(foreign.uuid);
  assert.strictEqual((await setPostingDetails(byGm, "p-1", false, { requestUserId: USER_GM.id })).error, undefined, "a GM seat flips any posting's details");
  const local = placeOf(foreign.uuid);
  assert.strictEqual((await setPostingDetails(local, "p-1", false)).error, undefined, "a local call with no sender is the GM's own");
  const mine = placeOf(owned.uuid);
  assert.deepStrictEqual(await setPostingDetails(mine, "p-1", false, { requestUserId: USERS.other.id }), { error: "not-yours" }, "a non-owner is refused");
  assert.strictEqual(mine.writes.length, 0, "and nothing is written");
  const theirs = placeOf(foreign.uuid);
  assert.deepStrictEqual(await setPostingDetails(theirs, "p-1", false, { requestUserId: USERS.player.id }), { error: "not-yours" }, "a player flipping a posting for an employer they do not own is refused");
  assert.deepStrictEqual(await setPostingDetails(owner, "p-9", false, { requestUserId: USERS.player.id }), { error: "no-posting" }, "a posting that is not there is named");

  // ---- masking: an employer sees their own candidates in a segment their posting hides from others ----
  const masked = new Set(["henchman:2"]);
  const view = (over) => candidateMasked({ isGM: false, segment: "henchman:2", maskedSegments: masked, coveredSegments: new Set(), coversAllHenchmen: false, ...over });
  assert.strictEqual(view({}), true, "another player's view of a masked segment stays masked");
  assert.strictEqual(view({ coveredSegments: new Set(["henchman:2"]) }), false, "the employer whose own active posting covers the segment is not masked");
  assert.strictEqual(view({ coversAllHenchmen: true }), false, "nor is the holder of the general henchman posting, for a henchman segment");
  assert.strictEqual(view({ segment: "specialist:x", maskedSegments: new Set(["specialist:x"]), coversAllHenchmen: true }), true, "the general henchman posting covers no other kind");
  assert.strictEqual(view({ coveredSegments: new Set(["henchman:3"]) }), true, "a posting in another segment does not unmask this one");
  assert.strictEqual(view({ isGM: true }), false, "a GM is never masked");
  assert.strictEqual(view({ segment: "" }), false, "a candidate in no shared segment is never masked");
  assert.strictEqual(view({ segment: "henchman:4" }), false, "a segment no posting hides is not masked");
}

console.log("test-posting-roles: OK (level-only block, GM pass-through, employer ownership, directed criteria, details flip, masking)");
