/**
 * `deleteRecords` (scripts/lib/record-delete.mjs) against an actor whose server
 * answers a delete after a tick and refuses one that names an effect already
 * gone, as Foundry's does.
 */
import assert from "node:assert/strict";
import { deleteRecords, inTurn } from "../scripts/lib/record-delete.mjs";

/** An actor holding `ids`, with every delete it was sent in `sent`. */
function actorOf(ids, { list = false } = {}) {
  const held = new Map(ids.map((id) => [id, { id }]));
  const sent = [];
  return {
    sent,
    get effects() {
      return list ? [...held.values()] : held;
    },
    async deleteEmbeddedDocuments(kind, going, options) {
      sent.push({ kind, going: [...going], options });
      await new Promise((resolve) => setTimeout(resolve, 5));
      for (const id of going) if (!held.has(id)) throw new Error(`ActiveEffect "${id}" does not exist!`);
      for (const id of going) held.delete(id);
      return going;
    },
  };
}

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
};

await t("the mock refuses as the server does: two bare deletes of one effect, the second throws", async () => {
  const actor = actorOf(["a"]);
  const both = await Promise.allSettled([actor.deleteEmbeddedDocuments("ActiveEffect", ["a"]), actor.deleteEmbeddedDocuments("ActiveEffect", ["a"])]);
  assert.deepEqual(both.map((r) => r.status), ["fulfilled", "rejected"]);
});

await t("two paths ending one record at once send one delete, and neither throws", async () => {
  const actor = actorOf(["a", "b"]);
  const [exit, teardown] = await Promise.all([deleteRecords(actor, ["a"], { managed: true }), deleteRecords(actor, ["a", "b"], { managed: true })]);
  assert.deepEqual(exit, ["a"]);
  assert.deepEqual(teardown, ["b"], "the second names only what the actor still holds at its turn");
  assert.deepEqual(actor.sent.map((s) => s.going), [["a"], ["b"]]);
  assert.deepEqual(actor.sent[0].options, { managed: true });
});

await t("ids the actor no longer holds send nothing", async () => {
  const actor = actorOf([]);
  assert.deepEqual(await deleteRecords(actor, ["gone"]), []);
  assert.equal(actor.sent.length, 0);
});

await t("a delete with no options passes none, and an actor whose effects are a plain list is read too", async () => {
  const actor = actorOf(["a"], { list: true });
  assert.deepEqual(await deleteRecords(actor, ["a", "x"]), ["a"]);
  assert.equal(actor.sent[0].options, undefined);
});

await t("a delete that fails for another reason rejects, and the actor's next delete still runs", async () => {
  const actor = actorOf(["a"]);
  const real = actor.deleteEmbeddedDocuments;
  actor.deleteEmbeddedDocuments = async () => {
    throw new Error("the server said no");
  };
  await assert.rejects(() => deleteRecords(actor, ["a"]), /the server said no/);
  actor.deleteEmbeddedDocuments = real;
  assert.deepEqual(await deleteRecords(actor, ["a"]), ["a"]);
});

await t("a write in the actor's turn waits for the delete before it, and reads the actor after it", async () => {
  const actor = actorOf(["a"]);
  const gone = deleteRecords(actor, ["a"]);
  const seen = await inTurn(actor, async () => [...actor.effects.keys()]);
  await gone;
  assert.deepEqual(seen, [], "the turn read the actor once the delete had come back");
  await assert.rejects(() => inTurn(actor, async () => { throw new Error("no"); }), /no/);
  assert.equal(await inTurn(actor, async () => "next"), "next", "a throwing turn leaves the queue running");
});

console.log(`test-record-delete: ${passed} checks passed.`);
