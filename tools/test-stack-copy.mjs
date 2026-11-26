/**
 * The copy a stack makes beside itself (scripts/lib/stack-copy.mjs): two seats
 * making one copy make one, and the seat whose create is refused is shown no
 * error for it.
 */
import assert from "node:assert/strict";

const shown = [];
globalThis.ui = {
  notifications: {
    error(message) {
      shown.push(String(message));
      return { id: shown.length };
    },
  },
};

const { copyIdFor, createCopyBeside } = await import("../scripts/lib/stack-copy.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
};

/** A holder whose server answers each create through `answer`, which may throw as a refusal does. */
function holderOf(answer) {
  const rows = new Map();
  const calls = [];
  const holder = {
    items: rows,
    calls,
    async createEmbeddedDocuments(kind, data, options) {
      calls.push({ kind, data, options });
      return answer({ rows, data, options });
    },
  };
  return holder;
}

const refusal = (id) => `The _id [${id}] already exists within the parent collection: Actor [holder] items`;

await t("a copy with no id takes an id of the server's own", async () => {
  const holder = holderOf(({ data }) => [{ ...data[0], _id: "server" }]);
  const made = await createCopyBeside({ parent: holder }, { name: "Sword" }, null);
  assert.equal(made._id, "server");
  assert.equal(holder.calls[0].options, undefined, "no keepId without an id");
});

await t("a copy under its id is created with keepId", async () => {
  const holder = holderOf(({ data }) => [data[0]]);
  const made = await createCopyBeside({ parent: holder }, { name: "Sword" }, "copyA");
  assert.equal(made._id, "copyA");
  assert.deepEqual(holder.calls[0].options, { keepId: true });
});

await t("a copy the holder already has writes nothing", async () => {
  const holder = holderOf(() => {
    throw new Error("no create should be sent");
  });
  holder.items.set("copyB", {});
  assert.equal(await createCopyBeside({ parent: holder }, { name: "Sword" }, "copyB"), null);
  assert.equal(holder.calls.length, 0);
});

await t("the seat whose create is refused for the other seat's copy resolves null and is shown no error", async () => {
  shown.length = 0;
  const holder = holderOf(({ rows }) => {
    // The other seat's copy lands, then core raises its notice for the refusal and rejects.
    rows.set("copyC", {});
    ui.notifications.error(refusal("copyC"));
    ui.notifications.error("Some other failure");
    throw new Error(refusal("copyC"));
  });
  assert.equal(await createCopyBeside({ parent: holder }, { name: "Sword" }, "copyC"), null);
  assert.deepEqual(shown, ["Some other failure"], "the refusal's notice is dropped and every other notice passes");
  ui.notifications.error(refusal("copyC"));
  assert.equal(shown.length, 2, "once the create has settled, a notice naming the id passes again");
});

await t("a refusal that leaves the holder without the row rethrows", async () => {
  const holder = holderOf(() => {
    throw new Error("the server said no");
  });
  await assert.rejects(() => createCopyBeside({ parent: holder }, { name: "Sword" }, "copyD"), /the server said no/);
});

await t("two reads of one state name one copy, and a later state another", () => {
  const row = { id: "row", _stats: { modifiedTime: 100 } };
  assert.equal(copyIdFor(row, 3), copyIdFor({ ...row }, 3));
  assert.notEqual(copyIdFor(row, 3), copyIdFor({ id: "row", _stats: { modifiedTime: 101 } }, 3));
  assert.equal(copyIdFor({ id: "row" }, 3), null);
});

console.log(`test-stack-copy: ${passed} checks passed.`);
