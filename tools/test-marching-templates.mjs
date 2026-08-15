/**
 * Saved marching orders: capturing an arrangement, and laying a party that has
 * changed since back into it. Pure functions; no Foundry, no world.
 */
import assert from "node:assert/strict";
import { captureOrder, reconcile } from "../scripts/formation/marching-templates.mjs";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

const member = (actorId, roles = []) => ({ actorId, roles });
const blank = () => ({ blank: true });
/** The actor ids of an arrangement, with blanks shown as gaps. */
const order = (members) => members.map((m) => (m.blank ? "_" : m.actorId));

test("an arrangement is captured as order, roles and frontage", () => {
  const formation = {
    frontage: 3,
    members: [member("scout", ["scout"]), blank(), member("mapper", ["mapper", "pole"])],
  };
  const saved = captureOrder(formation);
  assert.equal(saved.frontage, 3);
  assert.deepEqual(saved.cells, [
    { actorId: "scout", roles: ["scout"] },
    { blank: true },
    { actorId: "mapper", roles: ["mapper", "pole"] },
  ]);
});

test("a cell naming nobody is captured as a blank", () => {
  // A record whose actor was deleted still holds its square, and a saved order
  // has no way to say more about it than that.
  const saved = captureOrder({ frontage: 1, members: [{ roles: ["scout"] }, member("a")] });
  assert.deepEqual(saved.cells, [{ blank: true }, { actorId: "a", roles: [] }]);
});

test("a missing frontage degrades to single file rather than to nothing", () => {
  assert.equal(captureOrder({ members: [] }).frontage, 1);
  assert.equal(captureOrder({ frontage: 0, members: [] }).frontage, 1);
});

test("an unchanged party is laid back into the exact order it was saved in", () => {
  const members = [member("c"), member("a"), member("b")];
  const saved = captureOrder({ frontage: 2, members: [member("a"), member("b"), member("c")] });
  const result = reconcile(members, saved.cells);
  assert.deepEqual(order(result.members), ["a", "b", "c"]);
  assert.equal(result.restored, 3);
  assert.equal(result.added, 0);
  assert.deepEqual(result.missing, []);
});

test("somebody the order names but the party no longer has is dropped, and counted", () => {
  const members = [member("a"), member("c")];
  const cells = [{ actorId: "a" }, { actorId: "b" }, { actorId: "c" }];
  const result = reconcile(members, cells);
  // The line closes up rather than marching with a hole where the dead man was.
  assert.deepEqual(order(result.members), ["a", "c"]);
  assert.deepEqual(result.missing, ["b"]);
  assert.equal(result.restored, 2);
});

test("somebody the order never knew about keeps their place at the back", () => {
  // A saved arrangement is not a roster: the henchman hired since it was saved
  // must not be discharged by restoring it.
  const members = [member("a"), member("hireling", ["rearguard"]), member("b")];
  const result = reconcile(members, [{ actorId: "b" }, { actorId: "a" }]);
  assert.deepEqual(order(result.members), ["b", "a", "hireling"]);
  assert.equal(result.added, 1);
  // And they keep the roles they currently hold, untouched by the order.
  assert.deepEqual(result.members.at(-1).roles, ["rearguard"]);
});

test("several newcomers keep the relative order they already stood in", () => {
  const members = [member("x"), member("a"), member("y")];
  const result = reconcile(members, [{ actorId: "a" }]);
  assert.deepEqual(order(result.members), ["a", "x", "y"]);
  assert.equal(result.added, 2);
});

test("roles are restored from the order, not from where the member stood", () => {
  const members = [member("a", ["pole"]), member("b")];
  const result = reconcile(members, [
    { actorId: "a", roles: ["scout"] },
    { actorId: "b", roles: ["mapper"] },
  ]);
  assert.deepEqual(result.members[0].roles, ["scout"]);
  assert.deepEqual(result.members[1].roles, ["mapper"]);
});

test("a role whose gear the character no longer holds is refused, not forced", () => {
  // The same rule `toggleRole` applies: restoring a mapper who has lost their
  // quill would put the formation in a state its own rules call impossible.
  const members = [member("a"), member("b")];
  const roleAllowed = (actorId, role) => !(actorId === "a" && role === "mapper");
  const result = reconcile(
    members,
    [
      { actorId: "a", roles: ["mapper", "scout"] },
      { actorId: "b", roles: ["mapper"] },
    ],
    { roleAllowed },
  );
  assert.deepEqual(result.members[0].roles, ["scout"]);
  assert.deepEqual(result.members[1].roles, ["mapper"]);
  assert.deepEqual(result.skipped, [{ actorId: "a", role: "mapper" }]);
});

test("the blanks come from the saved order, and only from it", () => {
  const members = [member("a"), blank(), blank(), member("b")];
  const result = reconcile(members, [{ actorId: "a" }, { blank: true }, { actorId: "b" }]);
  assert.deepEqual(order(result.members), ["a", "_", "b"]);
});

test("an order naming the same character twice places them once", () => {
  const members = [member("a"), member("b")];
  const result = reconcile(members, [{ actorId: "a" }, { actorId: "a" }, { actorId: "b" }]);
  assert.deepEqual(order(result.members), ["a", "b"]);
  assert.equal(result.restored, 2);
});

test("an empty order leaves the party exactly as it stood", () => {
  const members = [member("a"), member("b")];
  const result = reconcile(members, []);
  assert.deepEqual(order(result.members), ["a", "b"]);
  assert.equal(result.restored, 0);
  assert.equal(result.added, 2);
});

test("reconciling reads the party without editing it", () => {
  // The caller reports what would change before committing, so the records it
  // was handed must come back untouched.
  const members = [member("a", ["pole"]), member("b")];
  const snapshot = JSON.stringify(members);
  const result = reconcile(members, [{ actorId: "b", roles: ["scout"] }, { actorId: "a", roles: [] }]);
  assert.equal(JSON.stringify(members), snapshot);
  assert.notEqual(result.members[0], members[1]);
});

test("everything else a member carries survives the reshuffle", () => {
  // Token snapshots, deploy markers and the left-behind flag all ride along:
  // restoring an arrangement may not cost a character their stashed body.
  const members = [{ actorId: "a", roles: [], tokenData: { x: 1 }, deployedTokenId: "t1", left: true }];
  const [restored] = reconcile(members, [{ actorId: "a", roles: ["scout"] }]).members;
  assert.deepEqual(restored.tokenData, { x: 1 });
  assert.equal(restored.deployedTokenId, "t1");
  assert.equal(restored.left, true);
});

test("a round trip through capture and reconcile is the identity", () => {
  const members = [member("a", ["scout"]), blank(), member("b", ["mapper"]), member("c")];
  const saved = captureOrder({ frontage: 2, members });
  const result = reconcile(members, saved.cells);
  assert.deepEqual(order(result.members), order(members));
  assert.deepEqual(
    result.members.map((m) => m.roles ?? null),
    members.map((m) => (m.blank ? null : m.roles)),
  );
});

console.log(`test-marching-templates: OK (${passed} checks — capture, order, roles, gaps, newcomers, round trip)`);
